// Run after `yarn build`: node --test tests/object-reach.test.cjs
// Reference: OpenRune ReachStrategy, ProtectedAccess.arriveDelay and LadderScript.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { RsmodRouteFinding } = require('../dist/game/model/movement/path/RsmodRouteFinding');
const { PathFinder } = require('../dist/game/model/movement/path/PathFinder');
const { MovementQueue } = require('../dist/game/model/movement/MovementQueue');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { GameObject } = require('../dist/game/entity/impl/object/GameObject');
const { Location } = require('../dist/game/model/Location');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { World } = require('../dist/game/World');
const { ItemOnGroundManager } = require('../dist/game/entity/impl/grounditem/ItemOnGroundManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { Item } = require('../dist/game/model/Item');
const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Sounds } = require('../dist/game/Sounds');

const { ItemOnGround, State } = require('../dist/game/entity/impl/grounditem/ItemOnGround');
const target = { level: 0, destX: 100, destY: 100, srcSize: 1, privateArea: null };

let cacheReady;
function ensureCache() {
  if (!cacheReady) {
    const path = require('node:path');
    const { CachePipeline } = require('../dist/game/cache/CachePipeline');
    cacheReady = CachePipeline.initialize(path.resolve(__dirname, '..'));
  }
  return cacheReady;
}

test('wall-door crossings align both coordinates for every face and angled approach', () => {
  const { crossingFor } = require('../plugins/objects/WallDoor.Doors');
  for (let face = 0; face < 4; face++) {
    const door = new GameObject(30112, new Location(100, 100, 0), 0, face, null);
    const [dx, dy] = [[-1,0],[0,1],[1,0],[0,-1]][face];
    const tile = {x:100,y:100,z:0},neighbour={x:100+dx,y:100+dy,z:0};
    for (const side of [-1,1]) for (const offset of [-5,-1,0,1,5]) {
      const source = {x:100+dx*side*4+dy*offset,y:100+dy*side*4+dx*offset,z:0};
      const crossing = crossingFor(door, source);
      assert.deepEqual(crossing.approach, side>0?neighbour:tile);
      assert.deepEqual(crossing.destination, side>0?tile:neighbour);
      assert.equal(Math.abs(crossing.approach.x-crossing.destination.x)+Math.abs(crossing.approach.y-crossing.destination.y),1);
    }
    assert.deepEqual(crossingFor(door,tile),{approach:tile,destination:neighbour});
  }
  assert.equal(crossingFor(new GameObject(30112,new Location(100,100,0),2,0,null),target),null,'corner walls need their own route');
});

test('object reach respects cardinal sides, walls, rotated footprints and access masks', () => {
  let wall = 0;
  const route = new RsmodRouteFinding(() => wall);
  const reached = (x, y, options = {}) => route.reachedAbsolute({ ...target, locShape: 10, srcX: x, srcY: y, ...options });
  assert.equal(reached(99, 99), false, 'diagonals cannot operate a loc');
  assert.equal(reached(98, 100), false);
  for (const [x, y, flag] of [[99, 100, 8], [101, 100, 128], [100, 99, 2], [100, 101, 32]]) {
    wall = 0;
    assert.equal(reached(x, y), true);
    wall = flag;
    assert.equal(reached(x, y), false, 'a wall blocks the shared edge');
  }
  wall = 0;
  // Cache ladder 132 has clipMask=27: only the south side is accessible at angle 0.
  for (let angle = 0; angle < 4; angle++) {
    const sides = [[100, 99], [99, 100], [100, 101], [101, 100]];
    for (let side = 0; side < sides.length; side++) {
      assert.equal(reached(...sides[side], { locAngle: angle, blockAccessFlags: 27 }), side === angle);
    }
  }
  assert.equal(reached(101, 102, { destWidth: 2, destLength: 3 }), true, 'inside the footprint');
  assert.equal(reached(103, 101, { destWidth: 2, destLength: 3, locAngle: 1 }), true);
  assert.equal(reached(103, 102, { destWidth: 2, destLength: 3, locAngle: 1 }), false);
  assert.equal(reached(100, 100, { locShape: -2 }), false, 'entity reach excludes overlap');
});

test('large actors can reach walls and decorations inside their footprint', () => {
  const route = new RsmodRouteFinding(() => 0x2401ff);
  for (let shape = 0; shape <= 9; shape++) {
    for (let angle = 0; angle < 4; angle++) {
      assert.equal(route.reachedAbsolute({ ...target, srcX: 99, srcY: 99, srcSize: 2, locShape: shape, locAngle: angle }), true);
    }
  }
});

