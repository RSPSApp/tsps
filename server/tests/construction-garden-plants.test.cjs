// Run after `yarn build`: node --test tests/construction-garden-plants.test.cjs
//
// POH garden plants water in (rsprox captures, poh_furniture_creation:contents): a can with
// water is needed, one charge goes, and the build gives Farming experience equal to its
// Construction experience. The water goes through Farming's own "farming:use-water".
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");

let core, FarmingData, House, Data, GardenPlants, events;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  events = new Map();
  require("../plugins/skills/farming/Core.Farming").init({ core });
  FarmingData = require("../plugins/skills/farming/Data.Farming");
  FarmingData.initializeFarmingData();
  require("../plugins/skills/farming/Patches.Farming").attach(new Proxy({}, { get: (_, name) => (...args) => {
    if (name === "onCustomEvent") events.set(args[0], args[1]);
  } }));
  require("../plugins/skills/construction/Core.Construction").init({
    core, emitCustomEvent: (name, payload) => events.get(name)?.(payload),
  });
  Data = require("../plugins/skills/construction/Data.Construction");
  House = require("../plugins/skills/construction/House.Construction");
  GardenPlants = require("../plugins/skills/construction/GardenPlants.Construction");
});

function builder(can) {
  const player = new Player(null);
  const sender = new Proxy({}, { get: () => () => sender });
  const sent = { animations: [], graphics: [], messages: [] };
  player.getPacketSender = () => sender;
  player.sendMessage = (message) => sent.messages.push(message);
  player.performAnimation = (animation) => sent.animations.push(animation.getId?.() ?? animation.id);
  player.performGraphic = (graphic) => sent.graphics.push(graphic.getId?.() ?? graphic.id);
  player.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, 99, false);
  player.getSkillManager().setMaxLevel?.(core.Skill.CONSTRUCTION, 99, false);
  const inventory = player.getInventory();
  inventory.add(new core.Item(core.ItemIdentifiers.HAMMER), false).add(new core.Item(core.ItemIdentifiers.SAW), false);
  for (const material of Data.BUILDABLE_BY_KEY.get("PLANT").materials) {
    if (material.itemId != null) inventory.add(new core.Item(material.itemId, material.amount), false);
  }
  if (can) inventory.add(new core.Item(FarmingData.itemId(can)), false);
  return { player, inventory, sent };
}

const xp = (player, skill) => player.getSkillManager().getExperience(skill);

test("only furniture made from a bagged plant is a garden plant", () => {
  for (const key of ["PLANT", "FERN", "SMALL_DEAD_TREE", "BIG_MAGIC_TREE", "THORNY_HEDGE", "TALL_BOX_HEDGE",
    "TOPIARY_BUSH", "SUNFLOWER", "ROSEMARY", "ZEN_THEME", "GRASSLAND_HABITAT"]) {
    assert.equal(GardenPlants.isGardenPlant(Data.BUILDABLE_BY_KEY.get(key)), true, key);
  }
  for (const key of ["CRUDE_WOODEN_CHAIR", "OAK_LARDER", "SPIRIT_TREE"]) {
    assert.equal(GardenPlants.isGardenPlant(Data.BUILDABLE_BY_KEY.get(key)), false, key);
  }
});

test("a plant needs a watering can with water", () => {
  const plant = Data.BUILDABLE_BY_KEY.get("PLANT");
  for (const can of [null, "Watering can"]) {
    const { player } = builder(can);
    assert.equal(House.getBuildMaterials(player, null, undefined, plant), GardenPlants.NO_WATER, String(can));
  }
  const { player } = builder("Watering can(1)");
  assert.ok(House.getBuildMaterials(player, null, undefined, plant) instanceof Map);
});

test("planting waters it in: one charge, the watering animation and Farming experience", () => {
  const plant = Data.BUILDABLE_BY_KEY.get("PLANT");
  const { player, inventory, sent } = builder("Watering can(8)");
  const farming = xp(player, core.Skill.FARMING);
  assert.equal(GardenPlants.animate(player, plant), true);
  GardenPlants.complete(player, plant);
  assert.deepEqual(sent.animations, [core.CacheDefinitions.getSeqId("farming_watering")]);
  assert.deepEqual(sent.graphics, [core.CacheDefinitions.getSpotanimId("farming_wateringcan_water_spotanim")]);
  assert.equal(inventory.getAmount(FarmingData.itemId("Watering can(7)")), 1);
  assert.equal(inventory.getAmount(FarmingData.itemId("Watering can(8)")), 0);
  assert.equal(xp(player, core.Skill.FARMING) - farming, plant.experience);
  assert.deepEqual(sent.messages, []);
});

test("a menagerie habitat takes the water but gives no Farming experience (Wiki)", () => {
  const habitat = Data.BUILDABLE_BY_KEY.get("GRASSLAND_HABITAT");
  const { player, inventory } = builder("Watering can(8)");
  const farming = xp(player, core.Skill.FARMING);
  GardenPlants.complete(player, habitat);
  assert.equal(inventory.getAmount(FarmingData.itemId("Watering can(7)")), 1);
  assert.equal(xp(player, core.Skill.FARMING), farming);
});

test("Gricoller's can waters plants until it runs dry", () => {
  const plant = Data.BUILDABLE_BY_KEY.get("PLANT");
  const { player, inventory } = builder("Gricoller's can");
  const can = inventory.getItems().find(item => item?.getId() === FarmingData.itemId("Gricoller's can"));
  assert.equal(House.getBuildMaterials(player, null, undefined, plant), GardenPlants.NO_WATER);
  can.setMetaValue("farming:water", 1);
  assert.ok(House.getBuildMaterials(player, null, undefined, plant) instanceof Map);
  GardenPlants.complete(player, plant);
  assert.equal(Number(can.getMetaValue("farming:water")), 0);
});

test("other furniture keeps the hammer and gives no Farming experience", () => {
  const chair = Data.BUILDABLE_BY_KEY.get("CRUDE_WOODEN_CHAIR");
  const { player, inventory, sent } = builder("Watering can(8)");
  const farming = xp(player, core.Skill.FARMING);
  assert.equal(GardenPlants.animate(player, chair), false);
  GardenPlants.complete(player, chair);
  assert.deepEqual(sent.animations, []);
  assert.equal(inventory.getAmount(FarmingData.itemId("Watering can(8)")), 1);
  assert.equal(xp(player, core.Skill.FARMING), farming);
});
