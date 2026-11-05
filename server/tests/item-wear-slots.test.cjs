// Run after `yarn build`: node --test tests/item-wear-slots.test.cjs
// The equipment slot comes from the cache wearPos, not item-gameplay.json's legacy equipmentType.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { EquipmentType } = require("../dist/game/model/EquipmentType");
const gameplay = require("../data/definitions/item-gameplay.json");

const EQUIPMENT_SLOTS = new Set([0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13]);

const obj = (name) => CacheDefinitions.getObjId(name);

before(() => {
  CachePipeline.initialize(require("node:path").resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

test("the cache decides wearability: legacy helmet flags on unwearable items are gone", () => {
  for (const gameval of ["pack_feather", "dorgesh_powerstation_cog", "dorgesh_cave_eel_sushi"]) {
    assert.equal(ItemDefinition.forId(obj(gameval)).getEquipmentType().getSlot(), -1, gameval);
  }
  assert.equal(ItemDefinition.forId(obj("iron_full_helm")).getEquipmentType().getSlot(), 0);
  assert.equal(ItemDefinition.forId(obj("rune_arrow")).getEquipmentType().getSlot(), 13);
  assert.equal(ItemDefinition.forId(obj("barrows_torag_weapon_75")).getEquipmentType().getSlot(), 3, "not the legacy helmet slot");
});

test("clue hunter boots resolve to the feet slot", () => {
  const definition = ItemDefinition.forId(obj("clue_hunter_boots"));
  assert.equal(definition.getName(), "Clue hunter boots");
  assert.equal(definition.getEquipmentType().getSlot(), 10, "feet, not the gloves slot");
  assert.equal(gameplay.find((row) => row.id === definition.getId()).equipmentType, "BOOTS");
});

test("every wearable cache item equips to its own wear position", () => {
  const wrong = [];
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
    const cached = CacheDefinitions.getItem(id);
    if (!cached?.name || cached.name === "null" || cached.noteTemplate >= 0) continue;
    if (!EQUIPMENT_SLOTS.has(cached.wearPos)) continue;
    const slot = ItemDefinition.forId(id).getEquipmentType().getSlot();
    if (slot !== cached.wearPos) wrong.push(`${id} ${cached.name}: ${slot} != ${cached.wearPos}`);
  }
  assert.deepEqual(wrong, []);
});

test("item-gameplay.json's legacy equipmentType never claims a different slot", () => {
  const wrong = [];
  for (const row of gameplay) {
    const definition = ItemDefinition.forId(row.id);
    if (definition.getName().toLowerCase() !== (row.name || "").trim().toLowerCase()) continue;
    const cacheSlot = definition.getEquipmentType().getSlot();
    if (cacheSlot < 0) continue;
    const legacy = row.equipmentType ?? "NONE";
    if (legacy === "NONE") continue;
    const legacySlot = EquipmentType[legacy]?.getSlot();
    if (legacySlot !== cacheSlot) {
      wrong.push(`${row.id} ${row.name}: ${legacy} (${legacySlot}) != cache ${cacheSlot}`);
    }
  }
  assert.deepEqual(wrong, []);
});
