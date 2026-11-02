// Run after `yarn build`: node --test tests/mastering-mixology.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Shared = require('../plugins/minigames/mixology/Shared.Mixology');
const Orders = require('../plugins/minigames/mixology/Orders.Mixology');
const Stations = require('../plugins/minigames/mixology/Stations.Mixology');
const Mixer = require('../plugins/minigames/mixology/Mixer.Mixology');

before(() => {
  CachePipeline.initialize();
  Shared.bind({ core: PluginManager.getCoreApi(), emitCustomEvent() {} });
});

/** A player with a Herblore level, an inventory of items and the lab varbits. */
function fakePlayer({ level = 81, items = [], vars = {} } = {}) {
  const attributes = { [Shared.STATE_ATTRIBUTE]: { vars: { ...vars } } };
  const slots = items.map((item) => item ?? null);
  return {
    getAttribute: (key) => attributes[key],
    setAttribute: (key, value) => { attributes[key] = value; },
    getSkillManager: () => ({ getCurrentLevel: () => level, getMaxLevel: () => level }),
    getInventory: () => ({ getItems: () => slots }),
    getPacketSender: () => ({ getVarbit: () => 0, sendVarbit() {} }),
  };
}

function finished(index, modifier, digweed = false) {
  const { Item } = PluginManager.getCoreApi();
  const meta = { [Shared.META.MODIFIER]: modifier };
  if (digweed) meta[Shared.META.DIGWEED] = true;
  return new Item(Shared.potion(index).finished, 1, meta);
}

test('potions come from enum 5542 and their levels from enum 5548', () => {
  assert.equal(Shared.potions().size, 10);
  assert.equal(Shared.potion(1).unfinished, 30011); // mm_potion_mmm_unfinished
  assert.equal(Shared.potion(1).finished, 30021);
  assert.equal(Shared.potion(5).unfinished, 30016); // aam: the index runs aam before aal
  assert.equal(Shared.potion(6).unfinished, 30015);
  assert.equal(Shared.potion(9).name, 'Anti-leech lotion'); // lla
  assert.equal(Shared.potion(9).level, 78);
  assert.equal(Shared.potion(10).level, 81);
});

test('three lever pulls always name a potion', () => {
  assert.equal(Shared.potionFor(Mixer.counts([1, 2, 3])).name, 'Mixalot');
  assert.equal(Shared.potionFor(Mixer.counts([2, 2, 2])).name, 'Alco-augmentator'); // capture: vessel_ready 4
  assert.equal(Shared.potionFor(Mixer.counts([3, 2, 1])).index, 10); // capture: lye after aga, mox -> 10
  assert.equal(Shared.potionFor(Mixer.counts([3, 3, 2])).name, 'Anti-leech lotion');
});

test('a station needs 45 - floor(Herblore / 3) progress', () => {
  // rsprox captures: 21 at 72-74, 20 at 75-77, 19 at 78-80, 12 at 99-100, 11 at 102-103, 8 at 111.
  for (const [level, total] of [[72, 21], [75, 20], [78, 19], [81, 18], [99, 12], [102, 11], [111, 8]]) {
    assert.equal(Stations.total(fakePlayer({ level })), total, `level ${level}`);
  }
});

test('ordered potions pay the Wiki resin and XP; unordered a third and 10 of the best resin', () => {
  const mixalot = Shared.potion(10);
  assert.deepEqual(Orders.rewardOf({ entry: mixalot, ordered: true, digweed: false }), { resin: { mox: 20, aga: 20, lye: 20 }, xp: 365 });
  assert.deepEqual(Orders.rewardOf({ entry: mixalot, ordered: true, digweed: true }), { resin: { mox: 40, aga: 40, lye: 40 }, xp: 730 });
  const mmm = Orders.rewardOf({ entry: Shared.potion(1), ordered: false, digweed: false });
  assert.deepEqual(mmm.resin, { mox: 10, aga: 0, lye: 0 }); // capture 4197: 10/0/0
  assert.equal(Math.floor(mmm.xp), 63); // capture 4197: 63 XP
  assert.deepEqual(Orders.rewardOf({ entry: Shared.potion(2), ordered: false, digweed: false }).resin, { mox: 0, aga: 10, lye: 0 });
});

