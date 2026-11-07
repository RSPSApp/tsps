// Run after `yarn build`: node --test tests/grand-exchange.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { ItemDefinition } = require('../dist/game/definition/ItemDefinition');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { GameConstants } = require('../dist/game/GameConstants');
const { Item } = require('../dist/game/model/Item');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Bank } = require('../dist/game/model/container/impl/Bank');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerStatus } = require('../dist/game/model/PlayerStatus');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { PacketSender } = require('../dist/net/packet/PacketSender');
const { encodeRunClientScript, encodeTriggerOnDialogAbort, encodeWidgetCloseSub } = require('../dist/net/protocol/ClientProtocol');
const plugin = require('../plugins/interface/GrandExchange.plugin');
const {
  price,
  sellPrice,
  changePrice,
  collectionOutputId,
  payout,
  tax,
  taxExempt,
  TAX_CAP,
  fillDelayMs,
  remainingLimit,
  recordLimit,
  setMarketData,
  LIMITS_ATTRIBUTE,
  HISTORY_ATTRIBUTE,
  HISTORY_LIMIT,
  tradeHistory,
  recordHistory,
  LIMIT_WINDOW_MS,
  OFFERS_ATTRIBUTE,
} = plugin._test;

const definitions = new Map();
const market = {};

function define(id, values = {}) {
  const definition = {
    id,
    unNote: () => id,
    isNoted: () => false,
    isTradeable: () => true,
    isStackable: () => true,
    getExamine: () => '',
    getName: () => `Item ${id}`,
    getGrandExchangeValue: () => 1,
    getGrandExchangeSellValue: () => 1,
    getNoteId: () => -1,
    ...values,
  };
  definitions.set(id, definition);
  return definition;
}

ItemDefinition.forId = (id) => definitions.get(id) ?? define(id);

const INVERTED = 1001;
define(INVERTED, { getGrandExchangeValue: () => 67, getGrandExchangeSellValue: () => 18 });
const NO_SELL_QUOTE = 1002;
define(NO_SELL_QUOTE, { getGrandExchangeValue: () => 42, getGrandExchangeSellValue: undefined });
const NOTEABLE = 1003;
const NOTE = 1004;
define(NOTEABLE, { getNoteId: () => NOTE });
define(NOTE, { getNoteId: () => NOTEABLE, isNoted: () => true });
const NO_NOTE = 1005;

test('buy offers pay the high price and sell offers receive the low price', () => {
  assert.equal(price(INVERTED), 67);
  assert.equal(sellPrice(INVERTED), 18);
  assert.ok(price(INVERTED) > sellPrice(INVERTED));
  assert.ok(price(INVERTED) - sellPrice(INVERTED) > 0);
  assert.equal(sellPrice(NO_SELL_QUOTE), 42);
});

test('collection menus collect the item or its note they name', () => {
  // A single noteable item: op 1 Collect-item, op 2 Collect-note.
  assert.equal(collectionOutputId(NOTEABLE, 1, 1), NOTEABLE);
  assert.equal(collectionOutputId(NOTEABLE, 1, 2), NOTE);
  // A noteable stack: op 1 Collect-notes, op 2 Collect-items.
  assert.equal(collectionOutputId(NOTEABLE, 5, 1), NOTE);
  assert.equal(collectionOutputId(NOTEABLE, 5, 2), NOTEABLE);
  // Bank always takes the base item, and Collect-all notes a stack but not a single item (#2537).
  assert.equal(collectionOutputId(NOTEABLE, 1, 3), NOTEABLE);
  assert.equal(collectionOutputId(NOTEABLE, 1, 1, true), NOTEABLE);
  assert.equal(collectionOutputId(NOTEABLE, 2, 1, true), NOTE);
  // Items without a noted form are never converted.
  assert.equal(collectionOutputId(NO_NOTE, 1, 1), NO_NOTE);
  assert.equal(collectionOutputId(NO_NOTE, 1, 2), NO_NOTE);
});

const TAX_EXEMPT = [
  'Old school bond',
  'Games necklace(8)',
  'Ring of dueling(8)',
  'Ardougne teleport',
  'Camelot teleport',
  'Civitas illa fortis teleport',
  'Falador teleport',
  'Kourend castle teleport',
  'Lumbridge teleport',
  'Teleport to house',
  'Varrock teleport',
  'Bass',
  'Bread',
  'Bronze arrow',
  'Bronze dart',
  'Cake',
  'Cooked chicken',
  'Cooked meat',
  'Herring',
  'Iron arrow',
  'Iron dart',
  'Lobster',
  'Mackerel',
  'Meat pie',
  'Mind rune',
  'Pike',
  'Salmon',
  'Shrimps',
  'Steel arrow',
  'Steel dart',
  'Tuna',
  'Chisel',
  'Gardening trowel',
  'Glassblowing pipe',
  'Hammer',
  'Needle',
  'Pestle and mortar',
  'Rake',
  'Saw',
  'Secateurs',
  'Seed dibber',
  'Shears',
  'Spade',
];
const EXEMPT_ITEMS = TAX_EXEMPT.map((name, index) => {
  const id = 4000 + index;
  define(id, { getName: () => name });
  return id;
});
const ENERGY_4 = 4100;
define(ENERGY_4, { getName: () => 'Energy potion(4)' });
const WATERING_CAN_8 = 4101;
define(WATERING_CAN_8, { getName: () => 'Watering can(8)' });
const SUPER_ENERGY_4 = 4102;
define(SUPER_ENERGY_4, { getName: () => 'Super energy potion(4)' });
const CHOCOLATE_CAKE = 4103;
define(CHOCOLATE_CAKE, { getName: () => 'Chocolate cake' });
const TAXED = 4104;
define(TAXED, { getGrandExchangeValue: () => 100, getGrandExchangeSellValue: () => 90 });
const LEGACY_WHIP = 4105;
define(LEGACY_WHIP, {
  getName: () => 'Abyssal whip',
  getGrandExchangeValue: () => 733_639,
  getGrandExchangeSellValue: () => 733_639,
});

