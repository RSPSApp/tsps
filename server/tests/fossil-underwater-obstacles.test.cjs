// Run after `yarn build`: node --test tests/fossil-underwater-obstacles.test.cjs
//
// Fossil Island's sea-floor obstacles and holes (Navigate) against rsprox 231/00712, 00714 and
// 00715, on a real Player: the swim past an obstacle, and the dive through a hole to its pair.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');

const hooks = { route: [], click: new Map() };
let core;

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  core = PluginManager.getCoreApi();
  require('../plugins/skills/Agility.plugin').register({
    core,
    getTaskManager: () => TaskManager,
    getItemOnGroundManager: () => ({ registerNonGlobals() {} }),
    persistAttribute() {},
    onObjectRoute: (handler) => hooks.route.push(handler),
    onObjectFirstClick: (ids, handler) => ids.forEach((id) => hooks.click.set(id, handler)),
    onCanTeleport() {},
    registerArea() {},
    onPlayerLogout() {},
    onPlayerLogin() {},
    onGroundItemPickup() {},
    onNpcInteraction() {},
    onCustomEvent() {},
    emitCustomEvent() {},
    log() {},
  });
});

function realPlayer(t, x, y) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.setLocation(new Location(x, y, 1));
  p.anims = [];
  p.xp = 0;
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, 'isRegistered', () => true);
  t.mock.method(p, 'performAnimation', (animation) => { p.anims.push(animation.getId()); });
  t.mock.method(p.getSkillManager(), 'addExperiences', () => { p.xp++; });
  return p;
}

const at = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

/** The click as the object packet makes it: the route hook, a walk to its tile, then the click. */
function navigate(p, id, x, y) {
  const object = MapObjects.get(id, new Location(x, y, 1), null);
  assert.ok(object, `${id} at ${x},${y}`);
  const route = { player: p, object, objectId: id, clickType: 1, destination: null };
  for (const handler of hooks.route) handler(route);
  if (route.destination) p.setLocation(new Location(route.destination.x, route.destination.y, route.destination.z));
  hooks.click.get(id)({ player: p, object, objectId: id, clickType: 1, location: { x, y, z: 1 }, handled: false });
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

test('an obstacle: from either side, the cave-wall swim to the far side, no XP (231/00714)', (t) => {
  const p = realPlayer(t, 3759, 10260);
  // The click runs the tick after arriving (when the recording faces it); the swim is the tick after.
  navigate(p, 30962, 3758, 10260);
  assert.deepEqual(p.anims, []);
  tick(1);
  assert.deepEqual(p.anims, [core.CacheDefinitions.getSeqId('human_swim_cavewall')]);
  tick(4);
  assert.deepEqual(at(p), [3757, 10260, 1]);
  navigate(p, 30962, 3758, 10260);
  tick(6);
  assert.deepEqual(at(p), [3759, 10260, 1], 'and back');
  assert.equal(p.xp, 0);
});

test('the ship-wall obstacle at 3754,10244 is crossed north-south, its join pieces east and west', (t) => {
  const p = realPlayer(t, 3754, 10245);
  navigate(p, 30964, 3754, 10244);
  tick(6);
  assert.deepEqual(at(p), [3754, 10243, 1]);
  assert.ok(p.anims.includes(core.CacheDefinitions.getSeqId('human_swim_shipwall')));
});

/** An open tile beside (x, y): where the normal object route leaves the player. */
function beside(x, y) {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if ((RegionManager.getClipping(x + dx, y + dy, 1, null) & 0x1280100) === 0) return [x + dx, y + dy];
  }
  throw new Error(`nothing open beside ${x},${y}`);
}

test('a hole: from beside it, a step on, then in; two ticks later out of its pair (3772,10267 to 3823,10247 as recorded)', (t) => {
  const [x, y] = beside(3772, 10267);
  const p = realPlayer(t, x, y);
  navigate(p, 30966, 3772, 10267);
  assert.deepEqual(at(p), [x, y, 1], 'no route of its own: the hole is solid');
  tick(1);
  assert.deepEqual(at(p), [3772, 10267, 1], 'onto the hole the tick after the click');
  tick(1);
  assert.deepEqual(p.anims, [core.CacheDefinitions.getSeqId('human_swim_hole_enter')]);
  tick(2);
  assert.deepEqual(at(p), [3823, 10247, 1]);
  assert.equal(p.anims.at(-1), core.CacheDefinitions.getSeqId('human_swim_hole_leave'), 'shown for a tick before the reset');
  tick(2);
  assert.equal(p.getAttribute('agility.obstacle') ?? null, null);
});