test('wall approach masks reject door flanks in both reach checks and route searches', () => {
  const route = new RsmodRouteFinding(() => 0);
  for (let face = 0; face < 4; face++) {
    const [dx, dy] = [[-1, 0], [0, 1], [1, 0], [0, -1]][face];
    const door = { ...target, locShape: 0, locAngle: face, blockAccessFlags: 0x5 };
    const valid = [[100, 100], [100 + dx, 100 + dy]];
    for (let x = 98; x <= 102; x++) for (let y = 98; y <= 102; y++) {
      const options = { ...door, srcX: x, srcY: y };
      assert.equal(route.reachedAbsolute(options), valid.some(([vx, vy]) => x === vx && y === vy));
      const path = route.findRoute(options);
      assert.equal(path.alternative, false);
      assert.ok(valid.some(([vx, vy]) => path.endX === vx && path.endY === vy), `face ${face}: ${x},${y}`);
    }
    // An unmarked wall ladder keeps the ordinary wall reach strategy.
    assert.equal(route.reachedAbsolute({ ...door, srcX: 100 + dy, srcY: 100 + dx, blockAccessFlags: 0 }), true);
    for (const [x, y] of [[98, 98], [98, 100], [100, 98], [101, 101]]) {
      const options = { ...door, srcX: x, srcY: y, srcSize: 2 };
      assert.equal(route.reachedAbsolute(options), valid.some(([vx, vy]) =>
        vx >= x && vx < x + 2 && vy >= y && vy < y + 2));
    }
  }

  const blocked = new RsmodRouteFinding((x, y) => x === 100 && y === 100 ? 0x100 : 0);
  const otherSide = blocked.findRoute({ ...target, locShape: 0, locAngle: 2, blockAccessFlags: 0x5,
    srcX: 100, srcY: 99 });
  assert.deepEqual([otherSide.endX, otherSide.endY], [101, 100], 'use the other reachable face when one tile is blocked');
  const sealed = new RsmodRouteFinding((x, y) => y === 100 && (x === 100 || x === 101) ? 0x100 : 0);
  const near = sealed.findRoute({ ...target, locShape: 0, locAngle: 2, blockAccessFlags: 0x5,
    srcX: 100, srcY: 99 });
  assert.equal(near.alternative, true);
  assert.equal(sealed.reachedAbsolute({ ...target, locShape: 0, locAngle: 2, blockAccessFlags: 0x5,
    srcX: near.endX, srcY: near.endY }), false, 'move-near cannot make a blocked doorway operable');
});


test('straight wall decorations 4/5 use the wall-deco edge checks, not the open side', async () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  await ensureCache();
  ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(1632, 4833, true);
  assert.equal(RegionManager.getClipping(1631, 4833, 0, null), 0, 'library side is open');
  assert.equal(RegionManager.getClipping(1633, 4833, 0, null) & 0x80, 0x80, 'corridor side has the wall');

  const player = { getPacketSender: () => ({ getVarbit: id => id === 3468 ? 40 : 0, getVarp: () => 0 }) };
  const painting = ObjectDefinition.forPlayer(29650, player);
  assert.equal(painting?.id, 30125, 'cache 29650 resolves to the visible Painting 30125');
  assert.equal(painting?.getBlockingMask(), 0);

  const stand = (x, y, size = 1) => ({
    getLocation: () => new Location(x, y, 0),
    getSize: () => size,
    getPrivateArea: () => null,
  });
  // 29650 is shape 4, face 2 at 1632,4833. The library/west side is the only
  // open side; the corridor/east side is behind the wall and stays unreachable.
  for (const shape of [4, 5]) {
    assert.equal(PathFinder.reachedObject(stand(1631, 4833), 1632, 4833, 1, 1, 2, shape, 0), true,
      `shape ${shape} library side`);
    assert.equal(PathFinder.reachedObject(stand(1633, 4833), 1632, 4833, 1, 1, 2, shape, 0), false,
      `shape ${shape} corridor side stays blocked`);
    // Non-overlapping size-2 footprints: the east edge (1631) is adjacent to the
    // painting, so this exercises reachWallDecoN rather than the overlap shortcut.
    assert.equal(PathFinder.reachedObject(stand(1630, 4833, 2), 1632, 4833, 1, 1, 2, shape, 0), true,
      `shape ${shape} non-overlapping size-2 library footprint`);
    assert.equal(PathFinder.reachedObject(stand(1633, 4833, 2), 1632, 4833, 1, 1, 2, shape, 0), false,
      `shape ${shape} non-overlapping size-2 corridor footprint stays blocked`);
  }
  // Diagonal wall-deco forms and the other shape families keep their existing rules.
  assert.equal(PathFinder.reachedObject(stand(1633, 4833), 1632, 4833, 1, 1, 2, 6, 0), false);
  assert.equal(PathFinder.reachedObject(stand(1632, 4832), 1632, 4833, 1, 1, 2, 7, 0), true);
  assert.equal(PathFinder.reachedObject(stand(1631, 4833), 1632, 4833, 1, 1, 2, 8, 0), true);
  assert.equal(PathFinder.reachedObject(stand(1631, 4833), 1632, 4833, 1, 1, 2, 10, 0), true);
});

