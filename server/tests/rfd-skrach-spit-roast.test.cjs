// Run after `yarn build`: node --test tests/rfd-skrach-spit-roast.test.cjs
// #6281: two spit-roasts stood by Rantz's cave. The map's roast at 2630,2990 is the multiloc
// multi_chompybird_spitroast_entity (6895, varbit ogre_spit_roaster), and a use on it names that parent. Freeing
// Skrach's jubbly handler listed only the 3372-12563 children, so the quest spawned its own ogre spit-roast at
// 2632,2985 to cook on. Real engine: every plugin loaded, a real Player and Inventory, the real item-on-object
// emit with the parent id the client sends (rsprox capture BigChompyBirdHunting.bin, oploct_v2 on 6895).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const SKRACH_STAGE = "recipe-for-disaster:skrach-stage";
const SKRACH_STATE = "recipe-for-disaster:skrach-state";
const CHOMPY_SPIT_ROAST = 6895;
let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2630, 2990);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, index) {
  const p = new Player(null);
  p.setIndex(index);
  p.setLocation(new core.Location(2630, 2989, 0));
  t.mock.method(p, "getSession", () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p, "isRegistered", () => true);
  t.mock.method(p.getInventory(), "refreshItems", () => p.getInventory());
  const rfd = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "recipe_for_disaster");
  p.setAttribute(SKRACH_STATE, 31);
  rfd.setStage(p, 4);
  TaskManager.process();
  return p;
}

function spitRoastsNearRantz() {
  return [...core.World.getObjects()].filter((object) => {
    const loc = object?.getLocation?.();
    return loc && loc.getZ() === 0 && Math.abs(loc.getX() - 2631) <= 4 && Math.abs(loc.getY() - 2988) <= 4
      && /spit-roast/i.test(core.CacheDefinitions.getObject(object.getId())?.name ?? "");
  });
}

test("the raw jubbly cooks on Rantz's spit-roast, the multiloc the map places", (t) => {
  const p = player(t, 9361);
  p.getInventory().add(new core.Item(core.ItemIdentifiers.RAW_JUBBLY, 1));
  t.mock.method(Math, "random", () => 0.99);
  const object = MapObjects.get(CHOMPY_SPIT_ROAST, new core.Location(2630, 2990, 0), null);
  assert.ok(object, "the map places the multiloc at 2630,2990");
  const handled = PM.emitItemOnObject({
    player: p, object, objectId: CHOMPY_SPIT_ROAST, itemId: core.ItemIdentifiers.RAW_JUBBLY, itemSlot: 0,
    item: new core.Item(core.ItemIdentifiers.RAW_JUBBLY, 1), location: { x: 2630, y: 2990, z: 0 }, handled: false,
  });
  assert.equal(handled, true);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.RAW_JUBBLY), 0);
  assert.equal(p.getInventory().getAmount(core.ItemIdentifiers.COOKED_JUBBLY), 1);
  assert.equal(p.getAttribute(SKRACH_STAGE), 160);
});

test("Freeing Skrach adds no second spit-roast beside the map's", (t) => {
  player(t, 9362);
  assert.deepEqual(spitRoastsNearRantz().map((object) => object.getId()), []);
});
