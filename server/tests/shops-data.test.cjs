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

test('the slayer shops bind the masters on the right click options', () => {
  const equipment = shops.find((shop) => shop.name === 'Slayer Equipment (shop)');
  const rewards = shops.find((shop) => shop.name === 'Slayer Rewards');
  assert.ok(equipment && rewards, 'both slayer shops exist in shops.json');
  assert.equal(equipment.currency, 'COINS');
  assert.equal(rewards.currency, 'SLAYER_POINTS');

  for (const [shop, slot] of [[equipment, 4], [rewards, 5]]) {
    const binding = shop.npcInteractions.find((entry) => entry.optionSlot === slot);
    assert.ok(binding, `${shop.name} has a slot ${slot} binding`);
    assert.ok(binding.npcIds.includes(7663), `${shop.name} is bound to Krystilia`);
  }
});
