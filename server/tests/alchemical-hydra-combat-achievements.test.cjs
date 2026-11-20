// From server/: node --test tests/alchemical-hydra-combat-achievements.test.cjs (after yarn build).
//
// The Alchemical Hydra's Combat Achievement tasks (cache task structs): its acid, lightning and
// fire hit as plain damage the fight log of Fights.CombatAchievements does not see, so
// Fight.AlchemicalHydra.js keeps what Unrequired Antipoisons, Lightning Lure, Don't Flame Me,
// Mixing Correctly, The Flame Skipper, Alcleanical Hydra and No Pressure read, and the chamber
// counts Working Overtime's kills.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const core = PluginManager.getCoreApi();

let Common, Fight, Lair, Kills, Derived, Data, rules, tasks, processCycle = 1000;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  Common = require('../plugins/bosses/alchemicalhydra/Common.AlchemicalHydra');
  Fight = require('../plugins/bosses/alchemicalhydra/Fight.AlchemicalHydra');
  Lair = require('../plugins/bosses/alchemicalhydra/Lair.AlchemicalHydra');
  Kills = require('../plugins/bosses/alchemicalhydra/Kills.AlchemicalHydra');
  Derived = require('../plugins/achievements/combatachievements/DerivedRules.CombatAchievements');
  tasks = [];
  const world = { ...core.World, getProcessCycle: () => processCycle };
  const testCore = { ...core, World: world, TaskManager: { submit: (task) => tasks.push(task) }, CombatFactory: { poisonEntity: (player) => { if (!player.antipoison) player.poisoned = true; } } };
  const api = new Proxy({ core: testCore, persistAttribute: () => {} }, { get: (target, key) => target[key] ?? (() => {}) });
  Common.init(api);
  Data = require('../plugins/achievements/combatachievements/Data.CombatAchievements');
  Data(new Proxy({ core }, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  const captured = {};
  require('../plugins/achievements/combatachievements/tasks/AlchemicalHydra.CombatAchievements')(
    { core: testCore }, { onKill: (name, tests) => { captured[name] = tests; } },
  );
  rules = captured['Alchemical Hydra'];
  for (const name of Object.keys(rules)) assert.ok(Data.taskNamed(name), `the cache has a task called ${name}`);
});

const loc = (x, y) => new core.Location(x, y, 0);

function fakeHydra(hp = 1100) {
  const npc = {
    hitpoints: hp,
    getId: () => Common.ids.npcs.serpentine,
    setNpcTransformationId: () => {},
    getLocation: () => loc(1364, 10265),
    getSize: () => 6,
    getHitpoints: () => npc.hitpoints,
    isDyingFunction: () => false,
    performAnimation: () => {},
    getCombat: () => ({ setAttackDelay: () => {} }),
  };
  return npc;
}

function fakePlayer(x = 1363, y = 10260) {
  const tile = loc(x, y);
  const player = {
    damage: [], hp: 99, poisoned: false, antipoison: false,
    isPoisoned: () => player.poisoned,
    isVenomed: () => false,
    getLocation: () => tile,
    isRegistered: () => true,
    getHitpoints: () => player.hp,
    sendMessage: () => {},
    getPacketSender: () => ({ sendGraphic: () => {} }),
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => player.damage.push(...hits.map((h) => h.getDamage())) }) }),
    getMovementQueue: () => ({ reset: () => {}, setBlockMovement: () => {} }),
  };
  return player;
}

function fakeLair(player) {
  const [minX, maxX, minY, maxY] = Common.data.room.bounds;
  return {
    players: () => (player ? [player] : []),
    contains: (l) => l.getX() >= minX && l.getX() <= maxX && l.getY() >= minY && l.getY() <= maxY,
  };
}

/** What Fights.CombatAchievements hands a rule. */
function fightOf(npc, player, { ticks = 300, hitsTaken = [], weapons = null } = {}) {
  return { npc, player, ticks, hitsTaken, within: (s) => ticks * 0.6 < s, onlyWeaponsNamed: (prefix) => weapons === prefix };
}

function flush() {
  const due = tasks;
  tasks = [];
  for (const task of due) task.execute();
}

test('a clean kill finishes every hit, vent and fire task; its speed tasks are timed here', () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  new Fight.Fight(fakeLair(player), npc);
  const fight = fightOf(npc, player, { ticks: 150 }); // 90 seconds
  for (const name of ['Unrequired Antipoisons', 'Lightning Lure', "Don't Flame Me", 'Mixing Correctly', 'The Flame Skipper', 'Alcleanical Hydra']) {
    assert.equal(rules[name](fight), true, name);
  }
  assert.equal(rules['Alchemical Speed-Chaser'](fight), true, 'under 1:45');
  assert.equal(rules['Alchemical Speed-Runner'](fight), false, 'not under 1:20');
  assert.equal(rules['Alchemical Speed-Runner'](fightOf(npc, player, { ticks: 130 })), true, '78 seconds');
});

