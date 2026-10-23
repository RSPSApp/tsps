// Waterfall Quest (q131) — supplemental route repair, not part of the issue 728 128-quest backlog.
// From server/: node --test tests/qh728-q131.test.cjs
//
// Registered real dispatch through PluginManager. The cache/capture route is:
//   raft -> Hudon island (2512,3481) -> rope on crossing rock 1996 -> walk the
//   rope corridor south (2512,3475..3469, then 2513,3468..3466) -> dead tree
//   2020 -> ledge (2511,3463) -> waterfall door 2010 -> dungeon (2575,9861).
// The item-use walkToTile callback resets the movement queue after the handler
// returns, so the rope crossing must survive that reset. The legitimate River
// Swim point (10283) and an unroped rock click still wash the player downstream.
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();

const ROCK = 1996; // crossing_rock_waterfall_quest, "Swim to"
const ROCK_ROPED = 1997; // crossing_rock_roped_waterfall_quest
const ROPE = 954;
const DEAD_TREE = 2020; // overhanging_tree1_waterfall_quest, "Climb"
const LEDGE_DOOR = 2010; // waterfall_ledge_door, "Open"
const RIVER_SWIM = 10283; // waterfall_swim_point, River "Swim"
const RAFT = 1987; // lograft_waterfall_quest, "Board"
const AMULET = 295; // glarials_amulet_waterfall_quest
const ATTRIBUTE_FLAG = 'movement:ignore-clipping';
const DOWNSTREAM = [2527, 3413];
const DUNGEON_ENTRY = [2575, 9861];
const LEDGE = [2511, 3463];
const TREE_ISLAND = [2513, 3466];
const NORTH_BANK = [2512, 3476];
const HUDON_ISLAND = [2512, 3481];

let quest;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/quests/quests/WaterfallQuest.Quest')(PluginManager.createApi('qh728-q131'));
  quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'waterfall_quest');
  assert.ok(quest, 'Waterfall Quest registered');
  if (PluginManager.nextObjectHookOrder === 0) PluginManager.nextObjectHookOrder = 1;
});

