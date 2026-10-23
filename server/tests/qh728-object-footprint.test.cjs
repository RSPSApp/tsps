// Run without a build, from server/:
//   node -r ts-node/register/transpile-only --test tests/qh728-object-footprint.test.cjs
// Uses the TypeScript source directly so the test exercises the shared route fix.
// Real cache only: every footprint, mask, action and placement below is loaded from
// the cache/map files; no duplicated boolean object model is used.
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CachePipeline } = require('../src/main/typescript/elvarg/game/cache/CachePipeline');
const { ObjectDefinition } = require('../src/main/typescript/elvarg/game/definition/ObjectDefinition');
const { RegionManager } = require('../src/main/typescript/elvarg/game/collision/RegionManager');
const { MapObjects } = require('../src/main/typescript/elvarg/game/entity/impl/object/MapObjects');
const { GameObject } = require('../src/main/typescript/elvarg/game/entity/impl/object/GameObject');
const { Location } = require('../src/main/typescript/elvarg/game/model/Location');
const { MovementQueue } = require('../src/main/typescript/elvarg/game/model/movement/MovementQueue');
const { RsmodRouteFinding } = require('../src/main/typescript/elvarg/game/model/movement/path/RsmodRouteFinding');
const { TaskManager } = require('../src/main/typescript/elvarg/game/task/TaskManager');
const { World } = require('../src/main/typescript/elvarg/game/World');

const STAGE8_VARBITS = new Set([5325, 7798, 7856, 7907, 7908]);
const STAGE8 = {
  getPacketSender: () => ({
    getVarbit: (id) => STAGE8_VARBITS.has(id) ? 8 : 0,
    getVarp: () => 0,
  }),
};

let cacheReady;
function ensureCache() {
  if (!cacheReady) {
    cacheReady = (async () => {
      await CachePipeline.initialize(process.cwd());
      ObjectDefinition.init();
      RegionManager.init();
      for (const [x, y] of [
        [1285, 3737], [1347, 3736], [1384, 3828], [1357, 3777],
        [1382, 3825], [1655, 3045], [1299, 3724], [1294, 3721],
        [1719, 9706],
      ]) {
        RegionManager.loadMapFiles(x, y);
      }
    })();
  }
  return cacheReady;
}

function placement(id, x, y, z = 0) {
  const found = (MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? [])
    .find((object) => object.getId() === id);
  assert.ok(found, `real placement ${id} at ${x},${y},${z} exists`);
  return found;
}

function specFor(object, player = STAGE8) {
  const routePlayer = {
    ...player,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer() { return this; },
  };
  return new MovementQueue(routePlayer).buildObjectRouteSpec(object);
}

function reachAt(rf, srcX, srcY, destX, destY, spec) {
  return rf.reachedAbsolute({
    level: 0, srcX, srcY, srcSize: 1,
    destX, destY,
    destWidth: spec.reachWidth, destLength: spec.reachLength,
    locAngle: spec.reachAngle, locShape: spec.reachShape,
    blockAccessFlags: spec.reachBlockAccessFlags, privateArea: null,
  });
}

function oldChildSpec(id, player = STAGE8) {
  const def = ObjectDefinition.forPlayer(id, player) ?? ObjectDefinition.forId(id);
  return {
    reachWidth: def.getSizeX(), reachLength: def.getSizeY(),
    reachAngle: 0, reachShape: 10, reachBlockAccessFlags: def.getBlockingMask(),
  };
}

function routePlayerAt(location) {
  const player = {
    isPlayer: () => true, isNpc: () => false, isPlayerBot: () => false,
    getAsPlayer() { return this; }, getIndex: () => 4242,
    getUsername: () => 'q003-footprint', getSize: () => 1, getRights: () => -1,
    getLocation: () => location, getPrivateArea: () => null,
    getPacketSender: () => ({
      getVarbit: (id) => STAGE8_VARBITS.has(id) ? 8 : 0,
      getVarp: () => 0,
      sendDestination: () => {},
    }),
    getInventory: () => ({ capacity: () => 28, getItems: () => [] }),
    getFollowing: () => null, getTimers: () => ({ has: () => false }),
    getHitpoints: () => 10, getForceMovement: () => null,
    isNeedsPlacement: () => false,
    getCombat: () => ({ setCastSpell: () => {}, reset: () => {} }),
    getSkillManager: () => ({ stopSkillable: () => {} }),
    getDueling: () => ({ getButtonDelay: () => ({ finished: () => true }), inDuel: () => false }),
    getTrading: () => ({ getButtonDelay: () => ({ finished: () => true }) }),
    setPositionToFace: () => {}, setDirection: () => {},
    setWalkingDirection: () => {}, setRunningDirection: () => {},
    sendMessage: () => {}, isRunningReturn: () => false, setRunning: () => {},
  };
  const queue = new MovementQueue(player);
  player.getMovementQueue = () => queue;
  queue.getMobility = () => ({ canMove: () => true });
  queue.checkDestination = () => true;
  queue.walkToReset = () => {};
  return { player, queue };
}

