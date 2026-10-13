// Run after `yarn build`: node --test tests/item-bonuses.test.cjs
// Equipment stats come from the cache's item params (ItemDefinition.bonusesFromParams); the
// item-gameplay.json export only fills items the cache has none for.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });

const bonuses = (id) => ItemDefinition.forId(id).getBonuses();

// [stab, slash, crush, magic, ranged attack, the same five defences, melee strength,
//  ranged strength, magic damage %, prayer]
test("the cache's params map onto the bonus order", () => {
  assert.deepEqual(bonuses(ItemIdentifiers.ABYSSAL_WHIP), [0, 82, 0, 0, 0, 0, 0, 0, 0, 0, 82, 0, 0, 0]);
  assert.deepEqual(bonuses(ItemIdentifiers.HOLY_SYMBOL), [0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 0, 0, 0, 8]);
  assert.deepEqual(bonuses(ItemIdentifiers.AVAS_ASSEMBLER), [0, 0, 0, 0, 8, 1, 1, 1, 8, 2, 0, 2, 0, 0], "ranged strength from param 189");
  assert.equal(bonuses(ItemIdentifiers.RUNE_ARROW)[11], 49, "ammunition's ranged strength from param 12");
  assert.equal(bonuses(ItemIdentifiers.KODAI_WAND)[12], 15, "magic damage in percent");
});

test("current stats, not the 2021 export's", () => {
  assert.equal(bonuses(ItemIdentifiers.OCCULT_NECKLACE)[12], 5);
  assert.deepEqual(bonuses(ItemIdentifiers.OSMUMTENS_FANG).slice(0, 2), [105, 75]);
  assert.deepEqual(bonuses(ItemIdentifiers.BLACK_DHIDE_BODY).slice(5, 10), [30, 38, 45, 45, 50]);
  assert.equal(bonuses(ItemIdentifiers.TWISTED_BOW)[13], 0, "no prayer bonus");
  assert.equal(bonuses(ItemIdentifiers.IRON_DART)[4], 0, "darts have no ranged attack");
});

test("gear the export had no stats for has them", () => {
  assert.equal(bonuses(ItemIdentifiers.ULTOR_RING)[10], 12);
  assert.equal(bonuses(ItemIdentifiers.VENATOR_BOW)[4], 90);
  assert.ok(bonuses(ItemIdentifiers.MASORI_BODY_F_)[4] > 0);
  assert.ok(bonuses(ItemIdentifiers.VIRTUS_ROBE_TOP)[3] > 0);
});

test("Barrows: degraded pieces keep their stats, broken ones have none", () => {
  const hood = bonuses(ItemIdentifiers.AHRIMS_HOOD);
  assert.equal(hood[12], 1, "Ahrim's armour: 1% magic damage");
  assert.deepEqual(bonuses(4856), hood, "Ahrim's hood 100");
  assert.deepEqual(bonuses(4859), hood, "Ahrim's hood 25");
  assert.deepEqual(bonuses(4860), new Array(14).fill(0), "Ahrim's hood 0");
});

test("every wearable item with cache stats uses them", () => {
  const count = CacheDefinitions.getCounts().items;
  const wrong = [];
  for (let id = 0; id < count; id++) {
    const type = CacheDefinitions.getItem(id);
    if (!type || type.wearPos < 0 || type.noteTemplate !== -1) continue;
    const expected = ItemDefinition.bonusesFromParams(type.params);
    if (!expected) continue;
    if (expected.some((value, index) => bonuses(id)[index] !== value)) wrong.push(`${id} ${type.name}`);
  }
  // The broken Barrows pieces are the only ones set apart (they have no stat params anyway).
  assert.deepEqual(wrong, []);
});
