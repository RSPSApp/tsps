// Run after `yarn build`: node --test tests/cache-definition-counts.test.cjs
// CacheDefinitions.getCounts() runs several times per NPC per tick. It now works out the custom
// definitions' share once per change of them and returns the same frozen object while the counts
// hold (issue 6036), but must still report what the per-call version did.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

process.env.DISABLE_PLAYER_BOTS = "1";
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const SOURCE = "test:6036-counts";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

after(() => {
  CacheDefinitions.registerCustomDefinitions([], SOURCE);
});

/** The counts as the old per-call code worked them out. */
function expectedCounts() {
  const counts = CacheDefinitions.getBaseCounts();
  for (const { kind, id } of CacheDefinitions.getCustomDefinitions()) {
    const field = kind === "npc" ? "npcs" : kind === "loc" ? "objects" : "items";
    counts[field] = Math.max(counts[field], id + 1);
  }
  return counts;
}

test("repeated calls return one frozen object with the base and custom counts", () => {
  const first = CacheDefinitions.getCounts();
  assert.equal(CacheDefinitions.getCounts(), first);
  assert.ok(Object.isFrozen(first));
  const base = CacheDefinitions.getBaseCounts();
  for (const field of ["npcs", "items", "objects", "seqs"]) assert.ok(first[field] >= base[field], field);
  assert.equal(first.seqs, base.seqs);
});

test("registering custom definitions raises the counts, and removing them lowers them again", () => {
  const before = CacheDefinitions.getCounts();
  const npcId = Math.max(60000, before.npcs + 10);
  const locId = Math.max(60000, before.objects + 20);
  CacheDefinitions.registerCustomDefinitions([
    { kind: "npc", id: npcId, baseId: null, fields: {} },
    { kind: "loc", id: locId, baseId: null, fields: {} },
  ], SOURCE);
  const raised = CacheDefinitions.getCounts();
  assert.notEqual(raised, before);
  assert.equal(raised.npcs, npcId + 1);
  assert.equal(raised.objects, locId + 1);
  assert.equal(raised.items, before.items);
  assert.equal(CacheDefinitions.getCounts(), raised, "unchanged counts give the cached object back");
  assert.deepEqual({ ...raised }, expectedCounts());

  CacheDefinitions.registerCustomDefinitions([], SOURCE);
  assert.deepEqual({ ...CacheDefinitions.getCounts() }, { ...before });
});
