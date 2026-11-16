// Run after `yarn build`: node --test tests/myths-guild-barrier.test.cjs
//
// The Myths' Guild Magical Barriers (bridge and basement) and the Lithkren Vault Barriers against the Wiki (Dragon Slayer II) and
// rsprox 224/01437 / 230/00350 (a tick facing the barrier, then "You pass through the barrier."
// and the tile beyond it; Lithkren: 231/00722 ticks 433 and 499), on a real Player, the real quest runtime and the real Leagues
// auto-completion (#3692).
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');

let Barrier, QuestRuntime, Unlocks, core;
const objects = {};
const custom = {};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  RegionManager.init();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    getTaskManager: () => TaskManager,
    persistAttribute: (key, value) => PlayerSave.persistAttribute(key, value),
    getPluginConfig: (key, fallback) => fallback,
    onObjectInteraction: (name, actions) => { objects[name] = actions; },
    onCustomEvent: (name, handler) => { (custom[name] ??= []).push(handler); },
    emitCustomEvent: (name, payload) => { for (const handler of custom[name] ?? []) handler(payload); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  require('../plugins/modes/league/Common.LeagueMode').init(api);
  require('../plugins/quests/Quests.plugin').register(api);
  QuestRuntime = require('../plugins/quests/QuestRuntime');
  Unlocks = require('../plugins/modes/league/Unlocks.LeagueMode');
  Barrier = require('../plugins/areas/MythsGuildBarrier.plugin');
  Barrier.register(api);
});

function realPlayer(t, x, y, z) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setUsername('myths');
  p.setLocation(new Location(x, y, z));
  p.messages = [];
  p.spam = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'sendMessage', (text) => { p.messages.push(text); });
  t.mock.method(p, 'isRegistered', () => true);
  const sender = p.getPacketSender();
  t.mock.method(sender, 'sendTypedMessage', (type, text) => { p.spam.push(text); return sender; });
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  return p;
}

const ds2 = () => QuestRuntime.questNamed('Dragon Slayer II');
const barrierAt = (name, x, y, z) => MapObjects.get(core.CacheDefinitions.getLocId(name), new Location(x, y, z), null);
const bridge = (x = 2458) => barrierAt('ds2_guild_bridge_entrance', x, 2861, 0);
const basement = (y = 8987) => barrierAt('ds2_guild_dungeon_entrance', 1968, y, 1);
const tile = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

