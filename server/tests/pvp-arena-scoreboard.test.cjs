// Run after `npx tsc --build`: node --test tests/pvp-arena-scoreboard.test.cjs
//
// The Emir's Arena scoreboards (pvpa_scoreboard, interface pvp_arena_scoreboard): legacy duel
// wins and losses from DuelArena.plugin.js's own end of a duel, on real Players with only the
// network stubbed; a saved attribute; another Scoreboard left alone; the cache's placements.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

const DuelArena = require('../plugins/minigames/DuelArena.plugin');
const Scoreboard = require('../plugins/minigames/duelarena/Scoreboard.DuelArena');

const hooks = { objects: {}, custom: {}, persisted: new Map(), options: [], deaths: [], logouts: [], clicks: [] };
let INTERFACE, BOARD, TEXT;
let index = 1;

before(() => {
  CachePipeline.initialize();
  const noop = () => {};
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    getPluginConfig: (key, fallback) => key === 'DuelArena:pvpArenaWorld' ? true : fallback,
    onInterfaceActionClick: handler => hooks.clicks.push(handler),
    sendMultiChatboxPrompt: (_player, _title, _label, signUp) => signUp(),
    persistAttribute: (key, value) => hooks.persisted.set(key, value),
    onObjectInteraction: (name, actions) => { (hooks.objects[name] ??= []).push(actions); },
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
    emitCustomEvent: (name, payload) => { for (const handler of hooks.custom[name] ?? []) handler(payload); },
    onPlayerOption: (handler) => hooks.options.push(handler),
    onPlayerDeath: (handler) => hooks.deaths.push(handler),
    onPlayerLogout: (handler) => hooks.logouts.push(handler),
  }, { get: (target, key) => target[key] ?? noop }); // DuelArena's other hooks are not under test
  DuelArena.register(api);
  const cache = api.core.CacheDefinitions;
  INTERFACE = cache.getInterfaceId('pvp_arena_scoreboard');
  BOARD = cache.getLocId('pvpa_scoreboard');
  TEXT = cache.getComponentId('pvp_arena_scoreboard:text');
});

/** A real Player with only the network stubbed; the packets it would send are recorded. */
function realPlayer(t) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setIndex(index++);
  p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), 'refreshItems', () => {});
  const sender = p.getPacketSender();
  p.sent = { interfaces: [], texts: new Map(), messages: [] };
  const original = { sendInterface: sender.sendInterface, sendString: sender.sendString };
  t.mock.method(sender, 'sendInterface', function (id) { p.sent.interfaces.push(id); return original.sendInterface.apply(this, arguments); });
  t.mock.method(sender, 'sendString', function (text, uid) { p.sent.texts.set(uid, text); return original.sendString.apply(this, arguments); });
  t.mock.method(p, 'sendMessage', (text) => p.sent.messages.push(text));
  return p;
}

/** A legacy duel between a and b at `stage`, as DuelArena.plugin.js keeps one once both accept. */
function begin(a, b, stage) {
  const session = { players: [a, b], mask: 0, accepted: new Set(), offers: new Map([[a, new Map()], [b, new Map()]]), stage };
  for (const [player, other] of [[a, b], [b, a]]) {
    DuelArena._test.sessions.set(player, session);
    player.getDueling().setInteract(other);
  }
  return session;
}

/** ...ended the way the plugin ends one. */
function duel(a, b, stage, loser) {
  DuelArena._test.end(begin(a, b, stage), loser);
}

function view(player, objectId = BOARD) {
  for (const actions of hooks.objects.Scoreboard ?? []) {
    if (actions.View?.({ player, objectId, option: 'view', clickType: 1, handled: false }) === true) return true;
  }
  return false;
}

const board = (p) => p.sent.texts.get(TEXT);

test('a new reader: no wins, no losses', (t) => {
  const p = realPlayer(t);
  assert.equal(view(p), true);
  assert.deepEqual(p.sent.interfaces, [INTERFACE]);
  assert.equal(board(p), 'Legacy Duels<br><br>Wins: 0<br>Losses: 0');
});

test('a duel fought to a finish counts a win and a loss, each for its own player', (t) => {
  const a = realPlayer(t);
  const b = realPlayer(t);
  duel(a, b, 'fight', b);
  assert.ok(a.sent.messages.includes('You won the duel!'));
  duel(a, b, 'fight', a);
  duel(a, b, 'fight', b);
  view(a);
  view(b);
  assert.equal(board(a), 'Legacy Duels<br><br>Wins: 2<br>Losses: 1');
  assert.equal(board(b), 'Legacy Duels<br><br>Wins: 1<br>Losses: 2');
});

