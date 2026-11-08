// Run after `npx tsc --build`: node --test tests/phantom-muspah-scoreboard.test.cjs
//
// The Phantom Muspah scoreboard (muspah_scoreboard_multi / muspah_scoreboard, interface
// muspah_scoreboard): the kill path in Loot.PhantomMuspah.js feeding it, deaths, the world's
// records across players and restarts, on a real Player with only the network stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, beforeEach, after } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const Common = require('../plugins/bosses/phantommuspah/Common.PhantomMuspah');
const Loot = require('../plugins/bosses/phantommuspah/Loot.PhantomMuspah');
const Scoreboard = require('../plugins/bosses/phantommuspah/Scoreboard.PhantomMuspah');
const Lair = require('../plugins/bosses/phantommuspah/Lair.PhantomMuspah');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'muspah-scoreboard-'));
const hooks = { objects: {}, npcDeaths: [], routes: [], defeated: [], deaths: [], persisted: new Map() };
/** What the lair moves to the exit: [owner, itemId] per stack registered. */
const moved = [];
const groundManager = { deregister() {}, registerLocation: (owner, item) => moved.push([owner, item.getId()]) };
let INTERFACE, BOARD_MULTI, BOARD;
let index = 1;

before(() => {
  CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute: (key, value) => hooks.persisted.set(key, value),
    onObjectInteraction: (name, actions) => { (hooks.objects[name] ??= []).push(actions); },
    onNpcDeath: (handler) => hooks.npcDeaths.push(handler),
    onPlayerDefeated: (handler) => hooks.defeated.push(handler),
    onPlayerDeath: (handler) => hooks.deaths.push(handler),
    onObjectRoute: (handler) => hooks.routes.push(handler),
    onCustomEvent() {},
    onPlayerLogin() {},
    onItemAction() {},
    emitCustomEvent() {},
    getItemOnGroundManager: () => groundManager,
  };
  Common.init(api);
  Loot.attachLoot(api);
  Scoreboard.attachScoreboard(api);
  Lair.attachLair(api);
  const cache = api.core.CacheDefinitions;
  INTERFACE = cache.getInterfaceId('muspah_scoreboard');
  BOARD_MULTI = cache.getLocId('muspah_scoreboard_multi');
  BOARD = cache.getLocId('muspah_scoreboard');
});

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

beforeEach(() => Scoreboard._useFile(path.join(scratch, `${Math.random()}.json`)));

/** A real Player with only the network stubbed; the packets it would send are recorded. */
function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = { interfaces: [], texts: new Map(), messages: [] };
  const original = { sendInterface: sender.sendInterface, sendString: sender.sendString };
  t.mock.method(sender, 'sendInterface', function (id) { p.sent.interfaces.push(id); return original.sendInterface.apply(this, arguments); });
  t.mock.method(sender, 'sendString', function (text, uid) { p.sent.texts.set(uid, text); return original.sendString.apply(this, arguments); });
  t.mock.method(p, 'sendMessage', (text) => p.sent.messages.push(text));
  return p;
}

/** Fires an option the way ObjectActionPacketListener does: every handler for the name until one claims it. */
function click(player, option, objectId) {
  for (const actions of hooks.objects.Scoreboard ?? []) {
    if (actions[option]?.({ player, objectId, option: option.toLowerCase(), clickType: 1, handled: false }) === true) return true;
  }
  return false;
}

/** The Muspah dying to `player` after `ticks`, through Loot.PhantomMuspah.js's own death hook. */
function kill(player, ticks) {
  const { World } = Common.core;
  const fight = { player, stopped: false, startCycle: World.getProcessCycle() - ticks, finished() {} };
  for (const handler of hooks.npcDeaths) handler({ npc: { __muspahFight: fight }, killer: player });
}

const text = (p, component) => p.sent.texts.get((INTERFACE << 16) | component);

test('a new reader sees zeros and "-" under the cache title', (t) => {
  const p = realPlayer(t);
  assert.equal(click(p, 'Read', BOARD_MULTI), true);
  assert.deepEqual(p.sent.interfaces, [INTERFACE]);
  assert.equal(text(p, 6), 'Phantom Muspah Statistics');
  for (const component of [9, 11, 15, 17]) assert.equal(text(p, component), '0');
  assert.equal(text(p, 13), '-');
  assert.equal(text(p, 19), '-');
});

test('kills through the Muspah death hook fill the personal and world rows, the faster time winning', (t) => {
  const p = realPlayer(t);
  kill(p, 108); // 1:04.80, the captured fight
  kill(p, 150);
  assert.equal(click(p, 'Read', BOARD), true, 'the transformed loc reads too');
  assert.equal(text(p, 9), '2');
  assert.equal(text(p, 13), '1:04.80');
  assert.equal(text(p, 15), '2');
  assert.equal(text(p, 19), '1:04.80');
});

test('a kill credited to someone else counts for nobody', (t) => {
  const p = realPlayer(t);
  const { World } = Common.core;
  const fight = { player: p, stopped: false, startCycle: World.getProcessCycle() - 100, finished() {} };
  for (const handler of hooks.npcDeaths) handler({ npc: { __muspahFight: fight }, killer: null });
  click(p, 'Read', BOARD_MULTI);
  assert.equal(text(p, 9), '0');
  assert.equal(text(p, 15), '0');
});

