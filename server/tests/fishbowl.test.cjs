// From server/: node --test tests/fishbowl.test.cjs (after yarn build).
// Fishbowls (Wiki Fishbowl): seaweed on a fishbowl of water, and Empty on a bowl of water or seaweed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const hooks = { actions: {}, onItem: [] };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/Fishbowl.plugin').register({
    core,
    onItemAction: (name, actions) => { hooks.actions[name] = actions; },
    onItemOnItem: (a, b, handler) => hooks.onItem.push({ a, b, handler }),
  });
});

function player(t) {
  const p = new Player(null);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), 'refreshItems', function () { return this; });
  return p;
}

function useOn(p, usedSlot, withSlot) {
  const items = p.getInventory().getItems();
  const event = {
    player: p, usedItem: items[usedSlot], usedItemId: items[usedSlot].getId(), usedItemSlot: usedSlot,
    usedWithItem: items[withSlot], usedWithItemId: items[withSlot].getId(), usedWithItemSlot: withSlot,
  };
  return hooks.onItem[0].handler(event);
}

function empty(p, slot) {
  const item = p.getInventory().getItems()[slot];
  return hooks.actions.Fishbowl.Empty({ player: p, item, itemId: item.getId(), slot });
}

test('seaweed on a fishbowl of water, either way round, makes the seaweed bowl and uses one seaweed', (t) => {
  for (const [bowlSlot, weedSlot] of [[0, 1], [1, 0]]) {
    const p = player(t);
    const inv = p.getInventory();
    inv.setItem(bowlSlot, new Item(I.FISHBOWL, 1));
    inv.setItem(weedSlot, new Item(I.SEAWEED, 1));
    assert.notEqual(useOn(p, weedSlot, bowlSlot), false);
    assert.equal(inv.getItems()[bowlSlot].getId(), I.FISHBOWL_2);
    assert.equal(inv.getAmount(I.SEAWEED), 0);
  }
});

test('with a full inventory and several seaweed, one is used', (t) => {
  const p = player(t);
  const inv = p.getInventory();
  for (let i = 0; i < 28; i++) inv.setItem(i, new Item(I.COINS, 1 + i));
  inv.setItem(3, new Item(I.FISHBOWL, 1));
  inv.setItem(4, new Item(I.SEAWEED, 1));
  inv.setItem(5, new Item(I.SEAWEED, 1));
  useOn(p, 4, 3);
  assert.equal(inv.getItems()[3].getId(), I.FISHBOWL_2);
  assert.equal(inv.getAmount(I.SEAWEED), 1);
});

test('seaweed does not go into a bowl that already has some or is empty', (t) => {
  for (const bowl of [I.FISHBOWL_2, I.EMPTY_FISHBOWL]) {
    const p = player(t);
    const inv = p.getInventory();
    inv.setItem(0, new Item(bowl, 1));
    inv.setItem(1, new Item(I.SEAWEED, 1));
    assert.equal(useOn(p, 1, 0), false);
    assert.equal(inv.getItems()[0].getId(), bowl);
    assert.equal(inv.getAmount(I.SEAWEED), 1);
  }
});

test('Empty turns a bowl of water, or of water and seaweed, into the empty bowl; other bowls are left', (t) => {
  for (const bowl of [I.FISHBOWL, I.FISHBOWL_2]) {
    const p = player(t);
    p.getInventory().setItem(5, new Item(bowl, 1));
    assert.notEqual(empty(p, 5), false);
    assert.equal(p.getInventory().getItems()[5].getId(), I.EMPTY_FISHBOWL);
  }
  const p = player(t);
  p.getInventory().setItem(0, new Item(I.FISHBOWL_3, 1));
  assert.equal(empty(p, 0), false);
  assert.equal(p.getInventory().getItems()[0].getId(), I.FISHBOWL_3);
});
