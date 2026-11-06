// Run after `yarn build`: node --test tests/guardians-of-the-rift.test.cjs
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const Shared = require('../plugins/minigames/guardiansoftherift/Shared.GuardiansOfTheRift');
const Game = require('../plugins/minigames/guardiansoftherift/Game.GuardiansOfTheRift');
const Records = require('../plugins/minigames/guardiansoftherift/Records.GuardiansOfTheRift');
const Temple = require('../plugins/minigames/guardiansoftherift/Temple.GuardiansOfTheRift');
const Barrier = require('../plugins/minigames/guardiansoftherift/Barrier.GuardiansOfTheRift');
const GreatGuardian = require('../plugins/minigames/guardiansoftherift/GreatGuardian.GuardiansOfTheRift');
const Rewards = require('../plugins/minigames/guardiansoftherift/Rewards.GuardiansOfTheRift');
const Mining = require('../plugins/minigames/guardiansoftherift/Mining.GuardiansOfTheRift');
const Workbench = require('../plugins/minigames/guardiansoftherift/Workbench.GuardiansOfTheRift');
const Portals = require('../plugins/minigames/guardiansoftherift/Portals.GuardiansOfTheRift');
const DepositPool = require('../plugins/minigames/guardiansoftherift/DepositPool.GuardiansOfTheRift');
const Pouches = require('../plugins/skills/runecrafting/Pouches.Runecrafting');
const Altars = require('../plugins/minigames/guardiansoftherift/Altars.GuardiansOfTheRift');
const Cells = require('../plugins/minigames/guardiansoftherift/Cells.GuardiansOfTheRift');
const RiftGuardians = require('../plugins/minigames/guardiansoftherift/RiftGuardians.GuardiansOfTheRift');
const Creatures = require('../plugins/minigames/guardiansoftherift/Creatures.GuardiansOfTheRift');
const RewardsGuardian = require('../plugins/minigames/guardiansoftherift/RewardsGuardian.GuardiansOfTheRift');
const Apprentices = require('../plugins/minigames/guardiansoftherift/Apprentices.GuardiansOfTheRift');

const hooks = {
  objects: {}, npcs: {}, items: {}, clicks: {}, custom: {}, login: [], logout: [], conditions: [], areas: [], prompts: [],
  dialogues: [], canBankItem: [], beforeObjects: [], itemOnObject: {}, itemOnItem: {}, itemOnNpc: [], drops: [], npcsSpawned: [], npcsRemoved: [],
  persisted: new Set(), currencies: new Map(),
};

/** Enough of an NPC for barriers and guardians: hitpoints, transforms, a movement queue. */
function fakeNpc(definition) {
  const npc = {
    id: definition.id, transform: -1, hp: 0, x: definition.x, y: definition.y, registered: true,
    getId: () => npc.id,
    getLocation: () => new Location(npc.x, npc.y, 0),
    isRegistered: () => npc.registered,
    getMaxHitpoints: () => Shared.core().NpcDefinition.forId(npc.transform !== -1 ? npc.transform : npc.id).getHitpoints(),
    getHitpoints: () => npc.hp,
    setHitpoints: (hp) => { npc.hp = hp; return npc; },
    heal: (amount) => { npc.hp = Math.min(npc.getMaxHitpoints(), npc.hp + amount); },
    setNpcTransformationId: (id) => { npc.transform = id; return npc; },
    getMovementQueue: () => ({ setBlockMovement() {}, reset() {}, size: () => 0, routes: npc.routes }),
    performAnimation: (animation) => npc.animations.push(animation.getId?.() ?? animation.id),
    forceChat() {},
    flags: new Set(), routes: [], animations: [], splats: [],
    setFlag: (flag) => npc.flags.add(flag),
    getSize: () => Shared.core().NpcDefinition.forId(npc.id).getSize?.() ?? 1,
    setPositionToFace() {},
    decrementHealth: (hit) => { const d = Math.min(npc.hp, hit.getDamage()); npc.hp -= d; hit.setDamage(d); return hit; },
    addTickHit: (hit) => npc.splats.push(hit.getDamage()),
  };
  npc.hp = npc.getMaxHitpoints();
  return npc;
}
const QUESTS_DONE = new Set(['temple_of_the_eye']);

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    persistAttribute: (key, defaultValue) => {
      hooks.persisted.add(key);
      PlayerSave.persistAttribute(key, defaultValue);
    },
    registerShopCurrency: (key, handler) => hooks.currencies.set(key, handler),
    onServerStartup() {},
    registerCommand() {},
    registerArea: (area) => hooks.areas.push(area),
    onPlayerLogin: (handler) => hooks.login.push(handler),
    onPlayerLogout: (handler) => hooks.logout.push(handler),
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onBeforeObjectInteraction: (handler) => hooks.beforeObjects.push(handler),
    onNpcInteraction: (name, actions) => { hooks.npcs[name] = actions; },
    onNpcDialogueCondition: (handler) => hooks.conditions.push(handler),
    onCustomEvent: (name, handler) => (hooks.custom[name] ??= []).push(handler),
    emitCustomEvent: (name, payload) => {
      if (name === 'quest:is-complete') payload.complete = payload.player.questDone && (payload.key === 'temple_of_the_eye' || QUESTS_DONE.has(payload.key));
      if (name === 'omnishop:open') hooks.shops = [...(hooks.shops ?? []), payload.shop];
      if (name === 'runecrafting:altar-rune') payload.rune = { runeId: 557, level: 9, xp: 6.5, amount: 4, petBase: 1 };
      if (name === 'npc-dialogue:start') { hooks.dialogues.push(payload.variant); payload.handled = true; }
      if (name === 'mining:best-pickaxe') payload.pickaxe = payload.player.pickaxe ?? null;
      if (name === 'skillcape:has-perk') payload.result = payload.player.cape === true;
      for (const handler of hooks.custom[name] ?? []) handler(payload);
    },
    sendMultiChatboxPrompt: (player, title, ...args) => hooks.prompts.push({ player, title, args }),
    onItemAction: (name, actions) => { hooks.items[name] = actions; },
    onObjectClick: (ids, clickType, handler) => { hooks.clicks[`${ids}:${clickType}`] = handler; },
    onCanBankItem: (handler) => hooks.canBankItem.push(handler),
    onItemOnObject: (item, object, handler) => { hooks.itemOnObject[`${item}|${object}`] = handler; },
    onItemOnItem: (a, b, handler) => { hooks.itemOnItem[`${a}|${b}`] = handler; },
    onItemOnNpc: (handler) => hooks.itemOnNpc.push(handler),
    getTaskManager: () => TaskManager,
    onItemDropPolicy: (handler) => hooks.drops.push(handler),
    spawnNpc: (definition) => { const npc = fakeNpc(definition); hooks.npcsSpawned.push(npc); return npc; },
    removeNpc: (npc) => { npc.registered = false; hooks.npcsRemoved.push(npc); },
  };
}

function container(size) {
  const slots = new Array(size).fill(null);
  const self = {
    slots,
    add(id, amount = 1) {
      if (typeof id === 'object') [id, amount] = [id.getId(), id.getAmount()];
      const stack = slots.find((slot) => slot?.id === id);
      if (stack) stack.amount += amount;
      else slots[slots.indexOf(null)] = { id, amount };
      return self;
    },
    /** Like ItemContainer.adds: stackables pile up, anything else takes a slot each. */
    adds(id, amount = 1) {
      if (STACKABLE.has(id) || Shared.core().ItemDefinition.forId(id)?.isStackable?.()) return self.add(id, amount);
      for (let i = 0; i < amount && slots.includes(null); i++) slots[slots.indexOf(null)] = { id, amount: 1 };
      return self;
    },
    delete(id, amount = 1) {
      for (let i = 0; i < slots.length && amount > 0; i++) {
        if (slots[i]?.id !== id) continue;
        const taken = Math.min(amount, slots[i].amount);
        slots[i].amount -= taken;
        amount -= taken;
        if (slots[i].amount <= 0) slots[i] = null;
      }
      return self;
    },
    contains: (id) => slots.some((slot) => slot?.id === id),
    getAmount: (id) => slots.reduce((sum, slot) => sum + (slot?.id === id ? slot.amount : 0), 0),
    getFreeSlots: () => slots.filter((slot) => !slot).length,
    getAddableAmount: (item) => (STACKABLE.has(item.getId()) || Shared.core().ItemDefinition.forId(item.getId())?.isStackable?.()
      ? (self.contains(item.getId()) || slots.includes(null) ? item.getAmount() : 0)
      : Math.min(item.getAmount(), slots.filter((slot) => !slot).length)),
    getItems: () => slots.map((slot) => (slot ? { getId: () => slot.id, getAmount: () => slot.amount } : null)),
    deleteAtSlot(index, amount = 1) {
      if (!slots[index]) return self;
      slots[index].amount -= amount;
      if (slots[index].amount <= 0) slots[index] = null;
      return self;
    },
    getCopiedItems: () => slots.map((slot) => new (Shared.core().Item)(slot?.id ?? -1, slot?.amount ?? 0)),
    refreshItems() { return self; },
  };
  return self;
}

const STACKABLE = new Set();

function fakePlayer(name = 'Tester', { runecraft = 99, questDone = true, x = 3615, y = 9480 } = {}) {
  const varbits = new Map();
  const attributes = new Map();
  let interfaceId = -1;
  const p = {
    name, questDone, messages: [], statements: [], scripts: [], interfaces: [], animations: [], jingles: [],
    xpBySkill: {}, runEnergy: 50, special: 100, levels: {}, sounds: [],
    location: new Location(x, y, 0),
    inventory: container(28),
    isRegistered: () => true,
    isPlayer: () => true,
    getAsPlayer: () => p,
    getUsername: () => name,
    getLocation: () => p.location,
    getSize: () => 1,
    getPrivateArea: () => null,
    getIndex: () => 1,
    moveTo(location) { p.location = location; },
    blocked: false,
    getMovementQueue: () => ({ reset() {}, setBlockMovement: (blocked) => { p.blocked = blocked; } }),
    setPositionToFace() {},
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInterfaceId: () => interfaceId,
    setInterfaceId: (id) => { interfaceId = id; return p; },
    sendMessage: (message) => p.messages.push(message),
    getEquipment: () => ({ contains: () => false }),
    bank: container(800),
    getBanks: () => [p.bank],
    getBank: () => p.bank,
    getCurrentBankTab: () => 0,
    getInventory: () => Object.assign(p.inventory, { full() { p.messages.push("You don't have enough inventory space."); } }),
    performAnimation: (animation) => p.animations.push(animation.getId?.() ?? animation.id),
    performGraphic() {},
    getSpecialPercentage: () => p.special,
    getRunEnergy: () => p.runEnergy,
    setRunEnergy: (value) => { p.runEnergy = Math.min(100, value); },
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill?.getName?.() === 'Runecrafting' ? runecraft : p.levels[skill?.getName?.()] ?? 99),
      getCurrentLevel: () => 99,
      addExperiences(skill, amount) {
        const key = skill?.getName?.() ?? String(skill);
        p.xpBySkill[key] = (p.xpBySkill[key] ?? 0) + amount;
      },
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        getVarp: (id) => varbits.get(`varp${id}`) ?? varbits.get(id) ?? 0,
        sendSubInterface: (uid, id) => { p.interfaces.push(id); return sender; },
        closeSubInterface: () => { p.interfaces.push(-1); return sender; },
        sendInterfaceFlagsRange: () => sender,
        sendInterfaceScript: (id, args) => { p.scripts.push([id, args]); return sender; },
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendTypedMessage: (type, message) => { p.messages.push(message); return sender; },
        sendJingle: (id) => { p.jingles.push(id); return sender; },
        sendSound: (id) => { p.sounds.push(id); return sender; },
        sendSoundEffect: (id) => { p.sounds.push(id); return sender; },
        sendCameraShake: () => sender,
        sendCameraReset: () => sender,
        sendRunEnergy: () => sender,
        sendProjectile: () => sender,
        sendObjectAnimation: () => sender,
        sendSoundEffect: (id) => { p.sounds.push(id); return sender; },
      };
      return sender;
    },
    varbit: (name) => varbits.get(Shared.core().CacheDefinitions.getVarbitId(name)) ?? 0,
    varp: (name) => varbits.get(`varp${Shared.core().CacheDefinitions.getVarpId(name)}`) ?? 0,
    lastHud: () => p.scripts.filter((s) => s[0] === Shared.SCRIPT.HUD_UPDATE).at(-1)?.slice(1),
  };
  return p;
}

