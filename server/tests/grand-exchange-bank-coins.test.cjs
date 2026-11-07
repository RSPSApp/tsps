// Run after `yarn build`: node --test tests/grand-exchange-bank-coins.test.cjs
//
// Wiki: Grand_Exchange (Changes, 14 June 2023): "Buy offers can now use the coins from the player's
// bank as payment; coins in the player's inventory take precedence". Beyond Max Cash adds platinum
// tokens, with change in coins in the container they came from. A real Player, Inventory and Bank;
// the GE opens through ::ge, clicks go through ClientConnection.dispatch as IF_BUTTON packets, and a
// buy's item is the answer to its search prompt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
require("./helpers/pvp-mode-on.cjs");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const HOME = [3222, 3218];
const GE = 465;
const OFFERS = "grand-exchange-offers";
const NOT_ENOUGH = "You do not have enough coins.";
const PRESET_TEXT = "Preset items cannot be used for this.";
const ENTER_PIN = "You need to enter your Bank PIN at a bank first.";

let core;
let I;
let next = 5900;
/** What one abyssal whip costs at its guide price. */
let COST;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("gebank" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sender = p.getPacketSender();
  const send = sender.sendMessage.bind(sender);
  sender.sendMessage = (message) => {
    messages.push(message);
    return send(message);
  };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, inv: p.getInventory(), messages };
}

const item = (id, amount = 1) => new core.Item(id, amount);
const placed = (f) => Object.values(f.p.getAttribute(OFFERS) ?? {});
const bankAmount = (f, id) => Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) => tab)
  .filter((tab) => tab !== core.Bank.BANK_SEARCH_TAB_INDEX)
  .reduce((sum, tab) => sum + f.p.getBank(tab).getAmount(id), 0);
const bank = (f, tab, ...items) => items.forEach((held) => f.p.getBank(tab).add(held, false));
const snapshot = (f) => JSON.stringify({
  offers: f.p.getAttribute(OFFERS) ?? null,
  inventory: f.inv.getItems().filter((held) => held.getId() > 0).map((held) => [held.getId(), held.getAmount()]),
  banks: Array.from({ length: core.Bank.TOTAL_BANK_TABS }, (_, tab) =>
    f.p.getBank(tab).getItems().filter((held) => held.getId() > 0).map((held) => [held.getId(), held.getAmount()])),
});

async function button(f, groupId, childId, slot = 0, itemId = -1, buttonNum = 1) {
  await f.c.dispatch([{ type: "widget_action", widgetId: (groupId << 16) | childId, groupId, childId, buttonNum, slot, itemId }]);
  f.c.processTurnPackets();
}

function open(f) {
  PM.emitCommand({ player: f.p, raw: "ge", base: "ge", parts: ["ge"], handled: false });
  assert.equal(f.p.getInterfaceId(), GE, "the GE opened");
}

/** Sets up a buy of one abyssal whip at its guide price, from slot 0's Buy button and the search. */
async function setUp(f) {
  if (f.p.getInterfaceId() !== GE) open(f);
  await button(f, GE, 7, 3);
  f.p.getEnteredSyntaxAction().execute(String(I.ABYSSAL_WHIP));
}
const confirm = (f) => button(f, GE, 30);
async function buy(f) {
  await setUp(f);
  await confirm(f);
}

test("control: a whip costs more than 1,000 coins, paid from the inventory", async (t) => {
  const f = actor(t);
  f.inv.add(item(I.COINS, 100_000_000));
  await buy(f);
  assert.equal(placed(f).length, 1);
  COST = placed(f)[0].total;
  assert.ok(COST > 1_000, "the whip's price needs more than a token");
  assert.equal(f.inv.getAmount(I.COINS), 100_000_000 - COST);
});

test("coins in the bank alone pay for a buy offer", async (t) => {
  const f = actor(t);
  bank(f, 0, item(I.COINS, COST + 5));
  await buy(f);
  assert.equal(placed(f).length, 1, "the offer is placed");
  assert.equal(placed(f)[0].total, COST);
  assert.equal(bankAmount(f, I.COINS), 5, "the bank paid");
  assert.equal(f.inv.getAmount(I.COINS), 0);
  assert.ok(!f.messages.includes(NOT_ENOUGH));
});