test('the tunnel (north-south) and the plant door (east-west) out of the dive area (231/00714)', (t) => {
  const p = realPlayer(t, 3764, 10282);
  navigate(p, 30959, 3764, 10281);
  tick(5);
  assert.deepEqual(at(p), [3764, 10280, 1]);
  const q = realPlayer(t, 3768, 10288);
  navigate(q, 30960, 3767, 10288);
  tick(5);
  assert.deepEqual(at(q), [3766, 10288, 1]);
});

test("a player off to one side is routed to their own side's end", (t) => {
  const { build } = require('../plugins/skills/agility/shortcuts/ShortcutData.Agility');
  const p = realPlayer(t, 3765, 10247); // north-east of 3763,10244: as far from either end, nearer the east one
  const object = MapObjects.get(30962, new Location(3763, 10244, 1), null);
  const route = { player: p, object, objectId: 30962, clickType: 1, destination: null };
  for (const handler of hooks.route) handler(route);
  assert.deepEqual([route.destination.x, route.destination.y], [3764, 10244]);
  assert.ok(build);
});

test('every hole leads to another hole, and back', (t) => {
  const data = require('../plugins/skills/data/agility-shortcuts.json').shortcuts.filter((entry) => entry.object === 30966);
  assert.equal(data.length, 10, 'all ten holes in the map');
  const key = ([x, y]) => `${x},${y}`;
  const target = new Map(data.map((entry) => [key(entry.at), key(entry.steps.find((step) => step.tele).tele)]));
  for (const [from, to] of target) assert.equal(target.get(to), from, `${from} -> ${to}`);
});

test('a double click mid-swim changes nothing', (t) => {
  const p = realPlayer(t, 3759, 10260);
  navigate(p, 30962, 3758, 10260);
  tick(2);
  hooks.click.get(30962)({ player: p, object: MapObjects.get(30962, new Location(3758, 10260, 1), null), objectId: 30962, clickType: 1, location: { x: 3758, y: 10260, z: 1 }, handled: false });
  tick(6);
  assert.deepEqual(at(p), [3757, 10260, 1]);
});

test('out of oxygen, back-to-back hole crossings no longer put off drowning: it comes the first tick between swims', (t) => {
  const Underwater = require('../plugins/areas/FossilIslandUnderwater.plugin');
  Underwater.register(new Proxy({ core, onServerStartup: (fn) => fn() }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
  const [x, y] = beside(3772, 10267);
  const p = realPlayer(t, x, y);
  t.after(() => Underwater._test.oxygen.delete(p));
  Underwater._test.followWater(p);
  assert.ok(Underwater._test.oxygen.has(p), 'under water');
  Underwater._test.oxygen.set(p, 0);
  const holes = [[3772, 10267], [3823, 10247]];
  for (let crossing = 0; crossing < 20 && Underwater._test.oxygen.has(p); crossing++) {
    const [hx, hy] = holes[crossing % 2];
    const [bx, by] = beside(hx, hy);
    if (at(p)[0] !== bx || at(p)[1] !== by) p.setLocation(new Location(bx, by, 1));
    navigate(p, 30966, hx, hy);
    tick(6);
  }
  assert.equal(Underwater._test.oxygen.has(p), false, 'drowned and out of the water');
});

test('out of oxygen and not mid-swim, the very next underwater tick drowns the player, not only a drain tick', (t) => {
  const Underwater = require('../plugins/areas/FossilIslandUnderwater.plugin');
  const [x, y] = beside(3823, 10247);
  const p = realPlayer(t, x, y);
  t.after(() => Underwater._test.oxygen.delete(p));
  Underwater._test.followWater(p); // just in: the drain count starts again
  Underwater._test.oxygen.set(p, 0);
  Underwater._test.underwaterTick(); // the first of three ticks to the next drain
  assert.equal(Underwater._test.oxygen.has(p), false, 'drowned on the first idle tick');
});