test("the Hydra's tasks are its own: the derived rules leave it out", () => {
  const derived = Derived.derive({ emitCustomEvent: () => {} }).filter(([name]) => name === 'Alchemical Hydra');
  assert.deepEqual(derived, []);
});

test('acid: its splash or a pool fails Unrequired Antipoisons and Alcleanical Hydra, even a 0 splash fails the first', () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  const random = Math.random;
  Math.random = () => 0; // a 0 splash
  try {
    hydra.landPoison(player.getLocation(), player);
  } finally {
    Math.random = random;
  }
  assert.deepEqual(player.damage, [0]);
  const fight = fightOf(npc, player);
  assert.equal(rules['Unrequired Antipoisons'](fight), false);
  assert.equal(rules['Alcleanical Hydra'](fight), false, 'a 0 splash still poisons: its ticks are damage');
  hydra.tickCount += 1; // the pool hurts from the tick after it lands
  hydra.tickPools([player]);
  assert.ok(player.damage[1] > 0);
  assert.equal(rules['Alcleanical Hydra'](fight), false, 'the pool hurt');
  assert.equal(rules['Lightning Lure'](fight), true);
  assert.equal(rules["Don't Flame Me"](fight), true);
});

test('Alcleanical Hydra: a 0 splash under an antipoison neither hurts nor poisons, so it still counts', () => {
  const player = fakePlayer();
  player.antipoison = true;
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  const random = Math.random;
  Math.random = () => 0;
  try {
    hydra.landPoison(player.getLocation(), player);
  } finally {
    Math.random = random;
  }
  assert.deepEqual(player.damage, [0]);
  assert.equal(player.poisoned, false);
  assert.equal(rules['Alcleanical Hydra'](fightOf(npc, player)), true);
  assert.equal(rules['Unrequired Antipoisons'](fightOf(npc, player)), false, 'it was still hit by the acid');
});

test('lightning: a current reaching the player fails Lightning Lure', () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  hydra.castLightning();
  for (let i = 0; i < 40 && hydra.lightningActive(); i++) { hydra.tickCount += 1; hydra.tickCurrents([player]); }
  assert.ok(player.damage.length > 0);
  assert.equal(rules['Lightning Lure'](fightOf(npc, player)), false);
  assert.equal(rules['Unrequired Antipoisons'](fightOf(npc, player)), true);
});

test("fire: breathing it fails The Flame Skipper; its tracking flame or burn fails Don't Flame Me", () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  hydra.breatheFire(player);
  assert.equal(rules['The Flame Skipper'](fightOf(npc, player)), true, 'no wall yet');
  for (let i = 0; i < 3; i++) { hydra.tickCount += 1; hydra.tickFire([player]); }
  assert.equal(rules['The Flame Skipper'](fightOf(npc, player)), false, 'the first wall');
  assert.equal(rules["Don't Flame Me"](fightOf(npc, player)), true, 'not hit yet');
  for (let i = 0; i < 30; i++) { hydra.tickCount += 1; hydra.tickFire([player]); }
  assert.ok(player.damage.length > 0);
  assert.equal(rules["Don't Flame Me"](fightOf(npc, player)), false);
});

test('the wrong vent empowering it fails Mixing Correctly, even once its own vent weakens it after', () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  npc.getLocation = () => loc(1366, 10258); // on the red vent
  hydra.phase = 1; // the electric phase wants green
  hydra.eruptVents([player]);
  assert.equal(hydra.empowered, true);
  assert.equal(rules['Mixing Correctly'](fightOf(npc, player)), false);
  hydra.phase = 0;
  hydra.eruptVents([player]);
  assert.equal(hydra.empowered, false);
  assert.equal(rules['Mixing Correctly'](fightOf(npc, player)), false, 'it was empowered in the fight');
});

test("No Pressure: Dharok's greataxe only, and no more than 10 hitpoints from the fight's first hit to the kill", () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  processCycle = 5000;
  hydra.tick([player]); // 99 on coming in, before the fight
  processCycle = 5010;
  player.hp = 5;
  hydra.tick([player]);
  processCycle = 5100;
  player.hp = 10;
  hydra.tick([player]);
  const axe = { ticks: 100, weapons: "Dharok's greataxe" }; // the first hit at 5000 + 10 ticks
  processCycle = 5110;
  assert.equal(rules['No Pressure'](fightOf(npc, player, axe)), true);
  assert.equal(rules['No Pressure'](fightOf(npc, player, { ticks: 100, weapons: 'Abyssal whip' })), false, 'another weapon');
  assert.equal(rules['No Pressure'](fightOf(npc, player, { ticks: 105, weapons: "Dharok's greataxe" })), false, 'the fight began at 99');
  processCycle = 5105;
  player.hp = 11;
  hydra.tick([player]);
  player.hp = 10;
  processCycle = 5106;
  hydra.tick([player]);
  processCycle = 5110;
  assert.equal(rules['No Pressure'](fightOf(npc, player, axe)), false, '11 in the fight');
});

