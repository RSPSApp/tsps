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

test('the slayer equipment shop binds the masters on Trade; Rewards is an interface', () => {
  const equipment = shops.find((shop) => shop.name === 'Slayer Equipment (shop)');
  assert.ok(equipment, 'the slayer equipment shop exists in shops.json');
  assert.equal(equipment.currency, 'COINS');
  const binding = equipment.npcInteractions.find((entry) => entry.optionSlot === 4);
  assert.ok(binding?.npcIds.includes(7663), 'the shop is bound to Krystilia on slot 4');
  // The Rewards option opens the slayer_rewards interface (Slayer.plugin.js), not a shop.
  assert.equal(shops.some((shop) => shop.name === 'Slayer Rewards'), false);
});
