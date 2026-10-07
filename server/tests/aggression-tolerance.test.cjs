// Run after `yarn build`: node --test tests/aggression-tolerance.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { AggressionTolerance } = require("../dist/game/entity/impl/npc/AggressionTolerance");
const { Location } = require("../dist/game/model/Location");

function holder() {
  const attributes = new Map();
  return { attributes, getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value) };
}

const ticks = (tolerance, location, n) => { for (let i = 0; i < n; i++) tolerance.update(location); };

test("tolerant after ten minutes (1000 ticks) in the regions, not before (Wiki)", () => {
  const tolerance = new AggressionTolerance(holder());
  const here = new Location(1750, 3470, 0);
  ticks(tolerance, here, 1000);
  assert.equal(tolerance.finished(), false, "the first tick only seeds the regions");
  ticks(tolerance, here, 1);
  assert.equal(tolerance.finished(), true);
});

test("moving around inside the 21x21 regions keeps the timer", () => {
  const tolerance = new AggressionTolerance(holder());
  ticks(tolerance, new Location(1750, 3470, 0), 500);
  ticks(tolerance, new Location(1760, 3480, 0), 501);
  assert.equal(tolerance.finished(), true, "10 tiles away is still inside");
});

test("leaving both regions restarts the ten minutes and moves the regions", () => {
  const owner = holder();
  const tolerance = new AggressionTolerance(owner);
  ticks(tolerance, new Location(1750, 3470, 0), 1001);
  assert.equal(tolerance.finished(), true);
  tolerance.update(new Location(1761, 3470, 0));
  assert.equal(tolerance.finished(), false, "11 tiles out of both");
  const state = owner.getAttribute(AggressionTolerance.ATTRIBUTE);
  assert.deepEqual([state.older, state.newer], [{ x: 1750, y: 3470, z: 0 }, { x: 1761, y: 3470, z: 0 }]);
  // Back by the first spot: still inside the older region, so the new timer keeps running.
  ticks(tolerance, new Location(1750, 3470, 0), 1000);
  assert.equal(tolerance.finished(), true);
  tolerance.update(new Location(1750, 3470, 1));
  assert.equal(tolerance.finished(), false, "another plane is outside");
});

test("the state is a plain attribute, so a saved and reloaded player keeps their tolerance", () => {
  const before = holder();
  ticks(new AggressionTolerance(before), new Location(3100, 9830, 0), 1001);
  const after = holder();
  after.setAttribute(AggressionTolerance.ATTRIBUTE, JSON.parse(JSON.stringify(before.getAttribute(AggressionTolerance.ATTRIBUTE))));
  assert.equal(new AggressionTolerance(after).finished(), true, "logging out isn't leaving");
});
