// Run after `yarn build`: node --test tests/message-scrolls.test.cjs
//
// Read on the Falador bank notice board (fai_falador_noticeboard2, 24099) and Varrock's Combat
// Scroll (fai_varrock_combat_scroll1_mirror, 5094) against rsprox 241/1001398, 233/03237 and
// 240/1001336: the fifteen messcroll lines of messagescroll (220), toplevel_mainmodal_open, the
// modal, and busy (12393) set while it is open.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

const NOTICE_BOARD = 24099;
const COMBAT_SCROLL = 5094;
const MESSAGESCROLL = 220;
const BUSY_VARBIT = 12393;

let MessageScrolls;
const hooks = { objects: {}, custom: {} };

before(() => {
  CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
    onObjectRoute: (handler) => { hooks.route = handler; },
  };
  MessageScrolls = require('../plugins/objects/MessageScrolls.plugin');
  MessageScrolls.register(api);
});

/** A real Player with only the network stubbed; what it sends is recorded in order. */
function realPlayer(t, x = 3010, y = 3356) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setLocation(new Location(x, y, 0));
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = [];
  for (const name of ['sendString', 'sendInterface', 'sendClientScript', 'sendVarbit']) {
    const original = sender[name];
    t.mock.method(sender, name, function (...args) { p.sent.push([name, ...args]); return original.apply(this, args); });
  }
  return p;
}

const read = (p, name, objectId) => hooks.objects[name].Read({ player: p, objectId, clickType: 1, handled: false });
const closed = (p, interfaceId) => { for (const handler of hooks.custom['interface:closed']) handler({ player: p, interfaceId }); };
const line = (n) => (MESSAGESCROLL << 16) | n;

test('the Falador bank notice board: the recorded Bank PIN lines, all fifteen, then the scroll (241/1001398 t254)', (t) => {
  const p = realPlayer(t);
  assert.equal(read(p, 'Notice board', NOTICE_BOARD), true);
  const strings = p.sent.filter(([name]) => name === 'sendString');
  assert.deepEqual(strings.map(([, , uid]) => uid), Array.from({ length: 15 }, (_, i) => line(i + 1)));
  const text = new Map(strings.map(([, value, uid]) => [uid, value]));
  assert.equal(text.get(line(1)), '');
  assert.equal(text.get(line(3)), "If you're worried about someone stealing items from your");
  assert.equal(text.get(line(4)), 'bank, why not protect yourself with a Bank PIN?');
  assert.equal(text.get(line(10)), "If you're interested, speak to the bankers and ask about Bank");
  assert.equal(text.get(line(13)), 'But remember, KEEP YOUR PIN SECRET!');
  assert.equal(text.get(line(15)), '');
  const other = realPlayer(t);
  assert.equal(read(other, 'Notice board', 24098), true, 'the second east bank board (24098) shows the same text (233/03237 t1280)');
  assert.deepEqual(other.sent.filter(([name]) => name === 'sendString'), strings);
  assert.deepEqual(p.sent.filter(([name]) => name !== 'sendString'), [
    ['sendClientScript', 2524, -1, -1],
    ['sendInterface', MESSAGESCROLL],
    ['sendVarbit', BUSY_VARBIT, 1],
  ]);
});

test("Varrock's Combat Scroll: Ali Morrisane's guide on lines 5-10 (240/1001336 t3727)", (t) => {
  const p = realPlayer(t);
  assert.equal(read(p, 'Combat Scroll', COMBAT_SCROLL), true);
  const text = new Map(p.sent.filter(([name]) => name === 'sendString').map(([, value, uid]) => [uid, value]));
  assert.equal(text.size, 15);
  assert.equal(text.get(line(4)), '');
  assert.equal(text.get(line(5)), "A Beginner's Guide to Killing Things");
  assert.equal(text.get(line(6)), 'by Ali Morrisane');
  assert.equal(text.get(line(8)), 'Step 1: Choose your target.');
  assert.equal(text.get(line(9)), 'Step 2: Hit it.');
  assert.equal(text.get(line(10)), 'Step 3: Go to Step 2.');
  assert.ok(p.sent.some(([name, id]) => name === 'sendInterface' && id === MESSAGESCROLL));
});

test('closing the scroll clears busy once; other interfaces and other readers are left alone', (t) => {
  const p = realPlayer(t);
  read(p, 'Notice board', NOTICE_BOARD);
  p.sent.length = 0;
  closed(p, 12);
  assert.deepEqual(p.sent, []);
  closed(p, MESSAGESCROLL);
  assert.deepEqual(p.sent, [['sendVarbit', BUSY_VARBIT, 0]]);
  closed(p, MESSAGESCROLL);
  assert.equal(p.sent.length, 1);
  const other = realPlayer(t);
  closed(other, MESSAGESCROLL);
  assert.deepEqual(other.sent, []);
});

test('another notice board (the Theatre of Blood board, 32655) falls through to its own handler', (t) => {
  const p = realPlayer(t);
  assert.equal(read(p, 'Notice board', 32655), false);
  assert.deepEqual(p.sent, []);
});

/** The route hook for a Read click on the loc at (x, y); returns the event after it ran. */
function route(p, objectId, x, y) {
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init();
  const at = p.getLocation();
  const event = {
    player: p, objectId, clickType: 1,
    object: new GameObject(objectId, new Location(x, y, 0), 4, 0, null),
    sourceLocation: { x: at.getX(), y: at.getY(), z: 0 }, destination: null,
  };
  hooks.route(event);
  return event;
}

test('the notice boards read where the player stands within 5 tiles: 3 and 5 tiles away in 233/03237', (t) => {
  const p = realPlayer(t, 3012, 3357);
  assert.deepEqual(route(p, NOTICE_BOARD, 3009, 3356).destination, { x: 3012, y: 3357, z: 0 });
  assert.deepEqual(route(p, 24098, 3017, 3358).destination, { x: 3012, y: 3357, z: 0 });
});

test('further than 5 tiles the player walks until within 5', (t) => {
  const p = realPlayer(t, 3003, 3356);
  const event = route(p, 24098, 3017, 3358);
  assert.equal(event.destination, null);
  assert.equal(event.approachRange, 5);
});

test('the Combat Scroll has no reading range: the normal walk-up route is left alone (232/03220)', (t) => {
  const p = realPlayer(t, 3251, 3439);
  const event = route(p, COMBAT_SCROLL, 3254, 3438);
  assert.equal(event.destination, null);
  assert.equal(event.approachRange, undefined);
});
