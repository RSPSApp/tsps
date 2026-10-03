// Run after `yarn build`: node --test tests/bonds.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { Item } = require("../dist/game/model/Item");

const TRADEABLE_BOND = 13190;
const UNTRADEABLE_BOND = 13192;
const COINS = 995;
const LOBSTER = 379;
const CONVERT_FEE = 200000;

// The live cache gives the tradeable bond its 2,000,000 gp guide price; stub
// the few definitions this test needs so it runs without the cache.
const DEFINITIONS = {
  [TRADEABLE_BOND]: { value: 2000000 },
  [UNTRADEABLE_BOND]: { value: 1 },
  [COINS]: { value: 1 },
  [LOBSTER]: { value: 150 },
};
const MARKET_VALUES = new Map();
ItemDefinition.forId = (id) => ({
  getValue: () => DEFINITIONS[id]?.value ?? 0,
  getGrandExchangeValue: () => MARKET_VALUES.get(id) || DEFINITIONS[id]?.value || 0,
  isNoted: () => false,
});

function makeContainer(capacity) {
  const items = Array.from({ length: capacity }, () => new Item(-1, 0));
  return {
    items,
    capacity: () => capacity,
    getItems: () => items,
    setItem(slot, item) {
      items[slot] = item;
      return this;
    },
    refreshItems() {
      return this;
    },
    getAmount(id) {
      return items.reduce((total, item) => total + (item.getId() === id ? item.getAmount() : 0), 0);
    },
    contains(id) {
      return this.getAmount(id) > 0;
    },
    getFreeSlots() {
      return items.filter((item) => item.getId() <= 0).length;
    },
    deleteNumber(id, amount) {
      let left = amount;
      for (const item of items) {
        if (left <= 0) break;
        if (item.getId() !== id) continue;
        const take = Math.min(left, item.getAmount());
        item.setAmount(item.getAmount() - take);
        if (item.getAmount() <= 0) item.setId(-1);
        left -= take;
      }
      return this;
    },
    add(id, amount) {
      const slot = items.findIndex((item) => item.getId() <= 0);
      if (slot >= 0) items[slot] = new Item(id, amount);
      return this;
    },
    adds(id, amount) {
      return this.add(id, amount);
    },
  };
}

function makePlayer(name) {
  const inventory = makeContainer(28);
  const bank = makeContainer(100);
  return {
    messages: [],
    attributes: new Map(),
    getUsername: () => name,
    sendMessage(message) {
      this.messages.push(message);
    },
    getInventory: () => inventory,
    getBank: () => bank,
    getCurrentBankTab: () => 0,
    getAttribute(key) {
      return this.attributes.get(key);
    },
    setAttribute(key, value) {
      this.attributes.set(key, value);
    },
  };
}

function mockApi() {
  const handlers = {
    itemActions: new Map(),
    dropPolicy: [],
    keepOnDeath: [],
    itemOnPlayer: [],
    tradeCompleted: [],
    custom: new Map(),
    prompts: [],
    persisted: [],
  };
  const api = {
    persistAttribute: (key) => handlers.persisted.push(key),
    onItemAction: (name, actions) => handlers.itemActions.set(name, actions),
    onItemDropPolicy: (handler) => handlers.dropPolicy.push(handler),
    onShouldKeepItemOnDeath: (handler) => handlers.keepOnDeath.push(handler),
    onItemOnPlayer: (handler) => handlers.itemOnPlayer.push(handler),
    onTradeCompleted: (handler) => handlers.tradeCompleted.push(handler),
    onCustomEvent: (name, handler) => {
      const list = handlers.custom.get(name) ?? [];
      list.push(handler);
      handlers.custom.set(name, list);
    },
    sendMultiChatboxPrompt: (player, title, ...pairs) => {
      handlers.prompts.push({ player, title, pairs });
      return true;
    },
  };
  return { api, handlers };
}

