// Run from server after yarn build: node --test tests/remaining-waterfall-parity.test.cjs
//
// Exercises the Waterfall Quest route through the real quest runtime: start
// dialogue hook, raft travel, Hudon's completion line, bookcase/read, the
// Tree Gnome Village key and gate, Glarial's pebble, the tombstone restriction,
// tomb chest/coffin, waterfall entry (amulet equipped), the dungeon key and
// locked door, six-pillar rune placements, the statue, the chalice completion
// and relog state. Ids are the cache gamevals used by the plugin.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { getRegisteredQuests } = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});

const ID = {
  book: 292, golrieKey: 293, pebble: 294, amulet: 295, urn: 296, emptyUrn: 297,
  baxKey: 298, air: 556, water: 555, earth: 557, rope: 954, diamond: 1601,
  gold: 2357, seeds: 299, logs: 1511, sword: 1277,
  raft: 1987, bookcase: 1989, golrieCrate: 1990, golrieGate: 1991,
  tombstone: 1992, tomb: 1993, chest: 1994, rock: 1996, baxCrate: 1999,
  baxDoor: 2002, pillar: 2005, statue: 2006, waterfallDoor: 2010,
  chalice: 2014, deadTree: 2020, barrel: 2022,
};
const NPC = { almera: 4181, hudon: 4182, hadley: 4179, gerald: 4180, golrie: 4183 };
const STAGE = { started: 1, hudon: 2, book: 3, tomb: 4, dungeon: 5, door: 6, amuletPlaced: 8, complete: 10 };
const PILLARS = [
  [2562, 9910], [2562, 9912], [2562, 9914], [2569, 9910], [2569, 9912], [2569, 9914],
].map(([x, y]) => ({ x, y, z: 0 }));

function register() {
  const hooks = new Map(), custom = new Map(), tasks = [];
  const add = (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  };
  const api = new Proxy({
    core: {
      ...core,
      TaskManager: {
        submit: (task) => { task.setRunning(true); tasks.push(task); },
        cancelTasks: (key) => tasks.filter((task) => task.key === key).forEach((task) => task.stop()),
      },
    },
    persistAttribute() {},
    onCustomEvent: (event, fn) => {
      if (!custom.has(event)) custom.set(event, []);
      custom.get(event).push(fn);
    },
    emitCustomEvent: (event, payload) => { for (const fn of custom.get(event) || []) fn(payload); },
    onNpcDialogueVariant: (fn) => add('onNpcDialogueVariant', fn),
    onNpcDialogueCondition: (fn) => add('onNpcDialogueCondition', fn),
    onPlayerLogin: (fn) => add('onPlayerLogin', fn),
    onItemAction: (nameOrFn, actions) => {
      if (typeof nameOrFn === 'function') add('onItemAction', nameOrFn);
      else for (const fn of Object.values(actions)) add('onItemAction', fn);
    },
    onObjectInteraction: (nameOrFn, actions) => {
      if (typeof nameOrFn === 'function') add('onObjectInteraction', nameOrFn);
      else for (const fn of Object.values(actions)) add('onObjectInteraction', fn);
    },
    onItemOnObject: (handler) => add('onItemOnObject', handler),
    onObjectRoute: (handler) => add('onObjectRoute', handler),
    onWalkRoute: (handler) => add('onWalkRoute', handler),
    onNpcRoute: (handler) => add('onNpcRoute', handler),
    onPlayerLogout: (handler) => add('onPlayerLogout', handler),
    onInterfaceActionButton: () => {},
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
  });
  require('../plugins/quests/quests/WaterfallQuest.Quest')(api);
  return {
    api,
    quest: getRegisteredQuests().findLast((quest) => quest.key === 'waterfall_quest'),
    call: (event, payload) => { const results = []; for (const fn of hooks.get(event) || []) results.push(fn(payload)); return results; },
    emit: (event, payload) => api.emitCustomEvent(event, payload),
    tick: (count) => { while (count-- > 0) [...tasks].forEach((task) => task.tick()); },
  };
}

function player() {
  const attributes = new Map(), items = new Map(), packets = [], messages = [], xp = [], worn = new Map(), flags = new Set();
  let location = new core.Location(2521, 3495, 0);
  const inventory = {
    getAmount: (id) => items.get(id) || 0,
    adds: (id, amount) => { items.set(id, (items.get(id) || 0) + amount); return true; },
    deleteNumber: (id, amount) => { items.set(id, Math.max(0, (items.get(id) || 0) - amount)); return true; },
    getItems: () => [...items].filter(([, amount]) => amount > 0).map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
    getFreeSlots: () => 28 - [...items].filter(([, amount]) => amount > 0).length,
    isFull: () => inventory.getFreeSlots() <= 0,
    forceAdd: (_, item) => inventory.adds(item.getId(), item.getAmount()),
  };
  let packet, movementBlocked = false;
  const movementQueue = {
    reset() { return movementQueue; },
    setBlockMovement(value) { movementBlocked = value; return movementQueue; },
    addSteps(tile) { location = tile; return movementQueue; },
  };
  packet = new Proxy({}, { get: (_, method) => (...args) => { packets.push([method, ...args]); return packet; } });
  const equipment = {
    get: (slot) => (worn.has(slot) ? { getId: () => worn.get(slot) } : null),
    getItems: () => [...worn.values()].map((id) => ({ getId: () => id, getAmount: () => 1 })),
  };
  const p = {
    attributes, items, packets, messages, xp,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    hasFlag: (flag) => flags.has(flag),
    setFlag: (flag, enabled = true) => { if (enabled) flags.add(flag); else flags.delete(flag); return p; },
    removeFlag: (flag) => { flags.delete(flag); return p; },
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getLocation: () => location,
    getPrivateArea: () => null,
    getRights: () => 0,
    getUsername: () => 'WaterfallTester',
    getPacketSender: () => packet,
    getFrameUpdater: () => ({ clear() {} }),
    getDialogueManager: () => ({
      reset() {},
      startDialogues: (builder) => { for (const dialogue of builder.getDialogues().values()) dialogue.send(p); },
      isActive: () => false,
    }),
    getSkillManager: () => ({
      getCombatLevel: () => 20,
      addExperiences: (skill, amount) => xp.push([skill.getIndex(), amount]),
    }),
    sendMessage: (message) => messages.push(message),
    moveTo: (tile) => { location = tile; },
    getMovementQueue: () => movementQueue,
    isMovementBlocked: () => movementBlocked,
    isPlayer: () => true,
    isRegistered: () => true,
    give: (id, amount = 1) => inventory.adds(id, amount),
    count: (id) => inventory.getAmount(id),
    wear: (id) => worn.set(core.Equipment.AMULET_SLOT, id),
    equip: (id, slot) => worn.set(slot, id),
    unequip: (slot) => worn.delete(slot),
  };
  return p;
}