function makePlayer({ x = HUDON_ISLAND[0], y = HUDON_ISLAND[1], stage = 2 } = {}) {
  const attributes = new Map();
  const items = new Map([[ROPE, 1]]);
  const worn = new Map();
  const messages = [];
  const packets = [];
  const dialogues = [];
  const flags = new Set();
  let location = new core.Location(x, y, 0);
  let blocked = false;
  let full = false;

  const queue = {
    points: [],
    reset() { queue.points.length = 0; return queue; },
    setBlockMovement(value) { blocked = value; return queue; },
    addSteps(step) { queue.points.push(step); return queue; },
    walkToReset() { return queue; },
    isMovementBlocked: () => blocked,
  };

  const sender = new Proxy({
    sendVarbit(id, value) { packets.push(['sendVarbit', id, value]); return sender; },
    sendConfig(id, value) { packets.push(['sendConfig', id, value]); return sender; },
    sendSubInterface(...args) { packets.push(['sendSubInterface', ...args]); return sender; },
    sendChatboxInterface(...args) { packets.push(['sendChatboxInterface', ...args]); return sender; },
    sendInterface(...args) { packets.push(['sendInterface', ...args]); return sender; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    adds(id, amount = 1) { items.set(id, (items.get(id) ?? 0) + amount); return true; },
    deleteNumber(id, amount = 1) { items.set(id, Math.max(0, (items.get(id) ?? 0) - amount)); return true; },
    getItems: () => [...items].filter(([, n]) => n > 0).map(([id, amount]) => ({ getId: () => id, getAmount: () => amount })),
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter((n) => n > 0).length),
    isFull: () => full,
  };

  const equipment = {
    get: (slot) => (worn.has(slot) ? { getId: () => worn.get(slot) } : null),
    getItems: () => [...worn.values()].map((id) => ({ getId: () => id, getAmount: () => 1 })),
  };

  const player = {
    messages, packets, dialogues, items,
    setFull(value) { full = value; },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => { attributes.set(key, value); },
    hasFlag: (flag) => flags.has(flag),
    setFlag(flag, enabled = true) { if (enabled) flags.add(flag); else flags.delete(flag); return player; },
    removeFlag(flag) { flags.delete(flag); return player; },
    getInventory: () => inventory,
    getEquipment: () => equipment,
    getLocation: () => location,
    getPrivateArea: () => null,
    getRights: () => 0,
    getUsername: () => 'qh728-q131',
    getPacketSender: () => sender,
    getFrameUpdater: () => ({ clear() {} }),
    getDialogueManager: () => ({
      reset() {},
      startDialogues: (chain) => dialogues.push(chain),
      isActive: () => false,
      getCurrent: () => null,
    }),
    getSkillManager: () => ({
      getCombatLevel: () => 20,
      addExperiences() {},
    }),
    getMovementQueue: () => queue,
    isMovementBlocked: () => blocked,
    isPlayer: () => true,
    isRegistered: () => true,
    sendMessage: (text) => messages.push(String(text)),
    moveTo: (tile) => { location = tile; },
    give(id, amount = 1) { inventory.adds(id, amount); },
    wear(id) { worn.set(core.Equipment.AMULET_SLOT, id); },
  };
  quest.setStage(player, stage);
  return player;
}

const object = (id, x, y) => ({
  getId: () => id,
  getLocation: () => new core.Location(x, y, 0),
});

function itemOnObject(player, objectId, itemId, x, y) {
  return PluginManager.emitItemOnObject({
    player, object: object(objectId, x, y), objectId, itemId,
    location: { x, y, z: 0 }, handled: false,
  });
}

function objectClick(player, objectId, option, x, y) {
  return PluginManager.emitObjectInteraction({
    player, object: object(objectId, x, y), objectId,
    definition: { getName: () => '', getInteractions: () => [option] },
    clickType: 1,
    location: { x, y, z: 0 },
    sourceLocation: { x: player.getLocation().getX(), y: player.getLocation().getY(), z: 0 },
    handled: false,
  });
}

/** One server task cycle: pending CountdownTasks move to active and tick. */
function pump(cycles = 1) {
  for (let i = 0; i < cycles; i++) TaskManager.process();
}

/** Consume queued movement the way MovementQueue.process applies its steps. */
function walkQueued(player) {
  const queue = player.getMovementQueue();
  while (queue.points.length > 0) player.moveTo(queue.points.shift());
}

function position(player) {
  const location = player.getLocation();
  return [location.getX(), location.getY()];
}

/** The engine's walkToTile callback resets the queue immediately after the handler. */
function actOnObject(player, objectId, itemId, x, y) {
  const handled = itemOnObject(player, objectId, itemId, x, y);
  player.getMovementQueue().reset();
  return handled;
}

test('raft, roped rock (raw and roped ids), dead tree and amulet door reach the cave', () => {
  const player = makePlayer({ x: 2509, y: 3493, stage: 1 });
  player.wear(AMULET);

  assert.equal(objectClick(player, RAFT, 'Board', 2509, 3493), true, 'raft is a registered object action');
  pump(3);
  assert.deepEqual(position(player), HUDON_ISLAND, 'raft lands on Hudon island');

  assert.equal(actOnObject(player, ROCK, ROPE, 2512, 3468), true, 'rope on the raw rock is handled');
  pump();
  assert.ok(player.getMovementQueue().points.length > 0, 'the crossing is re-queued after the walk reset');
  walkQueued(player);
  pump();
  assert.deepEqual(position(player), TREE_ISLAND, 'the scripted rope crossing survives the walk reset');
  assert.equal(player.hasFlag(ATTRIBUTE_FLAG), false, 'the scoped clip flag is cleared on arrival');

  assert.equal(actOnObject(player, ROCK_ROPED, ROPE, 2512, 3468), true, 'the roped resolved id is accepted');
  pump();
  walkQueued(player);
  pump();
  assert.deepEqual(position(player), NORTH_BANK, 'the same rock returns from the tree island');

  assert.equal(actOnObject(player, ROCK, ROPE, 2512, 3468), true, 'repeat south crossing works');
  pump();
  walkQueued(player);
  pump();
  assert.deepEqual(position(player), TREE_ISLAND);

  assert.equal(itemOnObject(player, DEAD_TREE, ROPE, 2512, 3465), true, 'rope on the dead tree is handled');
  assert.deepEqual(position(player), LEDGE, 'the dead tree lands on the ledge');
  assert.equal(player.hasFlag(ATTRIBUTE_FLAG), false, 'no free water walking remains after the tree');

  assert.equal(objectClick(player, LEDGE_DOOR, 'Open', 2511, 3464), true, 'the ledge door is handled');
  assert.deepEqual(position(player), DUNGEON_ENTRY, 'worn amulet enters the waterfall dungeon');
  assert.equal(quest.getStage(player), 5, 'entering the dungeon records stage 5');
});

test('an unroped rock click and the River Swim point still wash downstream', () => {
  const rock = makePlayer({ x: NORTH_BANK[0], y: NORTH_BANK[1] });
  assert.equal(objectClick(rock, ROCK, 'Swim to', 2512, 3468), true);
  pump(2);
  assert.deepEqual(position(rock), DOWNSTREAM, 'the unroped rock is a legitimate downstream swim');

  const river = makePlayer({ x: 2511, y: 3477 });
  assert.equal(objectClick(river, RIVER_SWIM, 'Swim', 2511, 3477), true);
  pump(2);
  assert.deepEqual(position(river), DOWNSTREAM, 'River Swim downstream behaviour is unchanged');
});

test('the amulet door still floods downstream without the amulet', () => {
  const player = makePlayer({ x: LEDGE[0], y: LEDGE[1], stage: 2 });
  assert.equal(objectClick(player, LEDGE_DOOR, 'Open', 2511, 3464), true);
  pump(2);
  assert.deepEqual(position(player), DOWNSTREAM);
  assert.equal(quest.getStage(player), 2, 'a failed entry does not advance the dungeon stage');
});

test('relog keeps the stage and a fresh session can cross again', () => {
  const player = makePlayer({ x: NORTH_BANK[0], y: NORTH_BANK[1], stage: 2 });
  assert.equal(actOnObject(player, ROCK, ROPE, 2512, 3468), true);
  pump();
  walkQueued(player);
  pump();
  assert.deepEqual(position(player), TREE_ISLAND);

  PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
  assert.equal(player.hasFlag(ATTRIBUTE_FLAG), false, 'logout releases the scoped movement flag');
  PluginManager.emitPlayerLogin({ player });
  assert.equal(quest.getStage(player), 2, 'the saved stage survives relog');
  assert.ok(player.packets.some(([method, id, value]) => method === 'sendConfig' && id === 65 && value === 2),
    'login resends the waterfall varp');

  player.moveTo(new core.Location(NORTH_BANK[0], NORTH_BANK[1], 0));
  assert.equal(actOnObject(player, ROCK_ROPED, ROPE, 2512, 3468), true, 'crossing still works after relog');
  pump();
  walkQueued(player);
  pump();
  assert.deepEqual(position(player), TREE_ISLAND);
});