test('clipped type-10 crate 16560 uses its real wall sides without unmasked through-wall reach', async () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  await ensureCache();
  ObjectDefinition.init();
  RegionManager.init();
  RegionManager.loadMapFiles(2951, 3508, true);
  const crate = MapObjects.get(16560, new Location(2951, 3508, 0), null);
  assert.ok(crate, 'real west goblin crate exists');
  const def = ObjectDefinition.forId(16560);
  assert.deepEqual([crate.getType(), def.getSizeX(), def.getSizeY(), def.getBlockingMask()], [10, 1, 1, 0]);

  const stand = (x, y) => ({
    getLocation: () => new Location(x, y, 0),
    getSize: () => 1,
    getPrivateArea: () => null,
  });
  // Real clipping: west/south are the wall/corridor sides; east/north satisfy the
  // type-10 rectangle reach. The failed native tile 2950,3508 is correctly false.
  assert.equal(PathFinder.reachedObject(stand(2950, 3508), 2951, 3508, 1, 1, 2, 10, 0), false,
    'west wall side is not a type-10 reach side');
  assert.equal(PathFinder.reachedObject(stand(2951, 3509), 2951, 3508, 1, 1, 2, 10, 0), false,
    'south wall side is not a type-10 reach side');
  assert.equal(PathFinder.reachedObject(stand(2952, 3508), 2951, 3508, 1, 1, 2, 10, 0), true,
    'east side is a legitimate type-10 reach side');
  assert.equal(PathFinder.reachedObject(stand(2951, 3507), 2951, 3508, 1, 1, 2, 10, 0), true,
    'north side is a legitimate type-10 reach side');

  const player = {
    isPlayer: () => true, isNpc: () => false, getAsPlayer() { return this; },
    getIndex: () => 1, getUsername: () => 'crate-reach', getSize: () => 1,
    getLocation: () => new Location(2950, 3508, 0),
    getPrivateArea: () => null,
    getPacketSender: () => ({ getVarbit: () => 0, getVarp: () => 0 }),
  };
  const queue = new MovementQueue(player);
  const spec = queue.buildObjectRouteSpec(crate);
  assert.deepEqual([spec.reachShape, spec.reachWidth, spec.reachLength, spec.reachAngle, spec.reachBlockAccessFlags],
    [10, 1, 1, 2, 0], 'type-10 spec matches the direct reach inputs');
  assert.equal(PathFinder.reachedObject(player, 2951, 3508, spec.reachWidth, spec.reachLength,
    spec.reachAngle, spec.reachShape, spec.reachBlockAccessFlags), false,
    'the spec does not silently accept the wall side');
  assert.equal(queue.isMountedDecorationReachable(crate, 0, 2), false,
    'mask 0 declares no mounted front, so the heuristic cannot grant through-wall reach');
  const east = { ...player, getLocation: () => new Location(2952, 3508, 0) };
  assert.equal(PathFinder.reachedObject(east, 2951, 3508, spec.reachWidth, spec.reachLength,
    spec.reachAngle, spec.reachShape, spec.reachBlockAccessFlags), true,
    'the same spec accepts the legitimate east side');

  // The legitimate east tile is already adjacent, so the real walkToObject route
  // fires the Search action without moving; the west tile never gets this far.
  const noop = () => {};
  let eastLocation = new Location(2952, 3508, 0);
  const eastPlayer = {
    ...east,
    isPlayerBot: () => false, getIndex: () => 4242, getRights: () => -1,
    getLocation: () => eastLocation,
    getInventory: () => ({ capacity: () => 28, getItems: () => [] }),
    getPacketSender: () => ({ getVarbit: () => 0, getVarp: () => 0, sendDestination: noop }),
    getFollowing: () => null, getTimers: () => ({ has: () => false }), getHitpoints: () => 10,
    getCombat: () => ({ setCastSpell: noop, reset: noop }), getSkillManager: () => ({ stopSkillable: noop }),
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    setPositionToFace: noop, setDirection: noop, setWalkingDirection: noop, setRunningDirection: noop,
    sendMessage: noop, isRunningReturn: () => false, setRunning: noop,
  };
  const eastQueue = new MovementQueue(eastPlayer);
  eastPlayer.getMovementQueue = () => eastQueue;
  eastQueue.getMobility = () => ({ canMove: () => true });
  eastQueue.checkDestination = () => true;
  eastQueue.walkToReset = noop;
  let searched = 0;
  eastQueue.walkToObject(crate, { execute: () => { searched++; } });
  for (let i = 0; i < 10 && searched === 0; i++) {
    World.processCycle++;
    TaskManager.process();
    eastQueue.beginCycle?.();
    if (eastQueue.hasPendingWork?.()) eastQueue.process();
    TaskManager.processWalkTo(eastPlayer.getIndex());
  }
  assert.equal(searched, 1, 'the legitimate east side operates the crate');
  TaskManager.cancelTasks(eastPlayer.getIndex());
});

