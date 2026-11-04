// node --test tests/travel-skip-plan.test.cjs
// travel_to's skipWalks: which stretches of a walk leg are moved over in one hop and which are walked.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { skipPlan } = require("../plugins/agent/mcp/TravelRoutes.AgentMcp");

/** A straight east-west path of `length` tiles from (3200, 3200). */
const path = (length) => Array.from({ length }, (_, i) => ({ x: 3200 + i, y: 3200, z: 0 }));
/** An area lookup: tiles from `from` eastwards are in `name`, the rest in no area. */
const areaFrom = (from, name = "Market") => (t) => (t.x - 3200 >= from ? name : null);

test("a walk inside one area is a single hop to its end", () => {
  assert.deepEqual(skipPlan(path(40), { areaAt: () => null }), [{ skip: 39 }]);
});

test("the tiles either side of an area change are walked, so its hooks run on a real step", () => {
  // The change is between tiles 19 and 20; tiles 17-22 are walked.
  assert.deepEqual(skipPlan(path(40), { areaAt: areaFrom(20) }), [{ skip: 16 }, { walk: 22 }, { skip: 39 }]);
});

test("unsafe tiles (the wilderness) are walked to the end", () => {
  const steps = skipPlan(path(40), { areaAt: () => null, unsafe: (t) => t.x - 3200 >= 30 });
  assert.deepEqual(steps, [{ skip: 29 }, { walk: 39 }]);
});

test("a stretch too short to be worth a hop is walked, joined to the walks beside it", () => {
  // Changes at 10 and 18 leave tiles 13-14 between their walked margins: walked, not hopped.
  const areaAt = (t) => { const i = t.x - 3200; return i >= 18 ? "B" : i >= 10 ? "A" : null; };
  assert.deepEqual(skipPlan(path(40), { areaAt }), [{ skip: 6 }, { walk: 20 }, { skip: 39 }]);
});

test("a short leg is walked, never hopped", () => {
  assert.deepEqual(skipPlan(path(4), { areaAt: () => null }), [{ walk: 3 }]);
});

test("every step ends further along the path, and the last ends on its last tile", () => {
  const steps = skipPlan(path(120), { areaAt: areaFrom(50), unsafe: (t) => t.x - 3200 >= 100 });
  const ends = steps.map((step) => step.skip ?? step.walk);
  assert.deepEqual(ends, [...ends].sort((a, b) => a - b));
  assert.equal(ends[ends.length - 1], 119);
});