test("through the plugin's own hooks: a forfeit, a death and a logout each lose the duel", (t) => {
  const a = realPlayer(t);
  const b = realPlayer(t);
  begin(a, b, 'fight'); // the 3-2-1 countdown counts as the fight: forfeiting then loses too
  for (const handler of hooks.options) handler({ player: b, target: a, option: 6, handled: false }); // Forfeit
  begin(a, b, 'fight');
  for (const handler of hooks.deaths) handler({ player: a, killer: b, handled: false });
  begin(a, b, 'fight');
  for (const handler of hooks.logouts) handler({ player: b });
  view(a);
  view(b);
  assert.equal(board(a), 'Legacy Duels<br><br>Wins: 2<br>Losses: 1');
  assert.equal(board(b), 'Legacy Duels<br><br>Wins: 1<br>Losses: 2');
});

test('declined before the fight, or ended with nobody beaten, counts for neither', (t) => {
  const a = realPlayer(t);
  const b = realPlayer(t);
  duel(a, b, 'options', b); // a forfeit-like end before the fight
  duel(a, b, 'fight', undefined); // both out of the zone, nobody beaten
  view(a);
  assert.equal(board(a), 'Legacy Duels<br><br>Wins: 0<br>Losses: 0');
});

test('an ended duel ended again counts once', (t) => {
  const a = realPlayer(t);
  const b = realPlayer(t);
  const session = { players: [a, b], mask: 0, accepted: new Set(), offers: new Map([[a, new Map()], [b, new Map()]]), stage: 'fight' };
  DuelArena._test.sessions.set(a, session);
  DuelArena._test.sessions.set(b, session);
  DuelArena._test.end(session, b);
  DuelArena._test.end(session, b); // a death and a logout both trying to end it
  view(a);
  assert.equal(board(a), 'Legacy Duels<br><br>Wins: 1<br>Losses: 0');
});

test('the record is two saved attributes starting at 0, read back after a load', (t) => {
  assert.equal(hooks.persisted.get(Scoreboard.WINS_ATTRIBUTE), 0);
  assert.equal(hooks.persisted.get(Scoreboard.LOSSES_ATTRIBUTE), 0);
  const p = realPlayer(t);
  p.setAttribute(Scoreboard.WINS_ATTRIBUTE, 1234); // as a login restores them
  p.setAttribute(Scoreboard.LOSSES_ATTRIBUTE, 5);
  view(p);
  view(p); // a double click sends it again, counting nothing
  assert.deepEqual(p.sent.interfaces, [INTERFACE, INTERFACE]);
  assert.equal(board(p), 'Legacy Duels<br><br>Wins: 1,234<br>Losses: 5');
});

test("another place's Scoreboard is left to its own handler", (t) => {
  const p = realPlayer(t);
  assert.equal(view(p, PluginManager.getCoreApi().CacheDefinitions.getLocId('castlewars_scoreboard')), false);
  assert.deepEqual(p.sent.interfaces, []);
});

test('the cache places both boards at the arena, each with an open tile beside it', () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { Location } = require('../dist/game/model/Location');
  const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  RegionManager.init();
  for (const [x, y] of [[3319, 3227], [3339, 3268]]) {
    const object = MapObjects.get(BOARD, new Location(x, y, 0), null);
    assert.ok(object, `${x},${y}`);
    const def = ObjectDefinition.forId(BOARD);
    const rotated = object.getFace() % 2 === 1;
    const [w, l] = rotated ? [def.getSizeY(), def.getSizeX()] : [def.getSizeX(), def.getSizeY()];
    let reachable = 0;
    for (let dx = -2; dx <= w + 1; dx++) for (let dy = -2; dy <= l + 1; dy++) {
      const tile = { getLocation: () => new Location(x + dx, y + dy, 0), getSize: () => 1, getPrivateArea: () => null };
      if (RegionManager.getClipping(x + dx, y + dy, 0, null) === 0
        && PathFinder.reachedObject(tile, x, y, w, l, object.getFace(), object.getType(), 0)) reachable++;
    }
    assert.ok(reachable > 0, `an open tile reaches the board at ${x},${y}`);
  }
});
