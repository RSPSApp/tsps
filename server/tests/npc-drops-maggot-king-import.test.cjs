// Run after `yarn build`: node --test tests/npc-drops-maggot-king-import.test.cjs
// Data-level checks of the imported Maggot King tables. Maggot King's automatic encounter loot is suppressed on
// purpose (the corpse choice is deferred, see Instance.MaggotKing.claimBossDrops), and NPC 15742 maps only to the
// take-eggs table, so this import is inert at runtime there: these tests pin the imported data, not behaviour.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const dump = require("../data/definitions/npc-drops.json");

const EGGS = [[33665, 300], [33667, 150], [33669, 33], [33671, 6], [33673, 3], [33675, 1]];

test("take-eggs keeps the six exact egg rates out of 1500", () => {
  const table = dump.tables.maggot_king;
  assert.equal(table.main_max_roll, 1500);
  const eggs = table.entries.filter((row) => row.name?.startsWith("Maggot egg"));
  assert.deepEqual(eggs.map((row) => [row.item_id, row.weight]), EGGS);
  assert.ok(eggs.every((row) => row.out_of === 1500 && !row.assumed_rarity));
  assert.equal(EGGS.reduce((sum, [, weight]) => sum + weight, 0), 493);
});

test("take-eggs' Nothing and supply rows are flagged placeholders, not source rates", () => {
  const table = dump.tables.maggot_king;
  const supply = table.entries.find((row) => row.item_id === 33628);
  // The Wiki labels them only Common and Uncommon; the 1007/1500 split among Nothing and the supply pair is unpublished.
  assert.equal(supply.assumed_rarity, true);
  assert.deepEqual(supply.bonus_drops.map((row) => row.item_id), [33627]);
  assert.equal(table.entries.find((row) => row.nothing).separate_roll, true);
});

test("open-stomach bundles the supplies as one 41/159 slot, and no NPC maps to it", () => {
  const table = dump.tables.maggot_king_2;
  assert.equal(table.main_max_roll, 159);
  const supply = table.entries.find((row) => row.item_id === 33628);
  assert.deepEqual([supply.weight, supply.out_of], [41, 159]);
  assert.deepEqual(supply.bonus_drops.map((row) => row.item_id), [33627]);
  assert.ok(!table.entries.some((row) => row.item_id === 33627), "the medal is the bundle's bonus, not a second slot");
  const pool = table.entries.filter((row) => row.out_of === 159).reduce((sum, row) => sum + row.weight, 0);
  assert.equal(pool, 159);
  assert.deepEqual(dump.npcs[15742].tables, ["maggot_king"]);
  assert.ok(!Object.values(dump.npcs).some((npc) => npc.tables.includes("maggot_king_2")));
});
