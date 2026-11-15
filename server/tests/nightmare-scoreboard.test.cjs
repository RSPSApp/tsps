// Run after `npx tsc --build`: node --test tests/nightmare-scoreboard.test.cjs
//
// The Sisterhood Sanctuary's scoreboards (nightmare_scoreboard and nightmare_challenge_scoreboard,
// interface nightmare_scoreboard) against rsprox 231/00392: the kill path in Fight.Nightmare.js and
// the death in Dream.Nightmare.js feeding them, the world's records across players and restarts,
// on a real Player with only the network stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, beforeEach, after } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { Location } = require('../dist/game/model/Location');

const Common = require('../plugins/bosses/nightmare/Common.Nightmare');
const Fight = require('../plugins/bosses/nightmare/Fight.Nightmare');
const Dream = require('../plugins/bosses/nightmare/Dream.Nightmare');
const Scoreboard = require('../plugins/bosses/nightmare/Scoreboard.Nightmare');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nightmare-scoreboard-'));
const hooks = { objects: {}, deaths: [], persisted: new Map() };
let INTERFACE, NIGHTMARE_BOARD, PHOSANI_BOARD, cache;
let index = 1;

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute: (key, value) => hooks.persisted.set(key, value),
    onObjectInteraction: (name, actions) => { (hooks.objects[name] ??= []).push(actions); },
    onNpcInteraction() {},
    onPlayerLogin() {},
    onPlayerDeath: (handler) => hooks.deaths.push(handler),
    onCustomEvent() {},
    emitCustomEvent() {},
  };
  Common.init(api);
  Dream.attachDream(api);
  Scoreboard.attachScoreboard(api);
  cache = api.core.CacheDefinitions;
  INTERFACE = cache.getInterfaceId('nightmare_scoreboard');
  NIGHTMARE_BOARD = cache.getLocId('nightmare_scoreboard');
  PHOSANI_BOARD = cache.getLocId('nightmare_challenge_scoreboard');
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
function click(player, objectId) {
  for (const actions of hooks.objects.Scoreboard ?? []) {
    if (actions.Read?.({ player, objectId, option: 'read', clickType: 1, handled: false }) === true) return true;
  }
  return false;
}

/** A kill, as Fight.Nightmare.js's won() reports it: the world's once, then each player's own count. */
function kill(players, phosani, ticks) {
  const team = [].concat(players);
  Scoreboard.won(phosani, ticks, team.length);
  for (const player of team) Fight.Fight.prototype.count.call({ phosani }, player, ticks, team.length);
}

/** Enable precise timing (option_precise_timing), as the settings interface sets it. */
function precise(player) {
  player.getPacketSender().sendVarbit(cache.getVarbitId('option_precise_timing'), 1);
}

/** A death in a dream, through Dream.Nightmare.js's own death hook. */
function dieInDream(player, phosani) {
  const dream = new Dream.Dream(phosani);
  dream.addPlayer(player);
  for (const handler of hooks.deaths) handler({ player, killer: null, handled: false });
  assert.equal(Dream.dreamOf(player), null, 'the death woke the player out of the dream');
}

const text = (p, name) => p.sent.texts.get(cache.getComponentId(`nightmare_scoreboard:${name}`));

test('the Nightmare board: a new reader sees the cache title, zeros and "-"', (t) => {
  const p = realPlayer(t);
  assert.equal(click(p, NIGHTMARE_BOARD), true);
  assert.deepEqual(p.sent.interfaces, [INTERFACE]);
  assert.equal(text(p, 'title_text'), 'The Nightmare Statistics');
  for (const ms of ['ms2', 'ms4', 'ms8', 'ms10']) assert.equal(text(p, ms), '0');
  assert.equal(text(p, 'ms6'), '-');
  assert.equal(text(p, 'ms12'), '-');
});

test("Phosani's board as rsprox 231/00392 lays it out, precise timing on: 10 kills, no deaths, 7:51.00", (t) => {
  const p = realPlayer(t);
  precise(p);
  for (let i = 0; i < 9; i++) kill(p, true, 900);
  kill(p, true, 785); // 7:51.00
  assert.equal(click(p, PHOSANI_BOARD), true);
  assert.equal(text(p, 'title_text'), "Phosani's Nightmare Statistics");
  assert.equal(text(p, 'ms2'), '10');
  assert.equal(text(p, 'ms4'), '0');
  assert.equal(text(p, 'ms6'), '7:51.00');
  assert.equal(text(p, 'ms8'), '10');
  assert.equal(text(p, 'ms10'), '0');
  assert.equal(text(p, 'ms12'), '7:51.00');
});

test('without precise timing the times are m:ss, as rsprox 234/03284 and the kill messages print them', (t) => {
  const p = realPlayer(t);
  kill(p, true, 375); // 3:45
  click(p, PHOSANI_BOARD);
  assert.equal(text(p, 'ms2'), '1');
  assert.equal(text(p, 'ms4'), '0');
  assert.equal(text(p, 'ms6'), '3:45');
  assert.equal(text(p, 'ms12'), '3:45');
  assert.ok(p.sent.messages.some((m) => m.includes('3:45')), 'the kill message agrees');
});

