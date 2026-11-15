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

test("collapsing a tab keeps bank fillers one per slot", (t) => {
  const f = banker(t);
  click(f.p, "bank_filler_10");
  click(f.p, "bank_filler_confirm");
  const used = Bank.usedSlots(f.p);
  const tabButton = (tab) => (Bank.MAIN_INTERFACE_ID << 16) | Bank.TABS_CHILD;
  for (let moved = 0; moved < 3; moved++) {
    const display = Bank.layout(f.p).findIndex((entry) => entry.tab === 0 && entry.item.getId() === core.ItemIdentifiers.BANK_FILLER);
    Bank.handleDrag(f.p, { sourceWidgetId: (Bank.MAIN_INTERFACE_ID << 16) | Bank.ITEMS_CHILD, sourceSlot: display,
      sourceItemId: core.ItemIdentifiers.BANK_FILLER, targetWidgetId: tabButton(1), targetSlot: Bank.TAB_BUTTON_SLOT_OFFSET + 1 });
  }
  assert.equal(f.p.getBank(1).getValidItems().length, 3, "three fillers in tab 1");
  Bank.collapseTab(f.p, 1);
  assert.equal(Bank.usedSlots(f.p), used, "no slot lost");
  assert.equal(fillers(f.p).length, 10);
  assert.ok(fillers(f.p).every((item) => item.getAmount() === 1));
});

test("Fill All after Release all closes the released gaps: every filler goes after the main tab's items", (t) => {
  const I = core.ItemIdentifiers;
  const f = banker(t, (p) => {
    p.getBank(0).add(new core.Item(I.LOBSTER, 0), false);
    p.getBank(0).add(new core.Item(I.COINS, 50), false);
    p.getBank(0).add(new core.Item(I.SHARK, 0), false);
    p.getBank(0).add(new core.Item(I.BONES, 3), false);
  });
  click(f.p, "release_placeholders");
  answer(f.p, 1);
  const free = Bank.freeSlots(f.p);
  click(f.p, "bank_filler_all");
  click(f.p, "bank_filler_confirm");
  const ids = Bank.layout(f.p).map((entry) => entry.item.getId());
  assert.deepEqual(ids.slice(0, 3), [I.COINS, I.BONES, I.BANK_FILLER]);
  assert.equal(fillers(f.p).length, free);
});

test("collapsing a tab into a main tab with released gaps puts its items after the main tab's last item", (t) => {
  const I = core.ItemIdentifiers;
  const f = banker(t);
  const main = f.p.getBank(0);
  // The main tab's slot array used to its end, with a gap at the front where a placeholder was released.
  main.setItem(0, new core.Item(I.COINS, 5));
  for (let slot = 1; slot < main.capacity(); slot++) main.setItem(slot, new core.Item(I.BANK_FILLER, 1));
  main.getItems()[0].setId(-1);
  f.p.getBank(1).setItem(0, new core.Item(I.SHARK, 2));
  Bank.collapseTab(f.p, 1);
  const ids = Bank.layout(f.p).map((entry) => entry.item.getId());
  assert.equal(ids.at(-1), I.SHARK, "the shark joins at the end, not in the front gap");
});

const PotionStorage = require("../plugins/interface/banksettings/PotionStorage.BankSettings");
const obj = (name) => core.CacheDefinitions.getObjId(name);
const varp = (name) => core.CacheDefinitions.getVarpId(name);
/** Divine ranging potion is entry 19 of the stored list (enum 4826): subs 95-99 (rsprox 238/04233). */
const DIVINE_RANGING = 19;

function potionBanker(t, setup) {
  const f = banker(t, (p) => {
    p.getPacketSender().sendVarbit(varbit("mm_potion_storage_unlocked"), 1);
    setup?.(p);
  });
  return f;
}

function potionClick(p, sub, op) {
  const widgetId = core.CacheDefinitions.getComponentId("bankmain:potionstore_items");
  const event = { player: p, packet: { widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum: op, slot: sub }, handled: false };
  PM.emitCustomEvent("player:widget-action", event);
  return event.handled;
}

function sideOp(p, slot, op) {
  const item = p.getInventory().getItems()[slot];
  const event = { player: p, item, slot, op, option: undefined, handled: false };
  PM.emitCustomEvent(Bank.INVENTORY_OP_EVENT, event);
  return event.handled;
}