const objectEvent = (p, objectId, x, y, z = 0) => ({
  player: p, objectId, location: { x, y, z }, definition: { getName: () => '' }, handled: false,
});
const itemOnObject = (p, objectId, itemId, x, y, z = 0) => ({
  player: p, objectId, itemId, location: { x, y, z }, handled: false,
});
const say = (q, p, npcId, text) => {
  const request = { player: p, npcId, text };
  q.emit('npc-dialogue:line', request);
  request.after?.();
};

function startToPebble(q, p) {
  q.emit('npc-dialogue:hook', { player: p, npcId: NPC.almera, hook: 'quest:waterfall-quest:start' });
  q.call('onObjectInteraction', objectEvent(p, ID.raft, 2509, 3493));
  say(q, p, NPC.hudon, "I'm fine alone.");
  q.call('onObjectInteraction', objectEvent(p, ID.bookcase, 2520, 3426, 1));
  q.call('onItemAction', { player: p, itemId: ID.book, option: 'Read' });
  q.call('onObjectInteraction', objectEvent(p, ID.golrieCrate, 2548, 9565));
  q.call('onObjectInteraction', objectEvent(p, ID.golrieGate, 2515, 9575));
  q.emit('npc-dialogue:action', { player: p, npcId: NPC.golrie, stepId: '2-d8NO', kind: 'message', handled: false });
  q.emit('npc-dialogue:action', { player: p, npcId: NPC.golrie, stepId: '2HNViG', kind: 'message', handled: false });
}

function startToRelics(q, p) {
  startToPebble(q, p);
  q.call('onItemOnObject', itemOnObject(p, ID.tombstone, ID.pebble, 2558, 3444));
  q.tick(2);
  q.call('onObjectInteraction', objectEvent(p, ID.chest, 2530, 9844));
  q.call('onObjectInteraction', objectEvent(p, ID.tomb, 2542, 9811));
}

test('start, raft, Hudon, bookcase, Golrie key and pebble use only normal interactions', () => {
  const q = register(), p = player();
  q.emit('npc-dialogue:hook', { player: p, npcId: NPC.almera, hook: 'quest:waterfall-quest:start' });
  assert.equal(q.quest.getStage(p), STAGE.started);
  assert.ok(p.messages.some((message) => message.includes("started a new quest") && message.includes('Waterfall Quest')));
  assert.equal(p.attributes.get('quest.points'), undefined);

  q.call('onObjectInteraction', objectEvent(p, ID.raft, 2509, 3493));
  assert.ok(p.packets.some(([method, , interfaceId]) => method === 'sendSubInterface' && interfaceId === 174),
    'raft fades out');
  assert.ok(p.packets.some(([method, group]) => method === 'sendChatboxInterface' && group === 229),
    'raft uses the captured messagebox');
  q.tick(2);
  assert.ok(p.getLocation().equals(new core.Location(2512, 3481, 0)), 'raft lands on the walkable Hudon tile');
  assert.equal(q.quest.getStage(p), STAGE.started, 'raft alone does not skip Hudon');

  say(q, p, NPC.hudon, "I'm fine alone.");
  assert.equal(q.quest.getStage(p), STAGE.hudon);

  q.call('onObjectInteraction', objectEvent(p, ID.bookcase, 2520, 3426, 1));
  assert.equal(p.count(ID.book), 1);
  assert.ok(p.packets.some(([method, group]) => method === 'sendChatboxInterface' && group === 193),
    'the book is handed over in an item box');
  q.call('onItemAction', { player: p, itemId: ID.book, option: 'Read' });
  assert.equal(q.quest.getStage(p), STAGE.book);
  assert.ok(p.packets.some(([method, group]) => method === 'sendInterface' && group === 392),
    'reading opens the two-page book');
  assert.ok(p.packets.some(([method, text, uid]) => method === 'sendString' && text === 'Book on Baxtorian' && uid === ((392 << 16) | 6)));

  q.call('onObjectInteraction', objectEvent(p, ID.golrieCrate, 2548, 9565));
  assert.equal(p.count(ID.golrieKey), 1);
  q.call('onObjectInteraction', objectEvent(p, ID.golrieGate, 2515, 9575));
  assert.ok(p.getLocation().getY() > 9575, 'key opens the gate and crosses inside');

  q.emit('npc-dialogue:action', { player: p, npcId: NPC.golrie, stepId: '2-d8NO', kind: 'message', handled: false });
  assert.equal(p.count(ID.pebble), 1);
  assert.equal(q.quest.getStage(p), STAGE.book, 'the pebble itself does not advance the varp');
  assert.equal(p.attributes.get('waterfall-quest:got-pebble'), 1);
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendVarbit' && id === 9110 && value === 1));
  q.emit('npc-dialogue:action', { player: p, npcId: NPC.golrie, stepId: '2HNViG', kind: 'message', handled: false });
  assert.equal(p.count(ID.golrieKey), 0, 'Golrie takes the key');
});

test('the gate is closed without the key and the bookcase stays empty before Hudon', () => {
  const q = register(), p = player();
  q.emit('npc-dialogue:hook', { player: p, npcId: NPC.almera, hook: 'quest:waterfall-quest:start' });
  const before = p.getLocation();
  q.call('onObjectInteraction', objectEvent(p, ID.golrieGate, 2515, 9575));
  assert.ok(p.getLocation().equals(before), 'no key, no entry');
  q.call('onObjectInteraction', objectEvent(p, ID.bookcase, 2520, 3426, 1));
  assert.equal(p.count(ID.book), 0, 'book needs Hudon conversation first');
  q.call('onObjectInteraction', objectEvent(p, ID.golrieCrate, 2548, 9565));
  assert.equal(p.count(ID.golrieKey), 0, 'key needs the book read first');
});

test("Glarial's tombstone enforces its restricted items and yields both relics", () => {
  const q = register(), p = player();
  startToPebble(q, p);
  const before = p.getLocation();
  q.call('onObjectInteraction', objectEvent(p, ID.tombstone, 2558, 3444));
  assert.ok(p.getLocation().equals(before), 'reading the closed tombstone does not enter');
  p.give(ID.logs, 1);
  q.call('onItemOnObject', itemOnObject(p, ID.tombstone, ID.pebble, 2558, 3444));
  assert.ok(p.getLocation().equals(before), 'restricted item blocks entry');
  assert.equal(p.count(ID.pebble), 1, 'pebble is not consumed when blocked');

  p.items.delete(ID.logs);
  p.give(ID.sword, 1);
  q.call('onItemOnObject', itemOnObject(p, ID.tombstone, ID.pebble, 2558, 3444));
  assert.ok(p.getLocation().equals(before), 'weapons are restricted');
  p.items.delete(ID.sword);

  q.call('onItemOnObject', itemOnObject(p, ID.tombstone, ID.pebble, 2558, 3444));
  q.tick(2);
  assert.ok(p.getLocation().equals(new core.Location(2555, 9844, 0)), 'tombstone lands in the tomb');
  assert.equal(p.count(ID.pebble), 0);
  assert.equal(q.quest.getStage(p), STAGE.tomb);

  q.call('onObjectInteraction', objectEvent(p, ID.chest, 2530, 9844));
  assert.equal(p.count(ID.amulet), 1);
  assert.equal(q.quest.getStage(p), STAGE.tomb, 'one relic is not enough to leave the tomb leg');
  q.call('onObjectInteraction', objectEvent(p, ID.tomb, 2542, 9811));
  assert.equal(p.count(ID.urn), 1);
  assert.equal(q.quest.getStage(p), STAGE.tomb);
  q.call('onObjectInteraction', objectEvent(p, ID.chest, 2530, 9844));
  q.call('onObjectInteraction', objectEvent(p, ID.tomb, 2542, 9811));
  assert.equal(p.count(ID.amulet), 1, 'the chest does not duplicate the amulet');
  assert.equal(p.count(ID.urn), 1, 'the coffin does not duplicate the urn');
});

