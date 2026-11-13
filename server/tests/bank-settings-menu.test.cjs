// Run after `yarn build`: node --test tests/bank-settings-menu.test.cjs
// The bank settings menu (the wrench): its toggles and tab display are kept by the server and restored on login,
// Release all placeholders asks first and then releases them in every tab, and Bank Fillers fill the main tab and
// clear only through the filler's own "clear them all" popup. Real engine: every plugin loaded, a real Player with
// the bank open, clicks through the same routes the network uses.
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

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const component = (name) => core.CacheDefinitions.getComponentId(`bankmain:${name}`);
const varbit = (name) => core.CacheDefinitions.getVarbitId(name);

let next = 9960;
function banker(t, setup) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("banksettings" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => p.setRegistered(false));
  const sender = p.getPacketSender();
  const messages = [];
  const varbits = [];
  const popups = [];
  t.mock.method(sender, "sendMessage", (m) => { messages.push(m); return sender; });
  const sendVarbit = sender.sendVarbit.bind(sender);
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.push([id, value]); return sendVarbit(id, value); });
  const sendClientScript = sender.sendClientScript.bind(sender);
  t.mock.method(sender, "sendClientScript", (id, ...args) => { if (id === 4212) popups.push(args[0]); return sendClientScript(id, ...args); });
  setup?.(p);
  p.getBank(0).open();
  assert.equal(Bank.isOpen(p), true, "the bank is open");
  return { p, messages, varbits, popups };
}

function click(p, name, slot) {
  const widgetId = component(name);
  const packet = { widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum: 1, slot };
  const event = { player: p, packet, handled: false };
  PM.emitCustomEvent("player:widget-action", event);
  return event.handled;
}

const answer = (p, value) => p.getEnteredAmountAction().execute(value);
const fillers = (p) => p.getBank(0).getItems().filter((item) => item.getId() === core.ItemIdentifiers.BANK_FILLER);

test("a menu toggle flips its varbit on the server, and the saved value comes back on login", (t) => {
  const f = banker(t);
  const incinerator = varbit("bank_showincinerator");
  assert.equal(click(f.p, "incinerator_toggle"), true);
  assert.deepEqual(f.varbits.at(-1), [incinerator, 1]);
  assert.equal(click(f.p, "banktut_toggle"), true);
  assert.deepEqual(f.varbits.at(-1), [varbit("bank_hidebanktut"), 1]);
  f.varbits.length = 0;
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.ok(f.varbits.some(([id, value]) => id === incinerator && value === 1), JSON.stringify(f.varbits));
  click(f.p, "incinerator_toggle");
  assert.deepEqual(f.varbits.at(-1), [incinerator, 0], "a second click turns it off");
});

test("the tab display choice is kept, and opening the bank no longer resets it", (t) => {
  const f = banker(t);
  const display = varbit("bank_tab_display");
  click(f.p, "dropdown_content", 5);
  assert.deepEqual(f.varbits.at(-1), [display, 2], "the third choice (Roman numerals)");
  f.varbits.length = 0;
  f.p.getBank(0).open();
  assert.equal(f.p.getPacketSender().getVarbit(display), 2);
});

test("Release all placeholders asks first, and Yes releases them in every tab", (t) => {
  const f = banker(t, (p) => {
    p.getBank(0).add(new core.Item(core.ItemIdentifiers.LOBSTER, 0), false);
    p.getBank(1).add(new core.Item(core.ItemIdentifiers.SHARK, 0), false);
    p.getBank(0).add(new core.Item(core.ItemIdentifiers.COINS, 5), false);
  });
  click(f.p, "release_placeholders");
  assert.equal(f.popups.length, 1, "the confirmation popup");
  assert.match(f.popups[0], /^Release all placeholders\?/);
  answer(f.p, 0);
  assert.equal(f.p.getBank(0).getSlotForItemId(core.ItemIdentifiers.LOBSTER) >= 0, true, "Cancel keeps them");
  click(f.p, "release_placeholders");
  answer(f.p, 1);
  assert.equal(f.p.getBank(0).getSlotForItemId(core.ItemIdentifiers.LOBSTER), -1, "the main tab's placeholder");
  assert.equal(f.p.getBank(1).getSlotForItemId(core.ItemIdentifiers.SHARK), -1, "tab 1's placeholder");
  assert.equal(f.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 5, "real items stay");
});

test("Bank Fillers: the picked amount fills the main tab, one filler per slot, up to the space left", (t) => {
  const f = banker(t);
  click(f.p, "bank_filler_10");
  assert.deepEqual(f.varbits.at(-1), [varbit("bank_fillermode"), 2]);
  click(f.p, "bank_filler_confirm");
  assert.equal(fillers(f.p).length, 10);
  assert.ok(fillers(f.p).every((item) => item.getAmount() === 1));
  assert.equal(f.messages.at(-1), "You add 10 bank fillers to your bank.");
  click(f.p, "bank_filler_all");
  const free = Bank.freeSlots(f.p);
  click(f.p, "bank_filler_confirm");
  assert.equal(fillers(f.p).length, 10 + free);
  assert.equal(Bank.freeSlots(f.p), 0);
  click(f.p, "bank_filler_1");
  click(f.p, "bank_filler_confirm");
  assert.equal(f.messages.at(-1), "Not enough space in bank.");
});

