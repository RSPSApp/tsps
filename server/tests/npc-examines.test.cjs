// Run after `yarn build`: node --test tests/npc-examines.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");

test("an NPC with no Attack option gets its Wiki examine, not the generic line (#2127)", () => {
  const wiseOldMan = new NpcDefinition();
  Object.assign(wiseOldMan, { id: 2108, name: "Wise Old Man" });
  assert.equal(wiseOldMan.getExamine(), "A venerable and rich sage.");
});

test("an NPC the Wiki dump misses keeps the generic line", () => {
  const unknown = new NpcDefinition();
  Object.assign(unknown, { id: -5, name: "Wise Old Man" });
  assert.equal(unknown.getExamine(), "It's a Wise Old Man.");
});