test('stage 6 painting resolves to its MORPH child and west-adjacent canvas reach', async () => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  await ensureCache();
  ObjectDefinition.init();
  RegionManager.init();
  const regionId = RegionManager.regionIdForTile(1719, 9706);
  RegionManager.loadMapFiles(1719, 9706, true);
  assert.ok(RegionManager.getRegionid(regionId)?.isLoaded(), 'real map region loaded');
  assert.ok(MapObjects.get(56522, new Location(1719, 9706, 0), null), 'real raw painting exists');
  const player = { getPacketSender: () => ({ getVarbit: id => id === 16663 ? 6 : 0, getVarp: () => 0 }) };
  const painting = ObjectDefinition.forPlayer(56522, player);
  assert.equal(painting.id, 56523);
  assert.deepEqual([painting.getSizeX(), painting.getSizeY(), painting.getBlockingMask()], [1, 2, 23]);
  const stand = {
    getLocation: () => ({ getZ: () => 0, getX: () => 1718, getY: () => 9706 }),
    getSize: () => 1, getPrivateArea: () => null,
  };
  assert.equal(RegionManager.getClipping(1718, 9706, 0, null), 8, 'drawing wall blocks the west edge');
  const atTile = MapObjects.mapObjects.get(MapObjects.getHash(1719, 9706, 0)) ?? [];
  assert.ok(atTile.some(o => o.getId() === 24720 && o.getType() === 0), 'painting is mounted on a wall');
  assert.equal(PathFinder.reachedObject(stand, 1719, 9706, painting.getSizeX(), painting.getSizeY(),
    0, 10, painting.getBlockingMask()), false, 'plain rectangle reach rejects the mounted-wall edge');
  const plain = ObjectDefinition.forPlayer(56523, player);
  assert.deepEqual([plain.getSizeX(), plain.getSizeY(), plain.getBlockingMask()],
    [painting.getSizeX(), painting.getSizeY(), painting.getBlockingMask()],
    'untransformed routing keeps the same footprint and mask');
});

