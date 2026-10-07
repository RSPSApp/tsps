// Run after `yarn build`: node --test tests/templated-instance.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { Location } = require('../dist/game/model/Location');
const {
  TemplatedInstanceArea, rotateChunkTile,
} = require('../dist/game/model/areas/impl/TemplatedInstanceArea');

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
});

// A Gauntlet room (2x2 chunks) and the chunks around it, so walls on its edges collide the same.
const ROOM = { chunkX: 232, chunkY: 704, plane: 1 };
// Steps a 1x1 walker can take: [dx, dy].
const STEPS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function canStep(x, y, z, [dx, dy], area) {
  return RegionManager.canMove(x, y, x + dx, y + dy, z, 1, 1, area);
}

/** Turns a step clockwise with its chunk: north becomes east, as the client turns tiles. */
function rotateStep([dx, dy], rotation) {
  for (let i = 0; i < (rotation & 3); i++) [dx, dy] = [dy, -dx];
  return [dx, dy];
}

function buildBlock(rotation) {
  const area = new TemplatedInstanceArea(4, 4);
  // The room's two chunks and a ring around them, all at the same offset.
  area.copySquare(4, ROOM.chunkX - 1, ROOM.chunkY - 1, ROOM.plane, 0, 0, ROOM.plane, rotation);
  return area;
}

test('an unturned copy walks exactly like the cache map it was copied from', () => {
  const area = buildBlock(0);
  try {
    const sourceX = (ROOM.chunkX - 1) * 8;
    const sourceY = (ROOM.chunkY - 1) * 8;
    let open = 0;
    for (let x = 8; x < 24; x++) {
      for (let y = 8; y < 24; y++) {
        for (const step of STEPS) {
          const expected = canStep(sourceX + x, sourceY + y, ROOM.plane, step, null);
          const actual = canStep(area.getBaseX() + x, area.getBaseY() + y, ROOM.plane, step, area);
          assert.equal(actual, expected, `(${x}, ${y}) step ${step}`);
          if (expected) open++;
        }
      }
    }
    assert.ok(open > 100, 'the room has floor to walk on');
  } finally {
    area.destroy();
  }
});

test('a turned copy walks like the cache map turned with it', () => {
  for (const rotation of [1, 2, 3]) {
    const area = buildBlock(rotation);
    try {
      const sourceX = (ROOM.chunkX - 1) * 8;
      const sourceY = (ROOM.chunkY - 1) * 8;
      for (let x = 8; x < 24; x++) {
        for (let y = 8; y < 24; y++) {
          // The 32x32 block turns as a whole: same as a chunk, with 31 for 7.
          const [toX, toY] = rotateBlockTile(x, y, rotation, 31);
          for (const step of STEPS) {
            const expected = canStep(sourceX + x, sourceY + y, ROOM.plane, step, null);
            const actual = canStep(area.getBaseX() + toX, area.getBaseY() + toY, ROOM.plane, rotateStep(step, rotation), area);
            assert.equal(actual, expected, `rotation ${rotation}: (${x}, ${y}) -> (${toX}, ${toY}) step ${step}`);
          }
        }
      }
    } finally {
      area.destroy();
    }
  }
});

test('turned locs are found where the client draws them', () => {
  const area = buildBlock(1);
  try {
    const sourceX = (ROOM.chunkX - 1) * 8;
    const sourceY = (ROOM.chunkY - 1) * 8;
    let found = 0;
    for (let x = 8; x < 24; x++) {
      for (let y = 8; y < 24; y++) {
        for (const type of [10, 11]) {
          const source = MapObjects.getType(new Location(sourceX + x, sourceY + y, ROOM.plane), type, null);
          const definition = source?.getDefinition();
          if (!source || !definition || definition.getSizeX() !== 1 || definition.getSizeY() !== 1) continue;
          const [toX, toY] = rotateBlockTile(x, y, 1, 31);
          const copy = area.resolveObject(source.getId(), area.tile(toX, toY, ROOM.plane));
          assert.ok(copy, `${source.getId()} at (${x}, ${y}) is at (${toX}, ${toY})`);
          assert.equal(copy.getFace(), (source.getFace() + 1) & 3);
          assert.equal(copy.getPrivateArea(), area);
          found++;
        }
      }
    }
    assert.ok(found > 0, 'the room has 1x1 locs to look for');
  } finally {
    area.destroy();
  }
});

test('tiles no chunk was copied to are blocked, and copying one opens it and bumps the scene', () => {
  const area = new TemplatedInstanceArea(2, 2);
  try {
    const tile = area.tile(3, 3, ROOM.plane);
    assert.ok(RegionManager.blocked(tile, area));
    const version = area.getSceneVersion();
    area.copySquare(2, ROOM.chunkX, ROOM.chunkY, ROOM.plane, 0, 0, ROOM.plane, 0);
    assert.ok(area.getSceneVersion() > version);
    const { palette } = area.buildScenePalette(area.baseChunkX, area.baseChunkY);
    assert.notEqual(palette[ROOM.plane][6][6], -1, 'the copied chunk is in the scene palette');
    assert.equal(palette[ROOM.plane][5][5], -1, 'nothing is outside the instance');
    assert.equal(palette[0][6][6], -1, 'only the copied plane');
  } finally {
    area.destroy();
  }
});

test('allocations do not overlap and are freed on destroy', () => {
  const a = new TemplatedInstanceArea(16, 16);
  const b = new TemplatedInstanceArea(16, 16);
  try {
    assert.ok(a.baseChunkX + 16 <= b.baseChunkX || a.baseChunkY + 16 <= b.baseChunkY);
    assert.equal(rotateChunkTile(0, 0, 1)[1], 7);
  } finally {
    const slotX = a.baseChunkX;
    a.destroy();
    b.destroy();
    const c = new TemplatedInstanceArea(1, 1);
    assert.equal(c.baseChunkX, slotX, 'the freed slot is reused');
    c.destroy();
  }
});

function rotateBlockTile(x, y, rotation, last) {
  switch (rotation & 3) {
    case 0: return [x, y];
    case 1: return [y, last - x];
    case 2: return [last - x, last - y];
    default: return [last - y, x];
  }
}