test('34602 Ancient Grave: the real 4x2 collision footprint reaches the native north edge', async () => {
  await ensureCache();
  const grave = placement(34602, 1347, 3736);
  assert.equal(grave.getType(), 10);
  assert.equal(grave.getFace(), 0);

  const base = ObjectDefinition.forId(34602);
  const child = ObjectDefinition.forPlayer(34602, STAGE8);
  assert.deepEqual([base.getSizeX(), base.getSizeY(), base.getBlockingMask()], [4, 2, 0]);
  assert.equal(child.id, 33578);
  assert.deepEqual([child.getSizeX(), child.getSizeY(), child.getBlockingMask()], [1, 1, 0]);
  assert.equal(child.getName(), 'Ancient Grave');
  assert.equal(child.getActions()[0], 'Inspect');

  for (let x = 1347; x <= 1350; x++) {
    for (let y = 3736; y <= 3737; y++) {
      assert.equal(RegionManager.getClipping(x, y, 0, null) & 0x100, 0x100,
        `base collision blocks ${x},${y}`);
    }
  }
  assert.equal(RegionManager.getClipping(1347, 3738, 0, null), 0, 'native north edge is standable');

  const spec = specFor(grave);
  assert.deepEqual(
    [spec.routeXLength, spec.routeYLength, spec.reachWidth, spec.reachLength,
      spec.reachShape, spec.reachAngle, spec.reachBlockAccessFlags],
    [4, 2, 4, 2, 10, 0, 0],
  );

  const rf = new RsmodRouteFinding(RegionManager.getClipping.bind(RegionManager));
  const old = oldChildSpec(34602);
  old.reachAngle = grave.getFace();
  assert.equal(reachAt(rf, 1347, 3738, 1347, 3736, old), false,
    'the old child-sized 1x1 reach rejected the native north edge');
  assert.equal(reachAt(rf, 1347, 3738, 1347, 3736, spec), true,
    'the placed 4x2 footprint accepts the native north edge');

  const routeResult = rf.findRoute({
    level: 0, srcX: 1347, srcY: 3738, srcSize: 1,
    destX: 1347, destY: 3736,
    destWidth: spec.routeXLength, destLength: spec.routeYLength,
    locAngle: spec.routeDirection, locShape: 10, moveNear: true,
    blockAccessFlags: spec.routeBlockingMask, privateArea: null,
  });
  assert.equal(routeResult.success, true);
  assert.deepEqual([routeResult.endX, routeResult.endY], [1347, 3738]);

  const { player, queue } = routePlayerAt(new Location(1347, 3738, 0));
  let dispatched = 0;
  queue.walkToObject(grave, { execute: () => { dispatched++; } });
  for (let cycle = 0; cycle < 10 && dispatched === 0; cycle++) {
    World.processCycle++;
    TaskManager.process();
    queue.beginCycle();
    if (queue.hasPendingWork()) queue.process();
    TaskManager.processWalkTo(player.getIndex());
  }
  TaskManager.cancelTasks(player.getIndex());
  assert.equal(dispatched, 1, 'the real walkToObject route dispatches Inspect from 1347,3738');
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1347, 3738]);
});