test('each finished potion fills the first open order with its potion and modifier', () => {
  const vars = {
    [Shared.VARBIT.ORDER_TYPE[0]]: 1, [Shared.VARBIT.ORDER_MODIFIER[0]]: Shared.MODIFIER.ALEMBIC,
    [Shared.VARBIT.ORDER_TYPE[1]]: 4, [Shared.VARBIT.ORDER_MODIFIER[1]]: Shared.MODIFIER.RETORT,
    [Shared.VARBIT.ORDER_TYPE[2]]: 1, [Shared.VARBIT.ORDER_MODIFIER[2]]: Shared.MODIFIER.AGITATOR,
  };
  const player = fakePlayer({
    vars,
    items: [finished(1, Shared.MODIFIER.AGITATOR), finished(4, Shared.MODIFIER.ALEMBIC), finished(1, Shared.MODIFIER.ALEMBIC)],
  });
  const chosen = Orders.choose(player);
  assert.deepEqual(chosen.map((deposit) => deposit.slot), [0, 2]);
  assert.ok(chosen.every((deposit) => deposit.ordered));

  const wrong = fakePlayer({ vars, items: [null, finished(7, Shared.MODIFIER.RETORT), finished(4, Shared.MODIFIER.ALEMBIC)] });
  const unordered = Orders.choose(wrong);
  assert.equal(unordered.length, 1);
  assert.equal(unordered[0].slot, 1);
  assert.equal(unordered[0].ordered, false);
});

test('the resin text over the belt matches the capture', () => {
  assert.equal(Orders.chatterText({ mox: 10, aga: 0, lye: 0 }), '<col=389cff>+10 Mox</col>');
  assert.equal(Orders.chatterText({ mox: 0, aga: 672, lye: 224 }), '   <col=11ff00>+672 Aga</col>   <col=ff242f>+224 Lye</col>');
  assert.equal(Orders.chatterText({ mox: 448, aga: 0, lye: 560 }), '<col=389cff>+448 Mox</col>   <col=ff242f>+560 Lye</col>');
});

/** Exercise the shared reward shop with actual cache rows and a native inventory. */
function omnishopHarness(shop = 'forestry_shop') {
  const core = PluginManager.getCoreApi();
  const events = new Map(), buttons = new Map();
  const api = {
    core,
    onCustomEvent(name, fn) { const list = events.get(name) ?? []; list.push(fn); events.set(name, list); },
    emitCustomEvent(name, event) { for (const fn of events.get(name) ?? []) fn(event); },
    onInterfaceActionButton(ids, fn) { for (const id of [ids].flat()) buttons.set(id, fn); },
  };
  require('../plugins/interface/Omnishop.plugin').register(api);
  const messages = [], scripts = [], attributes = new Map(), varps = new Map();
  let interfaceId = -1;
  const sender = new Proxy({}, { get: (_, key) => (...args) => {
    if (key === 'getVarp') return varps.get(args[0]) ?? 0;
    if (key === 'sendConfig') varps.set(args[0], args[1]);
    if (key === 'sendInterfaceScript') scripts.push(args);
    return sender;
  } });
  const player = {
    getUsername: () => 'Omnishop tester', getInterfaceId: () => interfaceId,
    setInterfaceId: (id) => { interfaceId = id; }, getPacketSender: () => sender,
    getAttribute: (key) => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
    getEquipment: () => ({ contains: () => false }), getBanks: () => [],
    sendMessage: (text) => messages.push(text),
  };
  const inventory = new core.Inventory(player);
  player.getInventory = () => inventory;
  const shopRow = core.CacheDefinitions.getDbRow(core.CacheDefinitions.getDbRowId(shop));
  const stock = shopRow.column(core.CacheDefinitions.getDbColumn(shopRow.tableId, 'omnishop_shop_stock'));
  const click = (name, fields) => {
    const buttonId = core.CacheDefinitions.getComponentId(name);
    buttons.get(buttonId)({ player, buttonId, handled: false, ...fields });
  };
  api.emitCustomEvent('omnishop:open', { player, shop, handled: false });
  return {
    inventory, player, messages, scripts, api, core,
    buy(row, op = 2) {
      const index = stock.indexOf(core.CacheDefinitions.getDbRowId(row));
      assert.ok(index >= 0, row);
      click('omnishop_main:list', { slot: index * 12, action: op });
    },
    sell(id) { click('omnishop_side:items', { slot: inventory.getSlotForItemId(id), action: 2 }); },
    selectSide(id) { click('omnishop_side:items', { slot: inventory.getSlotForItemId(id), action: 1 }); },
  };
}

