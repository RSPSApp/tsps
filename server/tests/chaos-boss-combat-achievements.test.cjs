// Run after `yarn build`: node --test tests/chaos-boss-combat-achievements.test.cjs
//
// Every Combat Achievement of the Chaos Elemental and the Chaos Fanatic (cache monsters "Chaos
// Elemental" and "Chaos Fanatic", 8 tasks). The Combat Achievements plugin is registered whole, and
// its own hooks (onNpcDeath, onPlayerDealtDamage, onCombatHitResolved, custom events) are fired as
// the game fires them; the bosses' marks come from their real attack code (Madness, Discord, the
// Fanatic's explosion).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');

const core = PluginManager.getCoreApi();
const Ca = require('../plugins/achievements/CombatAchievements.plugin');
const Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
const Progress = require('../plugins/achievements/combatachievements/Progress.CombatAchievements');
const Derived = require('../plugins/achievements/combatachievements/DerivedRules.CombatAchievements');
const Elemental = require('../plugins/bosses/ChaosElemental.plugin');
const Fanatic = require('../plugins/bosses/ChaosFanatic.plugin');
const FanaticTasks = require('../plugins/achievements/combatachievements/tasks/ChaosFanatic.CombatAchievements');

let processCycle = 1000;
const hooks = new Map();
const custom = new Map();
const submitted = [];
const persisted = new Map();
const testCore = {
  ...core,
  World: { ...core.World, getProcessCycle: () => processCycle },
  // The attack code only sends these to clients.
  Projectile: Object.assign(class { sendProjectile() {} }, {
    createProjectile: () => ({ sendProjectile() {} }), arrivalCycles: () => 60, ticksToLand: () => 2,
  }),
  WeaponInterfaceManager: { assign() {} },
};
const on = (name) => (handler) => hooks.set(name, [...(hooks.get(name) ?? []), handler]);
const fire = (name, event) => (hooks.get(name) ?? []).forEach((handler) => handler(event));
const api = new Proxy({
  core: testCore,
  getTaskManager: () => ({ submit: (task) => submitted.push(task) }),
  getBonusManager: () => ({ update() {} }),
  getRegionManager: () => ({ blocked: () => false }),
  onNpcDeath: on('npcDeath'),
  onPlayerDealtDamage: on('dealt'),
  onCombatHitResolved: on('hitResolved'),
  persistAttribute: (key, value) => persisted.set(key, value),
  onCustomEvent: (name, handler) => custom.set(name, [...(custom.get(name) ?? []), handler]),
  emitCustomEvent: (name, request) => (custom.get(name) ?? []).forEach((handler) => handler(request)),
}, { get: (target, key) => target[key] ?? (() => {}) });

let ElementalCombat, FanaticCombat;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Ca.register(api);
  ElementalCombat = Elemental._test.combatClass(api);
  FanaticCombat = Fanatic._test.combatClass(api);
});

/** A player as Combat Achievements and the bosses' attacks read one. */
function createPlayer({ x = 3263, y = 3925, freeSlots = 28, worn = [] } = {}) {
  const attributes = new Map();
  const sender = new Proxy({}, { get: () => () => sender });
  const equipment = Array.from({ length: 14 }, (_, slot) => new core.Item(worn[slot] ?? -1, worn[slot] > 0 ? 1 : 0));
  const inventory = [];
  const player = {
    messages: [],
    inventory,
    isPlayer: () => true, isNpc: () => false, isRegistered: () => true,
    getAsPlayer: () => player,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    sendMessage: (text) => player.messages.push(text),
    getLocation: () => new core.Location(x, y, 0),
    getFightType: () => ({ getBonusType: () => 0 }),
    isSpecialActivated: () => false,
    getUpdateFlag: () => ({ flag() {} }),
    performGraphic() {},
    getEquipment: () => ({
      getItems: () => equipment,
      capacity: () => equipment.length,
      set: (slot, item) => { equipment[slot] = item; },
      refreshItems() {},
    }),
    getInventory: () => ({
      getFreeSlots: () => freeSlots - inventory.length,
      contains: () => false,
      add: (item) => inventory.push(item.getId()),
      refreshItems() {},
    }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => { player.hitsTaken = (player.hitsTaken ?? 0) + hits.length; } }) }),
  };
  return player;
}

