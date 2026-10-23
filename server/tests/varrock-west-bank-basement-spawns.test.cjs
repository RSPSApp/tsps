// Run after `yarn build`: node --test tests/varrock-west-bank-basement-spawns.test.cjs
// The Wiki's item spawns in Varrock west bank's basement (issue #801).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const spawns = require("../data/definitions/ground-items.json");
const inBasement = spawns.filter(({ location: { x, y, z } }) =>
  x >= 3188 && x <= 3196 && y >= 9818 && y <= 9835 && z === 0);
const key = ({ id, location: { x, y }, amt, respawn }) => `${id}@${x},${y} x${amt} r${respawn}`;

test("Varrock west bank basement has the Wiki's item spawns", () => {
  assert.deepEqual(inBasement.map(key).sort(), [
    "444@3195,9821 x1 r500",
    "995@3188,9819 x26 r100",
    "995@3188,9820 x42 r100",
    "995@3189,9819 x35 r100",
    "995@3190,9819 x56 r100",
    "995@3191,9821 x66 r100",
    "995@3195,9820 x4 r100",
    "995@3195,9834 x3 r100",
    "1009@3191,9820 x1 r100",
    "1641@3196,9822 x1 r500",
    "1654@3192,9821 x1 r500",
    "2357@3192,9822 x1 r1500",
  ].sort());
});