/** A Player with a session stub, enough for inventory refreshes in a save round-trip. */
function realPlayer() {
  return new Player({ sendClientPacket() {} });
}

function ticks(count) {
  for (let i = 0; i < count; i++) {
    Game.tick();
    TaskManager.process();
  }
}

/** A click the before-hooks see first, whatever loaded first (the altar trips claim theirs there). */
function claimed(player, objectId, option) {
  const event = { player, objectId, option, handled: false };
  for (const handler of hooks.beforeObjects) if (!event.handled) handler(event);
  return event.handled;
}

function barrier(player, option) {
  return hooks.objects.Barrier[option]({ player, objectId: Shared.loc(Shared.LOC.BARRIER) });
}

function statementText(player) {
  const chain = player.statements.at(-1);
  return JSON.stringify(chain ? [...chain.dialogues.values()] : null);
}

/** A game with this player in it, the rift open. */
function openGame(player) {
  barrier(player, 'Quick-pass');
  Game.skip();
  ticks(1);
}

function resetGame() {
  for (const player of Game.players()) Game.leave(player);
  const game = Game._game;
  Object.assign(game, { phase: Game.PHASE.LOBBY, timer: 100, elapsed: 0, power: 0, surged: false });
  game.altars = { elemental: 0, catalytic: 0, changesIn: 0 };
  game.portal = { direction: 0, closesIn: 0, opensIn: 0 };
  Cells.reset();
  RiftGuardians.dismissAll();
  Creatures.clear();
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  const api = fakeApi();
  Shared.bind(api);
  Records.attach(api);
  Temple.attach(api);
  Barrier.attach(api);
  GreatGuardian.attach(api);
  Rewards.attach(api);
  Mining.attach(api);
  Workbench.attach(api);
  Portals.attach(api);
  DepositPool.attach(api);
  Pouches.attach(api);
  Altars.attach(api);
  Cells.attach(api);
  RiftGuardians.attach(api);
  Creatures.attach(api);
  RewardsGuardian.attach(api);
  Apprentices.attach(api);
  Shared.core().PathFinder.calculateWalkRoute = (npc, x, y) => { npc.routes?.push([x, y]); return true; };
  for (const name of Shared.GAME_ITEMS) if (Shared.core().ItemDefinition.forId(Shared.obj(name)).isStackable()) STACKABLE.add(Shared.obj(name));
});

beforeEach(() => {
  resetGame();
  hooks.prompts.length = 0;
  hooks.dialogues.length = 0;
});

test('power follows the Wiki: 250 stones a player, 200 past the 20th (the captured maximums fit it)', () => {
  assert.equal(Game.maxPowerFor(0), 250);
  assert.equal(Game.maxPowerFor(1), 250);
  assert.equal(Game.maxPowerFor(20), 5000);
  assert.equal(Game.maxPowerFor(21), 5200);
  assert.equal(Game.maxPowerFor(454), 91800, 'rev 241 capture: 91,800 at the open');
});

test('points: one per 100 energy and the rest as a chance (the captured games: 165/407 -> 2/4)', () => {
  assert.equal(Rewards.pointsFor(165, () => 0.9), 1);
  assert.equal(Rewards.pointsFor(165, () => 0.5), 2);
  assert.equal(Rewards.pointsFor(407, () => 0.5), 4);
  assert.equal(Rewards.pointsFor(11, () => 0.5), 0);
  assert.equal(Rewards.pointsFor(300, () => 0), 3);
});

test('the barrier needs the quest and 27 Runecraft, and steps through two tiles', () => {
  const newcomer = fakePlayer('Newcomer', { questDone: false });
  barrier(newcomer, 'Quick-pass');
  assert.match(statementText(newcomer), /Temple of the Eye/);
  assert.equal(newcomer.location.getY(), 9480);
  const novice = fakePlayer('Novice', { runecraft: 26 });
  barrier(novice, 'Quick-pass');
  assert.match(statementText(novice), /27/);

  const player = fakePlayer();
  barrier(player, 'Quick-pass');
  assert.equal(player.location.getY(), 9484);
  assert.equal(player.varbit(Shared.VARBIT.IS_PLAYING), 1);
  assert.equal(player.varp(Shared.VARP.GAME_ID), 0, 'in the lobby the id comes with the open');
  assert.equal(player.interfaces.at(-1), Shared.iface(Shared.INTERFACE.HUD));
  assert.equal(Game.isPlaying(player), true);
});

test('the lobby counts down 30/10/5 seconds and 3, 2, 1, then the rift opens at 10% power', () => {
  const player = fakePlayer();
  barrier(player, 'Quick-pass');
  Game._game.timer = 51;
  ticks(51);
  assert.deepEqual(player.messages.slice(0, 7), [
    'The rift will become active in 30 seconds.',
    'The rift will become active in 10 seconds.',
    'The rift will become active in 5 seconds.',
    '3...', '2...', '1...',
    '<col=ef1020>The rift becomes active!',
  ]);
  assert.equal(Game.phase(), Game.PHASE.PREPARE);
  assert.notEqual(player.varp(Shared.VARP.GAME_ID), 0);
  assert.equal(player.varbit(Shared.VARBIT.FINISHED_GAME), 0);
  ticks(1);
  assert.ok(player.messages.includes('Creatures from the Abyss will attack in 120 seconds.'));
  ticks(1);
  const hud = player.lastHud();
  assert.deepEqual(hud.slice(0, 4), [0, 0, 25, 250], 'a solo game: 25 of 250');
  assert.ok(hud[9] >= 198 && hud[9] <= 199, 'the timer counts to the attack (the HUD goes out every other tick)');
});

test('the creatures attack at 200 ticks and the altars change every 33', () => {
  const player = fakePlayer();
  openGame(player);
  ticks(199);
  assert.equal(Game.phase(), Game.PHASE.PREPARE);
  ticks(1);
  assert.equal(Game.phase(), Game.PHASE.ATTACK);
  assert.equal(player.messages.at(-1), '<col=ef1020>Creatures from the Abyss begin their attack!</col>');
  const first = Game.activeAltars();
  assert.ok(first.elemental >= 1 && first.elemental <= 4 && first.catalytic >= 1 && first.catalytic <= 8);
  ticks(33);
  const next = Game.activeAltars();
  assert.notEqual(next.elemental, first.elemental);
  assert.notEqual(next.catalytic, first.catalytic);
});

test('Power-up takes every stone: 2 energy each (3 for poly stones), 5 XP each, one power each', () => {
  const player = fakePlayer();
  openGame(player);
  player.inventory.add(Shared.obj(Shared.ITEM.CATALYTIC_STONE), 64);
  player.inventory.add(Shared.obj(Shared.ITEM.POLYELEMENTAL_STONE), 10);
  const npcId = Shared.npc(Shared.NPC.GREAT_GUARDIAN);
  hooks.npcs['The Great Guardian']['Power-up']({ player, npcId, npc: { getLocation: () => new Location(3613, 9501, 0), getSize: () => 3, getPrivateArea: () => null } });
  ticks(4);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.CATALYTIC_STONE)), 0);
  assert.equal(player.varbit(Shared.VARBIT.CATALYTIC_EARNED), 128, 'the capture: 64 stones gave 128');
  assert.equal(player.varbit(Shared.VARBIT.ELEMENTAL_EARNED), 30);
  assert.equal(player.xpBySkill.Runecrafting, 370);
  assert.equal(Game._game.power, 25 + 74);
  assert.ok(player.animations.includes(Shared.seq('human_runecraft_walkmerge')));
});

test('without stones the Great Guardian answers from its transcript; another Great Guardian is left alone', () => {
  const player = fakePlayer();
  const npcId = Shared.npc(Shared.NPC.GREAT_GUARDIAN);
  hooks.npcs['The Great Guardian']['Power-up']({ player, npcId, npc: {} });
  assert.match(hooks.dialogues.at(-1), /without-any-type-of-guardian-stone/);
  const answer = (stepId) => hooks.conditions.map((handler) => handler({ npcId, player, stepId })).find((value) => value !== null);
  assert.equal(answer('dKs1aF'), true, 'resting between games');
  assert.equal(hooks.npcs['The Great Guardian']['Power-up']({ player, npcId: npcId + 1, npc: {} }), false, 'the quest has its own');
});

test('full power closes the rift 32 ticks later with the captured messages, points and XP', () => {
  const player = fakePlayer();
  openGame(player);
  Records.setPoints(player, 3, 3);
  Game.stateOf(player).elemental = 165;
  Game.stateOf(player).catalytic = 407;
  Game.setPower(100);
  assert.equal(Game.phase(), Game.PHASE.CHARGED);
  assert.equal(player.messages.at(-1), '<col=06600c>The Great Guardian is fully charged.</col>');
  ticks(31);
  assert.equal(Game.phase(), Game.PHASE.CHARGED);
  const before = player.messages.length;
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    ticks(1);
  } finally {
    Math.random = random;
  }
  assert.deepEqual(player.messages.slice(before), [
    '<col=06600c>The Great Guardian successfully closed the rift!</col>',
    'Amount of rifts you have closed: <col=ff0000>1</col>.',
    'Elemental energy attuned: <col=ef1020>2</col>. Catalytic energy attuned: <col=ef1020>4</col>.',
    'Total elemental energy: <col=ef1020>5</col>. Total catalytic energy:  <col=ef1020>7</col>.',
    "You've been awarded 4,455 bonus Runecraft XP for closing the rift.",
    'The Portal Guardians will keep their rifts open for another 30 seconds.',
  ]);
  assert.equal(player.varp(Shared.VARP.RIFTS_CLOSED), 1);
  assert.equal(player.varbit(Shared.VARBIT.FINISHED_GAME), 1);
  assert.deepEqual(player.jingles, [292]);
  assert.equal(player.lastHud()[2], 0, 'the HUD shows no power after the close');

  const late = fakePlayer('Late');
  barrier(late, 'Quick-pass');
  assert.match(statementText(late), /just finishing up/);
  assert.equal(late.location.getY(), 9480);

  ticks(51);
  assert.equal(player.messages.at(-1), 'The Portal Guardians close their rifts.');
  assert.equal(Game.phase(), Game.PHASE.LOBBY);
  assert.equal(Game._game.timer, 53, 'the next game opens 104 ticks after the close');
});

test('a close pays no pearls (they come from the Rewards Guardian), and pays its points and XP once', () => {
  const player = fakePlayer();
  openGame(player);
  Game.stateOf(player).elemental = 300;
  Game.setPower(100);
  ticks(32);
  assert.equal(Records.pearls(player), 0);
  assert.ok(!player.messages.some((message) => message.includes('abyssal pearl')));
  const state = Game.stateOf(player);
  const points = Records.points(player);
  const xp = player.xpBySkill.Runecrafting;
  Rewards.closed({ player, state });
  assert.deepEqual(Records.points(player), points);
  assert.equal(player.xpBySkill.Runecrafting, xp);
});

test('pearls are the abyssal pearl item; a balance saved before the revert comes back as pearls once', () => {
  const pearl = Shared.obj(Shared.ITEM.PEARL);
  assert.ok(hooks.persisted.has(Records.PEARLS_ATTRIBUTE), 'the old balance still loads, to be given back');
  const player = fakePlayer('Saver');
  player.setAttribute(Records.PEARLS_ATTRIBUTE, 500);
  const saves = [];
  const listener = (event) => saves.push(event);
  (hooks.custom['persistence:save'] ??= []).push(listener);
  try {
    Records.login({ player });
    Records.login({ player });
  } finally {
    hooks.custom['persistence:save'] = hooks.custom['persistence:save'].filter((handler) => handler !== listener);
  }
  assert.equal(player.inventory.getAmount(pearl), 500);
  assert.equal(Records.pearls(player), 500);
  assert.equal(player.getAttribute(Records.PEARLS_ATTRIBUTE), 0);
  assert.equal(saves.length, 1, 'a second login gives nothing more');
  assert.match(player.messages.at(-1), /500 abyssal pearls have been returned to your inventory/);

  const full = fakePlayer('Full');
  for (let i = 0; i < 28; i++) full.inventory.slots[i] = { id: 1, amount: 1 };
  full.setAttribute(Records.PEARLS_ATTRIBUTE, 40);
  Records.login({ player: full });
  assert.equal(full.bank.getAmount(pearl), 40, 'no room: the bank');
  assert.equal(hooks.currencies.has('ABYSSAL PEARLS'), false, 'no saved-balance currency any more');
});

