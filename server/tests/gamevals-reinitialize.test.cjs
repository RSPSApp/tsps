// Run after `yarn build`: node --test tests/gamevals-reinitialize.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");

// CachePipeline.initialize closes the store it held. A Gamevals made before that must read the
// new one, or its next kind not yet cached fails with EBADF.
test("a Gamevals built before a second initialize reads the new store", async () => {
  const root = path.resolve(__dirname, "..");
  await CachePipeline.initialize(root);
  const gamevals = new Gamevals();
  assert.ok(gamevals.namesOf(GamevalKind.SEQ).size > 0);
  await CachePipeline.initialize(root);
  assert.ok(gamevals.namesOf(GamevalKind.LOC).size > 0, "a kind not yet cached");
});

test("CacheDefinitions' gamevals survive a second initialize", async () => {
  const root = path.resolve(__dirname, "..");
  await CachePipeline.initialize(root);
  assert.ok(CacheDefinitions.getSeqNames().size > 0);
  await CachePipeline.initialize(root);
  assert.ok(CacheDefinitions.getNpcNames().size > 0, "a kind not yet cached");
});
