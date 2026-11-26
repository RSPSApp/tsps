// Run after `yarn build`: node --test tests/motherlode-pay-dirt-bank.test.cjs
// Pay-dirt can't be banked (#6804; Wiki, Pay-dirt: "Pay-dirt cannot be deposited in the bank"). Real engine:
// every plugin loaded, a real Player with the bank open, each deposit path the bank and deposit box use.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Bank } = require("../dist/game/model/container/impl/Bank");

const TEXT = "A magical force prevents you from banking this item!";

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9860;
/** A real player with the bank open, holding `items` ([id, amount] per slot from slot 0). */
function banker(t, items) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("paydirt" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const sender = p.getPacketSender();
  const messages = [];
  t.mock.method(sender, "sendMessage", (m) => { messages.push(m); return sender; });
  items.forEach(([id, amount], slot) => p.getInventory().setItem(slot, new core.Item(id, amount)));
  p.getBank(0).open();
  assert.equal(Bank.isOpen(p), true, "the bank is open");
  return { p, messages };
}

const PAY_DIRT = () => core.ItemIdentifiers.PAY_DIRT;
const banked = (p, id) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((sum, tab) => sum + p.getBank(tab).getAmount(id), 0);

test("clicking pay-dirt in the bank (Deposit-1 and Deposit-All) leaves it in the inventory", (t) => {
  const f = banker(t, [[PAY_DIRT(), 1], [PAY_DIRT(), 1], [PAY_DIRT(), 1]]);
  Bank.deposit(f.p, PAY_DIRT(), 1, 1, false);
  Bank.deposit(f.p, PAY_DIRT(), 0, -1, false);
  assert.equal(f.p.getInventory().getAmount(PAY_DIRT()), 3);
  assert.equal(banked(f.p, PAY_DIRT()), 0);
  assert.deepEqual(f.messages, [TEXT, TEXT], "one line per click");
});

test("Deposit inventory banks everything else and says the line once, however much pay-dirt", (t) => {
  const { LOBSTER } = core.ItemIdentifiers;
  const f = banker(t, [[LOBSTER, 1], [PAY_DIRT(), 1], [PAY_DIRT(), 1], [LOBSTER, 1], [PAY_DIRT(), 1]]);
  Bank.depositItems(f.p, f.p.getInventory(), false);
  assert.equal(f.p.getInventory().getAmount(PAY_DIRT()), 3, "the pay-dirt stays");
  assert.equal(f.p.getInventory().getAmount(LOBSTER), 0, "the lobsters go");
  assert.equal(banked(f.p, LOBSTER), 2);
  assert.equal(banked(f.p, PAY_DIRT()), 0);
  assert.deepEqual(f.messages, [TEXT], "no line per pay-dirt");
});

test("dragging pay-dirt onto the bank and the deposit box's Deposit-inventory refuse it", (t) => {
  const f = banker(t, [[PAY_DIRT(), 1], [PAY_DIRT(), 1]]);
  Bank.depositDragged(f.p, 1, PAY_DIRT(), 0);
  // The deposit box (BankDepositBooth) banks through the same calls, with its own open check skipped.
  Bank.deposit(f.p, PAY_DIRT(), 0, 1, true);
  Bank.depositItems(f.p, f.p.getInventory(), true);
  assert.equal(f.p.getInventory().getAmount(PAY_DIRT()), 2);
  assert.equal(banked(f.p, PAY_DIRT()), 0);
  assert.deepEqual(f.messages, [TEXT, TEXT, TEXT]);
});

test("a quiet ask (presets, servants) refuses pay-dirt without a line", (t) => {
  const f = banker(t, [[PAY_DIRT(), 1]]);
  assert.equal(PM.emitCanBankItem(f.p, f.p.getInventory().getItems()[0], { quiet: true }), false);
  assert.deepEqual(f.messages, []);
});
