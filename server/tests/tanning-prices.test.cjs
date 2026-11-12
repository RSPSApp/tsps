// Tanners' per-hide prices in plugins/npcs/data/tanning.json, against the Wiki's shop tables.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const data = require("../plugins/npcs/data/tanning.json");

/** Each price lines up with data.hides by index. */
function priceOf(tanner, raw, product) {
  const index = data.hides.findIndex((hide) => hide.raw === raw && hide.product === product);
  assert.ok(index >= 0, `hide ${raw} -> ${product}`);
  return data.prices[tanner][index];
}

// Wiki (Sbott): snake hide (Tai Bwo Wannai) 25 coins, snake hide (swamp, Temple Trekking) 45, dragonhides 45.
test("Sbott charges 25 for the village snake hide and 45 for the swamp snake hide", () => {
  assert.equal(data.prices.Sbott.length, data.hides.length);
  assert.equal(priceOf("Sbott", 1739, 1741), 2);
  assert.equal(priceOf("Sbott", 1739, 1743), 5);
  assert.equal(priceOf("Sbott", 6287, 6289), 25, "village_snake_hide");
  assert.equal(priceOf("Sbott", 7801, 6289), 45, "templetrek_swamp_snake_hide");
  for (const raw of [1753, 1751, 1749, 1747]) assert.equal(priceOf("Sbott", raw, data.hides.find((h) => h.raw === raw).product), 45);
});