test('waterfall entry needs a worn amulet; the dungeon key, pillars, statue and urn complete once', () => {
  const q = register(), p = player();
  startToRelics(q, p);
  p.give(ID.rope, 1);
  for (const rune of [ID.air, ID.water, ID.earth]) p.give(rune, 6);

  q.call('onObjectInteraction', objectEvent(p, ID.raft, 2509, 3493));
  q.tick(2);
  q.call('onItemOnObject', itemOnObject(p, ID.rock, ID.rope, 2512, 3468));
  assert.ok(p.getLocation().equals(new core.Location(2513, 3466, 0)), 'roped rock scripted crossing reaches the tree island');
  q.call('onItemOnObject', itemOnObject(p, ID.deadTree, ID.rope, 2512, 3465));
  assert.ok(p.getLocation().equals(new core.Location(2511, 3463, 0)), 'roped tree reaches the ledge');

  q.call('onObjectInteraction', objectEvent(p, ID.waterfallDoor, 2511, 3464));
  q.tick(2);
  assert.ok(p.getLocation().equals(new core.Location(2527, 3413, 0)), 'no worn amulet floods the player downstream');
  assert.equal(p.count(ID.amulet), 1);
  assert.equal(q.quest.getStage(p), STAGE.tomb);

  p.wear(ID.amulet);
  q.call('onObjectInteraction', objectEvent(p, ID.waterfallDoor, 2511, 3464));
  assert.ok(p.getLocation().equals(new core.Location(2575, 9861, 0)), 'worn amulet enters the dungeon');
  assert.equal(q.quest.getStage(p), STAGE.dungeon);

  q.call('onObjectInteraction', objectEvent(p, ID.baxDoor, 2566, 9901));
  assert.equal(p.attributes.get('waterfall-quest:baxtorian-door') ?? 0, 0, 'locked without a key');
  assert.equal(q.quest.getStage(p), STAGE.dungeon);
  q.call('onObjectInteraction', objectEvent(p, ID.baxCrate, 2589, 9888));
  assert.equal(p.count(ID.baxKey), 1);
  q.call('onObjectInteraction', objectEvent(p, ID.baxDoor, 2566, 9901));
  assert.equal(p.count(ID.baxKey), 1, 'the dungeon key stays in the inventory');
  assert.equal(p.attributes.get('waterfall-quest:baxtorian-door'), 1);
  assert.equal(q.quest.getStage(p), STAGE.door);

  // One pillar's worth first: the statue must flush the player, keeping the amulet.
  for (const [rune] of [[ID.air], [ID.water], [ID.earth]]) {
    q.call('onItemOnObject', itemOnObject(p, ID.pillar, rune, PILLARS[0].x, PILLARS[0].y));
  }
  p.items.delete(ID.amulet); // it was used as the worn amulet? no: worn copy is separate
  p.give(ID.amulet, 1);
  q.call('onItemOnObject', itemOnObject(p, ID.statue, ID.amulet, 2565, 9916));
  assert.equal(q.quest.getStage(p), STAGE.door, 'partial pillars do not raise the floor');
  assert.equal(p.count(ID.amulet), 1, 'failed statue use keeps the amulet');

  // Five more complete pillars (the first already has all three runes).
  for (const pillar of PILLARS.slice(1)) {
    for (const rune of [ID.air, ID.water, ID.earth]) {
      q.call('onItemOnObject', itemOnObject(p, ID.pillar, rune, pillar.x, pillar.y));
    }
  }
  assert.equal(p.count(ID.air), 0);
  assert.equal(p.count(ID.water), 0);
  assert.equal(p.count(ID.earth), 0);
  const beforeRepeat = p.count(ID.air);
  q.call('onItemOnObject', itemOnObject(p, ID.pillar, ID.air, PILLARS[1].x, PILLARS[1].y));
  assert.equal(p.count(ID.air), beforeRepeat, 'a duplicate rune is not consumed again');

  q.call('onItemOnObject', itemOnObject(p, ID.statue, ID.amulet, 2565, 9916));
  assert.equal(q.quest.getStage(p), STAGE.amuletPlaced);
  assert.equal(p.count(ID.amulet), 0, 'statue consumes the amulet');
  q.tick(2);
  assert.ok(p.getLocation().equals(new core.Location(2603, 9914, 0)), 'the raised floor moves the player to the chalice');

  q.call('onObjectInteraction', objectEvent(p, ID.chalice, 2565, 9911, 1));
  q.tick(2);
  assert.ok(p.getLocation().equals(new core.Location(2527, 3413, 0)), 'taking the treasure before the urn floods the room');
  q.call('onItemOnObject', itemOnObject(p, ID.chalice, ID.urn, 2565, 9911, 1));
  assert.equal(q.quest.getStage(p), STAGE.complete);
  assert.equal(p.count(ID.urn), 0);
  assert.equal(p.count(ID.emptyUrn), 1);
  assert.equal(p.count(ID.diamond), 2);
  assert.equal(p.count(ID.gold), 2);
  assert.equal(p.count(ID.seeds), 40);
  assert.deepEqual(p.xp, [[core.Skill.ATTACK.getIndex(), 13750], [core.Skill.STRENGTH.getIndex(), 13750]]);
  assert.equal(p.attributes.get('quest.points'), 1);

  const xpAfter = p.xp.length, pointsAfter = p.attributes.get('quest.points');
  p.give(ID.urn, 1);
  q.call('onItemOnObject', itemOnObject(p, ID.chalice, ID.urn, 2565, 9911, 1));
  assert.equal(q.quest.getStage(p), STAGE.complete, 'completion is idempotent');
  assert.equal(p.xp.length, xpAfter, 'rewards are not paid twice');
  assert.equal(p.attributes.get('quest.points'), pointsAfter);
});