test("the inventory's coins go first and the bank pays the rest, across tabs", async (t) => {
  const f = actor(t);
  f.inv.add(item(I.COINS, 100));
  f.inv.add(item(I.LOBSTER, 1));
  bank(f, 2, item(I.COINS, 50));
  bank(f, 0, item(I.COINS, COST));
  await buy(f);
  assert.equal(placed(f).length, 1, "the offer is placed");
  assert.equal(f.inv.getAmount(I.COINS), 0, "all the carried coins were spent");
  assert.equal(f.inv.getAmount(I.LOBSTER), 1, "nothing else left the inventory");
  assert.equal(bankAmount(f, I.COINS), COST + 50 - (COST - 100), "the bank paid only the shortfall");
});

test("the inventory alone pays when it holds enough, and the bank is untouched", async (t) => {
  const f = actor(t);
  f.inv.add(item(I.COINS, COST));
  bank(f, 0, item(I.COINS, 1_000));
  await buy(f);
  assert.equal(placed(f).length, 1);
  assert.equal(f.inv.getAmount(I.COINS), 0);
  assert.equal(bankAmount(f, I.COINS), 1_000);
});

test("exactly enough coins between the inventory and the bank empties both", async (t) => {
  const f = actor(t);
  f.inv.add(item(I.COINS, 1));
  bank(f, 0, item(I.COINS, COST - 1));
  await buy(f);
  assert.equal(placed(f).length, 1, "the offer is placed");
  assert.equal(f.inv.getAmount(I.COINS), 0);
  assert.equal(bankAmount(f, I.COINS), 0);
  assert.equal(f.p.getBank(0).getItems().filter((held) => held.getId() > 0).length, 0, "no empty stack left behind");
});

test("one coin short in total is refused and moves nothing", async (t) => {
  const f = actor(t);
  f.inv.add(item(I.COINS, 1));
  bank(f, 0, item(I.COINS, COST - 2));
  await setUp(f);
  const before = snapshot(f);
  await confirm(f);
  assert.ok(f.messages.includes(NOT_ENOUGH), "the refusal");
  assert.equal(snapshot(f), before, "no offer, and the inventory and bank are unchanged");
  // The same click goes through with the missing coin in the bank.
  bank(f, 3, item(I.COINS, 1));
  await confirm(f);
  assert.equal(placed(f).length, 1, "one more banked coin covers it");
  assert.equal(bankAmount(f, I.COINS) + f.inv.getAmount(I.COINS), 0);
});

test("banked platinum tokens pay what the coins cannot, with change in the bank", async (t) => {
  const f = actor(t);
  bank(f, 0, item(I.COINS, 10));
  bank(f, 1, item(I.PLATINUM_TOKEN, 5_000));
  await buy(f);
  assert.equal(placed(f).length, 1, "the offer is placed");
  const tokens = Math.ceil((COST - 10) / 1_000);
  assert.equal(bankAmount(f, I.PLATINUM_TOKEN), 5_000 - tokens);
  assert.equal(bankAmount(f, I.COINS), tokens * 1_000 - (COST - 10), "the change is banked as coins");
  assert.equal(f.inv.getAmount(I.COINS), 0, "no change lands in the inventory");
});

test("a Bank PIN not entered this session keeps the bank from paying", async (t) => {
  const f = actor(t);
  bank(f, 0, item(I.COINS, COST));
  open(f);
  const pin = require("../plugins/interface/bankpin/Common.BankPin");
  f.p.setAttribute("bank-pin:hash", pin.hash(f.p, "2468"));
  await setUp(f);
  const before = snapshot(f);
  await confirm(f);
  assert.ok(f.messages.includes(ENTER_PIN), "the PIN refusal");
  assert.ok(!f.messages.includes(NOT_ENOUGH));
  assert.equal(snapshot(f), before, "no offer, and the bank is unchanged");
  assert.equal(f.p.getInterfaceId(), GE, "no keypad opens over the exchange");
  // Once the PIN is entered, the same click is paid from the bank.
  pin.unlock(f.p);
  await confirm(f);
  assert.equal(placed(f).length, 1);
  assert.equal(bankAmount(f, I.COINS), 0);
});

