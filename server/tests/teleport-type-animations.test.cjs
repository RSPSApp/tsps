// Run after `yarn build`: node --test tests/teleport-type-animations.test.cjs
// Lunar and Arceuus spell teleports and the lever animate as in rsprox captures of live OSRS.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { TeleportType } = require("../dist/game/model/teleportation/TeleportType");
const { Animation } = require("../dist/game/model/Animation");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
});

const seq = (name) => CacheDefinitions.getSeqId(name);
const spotanim = (name) => CacheDefinitions.getSpotanimId(name);
const RESET = Animation.DEFAULT_RESET_ANIMATION.getId();

test("a Lunar teleport shows lunar_teleport_spotanim, not the pickaxe summon effect", () => {
  assert.equal(TeleportType.LUNAR.getStartAnimation().getId(), seq("human_teleport_other_impact"));
  assert.equal(TeleportType.LUNAR.getStartGraphic().getId(), spotanim("lunar_teleport_spotanim"));
});

test("an Arceuus teleport has its own animation and graphic, not the Lunar ones", () => {
  assert.equal(TeleportType.ARCEUUS.getStartAnimation().getId(), seq("arceuus_necromancy_anim"));
  assert.equal(TeleportType.ARCEUUS.getStartGraphic().getId(), spotanim("arceuus_teleport_spotanim"));
});

test("a lever teleports with the standard teleport's graphic", () => {
  assert.equal(TeleportType.LEVER.getStartAnimation().getId(), seq("macro_lever_switch_down"));
  assert.equal(TeleportType.LEVER.getMiddleAnim().getId(), seq("human_castteleport"));
  assert.equal(TeleportType.LEVER.getMiddleGraphic().getId(), spotanim("teleport_casting"));
});

test("none of them lands with the reversed teleport cast", () => {
  for (const name of ["LUNAR", "ARCEUUS", "LEVER"]) {
    assert.equal(TeleportType[name].getEndAnimation().getId(), RESET, name);
  }
});