test("Potion Storage: the button opens it (previous tab, bank_currenttab 15) only once unlocked", (t) => {
  const locked = banker(t);
  assert.equal(click(locked.p, "potionstore_button"), false, "not bought from Mastering Mixology");
  const f = potionBanker(t);
  f.varbits.length = 0;
  assert.equal(click(f.p, "potionstore_button"), true);
  assert.deepEqual(f.varbits.slice(-2), [[varbit("potionstore_previous_tab"), 0], [varbit("bank_currenttab"), 15]]);
  assert.equal(PotionStorage.viewing.has(f.p), true);
  click(f.p, "tabs", 11);
  assert.equal(PotionStorage.viewing.has(f.p), false, "a bank tab leaves it");
});

test("Potion Storage: deposits there store doses and a vial each; withdraws give the chosen size as recorded", (t) => {
  const f = potionBanker(t, (p) => {
    const inv = p.getInventory();
    inv.setItem(0, new core.Item(obj("4dosedivinerange"), 1));
    inv.setItem(1, new core.Item(obj("cert_vial_empty"), 13));
    inv.setItem(2, new core.Item(core.ItemIdentifiers.VIAL, 1));
    inv.setItem(3, new core.Item(core.ItemIdentifiers.VIAL, 1));
  });
  click(f.p, "potionstore_button");
  const inv = f.p.getInventory();
  assert.equal(sideOp(f.p, 0, 2), true, "Deposit-1 (default) on the potion");
  assert.equal(inv.getItems()[0].getId(), -1);
  assert.equal(sideOp(f.p, 1, 8), true, "Deposit-All on the noted vials");
  assert.equal(sideOp(f.p, 2, 5), true, "Deposit-10 on the vials: both of them");
  assert.equal(inv.getValidItems().length, 0);
  const saved = PotionStorage.storage(f.p);
  assert.equal(saved.doses.potionstore_divine_ranging_potion, 4);
  assert.equal(saved.vials, 1 + 13 + 2);
  assert.equal(f.p.getPacketSender().getVarp(varp("potionstore_vials")), 16);

  // "3 Dose" (op 8 on the picture), then Withdraw-5 with 4 doses: one 3-dose and the line (rsprox 238/04233 tick 280).
  potionClick(f.p, DIVINE_RANGING * 5 + 1, 8);
  assert.equal(f.p.getPacketSender().getVarbit(varbit("potionstore_vile_size_divine_ranging_potion")), 2);
  potionClick(f.p, DIVINE_RANGING * 5, 3);
  assert.equal(inv.getAmount(obj("3dosedivinerange")), 1);
  assert.deepEqual(f.messages, [PotionStorage.TEXT.noDoses]);
  assert.equal(saved.doses.potionstore_divine_ranging_potion, 1);
  assert.equal(saved.vials, 15);

  // In note mode the Vials text's Withdraw-All gives the vials noted (tick 38).
  f.p.setNoteWithdrawal(true);
  potionClick(f.p, 112 * 5 + 4, 7);
  assert.equal(inv.getAmount(obj("cert_vial_empty")), 15);
  assert.equal(saved.vials, 0);
  potionClick(f.p, DIVINE_RANGING * 5 + 1, 6);
  potionClick(f.p, DIVINE_RANGING * 5, 2);
  assert.equal(f.messages.at(-1), PotionStorage.TEXT.noVials, "no vials, no potion (tick 54)");
  assert.equal(saved.doses.potionstore_divine_ranging_potion, 1);
});

test("Potion Storage: a 1-dose withdraw in note mode is a note; favourites and the saved varps come back on login", (t) => {
  const f = potionBanker(t, (p) => {
    p.setAttribute(PotionStorage.STORAGE_ATTRIBUTE, { doses: { potionstore_divine_ranging_potion: 4 }, sizes: { potionstore_vile_size_divine_ranging_potion: 0 }, vials: 5, favourites: [] });
  });
  click(f.p, "potionstore_button");
  f.p.setNoteWithdrawal(true);
  potionClick(f.p, DIVINE_RANGING * 5, 7);
  assert.equal(f.p.getInventory().getAmount(obj("cert_1dosedivinerange")), 4, "Withdraw-All: four 1-dose notes");
  assert.equal(PotionStorage.storage(f.p).vials, 1);
  PotionStorage.storage(f.p).doses.potionstore_divine_ranging_potion = 4;
  potionClick(f.p, DIVINE_RANGING * 5, 3);
  assert.equal(f.messages.at(-1), PotionStorage.TEXT.fewVials, "1 vial, Withdraw-5: the vials' line (rsprox 238/04233 tick 1632)");
  assert.equal(f.p.getInventory().getAmount(obj("cert_1dosedivinerange")), 5, "and the one the vial allows");
  assert.equal(PotionStorage.storage(f.p).vials, 0);
  potionClick(f.p, DIVINE_RANGING * 5 + 4, 1);
  assert.equal(f.p.getPacketSender().getVarp(varp("potionstore_favourite_1")), obj("1dosedivinerange"));
  potionClick(f.p, DIVINE_RANGING * 5 + 4, 1);
  assert.equal(f.p.getPacketSender().getVarp(varp("potionstore_favourite_1")), -1, "Remove Favourite");
  f.p.getPacketSender().sendConfig(varp("potionstore_divine_ranging_potion"), 0);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.equal(f.p.getPacketSender().getVarp(varp("potionstore_divine_ranging_potion")), 3, "the saved doses sent again");
});