test('a saved pearl balance with no room in the inventory or bank stays saved until the next login', () => {
  const { Item } = PluginManager.getCoreApi();
  const pearl = Shared.obj(Shared.ITEM.PEARL);
  const AXE = 1351;
  /** The real containers: the bank's refusal when it's full is what lost the pearls. */
  const nativePlayer = (saved) => {
    const player = new Player(null);
    const messages = [];
    const sender = new Proxy({ sendMessage: (text) => (messages.push(text), sender) }, { get: (target, key) => target[key] ?? (() => sender) });
    player.getPacketSender = () => sender;
    player.setAttribute(Records.PEARLS_ATTRIBUTE, saved);
    return { player, messages };
  };
  const fill = (player, inventorySlots) => {
    for (let i = 0; i < inventorySlots; i++) player.getInventory().add(new Item(AXE, 1), false);
    const bank = player.getBank(0);
    for (let id = 1; bank.getFreeSlots() > 0; id++) if (id !== pearl) bank.add(new Item(id, 1), false);
  };
  const saves = [];
  const listener = (event) => saves.push(event);
  (hooks.custom['persistence:save'] ??= []).push(listener);
  try {
    const full = nativePlayer(500);
    fill(full.player, 28);
    assert.equal(full.player.getInventory().getFreeSlots(), 0);
    assert.equal(full.player.getBank(0).getFreeSlots(), 0);
    Records.login({ player: full.player });
    assert.equal(full.player.getInventory().getAmount(pearl) + full.player.getBank(0).getAmount(pearl), 0);
    assert.equal(full.player.getAttribute(Records.PEARLS_ATTRIBUTE), 500, 'nothing delivered, nothing cleared');
    assert.equal(saves.length, 0, 'no save of a cleared balance');
    assert.ok(full.messages.includes('500 abyssal pearls are waiting for you: make room in your inventory or bank and log in again.'));
    assert.ok(!full.messages.some((message) => message.includes('returned')));

    // The next login, with one inventory slot free, delivers them.
    const next = nativePlayer(full.player.getAttribute(Records.PEARLS_ATTRIBUTE));
    fill(next.player, 27);
    Records.login({ player: next.player });
    assert.equal(next.player.getInventory().getAmount(pearl), 500);
    assert.equal(next.player.getAttribute(Records.PEARLS_ATTRIBUTE), 0);
    assert.equal(saves.length, 1);
    assert.ok(next.messages.includes('Your 500 abyssal pearls have been returned to your inventory.'));
  } finally {
    hooks.custom['persistence:save'] = hooks.custom['persistence:save'].filter((handler) => handler !== listener);
  }
});

test('spending pearls takes the item, and a short price changes nothing', () => {
  const player = fakePlayer();
  Records.addPearls(player, 500);
  assert.equal(Records.spendPearls(player, 400), true);
  assert.equal(Records.pearls(player), 100);
  assert.equal(Records.spendPearls(player, 400), false);
  assert.equal(Records.pearls(player), 100);
});

test("Felix's real Omnishop purchase takes the pearl items once", () => {
  const events = {};
  const buttons = new Map();
  const api = {
    core: Shared.core(),
    onCustomEvent: (name, handler) => (events[name] ??= []).push(handler),
    emitCustomEvent: (name, payload) => (events[name] ?? []).forEach((handler) => handler(payload)),
    onInterfaceActionButton: (ids, handler) => [ids].flat().forEach((id) => buttons.set(id, handler)),
  };
  require('../plugins/interface/Omnishop.plugin').register(api);

  const player = fakePlayer('Shopper');
  Records.addPearls(player, 1000);
  api.emitCustomEvent('omnishop:open', { player, shop: 'gotr_reward_shop_all', handled: false });
  const click = (name, fields) => buttons.get(Shared.core().CacheDefinitions.getComponentId(name))({
    player, buttonId: Shared.core().CacheDefinitions.getComponentId(name), handled: false, ...fields,
  });
  click('omnishop_main:list', { slot: 0, action: 1 });
  click('omnishop_main:button_1', { action: 1 });
  assert.equal(player.inventory.getAmount(Shared.obj('hat_of_the_eye')), 1);
  assert.equal(Records.pearls(player), 600, 'the 400-pearl Hat of the Eye is paid once');
  click('omnishop_main:button_1', { action: 1 });
  assert.equal(Records.pearls(player), 200, 'a second unit takes its own 400');
  click('omnishop_main:button_1', { action: 1 });
  assert.equal(Records.pearls(player), 200, 'a refused unit takes nothing');
  assert.equal(player.messages.at(-1), "You don't have enough Abyssal pearls.");
});

test('Search spends only points, never pearls (issue 2698): the loot pearls stay', () => {
  const player = fakePlayer();
  Records.setPoints(player, 1, 1);
  Records.addPearls(player, 60);
  const random = Math.random;
  Math.random = () => 0;
  try {
    rift(player, 'Search');
    ticks(10);
  } finally {
    Math.random = random;
  }
  assert.equal(Records.searches(player), 1, 'one point of each type is one search');
  assert.equal(Records.pearls(player), 60, 'the pearls are untouched');
  assert.match(statementText(player), /There doesn't seem to be anything else in the rift for you\./);
  rift(player, 'Big-search');
  assert.match(statementText(player), /There doesn't seem to be anything in the rift for you\./);
  assert.equal(Records.pearls(player), 60);
});

test('25 pearls used on the Rewards Guardian buy one roll; fewer are refused (Wiki)', () => {
  const player = fakePlayer();
  Records.addPearls(player, 30);
  const pearlsOnRift = hooks.itemOnObject['Abyssal pearls|<col=ffff00>Rewards Guardian</col>'];
  const random = Math.random;
  Math.random = () => 0;
  try {
    pearlsOnRift({ player, objectId: Shared.loc('gotr_reward_rift'), itemId: Shared.obj(Shared.ITEM.PEARL) });
    ticks(10);
  } finally {
    Math.random = random;
  }
  assert.equal(Records.searches(player), 1, 'a single roll');
  assert.equal(Records.pearls(player), 5);
  pearlsOnRift({ player, objectId: Shared.loc('gotr_reward_rift'), itemId: Shared.obj(Shared.ITEM.PEARL) });
  ticks(10);
  assert.equal(Records.searches(player), 1);
  assert.equal(player.messages.at(-1), 'You need 25 abyssal pearls to search the rift with them.');
});

test('a pearl roll puts the pearls in the inventory', () => {
  const player = fakePlayer();
  Records.setPoints(player, 1, 1);
  const random = Math.random;
  Math.random = () => 0.85; // the main table's pearl entry (weight 18 of 140)
  try {
    rift(player, 'Search');
    ticks(4);
  } finally {
    Math.random = random;
  }
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.PEARL)), 16);
  assert.deepEqual(Records.points(player), { elemental: 0, catalytic: 0 });
  assert.ok(player.messages.includes('You found some loot: 16 x Abyssal pearls'));
});

test('energy stops at 1,000 of a type and 1,200 in all', () => {
  const player = fakePlayer();
  openGame(player);
  assert.equal(Game.addEnergy(player, 'catalytic', 1100), 1000);
  assert.equal(Game.addEnergy(player, 'elemental', 300), 200);
  assert.equal(Game.addEnergy(player, 'elemental', 1), 0);
  assert.match(player.messages.at(-1), /fully attuned with runic energy/);
});

test("leaving takes the game's items and varbits; a login inside starts in the lobby", () => {
  const player = fakePlayer();
  openGame(player);
  player.inventory.add(Shared.obj(Shared.ITEM.FRAGMENTS), 40);
  player.inventory.add(Shared.obj(Shared.ITEM.ESSENCE), 10);
  player.inventory.add(995, 100);
  barrier(player, 'Quick-pass');
  assert.equal(player.location.getY(), 9482);
  assert.equal(Game.isPlaying(player), false);
  assert.equal(player.varbit(Shared.VARBIT.IS_PLAYING), 0);
  assert.equal(player.varp(Shared.VARP.GAME_ID), 0);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.FRAGMENTS)), 0);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.ESSENCE)), 0);
  assert.equal(player.inventory.getAmount(995), 100);
  assert.equal(player.interfaces.at(-1), -1);

  const sleeper = fakePlayer('Sleeper', { y: 9500 });
  for (const handler of hooks.login) handler({ player: sleeper });
  assert.equal(sleeper.location.getY(), Shared.LOBBY_TILE.y);
});

test('Peek reports the power mid-game and the adventurers inside', () => {
  const player = fakePlayer();
  openGame(player);
  const watcher = fakePlayer('Watcher');
  barrier(watcher, 'Peek');
  assert.match(statementText(watcher), /Creatures from the Abyss are coming through the rift\. There were 1 adventurer inside when it opened\. Great Guardian power: 10%/);
});

// ------------------------------------------------------------------ phase 2: essence

const DRAGON_PICKAXE = { attemptIntervalTicks: 3, animation: { getId: () => 7139 } };

function mine(player, loc) {
  const name = { gotr_essence_tier_1: 'Guardian parts', gotr_essence_tier_2: 'Large guardian remains', gotr_essence_tier_3: 'Huge guardian remains' }[loc];
  return hooks.objects[name].Mine({ player, objectId: Shared.loc(loc) });
}

test('mining waits for the rift and needs a pickaxe', () => {
  const player = fakePlayer('Miner');
  barrier(player, 'Quick-pass');
  mine(player, 'gotr_essence_tier_1');
  assert.equal(player.messages.at(-1), "There's no need to do that right now.");
  Game.skip();
  ticks(1);
  mine(player, 'gotr_essence_tier_1');
  assert.match(statementText(player), /You need a pickaxe to mine this rock/);
});

test('large remains give 2-4 fragments a success, 5 XP each, and the count stops paying at 250', () => {
  const player = fakePlayer('Miner');
  player.pickaxe = DRAGON_PICKAXE;
  openGame(player);
  mine(player, 'gotr_essence_tier_2');
  assert.equal(player.messages.at(-1), 'You swing your pick at the rock.');
  ticks(2);
  const first = player.inventory.getAmount(Shared.obj(Shared.ITEM.FRAGMENTS));
  assert.ok(first >= 2 && first <= 4, `2-4 fragments, got ${first}`);
  assert.equal(player.xpBySkill.Mining, 5);
  assert.equal(player.varbit(Shared.VARBIT.MINING_COUNT), first);
  ticks(3);
  assert.equal(player.xpBySkill.Mining, 10, 'one success every 3 ticks with a dragon pickaxe');
  Game.stateOf(player).mined = 249;
  ticks(3);
  assert.equal(player.varbit(Shared.VARBIT.MINING_COUNT), 250);
  assert.match(player.messages.at(-1), /limit of 250 resources mined/);
  ticks(3);
  assert.equal(player.xpBySkill.Mining, 15, 'no XP past 250');
  Shared.stopAction(player);
});

test('the pickaxe interval comes from the Mining plugin, so a dragon pickaxe sometimes mines a tick early', () => {
  const player = fakePlayer('Miner');
  player.pickaxe = DRAGON_PICKAXE;
  openGame(player);
  const early = (request) => { request.ticks = 2; };
  (hooks.custom['mining:roll-interval'] ??= []).push(early);
  try {
    mine(player, 'gotr_essence_tier_2');
    ticks(2);
    assert.equal(player.xpBySkill.Mining, 5);
    ticks(2);
    assert.equal(player.xpBySkill.Mining, 10, 'the next success 2 ticks on');
  } finally {
    hooks.custom['mining:roll-interval'].splice(hooks.custom['mining:roll-interval'].indexOf(early), 1);
    Shared.stopAction(player);
  }
});

test('huge remains give 4-6 essence until the inventory is full', () => {
  const player = fakePlayer('Miner');
  player.pickaxe = DRAGON_PICKAXE;
  openGame(player);
  player.inventory.adds(995, 1);
  STACKABLE.add(995);
  for (let i = 0; i < 20; i++) player.inventory.adds(1, 1);
  mine(player, 'gotr_essence_tier_3');
  ticks(2);
  const essence = player.inventory.getAmount(Shared.obj(Shared.ITEM.ESSENCE));
  assert.ok(essence >= 4 && essence <= 6);
  ticks(3);
  assert.equal(player.inventory.getFreeSlots(), 0);
  assert.match(statementText(player), /too full to hold any more guardian essence/);
  assert.ok(player.sounds.includes(2277));
});

