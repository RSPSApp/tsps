// Run after `yarn build`: node --test tests/settings-trade-delay.test.cjs
// All Settings "Accept trade delay" (205, varbit 13130, on by default): while on, Accept does nothing for 3 seconds
// after either player changes the offers, so a trade never completes inside that window, even when both accept at once.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { Trading, TradeState } = require("../dist/game/content/Trading");
const settingsJson = require("../plugins/interface/data/settings.json").settings;

const LOBSTER = 379;
const COINS = 995;
const DELAY_VARBIT = 13130;

const DEFINITIONS = {
  [LOBSTER]: { name: "Lobster", stackable: false, value: 150 },
  [COINS]: { name: "Coins", stackable: true, value: 1 },
};
ItemDefinition.forId = (id) => {
  const def = DEFINITIONS[id] ?? { name: "null", stackable: false, value: 0 };
  return {
    getId: () => id, getName: () => def.name, isStackable: () => def.stackable, getValue: () => def.value,
    getGrandExchangeValue: () => def.value, isTradeable: () => true, isNoted: () => false,
  };
};

/** A trader whose packet sender keeps varbits; every other packet is a chainable no-op. */
function createPlayer(name, index, delay, bot = false) {
  const varbits = new Map([[DELAY_VARBIT, delay]]);
  let status = PlayerStatus.NONE;
  let interfaceId = -1;
  const sender = new Proxy({}, {
    get: (_target, key) => {
      if (key === "getVarbit") return (id) => varbits.get(id) ?? 0;
      if (key === "sendInterfaceRemoval") return () => { status = PlayerStatus.NONE; interfaceId = -1; return sender; };
      if (key === "sendTypedMessage") return (type, text) => { player.typed.push([type, text]); return sender; };
      return () => sender;
    },
  });
  const player = {
    messages: [],
    typed: [],
    getUsername: () => name, getDisplayName: () => name, getIndex: () => index,
    getSession: () => ({ sendClientPacket: () => true }),
    getPacketSender: () => sender,
    sendMessage: (message) => player.messages.push(message),
    getStatus: () => status, setStatus: (next) => { status = next; },
    getInterfaceId: () => interfaceId, setInterfaceId: (next) => { interfaceId = next; },
    isPlayerBot: () => bot,
    getFrameUpdater: () => ({ clear() {}, clearGroup() {} }),
    getAttribute: () => undefined,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  player.getInventory = () => player.inventory;
  player.trading = new Trading(player);
  player.getTrading = () => player.trading;
  return player;
}

function offer(player, itemId, amount) {
  const inventory = player.getInventory();
  player.getTrading().handleItem(itemId, amount, inventory.getSlotForItemId(itemId), inventory, player.getTrading().getContainer());
}

/** Both accept, past the 1 second button delay each time. */
function bothAccept(alice, bob) {
  for (const player of [alice, bob]) {
    player.getTrading().getButtonDelay().stop();
    player.getTrading().acceptTrade();
  }
}

function startTrade(t, aliceDelay = 1, bobDelay = 1) {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const alice = createPlayer("alice", 1, aliceDelay);
  const bob = createPlayer("bob", 2, bobDelay);
  alice.getInventory().adds(LOBSTER, 3);
  bob.getInventory().adds(COINS, 500);
  alice.getTrading().requestTrade(bob);
  bob.getTrading().requestTrade(alice);
  offer(alice, LOBSTER, 3);
  offer(bob, COINS, 200);
  return { alice, bob };
}

const state = (player) => player.getTrading().getState();

test("the row is in settings.json on varbit 13130, on by default", () => {
  assert.deepEqual(settingsJson[205], { name: "Accept trade delay", varbit: DELAY_VARBIT, default: 1 });
});

test("with the delay on, Accept does nothing for 3 seconds after the last change", (t) => {
  const { alice, bob } = startTrade(t);
  t.mock.timers.tick(2999);
  bothAccept(alice, bob);
  assert.equal(state(alice), TradeState.TRADE_SCREEN);
  assert.equal(state(bob), TradeState.TRADE_SCREEN);
  t.mock.timers.tick(1);
  bothAccept(alice, bob);
  assert.equal(state(alice), TradeState.CONFIRM_SCREEN, "both accepted once the delay ran out");
  assert.equal(state(bob), TradeState.CONFIRM_SCREEN);
});

test("a change by the other player restarts the delay, and the trade never completes inside it", (t) => {
  const { alice, bob } = startTrade(t);
  t.mock.timers.tick(3000);
  alice.getTrading().getButtonDelay().stop();
  alice.getTrading().acceptTrade();
  assert.equal(state(alice), TradeState.ACCEPTED_TRADE_SCREEN);
  offer(bob, COINS, 1);
  assert.equal(state(alice), TradeState.TRADE_SCREEN, "the change takes back the accept");
  t.mock.timers.tick(2000);
  bothAccept(alice, bob);
  bothAccept(alice, bob);
  assert.equal(state(alice), TradeState.TRADE_SCREEN);
  assert.equal(alice.getInventory().getAmount(COINS), 0, "nothing was exchanged");
  t.mock.timers.tick(1000);
  bothAccept(alice, bob);
  bothAccept(alice, bob);
  assert.equal(alice.getInventory().getAmount(COINS), 201, "the trade completes after the delay");
  assert.equal(bob.getInventory().getAmount(LOBSTER), 3);
});

test("each player's own setting decides their delay", (t) => {
  const { alice, bob } = startTrade(t, 0, 1);
  bothAccept(alice, bob);
  assert.equal(state(alice), TradeState.ACCEPTED_TRADE_SCREEN, "Alice has the delay off");
  assert.equal(state(bob), TradeState.TRADE_SCREEN, "Bob waits");
});

test("with the delay off for both, Accept works straight after a change", (t) => {
  const { alice, bob } = startTrade(t, 0, 0);
  bothAccept(alice, bob);
  assert.equal(state(alice), TradeState.CONFIRM_SCREEN);
});

test("an AI bot never waits, so its offer-then-accept in one tick still counts", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const bot = createPlayer("bot", 1, 1, true);
  const alice = createPlayer("alice", 2, 1);
  bot.getInventory().adds(LOBSTER, 1);
  bot.getTrading().requestTrade(alice);
  alice.getTrading().requestTrade(bot);
  offer(bot, LOBSTER, 1);
  bot.getTrading().acceptTrade();
  assert.equal(state(bot), TradeState.ACCEPTED_TRADE_SCREEN, "the bot's accept is kept");
  alice.getTrading().getButtonDelay().stop();
  alice.getTrading().acceptTrade();
  assert.equal(state(alice), TradeState.TRADE_SCREEN, "the player still waits out the delay");
});

test("the request and the finished trade send live's trade-type lines (rsprox 227/00548.txt:3891, :4488)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const alice = createPlayer("alice", 1, 0);
  const bob = createPlayer("bob", 2, 0);
  alice.getInventory().adds(LOBSTER, 1);
  alice.getTrading().requestTrade(bob);
  assert.deepEqual(alice.typed, [[102, "Sending trade offer..."]]);
  assert.deepEqual(alice.messages, [], "no game message for the request");
  bob.getTrading().requestTrade(alice);
  // Answering a pending request sends the line too, before the trade screen (rsprox 229/02510.txt:3835, :4682).
  assert.deepEqual(bob.typed, [[102, "Sending trade offer..."]], "the answering player's line");
  assert.equal(state(bob), TradeState.TRADE_SCREEN);
  offer(alice, LOBSTER, 1);
  bothAccept(alice, bob);
  assert.equal(state(alice), TradeState.CONFIRM_SCREEN);
  bothAccept(alice, bob);
  for (const player of [alice, bob]) {
    assert.deepEqual(player.typed.at(-1), [102, "Accepted trade."], player.getUsername());
    assert.ok(!player.messages.includes("Trade accepted!"), player.getUsername());
  }
});