test("the world's records are every player's, and a reader's own rows stay theirs", (t) => {
  const a = realPlayer(t);
  const b = realPlayer(t);
  kill(a, 200);
  kill(b, 90);
  Scoreboard.died(b);
  click(a, 'Read', BOARD_MULTI);
  assert.equal(text(a, 9), '1');
  assert.equal(text(a, 11), '0');
  assert.equal(text(a, 13), '2:00.00');
  assert.equal(text(a, 15), '2');
  assert.equal(text(a, 17), '1');
  assert.equal(text(a, 19), '0:54.00', "b's kill is the world's best");
});

test('deaths are a saved attribute starting at 0, and the world records survive a restart', (t) => {
  assert.equal(hooks.persisted.get(Scoreboard.DEATHS_ATTRIBUTE), 0);
  const file = path.join(scratch, 'restart.json');
  Scoreboard._useFile(file);
  const p = realPlayer(t);
  kill(p, 120);
  Scoreboard.died(p);
  Scoreboard.died(p);
  Scoreboard._useFile(file); // as a restart reads it again
  const q = realPlayer(t);
  click(q, 'Read', BOARD_MULTI);
  assert.equal(text(q, 15), '1');
  assert.equal(text(q, 17), '2');
  assert.equal(text(q, 19), '1:12.00');
  assert.equal(text(q, 11), '0');
  // The player's own deaths are their attribute, which the save keeps (persistAttribute above).
  click(p, 'Read', BOARD_MULTI);
  assert.equal(text(p, 11), '2');
});

test('reading twice sends the board twice and counts nothing', (t) => {
  const p = realPlayer(t);
  click(p, 'Read', BOARD_MULTI);
  click(p, 'Read', BOARD_MULTI);
  assert.deepEqual(p.sent.interfaces, [INTERFACE, INTERFACE]);
  assert.equal(text(p, 15), '0');
});

test("another boss's Scoreboard is left to its own handler", (t) => {
  const p = realPlayer(t);
  assert.equal(click(p, 'Read', Common.core.CacheDefinitions.getLocId('araxxor_scoreboard_multi')), false);
  assert.deepEqual(p.sent.interfaces, []);
});

test('the route goes to the open floor west of the board, as its own tile is rock', (t) => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { Location } = require('../dist/game/model/Location');
  RegionManager.init();
  const board = MapObjects.get(BOARD_MULTI, new Location(2914, 10317, 0), null);
  assert.ok(board, 'the cache places it at 2914,10317');
  assert.equal(board.getType(), 4);
  assert.notEqual(RegionManager.getClipping(2914, 10317, 0, null), 0, 'its tile is blocked');
  assert.equal(RegionManager.getClipping(2913, 10317, 0, null), 0, 'the tile west of it is open');
  const p = realPlayer(t);
  const event = { player: p, object: board, objectId: BOARD_MULTI, clickType: 1, destination: null };
  for (const handler of hooks.routes) handler(event);
  assert.deepEqual(event.destination, { x: 2913, y: 10317, z: 0 });
  const other = { player: p, object: board, objectId: 12345, clickType: 1, destination: null };
  for (const handler of hooks.routes) handler(other);
  assert.equal(other.destination, null, 'other locs keep their own route');
});

test("a death in the lair counts on defeat, though Death's Office claims the death itself", (t) => {
  const p = realPlayer(t);
  const area = {};
  t.mock.method(p, 'getPrivateArea', () => area);
  Lair._setSession(p, area);
  t.after(() => Lair.sessionOf(p)?.end());
  // PlayerDeath reports the defeat to every plugin; the death event that follows can stop at
  // Death's Office's first grave, so none of hooks.deaths is run here.
  for (const handler of hooks.defeated) handler({ killer: null, victim: p });
  click(p, 'Read', BOARD_MULTI);
  assert.equal(text(p, 11), '1');
  assert.equal(text(p, 17), '1');
});

test('a death outside the lair (in the fade in, or with no lair) is not counted', (t) => {
  const p = realPlayer(t);
  t.mock.method(p, 'getPrivateArea', () => null);
  for (const handler of hooks.defeated) handler({ killer: null, victim: p });
  Lair._setSession(p, {});
  t.after(() => Lair.sessionOf(p)?.end());
  for (const handler of hooks.defeated) handler({ killer: null, victim: p });
  click(p, 'Read', BOARD_MULTI);
  assert.equal(text(p, 11), '0');
  assert.equal(text(p, 17), '0');
});

test("a lair death moves its floor loot to the exit, but not a stack already picked up this tick", (t) => {
  const { World } = PluginManager.getCoreApi();
  const p = realPlayer(t);
  const area = {};
  Lair._setSession(p, area);
  const stack = (id, pending) => ({ getPrivateArea: () => area, isPendingRemoval: () => pending, getItem: () => ({ getId: () => id }) });
  const items = [stack(4151, false), stack(11802, true)];
  t.mock.method(World, "getItems", () => items);
  moved.length = 0;
  for (const handler of hooks.deaths) handler({ player: p, handled: false });
  assert.deepEqual(moved.map(([, id]) => id), [4151], "the picked-up stack is in the inventory already");
});
