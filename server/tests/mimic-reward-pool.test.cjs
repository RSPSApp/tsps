const assert = require("node:assert/strict");
const { test } = require("node:test");
const tables = require("../plugins/bosses/data/reward-tables.json").tables;

// Expectations below are the Wiki's explicit quantity lists, not a scaling formula.
for (const [tier, death, blood, ranarr, manta] of [
  ["elite", [600, 480, 360, 240, 120], [500, 400, 300, 200, 100], [25, 20, 15, 10, 5], [15, 12, 9, 6, 3]],
  ["master", [600, 500, 400, 300, 200, 100], [500, 416, 333, 250, 166, 83], [25, 20, 16, 12, 8, 4], [15, 12, 10, 7, 5, 2]],
]) {
  for (let attempt = 0; attempt < death.length; attempt++) {
    test(`${tier} attempt ${attempt + 1}: one bonus, exact source quantities and noted supplies`, () => {
      const Pool = require("../plugins/bosses/mimic/Pool.Mimic");
      // Every consumable occupies almost one fifth of the unconditional pool.
      for (const [random, itemId, amount, noted] of [
        [0.1, 560, death[attempt], false], [0.3, 565, blood[attempt], false],
        [0.5, 207, ranarr[attempt], true], [0.7, 245, ranarr[attempt], true],
        [0.9, 389, manta[attempt], true],
      ]) {
        const drops = Pool.roll(tables, tier, death.length - attempt, { random: () => random });
        assert.deepEqual(drops, [
          { itemId: 8782, amount: 1, noted: false },
          { itemId, amount, noted },
        ]);
      }
    });
  }
}

test("first and later attempt probabilities select the ring at the published boundary", () => {
  const Pool = require("../plugins/bosses/mimic/Pool.Mimic");
  for (const [tier, rolls, rate] of [["elite", 5, 6 / 250], ["elite", 4, 6 / 264], ["master", 6, 6 / 228], ["master", 5, 6 / 240]]) {
    assert.equal(Pool.roll(tables, tier, rolls, { random: () => rate - 1e-10 })[1].itemId, 23185);
    assert.equal(Pool.roll(tables, tier, rolls, { random: () => rate + 1e-10 })[1].itemId, 10350);
  }
});

test("scroll case is included only on explicit eligible request", () => {
  const Pool = require("../plugins/bosses/mimic/Pool.Mimic");
  const drops = Pool.roll(tables, "master", 6, { random: () => 0, includeScrollCase: true });
  assert.deepEqual(drops, [
    { itemId: 8782, amount: 1, noted: false },
    { itemId: 23185, amount: 1, noted: false },
    { itemId: 30926, amount: 1, noted: false },
  ]);
});

test("invalid tier or spent attempt cannot produce rewards", () => {
  const Pool = require("../plugins/bosses/mimic/Pool.Mimic");
  for (const [tier, rolls] of [["easy", 5], ["elite", 0], ["elite", 6], ["master", 7], ["master", 1.5]]) {
    assert.throws(() => Pool.roll(tables, tier, rolls), /tier|attempt/i);
  }
});

test("incomplete or ambiguous source data fails rather than inventing a reward", () => {
  const Pool = require("../plugins/bosses/mimic/Pool.Mimic");
  for (const mutate of [
    table => { table.entries[1].rarity_raw = "Rare"; },
    table => { table.entries[1].rarity_raw = "1/2"; },
    table => { table.entries[1].item_id = null; },
    table => { table.entries.find(row => row.item_id === 560).quantity_options.pop(); },
    table => { const row = table.entries.find(row => row.item_id === 560); delete row.quantity_options; },
  ]) {
    const candidate = structuredClone(tables);
    mutate(candidate.the_mimic_elite);
    assert.throws(() => Pool.roll(candidate, "elite", 5, { random: () => 0.1 }), /reward|quantity|probabilit/i);
  }
});