test('old stage 8 saves are migrated back to the tomb instead of being stranded', () => {
  const q = register(), p = player();
  q.quest.setStage(p, STAGE.amuletPlaced);
  q.call('onPlayerLogin', { player: p });
  assert.equal(q.quest.getStage(p), STAGE.book);
  assert.equal(p.attributes.get('waterfall-quest:tombstone-open'), 1);
  const before = p.getLocation();
  q.call('onObjectInteraction', objectEvent(p, ID.tombstone, 2558, 3444));
  assert.ok(p.getLocation().equals(new core.Location(2555, 9844, 0)), 'migrated save can re-enter the tomb');
  assert.ok(!p.getLocation().equals(before));
});

test('tomb restriction covers worn equipment and rechecks open-tomb re-entry/relog', () => {
  const q = register(), p = player();
  p.give(ID.pebble, 1);
  p.equip(ID.sword, 3); // weapon slot is restricted even outside the inventory
  const before = p.getLocation();
  q.call('onItemOnObject', itemOnObject(p, ID.tombstone, ID.pebble, 2558, 3444));
  assert.ok(p.getLocation().equals(before), 'equipped weapon blocks first pebble entry');
  assert.equal(p.count(ID.pebble), 1, 'blocked pebble is retained');
  assert.equal(p.attributes.get('waterfall-quest:tombstone-open') ?? 0, 0);

  p.unequip(3);
  p.equip(ID.amulet, 2); // jewellery is allowed
  p.give(ID.amulet, 1); p.give(ID.urn, 1); p.give(385, 1); // tomb quest items/food allowed
  q.call('onItemOnObject', itemOnObject(p, ID.tombstone, ID.pebble, 2558, 3444));
  q.tick(2);
  assert.ok(p.getLocation().equals(new core.Location(2555, 9844, 0)), 'clean/allowed items still enter');
  assert.equal(p.count(ID.pebble), 0);
  assert.equal(p.attributes.get('waterfall-quest:tombstone-open'), 1);

  p.moveTo(new core.Location(2558, 3446, 0));
  q.call('onObjectInteraction', objectEvent(p, ID.tombstone, 2558, 3444));
  assert.ok(p.getLocation().equals(new core.Location(2555, 9844, 0)), 'open tombstone re-entry works when clean');

  p.equip(ID.sword, 3);
  p.moveTo(new core.Location(2558, 3446, 0));
  q.call('onObjectInteraction', objectEvent(p, ID.tombstone, 2558, 3444));
  assert.ok(p.getLocation().equals(new core.Location(2558, 3446, 0)), 'open re-entry refuses worn weapon');
  assert.ok(p.messages.some((m) => m.includes('restricted items')));

  p.unequip(3);
  p.give(ID.air, 1);
  q.call('onObjectInteraction', objectEvent(p, ID.tombstone, 2558, 3444));
  assert.ok(p.getLocation().equals(new core.Location(2558, 3446, 0)), 'open re-entry refuses newly acquired rune');
  p.items.delete(ID.air);

  q.call('onPlayerLogin', { player: p });
  q.call('onObjectInteraction', objectEvent(p, ID.tombstone, 2558, 3444));
  assert.ok(p.getLocation().equals(new core.Location(2555, 9844, 0)), 'clean re-entry after relog works');
});

test('relog resends the waterfall varp and conversation flags', () => {
  const q = register(), p = player();
  startToPebble(q, p);
  q.call('onPlayerLogin', { player: p });
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendConfig' && id === 65 && value === STAGE.book));
  assert.ok(p.packets.some(([method, id, value]) => method === 'sendVarbit' && id === 9110 && value === 1));
});

test('the raft landing and rock/swim bank are collision-reachable, not just copied coordinates', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  RegionManager.init();
  RegionManager.loadMapFiles(2512, 3477);
  const queue = () => ({
    reset() {}, setRoute() {}, syncDestinationFlagToRoute() {}, setPathX() { return this; },
    setPathY() { return this; }, addCheckpoint() {}, hasRoute: () => false,
  });
  const walker = (x, y) => ({
    isPlayer: () => true, getAsPlayer: () => ({ getUsername: () => 'WaterfallRoute' }),
    getLocation: () => new core.Location(x, y, 0), getSize: () => 1,
    getPrivateArea: () => null, getMovementQueue: queue,
  });
  assert.ok(PathFinder.calculateWalkRoute(walker(2512, 3481), 2512, 3477) > 0,
    'the captured raft landing has a real route to the rock bank');
  assert.equal(PathFinder.calculateWalkRoute(walker(2511, 3484), 2512, 3477), 0,
    'the old landing tile has no route off the island');
  assert.equal(core.RegionManager.blocked(new core.Location(2512, 3481, 0), null), false);
});

test('the rock and river swim point route the player to the north bank', () => {
  const q = register(), p = player();
  const rock = { player: p, objectId: ID.rock, object: {}, sourceLocation: { x: 2512, y: 3481, z: 0 }, destination: null };
  q.call('onObjectRoute', rock);
  assert.deepEqual(rock.destination, { x: 2512, y: 3476, z: 0 });
  const swim = { player: p, objectId: 10283, object: {}, sourceLocation: { x: 2512, y: 3481, z: 0 }, destination: null };
  q.call('onObjectRoute', swim);
  assert.deepEqual(swim.destination, { x: 2511, y: 3477, z: 0 });
  q.call('onObjectInteraction', objectEvent(p, 10283, 2511, 3476));
  q.tick(2);
  assert.ok(p.getLocation().equals(new core.Location(2527, 3413, 0)), 'the real River Swim point washes the player downstream');
});

test('the key still gates the Baxtorian door when Doors handles it first', () => {
  const q = register(), p = player();
  q.quest.setStage(p, STAGE.dungeon);
  const locked = { player: p, objectId: ID.baxDoor, handled: false };
  q.emit('door:toggle', locked);
  assert.equal(locked.handled, true, 'no key vetoes the shared door opening');
  assert.equal(q.quest.getStage(p), STAGE.dungeon);
  assert.ok(p.messages.includes('The door is locked.'));

  p.give(ID.baxKey, 1);
  const unlocked = { player: p, objectId: ID.baxDoor, handled: false };
  q.emit('door:toggle', unlocked);
  assert.equal(unlocked.handled, false, 'the keyed door is left for Doors to swing');
  assert.equal(q.quest.getStage(p), STAGE.door);
  assert.equal(p.attributes.get('waterfall-quest:baxtorian-door'), 1);
  assert.equal(p.count(ID.baxKey), 1, 'the dungeon key is kept');
});

