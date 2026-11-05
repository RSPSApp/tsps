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
  TemplatedInstanceArea, rotateChunkTile, MAX_INSTANCE_CHUNKS,
} = require('../dist/game/model/areas/impl/TemplatedInstanceArea');

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
});

// A Gauntlet room (2x2 chunks) and the chunks around it, so walls on its edges collide the same.
const ROOM = { chunkX: 232, chunkY: 704, plane: 1 };
// Steps a 1x1 walker can take: [dx, dy].
const STEPS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

test('copied multi-locs resolve the visible child id and keep the original scene loc', () => {
  const area = new TemplatedInstanceArea(1, 1);
  area.setChunk(2, 0, 0, { sourceChunkX: 370, sourceChunkY: 803, sourcePlane: 2, rotation: 0 });
  const location = area.tile(0, 3, 2); // Ghorrock crevice parent 49517 at 2960,6427.
  let unlocked = 0;
  const player = { getPacketSender: () => ({ getVarbit: () => unlocked, getVarp: () => 0 }) };
  try {
    const blocked = area.resolveObject(49110, location, player);
    assert.equal(blocked?.getId(), 49517);
    assert.equal(area.resolveObject(49109, location, player), null, 'an unseen child is not interactable');
    unlocked = 1;
    assert.equal(area.resolveObject(49109, location, player)?.getId(), 49517);
    assert.equal(area.resolveObject(49110, location, player), null, 'the old child stops resolving after the morph');
  } finally { area.destroy(); }
});

function canStep(x, y, z, [dx, dy], area) {
  return RegionManager.canMove(x, y, x + dx, y + dy, z, 1, 1, area);
}

test('Entry treasure trapdoor is adjacent to a cache-reachable tile after Verzik', () => {
  const tile = require('../plugins/minigames/tob/Entry.TheatreOfBlood')._test.TREASURE_ENTRANCE_TILE;
  const [tx, ty, z] = tile;
  const steps = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const start = [3167, 4313];
  const visited = new Set([start.join(',')]);
  const pending = [start];
  while (pending.length) {
    const [x, y] = pending.pop();
    for (const [dx, dy] of steps) {
      const next = [x + dx, y + dy];
      const key = next.join(',');
      if (!visited.has(key) && canStep(x, y, z, [dx, dy], null)) {
        visited.add(key);
        pending.push(next);
      }
    }
  }
  assert.deepEqual(tile, [3167, 4323, 0], 'the interaction sits on the throne in the cache');
  assert.ok(visited.has(`${tx},${ty - 1}`), 'the south-side approach remains reachable from the final arena');
  const formerEntrance = [3170, 4327];
  assert.ok(!steps.some(([dx, dy]) => visited.has(`${formerEntrance[0] + dx},${formerEntrance[1] + dy}`)),
    'the former interaction location is behind the cache wall');
});

test('Entry treasure room places its reward chest on reachable cache floor', () => {
  const { TREASURE_ROOM_ENTRY_TILE, REWARD_CHEST_TILE } = require('../plugins/minigames/tob/Entry.TheatreOfBlood')._test;
  const [sx, sy, z] = TREASURE_ROOM_ENTRY_TILE;
  const [cx, cy] = REWARD_CHEST_TILE;
  RegionManager.loadMapFiles(cx, cy, true);
  const steps = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const visited = new Set([`${sx},${sy}`]);
  const pending = [[sx, sy]];
  while (pending.length) {
    const [x, y] = pending.pop();
    for (const [dx, dy] of steps) {
      const next = [x + dx, y + dy], key = next.join(',');
      if (visited.has(key) || Math.abs(next[0] - sx) > 24 || Math.abs(next[1] - sy) > 24) continue;
      if (canStep(x, y, z, [dx, dy], null)) { visited.add(key); pending.push(next); }
    }
  }
  assert.ok(visited.has(`${sx},${sy}`), 'the treasure room arrival tile is reachable');
  assert.ok(steps.some(([dx, dy]) => visited.has(`${cx + dx},${cy + dy}`)), 'the chest has a reachable adjacent tile');
  assert.equal(RegionManager.blocked(new Location(3244, 4307, 0), null), true, 'the former chest location is inside blocked cache geometry');
});

test('SOTE library teleport arrivals are clear, walkable tiles beside their seal anchors', () => {
  const anchors = [[2623, 6135, 1], [2676, 6101, 1], [2622, 6097, 0], [2576, 6171, 1],
    [2614, 6157, 0], [2580, 6163, 2], [2562, 6129, 2], [2646, 6143, 2], [2650, 6167, 1]];
  const arrivals = [[2623, 6134, 1], [2675, 6102, 1], [2623, 6098, 0], [2577, 6172, 1],
    [2613, 6158, 0], [2581, 6162, 2], [2563, 6130, 2], [2647, 6144, 2], [2651, 6168, 1]];
  for (let i = 0; i < arrivals.length; i++) {
    const [x, y, z] = arrivals[i], [sx, sy] = anchors[i];
    RegionManager.loadMapFiles(x, y, true);
    assert.equal(RegionManager.blocked(new Location(x, y, z), null), false, `arrival ${i} is not blocked`);
    assert.equal(Math.max(Math.abs(x - sx), Math.abs(y - sy)), 1, `arrival ${i} is beside its seal`);
    const exits = STEPS.filter(([dx, dy]) => canStep(x, y, z, [dx, dy], null));
    assert.ok(exits.length > 0, `arrival ${i} has a cache-valid outgoing step`);
  }
});

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
  const a = new TemplatedInstanceArea(MAX_INSTANCE_CHUNKS, MAX_INSTANCE_CHUNKS);
  const b = new TemplatedInstanceArea(MAX_INSTANCE_CHUNKS, MAX_INSTANCE_CHUNKS);
  try {
    assert.ok(a.baseChunkX + MAX_INSTANCE_CHUNKS <= b.baseChunkX || a.baseChunkY + MAX_INSTANCE_CHUNKS <= b.baseChunkY);
    assert.equal(rotateChunkTile(0, 0, 1)[1], 7);
    assert.throws(() => new TemplatedInstanceArea(MAX_INSTANCE_CHUNKS + 1, 1), /outside/);
    const prison = new TemplatedInstanceArea(24, 17);
    prison.destroy();
    assert.ok(a.getBaseX() + MAX_INSTANCE_CHUNKS * 8 < 9600, 'template slots remain west of boat decks');
  } finally {
    const slotX = a.baseChunkX;
    a.destroy();
    b.destroy();
    const c = new TemplatedInstanceArea(1, 1);
    assert.equal(c.baseChunkX, slotX, 'the freed slot is reused');
    c.destroy();
  }
});