test('the workbench turns a fragment into essence each tick for level/10 Crafting XP', () => {
  const player = fakePlayer('Crafter');
  player.levels.Crafting = 37;
  openGame(player);
  player.inventory.add(Shared.obj(Shared.ITEM.FRAGMENTS), 3);
  hooks.objects.Workbench['Work-at']({ player, objectId: Shared.loc('gotr_workbench') });
  ticks(3);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.ESSENCE)), 3);
  assert.equal(player.xpBySkill.Crafting, 9, '3 XP each at level 37');
  ticks(1);
  assert.equal(player.messages.at(-1), 'You have no more guardian fragments to combine.');
  const empty = fakePlayer('Empty');
  hooks.objects.Workbench['Work-at']({ player: empty, objectId: Shared.loc('gotr_workbench') });
  assert.match(statementText(empty), /at least one guardian fragment/);
  assert.equal(Workbench.craftingXp({ getSkillManager: () => ({ getMaxLevel: () => 5 }) }), 1);
  assert.equal(Workbench.craftingXp({ getSkillManager: () => ({ getMaxLevel: () => 99 }) }), 5);
});

test('a huge-remains portal opens at the captured tiles with its message', () => {
  const player = fakePlayer();
  openGame(player);
  Game._game.phase = Game.PHASE.ATTACK;
  Game._game.portal.opensIn = 1;
  ticks(1);
  const direction = Game.portal().direction;
  assert.ok(direction >= 1 && direction <= 4);
  assert.equal(player.messages.at(-1), `<col=ef1020>A portal to the huge guardian fragment mine has opened to the ${Portals.PORTALS[direction].name}!</col>`);
  ticks(44);
  assert.equal(Game.portal().direction, 0, 'open 44 ticks');
});

test('game items are refused by the bank', () => {
  const player = fakePlayer();
  const event = { player, item: { getId: () => Shared.obj(Shared.ITEM.ESSENCE) }, allow: null };
  for (const handler of hooks.canBankItem) handler(event);
  assert.equal(event.allow, false);
  assert.equal(player.messages.at(-1), 'A magical force prevents you from banking this item!');
});

// ------------------------------------------------------------------ essence pouches

function pouch(player, option, name = 'Colossal pouch') {
  const id = Shared.core().CacheDefinitions.getObjId({ 'Colossal pouch': 'rcu_pouch_colossal', 'Giant pouch': 'rcu_pouch_giant', 'Small pouch': 'rcu_pouch_small' }[name]);
  return hooks.items[name][option]({ player, itemId: id });
}

test('the native bank inventory Fill op fills and empties an essence pouch without banking it', t => {
  const core = PluginManager.getCoreApi(), { Bank } = core;
  const player = new Player(null);
  player.setUsername('bankpouch');
  t.mock.method(player, 'getSession', () => ({ sendClientPacket: () => true }));
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    for (const handler of hooks.custom[name] ?? []) handler(event);
  });
  player.getSkillManager().setMaxLevels(core.Skill.RUNECRAFTING, 99, false);
  const id = core.CacheDefinitions.getObjId('rcu_pouch_small');
  const essence = core.CacheDefinitions.getObjId('blankrune_high');
  assert.equal(core.CacheDefinitions.getItem(id).params.get(595), 'Fill', 'native cache bank action');
  player.getInventory().adds(id, 1).adds(essence, 3);
  player.setStatus(core.PlayerStatus.BANKING);
  player.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  const op = () => Bank.handleWidgetAction(player, { groupId: Bank.SIDE_INTERFACE_ID,
    childId: Bank.SIDE_ITEMS_CHILD, slot: 0, itemId: id, buttonNum: 9 });
  assert.equal(op(), true);
  assert.equal(player.getInventory().getAmount(essence), 0);
  assert.equal(player.getAttribute(Pouches.POUCHES_ATTRIBUTE).small.amount, 3);
  assert.equal(player.getInventory().getAmount(id), 1);
  assert.equal(player.getBank(0).getAmount(id), 0);
  assert.equal(Bank.isOpen(player), true);
  assert.equal(op(), true);
  assert.equal(player.getInventory().getAmount(essence), 3, 'the existing full-pouch action empties it');
  assert.equal(player.getAttribute(Pouches.POUCHES_ATTRIBUTE).small.amount, 0);
  player.setStatus(core.PlayerStatus.NONE);
  assert.equal(op(), false, 'the bank-only action cannot run after closing');
  assert.equal(player.getInventory().getAmount(essence), 3);
});

test('pouches hold one kind of essence, shown on their varbits; Fill empties a full pouch', () => {
  const player = fakePlayer('Pouch', { runecraft: 85 });
  const colossal = Shared.core().CacheDefinitions.getObjId('rcu_pouch_colossal');
  player.inventory.adds(colossal, 1);
  player.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 24);
  pouch(player, 'Fill');
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.ESSENCE)), 0);
  assert.equal(player.varbit('colossal_essence_pouch'), 24);
  assert.equal(player.varbit('colossal_essence_pouch_type'), 4, 'guardian essence');
  pouch(player, 'Check');
  assert.equal(player.messages.at(-1), 'There are twenty-four guardian essences in this pouch.');

  player.inventory.adds(7936, 3);
  pouch(player, 'Fill');
  assert.equal(player.messages.at(-1), 'The pouch contains guardian essence, so you can fill it only with more guardian essence.');
  player.inventory.delete(7936, 3);

  pouch(player, 'Fill');
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.ESSENCE)), 24, 'nothing to fill with: Fill empties');
  assert.equal(player.varbit('colossal_essence_pouch'), 0);
  assert.equal(player.varbit('colossal_essence_pouch_type'), 0);
  pouch(player, 'Empty');
  assert.equal(player.messages.at(-1), 'There is no essence in this pouch.');
  pouch(player, 'Fill');
  assert.equal(player.varbit('colossal_essence_pouch'), 24);
  for (const handler of hooks.custom['runecrafting:remove-guardian-essence']) handler({ player });
  assert.equal(player.varbit('colossal_essence_pouch'), 0, 'guardian essence never leaves the game');
});

test('emptying into a full inventory is a message box with synth 2277; the colossal pouch names its essence (rsprox 1840)', () => {
  const statement = (player) => player.statements.at(-1).getDialogues().get(0).getText();
  const player = fakePlayer('Full', { runecraft: 85 });
  const colossal = Shared.core().CacheDefinitions.getObjId('rcu_pouch_colossal');
  player.inventory.adds(colossal, 1);
  player.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 10);
  pouch(player, 'Fill');
  player.inventory.adds(995, 1);
  while (player.inventory.getFreeSlots() > 0) player.inventory.adds(1511, 1);
  const before = player.messages.length;
  pouch(player, 'Empty');
  assert.equal(statement(player), 'Your inventory is too full to hold any more guardian essence.');
  assert.ok(player.sounds.includes(2277));
  assert.equal(player.messages.length, before, 'no chat line');

  const small = fakePlayer('Small', { runecraft: 85 });
  small.inventory.adds(Shared.core().CacheDefinitions.getObjId('rcu_pouch_small'), 1);
  small.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 3);
  pouch(small, 'Fill', 'Small pouch');
  while (small.inventory.getFreeSlots() > 0) small.inventory.adds(1511, 1);
  pouch(small, 'Empty', 'Small pouch');
  assert.equal(statement(small), 'Your inventory is too full to hold any more essence.');
});

test('the colossal pouch holds 8/16/27/40 by Runecraft level, and pouches decay with use', () => {
  const capacity = (level) => Pouches._test.capacity(fakePlayer('L', { runecraft: level }), Pouches._test.pouchFor(Shared.core().CacheDefinitions.getObjId('rcu_pouch_colossal')));
  assert.deepEqual([24, 25, 50, 75, 85, 99].map(capacity), [0, 8, 16, 27, 40, 40]);

  const player = fakePlayer('Decay', { runecraft: 99 });
  const giant = Shared.core().CacheDefinitions.getObjId('rcu_pouch_giant');
  const degraded = Shared.core().CacheDefinitions.getObjId('rcu_pouch_giant_degrade');
  player.inventory.adds(giant, 1);
  for (let use = 0; use < 10; use++) {
    player.inventory.adds(7936, 12);
    pouch(player, 'Fill', 'Giant pouch');
    pouch(player, 'Empty', 'Giant pouch');
    player.inventory.delete(7936, 12);
  }
  assert.equal(player.inventory.getAmount(degraded), 1, 'Wiki: about 120 essence');
  assert.equal(player.messages.at(-1), 'Your pouch has decayed through use.');
  const request = { player, repaired: 0 };
  for (const handler of hooks.custom['runecrafting:repair-pouches']) handler(request);
  assert.equal(request.repaired, 1);
  assert.equal(player.inventory.getAmount(giant), 1);

  const caped = fakePlayer('Caped', { runecraft: 99 });
  caped.cape = true;
  caped.inventory.adds(giant, 1);
  for (let use = 0; use < 12; use++) {
    caped.inventory.adds(7936, 12);
    pouch(caped, 'Fill', 'Giant pouch');
    pouch(caped, 'Empty', 'Giant pouch');
    caped.inventory.delete(7936, 12);
  }
  assert.equal(caped.inventory.getAmount(giant), 1, 'a Runecraft cape stops decay');
});

test('old saves load: rune and pure essence keep their counts', () => {
  const player = fakePlayer('Old');
  player.setAttribute(Pouches.POUCHES_ATTRIBUTE, [
    { pouch: { itemId: Shared.core().CacheDefinitions.getObjId('rcu_pouch_small') }, runeEssenceAmt: 0, pureEssenceAmt: 3 },
  ]);
  pouch(player, 'Check', 'Small pouch');
  assert.equal(player.messages.at(-1), 'There are three pure essences in this pouch.');
});

// ------------------------------------------------------------------ phase 3: Portal Guardians and altars

const EARTH = Altars.ALTARS.find((altar) => altar.key === 'earth');
const BLOOD = Altars.ALTARS.find((altar) => altar.key === 'blood');

function attackPhase(player) {
  openGame(player);
  Game._game.phase = Game.PHASE.ATTACK;
  Game._game.altars = { elemental: EARTH.index, catalytic: BLOOD.index, changesIn: 33 };
}

function enter(player, altar) {
  return hooks.objects[`Guardian of ${altar.name}`].Enter({ player, objectId: Shared.loc(altar.guardian) });
}

test('a dormant Guardian, held stones and a missing quest keep the rift shut', () => {
  const player = fakePlayer();
  attackPhase(player);
  enter(player, Altars.ALTARS.find((altar) => altar.key === 'air'));
  assert.match(statementText(player), /The Guardian is dormant\. Its energy might return soon\./);
  enter(player, BLOOD);
  assert.match(statementText(player), /You must complete Sins of the Father before you can enter this rift\./);
  player.inventory.add(Shared.obj(Shared.ITEM.ELEMENTAL_STONE), 3);
  enter(player, EARTH);
  assert.match(hooks.dialogues.at(-1), /entering-a-portal-guardian-with-any-type-of-guardian-stone/);
  assert.equal(player.location.getY(), 9484, 'still in the temple');
});

test('an active Guardian takes the player to its altar and stays in the game; the portal brings them back', () => {
  const player = fakePlayer();
  attackPhase(player);
  enter(player, EARTH);
  ticks(2);
  assert.equal(player.messages.at(-1), 'You step through the rift and find yourself at the Earth Altar.');
  assert.deepEqual([player.location.getX(), player.location.getY()], [2655, 4830]);
  ticks(6);
  assert.equal(Game.isPlaying(player), true, 'an altar trip keeps the game');
  assert.equal(claimed(player, Shared.loc(EARTH.exit), 'Use'), true, 'the trip owns the exit portal');
  ticks(2);
  assert.equal(player.messages.at(-1), 'You step through the portal and find yourself back in the temple.');
  assert.deepEqual([player.location.getX(), player.location.getY()], [3615, 9491]);

  enter(player, EARTH);
  ticks(2);
  player.location = new Location(3222, 3218, 0);
  ticks(6);
  assert.equal(Game.isPlaying(player), false, 'teleporting away from the altar leaves the game');
});