function spawn(id, players = []) {
  const npc = core.NPC.create(id, new core.Location(3263, 3923, 0));
  npc.getPlayersWithinDistance = () => players;
  return npc;
}

const elemental = (players) => spawn(core.NpcIdentifiers.CHAOS_ELEMENTAL, players);
const fanatic = (players) => spawn(core.NpcIdentifiers.CHAOS_FANATIC, players);

/** The player's hit on the boss, as combat queues and resolves it. */
function attack(player, npc, damage = 10) {
  const hit = { getCombatType: () => core.CombatType.RANGED, getTotalDamage: () => damage, getTarget: () => npc, getAttacker: () => player };
  fire('dealt', { player, target: npc, hit });
  fire('hitResolved', { attacker: player, target: npc, hit });
}

/** The boss dies, killed by `killer`, with everyone in `fighters` having fought it. */
function kill(npc, killer, fighters = [killer]) {
  processCycle += 1;
  for (const player of fighters) attack(player, npc);
  fire('npcDeath', { npc, killer, damagers: fighters, preventDeath: false });
  processCycle += 1;
}

/** Runs the boss's submitted special-attack tasks (they land a few ticks after the cast). */
function land() {
  for (const task of submitted.splice(0)) task.execute();
}

const done = (player, name) => Progress.isComplete(player, Data.taskNamed(name).id);

test('the cache has eight tasks for the two bosses, all ruled', () => {
  const names = [...Data.tasks().values()]
    .filter((task) => ['Chaos Elemental', 'Chaos Fanatic'].includes(task.monster?.name))
    .map((task) => [task.name, task.description]);
  assert.deepEqual(names.sort(), [
    ['Chaos Elemental Adept', 'Kill the Chaos Elemental 10 times.'],
    ['Chaos Elemental Veteran', 'Kill the Chaos Elemental 25 times.'],
    ['Chaos Fanatic Adept', 'Kill the Chaos Fanatic 25 times.'],
    ['Chaos Fanatic Champion', 'Kill the Chaos Fanatic 10 times.'],
    ['Hoarder', 'Kill the Chaos Elemental without it unequipping any of your items.'],
    ['Praying to the Gods', 'Kill the Chaos Fanatic 10 times without drinking any potion which restores prayer or leaving the Wilderness.'],
    ['Sorry, What Was That?', 'Kill the Chaos Fanatic without anyone being hit by his explosion attack.'],
    ['The Flincher', 'Kill the Chaos Elemental without taking any damage from its attacks.'],
  ].sort());
  assert.ok(Derived.ruleFor(Data.taskNamed('The Flincher')), 'its description reads as a derived rule');
  assert.equal(Derived.derive(api).some(([npc]) => npc === 'Chaos Elemental'), false, 'but the Elemental rules its own');
});

test('kill-count tasks: Adept at 10 Chaos Elemental kills, Veteran at 25; Champion at 10 Fanatic kills, Adept at 25', () => {
  const player = createPlayer();
  for (let i = 1; i <= 25; i++) {
    kill(elemental(), player);
    kill(fanatic(), player);
    if (i === 9) assert.deepEqual([done(player, 'Chaos Elemental Adept'), done(player, 'Chaos Fanatic Champion')], [false, false]);
    if (i === 10) assert.deepEqual([done(player, 'Chaos Elemental Adept'), done(player, 'Chaos Fanatic Champion')], [true, true]);
    if (i === 24) assert.deepEqual([done(player, 'Chaos Elemental Veteran'), done(player, 'Chaos Fanatic Adept')], [false, false]);
  }
  assert.deepEqual([done(player, 'Chaos Elemental Veteran'), done(player, 'Chaos Fanatic Adept')], [true, true]);
});

// ------------------------------------------------------------------ Chaos Elemental

/** Madness landing on `target`. */
function madness(npc, target) {
  Elemental._test.applyChaosElementalSpecial(Elemental._test.ChaosElementalAttackType.DISARM, npc, target);
}

