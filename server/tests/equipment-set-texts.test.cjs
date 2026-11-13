// Run after `yarn build`: node --test tests/equipment-set-texts.test.cjs
// The Equip Your Character screen's "Equipment effects" panel shows enum 3047's text for varbit
// worn_items_set_text; each set plugin reports its full set's id.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");

let EquipmentStats;
before(async () => {
  await require("../dist/game/cache/CachePipeline").CachePipeline.initialize(process.cwd());
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  EquipmentStats = require("../plugins/interface/EquipmentStats.plugin");
  // Hunter takes the core at server startup, which this test does not run.
  require("../plugins/skills/hunter/Context.Hunter").H.core = PluginManager.getCoreApi();
});

function wearing(ids) {
  const player = new Player(null);
  for (const id of ids) {
    player.getEquipment().getItems()[ItemDefinition.forId(id).getEquipmentType().getSlot()] = new Item(id, 1);
  }
  return player;
}

const setText = (ids) => EquipmentStats._test.setText(wearing(ids));
const obj = (name) => CacheDefinitions.getObjId(name);

const SETS = {
  "Guthan's": [[4724, 4726, 4728, 4730], 3],
  Graceful: [[I.GRACEFUL_HOOD, I.GRACEFUL_CAPE, I.GRACEFUL_TOP, I.GRACEFUL_LEGS, I.GRACEFUL_GLOVES, I.GRACEFUL_BOOTS], 8],
  Angler: [[I.ANGLER_HAT, I.ANGLER_TOP, I.ANGLER_WADERS, I.ANGLER_BOOTS], 16],
  Lumberjack: [[I.LUMBERJACK_HAT, I.LUMBERJACK_TOP, I.LUMBERJACK_LEGS, I.LUMBERJACK_BOOTS], 17],
  Prospector: [[I.PROSPECTOR_HELMET, I.PROSPECTOR_JACKET, I.PROSPECTOR_LEGS, I.PROSPECTOR_BOOTS], 18],
  Farmer: [[I.FARMERS_STRAWHAT, I.FARMERS_JACKET, I.FARMERS_BORO_TROUSERS, I.FARMERS_BOOTS], 19],
  Pyromancer: [[I.PYROMANCER_HOOD, I.PYROMANCER_GARB, I.PYROMANCER_ROBE, I.PYROMANCER_BOOTS], 20],
  Rogue: [[I.ROGUE_MASK, I.ROGUE_TOP, I.ROGUE_TROUSERS, I.ROGUE_GLOVES, I.ROGUE_BOOTS], 22],
  Swampbark: [[I.SWAMPBARK_HELM, I.SWAMPBARK_BODY, I.SWAMPBARK_LEGS], 25],
  "Spirit angler": [[I.SPIRIT_ANGLER_HEADBAND, I.SPIRIT_ANGLER_TOP, I.SPIRIT_ANGLER_WADERS, I.SPIRIT_ANGLER_BOOTS], 28],
  "Raiments of the Eye": [[I.HAT_OF_THE_EYE, I.ROBE_TOP_OF_THE_EYE, I.ROBE_BOTTOMS_OF_THE_EYE, I.BOOTS_OF_THE_EYE], 30],
  Bloodrager: [[I.BLOOD_MOON_HELM, I.BLOOD_MOON_CHESTPLATE, I.BLOOD_MOON_TASSETS, I.DUAL_MACUAHUITL], 40],
  Frostweaver: [[I.BLUE_MOON_HELM, I.BLUE_MOON_CHESTPLATE, I.BLUE_MOON_TASSETS, I.BLUE_MOON_SPEAR], 42],
  Eclipse: [[I.ECLIPSE_MOON_HELM, I.ECLIPSE_MOON_CHESTPLATE, I.ECLIPSE_MOON_TASSETS, I.ECLIPSE_ATLATL], 43],
  "Guild hunter": [[I.GUILD_HUNTER_HEADWEAR, I.GUILD_HUNTER_TOP, I.GUILD_HUNTER_LEGS, I.GUILD_HUNTER_BOOTS], 47],
};

test("each full set shows its own enum 3047 text, and one piece short shows none", () => {
  for (const [name, [ids, expected]] of Object.entries(SETS)) {
    assert.equal(setText(ids), expected, name);
    assert.equal(setText(ids.slice(1)), 0, `${name} without its first piece`);
  }
});

test("the Carpenter's and Zealot's outfits show their texts", () => {
  const carpenter = ["construction_hat", "construction_shirt", "construction_trousers", "construction_boots"].map(obj);
  assert.equal(setText(carpenter), 23);
  const zealot = ["shades_prayer_helm", "shades_prayer_top", "shades_prayer_bottom", "shades_prayer_boots"].map(obj);
  assert.equal(setText(zealot), 27);
});

test("a mixed angler outfit shows the plain angler text; the spirit text needs every spirit piece", () => {
  assert.equal(setText([I.SPIRIT_ANGLER_HEADBAND, I.ANGLER_TOP, I.SPIRIT_ANGLER_WADERS, I.SPIRIT_ANGLER_BOOTS]), 16);
});

test("the Moons texts need the set's weapon", () => {
  assert.equal(setText([I.BLOOD_MOON_HELM, I.BLOOD_MOON_CHESTPLATE, I.BLOOD_MOON_TASSETS]), 0);
  assert.equal(setText([I.BLUE_MOON_HELM, I.BLUE_MOON_CHESTPLATE, I.BLUE_MOON_TASSETS]), 0);
  assert.equal(setText([I.ECLIPSE_MOON_HELM, I.ECLIPSE_MOON_CHESTPLATE, I.ECLIPSE_MOON_TASSETS]), 0);
});