test('a relog at the altar of a trip goes back to the lobby, not out through the ruins (issue 2698)', () => {
  const player = fakePlayer();
  attackPhase(player);
  enter(player, EARTH);
  ticks(2);
  assert.equal(player.getAttribute(Altars.TRIP_ATTRIBUTE), 'earth', 'the trip is saved');
  for (const handler of hooks.logout) handler({ player });
  assert.equal(Game.isPlaying(player), false, 'a logout ends the game');
  player.__gotrTrip = undefined; // a new session doesn't have the trip
  for (const handler of hooks.login) handler({ player });
  assert.deepEqual([player.location.getX(), player.location.getY()], [Shared.LOBBY_TILE.x, Shared.LOBBY_TILE.y]);
  assert.equal(player.getAttribute(Altars.TRIP_ATTRIBUTE), '');

  // Runecrafting there without the minigame keeps its login where it is.
  const crafter = fakePlayer('Crafter', { x: EARTH.arrival[0], y: EARTH.arrival[1] });
  for (const handler of hooks.login) handler({ player: crafter });
  assert.deepEqual([crafter.location.getX(), crafter.location.getY()], EARTH.arrival);

  // A trip that came back is forgotten.
  const returned = fakePlayer('Returned');
  attackPhase(returned);
  enter(returned, EARTH);
  ticks(2);
  assert.equal(claimed(returned, Shared.loc(EARTH.exit), 'Use'), true);
  ticks(2);
  assert.equal(returned.getAttribute(Altars.TRIP_ATTRIBUTE), '');
});

test('crafting guardian essence makes runes, a stone each, the XP and charges one cell to the altar tier', () => {
  const player = fakePlayer();
  attackPhase(player);
  player.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 10);
  player.inventory.add(Shared.obj(Shared.ITEM.UNCHARGED_CELL), 3);
  STACKABLE.add(557);
  player.__gotrTrip = EARTH;
  assert.equal(claimed(player, Shared.loc(EARTH.altar), 'Craft-rune'), true);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.ESSENCE)), 0);
  assert.equal(player.inventory.getAmount(557), 40);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.ELEMENTAL_STONE)), 10);
  assert.equal(player.inventory.getAmount(Shared.obj('gotr_cell_tier3')), 1, 'earth charges strong cells');
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.UNCHARGED_CELL)), 2);
  assert.ok(player.messages.includes('Your cell absorbs a high amount of excess energy.'));
  assert.equal(player.xpBySkill.Runecrafting, 65);

  player.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 5);
  claimed(player, Shared.loc(EARTH.altar), 'Craft-rune');
  assert.equal(player.inventory.getAmount(Shared.obj('gotr_cell_tier3')), 1, 'one charged cell at a time');
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.UNCHARGED_CELL)), 2);

  const outsider = fakePlayer('Outsider');
  outsider.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 1);
  outsider.__gotrTrip = EARTH;
  assert.equal(claimed(outsider, Shared.loc(EARTH.altar), 'Craft-rune'), false, 'outside a game it is plain Runecraft');
  const pure = fakePlayer('Pure');
  attackPhase(pure);
  pure.__gotrTrip = EARTH;
  pure.inventory.add(Shared.obj('blankrune_high'), 5);
  assert.equal(claimed(pure, Shared.loc(EARTH.altar), 'Craft-rune'), false, 'pure essence: Runecrafting crafts');
  const empty = fakePlayer('Empty');
  attackPhase(empty);
  empty.__gotrTrip = EARTH;
  assert.equal(claimed(empty, Shared.loc(EARTH.altar), 'Craft-rune'), true);
  assert.equal(empty.messages.at(-1), 'You do not have any guardian essence to bind here.', 'no essence at all (capture)');
});

test('a portal talisman opens its dormant Guardian and shatters; Toggle-talisman flips its varbit', () => {
  const player = fakePlayer();
  attackPhase(player);
  const air = Altars.ALTARS.find((altar) => altar.key === 'air');
  player.inventory.add(Shared.obj(air.talisman), 1);
  hooks.itemOnObject['Portal talisman (air)|Guardian of Air']({ player, objectId: Shared.loc(air.guardian), itemId: Shared.obj(air.talisman) });
  assert.equal(player.inventory.getAmount(Shared.obj(air.talisman)), 0);
  assert.equal(player.messages.at(-1), 'The portal talisman shatters and you find yourself at the altar it originated from.');
  ticks(2);
  assert.deepEqual([player.location.getX(), player.location.getY()], [2841, 4829]);

  hooks.objects['Guardian of Air']['Toggle-talisman']({ player: fakePlayer('Toggler'), objectId: Shared.loc(air.guardian) });
  const toggler = fakePlayer('Toggler2');
  hooks.objects['Guardian of Air']['Toggle-talisman']({ player: toggler, objectId: Shared.loc(air.guardian) });
  assert.equal(toggler.varbit(air.toggle), 1);
  assert.equal(Records.setting(toggler, air.toggle), 1);
});

// ------------------------------------------------------------------ phase 4: cells, barriers, rift guardians

const UNCHARGED = () => Shared.obj(Shared.ITEM.UNCHARGED_CELL);
const CELL = (tier) => Shared.obj(Shared.ITEM.CELLS[tier - 1]);

function place(player, tile) {
  const name = tile.broken ? 'Cell tile (broken)' : ['Inactive cell tile', 'Weak cell tile', 'Medium cell tile', 'Strong cell tile', 'Overpowered cell tile'][tile.tier];
  const option = tile.broken ? 'Repair' : 'Place-cell';
  return hooks.objects[name][option]({ player, location: { x: tile.x, y: tile.y, z: 0 } });
}

test('the cell tables: ten uncharged at most, one weak cell, a chisel; dropped cells are destroyed', () => {
  const player = fakePlayer();
  openGame(player);
  const uncharged = { player, objectId: Shared.loc('gotr_uncharged_cells') };
  hooks.objects['Uncharged cells']['Take-1'](uncharged);
  assert.equal(player.inventory.getAmount(UNCHARGED()), 1);
  hooks.objects['Uncharged cells']['Take-10'](uncharged);
  assert.equal(player.inventory.getAmount(UNCHARGED()), 10);
  hooks.objects['Uncharged cells']['Take-1'](uncharged);
  assert.match(statementText(player), /You can only carry ten of these at a time\./);
  const weak = { player, objectId: Shared.loc('gotr_weak_cells') };
  hooks.objects['Weak cells'].Take(weak);
  assert.equal(player.inventory.getAmount(CELL(1)), 1);
  hooks.objects['Weak cells']['Take-chisel'](weak);
  assert.equal(player.inventory.getAmount(Shared.obj('chisel')), 1);
  const drop = { player, itemId: UNCHARGED(), handled: false };
  for (const handler of hooks.drops) handler(drop);
  assert.equal(drop.handled, true);
  assert.equal(player.inventory.getAmount(UNCHARGED()), 0);
  assert.equal(player.messages.at(-1), 'The Uncharged cell is destroyed as you drop it.');
});

test('cells raise, strengthen and recharge barriers with the captured messages, energy and XP', () => {
  const player = fakePlayer();
  openGame(player);
  const tile = Cells.tiles[0];
  player.inventory.add(CELL(1), 1);
  place(player, tile);
  assert.equal(tile.tier, 1);
  assert.equal(tile.npc.getId(), Shared.npc('gotr_barrier_npc_tier1_large'));
  assert.equal(tile.npc.getHitpoints(), 50);
  assert.equal(player.varbit(Shared.VARBIT.ELEMENTAL_EARNED), 17, 'placing a weak cell: 17 of both');
  assert.equal(player.varbit(Shared.VARBIT.CATALYTIC_EARNED), 17);
  assert.equal(player.xpBySkill.Runecrafting, 30);

  player.inventory.add(CELL(3), 1);
  place(player, tile);
  assert.equal(tile.tier, 3);
  assert.equal(tile.npc.transform, Shared.npc('gotr_barrier_npc_tier3_large'));
  assert.equal(tile.npc.getHitpoints(), 200);
  assert.equal(player.messages.at(-1), 'The strong cell is consumed as it <col=ff0000>strengthens</col> the barrier.');
  assert.equal(player.varbit(Shared.VARBIT.ELEMENTAL_EARNED), 30, '+13');
  assert.equal(player.xpBySkill.Runecrafting, 30 + 190);

  tile.npc.setHitpoints(150);
  player.inventory.add(CELL(2), 1);
  place(player, tile);
  assert.equal(player.messages.at(-1), 'The medium cell is consumed as it <col=ff0000>recharges</col> the barrier.');
  assert.equal(tile.npc.getHitpoints(), 175);
  assert.equal(player.varbit(Shared.VARBIT.ELEMENTAL_EARNED), 35, '+5');
});

test('before the open an uncharged cell builds a weak barrier; nothing built before it pays (Wiki, 13 November 2024)', () => {
  const player = fakePlayer();
  barrier(player, 'Quick-pass');
  assert.equal(Game.phase(), Game.PHASE.LOBBY);
  const uncharged = Shared.obj(Shared.ITEM.UNCHARGED_CELL);
  const tile = Cells.tiles[0];
  player.inventory.add(uncharged, 2);
  place(player, tile);
  assert.equal(tile.tier, 1, 'an uncharged cell builds a weak barrier');
  assert.equal(player.inventory.getAmount(uncharged), 1);
  place(player, tile);
  assert.equal(player.inventory.getAmount(uncharged), 1, 'it only builds; strengthening takes a charged cell');
  assert.match(statementText(player), /You need a charged cell to place on the tile\./);
  player.inventory.add(CELL(2), 1);
  place(player, tile);
  assert.equal(tile.tier, 2, 'charged cells strengthen before the open too (rsprox captures)');
  assert.equal(player.xpBySkill.Runecrafting, undefined, 'no experience before the open');
  assert.equal(player.varbit(Shared.VARBIT.ELEMENTAL_EARNED), 0);

  Game._game.timer = 1;
  ticks(1);
  assert.equal(Game.phase(), Game.PHASE.PREPARE);
  assert.equal(tile.tier, 2, 'the barrier stands into the game');
  place(player, Cells.tiles[1]);
  assert.equal(Cells.tiles[1].tier, 0, 'once the rift is open an uncharged cell builds nothing');
  assert.equal(player.inventory.getAmount(uncharged), 1);
});

test('a new game keeps cells and takes fragments, essence, stones and talismans (Wiki; rsprox captures)', () => {
  const player = fakePlayer();
  barrier(player, 'Quick-pass');
  const uncharged = Shared.obj(Shared.ITEM.UNCHARGED_CELL);
  player.inventory.add(uncharged, 10);
  player.inventory.add(CELL(3), 1);
  player.inventory.add(Shared.obj(Shared.ITEM.FRAGMENTS), 5);
  player.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 3);
  player.inventory.add(Shared.obj(Shared.ITEM.CATALYTIC_STONE), 4);
  player.inventory.add(Shared.obj(EARTH.talisman), 1);
  Game._game.timer = 1;
  ticks(1);
  assert.equal(Game.phase(), Game.PHASE.PREPARE);
  assert.equal(player.inventory.getAmount(uncharged), 10, 'the capture: ten taken between games, ten after the open');
  assert.equal(player.inventory.getAmount(CELL(3)), 1);
  for (const item of [Shared.ITEM.FRAGMENTS, Shared.ITEM.ESSENCE, Shared.ITEM.CATALYTIC_STONE, EARTH.talisman]) {
    assert.equal(player.inventory.getAmount(Shared.obj(item)), 0, item);
  }
});

test("the lobby's 30-second line takes the last game's stones and mining count, not its cells (rsprox captures)", () => {
  const player = fakePlayer();
  openGame(player);
  const uncharged = Shared.obj(Shared.ITEM.UNCHARGED_CELL);
  player.inventory.add(uncharged, 10);
  player.inventory.add(Shared.obj(Shared.ITEM.CATALYTIC_STONE), 65);
  Shared.setVarbit(player, Shared.VARBIT.MINING_COUNT, 250);
  Game._game.phase = Game.PHASE.CLOSING;
  Game._game.timer = 1;
  ticks(1);
  assert.equal(Game.phase(), Game.PHASE.LOBBY);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.CATALYTIC_STONE)), 65, 'the close itself leaves them');
  ticks(4);
  assert.equal(player.messages.at(-1), 'The rift will become active in 30 seconds.');
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.CATALYTIC_STONE)), 0);
  assert.equal(player.varbit(Shared.VARBIT.MINING_COUNT), 0);
  assert.equal(player.inventory.getAmount(uncharged), 10);
});