function registerBonds() {
  const { api, handlers } = mockApi();
  delete require.cache[require.resolve("../plugins/items/Bonds.plugin")];
  require("../plugins/items/Bonds.plugin").register(api);
  return handlers;
}

test("Bonds plugin registers its hooks and persists the membership expiry", () => {
  const handlers = registerBonds();
  assert.deepEqual(handlers.persisted, ["bond-membership-expiry"]);
  assert.ok(handlers.itemActions.has("Old school bond"));
  assert.ok(handlers.itemActions.has("Old school bond (untradeable)"));
  assert.equal(handlers.tradeCompleted.length, 1);
});

test("a traded bond arrives untradeable, and only the traded amount converts", () => {
  const handlers = registerBonds();
  const player = makePlayer("alice");
  player.getInventory().adds(TRADEABLE_BOND, 1);
  const received = new Item(TRADEABLE_BOND, 1);
  player.getInventory().adds(TRADEABLE_BOND, received.getAmount());

  handlers.tradeCompleted[0]({
    player,
    partner: makePlayer("bob"),
    received: [received],
    given: [],
  });

  assert.equal(player.getInventory().getAmount(TRADEABLE_BOND), 1, "the pre-owned bond stays tradeable");
  assert.equal(player.getInventory().getAmount(UNTRADEABLE_BOND), 1);
});

test("a donated bond arrives untradeable; untradeable bonds cannot be donated", () => {
  const handlers = registerBonds();
  const giver = makePlayer("alice");
  const target = makePlayer("bob");
  const bond = new Item(TRADEABLE_BOND, 1);
  giver.getInventory().setItem(0, bond);

  const event = { player: giver, target, item: bond, slot: 0, handled: false };
  handlers.itemOnPlayer[0](event);

  assert.equal(event.handled, true);
  assert.equal(giver.getInventory().getAmount(TRADEABLE_BOND), 0);
  assert.equal(target.getInventory().getAmount(UNTRADEABLE_BOND), 1);

  const kept = new Item(UNTRADEABLE_BOND, 1);
  target.getInventory().setItem(0, kept);
  const refused = { player: target, target: giver, item: kept, slot: 0, handled: false };
  handlers.itemOnPlayer[0](refused);

  assert.equal(refused.handled, false);
  assert.equal(target.getInventory().getAmount(UNTRADEABLE_BOND), 1);
  assert.ok(target.messages.some((message) => message.includes("cannot donate an untradeable bond")));
});

test("converting an untradeable bond costs 10% of the tradeable guide price", () => {
  const handlers = registerBonds();
  const convert = handlers.itemActions.get("Old school bond (untradeable)").Convert;
  const player = makePlayer("alice");
  player.getInventory().adds(COINS, CONVERT_FEE);
  const bond = new Item(UNTRADEABLE_BOND, 1);
  player.getInventory().setItem(1, bond);

  convert({ player, item: bond, slot: 1, itemId: UNTRADEABLE_BOND, handled: false });

  assert.equal(player.getInventory().getAmount(COINS), 0);
  assert.equal(player.getInventory().getAmount(TRADEABLE_BOND), 1);
  assert.equal(player.getInventory().getAmount(UNTRADEABLE_BOND), 0);
});

test("converting without enough coins refuses and keeps the untradeable bond", () => {
  const handlers = registerBonds();
  const convert = handlers.itemActions.get("Old school bond (untradeable)").Convert;
  const player = makePlayer("alice");
  player.getInventory().adds(COINS, CONVERT_FEE - 1);
  const bond = new Item(UNTRADEABLE_BOND, 1);
  player.getInventory().setItem(1, bond);

  convert({ player, item: bond, slot: 1, itemId: UNTRADEABLE_BOND, handled: false });

  assert.equal(player.getInventory().getAmount(COINS), CONVERT_FEE - 1);
  assert.equal(player.getInventory().getAmount(UNTRADEABLE_BOND), 1);
  assert.ok(player.messages.some((message) => message.includes("You need 200,000 coins")));
});