test('the sale tax is 2% per item, rounded down and capped at 5M', () => {
  const sale = (price, quantity = 1) => ({ itemId: TAXED, sell: true, price, quantity, total: price * quantity });
  assert.equal(tax(sale(1)), 0);
  assert.equal(tax(sale(49)), 0);
  assert.equal(tax(sale(49, 2)), 0);
  assert.equal(tax(sale(50)), 1);
  assert.equal(tax(sale(50, 2)), 2);
  assert.equal(tax(sale(99)), 1);
  assert.equal(tax(sale(100)), 2);
  assert.equal(tax(sale(149)), 2);
  assert.equal(tax(sale(150)), 3);
  assert.equal(tax(sale(249_999_999)), TAX_CAP - 1);
  assert.equal(tax(sale(250_000_000)), TAX_CAP);
  assert.equal(tax(sale(0x7fffffff)), TAX_CAP);
  assert.equal(tax(sale(0x7fffffff, 2)), 2 * TAX_CAP);
});

test('exempt items, buys and aborted offers do not pay the sale tax', () => {
  for (const itemId of [...EXEMPT_ITEMS, ENERGY_4, WATERING_CAN_8]) {
    assert.equal(taxExempt(itemId), true);
    assert.equal(tax({ itemId, sell: true, price: 10_000, quantity: 2, total: 20_000 }), 0);
  }
  for (const itemId of [TAXED, SUPER_ENERGY_4, CHOCOLATE_CAKE]) {
    assert.equal(taxExempt(itemId), false);
    assert.ok(tax({ itemId, sell: true, price: 10_000, quantity: 2, total: 20_000 }) > 0);
  }
  const offer = { itemId: TAXED, price: 10_000, quantity: 2, total: 20_000 };
  assert.equal(tax({ ...offer, sell: false }), 0);
  assert.equal(tax({ ...offer, sell: true, aborted: true }), 0);
});

test('price controls step by one, five percent and the guide', () => {
  const offer = { itemId: INVERTED, sell: true, price: 100 };
  assert.equal(changePrice(offer, 8), 99);
  assert.equal(changePrice(offer, 9), 101);
  assert.equal(changePrice(offer, 10), 95);
  assert.equal(changePrice(offer, 13), 105);
  assert.equal(changePrice(offer, 11), sellPrice(INVERTED));
  assert.equal(changePrice({ ...offer, sell: false }, 11), price(INVERTED));
  // Offers saved before adjustable prices fall back to the guide.
  assert.equal(changePrice({ itemId: INVERTED, sell: true }, 9), sellPrice(INVERTED) + 1);
});

test('price controls stay within one coin and the maximum', () => {
  assert.equal(changePrice({ itemId: INVERTED, price: 1 }, 8), 1);
  assert.equal(changePrice({ itemId: INVERTED, price: 1 }, 10), 1);
  assert.equal(changePrice({ itemId: INVERTED, price: 0x7ffffffe }, 9), 0x7fffffff);
  assert.equal(changePrice({ itemId: INVERTED, price: 0x7fffffff }, 13), 0x7fffffff);
});

const HIGH_VOLUME = 2001;
define(HIGH_VOLUME);
market[HIGH_VOLUME] = { volume: 20_000_000 };
const SLOW = 2002;
define(SLOW);
market[SLOW] = { volume: 900 };
const PRICED = 2006;
define(PRICED, { getGrandExchangeValue: () => 100, getGrandExchangeSellValue: () => 90 });
const HISTORY_BUY = 2007;
define(HISTORY_BUY, { getGrandExchangeValue: () => 150 });
market[PRICED] = { volume: 1440 };
const ILLIQUID = 2003;
const BROKEN_VOLUME = 2004;
define(BROKEN_VOLUME);
market[BROKEN_VOLUME] = { volume: NaN };
const NEGATIVE_VOLUME = 2005;
define(NEGATIVE_VOLUME);
market[NEGATIVE_VOLUME] = { volume: -10 };
const half = () => 0.5;

test('fill delay follows volume and quantity', () => {
  assert.equal(fillDelayMs({ itemId: HIGH_VOLUME, quantity: 1 }, half), 5_000);
  assert.equal(fillDelayMs({ itemId: SLOW, quantity: 150 }, half), 27 * 60_000);
  assert.equal(fillDelayMs({ itemId: SLOW, quantity: 1_000 }, half), 60 * 60_000);
  const single = fillDelayMs({ itemId: SLOW, quantity: 1 }, half);
  assert.ok(single > 0 && single < 60 * 60_000);

  let previous = 0;
  for (const quantity of [1, 10, 100, 1_000, 100_000]) {
    const delay = fillDelayMs({ itemId: SLOW, quantity }, half);
    assert.ok(delay >= previous, `quantity ${quantity}: ${delay} < ${previous}`);
    previous = delay;
  }
});