test('the surge hits every barrier for 50; a broken tile takes 12 fragments to repair', () => {
  const player = fakePlayer();
  openGame(player);
  const tile = Cells.tiles[1];
  player.inventory.add(CELL(1), 1);
  place(player, tile);
  Game.setPower(60);
  ticks(1);
  assert.equal(tile.broken, true, '50 health: the surge breaks a weak barrier');
  assert.ok(player.messages.includes('<col=ef1020>A barrier has been destroyed!</col>'));
  assert.equal(tile.npc, null);
  place(player, tile);
  assert.match(statementText(player), /12 guardian fragments/);
  player.inventory.add(Shared.obj(Shared.ITEM.FRAGMENTS), 15);
  const before = player.varbit(Shared.VARBIT.ELEMENTAL_EARNED);
  place(player, tile);
  assert.equal(tile.broken, false);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.FRAGMENTS)), 3);
  assert.equal(player.varbit(Shared.VARBIT.ELEMENTAL_EARNED), before + 25);
});

test('assembling a guardian: the captured steps, the pile energy, and the limit', () => {
  const player = fakePlayer();
  openGame(player);
  const pile = { player, objectId: Shared.loc('gotr_guardian_spawn_east') };
  hooks.objects['Essence pile (elemental)'].Assemble(pile);
  assert.match(statementText(player), /chisel/);
  player.inventory.add(Shared.obj('chisel'), 1);
  hooks.objects['Essence pile (elemental)'].Assemble(pile);
  assert.match(statementText(player), /You will need a charged cell to power any rift guardians/);
  player.inventory.add(CELL(4), 1);
  hooks.objects['Essence pile (elemental)'].Assemble(pile);
  assert.equal(player.messages.at(-1), 'You scrape together what usable components you can find.');
  ticks(2);
  assert.equal(player.messages.at(-1), 'You carve out a place for the cell and carefully place it inside the guardian.');
  ticks(3);
  assert.equal(player.messages.at(-1), 'The powers of the overcharged cell extend into the essence. A Guardian comes to life.');
  assert.equal(hooks.npcsSpawned.at(-1).id, Shared.npc('gotr_guardian_fire'));
  assert.equal(player.varbit(Shared.VARBIT.ELEMENTAL_EARNED), 45);
  assert.equal(player.varbit(Shared.VARBIT.CATALYTIC_EARNED), 0, 'only the pile type');
  assert.equal(player.xpBySkill.Crafting, 80);
  assert.equal(player.xpBySkill.Runecrafting, 250);
  assert.equal(player.inventory.getAmount(CELL(4)), 0);

  // The limit reached while assembling: the cell is spent and the energy comes, but no guardian.
  player.inventory.add(CELL(1), 1);
  hooks.objects['Essence pile (elemental)'].Assemble(pile);
  RiftGuardians.guardians.add(fakeNpc({ id: Shared.npc('gotr_guardian_air'), x: 0, y: 0 }));
  ticks(5);
  assert.equal(player.messages.at(-1), 'The powers of the cell extend into the essence, but no guardian forms.');
  assert.equal(Game.stateOf(player).elemental, 45 + 6, 'the energy still comes');

  // At the limit already (solo capture: 2): refused at the pile, nothing taken.
  player.inventory.add(CELL(1), 1);
  const xp = player.xpBySkill.Crafting;
  hooks.objects['Essence pile (elemental)'].Assemble(pile);
  assert.equal(player.messages.at(-1), 'There are already enough rift guardians in the room.');
  ticks(5);
  assert.equal(player.inventory.getAmount(CELL(1)), 1, 'the cell is kept');
  assert.equal(player.xpBySkill.Crafting, xp, 'no XP');
});

test('the rift guardian limit: 2 solo (capture), one more a player, 10 at most (Wiki)', () => {
  const player = fakePlayer();
  openGame(player);
  assert.equal(Game.riftGuardianCap(), 2);
  assert.equal(player.lastHud()[8], 2, 'the HUD shows the limit');
  const others = Array.from({ length: 30 }, (_, i) => fakePlayer(`Other ${i}`));
  for (const other of others.slice(0, 3)) Game._game.players.set(other, Game.stateOf(player));
  assert.equal(Game.riftGuardianCap(), 5);
  for (const other of others) Game._game.players.set(other, Game.stateOf(player));
  assert.equal(Game.riftGuardianCap(), 10);
  for (const other of others) Game._game.players.delete(other);
});

test('at full power every rift guardian goes, and the close resets the tiles', () => {
  const player = fakePlayer();
  openGame(player);
  player.inventory.add(CELL(2), 1);
  place(player, Cells.tiles[3]);
  RiftGuardians.guardians.add(fakeNpc({ id: Shared.npc('gotr_guardian_air'), x: 0, y: 0 }));
  Game.setPower(100);
  assert.equal(RiftGuardians.alive(), 0);
  ticks(32);
  assert.ok(Cells.tiles.every((tile) => tile.tier === 0 && !tile.npc && !tile.broken));
});

// ------------------------------------------------------------------ phase 5: creatures

test('creature batches grow through the game, as captured solo and on a busy world', () => {
  // Captured solo: 1, 2, 2, 2, 3, 4, 4, 4; a world of hundreds: 15, 16, 19, 20, 18, 20, 22, 24, 26.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((wave) => Creatures.batchSize(1, wave)), [1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual([0, 4, 8].map((wave) => Creatures.batchSize(353, wave)), [15, 20, 25]);
  assert.equal(Creatures.batchSize(2000, 40), 30, 'at most 30');
  const count = (kinds, kind) => kinds.filter((k) => k === kind).length;
  assert.deepEqual(Creatures.batchKinds(1, 0, false), ['leech']);
  assert.equal(count(Creatures.batchKinds(1, 3, false), 'guardian'), 0, 'solo: no abyssal guardians before the fifth wave');
  assert.equal(count(Creatures.batchKinds(1, 4, false), 'guardian'), 1);
  const busy = Creatures.batchKinds(353, 0, false);
  assert.equal(count(busy, 'walker'), 2, 'a busy first batch has two walkers');
  assert.equal(count(busy, 'leech'), 13, 'mostly leeches');
  assert.ok(count(Creatures.batchKinds(353, 2, false), 'guardian') >= 1, 'busy: guardians from the third');
  assert.equal(Creatures.gap({ x: 3604, y: 9505 }, 1, { x: 3605, y: 9502 }, 3), 1, 'touching a 3x3 barrier');
  assert.equal(Creatures.gap({ x: 3615, y: 9522 }, 1, { x: 3613, y: 9501 }, 5), 17);
});

test('the attack sends a batch out of the rift, and one every 76 ticks after', () => {
  const player = fakePlayer();
  openGame(player);
  Game._game.elapsed = 199;
  const before = hooks.npcsSpawned.length;
  ticks(1);
  const first = hooks.npcsSpawned.slice(before);
  assert.equal(first.length, 1, 'solo: one leech first');
  assert.ok(first.every((npc) => npc.flags.has('combat:no-regen')));
  assert.ok(first.every((npc) => npc.y >= 9522 && npc.y <= 9525), 'out of the rift');
  ticks(75);
  assert.equal(hooks.npcsSpawned.length - before, 1);
  ticks(1);
  assert.equal(hooks.npcsSpawned.length - before, 2);
  ticks(76);
  assert.equal(hooks.npcsSpawned.length - before, 4, 'the third batch is two');
});

test('a creature beside a barrier hits it; with none standing it drains the Great Guardian', () => {
  const player = fakePlayer();
  openGame(player);
  player.inventory.add(CELL(1), 1);
  place(player, Cells.tiles[0]);
  Game._game.phase = Game.PHASE.ATTACK;
  const walker = fakeNpc({ id: Shared.npc('gotr_abyssal_walker'), x: 3604, y: 9505 });
  Creatures.creatures.set(walker, { kind: 'walker', nextAttack: 0, attacker: null });
  const barrier = Cells.tiles[0].npc;
  const random = Math.random;
  Math.random = () => 0.1;
  try {
    ticks(1);
    assert.equal(barrier.getHitpoints(), 49, 'a walker hit');
    assert.ok(walker.animations.includes(Shared.seq('gotr_abyssal_walker_attack')));
    ticks(3);
    assert.equal(barrier.getHitpoints(), 49, 'every 4 ticks');
    ticks(1);
    assert.equal(barrier.getHitpoints(), 48);
    barrier.hp = 0;
    ticks(1);
    assert.equal(Cells.tiles[0].broken, true, 'a dead barrier NPC breaks its tile');

    walker.x = 3615; walker.y = 9506;
    Game._game.power = 100;
    ticks(4);
    assert.equal(Game._game.power, 97, 'a walker drains 3 (solo captures: splat 5-6)');
  } finally {
    Math.random = random;
  }
});

test('rift guardians hit the nearest creature, and that creature turns on them', () => {
  const player = fakePlayer();
  openGame(player);
  Game._game.phase = Game.PHASE.ATTACK;
  const guardian = fakeNpc({ id: Shared.npc('gotr_guardian_blood'), x: 3610, y: 9512 });
  guardian.__gotrTier = 4;
  guardian.__gotrNextAttack = 0;
  RiftGuardians.guardians.add(guardian);
  const leech = fakeNpc({ id: Shared.npc('gotr_abyssal_leech'), x: 3611, y: 9517 });
  Creatures.creatures.set(leech, { kind: 'leech', nextAttack: Infinity, attacker: null });
  const random = Math.random;
  Math.random = () => 0.1;
  try {
    ticks(1);
  } finally {
    Math.random = random;
  }
  assert.ok(guardian.animations.includes(Shared.seq('rift_guardian_attack_ranged')), 'two tiles off: ranged');
  assert.equal(leech.getHitpoints(), 4);
  assert.equal(Creatures.creatures.get(leech).attacker, guardian, 'the leech fights back');
});

test('elemental rift guardians only fight beside a creature (capture 1840)', () => {
  const player = fakePlayer();
  openGame(player);
  Game._game.phase = Game.PHASE.ATTACK;
  const guardian = fakeNpc({ id: Shared.npc('gotr_guardian_fire'), x: 3610, y: 9512 });
  guardian.__gotrTier = 4;
  guardian.__gotrNextAttack = 0;
  RiftGuardians.guardians.add(guardian);
  const leech = fakeNpc({ id: Shared.npc('gotr_abyssal_leech'), x: 3611, y: 9517 });
  Creatures.creatures.set(leech, { kind: 'leech', nextAttack: Infinity, attacker: null });
  ticks(1);
  assert.equal(guardian.animations.length, 0, 'still walking at two tiles off');
  assert.equal(leech.getHitpoints(), 5);
});

test('a rift guardian goes after a creature across the temple, not only within 10 tiles (issue 2698)', t => {
  const player = fakePlayer();
  openGame(player);
  Game._game.phase = Game.PHASE.ATTACK;
  const guardian = fakeNpc({ id: Shared.npc('gotr_guardian_fire'), x: 3626, y: 9516 });
  guardian.__gotrTier = 4;
  guardian.__gotrNextAttack = 0;
  RiftGuardians.guardians.add(guardian);
  const leech = fakeNpc({ id: Shared.npc('gotr_abyssal_leech'), x: 3606, y: 9503 });
  Creatures.creatures.set(leech, { kind: 'leech', nextAttack: Infinity, attacker: null });
  const routes = [];
  t.mock.method(Shared.core().PathFinder, 'calculateWalkRoute', (npc, x, y) => routes.push([npc, x, y]));
  ticks(1);
  assert.ok(routes.some(([npc, x, y]) => npc === guardian && x === 3606 && y === 9503), 'walks at the far leech');
});

test('full power kills every creature', () => {
  const player = fakePlayer();
  openGame(player);
  Game._game.phase = Game.PHASE.ATTACK;
  const leech = fakeNpc({ id: Shared.npc('gotr_abyssal_leech'), x: 3611, y: 9515 });
  Creatures.creatures.set(leech, { kind: 'leech', nextAttack: 0, attacker: null });
  Game.setPower(100);
  assert.equal(leech.getHitpoints(), 0);
  assert.equal(Creatures.creatures.size, 0);
});

// ------------------------------------------------------------------ phase 6: rewards