test('34621/34624/34625 trail multi-locs use their real 2x2 collision footprints, including rotation 1', async () => {
  await ensureCache();
  const cases = [
    [34621, 1287, 3750, 2, 1286, 3751],
    [34624, 1285, 3737, 2, 1284, 3738],
    [34625, 1281, 3725, 1, 1282, 3727],
  ];
  const rf = new RsmodRouteFinding(RegionManager.getClipping.bind(RegionManager));
  for (const [id, x, y, face, standX, standY] of cases) {
    const object = placement(id, x, y);
    assert.equal(object.getType(), 10);
    assert.equal(object.getFace(), face);
    const base = ObjectDefinition.forId(id);
    const child = ObjectDefinition.forPlayer(id, STAGE8);
    assert.deepEqual([base.getSizeX(), base.getSizeY()], [2, 2], `${id} base footprint`);
    assert.deepEqual([child.getSizeX(), child.getSizeY()], [1, 1], `${id} child footprint`);
    assert.deepEqual([child.getBlockingMask(), base.getBlockingMask()], [0, 0]);
    for (let fx = x; fx <= x + 1; fx++) {
      for (let fy = y; fy <= y + 1; fy++) {
        assert.equal(RegionManager.getClipping(fx, fy, 0, null) & 0x100, 0x100,
          `${id} blocks ${fx},${fy}`);
      }
    }
    assert.equal(RegionManager.getClipping(standX, standY, 0, null), 0,
      `${id} outer approach ${standX},${standY} is standable`);
    const spec = specFor(object);
    assert.deepEqual([spec.reachWidth, spec.reachLength, spec.reachAngle], [2, 2, face]);
    const old = oldChildSpec(id);
    old.reachAngle = face;
    assert.equal(reachAt(rf, standX, standY, x, y, old), false,
      `${id} old 1x1 child reach rejected ${standX},${standY}`);
    assert.equal(reachAt(rf, standX, standY, x, y, spec), true,
      `${id} real 2x2 footprint accepts ${standX},${standY}`);
  }
});

test('rotated rectangular multi-loc 34591 Furnace keeps rotation and the resolved access mask', async () => {
  await ensureCache();
  const furnace = placement(34591, 1384, 3828);
  assert.equal(furnace.getType(), 10);
  assert.equal(furnace.getFace(), 1);
  const base = ObjectDefinition.forId(34591);
  const child = ObjectDefinition.forPlayer(34591, STAGE8);
  assert.equal(child.id, 33504);
  assert.equal(child.getName(), 'Furnace');
  assert.equal(child.getActions()[1], 'Smelt');
  assert.deepEqual([base.getSizeX(), base.getSizeY(), base.getBlockingMask()], [2, 3, 29]);
  assert.deepEqual([child.getSizeX(), child.getSizeY(), child.getBlockingMask()], [1, 1, 0]);

  // Collision rotates face 1: base 2x3 becomes a 3x2 footprint.
  for (let x = 1384; x <= 1386; x++) {
    for (let y = 3828; y <= 3829; y++) {
      assert.equal(RegionManager.getClipping(x, y, 0, null) & 0x100, 0x100,
        `rotated furnace blocks ${x},${y}`);
    }
  }
  const spec = specFor(furnace);
  assert.deepEqual(
    [spec.reachWidth, spec.reachLength, spec.reachAngle, spec.reachBlockAccessFlags],
    [2, 3, 1, 0],
    'rotation stays on the spec and the child access mask is preserved',
  );
  const rf = new RsmodRouteFinding(RegionManager.getClipping.bind(RegionManager));
  const old = oldChildSpec(34591);
  old.reachAngle = 1;
  assert.equal(reachAt(rf, 1385, 3827, 1384, 3828, old), false,
    'old 1x1 child reach rejects the rotated south edge');
  assert.equal(reachAt(rf, 1385, 3827, 1384, 3828, spec), true,
    'rotated 3x2 collision footprint accepts the south edge');
});