/** A Discord hit on `target` resolving for `damage`. */
function discord(npc, target, damage) {
  new ElementalCombat().handleAfterHitEffects({ getTarget: () => target, getAttacker: () => npc, getTotalDamage: () => damage });
}

test('Hoarder: a kill with nothing unequipped completes it', () => {
  const player = createPlayer({ worn: { 3: 861 } });
  kill(elemental([player]), player);
  assert.equal(done(player, 'Hoarder'), true);
});

test('Hoarder: Madness unequipping the weapon fails it, even before the first hit', () => {
  const player = createPlayer({ worn: { 3: 861 } });
  const npc = elemental([player]);
  madness(npc, player);
  assert.deepEqual(player.inventory, [861], 'the weapon went to the inventory');
  kill(npc, player);
  assert.equal(done(player, 'Hoarder'), false);
});

test("Hoarder: another player's items being unequipped fails it for everyone in the kill", () => {
  const fighter = createPlayer({ worn: { 3: 861 }, freeSlots: 0 });
  const other = createPlayer({ worn: { 3: 861 } });
  const npc = elemental([fighter, other]);
  madness(npc, fighter);
  assert.deepEqual(fighter.inventory, [], 'a full inventory leaves nothing to take');
  madness(npc, other);
  kill(npc, fighter, [fighter, other]);
  assert.deepEqual([done(fighter, 'Hoarder'), done(other, 'Hoarder')], [false, false]);
});

test('Hoarder and The Flincher: a passer-by it disarmed or hit, not in the kill, fails neither', () => {
  const fighter = createPlayer();
  const passer = createPlayer({ worn: { 3: 861 } });
  const npc = elemental([fighter, passer]);
  madness(npc, passer);
  discord(npc, passer, 9);
  assert.deepEqual(passer.inventory, [861]);
  kill(npc, fighter);
  assert.deepEqual([done(fighter, 'Hoarder'), done(fighter, 'The Flincher')], [true, true]);
});

test('Hoarder: Madness that takes nothing (a full inventory, or nothing worn) still completes it', () => {
  const full = createPlayer({ worn: { 3: 861 }, freeSlots: 0 });
  const bare = createPlayer();
  const npc = elemental([full, bare]);
  madness(npc, full);
  madness(npc, bare);
  kill(npc, full, [full, bare]);
  assert.deepEqual([done(full, 'Hoarder'), done(bare, 'Hoarder')], [true, true]);
});

test('Hoarder: its respawn starts clean', () => {
  const player = createPlayer({ worn: { 3: 861 } });
  const first = elemental([player]);
  madness(first, player);
  kill(first, player);
  assert.equal(done(player, 'Hoarder'), false);
  kill(elemental([player]), player);
  assert.equal(done(player, 'Hoarder'), true);
});

test('The Flincher: a kill without any damage taken completes it; a Discord hit of 0 does not count', () => {
  const player = createPlayer();
  const npc = elemental([player]);
  discord(npc, player, 0);
  kill(npc, player);
  assert.equal(done(player, 'The Flincher'), true);
});

test('The Flincher: being hit fails it, and so does another player being hit', () => {
  const hit = createPlayer();
  const npc = elemental([hit]);
  discord(npc, hit, 12);
  kill(npc, hit);
  assert.equal(done(hit, 'The Flincher'), false);

  const flincher = createPlayer();
  const bystander = createPlayer();
  const second = elemental([flincher, bystander]);
  discord(second, bystander, 5);
  kill(second, flincher, [flincher, bystander]);
  assert.equal(done(flincher, 'The Flincher'), false, 'any player taking damage fails it for everyone');
  kill(elemental([flincher]), flincher);
  assert.equal(done(flincher, 'The Flincher'), true, 'the respawn starts clean');
});

test("The Flincher: its hits on something other than a player don't count", () => {
  const player = createPlayer();
  const npc = elemental([player]);
  const other = spawn(core.NpcIdentifiers.CHAOS_FANATIC);
  other.performGraphic = () => {};
  discord(npc, other, 15);
  kill(npc, player);
  assert.equal(done(player, 'The Flincher'), true);
});