function rift(player, option) {
  return hooks.objects['<col=ffff00>Rewards Guardian</col>'][option]({ player, objectId: Shared.loc('gotr_reward_rift') });
}

test('below 300 energy the close says so, with no points, no XP and no rift counted (capture)', () => {
  const player = fakePlayer();
  openGame(player);
  Game.stateOf(player).elemental = 150;
  Game.stateOf(player).catalytic = 140;
  const rifts = Records.riftsClosed(player);
  Game.setPower(100);
  ticks(32);
  const close = player.messages.slice(player.messages.findIndex((m) => m.includes('successfully closed the rift')));
  assert.deepEqual(close.slice(1), [
    'You did not contribute enough to attune any elemental or catalytic energy.',
    'The Portal Guardians will keep their rifts open for another 30 seconds.',
  ]);
  assert.equal(Records.riftsClosed(player), rifts);
  assert.ok(!player.messages.some((message) => message.includes('bonus Runecraft XP')));
});

test('Check counts the points and searches; Search takes one reward every 3 ticks until they run out', t => {
  t.mock.method(Math, 'random', () => 0.5);
  const player = fakePlayer();
  Records.setPoints(player, 2, 3);
  Records.addSearches(player, 4001);
  rift(player, 'Check');
  assert.match(statementText(player), /You have 3 catalytic energy and 2 elemental energy\. You can use them to search the rift 2 times\. You have searched the rift 4,001 times\./);
  for (let i = 0; i < 28; i++) player.inventory.slots[i] = null;
  rift(player, 'Search');
  ticks(3);
  assert.equal(Records.searches(player), 4001);
  ticks(1);
  assert.equal(Records.searches(player), 4002, 'the first reward three ticks after the animation');
  assert.ok(player.messages.some((message) => message.startsWith('You found some loot: ')));
  ticks(3);
  assert.equal(Records.searches(player), 4003);
  assert.deepEqual(Records.points(player), { elemental: 0, catalytic: 1 });
  assert.match(statementText(player), /There doesn't seem to be anything else in the rift for you\./);
  rift(player, 'Search');
  assert.match(statementText(player), /There doesn't seem to be anything in the rift for you\./);
});

test('Big-search takes up to five at once', () => {
  const player = fakePlayer();
  Records.setPoints(player, 7, 7);
  rift(player, 'Big-search');
  ticks(4);
  assert.deepEqual(Records.points(player), { elemental: 2, catalytic: 2 });
});

test('the reward tables: a missing pouch first, the weights add up, once-only items stay once', () => {
  const data = RewardsGuardian.DATA;
  assert.equal(data.search.main.reduce((sum, entry) => sum + entry.weight, 0), data.search.total);
  assert.equal(data.search.talismans.entries.reduce((sum, entry) => sum + entry.weight, 0), data.search.talismans.total);
  assert.equal(data.intricatePouch.main.reduce((sum, entry) => sum + entry.weight, 0), data.intricatePouch.total);
  const player = fakePlayer();
  assert.equal(RewardsGuardian.missingPouch(player), 'rcu_pouch_small');
  player.inventory.add(Shared.obj('rcu_pouch_small'), 1);
  assert.equal(RewardsGuardian.missingPouch(player), 'rcu_pouch_medium');
  for (const name of [...data.search.pouches, 'abyssal_pearl']) Shared.obj(name);
  for (let i = 0; i < 200; i++) for (const reward of RewardsGuardian.rollSearch(player)) assert.ok(Shared.obj(reward.item) > 0);
  Records.setSetting(player, 'gotr_book_obtained', 1);
  const random = Math.random;
  Math.random = () => 0;
  try {
    assert.notEqual(RewardsGuardian.rollSearch(player)[0].item, 'gotr_book', 'the diary only once');
  } finally {
    Math.random = random;
  }
});

test('the intricate pouch needs two free slots and gives its loot', () => {
  const player = fakePlayer();
  player.inventory.add(Shared.obj('gotr_intricate_pouch'), 1);
  for (let i = 1; i < 27; i++) player.inventory.slots[i] = { id: 1, amount: 1 };
  hooks.items['Intricate pouch'].Open({ player });
  assert.equal(player.messages.at(-1), 'You need at least two free inventory spaces to open this pouch.');
  player.inventory.slots[26] = null;
  hooks.items['Intricate pouch'].Open({ player });
  assert.equal(player.inventory.getAmount(Shared.obj('gotr_intricate_pouch')), 0);
  assert.match(statementText(player), /You open the intricate pouch and find something inside!/);
});

test("Felix's shop row follows the player's quests; Cordelia unlocks repairs for 25 pearls and repairs for 1", () => {
  const player = fakePlayer();
  QUESTS_DONE.clear();
  QUESTS_DONE.add('temple_of_the_eye');
  assert.equal(Apprentices.shopFor(player), 'gotr_reward_shop_none');
  QUESTS_DONE.add('troll_stronghold');
  QUESTS_DONE.add('sins_of_the_father');
  assert.equal(Apprentices.shopFor(player), 'gotr_reward_shop_law_blood');
  QUESTS_DONE.add('mournings_end_part_ii');
  assert.equal(Apprentices.shopFor(player), 'gotr_reward_shop_all');
  hooks.npcs['Apprentice Felix'].Trade({ player, npcId: Shared.npc('gotr_reward_trader') });
  assert.equal(hooks.shops.at(-1), 'gotr_reward_shop_all');

  const cordelia = Shared.npc('gotr_cordelia_1op');
  hooks.npcs['Apprentice Cordelia']['Talk-to']({ player, npcId: cordelia });
  assert.equal(hooks.dialogues.at(-1), 'initial-dialogue');
  const answer = (stepId) => hooks.conditions.map((handler) => handler({ npcId: cordelia, player, stepId })).find((value) => value !== null);
  assert.equal(answer('ppW0Jx'), true, 'no pearls yet');
  Records.addPearls(player, 30);
  assert.equal(answer('3bGUch'), true);
  for (const handler of hooks.custom['npc-dialogue:action']) handler({ npcId: cordelia, player, stepId: 'Q4yVuM' });
  assert.equal(Records.pearls(player), 5);
  assert.equal(player.varbit('gotr_cordelia_repair_pouch'), 1);
  hooks.npcs['Apprentice Cordelia']['Talk-to']({ player, npcId: cordelia });
  assert.equal(hooks.dialogues.at(-1), 'subsequent-dialogue');
  player.inventory.add(Shared.obj('rcu_pouch_giant_degrade'), 1);
  hooks.npcs['Apprentice Cordelia'].Repair({ player, npcId: Shared.npc('gotr_cordelia_2ops') });
  assert.equal(player.inventory.getAmount(Shared.obj('rcu_pouch_giant')), 1);
  assert.equal(Records.pearls(player), 4);
});

test('the abyssal needle stitches the four pouches into a colossal pouch', () => {
  const player = fakePlayer('Stitcher', { runecraft: 85 });
  for (const pouch of ['rcu_pouch_small', 'rcu_pouch_medium', 'rcu_pouch_large', 'rcu_pouch_giant']) player.inventory.add(Shared.obj(pouch), 1);
  player.levels.Crafting = 50;
  const stitch = hooks.itemOnItem['Abyssal needle|Giant pouch'];
  stitch({ player });
  assert.equal(player.messages.at(-1), 'You need level 56 Crafting to even attempt stitching these together.');
  player.levels.Crafting = 56;
  stitch({ player });
  assert.equal(player.inventory.getAmount(Shared.obj('rcu_pouch_colossal')), 1);
  assert.equal(player.inventory.getAmount(Shared.obj('rcu_pouch_giant')), 0);
  assert.deepEqual(player.messages.slice(-2), ['You attempt to stitch together all of the pouches.', 'Your colossal pouch can hold 40 essence.']);
  assert.equal(player.xpBySkill.Crafting, 1000);
});

// ------------------------------------------------------------------ review fixes

test('a player leaving lowers the maximum without winning the game for the rest', () => {
  const stayer = fakePlayer('Stayer');
  const leaver = fakePlayer('Leaver');
  barrier(leaver, 'Quick-pass');
  openGame(stayer);
  Game._game.phase = Game.PHASE.ATTACK;
  Game._game.power = 400;
  assert.equal(Game._game.maxPower, 500);
  barrier(leaver, 'Quick-pass');
  assert.equal(Game._game.maxPower, 250);
  assert.equal(Game._game.power, 250, 'clamped to the new maximum');
  Game.addPower(-1);
  assert.equal(Game.phase(), Game.PHASE.ATTACK, 'a creature hit is no win');
  Game.addPower(1);
  assert.equal(Game.phase(), Game.PHASE.CHARGED, 'a stone fed completes it');
});

test('an empty temple holds the lobby at 30 seconds; the first player in starts the countdown', () => {
  Game._game.timer = 52;
  ticks(10);
  assert.equal(Game.phase(), Game.PHASE.LOBBY);
  assert.equal(Game._game.timer, 50);
  const player = fakePlayer();
  barrier(player, 'Quick-pass');
  ticks(1);
  assert.equal(player.messages.at(-1), 'The rift will become active in 30 seconds.');
  ticks(49);
  assert.equal(Game.phase(), Game.PHASE.PREPARE);
});

test('a search that would not fit gives nothing and keeps its points', () => {
  const player = fakePlayer();
  Records.setPoints(player, 3, 3);
  for (let i = 0; i < 28; i++) player.inventory.slots[i] = { id: 1, amount: 1 };
  const random = Math.random;
  Math.random = () => 0; // a rare/main roll that needs a slot
  try {
    rift(player, 'Search');
    ticks(5);
  } finally {
    Math.random = random;
  }
  assert.deepEqual(Records.points(player), { elemental: 3, catalytic: 3 });
  assert.ok(!player.messages.some((message) => message.startsWith('You found some loot')));
});

// ------------------------------------------------------------------ issue 1986

test('Craft-rune with no essence still charges an uncharged cell, and upgrades a weaker one', () => {
  const player = fakePlayer();
  attackPhase(player);
  player.__gotrTrip = EARTH;
  player.inventory.add(UNCHARGED(), 2);
  assert.equal(claimed(player, Shared.loc(EARTH.altar), 'Craft-rune'), true);
  assert.equal(player.inventory.getAmount(CELL(3)), 1);
  assert.equal(player.inventory.getAmount(UNCHARGED()), 1);
  assert.ok(player.messages.includes('Your cell absorbs a high amount of excess energy.'));
  assert.equal(claimed(player, Shared.loc(EARTH.altar), 'Craft-rune'), true, 'a strong cell held: nothing to charge');
  assert.equal(player.messages.at(-1), 'You do not have any guardian essence to bind here.', 'as captured at the nature altar');
  assert.equal(player.inventory.getAmount(UNCHARGED()), 1, 'the uncharged cell stays');

  const weak = fakePlayer('Weak');
  attackPhase(weak);
  weak.__gotrTrip = EARTH;
  weak.inventory.add(UNCHARGED(), 1);
  weak.inventory.add(CELL(1), 1);
  claimed(weak, Shared.loc(EARTH.altar), 'Craft-rune');
  assert.equal(weak.inventory.getAmount(CELL(1)), 0, 'the weak cell is replaced');
  assert.equal(weak.inventory.getAmount(CELL(3)), 1);
});

test('Enter on a dormant Guardian uses its held talisman; a Guardian that closes during the step turns the player back', () => {
  const player = fakePlayer();
  attackPhase(player);
  const air = Altars.ALTARS.find((altar) => altar.key === 'air');
  player.inventory.add(Shared.obj(air.talisman), 1);
  enter(player, air);
  assert.equal(player.inventory.getAmount(Shared.obj(air.talisman)), 0);
  ticks(2);
  assert.deepEqual([player.location.getX(), player.location.getY()], [2841, 4829]);

  const late = fakePlayer('Late');
  attackPhase(late);
  const start = [late.location.getX(), late.location.getY()];
  enter(late, EARTH);
  Game._game.altars = { elemental: 1, catalytic: BLOOD.index, changesIn: 33 };
  ticks(2);
  assert.deepEqual([late.location.getX(), late.location.getY()], start, 'still in the temple');
  assert.equal(late.__gotrTrip, null);
  assert.match(statementText(late), /The Guardian is dormant/);
});

test('assembling holds the player: clicking elsewhere cannot cancel it', () => {
  const player = fakePlayer();
  openGame(player);
  player.inventory.add(Shared.obj('chisel'), 1);
  player.inventory.add(CELL(1), 1);
  const pile = { player, objectId: Shared.loc('gotr_guardian_spawn_east') };
  hooks.objects['Essence pile (elemental)'].Assemble(pile);
  assert.equal(player.blocked, true);
  Shared.stopAction(player);
  hooks.objects['Essence pile (elemental)'].Assemble(pile);
  ticks(5);
  assert.equal(player.messages.at(-1), 'The powers of the weak cell extend into the essence. A Guardian comes to life.');
  assert.equal(player.blocked, false);
});

test('dropping guardian essence destroys the one dropped', () => {
  const player = fakePlayer();
  openGame(player);
  player.inventory.adds(Shared.obj(Shared.ITEM.ESSENCE), 3);
  const slot = player.inventory.slots.findIndex((item) => item?.id === Shared.obj(Shared.ITEM.ESSENCE));
  const drop = { player, itemId: Shared.obj(Shared.ITEM.ESSENCE), slot, handled: false };
  for (const handler of hooks.drops) handler(drop);
  assert.equal(drop.handled, true);
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.ESSENCE)), 2);
  assert.equal(player.messages.at(-1), 'The Guardian essence is destroyed as you drop it.');
});

