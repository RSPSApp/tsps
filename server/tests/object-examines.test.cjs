// Run after `yarn build`: node --test tests/object-examines.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const examines = require("../data/definitions/object-examines.json");
const overrides = require("../data/definitions/object-examine-overrides.json");

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
});

test("a tree's examine is the Wiki's, per version of the tree", () => {
  assert.equal(ObjectDefinition.forId(1276).getExamine(), "One of the most common trees in Gielinor.");
  assert.equal(ObjectDefinition.forId(1278).getExamine(), "A commonly found tree.");
});

test("an examine captured live wins over the Wiki's and covers ids its pages miss", () => {
  for (const [id, text] of Object.entries(overrides)) assert.equal(ObjectDefinition.examineText(Number(id)), text, `object ${id}`);
  assert.equal(ObjectDefinition.forId(6768).getExamine(), "A good source of books!", "poh_bookcase1, on no Wiki page");
});

test("an object with no recorded examine keeps the generic line", () => {
  const unknown = [...Array(ObjectDefinition.totalObjects).keys()].find((id) => !examines[id] && !overrides[id] && ObjectDefinition.forId(id)?.getName() === "Tree");
  if (unknown !== undefined) assert.equal(ObjectDefinition.forId(unknown).getExamine(), "It's a Tree.");
});

test("both files are minified, and no wiki markup or placeholders are left in the texts", () => {
  const fs = require("node:fs");
  for (const file of ["object-examines.json", "object-examine-overrides.json"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../data/definitions", file), "utf8"), /\n|": "/, file);
  }
  const leftovers = Object.entries({ ...examines, ...overrides }).filter(([, text]) => /\[\[|\]\]|\{\{|\}\}|<[a-z/]|''|^N\/A$|^\(Unlit\)|^\*/i.test(text));
  assert.deepEqual(leftovers, []);
});

test("every override still differs from the dump (an override the dump caught up with can go)", () => {
  const same = Object.entries(overrides).filter(([id, text]) => examines[id] === text).map(([id]) => id);
  assert.deepEqual(same, []);
});