test('the Waterfall dungeon doors swap to their cache open locs', () => {
  const doors = require('../plugins/objects/Doors.plugin.js');
  const names = {};
  const registered = [], deregistered = [];
  const fakeCore = {
    ...core,
    ObjectManager: {
      register: (object) => registered.push(object.getId()),
      deregister: (object) => deregistered.push(object.getId()),
    },
    Sounds: { sendSound() {} },
    TaskManager: { submit() {}, cancelTasks() {} },
  };
  doors.register({
    core: fakeCore,
    onObjectInteraction: (name, actions) => { if (name === 'Door') Object.assign(names, actions); },
    onRegionLoaded() {}, onServerStartup() {}, onObjectRoute() {}, emitCustomEvent() {},
  });
  for (const [closedId, openId, face] of [[2000, 2001, 3], [2002, 2003, 1]]) {
    registered.length = 0; deregistered.length = 0;
    const object = new core.GameObject(closedId, new core.Location(closedId === 2000 ? 2575 : 2566, closedId === 2000 ? 9861 : 9901, 0), 0, face, null);
    const event = {
      player: { getPrivateArea: () => null }, object, objectId: closedId,
      definition: { id: closedId }, location: { x: object.getLocation().getX(), y: object.getLocation().getY(), z: 0 },
      clickType: 1, handled: false,
    };
    names.Open(event);
    assert.deepEqual(deregistered, [closedId], `door ${closedId} is removed`);
    assert.ok(registered.includes(openId), `door ${closedId} becomes open loc ${openId}`);
  }
  // Do not leave the 2002 open-door state for the real-map door test below.
  names.Close({
    player: { getPrivateArea: () => null },
    object: new core.GameObject(2003, new core.Location(2566, 9902, 0), 0, 2, null),
    objectId: 2003, definition: { id: 2003 },
    location: new core.Location(2566, 9902, 0), clickType: 1, handled: false,
  });
});

test('north Waterfall large doors match the captured west swing and keep the threshold routable', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  RegionManager.init();
  RegionManager.loadMapFiles(2581, 9876);
  const names = {};
  const doorCore = {
    ...core, ObjectManager, MapObjects,
    Sounds: { sendSound() {} },
    TaskManager: { submit() {}, cancelTasks() {} },
  };
  require('../plugins/objects/Doors.plugin.js').register({
    core: doorCore,
    onObjectInteraction: (name, actions) => { if (name === 'Large door') Object.assign(names, actions); },
    onRegionLoaded() {}, onServerStartup() {}, onObjectRoute() {}, emitCustomEvent() {},
  });
  const player = { getPrivateArea: () => null, getLocation: () => new core.Location(2581, 9876, 0) };
  const north = MapObjects.get(1521, new core.Location(2582, 9875, 0), null);
  assert.ok(north, 'the north large door is on the real map');
  names.Open({
    player, object: north, objectId: 1521, definition: { id: 1521 },
    location: new core.Location(2582, 9875, 0), clickType: 1, handled: false,
  });
  // Captured Waterfall pose: the pair swings west to 2581,9875/76, faces 3/1.
  const left = MapObjects.get(1522, new core.Location(2581, 9875, 0), null);
  const right = MapObjects.get(1525, new core.Location(2581, 9876, 0), null);
  assert.ok(left && right, 'both open leaves are at the captured west pose');
  assert.equal(left.getFace(), 3);
  assert.equal(right.getFace(), 1);
  assert.equal(MapObjects.get(1521, new core.Location(2582, 9875, 0), null), null);
  assert.equal(MapObjects.get(1524, new core.Location(2582, 9876, 0), null), null);
  assert.equal(RegionManager.blocked(new core.Location(2581, 9876, 0), null), false);
  const route = new RsmodRouteFinding().findRoute({
    level: 0, srcX: 2581, srcY: 9876, srcSize: 1, destX: 2584, destY: 9876,
    destWidth: 1, destLength: 1, locAngle: 0, locShape: -1, moveNear: false,
    blockAccessFlags: 0, maxWaypoints: 25, privateArea: null,
  });
  assert.equal(route.success, true, 'exact RSMod route from the captured pose through the threshold');
  assert.deepEqual(route.waypoints.at(-1), { x: 2584, y: 9876, z: 0 });

  names.Open({
    player, object: right, objectId: 1525, definition: { id: 1525 },
    location: new core.Location(2581, 9876, 0), clickType: 1, handled: false,
  });
  assert.ok(MapObjects.get(1521, new core.Location(2582, 9875, 0), null), 'close restores the north pair');
});

test('normal defaults reach and open both Baxtorian 2002 doors through the real door callback', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
  const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  RegionManager.init();
  for (const [x, y] of [[2572, 9896], [2576, 9884], [2565, 9881], [2568, 9893], [2566, 9901], [2565, 9908]]) {
    RegionManager.loadMapFiles(x, y);
  }
  const q = register(), p = player();
  q.quest.setStage(p, STAGE.dungeon);
  p.give(ID.baxKey, 1);
  p.moveTo(new core.Location(2572, 9896, 0));
  const names = {};
  const doorCore = {
    ...core, ObjectManager, MapObjects,
    Sounds: { sendSound() {} },
    TaskManager: { submit() {}, cancelTasks() {} },
  };
  require('../plugins/objects/Doors.plugin.js').register({
    core: doorCore,
    onObjectInteraction: (name, actions) => {
      if (name === 'Large door') names.large = actions;
      if (name === 'Door') names.door = actions;
    },
    onRegionLoaded() {}, onServerStartup() {}, onObjectRoute() {},
    emitCustomEvent: (event, payload) => q.emit(event, payload),
  });
  const finder = new RsmodRouteFinding();
  const route = (srcX, srcY, destX, destY) => finder.findRoute({
    level: 0, srcX, srcY, srcSize: 1, destX, destY,
    destWidth: 1, destLength: 1, locAngle: 0, locShape: -1, moveNear: false,
    blockAccessFlags: 0, maxWaypoints: 25, privateArea: null,
  });
  const open = (id, x, y) => {
    const object = MapObjects.get(id, new core.Location(x, y, 0), null);
    assert.ok(object, `map object ${id}@${x},${y}`);
    (id === ID.baxDoor ? names.door : names.large).Open({
      player: p, object, objectId: id, definition: { id },
      location: new core.Location(x, y, 0), clickType: 1, handled: false,
    });
  };
  // Normal route from the post-crate room: one Open leaf per large-door pair.
  open(1521, 2576, 9884);
  open(1521, 2576, 9882);
  open(1521, 2564, 9881);

  const assertDefaultRoute = (x, y, sourceX, sourceY) => {
    const object = { getLocation: () => new core.Location(x, y, 0) };
    const event = {
      player: p, objectId: ID.baxDoor, object,
      sourceLocation: { x: sourceX, y: sourceY, z: 0 }, destination: null,
    };
    q.call('onObjectRoute', event);
    assert.equal(event.destination, null, `2002@${x},${y} keeps the normal destination from (${sourceX},${sourceY})`);
  };
  assertDefaultRoute(2568, 9893, 2572, 9896);
  assertDefaultRoute(2568, 9893, 2568, 9895);
  assertDefaultRoute(2566, 9901, 2568, 9895);
  assertDefaultRoute(2566, 9901, 2566, 9903);

  assert.equal(route(2572, 9896, 2568, 9892).success, true, 'default route reaches the north side of the first 2002');
  p.moveTo(new core.Location(2568, 9892, 0));
  open(ID.baxDoor, 2568, 9893);
  assert.equal(q.quest.getStage(p), STAGE.door);
  assert.ok(MapObjects.get(2003, new core.Location(2568, 9894, 0), null), 'physical 2003 at 2568,9894');
  assert.equal(MapObjects.get(2002, new core.Location(2568, 9893, 0), null), null);
  assert.equal(route(2568, 9892, 2568, 9895).success, true, 'open 2003 passes south');
  assert.equal(route(2568, 9895, 2568, 9892).success, true, 'open 2003 passes north');

  assert.equal(route(2568, 9895, 2566, 9900).success, true, 'default route reaches the north side of the second 2002');
  p.moveTo(new core.Location(2566, 9900, 0));
  open(ID.baxDoor, 2566, 9901);
  assert.equal(q.quest.getStage(p), STAGE.door);
  assert.ok(MapObjects.get(2003, new core.Location(2566, 9902, 0), null), 'physical 2003 at 2566,9902');
  assert.equal(MapObjects.get(2002, new core.Location(2566, 9901, 0), null), null);
  assert.equal(route(2566, 9900, 2566, 9903).success, true, 'open 2003 passes south into the pillar room');
  assert.equal(route(2566, 9903, 2566, 9900).success, true, 'pillar room returns north through open 2003');
  assert.equal(p.hasFlag('movement:ignore-clipping'), false, 'no scoped clip flag is involved');
});