test('stage 6 canvas dispatches on the painting through the real item-on-object route', async (t) => {
  const { RegionManager } = require('../dist/game/collision/RegionManager');
  await ensureCache();
  ObjectDefinition.init();
  RegionManager.init();
  const regionId = RegionManager.regionIdForTile(1719, 9706);
  RegionManager.loadMapFiles(1719, 9706, true);
  assert.ok(RegionManager.getRegionid(regionId)?.isLoaded(), 'real map region loaded');
  const painting = MapObjects.get(56522, new Location(1719, 9706, 0), null);
  assert.ok(painting, 'real raw painting exists');

  const noop = () => {};
  let location = new Location(1718, 9706, 0);
  const player = {
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => false, getAsPlayer() { return this; },
    getIndex: () => 999, getUsername: () => 'canvas-route', getSize: () => 1, getRights: () => -1,
    getLocation: () => location, getPrivateArea: () => null,
    getPacketSender: () => ({ getVarbit: id => id === 16663 ? 6 : 0, getVarp: () => 0, sendDestination: noop }),
    getInventory: () => ({ capacity: () => 28, getItems: () => [new Item(30950, 1)] }),
    getPacketSender: () => ({ getVarbit: () => 0, getVarp: () => 0, sendDestination: noop }),
    getFollowing: () => null, getTimers: () => ({ has: () => false }), getHitpoints: () => 10,
    getCombat: () => ({ setCastSpell: noop, reset: noop }), getSkillManager: () => ({ stopSkillable: noop }),
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    setPositionToFace: noop, setDirection: noop, setWalkingDirection: noop, setRunningDirection: noop,
    sendMessage: noop,
  };
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;
  queue.getMobility = () => ({ canMove: () => true });
  queue.checkDestination = () => true;
  queue.walkToReset = noop;
  const seen = [];
  t.mock.method(PluginManager, 'emitCanUseItem', () => true);
  t.mock.method(PluginManager, 'emitItemOnObject', event => { seen.push(event); event.handled = true; return true; });
  t.after(() => TaskManager.cancelTasks(player.getIndex()));

  UseItemPacketListener.itemOnObject(player, 149, 56522, 30950, 0, 1719, 9706);
  for (let i = 0; i < 10 && seen.length === 0; i++) {
    World.processCycle++;
    TaskManager.process();
    queue.beginCycle?.();
    if (queue.hasPendingWork?.()) queue.process();
    TaskManager.processWalkTo(player.getIndex());
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0].objectId, 56522);
  assert.equal(seen[0].itemId, 30950);
  assert.deepEqual([seen[0].location.x, seen[0].location.y], [1719, 9706]);

  assert.equal(queue.isMountedDecorationReachable(painting, 23, 0), true, 'west mounting-wall edge allowed');
  for (const [x, y] of [[1720, 9706], [1719, 9705], [1719, 9708]]) {
    location = new Location(x, y, 0);
    assert.equal(queue.isMountedDecorationReachable(painting, 23, 0), false,
      `mask23 blocks non-west approach ${x},${y}`);
  }
  location = new Location(1718, 9706, 0);
  assert.equal(queue.isMountedDecorationReachable(painting, 23, 1), false,
    'rotated mask23 still blocks the west edge');
  assert.equal(queue.isMountedDecorationReachable(painting, 0, 0), false,
    'ordinary default mask0 is not a single declared front');
  const wrongWall = new GameObject(56522, new Location(1711, 9711, 0), 10, 0, null);
  MapObjects.add(wrongWall);
  t.after(() => MapObjects.remove(wrongWall));
  location = new Location(1710, 9711, 0);
  assert.equal(queue.isMountedDecorationReachable(wrongWall, 23, 0), false,
    'wall orientation must match the declared front edge');
  location = new Location(1718, 9706, 1);
  assert.equal(queue.isMountedDecorationReachable(painting, 23, 0), false,
    'different floor has no mounted wall');
});

test('every walkToObject caller shares route masks and cannot operate a door from its flank', (t) => {
  const noop = () => {};
  let location = new Location(100, 99, 0);
  const player = {
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => true, getAsPlayer() { return this; },
    getIndex: () => 1, getUsername: () => 'door-reach', getSize: () => 1,
    getLocation: () => location, getPrivateArea: () => null, setPositionToFace: noop, setDirection: noop,
  };
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;
  queue.getMobility = () => ({ canMove: () => true });
  queue.checkDestination = () => true;
  queue.walkToReset = noop;
  const definition = { getName: () => 'Door' };
  t.mock.method(ObjectDefinition, 'forId', () => definition);
  const requests = [];
  let explicitDestination = null;
  t.mock.method(PluginManager, 'emitObjectRoute', (event) => {
    requests.push(event);
    event.blockAccessFlags = 0x5;
    event.destination = explicitDestination;
  });
  const previousRoute = PathFinder.rsmodRouteFinding;
  PathFinder.rsmodRouteFinding = new RsmodRouteFinding(() => 0);
  t.after(() => { PathFinder.rsmodRouteFinding = previousRoute; TaskManager.cancelTasks(1); });
  const door = new GameObject(1535, new Location(100, 100, 0), 0, 2, null);
  for (const clickType of [undefined, 0, 1, 2, 3, 4, 5]) {
    location = new Location(100, 99, 0);
    let operations = 0;
    queue.walkToObject(door, { execute: () => { operations++; } }, clickType);
    assert.ok(queue.points.length > 0, 'even an already adjacent caller must route to a door face');
    assert.equal(requests.at(-1).clickType, clickType ?? 0);
    assert.equal(requests.at(-1).definition, definition);
    // Losing the path beside the wall must repath, not fire the operation early.
    queue.reset();
    TaskManager.process();
    TaskManager.processWalkTo(1);
    assert.equal(operations, 0);
    assert.ok(queue.points.length > 0);
    location = new Location(100, 100, 0);
    queue.reset();
    TaskManager.process();
    TaskManager.processWalkTo(1);
    assert.equal(operations, 1);
  }
  assert.equal(requests.length, 7, 'one route hook per object interaction');

  explicitDestination = { x: 99, y: 98, z: 0 };
  let destination;
  queue.walkToTile = (tile, action) => { destination = tile; action(); };
  queue.walkToObject(door, { execute: noop });
  assert.deepEqual([destination.x, destination.y, destination.z], [99, 98, 0], 'explicit quest routes retain priority');
});