test('crossing the guide fills fast, resting away from it waits', () => {
  const atGuide = fillDelayMs({ itemId: PRICED, quantity: 1, price: 100 }, half);
  const over = fillDelayMs({ itemId: PRICED, quantity: 1, price: 110 }, half);
  const under = fillDelayMs({ itemId: PRICED, quantity: 1, price: 90 }, half);
  assert.ok(over <= 5_000, `overpaying took ${over}ms`);
  assert.ok(under > 10 * 60_000 && under < 60 * 60_000, `resting buy took ${under}ms`);
  assert.ok(atGuide > 5_000 && atGuide < 60_000, `guide took ${atGuide}ms`);

  const sellUnder = fillDelayMs({ itemId: PRICED, sell: true, quantity: 1, price: 81 }, half);
  const sellAbove = fillDelayMs({ itemId: PRICED, sell: true, quantity: 1, price: 99 }, half);
  assert.ok(sellUnder <= 5_000, `undercutting sell took ${sellUnder}ms`);
  assert.ok(sellAbove > 10 * 60_000 && sellAbove < 60 * 60_000, `resting sell took ${sellAbove}ms`);
});

test('successful buys and sells wait at most one hour', () => {
  assert.equal(fillDelayMs({ itemId: PRICED, quantity: 1, price: 50 }, () => 0.49), 60 * 60_000);
  assert.equal(fillDelayMs({ itemId: PRICED, sell: true, quantity: 1, price: 180 }, () => 0.49), 60 * 60_000);
});

test('selling the same quantity takes longer at lower market volume', () => {
  const fast = fillDelayMs({ itemId: HIGH_VOLUME, sell: true, quantity: 100 }, half);
  const slow = fillDelayMs({ itemId: SLOW, sell: true, quantity: 100 }, half);
  assert.equal(fast, 5_000);
  assert.ok(slow > fast);
});

test('worse margins increase delays even for high-volume and unquoted items', () => {
  for (const volume of [20_000_000, 0]) {
    market[PRICED].volume = volume;
    for (const sell of [false, true]) {
      const prices = sell ? [90, 91, 92] : [100, 99, 98];
      const delays = prices.map(price => fillDelayMs({ itemId: PRICED, sell, quantity: 1, price }, half));
      assert.ok(delays[1] > delays[0], `${sell}/${volume}: ${delays}`);
      assert.ok(delays[2] > delays[1], `${sell}/${volume}: ${delays}`);
    }
  }
  market[PRICED].volume = 1440;
});

test('worse margins raise the chance of never filling on either side', () => {
  for (const sell of [false, true]) {
    const guide = sell ? 90 : 100;
    const offer = { itemId: PRICED, sell, quantity: 1 };
    const halfway = { ...offer, price: sell ? guide * 2 : guide / 2 };
    assert.ok(Number.isFinite(fillDelayMs(halfway, () => 0.49)));
    assert.equal(fillDelayMs(halfway, half), null);
    assert.equal(fillDelayMs({ ...offer, price: sell ? guide * 4 : guide / 4 }, () => 0.3), null);
    assert.ok(Number.isFinite(fillDelayMs(halfway, () => 0.3)));
    assert.ok(Number.isFinite(fillDelayMs({ ...offer, price: guide }, () => 0.999)));
    assert.ok(Number.isFinite(fillDelayMs({ ...offer, price: sell ? guide / 2 : guide * 2 }, () => 0.999)));
  }
});

test('unknown, zero, broken and negative volume is illiquid', () => {
  for (const itemId of [ILLIQUID, BROKEN_VOLUME, NEGATIVE_VOLUME]) {
    for (const random of [() => 0, half, () => 1]) {
      const delay = fillDelayMs({ itemId, quantity: 100 }, random);
      assert.ok(delay >= 60_000 && delay <= 5 * 60_000, `${itemId}: ${delay}`);
    }
  }
});

const LIMITED = 3001;
define(LIMITED);
market[LIMITED] = { limit: 150 };
const UNLIMITED = 3002;
define(UNLIMITED);
market[UNLIMITED] = { limit: 0 };
const NO_LIMIT_GETTER = 3003;
define(NO_LIMIT_GETTER);