test('rope crossing uses owner objects, leaves the base rock, and keeps two players isolated', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const { ObjectManager } = require('../dist/game/entity/impl/object/ObjectManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  RegionManager.init();
  RegionManager.loadMapFiles(2512, 3470);
  const q = register(), a = player(), b = player();
  q.quest.setStage(a, STAGE.started); q.quest.setStage(b, STAGE.started);
  a.give(ID.rope, 1); b.give(ID.rope, 1);
  const rockLocation = new core.Location(2512, 3468, 0);
  const beforeRockClip = RegionManager.getClipping(2512, 3468, 0, null);
  const beforeRopeClip = RegionManager.getClipping(2512, 3472, 0, null);
  const beforeCornerClip = RegionManager.getClipping(2513, 3469, 0, null);
  const beforeBankClip = RegionManager.getClipping(2512, 3475, 0, null);
  assert.ok(MapObjects.get(1996, rockLocation, null), 'the global map rock anchor is present before crossing');
  assert.equal(core.CacheDefinitions.getObject(1996).clipType, 0);
  assert.equal(core.CacheDefinitions.getObject(1997).clipType, 0);
  assert.equal(core.CacheDefinitions.getObject(1998).clipType, 0);

  const route = { player: a, objectId: ID.deadTree, sourceLocation: { x: 2512, y: 3470, z: 0 }, destination: null };
  q.call('onObjectRoute', route);
  assert.deepEqual(route.destination, { x: 2513, y: 3466, z: 0 });

  a.moveTo(new core.Location(2512, 3476, 0));
  b.moveTo(new core.Location(2512, 3476, 0));
  q.call('onItemOnObject', itemOnObject(a, ID.rock, ID.rope, 2512, 3468));
  assert.ok(a.getLocation().equals(new core.Location(2513, 3466, 0)), 'scripted rope crossing reaches the captured tree tile');
  assert.equal(a.hasFlag('movement:ignore-clipping'), true, 'the crossing flag is scoped to the scripted steps');
  q.call('onWalkRoute', { player: a, destination: { x: 2512, y: 3476, z: 0 }, handled: false });
  assert.equal(a.hasFlag('movement:ignore-clipping'), false, 'another walk request clears the scoped flag');
  const returnRoute = { player: a, objectId: ID.rock, sourceLocation: { x: 2513, y: 3466, z: 0 }, destination: null };
  q.call('onObjectRoute', returnRoute);
  assert.deepEqual(returnRoute.destination, { x: 2513, y: 3466, z: 0 });
  q.call('onItemOnObject', itemOnObject(a, ID.rock, ID.rope, 2512, 3468));
  assert.ok(a.getLocation().equals(new core.Location(2512, 3476, 0)), 'scripted rope return reaches the north bank');
  q.tick(39);
  q.call('onItemOnObject', itemOnObject(b, ID.rock, ID.rope, 2512, 3468));
  assert.ok(b.getLocation().equals(new core.Location(2513, 3466, 0)));
  assert.ok(MapObjects.get(1996, rockLocation, null), 'the base rock is never globally deregistered');
  const ownedA = MapObjects.getPrivateArea(a, 1997, rockLocation);
  const ownedB = MapObjects.getPrivateArea(b, 1997, rockLocation);
  assert.ok(ownedA, 'player A sees their owned roped rock');
  assert.ok(ownedB, 'player B sees their own roped rock');
  assert.equal(ownedA.getOwner(), a);
  assert.equal(ownedB.getOwner(), b);
  assert.notEqual(ownedA, ownedB);
  assert.ok(MapObjects.getPrivateArea(a, 1996, rockLocation), 'the base rock click remains valid');
  for (let y = 3469; y <= 3475; y++) {
    const ids = ObjectManager.objectsAt(new core.Location(2512, y, 0)).map((o) => o.getId());
    assert.ok(ids.includes(1998), `rope 1998 is registered at 2512,${y}`);
    assert.ok(MapObjects.getPrivateArea(a, 1998, new core.Location(2512, y, 0)), `owned rope is click-valid for A at 2512,${y}`);
  }
  assert.equal(RegionManager.getClipping(2512, 3468, 0, null), beforeRockClip, 'clipType 0 rock registration adds no collision');
  assert.equal(RegionManager.getClipping(2512, 3472, 0, null), beforeRopeClip, 'clipType 0 rope registration adds no collision');
  assert.equal(RegionManager.getClipping(2513, 3469, 0, null), beforeCornerClip, 'no global water-floor clear at 2513,3469');
  assert.equal(RegionManager.getClipping(2512, 3475, 0, null), beforeBankClip, 'no global water-floor clear at 2512,3475');

  const queue = () => ({
    reset() {}, setRoute() {}, syncDestinationFlagToRoute() {}, setPathX() { return this; },
    setPathY() { return this; }, addCheckpoint() {}, hasRoute: () => false,
  });
  const walker = (x, y) => ({
    isPlayer: () => true, getAsPlayer: () => ({ getUsername: () => 'WaterfallRoute' }),
    getLocation: () => new core.Location(x, y, 0), getSize: () => 1,
    getPrivateArea: () => null, getMovementQueue: queue,
  });
  assert.equal(PathFinder.calculateRoute(walker(2512, 3470), 1, 2513, 3466, 0, 0, 0, 0, false), 0,
    'there is no exact cache path: the crossing must be scripted, not moveNear');
  assert.equal(PathFinder.calculateRoute(walker(2513, 3466), 1, 2512, 3476, 0, 0, 0, 0, false), 0,
    'there is no exact cache path back: the return is scripted');

  q.tick(1); // A's 40-tick timeout fires; B has only just crossed
  assert.equal(a.hasFlag('movement:ignore-clipping'), false, 'A timeout removes the scoped crossing flag');
  assert.equal(MapObjects.getPrivateArea(a, 1997, rockLocation), null, 'A timeout removes only A roped rock');
  assert.ok(MapObjects.getPrivateArea(b, 1997, rockLocation), 'A timeout does not remove B crossing');
  assert.equal(b.hasFlag('movement:ignore-clipping'), true, 'B keeps its own crossing flag');
  assert.ok(MapObjects.get(1996, rockLocation, null), 'A timeout leaves the base rock');
  q.call('onPlayerLogout', { player: b });
  assert.equal(MapObjects.getPrivateArea(b, 1997, rockLocation), null, 'B logout removes only B roped rock');
  assert.equal(b.hasFlag('movement:ignore-clipping'), false, 'B logout removes B scoped crossing flag');
  assert.ok(MapObjects.get(1996, rockLocation, null), 'B logout leaves the base rock');
  b.moveTo(new core.Location(2513, 3466, 0));
  q.call('onItemOnObject', itemOnObject(b, ID.deadTree, ID.rope, 2512, 3465));
  assert.ok(b.getLocation().equals(new core.Location(2511, 3463, 0)),
    'relog on the island can still use the tree without rope visuals or a recovery teleport');
});