test('native Forestry free kits and ten-voucher bundles use cache transaction amounts', () => {
  const h = omnishopHarness();
  h.buy('forestry_shop_stock_0');
  assert.equal(h.inventory.getAmount(28136), 1, 'the kit is free without coins');
  h.inventory.adds(28134, 750);
  h.buy('forestry_shop_stock_20', 3);
  assert.equal(h.inventory.getAmount(28628), 50, 'Buy-5 buys five ten-voucher bundles');
  assert.equal(h.inventory.getAmount(28134), 0);
});

test('native Forestry stock overrides price eggs at 75000 bark and refund 250', () => {
  for (const [row, itemId] of [['forestry_shop_stock_25', 28663], ['forestry_shop_stock_26', 28626]]) {
    const h = omnishopHarness();
    h.inventory.adds(28134, 74999);
    h.buy(row);
    assert.equal(h.inventory.getAmount(itemId), 0, 'short purchases take nothing');
    assert.equal(h.inventory.getAmount(28134), 74999);
    h.inventory.adds(28134, 1);
    h.buy(row);
    assert.equal(h.inventory.getAmount(itemId), 1);
    assert.equal(h.inventory.getAmount(28134), 0);
    h.sell(itemId);
    assert.equal(h.inventory.getAmount(itemId), 0);
    assert.equal(h.inventory.getAmount(28134), 250, 'stock modifier is clamped to 10% by native cost calculation');
  }
});

test('native Forestry sell-only drops cannot be bought and refund the shop 80% rate', () => {
  for (const [row, itemId, refund] of [
    ['forestry_shop_stock_24', 28624, 5],
    ['forestry_shop_stock_28', 28655, 150],
    ['forestry_shop_stock_29', 28674, 25],
  ]) {
    const h = omnishopHarness();
    h.inventory.adds(28134, 1000);
    h.buy(row);
    assert.equal(h.inventory.getAmount(itemId), 0, 'forged buy op on sell-only stock is ignored');
    assert.equal(h.inventory.getAmount(28134), 1000);
    h.inventory.adds(itemId, 1);
    h.sell(itemId);
    assert.equal(h.inventory.getAmount(itemId), 0);
    assert.equal(h.inventory.getAmount(28134), 1000 + refund);
  }
});

test('shared purchases account for paid inventory slots and refuse overflowing reward stacks', () => {
  const h = omnishopHarness();
  h.inventory.adds(28134, 150);
  while (h.inventory.getFreeSlots()) h.inventory.adds(1351, 1);
  h.buy('forestry_shop_stock_20');
  assert.equal(h.inventory.getAmount(28134), 0, 'spending the entire bark stack makes room');
  assert.equal(h.inventory.getAmount(28628), 10);
  h.inventory.delete(1351, 1);
  h.inventory.adds(28134, 150);
  h.inventory.delete(28628, 10);
  h.inventory.adds(28628, 2147483640);
  h.buy('forestry_shop_stock_20');
  assert.equal(h.inventory.getAmount(28134), 150, 'overflow refuses before payment');
  assert.equal(h.inventory.getAmount(28628), 2147483640);
});

