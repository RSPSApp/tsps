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
  if (site.kind === "station") return DATA.production.searchTiles;
  return site.skill === "COMBAT" ? site.searchTiles ?? DATA.combat.searchTiles : DATA.auto.searchTiles;
}

/** Production sites: a station is one object (a range, a furnace); "anywhere" needs none. */
const PRODUCTION_KINDS = ["station", "anywhere"];

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

/** Bosses their plugins spawn (not in npc-spawns.json): where, by the plugin's own tiles. */
function pluginBossTiles(name) {
  if (name === "Gemstone Crab") return require("../plugins/bosses/GemstoneCrab.plugin")._test.SPOTS.map(({ crab: [x, y] }) => [x, y, 0]);
  if (name === "Scurrius") return [require("../plugins/bosses/scurrius/Common.Scurrius").SPAWN_TILE];
  return [];
}

function pluginBossesInReach(site) {
  const [x0, y0, z] = site.tile;
  return pluginBossTiles(site.target).filter(([x, y, bz = 0]) => bz === z && Math.max(Math.abs(x - x0), Math.abs(y - y0)) <= reach(site)).length;
}

/** Idle Mode's bonfires (fires placed at startup, not in the map) a Fire station has in reach. */
function bonfiresInReach(site) {
  if (site.target !== "Fire") return 0;
  const [x0, y0, z] = site.tile;
  return (DATA.production.bonfires?.tiles ?? []).filter(([x, y, bz = 0]) => bz === z && Math.max(Math.abs(x - x0), Math.abs(y - y0)) <= reach(site)).length;
}

test("bonfires: an ObjectIdentifiers fire on free tiles", () => {
  const { object, tiles } = DATA.production.bonfires;
  const id = core.ObjectIdentifiers[object];
  assert.ok(Number.isInteger(id), object);
  assert.equal(core.ObjectDefinition.forId(id).getName(), "Fire");
  for (const [x, y, z = 0] of tiles) {
    core.RegionManager.loadMapFiles(x, y);
    assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false, `bonfire tile ${x},${y}`);
  }
});

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
    const production = PRODUCTION_KINDS.includes(site.kind);
    const skills = production ? DATA.production.skills : [...DATA.skills, "COMBAT"];
    assert.ok(skills.includes(site.skill), `${site.id}: ${site.skill}`);
    assert.ok(["object", "npc", ...PRODUCTION_KINDS].includes(site.kind), site.id);
    assert.ok(!production || typeof site.tip === "string", `${site.id}: a production site tells the player what to do`);
    assert.ok(Number.isInteger(site.level) && site.level >= 1 && site.level <= 99, site.id);
    assert.ok(site.skill !== "COMBAT" || site.kind === "npc", `${site.id}: monsters are NPCs`);
  }
});

for (const site of DATA.travel.sites) {
  test(`${site.id}: a free tile${site.target ? ` with ${site.target} (${site.option}) in reach` : ""}`, () => {
    const [x, y, z] = site.tile;
    core.RegionManager.loadMapFiles(x, y);
    assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false, `${site.id}: arrival tile ${site.tile} is blocked`);
    if (site.kind !== "anywhere") {
      const count = site.kind === "npc" ? npcsInReach(site) + pluginBossesInReach(site) : objectsInReach(site) + bonfiresInReach(site);
      // A station, a stall (it stays stocked for an idle thief) or a boss is enough on its own.
      const needed = site.kind === "station" || site.boss || (site.skill === "THIEVING" && site.kind === "object") ? 1 : MIN_TARGETS;
      assert.ok(count >= needed, `${site.id}: ${count} ${site.target} within ${reach(site)} tiles`);
    }
    const icon = core.ItemDefinition.forId(site.icon);
    assert.ok(icon?.getName?.() && icon.getName() !== "null", `${site.id}: icon ${site.icon} is an item`);
  });
}

test("onboarding: the starter kit's ids are the items it names, and the start tile is free", () => {
  for (const { id, name, amount } of DATA.onboarding.starterKit) {
    assert.equal(core.ItemDefinition.forId(id)?.getName?.(), name, `item ${id}`);
    assert.ok(Number.isInteger(amount) && amount >= 1, name);
  }
  const [x, y, z] = DATA.onboarding.startTile;
  core.RegionManager.loadMapFiles(x, y);
  assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false, `start tile ${DATA.onboarding.startTile} is blocked`);
});