test('ordinary objects, masks, doors, type-22 and larger-child footprints follow cache clipping', async () => {
  await ensureCache();

  const tree = placement(1289, 1357, 3777);
  const treeSpec = specFor(tree);
  assert.deepEqual(
    [treeSpec.routeXLength, treeSpec.routeYLength, treeSpec.reachWidth, treeSpec.reachLength,
      treeSpec.reachShape, treeSpec.reachBlockAccessFlags],
    [1, 1, 1, 1, 10, 0],
    'a non-MORPH 1x1 type-10 object is unchanged',
  );
  const rf = new RsmodRouteFinding(RegionManager.getClipping.bind(RegionManager));
  assert.equal(reachAt(rf, 1357, 3776, 1357, 3777, treeSpec), true);
  assert.equal(RegionManager.getClipping(1357, 3777, 0, null) & 0x100, 0x100, 'tree base tile stays blocked');

  const ladder = placement(33483, 1382, 3825);
  const ladderBase = ObjectDefinition.forId(33483);
  const ladderSpec = specFor(ladder);
  assert.deepEqual([ladderBase.getSizeX(), ladderBase.getSizeY(), ladderBase.getBlockingMask()], [1, 1, 27]);
  assert.equal(ladderSpec.reachBlockAccessFlags, 27, 'the resolved access mask is preserved');
  assert.equal(reachAt(rf, 1382, 3824, 1382, 3825, ladderSpec), true, 'south face remains allowed');
  for (const [x, y] of [[1382, 3826], [1381, 3825], [1383, 3825]]) {
    assert.equal(reachAt(rf, x, y, 1382, 3825, ladderSpec), false,
      `mask 27 still rejects ${x},${y}`);
  }

  const door = placement(13001, 1299, 3724);
  const doorSpec = specFor(door);
  assert.equal(door.getType(), 0);
  assert.deepEqual(
    [doorSpec.routeSize, doorSpec.routeXLength, doorSpec.routeYLength, doorSpec.routeBlockingMask,
      doorSpec.reachWidth, doorSpec.reachLength, doorSpec.reachShape, doorSpec.reachAngle],
    [1, 0, 0, 0, 1, 1, 0, 0],
    'door/wall routing keeps the non-rectangle branch',
  );

  const ground = placement(917, 1294, 3721);
  const groundSpec = specFor(ground);
  assert.equal(ground.getType(), 22);
  assert.deepEqual([groundSpec.reachWidth, groundSpec.reachLength, groundSpec.reachShape], [1, 1, 10]);

  // Type 22 is deliberately excluded from the base-footprint change: collision clips
  // only its origin tile. Use the real multi-loc definition to prove the branch still
  // resolves the player's child instead of the 4x2 parent.
  const type22Grave = new GameObject(34602, new Location(1347, 3736, 0), 22, 0, null);
  const type22Spec = specFor(type22Grave);
  assert.deepEqual([type22Spec.reachWidth, type22Spec.reachLength], [1, 1],
    'type 22 keeps the resolved 1x1 child, not the 4x2 parent');

  // A MORPH child can be larger than the placed collision footprint (52999 Flour bin:
  // base 2x2, resolved child 3x2). The old child-sized spec would overreach.
  const largerChild = placement(52999, 1655, 3045);
  const largerBase = ObjectDefinition.forId(52999);
  const largerResolved = ObjectDefinition.forPlayer(52999, STAGE8);
  assert.equal(largerResolved.id, 52590);
  assert.equal(largerResolved.getName(), 'Flour bin');
  assert.equal(largerResolved.getActions()[0], 'Empty');
  assert.deepEqual([largerBase.getSizeX(), largerBase.getSizeY()], [2, 2]);
  assert.deepEqual([largerResolved.getSizeX(), largerResolved.getSizeY()], [3, 2]);
  const largerSpec = specFor(largerChild);
  assert.deepEqual([largerSpec.reachWidth, largerSpec.reachLength], [2, 2],
    'route uses the real 2x2 collision footprint, not the larger 3x2 MORPH child');
  for (let x = 1655; x <= 1656; x++) {
    for (let y = 3045; y <= 3046; y++) {
      assert.equal(RegionManager.getClipping(x, y, 0, null) & 0x100, 0x100);
    }
  }
  assert.equal(RegionManager.getClipping(1657, 3045, 0, null) & 0x100, 0,
    'the larger child does not add collision outside the 2x2 base');
});

test('real MORPH painting 56522 keeps its resolved 1x2 footprint and Inspect action', async () => {
  await ensureCache();
  const painting = placement(56522, 1719, 9706);
  assert.equal(painting.getType(), 10);
  const base = ObjectDefinition.forId(56522);
  const child = ObjectDefinition.forPlayer(56522, STAGE8);
  assert.equal(child.id, 56523);
  assert.equal(child.getName(), 'Painting');
  assert.equal(child.getActions()[0], 'Inspect');
  assert.deepEqual([base.getSizeX(), base.getSizeY(), base.getBlockingMask()], [1, 2, 23]);
  assert.deepEqual([child.getSizeX(), child.getSizeY(), child.getBlockingMask()], [1, 2, 23]);
  const spec = specFor(painting);
  assert.deepEqual([spec.reachWidth, spec.reachLength, spec.reachAngle, spec.reachBlockAccessFlags],
    [1, 2, painting.getFace(), 23]);
});