function player() {
  const attributes = new Map();
  return {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
}

test('buy limits reset after four hours', () => {
  const p = player();
  const start = 1_000_000;
  assert.equal(remainingLimit(p, LIMITED, start), 150);
  recordLimit(p, LIMITED, 100, start);
  assert.equal(remainingLimit(p, LIMITED, start), 50);
  recordLimit(p, LIMITED, 60, start + 1_000);
  assert.equal(remainingLimit(p, LIMITED, start + 1_000), 0);
  assert.equal(remainingLimit(p, LIMITED, start + LIMIT_WINDOW_MS - 1), 0);
  assert.equal(remainingLimit(p, LIMITED, start + LIMIT_WINDOW_MS), 150);
  recordLimit(p, LIMITED, 20, start + LIMIT_WINDOW_MS);
  assert.equal(remainingLimit(p, LIMITED, start + LIMIT_WINDOW_MS), 130);
});

test('an unlimited item never runs out', () => {
  const p = player();
  assert.equal(remainingLimit(p, UNLIMITED, 0), Infinity);
  assert.equal(remainingLimit(p, NO_LIMIT_GETTER, 0), Infinity);
  recordLimit(p, UNLIMITED, 1_000_000, 0);
  assert.equal(remainingLimit(p, UNLIMITED, 0), Infinity);
});

function exchange(t, config = {}, realSender = null) {
  const hooks = {};
  const buttons = [];
  const calls = [];
  const messages = [];
  const timers = [];
  const customEvents = new Map();
  const emitEvent = (eventName, payload) => {
    for (const handler of customEvents.get(eventName) ?? []) handler(payload);
  };
  let interfaceId = 465;
  const sender = realSender ?? new Proxy({}, { get: (_, key) => (...args) => {
    calls.push({ name: key, args });
    if (key === 'sendMessage') messages.push(args[0]);
    return sender;
  } });
  const p = {
    ...player(),
    getUsername: () => 'ge-test',
    getInterfaceId: () => interfaceId,
    setInterfaceId: id => { interfaceId = id; },
    busy: () => false,
    getMovementQueue: () => ({ reset() {} }),
    getSkillManager: () => ({ stopSkillable() {} }),
    getPacketSender: () => sender,
    sendMessage: message => messages.push(message),
    setEnteredAmountAction: action => { p.amountAction = action; },
    setEnteredSyntaxAction: action => { p.syntaxAction = action; },
  };
  const inventory = new Inventory(p);
  p.getInventory = () => inventory;
  // An empty bank: a buy the inventory cannot cover looks there next.
  const banks = Array.from({ length: Bank.TOTAL_BANK_TABS }, () => new Bank(p));
  p.getBank = tab => banks[tab];
  t.mock.method(CacheDefinitions, 'hasItem', id => definitions.has(id));
  t.mock.method(CacheDefinitions, 'getItem', id => ({ name: `Item ${id}` }));
  t.mock.method(GameConstants.PLAYER_PERSISTENCE, 'save', () => {});
  t.mock.method(global, 'setTimeout', (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  });
  plugin.register(new Proxy({
    core: { WorldDefinition: { isMembersWorld: () => true } },
    getPluginConfig: (key, defaultValue) => Object.hasOwn(config, key) ? config[key] : defaultValue,
    emitCustomEvent: emitEvent,
    onCustomEvent: (eventName, handler) => {
      const handlers = customEvents.get(eventName) ?? [];
      handlers.push(handler);
      customEvents.set(eventName, handlers);
    },
    onInterfaceActionButton: (ids, handler) => buttons.push({ ids, handler }),
  }, { get: (api, key) => api[key] ?? (handler => { hooks[key] = handler; }) }));

  const click = (child, slot = 0) => {
    const buttonId = (465 << 16) | child;
    const { handler } = buttons.find(({ ids }) => Array.isArray(ids) && ids.includes(buttonId));
    handler({ player: p, buttonId, slot, action: 1 });
  };
  const historyClick = (child, slot = 0) => {
    const buttonId = (383 << 16) | child;
    const { handler } = buttons.find(({ ids }) => Array.isArray(ids) && ids.includes(buttonId));
    handler({ player: p, buttonId, slot, action: 1 });
  };
  const place = (sell, itemId, quantity, price, slot = 0) => {
    click(7 + slot, sell ? 4 : 3);
    if (sell) hooks.onItemFirstAction({ player: p, itemId, slot: inventory.getSlotForItemId(itemId) });
    else p.syntaxAction.execute(String(itemId));
    click(34, 7);
    p.amountAction.execute(quantity);
    if (price !== undefined) {
      click(34, 12);
      p.amountAction.execute(price);
    }
    click(30);
    return p.getAttribute(OFFERS_ATTRIBUTE)[slot];
  };
  return { p, inventory, place, click, historyClick, emitEvent, hooks, buttons, calls, messages, timers };
}

test('maxTradeDelay overrides volume and price caps for newly placed buys and sells', t => {
  const now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(Math, 'random', () => 0.49);
  for (const maxDelay of [5_000, 60_000, 2 * 60 * 60_000, 0x7fffffff]) {
    for (const sell of [false, true]) {
      const { inventory, place, timers } = exchange(t, { 'GrandExchange:maxTradeDelay': maxDelay });
      assert.equal(fillDelayMs({ itemId: SLOW, quantity: 1_000_000 }, half), maxDelay);
      const price = sell ? 180 : 50;
      inventory.add(new Item(sell ? PRICED : 995, sell ? 1 : price), false);
      const offer = place(sell, PRICED, 1, price);
      assert.equal(offer.completesAt, now + maxDelay);
      assert.equal(timers[0].delay, maxDelay);
      assert.equal(fillDelayMs(offer, () => 0.99), null);
    }
  }
});

test('invalid maxTradeDelay values fall back to one hour', t => {
  for (const value of [undefined, null, 0, -1, 4_999, NaN, Infinity, 0x80000000, 'invalid']) {
    exchange(t, { 'GrandExchange:maxTradeDelay': value });
    assert.equal(fillDelayMs({ itemId: PRICED, quantity: 1, price: 50 }, () => 0.49), 60 * 60_000);
  }
});

test('selling above the buy limit succeeds and leaves the buy allowance unchanged', t => {
  const { p, inventory, place } = exchange(t);
  recordLimit(p, LIMITED, 100);
  inventory.add(new Item(LIMITED, 1_000), false);
  assert.equal(place(true, LIMITED, 1_000).quantity, 1_000);
  assert.equal(inventory.getAmount(LIMITED), 0);
  assert.equal(remainingLimit(p, LIMITED), 50);
});

test('selling still succeeds after the buy limit is exhausted', t => {
  const { p, inventory, place } = exchange(t);
  recordLimit(p, LIMITED, 150);
  inventory.add(new Item(LIMITED, 200), false);
  assert.equal(place(true, LIMITED, 200).quantity, 200);
  assert.equal(remainingLimit(p, LIMITED), 0);
});

test('buying enforces and consumes the remaining four-hour allowance', t => {
  const { p, inventory, place, messages } = exchange(t);
  recordLimit(p, LIMITED, 100);
  inventory.add(new Item(995, 1_000), false);
  assert.equal(place(false, LIMITED, 51), undefined);
  assert.equal(inventory.getAmount(995), 1_000);
  assert.match(messages.at(-1), /only buy 150.*50 remaining/);
  assert.equal(place(false, LIMITED, 50).quantity, 50);
  assert.equal(inventory.getAmount(995), 950);
  assert.equal(remainingLimit(p, LIMITED), 0);
});

test('unfillable offers survive saving and relogging, and abort refunds their input', t => {
  t.mock.method(Math, 'random', () => 0.99);
  for (const sell of [false, true]) {
    const { p, inventory, place, click, hooks, timers } = exchange(t);
    const inputId = sell ? PRICED : 995;
    const unitPrice = sell ? 180 : 50;
    const amount = sell ? 1 : unitPrice;
    inventory.add(new Item(inputId, amount), false);
    const offer = place(sell, PRICED, 1, unitPrice);
    assert.equal(offer.finished, false);
    assert.equal(offer.completesAt, null);
    assert.equal(inventory.getAmount(inputId), 0);
    assert.equal(timers.length, 0);
    const saved = JSON.parse(JSON.stringify(p.getAttribute(OFFERS_ATTRIBUTE)));
    p.setAttribute(OFFERS_ATTRIBUTE, saved);
    hooks.onPlayerLogin({ player: p });
    assert.equal(timers.length, 0);
    assert.equal(saved[0].finished, false);
    click(23);
    click(24);
    assert.equal(inventory.getAmount(inputId), amount);
    assert.deepEqual(p.getAttribute(OFFERS_ATTRIBUTE), {});
  }
});

test('offers with saved completion times still finish after relogging', t => {
  const { p, hooks, timers } = exchange(t);
  const offer = { itemId: PRICED, sell: false, slot: 0, quantity: 1, total: 100, completesAt: Date.now() - 1 };
  p.setAttribute(OFFERS_ATTRIBUTE, { 0: offer });
  hooks.onPlayerLogin({ player: p });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 0);
  timers[0].callback();
  assert.equal(offer.finished, true);
});

