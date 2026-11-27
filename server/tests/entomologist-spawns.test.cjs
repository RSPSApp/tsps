// Run: node --test tests/entomologist-spawns.test.cjs
// The Entomologist (NPC 491) is Buggie, found dead in the centre of the Kalphite Cave: a body with a
// single Search option that has no reason to walk anywhere (Wiki: Entomologist, {{Map|x=3307|y=9506}}).
// Without a wanderRadius the loader's default of 5 let him drift around the cave (issue 6866).
const test = require("node:test");
const assert = require("node:assert/strict");

const ENTOMOLOGIST = 491;
const SPAWN = { x: 3307, y: 9506 };
const spawns = require("../data/definitions/npc-spawns.json").filter((row) => row.id === ENTOMOLOGIST);

test("the Entomologist is spawned once, in the centre of the Kalphite Cave", () => {
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].name, "Entomologist");
  assert.deepEqual({ x: spawns[0].x, y: spawns[0].y }, SPAWN);
});

test("the Entomologist stays where he lies", () => {
  assert.equal(spawns[0].wanderRadius, 0);
});