test("Potion Storage: away from it (and the setting off) a potion deposits into the bank; the setting sends it there", (t) => {
  const f = potionBanker(t, (p) => p.getInventory().setItem(0, new core.Item(obj("4dose2defense"), 1)));
  assert.equal(sideOp(f.p, 0, 2), false, "the bank takes it");
  click(f.p, "depositpotion_toggle");
  assert.equal(sideOp(f.p, 0, 2), true, "bank_depositpotion on: into potion storage");
  assert.equal(PotionStorage.storage(f.p).doses.potionstore_super_defence_potion, 4);
});

test("Potion Storage: Deposit inventory there stores the potions (a first deposit sets the size) and banks the rest", (t) => {
  const f = potionBanker(t, (p) => {
    const inv = p.getInventory();
    inv.setItem(0, new core.Item(obj("4dose2combat"), 1));
    inv.setItem(1, new core.Item(obj("4dose2combat"), 1));
    inv.setItem(2, new core.Item(obj("cert_guamvial"), 13));
    inv.setItem(3, new core.Item(core.ItemIdentifiers.COINS, 100));
  });
  click(f.p, "potionstore_button");
  const handled = click(f.p, "depositinv");
  const inv = f.p.getInventory();
  if (!handled) Bank.depositItems(f.p, inv, false);
  const saved = PotionStorage.storage(f.p);
  assert.equal(saved.doses.potionstore_super_combat_potion, 8);
  assert.equal(saved.doses.potionstore_guamvial, 13);
  assert.equal(saved.vials, 2 + 13, "the unfinished potions' vials too (rsprox 238/04233 tick 4556)");
  assert.equal(f.p.getPacketSender().getVarbit(varbit("potionstore_vile_size_super_combat_potion")), 3, "4-dose, as deposited");
  assert.equal(inv.getValidItems().length, 0);
  assert.equal(f.p.getBank(0).getAmount(core.ItemIdentifiers.COINS), 100);
});

function press(p, name, { slot, op = 1 } = {}) {
  const widgetId = core.CacheDefinitions.getComponentId(name);
  const packet = { widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum: op, slot };
  const event = { player: p, packet, handled: false };
  PM.emitCustomEvent("player:widget-action", event);
  return event.handled;
}

test("Deposit Lock Settings opens the lock editor over the bank; its clicks are kept, saved and restored on login", (t) => {
  const f = banker(t);
  const sent = [];
  const sender = f.p.getPacketSender();
  for (const name of ["sendSubInterface", "sendInterfaceFlagsRange", "sendClientScript"]) {
    const original = sender[name].bind(sender);
    t.mock.method(sender, name, (...args) => { sent.push([name, ...args]); return original(...args); });
  }
  const editor = core.CacheDefinitions.getInterfaceId("bank_side_locks");
  assert.equal(press(f.p, "bankmain:locks"), true);
  assert.equal(sender.isSubInterfaceOpen(editor), true);
  // rsprox_transcripts/228/02249.txt tick 215, 229/02520.txt tick 1275: opensub, the slots' events, then 7784.
  assert.deepEqual(sent, [
    ["sendSubInterface", component("popup"), editor, 0],
    ["sendInterfaceFlagsRange", core.CacheDefinitions.getComponentId("bank_side_locks:slots"), 0, 27, 1 << 1],
    ["sendClientScript", 7784, component("popup")],
  ]);
  const overview = varbit("bank_side_slot_overview");
  press(f.p, "bank_side_locks:slots", { slot: 0 });
  press(f.p, "bank_side_locks:slots", { slot: 3 });
  assert.deepEqual(f.varbits.filter(([id]) => id === overview).at(-1), [overview, 0b1001]);
  press(f.p, "bank_side_locks:extraoptions");
  assert.equal(f.p.getAttribute("bank-settings:deposit-lock-ops"), 1);
  press(f.p, "bank_side_locks:ignorelocks");
  press(f.p, "bank_side_locks:slots", { slot: 5 });
  press(f.p, "bank_side_locks:extraoptions");
  assert.equal(f.p.getAttribute("bank-settings:deposit-locks"), 0b1001, "with the locks off a slot doesn't change");
  assert.equal(f.p.getAttribute("bank-settings:deposit-lock-ops"), 1, "nor does the extra op");
  press(f.p, "bank_side_locks:ignorelocks");
  // Done answers resume_countdialog "0" (script 614; 228/02249.txt tick 218).
  answer(f.p, 0);
  assert.equal(sender.isSubInterfaceOpen(editor), false);
  assert.equal(f.p.getEnteredAmountAction(), null);
  press(f.p, "bank_side_locks:slots", { slot: 7 });
  assert.equal(f.p.getAttribute("bank-settings:deposit-locks"), 0b1001, "a closed editor's click does nothing");
  f.varbits.length = 0;
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  assert.ok(f.varbits.some(([id, value]) => id === overview && value === 0b1001), JSON.stringify(f.varbits));
});