test('ground-item routes can stop on a reachable tile beside a blocked item tile', (t) => {
  const options = [];
  const checkpoints = [];
  const queue = {
    reset() { return this; },
    setRoute() { return this; },
    setPathX() { return this; },
    setPathY() { return this; },
    syncDestinationFlagToRoute() {},
    addCheckpoint(location) { checkpoints.push(location); },
  };
  const player = {
    isPlayer: () => false,
    getLocation: () => new Location(2598, 7842, 0),
    getSize: () => 1,
    getPrivateArea: () => null,
    getMovementQueue: () => queue,
  };
  const oldRoute = PathFinder.rsmodRouteFinding;
  PathFinder.rsmodRouteFinding = {
    findRoute(request) {
      options.push(request);
      return request.moveNear
        ? { success: true, alternative: false, endX: 2602, endY: 7848, waypoints: [{ x: 2602, y: 7848, z: 0 }] }
        : { success: false, alternative: false, waypoints: [] };
    },
  };
  t.after(() => { PathFinder.rsmodRouteFinding = oldRoute; });

  assert.equal(PathFinder.calculateGroundItemRoute(player, new Location(2603, 7847, 0)), 1);
  assert.equal(options[0].moveNear, true);
  assert.equal(options[0].locShape, -1);
  assert.deepEqual(checkpoints.map(({ x, y, z }) => [x, y, z]), [[2602, 7848, 0]]);
});

test('ground-item pickup accepts only a collision-reachable adjacent tile on the same plane', (t) => {
  const oldRoute = PathFinder.rsmodRouteFinding;
  const oldItems = World.getItems;
  const oldPickup = PluginManager.emitGroundItemPickup;
  const oldDeregister = ItemOnGroundManager.deregister;
  const oldSound = Sounds.sendSound;
  let location = new Location(99, 100, 0);
  let inventoryAdds = 0;
  let resets = 0;
  let removed = 0;
  const floorItem = new Item(33788, 1);
  const groundItem = new ItemOnGround(State.SEEN_BY_PLAYER, 'ObjectReachTest',
    new Location(100, 100, 0), floorItem, true, -1, null);
  const received = [];
  const player = {
    getUsername: () => 'ObjectReachTest',
    getLocation: () => location,
    getSize: () => 1,
    getPrivateArea: () => null,
    getMovementQueue: () => ({ reset: () => { resets++; } }),
    getInventory: () => ({
      getFreeSlots: () => 1,
      getItems: () => received,
      getAmount: () => 0,
      addItem: (item) => { inventoryAdds++; received.push(item.clone()); },
    }),
    getLastItemPickup: () => ({ reset() {} }),
  };
  World.getItems = () => [groundItem];
  PluginManager.emitGroundItemPickup = () => false;
  ItemOnGroundManager.deregister = () => { removed++; };
  Sounds.sendSound = () => {};
  let wallMask = 0;
  PathFinder.rsmodRouteFinding = new RsmodRouteFinding((x, y) =>
    x === 100 && y === 100 ? 0x100 : x === 99 && y === 100 ? wallMask : 0);
  t.after(() => {
    PathFinder.rsmodRouteFinding = oldRoute;
    World.getItems = oldItems;
    PluginManager.emitGroundItemPickup = oldPickup;
    ItemOnGroundManager.deregister = oldDeregister;
    Sounds.sendSound = oldSound;
  });

  // The item occupies a blocked tile, but the player can still take it from a
  // reachable side of the tile.
  ItemOnGroundManager.pickup(player, groundItem);
  assert.equal(inventoryAdds, 1);
  assert.equal(removed, 1);

  // A wall between the player and item makes that same adjacent-looking tile
  // unreachable; move-near pathing must not turn it into a pickup.
  wallMask = 8;
  ItemOnGroundManager.pickup(player, groundItem);
  assert.equal(inventoryAdds, 1);

  wallMask = 0;
  location = new Location(99, 100, 1);
  ItemOnGroundManager.pickup(player, groundItem);
  assert.equal(inventoryAdds, 1, 'a ground item on another plane cannot be picked up');

  location = new Location(95, 100, 0);
  ItemOnGroundManager.pickup(player, groundItem);
  assert.equal(inventoryAdds, 1, 'a distant item is not within pickup reach');
  assert.equal(resets, 3, 'all rejected attempts clear their stale movement action');
});

