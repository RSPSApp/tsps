// Run after `yarn build`: node --test tests/shops-data.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const shops = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/definitions/shops.json'), 'utf8')
);

test('shop ids and names are unique', () => {
  const ids = new Set();
  const names = new Set();
  for (const shop of shops) {
    assert.equal(ids.has(shop.id), false, `duplicate shop id ${shop.id}`);
    assert.equal(names.has(shop.name), false, `duplicate shop name ${shop.name}`);
    ids.add(shop.id);
    names.add(shop.name);
  }
  assert.ok(shops.length > 400, 'the imported shop set is present');
});

test("both versions of Ned's rope shop bind his Trade option", () => {
  for (const version of ['Default', 'Fremennik Isles']) {
    const shop = shops.find((entry) => entry.name === `Ned's Handmade Rope (100% Wool) (${version})`);
    assert.ok(shop?.npcInteractions.some(({ npcIds, optionSlot }) => npcIds.includes(4280) && optionSlot === 3), version);
  }
});

test('the slayer equipment shop binds the masters on Trade; Rewards is an interface', () => {
  const equipment = shops.find((shop) => shop.name === 'Slayer Equipment (shop)');
  assert.ok(equipment, 'the slayer equipment shop exists in shops.json');
  assert.equal(equipment.currency, 'COINS');
  const binding = equipment.npcInteractions.find((entry) => entry.optionSlot === 4);
  assert.ok(binding?.npcIds.includes(7663), 'the shop is bound to Krystilia on slot 4');
  // The Rewards option opens the slayer_rewards interface (Slayer.plugin.js), not a shop.
  assert.equal(shops.some((shop) => shop.name === 'Slayer Rewards'), false);
});

test('the loader keeps stock rows listed at 0, so specialist shops buy them', () => {
  const { ShopDefinitionLoader } = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
  const definition = new ShopDefinitionLoader().toDefinition({
    id: 999999, name: 'Zero stock test', currency: 'COINS',
    originalStock: [{ id: 303, amount: 5 }, { id: 317, amount: 0 }, { id: 321, amount: 'x' }, { id: 0, amount: 0 }],
  }, 'core');
  assert.deepEqual(definition.getOriginalStock().map(({ id, amount }) => [id, amount]), [[303, 5], [317, 0]]);
  const gerrant = shops.find((shop) => shop.name === "Gerrant's Fishy Business.");
  assert.ok(gerrant.originalStock.some(({ id, amount }) => id === 317 && amount === 0), 'Gerrant lists raw shrimps at 0');
});

test('Pest Control Exchange stays with its reward interface, not a generic shop', () => {
  // PestControl.plugin.js owns Void Knight Exchange and interface 243. The
  // canonical exporter also describes these rewards, but that must not install
  // a core.shops.open action ahead of the native reward provider.
  const rewardNames = [
    "Void Knights' Reward Options",
    "Void Knights' Reward Options (! colspan)",
    "Void Knights' Reward Options (! rowspan)",
  ];
  assert.equal(shops.some(shop => rewardNames.includes(shop.name)), false);
  const rewardOwners = new Set([1755, 1756, 1757, 1758]);
  assert.equal(shops.some(shop => shop.npcInteractions?.some(binding =>
    binding.optionSlot === 3 && binding.npcIds.some(id => rewardOwners.has(id))
  )), false, 'the four reward NPC Exchange options must not acquire generic bindings');
  for (const [id, name, npcId] of [
    [1365, 'Void Knight Archery Store', 1765],
    [1366, 'Void Knight General Store', 1768],
    [1367, 'Void Knight Magic Store', 1767],
  ]) {
    const shop = shops.find(entry => entry.name === name);
    assert.ok(shop, name);
    assert.equal(shop.id, id, 'ordinary Void stores keep their existing IDs');
    assert.equal(shop.currency, 'COINS');
    assert.ok(shop.npcInteractions.some(binding => binding.optionSlot === 3 && binding.npcIds.includes(npcId)), name);
  }
});

test('the loader reads the host editor fields: name, currency, default stock and restock, per-item prices', () => {
  const { ShopDefinitionLoader } = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
  const definition = new ShopDefinitionLoader().toDefinition({
    id: 999998,
    name: '  Host edited shop  ',
    currency: 'blood money',
    stockAmount: 500,
    defaultRestockTicks: 12,
    prices: { 303: 2500, 317: -1 },
    originalStock: [
      { id: 303 },
      { id: 317, amount: 2, restockTicks: 30 },
      { id: 321, amount: 0 },
    ],
  }, 'core');
  assert.equal(definition.getName(), 'Host edited shop');
  assert.equal(definition.getCurrency(), 'BLOOD_MONEY');
  assert.equal(definition.getDefaultRestockTicks(), 12);
  assert.deepEqual(
    definition.getOriginalStock().map(({ id, amount, restockTicks, price }) => [id, amount, restockTicks, price]),
    [
      [303, 500, null, 2500],
      [317, 2, 30, null],
      [321, 0, null, null],
    ],
    'a missing amount uses stockAmount; an explicit amount and -1 default price win'
  );
});

test('a shop-wide stockAmount of 0 keeps rows that omit their own amount', () => {
  const { ShopDefinitionLoader } = require('../dist/game/definition/loader/impl/ShopDefinitionLoader');
  const definition = new ShopDefinitionLoader().toDefinition({
    id: 999997,
    name: 'Zero default',
    currency: 'COINS',
    stockAmount: 0,
    originalStock: [{ id: 303 }, { id: 317, amount: 2 }, { id: 321, amount: 'x' }],
  }, 'core');
  assert.deepEqual(
    definition.getOriginalStock().map(({ id, amount }) => [id, amount]),
    [[303, 0], [317, 2]],
    'the inherited zero stays listed, an explicit amount wins and an invalid amount is still dropped'
  );
});
