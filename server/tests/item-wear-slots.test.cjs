// Run after `yarn build`: node --test tests/item-wear-slots.test.cjs
// The equipment slot comes from the cache wearPos, not item-gameplay.json's legacy equipmentType.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");

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
