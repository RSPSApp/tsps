// Run after `yarn build`: node --test tests/pest-control-pest-stats.test.cjs
// A pest's hit points at each lander's combat level, from the OSRS Wiki's monster pages
// (Splatter, Shifter, Ravager, Spinner, Torcher, Defiler, Brawler).
"use strict";
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const path = require("node:path");

process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const plugin = require("../plugins/minigames/PestControl.plugin");

const core = PluginManager.getCoreApi();
const api = new Proxy({
  core,
  getAreaManager: () => ({ areas: [] }),
  getObjectManager: () => ObjectManager,
  getRegionManager: () => RegionManager,
  getWorld: () => World,
}, { get: (object, key) => object[key] ?? (() => {}) });

// Wiki hit points at the levels the plugin gives each tier (Novice, Intermediate, Veteran).
const WIKI_HITPOINTS = {
  splatter: [13, 23, 33], shifter: [23, 38, 53], ravager: [23, 38, 53],
  spinner: [33, 53, 73], torcher: [18, 30, 45], defiler: [27, 45, 62], brawler: [53, 83, 113],
};
const TIERS = ["novice", "intermediate", "veteran"];
const matches = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  RegionManager.init();
  RegionManager.loadMapFiles(2656, 2592);
  plugin.register(api);
});

after(() => { for (const match of matches) if (!match.ended) match.finish(false, "test over"); });

function startMatch(key) {
  const boat = plugin._test.BOATS.find((entry) => entry.key === key);
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.sendMessage = () => {};
  player.getForcedLogoutTimer = () => ({ start() {} });
  player.requestLogout = () => {};
  player.setLocation(boat.waitingLocation.clone());
  const match = new plugin._test.PestControlMatch(boat, [player], () => {});
  matches.push(match);
  return match;
}

/** Spawns one wave with every roll at 0: the first pest type (shifter) on its tier's first id. */
function firstWavePest(match) {
  const random = Math.random;
  Math.random = () => 0;
  try {
    match.spawnWave();
  } finally {
    Math.random = random;
  }
  return [...match.npcs].find((npc) => npc.__pcType === "shifter");
}

test("every pest type gets its Wiki hit points at each lander's level", () => {
  const { PEST_IDS, applyPestStats } = plugin._test;
  for (const [type, perTier] of Object.entries(WIKI_HITPOINTS)) {
    for (let tier = 0; tier < TIERS.length; tier++) {
      for (const id of PEST_IDS[type][tier]) {
        const npc = new core.NPC(id, new Location(2657, 2592, 0));
        applyPestStats(npc, type, tier);
        assert.equal(npc.getHitpoints(), perTier[tier], `${TIERS[tier]} ${type} (npc ${id})`);
        assert.equal(npc.getDefinition().getHitpoints(), perTier[tier], `${TIERS[tier]} ${type} (npc ${id}) max`);
      }
    }
  }
});

test("a novice game's first-wave shifter has 23 hit points, not twice its level", () => {
  const pest = firstWavePest(startMatch("novice"));
  assert.ok(pest, "the wave spawned a shifter");
  assert.equal(pest.getHitpoints(), 23);
});

test("a veteran game does not leave its hit points on a pest id the novice lander shares", () => {
  const { PEST_IDS, applyPestStats } = plugin._test;
  const shared = PEST_IDS.shifter[2].find((id) => PEST_IDS.shifter[0].includes(id));
  assert.ok(shared, "the novice and veteran shifter lists share an id");
  applyPestStats(new core.NPC(shared, new Location(2657, 2592, 0)), "shifter", 2);
  const novice = new core.NPC(shared, new Location(2657, 2592, 0));
  applyPestStats(novice, "shifter", 0);
  assert.equal(novice.getHitpoints(), 23);
});
