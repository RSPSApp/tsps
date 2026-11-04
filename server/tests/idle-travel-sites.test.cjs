// Idle travel's sites (plugins/modes/data/idle-mode.json "travel") against the cache map: every
// arrival tile is free to stand on, and the site's targets (the trees, rocks, fishing spots or
// monsters it names, with its option) are within the reach auto-resume or idle combat searches
// from that tile, so travelling there always finds work. Its icon is a real item.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");

const DATA = require("../plugins/modes/data/idle-mode.json");
const SPAWNS = require("../data/definitions/npc-spawns.json");
/** Targets a site must have in reach: one is a site that a single other player can empty. */
const MIN_TARGETS = 2;

let core;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.RegionManager.init();
});

/** How far the activity looks for its targets from the anchor. */
function reach(site) {
  return site.skill === "COMBAT" ? DATA.combat.searchTiles : DATA.auto.searchTiles;
}

const hasOption = (options, option) => (options ?? []).some((entry) => typeof entry === "string" && entry.toLowerCase() === option.toLowerCase());

function objectsInReach(site) {
  const [x0, y0, z] = site.tile;
  const radius = reach(site);
  for (let dx = -radius; dx <= radius; dx += 8) {
    for (let dy = -radius; dy <= radius; dy += 8) core.RegionManager.loadMapFiles(x0 + dx, y0 + dy);
  }
  let count = 0;
  for (let x = x0 - radius; x <= x0 + radius; x++) {
    for (let y = y0 - radius; y <= y0 + radius; y++) {
      for (const object of core.MapObjects.mapObjects.get(core.MapObjects.getHash(x, y, z)) ?? []) {
        const definition = object.getDefinition?.();
        if (definition?.getName?.() === site.target && hasOption(definition.getInteractions?.(), site.option)) count++;
      }
    }
  }
  return count;
}

/** NPC spawns of that name, with the option, in reach (a fishing spot's id sets its options). */
function npcsInReach(site) {
  const [x0, y0, z] = site.tile;
  const radius = reach(site);
  return SPAWNS.filter((spawn) => (spawn.level ?? 0) === z && Math.max(Math.abs(spawn.x - x0), Math.abs(spawn.y - y0)) <= radius)
    .filter((spawn) => {
      const definition = core.NpcDefinition.forId(spawn.id);
      return definition?.getName?.() === site.target && hasOption(definition.getActions?.(), site.option);
    }).length;
}

test("every site has a unique id, a known activity and a level", () => {
  const ids = new Set();
  for (const site of DATA.travel.sites) {
    assert.ok(!ids.has(site.id), `duplicate ${site.id}`);
    ids.add(site.id);
    assert.ok(["WOODCUTTING", "MINING", "FISHING", "COMBAT"].includes(site.skill), site.id);
    assert.ok(["object", "npc"].includes(site.kind), site.id);
    assert.ok(Number.isInteger(site.level) && site.level >= 1 && site.level <= 99, site.id);
    assert.ok(site.skill !== "COMBAT" || site.kind === "npc", `${site.id}: monsters are NPCs`);
  }
});

for (const site of DATA.travel.sites) {
  test(`${site.id}: a free tile with ${site.target} (${site.option}) in reach`, () => {
    const [x, y, z] = site.tile;
    core.RegionManager.loadMapFiles(x, y);
    assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false, `${site.id}: arrival tile ${site.tile} is blocked`);
    const count = site.kind === "object" ? objectsInReach(site) : npcsInReach(site);
    assert.ok(count >= MIN_TARGETS, `${site.id}: ${count} ${site.target} within ${reach(site)} tiles`);
    const icon = core.ItemDefinition.forId(site.icon);
    assert.ok(icon?.getName?.() && icon.getName() !== "null", `${site.id}: icon ${site.icon} is an item`);
  });
}