test("a filler can't be withdrawn; its clear op asks, then clears every filler", (t) => {
  const f = banker(t);
  click(f.p, "bank_filler_50");
  click(f.p, "bank_filler_confirm");
  const slot = f.p.getBank(0).getSlotForItemId(core.ItemIdentifiers.BANK_FILLER);
  const op = (buttonNum) => Bank.handleWidgetAction(f.p, { groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.ITEMS_CHILD,
    buttonNum, slot, itemId: core.ItemIdentifiers.BANK_FILLER });
  op(1);
  assert.equal(f.p.getInventory().getAmount(core.ItemIdentifiers.BANK_FILLER), 0, "nothing withdrawn");
  assert.equal(fillers(f.p).length, 50);
  op(8);
  assert.match(f.popups.at(-1), /^Clear all fillers\?/);
  answer(f.p, 1);
  assert.equal(fillers(f.p).length, 0);
});

test("the X amount asks for a number when filling, without changing the bank's withdraw-X amount", (t) => {
  const f = banker(t);
  const before = f.p.getBankCustomQuantity();
  click(f.p, "bank_filler_x");
  click(f.p, "bank_filler_confirm");
  answer(f.p, 3);
  assert.equal(fillers(f.p).length, 3);
  assert.equal(f.p.getBankCustomQuantity(), before);
});

test("another bank click takes the popup down unanswered; a menu click aborts an open Enter amount prompt", (t) => {
  const f = banker(t, (p) => p.getBank(0).add(new core.Item(core.ItemIdentifiers.LOBSTER, 0), false));
  const closed = [];
  const sender = f.p.getPacketSender();
  const closeSubInterface = sender.closeSubInterface.bind(sender);
  t.mock.method(sender, "closeSubInterface", (uid) => { closed.push(uid); return closeSubInterface(uid); });
  let aborts = 0;
  t.mock.method(sender, "abortInputPrompt", () => { aborts++; return sender; });
  click(f.p, "release_placeholders");
  const popupAction = f.p.getEnteredAmountAction();
  click(f.p, "incinerator_toggle");
  assert.deepEqual(closed, [component("popup")], "the popup is closed");
  assert.notEqual(f.p.getEnteredAmountAction(), popupAction, "its answer is gone");
  assert.equal(f.p.getBank(0).getSlotForItemId(core.ItemIdentifiers.LOBSTER) >= 0, true, "nothing released");
  f.p.setEnteredAmountAction({ execute() {} });
  click(f.p, "banktut_toggle");
  assert.equal(aborts, 1, "the prompt is aborted");
});

test("a tab display sub past the dropdown's four choices changes nothing", (t) => {
  const f = banker(t);
  f.varbits.length = 0;
  click(f.p, "dropdown_content", 9);
  assert.deepEqual(f.varbits, []);
});

test("the popup aborts an open Enter amount prompt, so that prompt's answer can't count as Yes", (t) => {
  const f = banker(t, (p) => {
    p.getBank(0).add(new core.Item(core.ItemIdentifiers.LOBSTER, 0), false);
    p.getBank(0).add(new core.Item(core.ItemIdentifiers.COINS, 5), false);
  });
  const sender = f.p.getPacketSender();
  let aborts = 0;
  t.mock.method(sender, "abortInputPrompt", () => { aborts++; return sender; });
  Bank.promptAmount(f.p, () => assert.fail("the withdraw-X answer must not run"));
  click(f.p, "release_placeholders");
  assert.equal(aborts, 1, "the amount prompt is aborted when the popup opens");
  // Only the popup's own buttons answer now: Cancel keeps the placeholders.
  answer(f.p, 0);
  assert.equal(f.p.getBank(0).getSlotForItemId(core.ItemIdentifiers.LOBSTER) >= 0, true);
});

test("Fill puts the fillers after the main tab's last item, not where released placeholders were", (t) => {
  const f = banker(t, (p) => {
    p.getBank(0).add(new core.Item(core.ItemIdentifiers.LOBSTER, 0), false);
    p.getBank(0).add(new core.Item(core.ItemIdentifiers.COINS, 5), false);
    p.getBank(0).add(new core.Item(core.ItemIdentifiers.SHARK, 2), false);
  });
  click(f.p, "release_placeholders");
  answer(f.p, 1);
  click(f.p, "bank_filler_1");
  click(f.p, "bank_filler_confirm");
  const names = Bank.layout(f.p).map((entry) => entry.item.getId());
  assert.deepEqual(names, [core.ItemIdentifiers.COINS, core.ItemIdentifiers.SHARK, core.ItemIdentifiers.BANK_FILLER]);
});
