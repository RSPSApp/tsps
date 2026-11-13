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

// Sets whose effect is not implemented yet still name it (plugins/interface/data/equipment-set-texts.json).
const DATA_SETS = {
  "Shayzien (1)": [[13359, 13361, 13360, 13357, 13358], 21],
  "Shayzien (5)": [[13379, 13381, 13380, 13377, 13378], 21],
  Bloodbark: [[25413, 25404, 25416, 25407, 25410], 26],
  Virtus: [[26241, 26243, 26245], 29],
  "Smiths' uniform": [[27023, 27025, 27029, 27027], 31],
  "Smiths' uniform, gloves (i)": [[27023, 27025, 27031, 27027], 31],
  "Statius's": [[27833, 27834, 27835], 32],
  "Vesta's": [[27831, 27832], 33],
  "Morrigan's": [[27836, 27837, 27838], 34],
  "Zuriel's": [[27839, 27840, 27841], 35],
  "Statius's corrupted": [[27844, 27845, 27846], 36],
  "Vesta's corrupted": [[27842, 27843], 37],
  "Morrigan's corrupted": [[27847, 27848, 27849], 38],
  "Zuriel's corrupted": [[27850, 27851, 27852], 39],
  Kyatt: [[10039, 10037, 10035], 44],
  Graahk: [[10051, 10049, 10047], 45],
  Larupia: [[10045, 10043, 10041], 46],
};

test("sets with no implemented effect yet show their text from the data file", () => {
  for (const [name, [ids, expected]] of Object.entries(DATA_SETS)) {
    assert.equal(setText(ids), expected, name);
    assert.equal(setText(ids.slice(1)), 0, `${name} without its first piece`);
  }
});

test("mixed tiers or variants, and inactive Bounty Hunter pieces, are no set", () => {
  assert.equal(setText([13379, 13361, 13380, 13377, 13378]), 0, "a tier 1 platebody in a tier 5 set");
  assert.equal(setText([27844, 27834, 27835]), 0, "a corrupted helm with the plain Statius's pieces");
  assert.equal(setText([27931, 27834, 27835]), 0, "an inactive helm");
});

// Recorded on live: in-use (degraded) Moons pieces still make the set, the Bloodrager text needs the
// dual macuahuitl, Raiments recolours mix with plain pieces, and Smiths gloves (i) count as the gloves.
test("recorded cases: degraded Moons pieces, the Moons weapon, mixed Raiments colours", () => {
  assert.equal(setText([I.BLOOD_MOON_HELM_4, I.BLOOD_MOON_CHESTPLATE_4, I.BLOOD_MOON_TASSETS_4, I.DUAL_MACUAHUITL]), 40);
  assert.equal(setText([I.BLOOD_MOON_HELM_4, I.BLOOD_MOON_CHESTPLATE_4, I.BLOOD_MOON_TASSETS_4, I.BOW_OF_FAERDHINEN]), 0);
  assert.equal(setText([I.BLUE_MOON_HELM_4, I.BLUE_MOON_CHESTPLATE_4, I.BLUE_MOON_TASSETS_4, I.BLUE_MOON_SPEAR]), 42);
  assert.equal(setText(["hat_of_the_eye_blue", "robe_top_of_the_eye_blue", "robe_bottom_of_the_eye_blue", "boots_of_the_eye"].map(obj)), 30);
});
