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
const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
const Room = require('../plugins/minigames/partyroom/Room.PartyRoom');
const Store = require('../plugins/minigames/partyroom/Store.PartyRoom');
let core;
let savedPersistence;

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
  core.GameConstants.PLAYER_PERSISTENCE = { requestSave() {}, flush: () => Promise.resolve() };
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


// This is a TSPS free-world control, not evidence that retail offers this dance on F2P worlds.
test('a free-world lever opens the knight choice and preserves payment on refusal and repeat', async (t) => {
  assert.equal(world.isMembersWorld(), false);
  assert.equal(core.NpcDefinition.forId(5793).isMembers(), false, 'actual server definition permits the NPC');
  assert.equal(world.isMembersArea(3043, 3378), false, 'the proposed performance is in configured free land');
  const lever = new core.Location(3054, 3378, 0);
  assert.ok(core.MapObjects.get(26194, lever, null), 'the map lever is present before interaction');
  assert.deepEqual(Store.chest(), [], 'the dance begins with an empty chest');
  t.after(() => Room.reset());

  function player(name, index) {
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const p = new Player(new PlayerSession(channel));
    p.setIndex(index);
    p.setUsername(name);
    p.setRegistered(true);
    p.setLocation(new core.Location(3054, 3377, 0));
    p.needsPlacement = false;
    const connection = new ClientConnection(channel);
    connection.player = p;
    p.testConnection = connection;
    return p;
  }
  const first = player('freeknight', 2891);
  const second = player('freeknight2', 2892);
  first.getInventory().adds(995, 499);
  second.getInventory().adds(995, 1000);

  async function menu(p) {
    await send(p, { type: 'object_option', id: 26194, x: 3054, y: 3378, clickType: 1 });
    const pending = core.MultiChatboxPrompt.getPending(p);
    assert.ok(pending, 'the free-world lever opens its choice menu');
    assert.deepEqual(pending.options, ['Balloon Bonanza (1,000 coins)', 'Nightly Dance (500 coins)', 'No action']);
  }
  async function choice(p, index) {
    const frame = Buffer.alloc(7);
    frame[0] = 62;
    frame[1] = index >>> 8;
    frame[2] = (index + 128) & 255;
    frame.writeInt32BE((219 << 16) | 1, 3);
    const decoded = decodeClientPackets(frame);
    assert.equal(decoded[0].childIndex, index);
    await p.testConnection.dispatch(decoded, true);
    p.testConnection.processTurnPackets();
    await new Promise((resolve) => setImmediate(resolve));
  }

  await menu(first);
  await choice(first, 3);
  assert.equal(first.getInventory().getAmount(995), 499, 'cancel preserves coins');
  await menu(first);
  await choice(first, 2);
  assert.equal(first.getInventory().getAmount(995), 499, 'underfunded dance preserves coins');
  assert.deepEqual(Store.chest(), []);
  first.getInventory().adds(995, 1001);
  await menu(first);
  await choice(first, 2);
  const Knights = require('../plugins/minigames/partyroom/Knights.PartyRoom');
  const show = Knights.performance();
  assert.ok(show, 'the free-world performance started');
  assert.equal(first.getInventory().getAmount(995), 1000, 'a dance charges exactly 500');
  assert.equal(show.knights.length, 6);
  assert.ok(show.knights.every((npc) => npc.isRegistered() && npc.getId() === 5793));
  await menu(second);
  await choice(second, 2);
  assert.equal(second.getInventory().getAmount(995), 1000, 'a concurrent request costs nothing');
  assert.equal(Knights.performance(), show, 'the performance is shared');
  assert.deepEqual(Store.chest(), [], 'a dance does not consume chest contents');
  for (let i = 0; i < 50; i++) core.TaskManager.process();
  assert.equal(Knights.performance(), null);
  assert.ok(show.knights.every((npc) => !npc.isRegistered()), 'all actors are removed after the show');
});
