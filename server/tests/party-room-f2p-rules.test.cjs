// Run from server/ after the normal build: node --test tests/party-room-f2p.test.cjs
// Exercise the real plugin loader in free-world mode, then the chest through packets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'party-f2p-'));
process.env.TSPS_PARTY_ROOM_DIR = temp;
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(temp, 'players.sqlite');
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = '0';
process.env.DISABLE_PLAYER_BOTS = '1';

// Load the real world configuration parser against a private F2P world before loading plugins.
const worldFile = path.join(temp, 'data', 'definitions', 'world.json');
fs.mkdirSync(path.dirname(worldFile), { recursive: true });
const shippedWorld = require('../data/definitions/world.json');
fs.writeFileSync(worldFile, JSON.stringify({ ...shippedWorld, membersWorld: false }));
const previousCwd = process.cwd();
let world;
try {
  process.chdir(temp);
  world = require('../dist/game/definition/WorldDefinition');
} finally {
  process.chdir(previousCwd);
}
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const Room = require('../plugins/minigames/partyroom/Room.PartyRoom');
const Store = require('../plugins/minigames/partyroom/Store.PartyRoom');
let core;
let savedPersistence;
const persistence = { gate: null, flushCalls: 0, requestSave() {}, flush() { this.flushCalls++; return this.gate ?? Promise.resolve(); } };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PM.getCoreApi();
  try {
    PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  } finally {
    // The loader may have installed SQLite even if a later plugin fails to load.
    savedPersistence = core.GameConstants.PLAYER_PERSISTENCE;
  }
  core.RegionManager.init();
  core.GameConstants.PLAYER_PERSISTENCE = persistence;
});

