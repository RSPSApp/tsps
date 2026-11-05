// Run after `yarn build`: node --test tests/varlamore-ground-spawns.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const spawns = require("../data/definitions/ground-items.json");

before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); });

// Wiki ItemSpawnLine tiles (Bones, Eclipse red), each one also an obj_add in RSProx (revisions 226-238).
const BONES = [
  [1636, 2934, 0], [1625, 2924, 0], [1643, 2905, 0], [1653, 2910, 0], [1652, 2914, 0], [1655, 2923, 0], [1657, 2925, 0], [1627, 2912, 0],
  [1720, 2935, 0], [1717, 2938, 0], [1713, 2934, 0], [1708, 2939, 0],
  [1828, 3139, 0], [1658, 3085, 0], [1545, 3327, 0], [1556, 3311, 0], [1575, 3294, 0],
  [1683, 9604, 2], [1685, 9603, 2], [1688, 9606, 2], [1690, 9603, 2],
  [1411, 2858, 0], [1413, 2855, 0], [1418, 2861, 0], [1421, 2857, 0], [1421, 2852, 0],
];

function at(id, [x, y, z]) {
  return spawns.filter((spawn) => spawn.id === id && spawn.location.x === x && spawn.location.y === y && spawn.location.z === z);
}

test("Varlamore's bones and the Hunter Guild's eclipse red lie where the Wiki and captures put them (#2449)", () => {
  const bones = CacheDefinitions.getObjId("bones");
  const eclipse = CacheDefinitions.getObjId("eclipse_wine"); // renamed "Eclipse red" in game, the gameval kept
  assert.equal(eclipse, 29415);
  assert.equal(bones, 526);
  assert.equal(CacheDefinitions.getItem(eclipse).name, "Eclipse red");
  for (const tile of BONES) {
    const found = at(bones, tile);
    assert.equal(found.length, 1, `bones at ${tile}`);
    assert.equal(found[0].respawn, 100, "the Wiki's 100-tick respawn");
  }
  const [wine] = at(eclipse, [1555, 3035, 2]);
  assert.equal(wine?.respawn, 75);
});