test('completed trades are recorded once in bounded newest-first history', () => {
  const p = player();
  p.setAttribute(HISTORY_ATTRIBUTE, []);
  const offer = {
    itemId: PRICED,
    sell: true,
    quantity: 3,
    total: 270,
    completedAt: 123_456,
    finished: true,
  };

  assert.equal(recordHistory(p, offer), true);
  assert.deepEqual(tradeHistory(p), [{
    itemId: PRICED,
    sell: true,
    quantity: 3,
    total: 270,
    tax: 3,
    completedAt: 123_456,
  }]);
  assert.equal(recordHistory(p, offer), false);
  assert.equal(recordHistory(p, { ...offer, historyRecorded: false, aborted: true }), false);

  for (let i = 0; i <= HISTORY_LIMIT; i++) {
    recordHistory(p, { ...offer, itemId: PRICED + i, completedAt: 200_000 + i, historyRecorded: false });
  }
  assert.equal(tradeHistory(p).length, HISTORY_LIMIT);
  assert.equal(tradeHistory(p)[0].itemId, PRICED + HISTORY_LIMIT);
});

test('History button opens and populates the captured history interface', t => {
  const { p, calls, click, hooks } = exchange(t);
  p.setAttribute(HISTORY_ATTRIBUTE, [{
    itemId: PRICED,
    sell: true,
    quantity: 3,
    total: 270,
    tax: 3,
    completedAt: Date.now(),
  }]);
  click(3);
  assert.deepEqual(calls.find(({ name }) => name === 'sendSubInterface').args, [(161 << 16) | 16, 383, 0]);
  const scripts = calls.filter(({ name }) => name === 'sendClientScript').map(({ args }) => args);
  assert.deepEqual(scripts.map(([scriptId]) => scriptId), [2524, 1644, 1646]);
  assert.deepEqual(calls.find(({ name, args }) => name === 'sendInterfaceScript' && args[0] === 1645).args,
    [1645, [0, PRICED, 1, 3, 270n, 3n]]);
  assert.deepEqual(calls.find(({ name }) => name === 'sendInterfaceFlagsRange').args, [(383 << 16) | 3, 0, 234, 1026]);

  const callCount = calls.length;
  click(4); // A click on the covered offer screen must not change its state.
  assert.equal(calls.length, callCount);
  assert.equal(hooks.onItemFirstAction({ player: p, itemId: PRICED, slot: 0 }), true);
  assert.equal(calls.length, callCount);
});