test('shared sales refuse before destroying an item if the refund would overflow', () => {
  const h = omnishopHarness();
  h.inventory.adds(28134, 2147483640);
  h.inventory.adds(28674, 1);
  h.sell(28674);
  assert.equal(h.inventory.getAmount(28674), 1);
  assert.equal(h.inventory.getAmount(28134), 2147483640);
});

test('native Mixology refunds retain the default 40% for each owned currency', () => {
  const h = omnishopHarness('mixology_rewards');
  const balances = new Map();
  h.api.onCustomEvent('omnishop:currency', (event) => {
    event.balance = balances.get(event.currency) ?? 0;
    event.set = (value) => balances.set(event.currency, value);
  });
  h.inventory.adds(29978, 1);
  h.sell(29978);
  assert.equal(h.inventory.getAmount(29978), 0);
  for (const [name, expected] of [
    ['omnishop_currency_mixology_mox', 900],
    ['omnishop_currency_mixology_aga', 1120],
    ['omnishop_currency_mixology_lye', 1480],
  ]) assert.equal(balances.get(h.core.CacheDefinitions.getDbRowId(name)), expected, name);
});

test('mixed saved and item currency previews only inventory items actually spent', () => {
  for (const savedOak of [6, 10]) {
    const h = omnishopHarness('forestry_shop_uim');
    const stored = new Map([
      [h.core.CacheDefinitions.getDbRowId('forestry_shop_currency_log_oak'), savedOak],
      [h.core.CacheDefinitions.getDbRowId('forestry_shop_currency_log_willow'), 5],
    ]);
    h.api.onCustomEvent('omnishop:currency', (event) => {
      if (!stored.has(event.currency)) return;
      const saved = stored.get(event.currency);
      event.balance = saved + h.inventory.getAmount(event.itemId);
      event.inventoryCost = (amount) => Math.max(0, amount - saved);
      event.set = (value) => {
        const spent = event.balance - value;
        const fromStorage = Math.min(saved, spent);
        stored.set(event.currency, saved - fromStorage);
        h.inventory.delete(event.itemId, spent - fromStorage);
      };
    });
    h.inventory.adds(28134, 21);
    h.inventory.adds(1522, 4);
    while (h.inventory.getFreeSlots()) h.inventory.adds(1351, 1);
    h.buy('forestry_shop_stock_1');
    const fits = savedOak === 6;
    assert.equal(h.inventory.getAmount(28159), fits ? 1 : 0);
    assert.equal(h.inventory.getAmount(28134), fits ? 1 : 21);
    assert.equal(h.inventory.getAmount(1522), fits ? 0 : 4);
    assert.equal(stored.get(h.core.CacheDefinitions.getDbRowId('forestry_shop_currency_log_oak')), fits ? 0 : 10);
  }
});

test('owner sale checks update the side panel and reject previously offered sales', () => {
  const h = omnishopHarness('forestry_shop_uim');
  let allowed = true;
  h.api.onCustomEvent('omnishop:can-sell', (event) => {
    assert.equal(event.shop, 'forestry_shop_uim');
    assert.equal(event.stock, 'forestry_shop_stock_27');
    assert.equal(event.itemId, 28613);
    event.cancel = !allowed;
  });
  h.inventory.adds(28613, 1);
  h.selectSide(28613);
  assert.equal(h.scripts.findLast(([id]) => id === 7253)[1][4], 1);
  allowed = false;
  h.sell(28613);
  assert.equal(h.inventory.getAmount(28613), 1, 'changing mode invalidates an earlier sale offer');
  assert.equal(h.inventory.getAmount(28134), 0);
  h.selectSide(28613);
  assert.equal(h.scripts.findLast(([id]) => id === 7253)[1][4], -1, 'the side panel hides Sell');
  allowed = true;
  h.sell(28613);
  assert.equal(h.inventory.getAmount(28613), 0);
  assert.equal(h.inventory.getAmount(28134), 2000);
});