test('each board keeps its own version: a Nightmare kill is not a Phosani kill', (t) => {
  const p = realPlayer(t);
  precise(p);
  kill(p, false, 400);
  click(p, PHOSANI_BOARD);
  assert.equal(text(p, 'ms2'), '0');
  assert.equal(text(p, 'ms8'), '0');
  click(p, NIGHTMARE_BOARD);
  assert.equal(text(p, 'ms2'), '1');
  assert.equal(text(p, 'ms6'), '4:00.00');
  assert.equal(text(p, 'ms8'), '1');
});

test('a team kill counts once for each player credited, the faster run the world best', (t) => {
  const a = realPlayer(t);
  const b = realPlayer(t);
  precise(a);
  kill([a, b], false, 500);
  kill(b, false, 300);
  click(a, NIGHTMARE_BOARD);
  assert.equal(text(a, 'ms2'), '1');
  assert.equal(text(a, 'ms6'), '5:00.00');
  assert.equal(text(a, 'ms8'), '3');
  assert.equal(text(a, 'ms12'), '3:00.00', "b's solo kill is the world's best");
});

test("a death in a dream counts on that dream's board, for the player and the world", (t) => {
  const p = realPlayer(t);
  dieInDream(p, true);
  const q = realPlayer(t);
  dieInDream(q, false);
  click(p, PHOSANI_BOARD);
  assert.equal(text(p, 'ms4'), '1');
  assert.equal(text(p, 'ms10'), '1');
  click(p, NIGHTMARE_BOARD);
  assert.equal(text(p, 'ms4'), '0');
  assert.equal(text(p, 'ms10'), '1', "q's death");
});

test('a death outside a dream is not counted', (t) => {
  const p = realPlayer(t);
  p.setLocation(new Location(3808, 9750, 1));
  for (const handler of hooks.deaths) handler({ player: p, killer: null, handled: false });
  click(p, NIGHTMARE_BOARD);
  assert.equal(text(p, 'ms4'), '0');
  assert.equal(text(p, 'ms10'), '0');
});

test('deaths are saved attributes starting at 0, and the world records survive a restart', (t) => {
  assert.equal(hooks.persisted.get(Scoreboard.DEATHS_ATTRIBUTE), 0);
  assert.equal(hooks.persisted.get(Scoreboard.PHOSANI_DEATHS_ATTRIBUTE), 0);
  const file = path.join(scratch, 'restart.json');
  Scoreboard._useFile(file);
  const p = realPlayer(t);
  kill(p, true, 410);
  dieInDream(p, true);
  Scoreboard._useFile(file); // as a restart reads it again
  const q = realPlayer(t);
  precise(q);
  click(q, PHOSANI_BOARD);
  assert.equal(text(q, 'ms2'), '0', "a reader's own rows are theirs");
  assert.equal(text(q, 'ms8'), '1');
  assert.equal(text(q, 'ms10'), '1');
  assert.equal(text(q, 'ms12'), '4:06.00');
});

test('a team kill writes the world file once', (t) => {
  const file = path.join(scratch, 'writes.json');
  Scoreboard._useFile(file);
  const writes = t.mock.method(fs, 'renameSync');
  kill([realPlayer(t), realPlayer(t), realPlayer(t)], false, 600);
  assert.equal(writes.mock.calls.filter((call) => call.arguments[1] === file).length, 1);
});

test('reading twice sends the board twice and counts nothing', (t) => {
  const p = realPlayer(t);
  click(p, PHOSANI_BOARD);
  click(p, PHOSANI_BOARD);
  assert.deepEqual(p.sent.interfaces, [INTERFACE, INTERFACE]);
  assert.equal(text(p, 'ms8'), '0');
});

test("another boss's Scoreboard is left to its own handler", (t) => {
  const p = realPlayer(t);
  assert.equal(click(p, cache.getLocId('araxxor_scoreboard_multi')), false);
  assert.deepEqual(p.sent.interfaces, []);
});

test('both boards stand where the cache places them, reachable from the sanctuary floor', () => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  for (const [id, x, y] of [[NIGHTMARE_BOARD, 3811, 9745], [PHOSANI_BOARD, 3805, 9777]]) {
    const board = MapObjects.get(id, new Location(x, y, 1), null);
    assert.ok(board, `${id} at ${x},${y},1`);
    assert.equal(board.getType(), 10);
    const open = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([a, b]) => RegionManager.getClipping(a, b, 1, null) === 0);
    assert.ok(open, `${id} has an open tile beside it`);
  }
});

// rsprox_transcripts/235/03389.txt: the kill messages follow Enable precise timing as the board does, "1:14" and
// "Personal best: 0:55" before the player turns it on (line 8665), "1:31.20" and "Personal best: 1:31.20" after
// (lines 76887 and 84645).
test('kill messages print m:ss.cc with precise timing on, m:ss with it off', (t) => {
  const p = realPlayer(t);
  kill(p, false, 152);
  assert.match(p.sent.messages.at(-1), /Fight duration: <col=ff0000>1:31<\/col>/, 'precise timing off: m:ss');
  precise(p);
  kill(p, false, 181);
  assert.match(p.sent.messages.at(-1), /Fight duration: <col=ff0000>1:48\.60<\/col>\. Personal best: 1:31\.20$/);
  kill(p, false, 150);
  assert.match(p.sent.messages.at(-1), /Fight duration: <col=ff0000>1:30\.00<\/col> \(new personal best\)$/);
});