test('History Exchange button returns to the offers screen', t => {
  const { p, click, historyClick, calls } = exchange(t);
  click(3);
  historyClick(2);

  assert.equal(p.getInterfaceId(), 465);
  assert.ok(calls.some(({ name }) => name === 'sendInterfaceRemoval'));
  assert.ok(calls.some(({ name, args }) => name === 'sendSubInterface' && args[1] === 465));
});

test('closing the History overlay re-enables the offers panel', t => {
  const { p, inventory, click, emitEvent, hooks, calls } = exchange(t);
  inventory.add(new Item(PRICED, 1), false);
  click(3);
  const callCount = calls.length;

  emitEvent('interface:closed', { player: p, interfaceId: 383 });
  assert.equal(hooks.onItemFirstAction({ player: p, itemId: PRICED, slot: 0 }), true);
  assert.ok(calls.length > callCount);
});

test('History Buy-offer action starts a buy for the selected row', t => {
  const { p, click, historyClick, calls } = exchange(t);
  p.setAttribute(HISTORY_ATTRIBUTE, [
    { itemId: PRICED, sell: true, quantity: 3, total: 270, tax: 3 },
    { itemId: HISTORY_BUY, sell: false, quantity: 1, total: 150, tax: 0 },
  ]);
  click(3);
  historyClick(3, 6); // second row: six dynamic children per entry

  assert.equal(p.getInterfaceId(), 465);
  assert.ok(calls.some(({ name, args }) => name === 'sendConfig' && args[0] === 1151 && args[1] === HISTORY_BUY));
});

test('register persists offers, limits, and history', () => {
  const persisted = new Map();
  const api = new Proxy({}, {
    get: (_, key) => key === 'persistAttribute'
      ? (attribute, value) => persisted.set(attribute, value)
      : () => {},
  });
  plugin.register(api);
  assert.deepEqual([...persisted.keys()], [OFFERS_ATTRIBUTE, LIMITS_ATTRIBUTE, HISTORY_ATTRIBUTE]);
  assert.deepEqual(persisted.get(OFFERS_ATTRIBUTE), {});
  assert.deepEqual(persisted.get(LIMITS_ATTRIBUTE), {});
  assert.deepEqual(persisted.get(HISTORY_ATTRIBUTE), []);
});

setMarketData(market);

test('buys use coins first, then platinum tokens with change in coins', t => {
  const { inventory, place, messages } = exchange(t);
  inventory.add(new Item(995, 10), false);
  inventory.add(new Item(13204, 1), false);
  assert.equal(place(false, PRICED, 1, 1_100), undefined);
  assert.match(messages.at(-1), /enough coins/);
  assert.equal(place(false, PRICED, 1, 500).total, 500);
  assert.equal(inventory.getAmount(995), 510);
  assert.equal(inventory.getAmount(13204), 0);
  inventory.add(new Item(13204, 2), false);
  assert.equal(place(false, PRICED, 1, 400, 1).total, 400);
  assert.equal(inventory.getAmount(995), 110);
  assert.equal(inventory.getAmount(13204), 2);
});

test('a token payment whose change has no free slot is refused and takes nothing', t => {
  const { inventory, place, messages } = exchange(t);
  inventory.add(new Item(13204, 5), false);
  for (let slot = 1; slot < 28; slot++) inventory.add(new Item(5000 + slot, 1), false);
  assert.equal(place(false, PRICED, 1, 500), undefined);
  assert.match(messages.at(-1), /inventory space/);
  assert.equal(inventory.getAmount(13204), 5);
  assert.equal(place(false, PRICED, 1, 1_000).total, 1_000);
  assert.equal(inventory.getAmount(13204), 4);
  assert.equal(inventory.getAmount(995), 0);
});

test('trades above the coin stack pay with tokens and collect as tokens plus coins', t => {
  const { MAX_TRADE, payout } = plugin._test;
  assert.equal(MAX_TRADE, 2_149_631_130_647);
  const sale = (price, quantity) => ({ itemId: PRICED, sell: true, price, quantity, total: price * quantity });
  assert.deepEqual(payout(sale(1_500_000_061, 2)), [{ itemId: 13204, amount: 2_990_000 }, { itemId: 995, amount: 122 }]);
  assert.deepEqual(payout(sale(0x7fffffff, 1001)), [{ itemId: 13204, amount: 2_144_626_130 }, { itemId: 995, amount: 647 }]);
  assert.deepEqual(payout(sale(500, 1)), [{ itemId: 995, amount: 490 }]);
  const { inventory, place } = exchange(t);
  inventory.add(new Item(995, 2_000_000_000), false);
  inventory.add(new Item(13204, 1_500_000), false);
  assert.equal(place(false, UNLIMITED, 1_000, 3_000_000).total, 3_000_000_000);
  assert.equal(inventory.getAmount(995), 0);
  assert.equal(inventory.getAmount(13204), 500_000);
});

test('a completed sale collects its total less the tax', t => {
  t.mock.method(Math, 'random', () => 0.01);
  const { inventory, place, click, timers } = exchange(t);
  inventory.add(new Item(PRICED, 10), false);
  const offer = place(true, PRICED, 10, 1_000);
  assert.equal(offer.total, 10_000);
  assert.equal(inventory.getAmount(PRICED), 0);
  timers[0].callback();
  click(24);
  assert.equal(inventory.getAmount(995), 9_800);
});