test('real MovementQueue walks the scripted crossing over both clipped tiles with scoped ignore-clipping', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
  RegionManager.init();
  RegionManager.loadMapFiles(2512, 3470);
  const flags = new Set();
  const state = { location: new core.Location(2512, 3476, 0) };
  let mq;
  const character = {
    isPlayer: () => false, isNpc: () => false, getAsPlayer: () => null,
    getAsNpc: () => ({ getMovementSteps: () => 1 }),
    getSize: () => 1, getPrivateArea: () => null,
    getLocation: () => state.location, setLocation: (tile) => { state.location = tile; },
    setWalkingDirection() {}, setRunningDirection() {}, getFollowing: () => null,
    isNeedsPlacement: () => false, getTimers: () => ({ has: () => false }),
    hasFlag: (flag) => flags.has(flag),
    setFlag: (flag, enabled = true) => { if (enabled) flags.add(flag); else flags.delete(flag); return character; },
    removeFlag: (flag) => { flags.delete(flag); return character; },
    getMovementQueue: () => mq,
  };
  mq = new MovementQueue(character);
  const q = register();
  const beforeCorner = RegionManager.getClipping(2513, 3469, 0, null);
  const beforeBank = RegionManager.getClipping(2512, 3475, 0, null);
  assert.ok(beforeCorner > 0 && beforeBank > 0, 'both crossing tiles are actually clipped in cache');
  q.call('onItemOnObject', itemOnObject(character, ID.rock, ID.rope, 2512, 3468));
  assert.equal(character.hasFlag('movement:ignore-clipping'), true);
  for (let i = 0; i < 14 && !state.location.equals(new core.Location(2513, 3466, 0)); i++) mq.process();
  assert.ok(state.location.equals(new core.Location(2513, 3466, 0)), 'real MovementQueue crosses both clipped tiles');
  assert.equal(RegionManager.getClipping(2513, 3469, 0, null), beforeCorner, 'crossing does not mutate the corner floor');
  assert.equal(RegionManager.getClipping(2512, 3475, 0, null), beforeBank, 'crossing does not mutate the bank floor');
  mq.process();
  q.tick(2);
  assert.equal(character.hasFlag('movement:ignore-clipping'), false, 'the scoped flag is removed when the queued path completes');
});

test('statue travel completes through the real 229 messagebox resume handler', () => {
  const q = register(), p = player();
  q.quest.setStage(p, STAGE.dungeon);
  p.setAttribute('waterfall-quest:pillars', (1 << 18) - 1);
  p.give(ID.amulet, 1);
  const senderBase = {
    chatboxGroupId: -1,
    sendChatboxInterface(id) { this.chatboxGroupId = id; return this; },
    sendString() { return this; }, sendClientScript() { return this; },
    sendInterfaceFlagsRange() { return this; }, sendSubInterface() { return this; },
    closeSubInterface() { return this; }, sendInterfaceRemoval() { this.removed = true; return this; },
    isChatboxInterface(groupId) { return groupId === this.chatboxGroupId; },
  };
  const sender = new Proxy(senderBase, {
    get(target, prop) { return prop in target ? target[prop] : () => sender; },
  });
  p.getPacketSender = () => sender;
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const manager = new DialogueManager(p);
  p.getDialogueManager = () => manager;
  const handled = q.call('onItemOnObject', {
    player: p, objectId: ID.statue, itemId: ID.amulet, itemSlot: 0, handled: false,
  })[0];
  assert.equal(handled, true);
  assert.equal(q.quest.getStage(p), STAGE.amuletPlaced);
  assert.equal(p.isMovementBlocked(), true, 'travel holds movement until the messagebox continue');
  q.tick(2);
  assert.ok(manager.getCurrent() instanceof core.StatementDialogue, 'the follow-up messagebox is managed');
  assert.equal(p.isMovementBlocked(), true);
  assert.equal(manager.handleResume(153 << 16, -1), false, 'interface 153 is not the messagebox control');
  assert.equal(p.isMovementBlocked(), true);
  const { decodeClientPacket } = require('../dist/net/protocol/ClientProtocol');
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  // Native RESUME_PAUSEBUTTON: opcode 62, childIndex shortAddLE (-1), widgetId int (229 << 16).
  const packet = decodeClientPacket(Buffer.from([ClientPacketId.RESUME_PAUSEBUTTON, 0xff, 0x7f, 0x00, 0xe5, 0x00, 0x00]));
  assert.deepEqual(packet, { type: 'dialogue_continue', childIndex: 0xffff, widgetId: 229 << 16 });
  assert.equal(manager.handleResume(packet.widgetId, packet.childIndex), true, 'real RESUME_PAUSEBUTTON handler on group 229');
  assert.equal(p.isMovementBlocked(), false, 'normal continue unlocks movement');
  assert.equal(q.quest.getStage(p), STAGE.amuletPlaced, 'no automatic stage change');
  assert.equal(p.count(ID.amulet), 0, 'the amulet was consumed once');
});

