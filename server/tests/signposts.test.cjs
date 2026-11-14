// Run after `yarn build`: node --test tests/signposts.test.cjs
//
// The guide signposts (aide_signpost_1, 18493) against rsprox 229/02346 and 223/01318: the four
// texts in aide_compass (135), the north-facing camera, and the camera reset when it closes.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Location } = require('../dist/game/model/Location');

let Signposts;
const hooks = { objects: {}, custom: {} };

before(() => {
  CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onObjectInteraction: (name, actions) => { hooks.objects[name] = actions; },
    onCustomEvent: (name, handler) => { (hooks.custom[name] ??= []).push(handler); },
    onObjectRoute: (handler) => { hooks.route = handler; },
  };
  Signposts = require('../plugins/objects/Signposts.plugin');
  Signposts.register(api);
});

/** A real Player with only the network stubbed; what it sends is recorded in order. */
function realPlayer(t, x, y) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setLocation(new Location(x, y, 0));
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  const sender = p.getPacketSender();
  p.sent = [];
  for (const name of ['sendString', 'sendInterface', 'sendClientScript', 'sendCameraMoveTo', 'sendCameraLookAt', 'sendCameraReset']) {
    const original = sender[name];
    t.mock.method(sender, name, function (...args) { p.sent.push([name, ...args]); return original.apply(this, args); });
  }
  return p;
}

const read = (p, x, y) => hooks.objects.Signpost.Read({ player: p, objectId: 18493, option: 'read', clickType: 1, location: { x, y, z: 0 }, handled: false });
const closed = (p, interfaceId) => { for (const handler of hooks.custom['interface:closed']) handler({ player: p, interfaceId }); };

test('west of the Lumbridge bridge, from (3235, 3223): the recorded texts, the compass, and the camera (229/02346)', (t) => {
  const p = realPlayer(t, 3235, 3223);
  assert.equal(read(p, 3235, 3228), true);
  const strings = new Map(p.sent.filter(([name]) => name === 'sendString').map(([, text, uid]) => [uid, text]));
  assert.equal(strings.get((135 << 16) | 2), "Head north towards Fred's farm and the windmill.");
  assert.equal(strings.get((135 << 16) | 7), 'Cross the bridge and head east to Al Kharid or north to Varrock.');
  assert.equal(strings.get((135 << 16) | 8), 'South to the swamps of Lumbridge.');
  assert.equal(strings.get((135 << 16) | 11), 'West to the Lumbridge Castle and Draynor Village. Beware the goblins!');
  const rest = p.sent.filter(([name]) => name !== 'sendString');
  assert.deepEqual(rest, [
    ['sendClientScript', 143, 280, 0],
    ['sendCameraMoveTo', 3235, 3217, 1500, { rate: 2, rate2: 10, heightRelative: false }],
    ['sendCameraLookAt', 3235, 3226, 450, { rate: 2, rate2: 10, heightRelative: false }],
    ['sendClientScript', 2524, -1, -1],
    ['sendInterface', 135],
  ]);
});

test("each signpost has its own lines: the east bridge's toll warning (223/01318)", (t) => {
  const p = realPlayer(t, 3261, 3226);
  read(p, 3261, 3230);
  const east = p.sent.find(([name, , uid]) => name === 'sendString' && uid === ((135 << 16) | 7));
  assert.equal(east[1], 'East to Al Kharid - toll gate; bring some money.');
  for (const [x, y] of [[3107, 3296], [2983, 3278]]) assert.ok(Signposts.signpostAt({ x, y, z: 0 }), `${x},${y}`);
});

test('closing the compass resets the camera once; another interface closing does not', (t) => {
  const p = realPlayer(t, 3235, 3223);
  read(p, 3235, 3228);
  closed(p, 12);
  closed(p, 135);
  closed(p, 135);
  assert.equal(p.sent.filter(([name]) => name === 'sendCameraReset').length, 1);
});

test('reading twice keeps the camera on the second read', (t) => {
  const p = realPlayer(t, 3235, 3223);
  read(p, 3235, 3228);
  closed(p, 135); // the click closes the open compass first
  p.setLocation(new Location(3236, 3225, 0));
  read(p, 3235, 3228);
  const look = p.sent.filter(([name]) => name === 'sendCameraLookAt').at(-1);
  assert.deepEqual(look.slice(0, 4), ['sendCameraLookAt', 3236, 3228, 450]);
  closed(p, 135);
  assert.equal(p.sent.at(-1)[0], 'sendCameraReset');
});

test('a signpost with no recorded lines is left to other handlers', (t) => {
  const p = realPlayer(t, 3443, 4834);
  assert.equal(read(p, 3443, 4836), false);
  assert.deepEqual(p.sent, []);
});

test('read from where you stand within 5 tiles with a clear view, walk from 6 (229/02347 walked on through 6-9)', (t) => {
  const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  RegionManager.init();
  const post = new GameObject(18493, new Location(3235, 3228, 0), 10, 0, null);
  const route = (p) => {
    const at = p.getLocation();
    const event = { player: p, object: post, objectId: 18493, clickType: 1, sourceLocation: { x: at.getX(), y: at.getY(), z: 0 }, destination: null };
    Signposts.readFromAfar(event);
    return event.destination;
  };
  assert.deepEqual(route(realPlayer(t, 3235, 3223)), { x: 3235, y: 3223, z: 0 });
  assert.deepEqual(route(realPlayer(t, 3237, 3234)), { x: 3237, y: 3234, z: 0 }, 'five tiles north of its top edge');
  assert.equal(route(realPlayer(t, 3232, 3222)), null, 'six tiles away walks, as recorded');
  assert.equal(route(realPlayer(t, 3232, 3219)), null, 'nine tiles away walks');
});

test('a read from nine tiles away walks only until five tiles off, then reads there (223/01318 t3254, t4085)', (t) => {
  const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const { World } = require('../dist/game/World');
  RegionManager.init();
  RegionManager.loadMapFiles(3235, 3228, true);
  const post = MapObjects.get(18493, new Location(3235, 3228, 0), null);
  assert.ok(post, 'the real map signpost');
  const p = realPlayer(t, 3235, 3219);
  p.setIndex(4321);
  p.setRunning?.(false);
  const queue = p.getMovementQueue();
  t.after(() => TaskManager.cancelTasks(p.getIndex()));
  const event = { player: p, object: post, objectId: 18493, clickType: 1, sourceLocation: { x: 3235, y: 3219, z: 0 }, destination: null };
  Signposts.readFromAfar(event);
  assert.equal(event.destination, null);
  assert.equal(event.approachRange, 5);
  t.mock.method(PluginManager, 'emitObjectRoute', (routeEvent) => Signposts.readFromAfar(routeEvent));
  const reads = [];
  queue.walkToObject(post, { execute: () => reads.push([p.getLocation().getX(), p.getLocation().getY()]) }, 1);
  for (let i = 0; i < 12 && reads.length === 0; i++) {
    World.processCycle++;
    TaskManager.process();
    queue.beginCycle?.();
    if (queue.hasPendingWork?.()) queue.process();
    TaskManager.processWalkTo(p.getIndex());
  }
  assert.deepEqual(reads, [[3235, 3223]], 'read on the step that reaches five tiles south of the post');
  assert.equal(queue.isAtDestination(), true, 'and stops there');
});