test('a saved sale without a price is taxed at its historical unit price', t => {
  const { p, inventory, hooks, click, timers } = exchange(t);
  // A 10-whip sale at 700,000 each, saved before prices were adjustable; the current
  // sell guide is 733,639, so using it would charge 146,720 instead of 140,000.
  const saved = {
    itemId: LEGACY_WHIP,
    sell: true,
    slot: 0,
    quantity: 10,
    total: 7_000_000,
    finished: true,
    completesAt: null,
  };
  assert.equal(tax(saved), 140_000);
  assert.deepEqual(payout(saved), [{ itemId: 995, amount: 6_860_000 }]);
  p.setAttribute(OFFERS_ATTRIBUTE, { 0: saved });
  hooks.onPlayerLogin({ player: p });
  assert.equal(timers.length, 0);
  click(7, 0);
  click(24);
  assert.equal(inventory.getAmount(995), 6_860_000);
});

test('an aborted sale returns the items without tax', t => {
  t.mock.method(Math, 'random', () => 0.99);
  const { inventory, place, click } = exchange(t);
  inventory.add(new Item(PRICED, 10), false);
  place(true, PRICED, 10, 1_000);
  click(23);
  click(24);
  assert.equal(inventory.getAmount(PRICED), 10);
  assert.equal(inventory.getAmount(995), 0);
});

const GE_MODAL = (161 << 16) | 16;

// The GE through the real PacketSender, recording what actually reaches the client.
function promptExchange(t) {
  const frames = [];
  const sender = new PacketSender(null);
  const f = exchange(t, {}, sender);
  sender.player = f.p;
  let interfaceId = 465;
  t.mock.method(CacheDefinitions, 'getVarbit', () => ({ baseVar: 1, startBit: 0, endBit: 30 }));
  Object.assign(f.p, {
    getSession: () => ({ sendClientPacket: frame => frames.push(Buffer.from(frame)), write() {} }),
    getEnteredAmountAction: () => f.p.amountAction,
    getEnteredSyntaxAction: () => f.p.syntaxAction,
    getInterfaceId: () => interfaceId,
    setInterfaceId: id => { interfaceId = id; },
    getDialogueManager: () => ({ isActive: () => false, reset() {} }),
    getFrameUpdater: () => ({ shouldUpdate: () => true, clearGroup() {} }),
  });
  sender.sendSubInterface(GE_MODAL, 465, 0);
  // A buy offer, with its item search up and unanswered.
  f.click(7, 3);
  return { ...f, sender, frames };
}

// The same offer past its search, with "How many would you like to trade?" up and unanswered.
function countPromptExchange(t) {
  const f = promptExchange(t);
  f.p.syntaxAction.execute(String(PRICED));
  f.click(34, 7);
  return { ...f, answer: f.p.amountAction };
}

const ABORT = encodeTriggerOnDialogAbort();
const aborts = frames => frames.filter(frame => frame.equals(ABORT)).length;
const abortsBeforeClose = frames => {
  const abort = frames.findIndex(frame => frame.equals(ABORT));
  const close = frames.findIndex(frame => frame.equals(encodeWidgetCloseSub(GE_MODAL)));
  return abort >= 0 && close > abort;
};

for (const route of ['sendInterfaceRemoval', 'closeInterruptibleInterfaces']) {
  test(`closing the GE by ${route} aborts the open count prompt and drops its answer`, t => {
    const { p, sender, frames, answer } = countPromptExchange(t);
    assert.ok(frames.some(frame => frame.equals(encodeRunClientScript(108, ['How many would you like to trade?']))),
      'meslayer_mode7 opened the prompt');
    assert.equal(typeof answer.execute, 'function');
    frames.length = 0;
    sender[route]();
    assert.equal(aborts(frames), 1);
    assert.ok(abortsBeforeClose(frames));
    assert.equal(p.amountAction, null);
    assert.equal(p.syntaxAction, null);
    frames.length = 0;
    sender[route]();
    assert.equal(aborts(frames), 0, 'no prompt left to abort');
  });

  // RSProx 960 (rev 235), cycles 2869-2875: the abort, then if_closesub ge_offers.
  test(`closing the GE by ${route} aborts its open item search first`, t => {
    const { p, sender, frames } = promptExchange(t);
    assert.equal(typeof p.syntaxAction.execute, 'function');
    frames.length = 0;
    sender[route]();
    assert.equal(aborts(frames), 1);
    assert.ok(abortsBeforeClose(frames));
    assert.equal(p.syntaxAction, null);
  });
}

test('Back in the GE aborts an open prompt along with its answer', t => {
  const { p, click, frames } = countPromptExchange(t);
  frames.length = 0;
  click(4);
  assert.equal(aborts(frames), 1);
  assert.equal(p.amountAction, null);
});

test('a prompt answered before Back has nothing left to abort', t => {
  const { p, click, frames, answer } = countPromptExchange(t);
  answer.execute(1);
  p.setEnteredAmountAction(null);
  frames.length = 0;
  click(4);
  assert.equal(aborts(frames), 0);
});

