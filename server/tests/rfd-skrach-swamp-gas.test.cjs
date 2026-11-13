// Run after `yarn build`: node --test tests/rfd-skrach-swamp-gas.test.cjs
// Recipe for Disaster (Freeing Skrach Uglogwee): filling the ogre bellows at the swamp bubbles is a step, and its
// progress (skrach stage 110) was set only when the bellows were used on the bubbles; left-click Suck, which fills
// them the same way since the 8 February 2018 update (Wiki: Swamp bubbles), never marked it. Real engine: every
// plugin loaded, a real Player and Inventory, the Swamp bubbles Suck hook and the real TaskManager tick.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Bubbles = require("../plugins/objects/SwampBubbles.plugin");

const SKRACH_STAGE = "recipe-for-disaster:skrach-stage";
const SKRACH_STATE = "recipe-for-disaster:skrach-state";
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, skrachStarted) {
  const p = new Player(null);
  p.setIndex(9330 + (skrachStarted ? 1 : 0));
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, "isRegistered", () => true);
  t.mock.method(p.getInventory(), "refreshItems", () => p.getInventory());
  const rfd = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "recipe_for_disaster");
  rfd.setStage(p, 4);
  if (skrachStarted) p.setAttribute(SKRACH_STATE, 1);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.OGRE_BELLOWS, 1));
  return p;
}

function suck(p) {
  Bubbles.suck({ player: p, objectId: core.ObjectIdentifiers.SWAMP_BUBBLES, option: "Suck", clickType: 1, handled: false });
  TaskManager.process();
}

test("Suck filling the bellows marks Skrach's bellows step, as using them on the bubbles does", (t) => {
  const p = player(t, true);
  suck(p);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.OGRE_BELLOWS_3_), 1, "the bellows are filled");
  assert.equal(p.getAttribute(SKRACH_STAGE), 110);
});

test("before Skrach's part is started, Suck fills the bellows and leaves his progress alone", (t) => {
  const p = player(t, false);
  suck(p);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.OGRE_BELLOWS_3_), 1);
  assert.equal(p.getAttribute(SKRACH_STAGE) ?? 0, 0);
});
