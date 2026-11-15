// Run after `yarn build`: node --test tests/scoreboard-busy.test.cjs
//
// The scoreboards whose recordings set the busy varbit (12393) while they are open: 1 in the
// tick the board opens, before its IF_OPENSUB, and 0 when it closes. Araxxor
// rsprox_transcripts/237/01076.txt, TzHaar-Ket-Rak 227/00216.txt, the Colosseum 237/04109.txt and
// the Tombs of Amascut lobby 227/00554.txt. Real Player and PacketSender; only the network is
// stubbed, and interface:closed goes to the handlers the plugins registered.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

const Araxxor = require('../plugins/bosses/araxxor/Scoreboard.Araxxor');
const KetRakCommon = require('../plugins/minigames/tzhaarketrak/Common.TzHaarKetRak');
const KetRak = require('../plugins/minigames/tzhaarketrak/Scoreboard.TzHaarKetRak');
const Colosseum = require('../plugins/minigames/colosseum/Scoreboard.Colosseum');
const Lobby = require('../plugins/minigames/toa/Lobby.TombsOfAmascut');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'scoreboard-busy-'));
const hooks = { objects: {}, clicks: new Map(), custom: {} };
let BUSY, cache;

before(() => {
  CachePipeline.initialize();
  const noop = () => {};
  const api = new Proxy({
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => { (hooks.objects[name] ??= []).push(actions); },
    onObjectClick: (id, option, handler) => hooks.clicks.set(id, handler),
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
  }, { get: (target, key) => (key in target ? target[key] : noop) });
  Araxxor.attach(api);
  KetRakCommon.init(api);
  KetRak.attach(api);
  Colosseum(api);
  Lobby(api);
  Araxxor._useFile(path.join(scratch, 'araxxor.json'));
  KetRak._useFile(path.join(scratch, 'ket-rak.json'));
  Colosseum._useFile(path.join(scratch, 'colosseum.json'));
  cache = api.core.CacheDefinitions;
  BUSY = cache.getVarbitId('busy');
  assert.equal(BUSY, 12393);
});

after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** A real Player at `at`; the varbits and interfaces it is sent are recorded in order. */
function realPlayer(t, at = { x: 3200, y: 3200 }) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  p.setLocation(new Location(at.x, at.y, 0));
  const sender = p.getPacketSender();
  p.sent = [];
  const original = { sendVarbit: sender.sendVarbit, sendInterface: sender.sendInterface };
  t.mock.method(sender, 'sendVarbit', function (id, value) { if (id === BUSY) p.sent.push(['busy', value]); return original.sendVarbit.apply(this, arguments); });
  t.mock.method(sender, 'sendInterface', function (id) { p.sent.push(['interface', id]); return original.sendInterface.apply(this, arguments); });
  // interface:closed reaches the handlers these plugins registered, as PluginManager would.
  t.mock.method(PluginManager, 'emitCustomEvent', (name, payload) => {
    for (const handler of hooks.custom[name] ?? []) handler(payload);
  });
  return p;
}

function interact(player, name, option, objectId) {
  for (const actions of hooks.objects[name] ?? []) {
    if (actions[option]?.({ player, objectId, option: option.toLowerCase(), clickType: 1, handled: false }) === true) return true;
  }
  return false;
}

const BOARDS = [
  { name: 'Araxxor', open: (p) => interact(p, 'Scoreboard', 'Read', cache.getLocId('araxxor_scoreboard_multi')), iface: () => cache.getInterfaceId('araxxor_scoreboard') },
  { name: 'TzHaar-Ket-Rak', open: (p) => interact(p, 'Scoreboard', 'Read', cache.getLocId('jad_challenge_scoreboard')), iface: () => cache.getInterfaceId('jad_challenge_scoreboard') },
  { name: 'Colosseum', open: (p) => interact(p, 'Colosseum scoreboard', 'View-stats', 50747), iface: () => cache.getInterfaceId('colosseum_scoreboard') },
  {
    name: 'Tombs of Amascut lobby', at: { x: 3358, y: 9117 },
    open: (p) => { const id = cache.getLocId('toa_scoreboard'); return hooks.clicks.get(id)({ player: p, objectId: id }) !== false; },
    iface: () => cache.getInterfaceId('toa_scoreboard'),
  },
];

for (const board of BOARDS) {
  test(`${board.name} scoreboard: busy is 1 before it opens and 0 when it closes`, (t) => {
    const p = realPlayer(t, board.at);
    assert.equal(board.open(p), true, 'the board opens');
    assert.deepEqual(p.sent, [['busy', 1], ['interface', board.iface()]], 'busy first, in the same tick');
    p.getPacketSender().sendInterfaceRemoval();
    assert.deepEqual(p.sent.at(-1), ['busy', 0], 'cleared on close');
  });
}

test("another interface closing leaves busy alone", (t) => {
  const p = realPlayer(t);
  p.getPacketSender().sendInterface(cache.getInterfaceId('castlewars_score'));
  p.getPacketSender().sendInterfaceRemoval();
  assert.equal(p.sent.some(([kind]) => kind === 'busy'), false);
});