function pass(p, object) {
  const at = object.getLocation();
  return objects['Magical Barrier'].Pass({ player: p, object, objectId: object.getId(), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false });
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

test('both barriers are in the cache where the recordings cross them', () => {
  assert.ok(bridge(2456) && bridge(2457) && bridge(2458), 'bridge row at y=2861');
  assert.ok(basement(8986) && basement(8987), 'basement column at x=1968');
});

test('after a Leagues area unlock completes Dragon Slayer II, the bridge barrier lets you in (#3692)', (t) => {
  const p = realPlayer(t, 2458, 2860, 0);
  Unlocks._test.completeNamedQuests({ player: p, quests: ['Dragon Slayer II'], items: false });
  assert.equal(ds2().isComplete(p), true, 'the league path completes the quest');
  p.messages.length = 0; // the completion's own "Congratulations" line
  // The handler runs the tick after arriving, the tick the recording faces the barrier.
  assert.equal(pass(p, bridge()), true);
  assert.deepEqual(tile(p), [2458, 2860, 0], 'facing the barrier for a tick (rsprox 224/01437)');
  assert.deepEqual(p.spam, []);
  ticks(1);
  assert.deepEqual(tile(p), [2458, 2862, 0], 'then on the tile beyond it, two tiles in one move');
  assert.deepEqual(p.spam, [Barrier.PASS_MESSAGE]);
  assert.deepEqual(p.messages, []);
});

test('after a normally completed Dragon Slayer II, the basement barrier lets you in westwards (rsprox 230/00350)', (t) => {
  const p = realPlayer(t, 1969, 8987, 1);
  ds2().complete(p, { experience: false, scroll: false });
  pass(p, basement());
  ticks(3);
  assert.deepEqual(tile(p), [1967, 8987, 1]);
  assert.deepEqual(p.spam, [Barrier.PASS_MESSAGE]);
});

test('leaving goes back the other way, on the same row', (t) => {
  const p = realPlayer(t, 2456, 2862, 0);
  ds2().complete(p, { experience: false, scroll: false });
  pass(p, bridge(2456));
  ticks(3);
  assert.deepEqual(tile(p), [2456, 2860, 0]);
});

test('without Dragon Slayer II the barrier refuses with a message and nobody moves', (t) => {
  const p = realPlayer(t, 2457, 2860, 0);
  assert.equal(pass(p, bridge(2457)), true);
  ticks(3);
  assert.deepEqual(tile(p), [2457, 2860, 0]);
  assert.deepEqual(p.messages, [Barrier.REFUSED]);
  assert.deepEqual(p.spam, []);
});

test('a second click mid-crossing does not cross twice', (t) => {
  const p = realPlayer(t, 2458, 2860, 0);
  ds2().complete(p, { experience: false, scroll: false });
  pass(p, bridge());
  pass(p, bridge());
  ticks(4);
  assert.deepEqual(tile(p), [2458, 2862, 0]);
  assert.deepEqual(p.spam, [Barrier.PASS_MESSAGE]);
});

test('other Magical Barriers are left to their own handlers', (t) => {
  const p = realPlayer(t, 2458, 2860, 0);
  const other = core.ObjectIdentifiers.MAGICAL_BARRIER_3;
  assert.equal(objects['Magical Barrier'].Pass({ player: p, object: bridge(), objectId: other, handled: false }), false);
});

const vault = (x, y) => barrierAt('ds2_lithkren_vault_barrier', x, y, 0);
function passVault(p, object) {
  const at = object.getLocation();
  return objects.Barrier.Pass({ player: p, object, objectId: object.getId(), location: { x: at.getX(), y: at.getY(), z: at.getZ() }, handled: false });
}

test('the Lithkren Vault barriers are in the cache where rsprox 231/00722 crosses them', () => {
  assert.ok(vault(1561, 5074), 'adamant wing column at x=1561');
  assert.ok(vault(1587, 5088), 'rune wing row at y=5088');
});

test('after Dragon Slayer II, a Lithkren Vault barrier is crossed like the guild ones (rsprox 231/00722 tick 433)', (t) => {
  const p = realPlayer(t, 1562, 5074, 0);
  ds2().complete(p, { experience: false, scroll: false });
  p.messages.length = 0;
  assert.equal(passVault(p, vault(1561, 5074)), true);
  assert.deepEqual(tile(p), [1562, 5074, 0], 'facing the barrier for a tick');
  assert.deepEqual(p.spam, []);
  ticks(1);
  assert.deepEqual(tile(p), [1560, 5074, 0], 'then two tiles west, into the adamant dragon wing');
  assert.deepEqual(p.spam, [Barrier.PASS_MESSAGE]);
  assert.deepEqual(p.messages, []);
});

test('the rune wing row is crossed southwards (rsprox 231/00722 tick 499)', (t) => {
  const p = realPlayer(t, 1587, 5089, 0);
  ds2().complete(p, { experience: false, scroll: false });
  passVault(p, vault(1587, 5088));
  ticks(3);
  assert.deepEqual(tile(p), [1587, 5087, 0]);
  assert.deepEqual(p.spam, [Barrier.PASS_MESSAGE]);
});

test('without Dragon Slayer II a Lithkren Vault barrier refuses (Wiki: Lithkren Vault)', (t) => {
  const p = realPlayer(t, 1562, 5074, 0);
  assert.equal(passVault(p, vault(1561, 5074)), true);
  ticks(3);
  assert.deepEqual(tile(p), [1562, 5074, 0]);
  assert.deepEqual(p.messages, [Barrier.REFUSED]);
});

test("Zalcano's prison Barrier is left to its own handler", (t) => {
  const p = realPlayer(t, 1562, 5074, 0);
  const zalcano = core.CacheDefinitions.getLocId('zalcano_barrier');
  assert.ok(zalcano > 0);
  assert.equal(objects.Barrier.Pass({ player: p, object: vault(1561, 5074), objectId: zalcano, handled: false }), false);
});
