// Run after `yarn build`: node --test tests/shop-currencies.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { ShopManager } = require('../dist/game/model/container/shop/ShopManager');
const plugin = require('../plugins/npcs/Shopkeepers.plugin');

// The name lookup normally comes from the item cache; stub it so the test does
// not need a full cache load.
const NAMES = {
  [ItemIdentifiers.TRADING_STICKS]: 'Trading sticks',
  [ItemIdentifiers.AGILITY_ARENA_TICKET]: 'Agility arena ticket',
  [ItemIdentifiers.ARCHAIC_EMBLEM_TIER_1_]: 'Archaic emblem (tier 1)',
  [ItemIdentifiers.ECTO_TOKEN]: 'Ecto-token',
};
ItemDefinition.forId = (id) => (NAMES[id] ? { getName: () => NAMES[id] } : undefined);

function loadPlugin() {
  const persisted = new Set();
  plugin.register({
    registerShopCurrency: (key, handler) => ShopManager.registerCurrency(key, handler),
    registerItemShopCurrency: (itemId, options) => ShopManager.registerItemCurrency(itemId, options),
    persistAttribute: (key) => persisted.add(key),
    registerNpcInteraction: () => {},
  });
  return { persisted, handlers: ShopManager.currencyHandlers };
}

test('item currencies key on the item name and any aliases', () => {
  const { handlers } = loadPlugin();
  const trading = handlers.get('TRADING STICKS');
  assert.equal(trading.name, 'Trading sticks');
  assert.equal(handlers.get('AGILITY ARENA TICKET (DISCONTINUED)'), handlers.get('AGILITY ARENA TICKET'));
  assert.equal(handlers.get('ARCHAIC EMBLEM'), handlers.get('ARCHAIC EMBLEM (TIER 1)'));
  assert.equal(handlers.get('ECTO-TOKENS'), handlers.get('ECTO-TOKEN'));
  for (const key of handlers.keys()) {
    assert.equal(key, key.trim().toUpperCase(), `key not loader-normalized: ${key}`);
  }
});

test('item currencies move items in and out of the inventory', () => {
  const { handlers } = loadPlugin();
  const trading = handlers.get('TRADING STICKS');

  const amounts = new Map();
  const player = {
    getInventory: () => ({
      getAmount: (id) => amounts.get(id) ?? 0,
      adds: (id, n) => amounts.set(id, (amounts.get(id) ?? 0) + n),
      deleteNumber: (id, n) => amounts.set(id, Math.max(0, (amounts.get(id) ?? 0) - n)),
    }),
  };

  trading.add(player, 100);
  assert.equal(trading.amount(player), 100);
  trading.remove(player, 30);
  assert.equal(trading.amount(player), 70);
  trading.remove(player, 999);
  assert.equal(trading.amount(player), 0);
});

test('point currencies persist on a player attribute', () => {
  const { handlers, persisted } = loadPlugin();
  const nmz = handlers.get('NMZ');
  assert.ok(nmz, 'NMZ currency registered');
  assert.ok(persisted.has('shopCurrency:NMZ'), 'NMZ attribute persisted');

  const attributes = new Map();
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };

  nmz.add(player, 500);
  assert.equal(nmz.amount(player), 500);
  nmz.remove(player, 200);
  assert.equal(nmz.amount(player), 300);
  nmz.remove(player, 999);
  assert.equal(nmz.amount(player), 0);
});
