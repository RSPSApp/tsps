// The Grand Tree's ladder column (2466,3495) offers "Top-Floor" and "Bottom-Floor" with a capital
// F, while Lumbridge's staircases spell the same options "Top-floor"/"Bottom-floor". The object
// option dispatch is an exact Map lookup on the cache's action string, so registering only the
// lowercase spelling left the Grand Tree's two options with no handler — the click was dropped and
// nothing happened (#4085).
//
// Run after `yarn build`: node --test tests/grand-tree-ladder.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { Location } = require("../dist/game/model/Location");

const LADDER = 2466;
const LADDER_Y = 3495;
const FLOOR_TILES = [2466, 3496, 0];

let plugin;
let options;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  plugin = require("../plugins/objects/Ladders.plugin");
  const noop = () => {};
  const api = new Proxy(
    {
      core: PluginManager.getCoreApi(),
      getTaskManager: () => ({ submit: noop }),
      onObjectInteraction: (name, actions) => {
        if (name === "Ladder") options = actions;
      },
    },
    { get: (target, key) => target[key] ?? noop },
  );
  plugin.register(api);
});

test("the cache spells the Grand Tree's options with a capital F", () => {
  assert.ok(CacheDefinitions.getObject(4458).actions.includes("Top-Floor"), "plane 0 offers Top-Floor");
  assert.ok(CacheDefinitions.getObject(56233).actions.includes("Top-Floor"), "plane 1 offers Top-Floor");
  assert.ok(CacheDefinitions.getObject(56232).actions.includes("Bottom-Floor"), "plane 2 offers Bottom-Floor");
  assert.ok(CacheDefinitions.getObject(56229).actions.includes("Bottom-Floor"), "plane 3 offers Bottom-Floor");
  // The lowercase spelling the plugin always had is a different string, and still in use elsewhere.
  assert.ok(CacheDefinitions.getObject(4568).actions.includes("Top-floor"), "Lumbridge keeps the lowercase one");
});

test("both spellings have a handler on Ladder", () => {
  for (const option of ["Top-floor", "Top-Floor", "Bottom-floor", "Bottom-Floor", "Climb-up", "Climb-down"]) {
    assert.equal(typeof options[option], "function", `${option} is wired`);
  }
});

test("the shaft walks to its far end from either direction", () => {
  RegionManager.loadMapFiles(LADDER, LADDER_Y);
  const at = (z) => {
    const object = (MapObjects.mapObjects.get(MapObjects.getHash(LADDER, LADDER_Y, z)) ?? [])
      .find((candidate) => candidate.getId() === [4458, 56233, 56232, 56229][z]);
    assert.ok(object, `the ladder on plane ${z} is placed`);
    return object;
  };
  const ClimbLinks = require("../plugins/objects/ClimbLinks");
  const from = new Location(LADDER, LADDER_Y + 1, 0);

  const top = ClimbLinks.destination(at(0), ClimbLinks.UP, from, null, true);
  assert.equal(top.getZ(), 3, "Top-Floor from the bottom reaches plane 3");

  const bottom = ClimbLinks.destination(at(3), ClimbLinks.DOWN, new Location(LADDER, LADDER_Y + 1, 3), null, true);
  assert.equal(bottom.getZ(), 0, "Bottom-Floor from the top reaches plane 0");

  // Without the far-end flag it is still a single floor, so the ordinary climb options are untouched.
  const oneFloor = ClimbLinks.destination(at(0), ClimbLinks.UP, from, null, false);
  assert.equal(oneFloor.getZ(), 1, "a plain climb-up still moves one floor");
});
