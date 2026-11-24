// Run: node --test tests/ancient-fungi-spawns.test.cjs
// Fossil Island's Ancient fungi (NPC 471) show as the buried "Pick" form (8690) until a player picks
// one, and a buried fungus stays where it grew. Without a wanderRadius the loader's default of 5 had
// them drift around while still buried (issue 6657).
const test = require("node:test");
const assert = require("node:assert/strict");

const ANCIENT_FUNGI = 471;
const spawns = require("../data/definitions/npc-spawns.json").filter((row) => row.id === ANCIENT_FUNGI);

test("Ancient fungi spawns exist", () => {
  assert.equal(spawns.length, 27);
  assert.ok(spawns.every((row) => row.name === "Ancient Fungi"));
});

test("every Ancient fungi spawn stands still", () => {
  const wanderers = spawns.filter((row) => row.wanderRadius !== 0);
  assert.deepEqual(wanderers, []);
});
