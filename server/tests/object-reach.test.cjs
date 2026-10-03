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

const target = { level: 0, destX: 100, destY: 100, srcSize: 1, privateArea: null };

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