// ------------------------------------------------------------------ Chaos Fanatic

/** His explosion: three books around `target`, landing four ticks later. */
function explode(npc, target) {
  const method = new FanaticCombat();
  npc.getCombat().setAttackDelay = () => {};
  method.explode(npc, target);
  land();
}

test('Sorry, What Was That?: a kill without anyone hit by the explosion completes it', (t) => {
  t.mock.method(core.Misc, 'getRandom', () => 0);
  // He aims at the tile the player stood on when he cast; they are five tiles away when it lands.
  const aimedAt = createPlayer();
  const player = createPlayer({ x: 3263 + 5 });
  const npc = fanatic([player]);
  explode(npc, aimedAt);
  assert.equal(player.hitsTaken, undefined);
  kill(npc, player);
  assert.equal(done(player, 'Sorry, What Was That?'), true);
});

test('Sorry, What Was That?: anyone standing on a book fails it for everyone, a 0 roll included', (t) => {
  t.mock.method(core.Misc, 'getRandom', () => 0);
  const fighter = createPlayer({ x: 3270 });
  const bystander = createPlayer();
  const npc = fanatic([fighter, bystander]);
  explode(npc, bystander);
  assert.equal(bystander.hitsTaken, 1);
  kill(npc, fighter, [fighter, bystander]);
  assert.deepEqual([done(fighter, 'Sorry, What Was That?'), done(bystander, 'Sorry, What Was That?')], [false, false]);
  kill(fanatic([fighter]), fighter);
  assert.equal(done(fighter, 'Sorry, What Was That?'), true, 'his respawn starts clean');
});

const drink = (player, name) => api.emitCustomEvent('potions:drunk', { player, itemId: 0, name, meta: null });
const leaveWilderness = (player) => api.emitCustomEvent('wilderness:left', { player });
const prayingKills = (player) => Number(player.getAttribute(FanaticTasks.PRAYING_KILLS_ATTRIBUTE)) || 0;

test('Praying to the Gods: ten kills in a row complete it on the tenth', () => {
  assert.equal(persisted.get(FanaticTasks.PRAYING_KILLS_ATTRIBUTE), 0, 'the count is saved: logging out keeps it');
  const player = createPlayer();
  for (let i = 1; i <= 9; i++) kill(fanatic(), player);
  drink(player, 'Saradomin brew');
  drink(player, 'Antipoison');
  drink(player, 'Prayer mix'); // Not on the Wiki's list, which is only these potions.
  assert.equal(done(player, 'Praying to the Gods'), false);
  kill(fanatic(), player);
  assert.equal(done(player, 'Praying to the Gods'), true);
  kill(fanatic(), player);
  assert.equal(prayingKills(player), 10, 'once done, the count stops');
});

test('Praying to the Gods: every potion the Wiki lists starts the count over', () => {
  for (const name of ['Prayer potion', 'Prayer regeneration potion', 'Zamorak brew', 'Super restore', 'Sanfew serum', 'Ancient brew', 'Moonlight moth mix']) {
    const player = createPlayer();
    for (let i = 0; i < 9; i++) kill(fanatic(), player);
    drink(player, name);
    assert.equal(prayingKills(player), 0, name);
    kill(fanatic(), player);
    assert.equal(done(player, 'Praying to the Gods'), false, name);
  }
});

test('Praying to the Gods: leaving the Wilderness starts the count over', () => {
  const player = createPlayer();
  for (let i = 0; i < 9; i++) kill(fanatic(), player);
  leaveWilderness(player);
  for (let i = 0; i < 9; i++) kill(fanatic(), player);
  assert.equal(done(player, 'Praying to the Gods'), false);
  kill(fanatic(), player);
  assert.equal(done(player, 'Praying to the Gods'), true);
});

test('Praying to the Gods: only the killer counts the kill', () => {
  const killer = createPlayer();
  const helper = createPlayer();
  for (let i = 0; i < 10; i++) kill(fanatic(), killer, [killer, helper]);
  assert.deepEqual([done(killer, 'Praying to the Gods'), done(helper, 'Praying to the Gods')], [true, false]);
});
