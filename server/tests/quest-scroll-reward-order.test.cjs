// node --test tests/quest-scroll-reward-order.test.cjs
// The completion scroll's reward lines in each quest's recorded order.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const runtime = require("../plugins/quests/QuestRuntime");

const QUESTS = {
  the_red_reef: "RedReef",
  shadows_of_custodia: "ShadowsOfCustodia",
  troubled_tortugans: "TroubledTortugans",
  scrambled: "Scrambled",
};

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  for (const file of Object.values(QUESTS)) require(`../plugins/quests/quests/${file}.Quest`)(PluginManager.createApi(`${file}ScrollTest`));
});

const scroll = (key) => runtime.rewardLines(runtime.getRegisteredQuests().findLast((quest) => quest.key === key)).slice(1);

test("Red Reef: the access on two lines, the schematic, then XP (rsprox 238/04152.txt:62418-62423)", () => {
  assert.deepEqual(scroll("the_red_reef"), ["2 Quest Points", "Great Conch Sacred Grove", "Access", "Bosun's Workbench Schematic",
    "15,000 Sailing XP", "5,000 Smithing XP"]);
});

test("Shadows of Custodia: the den, then XP (rsprox 238/04190.txt:32757-32763)", () => {
  assert.deepEqual(scroll("shadows_of_custodia"), ["2 Quest Points", "Stalker Den Access", "10,000 Slayer XP", "4,000 Hunter XP",
    "3,000 Fishing XP", "3,000 Construction XP"]);
});

test("Troubled Tortugans: the conch, then XP (rsprox 235/03456.txt)", () => {
  assert.deepEqual(scroll("troubled_tortugans"), ["1 Quest Point", "Great Conch Access", "10,000 Sailing XP", "8,000 Slayer XP"]);
});

test("Scrambled keeps the usual order: XP before the item", () => {
  const lines = scroll("scrambled");
  assert.equal(lines[0], "1 Quest Point");
  assert.ok(lines.indexOf("Your very own egg") > lines.findLastIndex((line) => line.endsWith(" XP")));
});