test('No Pressure: a heal on the killing tick, after the Hydra logged it, still fails the task', () => {
  const player = fakePlayer();
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  processCycle = 6000;
  player.hp = 8;
  hydra.tick([player]);
  const axe = { ticks: 50, weapons: "Dharok's greataxe" };
  processCycle = 6050;
  hydra.tick([player]); // the Hydra's last tick: still 8
  assert.equal(rules['No Pressure'](fightOf(npc, player, axe)), true);
  player.hp = 30; // eaten later in the same tick, before the killing hit lands
  assert.equal(rules['No Pressure'](fightOf(npc, player, axe)), false, '30 at the kill');
});

test('Working Overtime: 15 kills in the chamber, counted once each, starting over on a new visit', () => {
  const player = fakePlayer();
  const lair = { killed: new WeakSet(), kills: 0, recordKill: Lair.Lair.prototype.recordKill };
  let fight;
  for (let i = 1; i <= 15; i++) {
    const npc = fakeHydra();
    npc.__hydraLair = lair;
    fight = fightOf(npc, player);
    // Kills.AlchemicalHydra.js and the rule both count it; either may run first.
    if (i % 2) Kills.hydraDeath({ npc, killer: null });
    assert.equal(rules['Working Overtime'](fight), i >= 15, `kill ${i}`);
    Kills.hydraDeath({ npc, killer: null });
    flush();
  }
  assert.equal(lair.kills, 15);
  const fresh = { killed: new WeakSet(), kills: 0, recordKill: Lair.Lair.prototype.recordKill };
  const npc = fakeHydra();
  npc.__hydraLair = fresh;
  assert.equal(rules['Working Overtime'](fightOf(npc, player)), false, 'a new visit starts over');
});

/** A real Player (99 Hitpoints) with only the network stubbed. */
function realPlayer() {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSkillManager().setMaxLevels(core.Skill.HITPOINTS, 99, false);
  return player;
}

/**
 * The Lair's own attach, so the fight log hears skills:current-level-changed through the real registration and
 * dispatch (PluginManager.createApi's onCustomEvent, SkillManager's emitCustomEvent). Only onCustomEvent reaches
 * the real api, so the chamber's other hooks are not left on the global hook lists; the custom event hooks are
 * swapped for a fresh map for the test and put back after it.
 */
function registerLair(t) {
  const hooks = PluginManager.customEventHooks;
  PluginManager.customEventHooks = new Map();
  t.after(() => { PluginManager.customEventHooks = hooks; });
  const real = PluginManager.createApi('AlchemicalHydraTest');
  Lair.attach(new Proxy({ onCustomEvent: real.onCustomEvent }, { get: (target, key) => target[key] ?? (() => {}) }));
}

// Wiki, No Pressure: "no more than 10 Hitpoints throughout the entire fight"; its strategy tick-eats with low-healing
// food. A real Player's heal and hit between two of the Hydra's ticks reach the log through skills:current-level-changed.
test('No Pressure: a heal above 10 that a hit takes back down between two Hydra ticks still fails the task', (t) => {
  const player = realPlayer();
  registerLair(t);
  const npc = fakeHydra();
  const hydra = new Fight.Fight(fakeLair(player), npc);
  processCycle = 7000;
  player.setHitpoints(8);
  hydra.tick([player]);
  const axe = { ticks: 50, weapons: "Dharok's greataxe" };
  processCycle = 7020;
  player.heal(5); // 13: a purple sweet eaten at 8
  player.setHitpoints(9); // the Hydra's hit lands the same tick
  hydra.tick([player]);
  processCycle = 7050;
  hydra.tick([player]);
  assert.equal(player.getHitpoints(), 9);
  assert.equal(rules['No Pressure'](fightOf(npc, player, axe)), false, '13 between two ticks');

  const other = realPlayer();
  const calm = new Fight.Fight(fakeLair(other), fakeHydra());
  processCycle = 8000;
  other.setHitpoints(8);
  calm.tick([other]);
  processCycle = 8020;
  other.heal(2); // 10: still within the limit
  other.setHitpoints(7);
  calm.tick([other]);
  processCycle = 8050;
  assert.equal(rules['No Pressure'](fightOf(calm.npc, other, axe)), true, 'never above 10');
});

test('No Pressure: a change outside a live fight is not logged into it', (t) => {
  const player = realPlayer();
  registerLair(t);
  let inside = true;
  const lair = { ...fakeLair(player), players: () => (inside ? [player] : []) };
  const npc = fakeHydra();
  const hydra = new Fight.Fight(lair, npc);
  processCycle = 9000;
  player.setHitpoints(8);
  hydra.tick([player]);
  player.heal(1); // 9 inside the room, between two ticks: logged through the event
  assert.equal(Fight.lifeOf(npc).hitpoints.get(player).some((entry) => entry.hp === 9), true, 'a change inside is logged');
  inside = false; // left the room
  player.heal(20);
  hydra.stop();
  assert.equal(Fight.lifeOf(npc).hitpoints.get(player).some((entry) => entry.hp > 10), false);
});