after(async () => {
  try {
    if (core && savedPersistence) core.GameConstants.PLAYER_PERSISTENCE = savedPersistence;
    PM.emitServerShutdown({});
    await savedPersistence?.flush();
  } finally {
    try {
      const writer = savedPersistence?.writer;
      if (writer) {
        savedPersistence.writer = null; // Prevent the exit handler restarting the worker.
        await writer.terminate();
      }
    } finally {
      try {
        savedPersistence?.database?.close();
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    }
  }
});

async function send(player, packet) {
  await player.testConnection.dispatch([packet]);
  player.testConnection.processTurnPackets();
  for (let i = 0; i < 12; i++) {
    core.TaskManager.processWalkTo(player.getIndex());
    player.getMovementQueue().process();
    core.TaskManager.process();
  }
  await new Promise((resolve) => setImmediate(resolve));
}

test('free-world loader registers the Falador chest and opens it by packet', async () => {
  assert.equal(world.isMembersWorld(), false, 'the actual world configuration is F2P');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(2890);
  player.setUsername('f2pvisitor');
  player.setRegistered(true);
  player.setLocation(new core.Location(3053, 3376, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  player.testConnection = connection;
  player.getInventory().adds(995, 100);
  await send(player, { type: 'object_option', id: 26193, x: 3054, y: 3376, clickType: 1 });
  assert.equal(player.getPacketSender().isSubInterfaceOpen(265), true, 'free-world chest opens');
  assert.equal(player.getInventory().getAmount(995), 100, 'opening does not take the coins');
  assert.deepEqual(Store.chest(), [], 'opening does not donate');
  Room.screenOf().playerGone(player);
});

let nextIndex = 2900;
function freePlayer(name) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername(name);
  player.setRegistered(true);
  player.setLocation(new core.Location(3053, 3376, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  player.testConnection = connection;
  return player;
}
async function openChest(player) {
  await send(player, { type: 'object_option', id: 26193, x: 3054, y: 3376, clickType: 1 });
  assert.equal(player.getPacketSender().isSubInterfaceOpen(265), true);
}
async function offerCoins(player) {
  await send(player, { type: 'widget_action', widgetId: 266 << 16, groupId: 266, childId: 0,
    buttonNum: 5, slot: player.getInventory().getSlotForItemId(995) });
}
async function confirmOffer(player) {
  await send(player, { type: 'widget_action', widgetId: (265 << 16) | 17, groupId: 265,
    childId: 17, buttonNum: 5, slot: 0 });
}

test('new free player can inspect the chest but cannot donate before account requirements', async (t) => {
  const player = freePlayer('f2pnew');
  const inventory = player.getInventory();
  inventory.adds(995, 100);
  let now = 1700000000000;
  t.mock.method(Date, 'now', () => now);
  PM.emitPlayerLogin({ player, username: player.getUsername() });
  await openChest(player);
  await offerCoins(player);
  assert.equal(inventory.getAmount(995), 100, 'new account keeps all coins');
  assert.deepEqual(Store.chest(), []);

  // Time is earned through the actual account play-time login/query producer.
  now += 20 * 60 * 60 * 1000 + 1;
  await offerCoins(player);
  assert.equal(inventory.getAmount(995), 100, 'quest points are still required');

  // Actual registered quest completion handles produce the persisted point count.
  const QuestRuntime = require('../plugins/quests/QuestRuntime');
  for (const quest of QuestRuntime.getRegisteredQuests()) {
    if ((Number(player.getAttribute('quest.points')) || 0) >= 10) break;
    if (!(quest.questPoints > 0) || quest.onReward || quest.rewardItemId !== undefined ||
        (quest.varpId === undefined && quest.varbitId === undefined)) continue;
    quest.complete(player, { experience: false, scroll: false, announce: false });
  }
  assert.ok(Number(player.getAttribute('quest.points')) >= 10, 'real quest completion produces points');
  assert.ok(player.getSkillManager().getTotalLevel() < 100, 'control starts below total level 100');
  await offerCoins(player);
  assert.equal(inventory.getAmount(995), 100, 'total level is still required');
  player.getSkillManager().setMaxLevel(core.Skill.ATTACK, 80);
  assert.ok(player.getSkillManager().getTotalLevel() >= 100);
  now -= 1;
  await offerCoins(player);
  assert.equal(inventory.getAmount(995), 100, 'exactly 20 hours is not over 20 hours');
  now += 1;
  const emit = PM.emitCustomEvent;
  const missingTime = t.mock.method(PM, 'emitCustomEvent', (name, ...args) =>
    name === 'account:play-time' ? undefined : emit.call(PM, name, ...args));
  await offerCoins(player);
  assert.equal(inventory.getAmount(995), 100, 'a missing play-time producer cannot silently grant eligibility');
  missingTime.mock.restore();
  await offerCoins(player);
  assert.equal(inventory.getAmount(995), 0, 'all actual progress criteria unlock the offer');
  let release;
  persistence.gate = new Promise((resolve) => { release = resolve; });
  const beforeFlush = persistence.flushCalls;
  await confirmOffer(player);
  assert.equal(Room.screenOf().offerOf(player)?.pending, true, 'confirm is waiting on the gated flush');
  assert.ok(persistence.flushCalls > beforeFlush, 'confirm actually called flush');
  now -= 1; // Eligibility can change while the player save is in flight.
  release();
  persistence.gate = null;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Store.chest(), [], 'the chest rechecks eligibility after the flush');
  assert.equal(inventory.getAmount(995), 0, 'the open offer still owns the coins');
  await send(player, { type: 'widget_action', widgetId: (265 << 16) | 16, groupId: 265,
    childId: 16, buttonNum: 5, slot: 0 });
  assert.equal(inventory.getAmount(995), 100, 'a refused offer can be taken back');
  now += 1;
  await offerCoins(player);
  await confirmOffer(player);
  assert.deepEqual(Store.chest(), [{ id: 995, amount: 100 }]);
  Room.screenOf().playerGone(player);
  PM.emitPlayerLogout({ player, username: player.getUsername() });
});

test('redeeming a real bond unlocks a free account even after the bond expires', async (t) => {
  Room.reset();
  fs.rmSync(path.join(temp, 'party-room.json'), { force: true });
  const player = freePlayer('f2pbond');
  const inventory = player.getInventory();
  inventory.adds(995, 100);
  inventory.adds(13190, 1);
  let now = 1700000000000;
  t.mock.method(Date, 'now', () => now);
  const slot = inventory.getSlotForItemId(13190);
  const item = inventory.getItems()[slot];
  const action = core.CacheDefinitions.getItem(13190).inventoryActions.indexOf('Redeem') + 1;
  assert.ok(action > 0, 'the cache exposes Redeem');
  assert.equal(PM.emitItemAction({ player, item, itemId: 13190, slot, clickType: action, handled: false }), true);
  assert.ok(core.MultiChatboxPrompt.getPending(player), 'the real bond handler opens its redemption prompt');
  await send(player, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: 1 });
  assert.equal(inventory.getAmount(13190), 0, 'the real redemption consumes the bond');
  assert.ok(Number(player.getAttribute('bond-membership-expiry')) > now);
  now += 30 * 24 * 60 * 60 * 1000;
  await openChest(player);
  await offerCoins(player);
  assert.equal(inventory.getAmount(995), 0, 'prior membership remains an eligibility producer');
  await confirmOffer(player);
  assert.deepEqual(Store.chest(), [{ id: 995, amount: 100 }]);
  Room.screenOf().playerGone(player);
});