test('raft travel locks movement until continue and a logout clears the lock', () => {
  const q = register(), p = player();
  q.quest.setStage(p, STAGE.started);
  q.call('onObjectInteraction', objectEvent(p, ID.raft, 2509, 3493));
  assert.equal(p.isMovementBlocked(), true, 'the crash messagebox blocks world movement');
  q.call('onPlayerLogout', { player: p });
  assert.equal(p.isMovementBlocked(), false, 'logout recovery clears the travel lock');
});

test('Hudon can still be talked to from the new raft landing at stage 1', () => {
  const q = register(), p = player();
  q.quest.setStage(p, STAGE.started);
  const route = { player: p, npcId: NPC.hudon, npcIndex: 1, range: 1 };
  q.call('onNpcRoute', route);
  assert.equal(route.range, 4, 'the landing talks to Hudon without a path to his tile');
});

test('every selected Waterfall dialogue variant exists and conditions are answerable', () => {
  const q = register(), p = player();
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
  const page = data['Waterfall Quest'];
  for (const npcId of [NPC.almera, NPC.hudon, NPC.hadley, NPC.gerald, NPC.golrie]) {
    for (let stage = 0; stage <= 10; stage++) {
      q.quest.setStage(p, stage);
      const selection = q.call('onNpcDialogueVariant', { npcId, player: p })[0];
      if (selection == null) continue;
      if (typeof selection === 'string') {
        assert.ok(page.variants[selection], `${npcId} stage ${stage} names missing variant ${selection}`);
      } else {
        assert.ok(data[selection.page]?.variants?.[selection.variant],
          `${npcId} stage ${stage} names missing ${selection.page}/${selection.variant}`);
      }
    }
  }
  q.quest.setStage(p, 0);
  for (const text of [
    'With a combat level lower than 25:',
    "If the player doesn't have the Book on Baxtorian in their inventory:",
    'If the player has the Book on Baxtorian in their inventory:',
    'If the player has no inventory space:',
    "If the player doesn't have the key:",
    'If the player has the key:',
    'If the player has disallowed items:',
    'If the player has no disallowed items:',
    "If the player does not have Glarial's amulet:",
    "If the player already has Glarial's amulet:",
    "If the player does not have Glarial's urn:",
    "If the player already has Glarial's urn:",
    "If the player is wearing Glarial's amulet:",
    "If the player is not wearing Glarial's amulet:",
    'If the player has not yet placed all the runes on the pillars:',
    'If the player has placed all the runes:',
  ]) {
    assert.notEqual(q.call('onNpcDialogueCondition', { player: p, npcId: NPC.almera, text })[0], undefined, text);
  }
});

test('postquest Hudon uses the canonical completion transcript page', () => {
  const q = register(), p = player();
  q.quest.setStage(p, STAGE.complete);
  const selection = q.call('onNpcDialogueVariant', { npcId: NPC.hudon, player: p })[0];
  assert.deepEqual(selection, {
    page: 'Hudon',
    variant: 'standard-dialogue-after-the-completion-of-waterfall-quest',
  });
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
  assert.ok(data.Hudon.variants[selection.variant], 'the canonical Hudon completion words exist');
});

test('fullbag reward overflow keeps every actual Waterfall item once', () => {
  const { Inventory } = require('../dist/game/model/container/impl/Inventory');
  const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
  const drops = [];
  const originalRegister = ItemOnGroundManager.registerLocation;
  ItemOnGroundManager.registerLocation = (owner, item, location) => {
    drops.push({ id: item.getId(), amount: item.getAmount(), location });
  };
  const rewardPlayer = () => {
    const p = player();
    const inventory = new Inventory(p);
    p.getInventory = () => inventory;
    p.getLocation = () => new core.Location(2603, 9912, 0);
    p.getUsername = () => 'WaterfallRewardTester';
    p.getPrivateArea = () => null;
    return { p, inventory };
  };
  const fill = (inventory, count, itemId = ID.rope) => {
    for (let i = 0; i < count; i++) inventory.adds(itemId, 1);
  };
  try {
    const q = register();

    // Full bag: all five reward items (2 diamonds + 2 gold bars + 40 seeds) drop once.
    const full = rewardPlayer();
    q.quest.setStage(full.p, STAGE.amuletPlaced);
    fill(full.inventory, 28);
    assert.equal(full.inventory.isFull(), true, 'precondition: full bag');
    assert.equal(q.quest.complete(full.p), true);
    assert.equal(q.quest.getStage(full.p), STAGE.complete);
    assert.deepEqual(drops.map((drop) => [drop.id, drop.amount]), [
      [ID.diamond, 1], [ID.diamond, 1], [ID.gold, 1], [ID.gold, 1], [ID.seeds, 40],
    ], 'actual cache stackability: nonstackables are dropped one at a time');
    assert.equal(full.inventory.getItems().length, 28, 'no reward overwrites a full bag');
    const afterFirst = drops.length;
    assert.equal(q.quest.complete(full.p), false, 'completion remains once-only');
    assert.equal(drops.length, afterFirst, 'repeating completion does not duplicate rewards');

    const relogged = rewardPlayer();
    q.quest.setStage(relogged.p, STAGE.complete);
    assert.equal(q.quest.complete(relogged.p), false, 'a saved complete stage cannot reward again');
    assert.equal(drops.length, afterFirst, 'relog/re-entry does not duplicate rewards');

    // One free slot: only the first diamond fits; the rest drops, proving capacity is real.
    drops.length = 0;
    const oneFree = rewardPlayer();
    q.quest.setStage(oneFree.p, STAGE.amuletPlaced);
    fill(oneFree.inventory, 27);
    assert.equal(q.quest.complete(oneFree.p), true);
    assert.equal(oneFree.inventory.getAmount(ID.diamond), 1);
    assert.equal(oneFree.inventory.getAmount(ID.gold), 0);
    assert.deepEqual(drops.map((drop) => [drop.id, drop.amount]), [
      [ID.diamond, 1], [ID.gold, 1], [ID.gold, 1], [ID.seeds, 40],
    ]);

    // Existing stackable seeds merge into the occupied slot rather than dropping.
    drops.length = 0;
    const stacked = rewardPlayer();
    q.quest.setStage(stacked.p, STAGE.amuletPlaced);
    fill(stacked.inventory, 27);
    stacked.inventory.adds(ID.seeds, 1);
    assert.equal(q.quest.complete(stacked.p), true);
    assert.equal(stacked.inventory.getAmount(ID.seeds), 41);
    assert.ok(!drops.some((drop) => drop.id === ID.seeds), 'stackable seeds merge when the bag is full');
    assert.deepEqual(drops.map((drop) => [drop.id, drop.amount]), [
      [ID.diamond, 1], [ID.diamond, 1], [ID.gold, 1], [ID.gold, 1],
    ]);
  } finally {
    ItemOnGroundManager.registerLocation = originalRegister;
  }
});