test('leaving and rejoining keeps the mining count, so the 250 still stops the XP', () => {
  const player = fakePlayer();
  openGame(player);
  Game.stateOf(player).mined = 250;
  barrier(player, 'Quick-pass');
  barrier(player, 'Quick-pass');
  assert.equal(Game.stateOf(player).mined, 250);
  assert.equal(player.varbit(Shared.VARBIT.MINING_COUNT), 250);
});

test("a hit on the Great Guardian drains the same share of a bigger game's power", () => {
  const player = fakePlayer();
  openGame(player);
  assert.equal(Creatures.drainOf(Creatures.KINDS.leech), 1, 'solo: 1 of 250');
  assert.equal(Creatures.drainOf(Creatures.KINDS.walker), 3, 'solo: 3 of 250');
  Game._game.maxPower = Game.maxPowerFor(10);
  assert.equal(Creatures.drainOf(Creatures.KINDS.walker), 30, 'ten players: 30 of 2,500');
});

test('recharging a barrier shows a heal splat, so its health bar shows', () => {
  const player = fakePlayer();
  openGame(player);
  const tile = Cells.tiles[1];
  player.inventory.add(CELL(1), 1);
  place(player, tile);
  tile.npc.hp -= 20;
  player.inventory.add(CELL(1), 1);
  place(player, tile);
  assert.equal(tile.npc.splats.at(-1), 10, 'a weak cell heals 10');
});

test('the Great Guardian sleeps after the close and wakes as the rift opens', () => {
  const player = fakePlayer();
  openGame(player);
  const guardian = fakeNpc({ id: Shared.npc(Shared.NPC.GREAT_GUARDIAN), x: 3613, y: 9501 });
  const { World } = Shared.core();
  const getNpcs = World.getNpcs;
  World.getNpcs = () => [guardian];
  try {
    Game.setPower(100);
    const closedRift = () => player.messages.some((m) => m.includes('successfully closed the rift'));
    for (let i = 0; i < 40 && !closedRift(); i++) ticks(1);
    assert.ok(closedRift());
    assert.ok(!guardian.animations.includes(Shared.seq('portal_guardian_sleep')), 'not on the close itself');
    // Live: 3 ticks after the close. ticks() runs Game.tick outside the task loop, so a
    // Shared.later(3) from it lands on the second tick here (the server's tick is itself a task).
    ticks(1);
    assert.ok(!guardian.animations.includes(Shared.seq('portal_guardian_sleep')));
    ticks(1);
    assert.equal(guardian.animations.at(-1), Shared.seq('portal_guardian_sleep'), 'later(3) after the close');
    ticks(1);
    assert.equal(guardian.animations.at(-1), Shared.seq('portal_guardian_sleep_loop'), 'then the loop every tick');
    const loops = guardian.animations.length;
    ticks(3);
    assert.equal(guardian.animations.length, loops + 3);
    Game.skip();
    ticks(60);
    Game.skip();
    ticks(1);
    assert.ok(guardian.animations.includes(Shared.seq('portal_guardian_wakeup')));
  } finally {
    World.getNpcs = getNpcs;
  }
});

test('Felix buys dyes and lanterns the player holds, and sells a lantern for 1,500 pearls', () => {
  const player = fakePlayer();
  const felix = Shared.npc('gotr_reward_trader');
  const answer = (stepId) => hooks.conditions.map((handler) => handler({ npcId: felix, player, stepId })).find((value) => value !== null);
  const act = (stepId) => {
    const request = { npcId: felix, player, stepId, handled: false };
    for (const handler of hooks.custom['npc-dialogue:action']) handler(request);
    return request;
  };
  assert.equal(answer(Apprentices.FELIX.HOLDING_DYE_OR_LANTERN), false);
  assert.equal(answer(Apprentices.FELIX.HAS_LANTERN), false);
  assert.equal(act(Apprentices.FELIX.SOLD_LANTERN).handled, true, 'no lantern: no sale and no line');
  assert.equal(Records.pearls(player), 0);

  player.inventory.add(Shared.obj('abyssal_lantern_yew'), 1);
  player.inventory.add(Shared.obj('abyssal_red_dye'), 1);
  assert.equal(answer(Apprentices.FELIX.HAS_LANTERN), true);
  assert.equal(answer('qggrYW'), true, 'red dye held');
  assert.equal(answer('qkLWJl'), false, 'no green dye');
  act(Apprentices.FELIX.SOLD_LANTERN);
  act('XJI400');
  assert.equal(Records.pearls(player), 150);
  assert.equal(player.inventory.getAmount(Shared.obj('abyssal_lantern_yew')), 0);

  assert.equal(answer(Apprentices.FELIX.ENOUGH_FOR_LANTERN), false);
  Records.addPearls(player, 1350);
  assert.equal(answer(Apprentices.FELIX.ENOUGH_FOR_LANTERN), true);
  act(Apprentices.FELIX.BUY_LANTERN);
  assert.equal(player.inventory.getAmount(Shared.obj('abyssal_lantern')), 1);
  assert.equal(Records.pearls(player), 0);
});

test("the intricate pouch's box shows what was inside; Atlax's diary has a Read option", () => {
  const player = fakePlayer();
  player.inventory.add(Shared.obj('gotr_intricate_pouch'), 1);
  hooks.items['Intricate pouch'].Open({ player });
  const box = [...player.statements.at(-1).dialogues.values()][0];
  assert.notEqual(box.itemId, Shared.obj('gotr_intricate_pouch'));
  assert.equal(typeof hooks.items["Atlax's diary"]?.Read, 'function');
});

// ------------------------------------------------------------------ issue 1986: the live captures

test("Atlax's diary: the captured 24 pages in indexed_book (680), with a contents page that jumps", () => {
  const Diary = require('../plugins/minigames/data/atlax-diary');
  const QuestRuntime = require('../plugins/quests/QuestRuntime');
  assert.equal(Diary.spreads.length, 12, '24 pages');
  assert.equal(Diary.spreads[0][1][2], 'We arrived at the site today.');
  assert.equal(Diary.spreadOf('Bennath 15th'), 0);
  assert.equal(Diary.spreadOf('Bennath 23rd'), 10);

  const buttons = new Map();
  const api = new Proxy({ core: PluginManager.getCoreApi() }, {
    get: (target, key) => (key in target ? target[key]
      : key === 'onInterfaceActionButton' ? (ids, handler) => ids.forEach((id) => buttons.set(id, handler))
        : () => {}),
  });
  QuestRuntime.registerQuestWidgets(api);
  const strings = new Map();
  const hidden = new Map();
  const player = fakePlayer();
  const packet = {
    sendInterface: (id) => { player.interfaces.push(id); return packet; },
    sendString: (text, uid) => { strings.set(uid & 0xffff, text); return packet; },
    sendInterfaceDisplayState: (uid, hide) => { hidden.set(uid & 0xffff, hide); return packet; },
    sendInterfaceScript: () => packet,
  };
  player.getPacketSender = () => packet;
  hooks.items["Atlax's diary"].Read({ player });
  assert.equal(player.interfaces.at(-1), 680);
  assert.ok(player.animations.includes(Shared.seq('human_readbook')));
  assert.equal(strings.get(6), "Atlax's Diary");
  assert.equal(strings.get(45), '<u>Entries</u>');
  assert.equal(strings.get(79), 'Bennath 15th', 'a contents entry in its index component');
  assert.equal(hidden.get(79), false);
  assert.equal(hidden.get(77), true, 'no entry on the first line');
  assert.equal(strings.get(63), 'We arrived at the site today.');
  assert.equal(hidden.get(108), true, 'no previous page on the first spread');
  assert.equal(hidden.get(9), true, 'no index button on the contents');

  const click = (child) => buttons.get((680 << 16) | child)({ player, buttonId: (680 << 16) | child });
  click(110);
  assert.equal(strings.get(10), '3');
  assert.equal(strings.get(45), "battle, but now there's just a");
  assert.equal(hidden.get(9), false, 'the index button past the contents');
  click(9);
  assert.equal(strings.get(10), '1');
  click(87);
  assert.equal(strings.get(61), '<u>Bennath 23rd</u>', 'the last entry opens its spread');
  assert.equal(strings.get(10), '21');
});

test('a loss: the captured lines, then the Great Guardian sleeps a tick later', () => {
  const player = fakePlayer();
  openGame(player);
  const guardian = fakeNpc({ id: Shared.npc(Shared.NPC.GREAT_GUARDIAN), x: 3613, y: 9501 });
  const { World } = Shared.core();
  const getNpcs = World.getNpcs;
  World.getNpcs = () => [guardian];
  try {
    Game._game.phase = Game.PHASE.ATTACK;
    Game.addPower(-Game._game.power);
    assert.deepEqual(player.messages.slice(-2), [
      '<col=ef1020>The Great Guardian was defeated!</col>',
      'The Portal Guardians will keep their rifts open for another 30 seconds.',
    ]);
    assert.ok(!guardian.animations.includes(Shared.seq('portal_guardian_sleep')));
    ticks(1);
    assert.equal(guardian.animations.at(-1), Shared.seq('portal_guardian_sleep'), 'no death animation, just sleep');
  } finally {
    World.getNpcs = getNpcs;
  }
});

test('a creature hitting the Great Guardian shows splat 17 without a health bar', () => {
  const player = fakePlayer();
  openGame(player);
  const guardian = fakeNpc({ id: Shared.npc(Shared.NPC.GREAT_GUARDIAN), x: 3613, y: 9501 });
  const shown = [];
  guardian.showHitsplat = (damage, splat, health) => shown.push({ damage, splat, health });
  const { World } = Shared.core();
  const getNpcs = World.getNpcs;
  World.getNpcs = () => [guardian];
  try {
    Game._game.phase = Game.PHASE.ATTACK;
    Game._game.power = 100;
    const leech = fakeNpc({ id: Shared.npc('gotr_abyssal_leech'), x: 3615, y: 9506 });
    Creatures.creatures.set(leech, { kind: 'leech', nextAttack: 0, attacker: null });
    ticks(1);
    assert.equal(Game._game.power, 99);
    assert.ok([1, 2].includes(shown.at(-1).damage), 'a leech shows 1-2');
    assert.deepEqual(shown.at(-1).splat, { mine: 17, others: 17 });
    assert.equal(shown.at(-1).health, false);
  } finally {
    World.getNpcs = getNpcs;
    Creatures.clear();
  }
});

test('repairing a broken tile: the captured refusal and success lines', () => {
  const player = fakePlayer();
  openGame(player);
  const tile = Cells.tiles[2];
  tile.broken = true;
  const repair = () => hooks.objects['Cell tile (broken)'].Repair({ player, objectId: Shared.loc('gotr_cell_tile_broken_repairable'), location: { x: tile.x, y: tile.y } });
  repair();
  assert.match(statementText(player), /It looks like you'll need 12 guardian fragments to repair this\./);
  player.inventory.add(Shared.obj(Shared.ITEM.FRAGMENTS), 13);
  repair();
  assert.equal(player.messages.at(-1), 'The magical power of the guardian essence restores the cell tile. It can now fit a charged cell again.');
  assert.equal(player.inventory.getAmount(Shared.obj(Shared.ITEM.FRAGMENTS)), 1);
  assert.equal(tile.broken, false);
});