// A prompt opened with no interface at all, through core's own close routes.
function promptWithNoInterface(arm) {
  const frames = [];
  const player = {
    amount: null,
    syntax: null,
    status: PlayerStatus.NONE,
    interfaceId: -1,
    dialogueManager: { isActive: () => false },
    getSession: () => ({ sendClientPacket: frame => frames.push(Buffer.from(frame)), write() {} }),
    getEnteredAmountAction: () => player.amount,
    setEnteredAmountAction: action => { player.amount = action; },
    getEnteredSyntaxAction: () => player.syntax,
    setEnteredSyntaxAction: action => { player.syntax = action; },
    getAttribute: () => undefined,
    getInterfaceId: () => -1,
    setInterfaceId() {},
    getStatus: () => player.status,
    getDialogueManager: () => player.dialogueManager,
  };
  player.packetSender = new PacketSender(player);
  player.getPacketSender = () => player.packetSender;
  arm(player);
  frames.length = 0;
  return { player, frames };
}
const armCount = player => {
  player.setEnteredAmountAction({ execute() {} });
  player.getPacketSender().sendEnterAmountPrompt('Enter amount:');
};
const armText = player => {
  player.setEnteredSyntaxAction({ execute() {} });
  player.getPacketSender().sendEnterInputPrompt('Enter a name:');
};

for (const [kind, arm] of [['count', armCount], ['text', armText]]) {
  test(`walking aborts a ${kind} prompt opened with no interface`, () => {
    const { player, frames } = promptWithNoInterface(arm);
    Player.prototype.closeInterruptibleInterfaces.call(player);
    assert.equal(aborts(frames), 1);
    assert.equal(player.amount, null);
    assert.equal(player.syntax, null);
  });

  test(`IF_CLOSE aborts a ${kind} prompt opened with no interface`, async () => {
    const { player, frames } = promptWithNoInterface(arm);
    const connection = new ClientConnection({ kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });
    connection.player = player;
    await connection.dispatch([{ type: 'interface_close' }], true);
    assert.equal(aborts(frames), 1);
    assert.equal(player.amount, null);
    assert.equal(player.syntax, null);
  });

  test(`a trade or duel keeps its ${kind} prompt when the player walks`, () => {
    for (const status of [PlayerStatus.TRADING, PlayerStatus.DUELING]) {
      const { player, frames } = promptWithNoInterface(arm);
      player.status = status;
      Player.prototype.closeInterruptibleInterfaces.call(player);
      assert.equal(frames.length, 0);
      assert.ok(player.amount || player.syntax);
    }
  });
}

test('walking with no prompt and nothing open sends nothing', () => {
  const { player, frames } = promptWithNoInterface(() => {});
  Player.prototype.closeInterruptibleInterfaces.call(player);
  assert.equal(frames.length, 0);
});

test('fee descriptions and native rate follow the selected item on setup and details', t => {
  const { p, inventory, place, click, calls, hooks } = exchange(t);
  const taxed = 19001;
  const exempt = 19002;
  define(taxed, { getName: () => 'Steel platelegs', getGrandExchangeValue: () => 309 });
  define(exempt, { getName: () => 'Teleport to house' });
  inventory.add(new Item(taxed, 1), false);
  inventory.add(new Item(exempt, 2), false);
  place(true, taxed, 1, 309);
  const description = (component) => calls.findLast(c => c.name === 'sendInterfaceScript' &&
    c.args[0] === 5730 && c.args[1][2] === ((465 << 16) | component));
  assert.equal(description(27).args[1][1], 'Convenience fee: 2%');
  assert.equal(description(16).args[1][1], 'Convenience fee: 2%');
  assert.equal(calls.findLast(c => c.name === 'sendInterfaceScript' && c.args[0] === 786).args[3][13139], 20);
  click(4);
  hooks.onItemFirstAction({ player: p, itemId: exempt, slot: inventory.getSlotForItemId(exempt) });
  assert.equal(description(27).args[1][1], 'Convenience fee: None');
  assert.equal(calls.findLast(c => c.name === 'sendVarbit' && c.args[0] === 13139).args[1], 0);
  click(4);
  click(7);
  assert.equal(description(16).args[1][1], 'Convenience fee: 2%');
  assert.equal(calls.findLast(c => c.name === 'sendVarbit' && c.args[0] === 13139).args[1], 20);
  click(4);
  click(8, 3);
  p.syntaxAction.execute(String(taxed));
  assert.equal(description(27).args[1][1], '', 'buying has no seller fee label');
});

test('fee Info uses the native overlay and closes without changing the offer', t => {
  const { p, inventory, click, calls, hooks } = exchange(t);
  inventory.add(new Item(PRICED, 1), false);
  hooks.onItemFirstAction({ player: p, itemId: PRICED, slot: 0 });
  click(29);
  const popup = calls.findLast(c => c.name === 'sendSubInterface');
  assert.deepEqual(popup.args, [(465 << 16) | 32, 289, 1]);
  const text = calls.findLast(c => c.name === 'sendInterfaceScript' && c.args[0] === 4212);
  assert.ok(text.args[1][0].startsWith('Convenience Fees|The Grand Exchange charges'));
  assert.ok(text.args[1][0].endsWith('|Close'));
  assert.equal(p.amountAction.acceptsZero, true);
  p.amountAction.execute(0);
  assert.deepEqual(calls.at(-1), { name: 'closeSubInterface', args: [(465 << 16) | 32] });
  click(30);
  click(18);
  assert.equal(calls.at(-1).args[0], 4212, 'existing offer has the same information');
});