test('ladder click waits for arrival before animating and changes plane one tick later', (t) => {
  const events = [];
  let location = new Location(100, 97, 0);
  let forceMovement = null;
  const noop = () => {};
  const player = {
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => true, getAsPlayer() { return this; },
    getIndex: () => 1, getUsername: () => 'tester', getSize: () => 1,
    getLocation: () => location, setLocation: (value) => { location = value; },
    getPrivateArea: () => null, getHitpoints: () => 10, isNeedsPlacement: () => false,
    getForceMovement: () => forceMovement,
    getTimers: () => ({ has: () => false }), getFollowing: () => null,
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    getCombat: () => ({ setCastSpell: noop, reset: noop }),
    getSkillManager: () => ({ stopSkillable: noop }),
    setFollowing: noop, setCombatFollowing: noop, setPositionToFace: noop,
    setDirection: noop, setWalkingDirection: noop, setRunningDirection: noop,
    isRunningReturn: () => false, sendMessage: noop,
    performAnimation: (animation) => events.push(['anim', World.getProcessCycle(), animation.getId()]),
    moveTo: (destination) => { queue.reset(); location = destination.clone(); events.push(['tele', World.getProcessCycle()]); },
  };
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;
  queue.handleRegionChange = noop;
  queue.syncWildernessStateForMovedPlayer = noop;
  queue.drainRunEnergy = noop;
  queue.canWalkTo = (next) => !(next.x === 100 && next.y === 100);
  const route = new RsmodRouteFinding((x, y) => x === 100 && y === 100 ? 0x100 : 0);
  const oldRoute = PathFinder.rsmodRouteFinding;
  const oldCycle = World.processCycle;
  PathFinder.rsmodRouteFinding = route;
  t.after(() => { PathFinder.rsmodRouteFinding = oldRoute; World.processCycle = oldCycle; TaskManager.cancelTasks(player); TaskManager.cancelTasks(1); });
  // Match the cache's directional ladder without booting a world or loading map regions.
  t.mock.method(ObjectDefinition, 'forId', () => ({ getSizeX: () => 1, getSizeY: () => 1, getBlockingMask: () => 27 }));
  const handlers = new Map();
  require('../plugins/objects/Ladders.plugin').register({
    getTaskManager: () => TaskManager,
    onCustomEvent: (name, handler) => handlers.set(name, handler),
    onObjectInteraction: noop,
  });
  const climb = () => handlers.get('ladders:climbUp')({ player, destination: new Location(location.x, location.y, 1) });
  const tick = () => {
    World.processCycle++;
    TaskManager.process();
    queue.beginCycle();
    if (queue.hasPendingWork()) queue.process();
    TaskManager.processWalkTo(1);
  };
  World.processCycle = 100;
  queue.walkToObject(new GameObject(132, new Location(100, 100, 0), 10, 0, null), { execute: climb });
  tick();
  assert.equal(location.y, 98);
  tick();
  assert.equal(location.y, 99);
  assert.deepEqual(events, [], 'no operation on the movement cycle');
  tick();
  assert.deepEqual(events, [], 'arriveDelay leaves another cycle for the final client step');
  assert.equal(queue.isMovementBlocked(), true);
  tick();
  assert.deepEqual(events, [['anim', 104, 828]]);
  tick();
  assert.equal(location.z, 1);
  assert.equal(location.y, 99, 'translate the arrival tile, not the blocked ladder tile');
  assert.deepEqual(events.at(-1), ['tele', 105]);
  assert.equal(queue.isMovementBlocked(), false);

  events.length = 0;
  location = new Location(100, 99, 0);
  queue.walkToObject(new GameObject(132, new Location(100, 100, 0), 10, 0, null), { execute: climb });
  assert.deepEqual(events, [], 'an adjacent click must still run from the player turn');
  tick();
  assert.deepEqual(events, [['anim', 106, 828]], 'a stationary player needs no arriveDelay');
  tick();
  assert.equal(location.z, 1);

  events.length = 0;
  location = new Location(100, 99, 0);
  climb();
  assert.equal(queue.isMovementBlocked(), true);
  location = new Location(200, 200, 0);
  tick();
  assert.equal(location.x, 200, 'an intervening teleport cancels the climb');
  assert.equal(queue.isMovementBlocked(), false);
  assert.equal(events.some(([event]) => event === 'tele'), false);

  // Every forced movement (ditch jumps, knockback, etc.) owns movement until
  // completion. A walk click must not queue a competing route from its start.
  forceMovement = {};
  assert.equal(queue.getMobility().canMove(), false);
  queue.requestWalk(new Location(200, 201, 0));
  assert.equal(queue.hasPendingWork(), false);
  forceMovement = null;
  assert.equal(queue.getMobility().canMove(), true);
});

