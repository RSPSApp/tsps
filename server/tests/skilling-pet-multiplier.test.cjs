// Run after `yarn build`: node --test tests/skilling-pet-multiplier.test.cjs
// world.json pluginConfig "Pets:skillingPetMultiplier" makes every skilling pet roll that many
// times likelier (docs/world-configuration.md); unset, 1 or nonsense keeps the OSRS rate.
const assert = require("node:assert/strict"), path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core, Pets, next = 1600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
  Pets = require("../plugins/npcs/Pets.plugin");
});
after(() => PM.emitServerShutdown({}));

function player() {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("petrate" + next); p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  return p;
}

/** Whether a 1-in-1,000 Fishing pet roll landing at `roll` gives the pet, at this multiplier. */
function rolls(t, roll, multiplier) {
  t.mock.method(PM, "getPluginConfig", (key, fallback) => key === "Pets:skillingPetMultiplier" && multiplier !== undefined ? multiplier : fallback);
  t.mock.method(Math, "random", () => roll);
  return Pets.__internals.onSkill(player(), core.Skill.FISHING, { petChance: 1000 });
}

test("unset, the roll is the OSRS 1 in 1,000", (t) => {
  assert.equal(rolls(t, 0.0009), true);
  assert.equal(rolls(t, 0.0011), false);
});

test("a multiplier of 100 makes it 1 in 10", (t) => {
  assert.equal(rolls(t, 0.09, 100), true);
  assert.equal(rolls(t, 0.11, 100), false);
});

test("a roll never gets better than certain", (t) => {
  assert.equal(rolls(t, 0.999, 1_000_000), true);
});

test("1, below 1 or not a number keeps the OSRS rate", (t) => {
  for (const multiplier of [1, 0.5, -3, "lots"]) assert.equal(rolls(t, 0.0011, multiplier), false, String(multiplier));
});