test('leaving a templated instance for a plain private area rebuilds the normal map (#2115)', () => {
  const { sceneRebuildFor } = require('../dist/net/PlayerSession');
  const { PrivateArea } = require('../dist/game/model/areas/impl/PrivateArea');
  const instance = new TemplatedInstanceArea(1, 1);
  const plain = new PrivateArea([]);
  try {
    // The Fractured Archive's Nexus (an instance) to Dreadnoth's room (the raid's plain area).
    assert.equal(sceneRebuildFor(plain, instance, true), 'normal', 'the client leaves instance mode');
    assert.equal(sceneRebuildFor(instance, plain, true), 'region');
    assert.equal(sceneRebuildFor(instance, null, true), 'region');
    assert.equal(sceneRebuildFor(null, instance, true), 'normal');
    assert.equal(sceneRebuildFor(null, null, true), 'normal');
    assert.equal(sceneRebuildFor(plain, null, true), null, 'a plain area on the cache map needs no rebuild');
    assert.equal(sceneRebuildFor(plain, plain, true), null);
    assert.equal(sceneRebuildFor(plain, instance, false), null, 'nothing changed, nothing sent');
  } finally {
    instance.destroy();
    plain.destroy();
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

test('compact collision grids preserve masks, planes and region boundaries', () => {
  const { Region } = require('../dist/game/collision/Region');
  const region = new Region((50 << 8) | 51, 0, 0);
  const x = 50 * 64, y = 51 * 64;
  assert.equal(region.getClip(x, y, 0), 0);
  region.removeClip(x, y, 0, 1);
  assert.equal(region.clips, undefined, 'reading/removing empty clipping allocates nothing');
  for (let plane = 0; plane < 4; plane++) {
    for (const [dx, dy] of [[0, 0], [0, 63], [63, 0], [63, 63], [12, 34]]) {
      region.addClip(x + dx, y + dy, plane, 1 << plane);
      region.addClip(x + dx, y + dy, plane, 0x80000000);
      assert.equal(region.getClip(x + dx, y + dy, plane), (1 << plane) | 0x80000000);
      region.removeClip(x + dx, y + dy, plane, 0x80000000);
      assert.equal(region.getClip(x + dx, y + dy, plane), 1 << plane);
    }
  }
  assert.ok(region.clips instanceof Uint32Array);
  assert.equal(region.clips.byteLength, 65536);
  const before = region.clips.slice();
  for (const [dx, dy] of [[-1, 0], [64, 0], [0, -1], [0, 64]]) {
    region.addClip(x + dx, y + dy, 0, -1);
    region.removeClip(x + dx, y + dy, 0, -1);
    assert.equal(region.getClip(x + dx, y + dy, 0), 0);
  }
  assert.deepEqual(region.clips, before, 'outside coordinates cannot alias another tile or plane');
  region.addClip(x + 1, y + 1, -1, 128);
  region.addClip(x + 1, y + 1, 4, 256);
  assert.equal(region.getClip(x + 1, y + 1, 0), 384, 'invalid planes retain the plane-zero fallback');
  region.clips = undefined;
  assert.equal(region.getClip(x, y, 0), 0, 'region reset discards clipping');
});

test('entity flags preserve normalization, replacement and clearing with lazy storage', () => {
  const { Entity } = require('../dist/game/entity/Entity');
  const entity = new Entity(new Location(3200, 3200));
  assert.deepEqual(entity.getFlags(), []);
  assert.equal(entity.hasFlag('test'), false);
  assert.equal(entity.removeFlag('test'), entity);
  entity.setFlag(' test ').setFlag('test').setFlag('').setFlag(null);
  assert.deepEqual(entity.getFlags(), ['test']);
  assert.equal(entity.hasFlag('test'), true);
  assert.equal(entity.hasFlag(' test '), false, 'queries retain their existing exact-match semantics');
  const copy = entity.getFlags();
  copy.push('external');
  assert.equal(entity.hasFlag('external'), false);
  entity.removeFlag('test');
  assert.deepEqual(entity.getFlags(), []);
  entity.setFlags(['a', ' b ', 'a']);
  assert.deepEqual(entity.getFlags(), ['a', 'b']);
  entity.setFlags(null);
  assert.deepEqual(entity.getFlags(), []);
  entity.setFlag('again').clearFlags().setFlag('last');
  assert.deepEqual(entity.getFlags(), ['last']);
});