test("preset coins in the bank are never spent", async (t) => {
  const f = actor(t);
  // The metadata Presets.PvpMode's spawnPresetItem puts on a preset copy (coins are not spawnable,
  // so a preset load never makes these; this stands in for any restricted copy that reaches a bank).
  const copy = item(I.COINS, COST);
  for (const key of [core.Item.UNTRADEABLE_META, core.Item.UNBANKABLE_META, core.Item.PRESET_META]) copy.setMetaValue(key, true);
  assert.equal(copy.isPresetItem(), true);
  f.p.getBank(0).setItem(0, copy);
  await setUp(f);
  const before = snapshot(f);
  await confirm(f);
  assert.ok(f.messages.includes(PRESET_TEXT), "the preset refusal");
  assert.equal(snapshot(f), before, "no offer, and the preset coins stay");
  assert.equal(f.p.getBank(0).getItems()[0].isPresetItem(), true);
  // Plain banked coins beside them do pay.
  bank(f, 1, item(I.COINS, COST));
  await confirm(f);
  assert.equal(placed(f).length, 1);
  assert.equal(f.p.getBank(0).getAmount(I.COINS), COST, "the preset stack is untouched");
  assert.equal(f.p.getBank(1).getAmount(I.COINS), 0, "the plain stack paid");
});

test("aborting a bank-paid offer refunds its full price through the collection", async (t) => {
  const f = actor(t);
  bank(f, 0, item(I.COINS, COST));
  await buy(f);
  assert.equal(placed(f).length, 1, "the offer is placed");
  assert.equal(bankAmount(f, I.COINS), 0, "the bank paid");
  await button(f, GE, 23, 0);
  assert.equal(placed(f)[0].aborted, true, "the offer was aborted");
  // Collect (465:24) op 1: the refund goes to the inventory, as any aborted buy's does.
  await button(f, GE, 24, 0, -1, 1);
  assert.equal(placed(f).length, 0, "the offer was collected");
  assert.equal(f.inv.getAmount(I.COINS), COST, "the whole price came back");
  assert.equal(bankAmount(f, I.COINS), 0);
});

/** Banked coins in `coinTab` and 5,000 tokens in `tokenTab`; the buy needs tokens, with change. */
const tokenChange = (coins) => {
  const tokens = Math.ceil((COST - coins) / 1_000);
  return { tokens, change: tokens * 1_000 - (COST - coins) };
};
const coinSlots = (f, tab) => f.p.getBank(tab).getItems().filter((held) => held.getId() === I.COINS);

test("a full bank still takes a token-paid buy: the change stays in the coin stack", async (t) => {
  const f = actor(t);
  bank(f, 0, item(I.COINS, 10));
  bank(f, 1, item(I.PLATINUM_TOKEN, 5_000));
  const filler = f.p.getBank(4);
  for (let id = 1_000; core.Bank.freeSlots(f.p) > 0; id++) filler.setItem(filler.freeSlot(), item(id));
  assert.equal(core.Bank.freeSlots(f.p), 0, "the bank is full");
  await buy(f);
  assert.ok(!f.messages.some((message) => /bank space|couldn't hold/.test(message)), "no space refusal");
  assert.equal(placed(f).length, 1, "the offer is placed");
  const { tokens, change } = tokenChange(10);
  assert.equal(bankAmount(f, I.PLATINUM_TOKEN), 5_000 - tokens);
  assert.equal(f.p.getBank(0).getAmount(I.COINS), change, "the change is in the coin stack");
});

test("token change goes to the coins' tab, not the tokens'", async (t) => {
  const f = actor(t);
  bank(f, 2, item(I.COINS, 10));
  bank(f, 0, item(I.PLATINUM_TOKEN, 5_000));
  await buy(f);
  assert.equal(placed(f).length, 1, "the offer is placed");
  assert.equal(f.p.getBank(2).getAmount(I.COINS), tokenChange(10).change, "the change stayed in tab 2");
  assert.equal(coinSlots(f, 0).length, 0, "no coins moved into the tokens' tab");
});

test("token change with no banked coins fills the coins placeholder", async (t) => {
  const f = actor(t);
  f.p.getBank(3).setItem(0, item(I.COINS, 0));
  bank(f, 0, item(I.PLATINUM_TOKEN, 5_000));
  assert.equal(core.Bank.getTabForItem(f.p, I.COINS), 3, "the placeholder marks tab 3");
  await buy(f);
  assert.equal(placed(f).length, 1, "the offer is placed");
  assert.deepEqual(coinSlots(f, 3).map((held) => held.getAmount()), [tokenChange(0).change], "the placeholder holds the change");
  assert.equal(coinSlots(f, 0).length, 0, "no coins in the tokens' tab");
});
