// Run after `yarn build`: node --test tests/ernest-puzzle-doors.test.cjs
// Issue #2270: Ernest the Chicken oil-room puzzle doors, through the real cache map and the
// quest's own route and object handlers. Facts from the cache (type 10, face 0 = wall on the door
// tile's west edge, face 3 = south edge): doors 1-5 are crossed east-west, doors 6-9 north-south.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(require('node:path').resolve(__dirname, '..'));
  require('../dist/game/collision/RegionManager').RegionManager.init();
});

const { PluginManager } = require('../dist/plugins/PluginManager');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');

const LEVERS_ATTRIBUTE = 'ernest-the-chicken.levers';
const DOOR_IDS = [137, 138, 139, 140, 141, 142, 143, 144, 145];
const DOOR_TILES = [[3105, 9765], [3100, 9765], [3105, 9760], [3100, 9760], [3100, 9755], [3102, 9763], [3097, 9763], [3108, 9758], [3102, 9758]];
// [id, tile, face, lever bits that open it (recorded)]
const DOORS = DOOR_TILES.map((tile, index) => [DOOR_IDS[index], tile, index < 5 ? 0 : 3, [56, 40, 1, 8, 44, 40, 8, 3, 8][index]]);
const NEIGHBOURS = [['self', 0, 0], ['E', 1, 0], ['W', -1, 0], ['N', 0, 1], ['S', 0, -1]];

function hex(value) { return '0x' + (value >>> 0).toString(16); }

function scene() {
  const routes = [];
  const objects = [];
  const noop = () => {};
  const apiMethods = new Set(Object.keys(PluginManager.createApi('ErnestDoors')));
  const base = {
    core: PluginManager.getCoreApi(),
    onObjectRoute: (h) => routes.push(h),
    onObjectInteraction: (h) => { if (typeof h === 'function') objects.push(h); },
    persistAttribute: noop,
    onCustomEvent: noop,
    emitCustomEvent: noop,
  };
  const api = new Proxy(base, { get(target, prop) {
    if (prop in target) return target[prop];
    if (apiMethods.has(prop)) return noop;
    throw Error('Unknown PluginApi member: ' + String(prop));
  } });
  require('../plugins/quests/quests/ErnestTheChicken.Quest')(api);
  const attributes = new Map();
  const messages = [];
  let location;
  const sender = new Proxy({}, { get: () => () => sender });
  const inventory = { getAmount: () => 0, isFull: () => false, adds: noop, deleteNumber: noop };
  const player = {
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inventory, getPacketSender: () => sender,
    getUsername: () => 'T', getDisplayName: () => 'T', getPrivateArea: () => null,
    isPlayer: () => true, getAsPlayer: () => player, getLocation: () => location,
    moveTo: (tile) => { location = tile; }, sendMessage: (text) => messages.push(text),
    performAnimation: noop,
  };
  return { api, routes, objects, player, messages, attributes };
}


function dispatch(env, id, tile, bits, from) {
  const { api, routes, objects, player, attributes } = env;
  const { Location } = api.core;
  const [x, y] = tile;
  const object = MapObjects.get(id, new Location(x, y, 0), null);
  assert.ok(object, `door ${id} exists in the cache map`);
  attributes.set(LEVERS_ATTRIBUTE, bits);
  player.moveTo(from);
  const route = { player, object, objectId: id, sourceLocation: { x: from.getX(), y: from.getY(), z: 0 } };
  routes.forEach((h) => h(route));
  if (route.destination) player.moveTo(new Location(route.destination.x, route.destination.y, 0));
  const reached = player.getLocation();
  const event = { player, object, objectId: id, location: { x, y, z: 0 }, clickType: 1, definition: object.getDefinition() };
  objects.forEach((h) => h(event));
  return { event, reached, end: player.getLocation() };
}

test('Ernest puzzle doors cross to the opposite side of their wall from every tile that can reach them', () => {
  const env = scene();
  const { Location } = env.api.core;
  for (const [id, [x, y], face, bits] of DOORS) {
    // Unit step across the wall: face 0 opens west, face 3 opens south.
    const [sx, sy] = face === 0 ? [-1, 0] : [0, -1];
    const near = new Location(x - sx, y - sy, 0);
    const far = new Location(x + sx, y + sy, 0);
    const label = `door ${id} (${x},${y})`;
    const cases = [
      ['near side', near, far],
      ['far side', far, near],
      ['on the door tile', new Location(x, y, 0), far],
    ];
    for (const [name, from, expected] of cases) {
      const { event, end } = dispatch(env, id, [x, y], bits, from);
      assert.equal(event.handled, true, `${label} ${name}: handled`);
      assert.deepEqual([end.getX(), end.getY()], [expected.getX(), expected.getY()], `${label} ${name}: lands across the wall`);
      assert.equal(RegionManager.blocked(end, null), false, `${label} ${name}: lands on a walkable tile`);
    }
    // The side tiles along the wall: the click is routed to a tile across the wall first.
    for (const [, dx, dy] of NEIGHBOURS) {
      const from = new Location(x + dx, y + dy, 0);
      if ((!dx && !dy) || dx * sx + dy * sy !== 0) continue; // the door tile and across tiles are covered above
      if (RegionManager.blocked(from, null)) continue;
      const { event, reached, end } = dispatch(env, id, [x, y], bits, from);
      assert.equal(event.handled, true, `${label} side tile (${from.getX()},${from.getY()}): handled`);
      const acrossTiles = [near, far].map((t) => `${t.getX()},${t.getY()}`);
      assert.ok(acrossTiles.includes(`${reached.getX()},${reached.getY()}`), `${label} side tile: routed to a tile across the wall, got (${reached.getX()},${reached.getY()})`);
      assert.ok(acrossTiles.includes(`${end.getX()},${end.getY()}`), `${label} side tile: ends across the wall, got (${end.getX()},${end.getY()})`);
      assert.notDeepEqual([end.getX(), end.getY()], [reached.getX(), reached.getY()], `${label} side tile: crosses`);
      assert.equal(RegionManager.blocked(end, null), false, `${label} side tile: lands on a walkable tile`);
    }
  }
});

test('Ernest puzzle doors stay locked when the levers have not opened them', () => {
  const env = scene();
  const { Location } = env.api.core;
  const { event, end } = dispatch(env, 137, [3105, 9765], 0, new Location(3106, 9765, 0));
  assert.equal(event.handled, true);
  assert.deepEqual([end.getX(), end.getY()], [3106, 9765]);
  assert.match(env.messages.at(-1), /locked firmly/);
});