test("a market quote replaces the cache guide value for the conversion fee", () => {
  MARKET_VALUES.set(TRADEABLE_BOND, 1000000);
  try {
    const handlers = registerBonds();
    const convert = handlers.itemActions.get("Old school bond (untradeable)").Convert;
    const player = makePlayer("alice");
    player.getInventory().adds(COINS, 100000);
    const bond = new Item(UNTRADEABLE_BOND, 1);
    player.getInventory().setItem(1, bond);

    convert({ player, item: bond, slot: 1, itemId: UNTRADEABLE_BOND, handled: false });

    assert.equal(player.getInventory().getAmount(COINS), 0);
    assert.equal(player.getInventory().getAmount(TRADEABLE_BOND), 1);
  } finally {
    MARKET_VALUES.delete(TRADEABLE_BOND);
  }
});

test("redeeming two bonds grants the 29-day package and consumes both", () => {
  const handlers = registerBonds();
  const redeem = handlers.itemActions.get("Old school bond").Redeem;
  const player = makePlayer("alice");
  player.getInventory().adds(TRADEABLE_BOND, 1);
  player.getInventory().adds(UNTRADEABLE_BOND, 1);

  redeem({ player, item: new Item(TRADEABLE_BOND, 1), slot: 0, itemId: TRADEABLE_BOND, handled: false });

  const prompt = handlers.prompts.at(-1);
  assert.equal(prompt.player, player);
  const index = prompt.pairs.indexOf("29 days (2 bonds)");
  assert.ok(index >= 0, "the 2-bond package is offered");
  prompt.pairs[index + 1]();

  assert.equal(player.getInventory().getAmount(TRADEABLE_BOND), 0);
  assert.equal(player.getInventory().getAmount(UNTRADEABLE_BOND), 0);
  const remainingDays = (player.getAttribute("bond-membership-expiry") - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(remainingDays > 28.9 && remainingDays <= 29);
});

test("bonds cannot be dropped and are always kept on death", () => {
  const handlers = registerBonds();
  const player = makePlayer("alice");
  const drop = {
    player,
    itemId: TRADEABLE_BOND,
    item: new Item(TRADEABLE_BOND, 1),
    slot: 0,
    interfaceId: 3214,
    dropToGround: true,
    handled: false,
  };
  handlers.dropPolicy[0](drop);

  assert.equal(drop.handled, true);
  assert.ok(player.messages.some((message) => message.includes("cannot be dropped or destroyed")));

  const bond = { player, item: new Item(UNTRADEABLE_BOND, 1), keep: null };
  handlers.keepOnDeath[0](bond);
  assert.equal(bond.keep, true);
  const lobster = { player, item: new Item(LOBSTER, 1), keep: null };
  handlers.keepOnDeath[0](lobster);
  assert.equal(lobster.keep, null);
});

test("the Grand Exchange refuses untradeable bond sales and delivers bought bonds untradeable", () => {
  const handlers = registerBonds();
  const player = makePlayer("alice");
  const confirmHandlers = handlers.custom.get("ge:offer-confirmed");
  const collectedHandlers = handlers.custom.get("ge:offer-collected");

  const sale = { player, itemId: UNTRADEABLE_BOND, sell: true, accepted: true };
  confirmHandlers[0](sale);
  assert.equal(sale.accepted, false);
  assert.ok(player.messages.some((message) => message.includes("cannot sell an untradeable bond")));

  const tradeableSale = { player, itemId: TRADEABLE_BOND, sell: true, accepted: true };
  confirmHandlers[0](tradeableSale);
  assert.equal(tradeableSale.accepted, true);

  const inventory = player.getInventory();
  inventory.adds(TRADEABLE_BOND, 1);
  collectedHandlers[0]({
    player,
    itemId: TRADEABLE_BOND,
    amount: 1,
    destination: "inventory",
    container: inventory,
  });

  assert.equal(inventory.getAmount(TRADEABLE_BOND), 0);
  assert.equal(inventory.getAmount(UNTRADEABLE_BOND), 1);
});