test("Deposit inventory leaves locked slots (and their stacks) in the inventory; an item's own Deposit and locks off still bank them", (t) => {
  const { ItemIdentifiers } = core;
  const f = banker(t, (p) => {
    const inventory = p.getInventory();
    inventory.setItem(0, new core.Item(ItemIdentifiers.COINS, 500));
    inventory.setItem(1, new core.Item(ItemIdentifiers.LOBSTER, 1));
    inventory.setItem(2, new core.Item(ItemIdentifiers.LOBSTER, 1));
    p.setAttribute("bank-settings:deposit-locks", 0b101);
  });
  const inventory = f.p.getInventory();
  Bank.depositItems(f.p, inventory, false);
  assert.equal(inventory.getItems()[0].getId(), ItemIdentifiers.COINS, "slot 0 locked");
  assert.equal(inventory.getItems()[0].getAmount(), 500);
  assert.equal(inventory.getItems()[1].getId(), -1, "slot 1 banked");
  assert.equal(inventory.getItems()[2].getId(), ItemIdentifiers.LOBSTER, "slot 2 locked");
  assert.equal(f.p.getBank(0).getAmount(ItemIdentifiers.LOBSTER), 1);
  Bank.deposit(f.p, ItemIdentifiers.LOBSTER, 2, 1, false);
  assert.equal(inventory.getItems()[2].getId(), -1, "Deposit-1 on the locked slot still banks it");
  f.p.setAttribute("bank-settings:deposit-locks-off", 1);
  Bank.depositItems(f.p, inventory, false);
  assert.equal(inventory.getItems()[0].getId(), -1, "locks off: everything goes");
  assert.equal(f.p.getBank(0).getAmount(ItemIdentifiers.COINS), 500);
  assert.deepEqual(f.messages, [], "a locked slot is skipped quietly");
});

test("Deposit worn items is not locked, and the inventory's Lock-slot op (shown with the extra option) flips a slot, empty ones too", (t) => {
  const { ItemIdentifiers } = core;
  const f = banker(t, (p) => {
    p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(ItemIdentifiers.BRONZE_FULL_HELM, 1));
    p.getInventory().setItem(4, new core.Item(ItemIdentifiers.LOBSTER, 1));
    p.setAttribute("bank-settings:deposit-locks", 1 << core.Equipment.HEAD_SLOT);
  });
  Bank.depositItems(f.p, f.p.getEquipment(), false);
  assert.equal(f.p.getEquipment().getItems()[core.Equipment.HEAD_SLOT].getId(), -1);
  const side = (slot) => {
    const packet = { widgetId: (Bank.SIDE_INTERFACE_ID << 16) | Bank.SIDE_ITEMS_CHILD, groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_ITEMS_CHILD, buttonNum: 10, slot };
    const event = { player: f.p, packet, handled: false };
    PM.emitCustomEvent("player:widget-action", event);
    return event.handled;
  };
  f.p.setAttribute("bank-settings:deposit-locks", 0);
  assert.equal(side(4), false, "without the extra option op 10 is Examine");
  f.p.setAttribute("bank-settings:deposit-lock-ops", 1);
  assert.equal(side(4), true);
  assert.equal(side(9), true, "an empty slot");
  assert.equal(f.p.getAttribute("bank-settings:deposit-locks"), (1 << 4) | (1 << 9));
  side(4);
  assert.equal(f.p.getAttribute("bank-settings:deposit-locks"), 1 << 9, "Unlock-slot");
});