test('an inventory item action cancels the queued object op but keeps the walk', (t) => {
  const events = [];
  let location = new Location(100, 97, 0);
  const noop = () => {};
  const combat = { clearInteraction: () => events.push('clear-interaction'), setCastSpell: noop, reset: noop };
  const player = {
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => true, getAsPlayer() { return this; },
    getIndex: () => 1, getUsername: () => 'tester', getSize: () => 1,
    getLocation: () => location, setLocation: (value) => { location = value; },
    getPrivateArea: () => null, getHitpoints: () => 10, isNeedsPlacement: () => false,
    getForceMovement: () => null,
    getTimers: () => ({ has: () => false }), getFollowing: () => null,
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    getCombat: () => combat,
    getSkillManager: () => ({ stopSkillable: noop }),
    setFollowing: noop, setCombatFollowing: noop, setPositionToFace: noop,
    setDirection: noop, setWalkingDirection: noop, setRunningDirection: noop,
    isRunningReturn: () => false, sendMessage: noop, performAnimation: noop,
    moveTo: (destination) => { queue.reset(); location = destination.clone(); },
  };
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;
  queue.handleRegionChange = noop;
  queue.syncWildernessStateForMovedPlayer = noop;
  queue.drainRunEnergy = noop;
  queue.canWalkTo = (next) => !(next.x === 100 && next.y === 100);
  const route = new RsmodRouteFinding((x, y) => x === 100 && y === 100 ? 0x100 : 0);
  const oldRoute = PathFinder.rsmodRouteFinding;
  const oldCycle = World.processCycle;
  PathFinder.rsmodRouteFinding = route;
  t.after(() => { PathFinder.rsmodRouteFinding = oldRoute; World.processCycle = oldCycle; TaskManager.cancelTasks(1); });
  t.mock.method(ObjectDefinition, 'forId', () => ({ getSizeX: () => 1, getSizeY: () => 1, getBlockingMask: () => 27 }));
  World.processCycle = 100;
  const tick = () => {
    World.processCycle++;
    TaskManager.process();
    queue.beginCycle();
    if (queue.hasPendingWork()) queue.process();
    TaskManager.processWalkTo(1);
  };

  queue.walkToObject(new GameObject(132, new Location(100, 100, 0), 10, 0, null), { execute: () => events.push('op') });
  tick();
  assert.equal(location.y, 98, 'the red click walks toward the object');

  // What an Eat/Drink click does before the plugin runs: clear the interaction, keep walking.
  require('../dist/game/entity/impl/player/Player').Player.prototype.clearPendingAction.call(player);
  assert.ok(events.includes('clear-interaction'), 'the item action cleared the combat interaction');
  assert.ok(queue.hasRoute() || queue.points.length > 0, 'the walk queue survives the item action');

  tick();
  tick();
  tick();
  assert.equal(location.y, 99, 'the player walks on to the clicked object');
  assert.equal(events.includes('op'), false, 'the queued object op never runs');
});
