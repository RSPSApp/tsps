"use strict";

/**
 * The storage interface's buttons and drags (component names from the cache's gamevals). Item ops
 * are the cache's (shared_bank_drawitem / shared_bank_side_drawitem): 1 the default quantity, 2-4
 * one, five and ten, 5 the remembered X, 6 "-X" (asks), 7 All, 8 "All-but-1" (withdraw only),
 * 10 Examine. The default, X, note and insert mode are the bank's settings, set here as the bank
 * sets them. Search is the client's own (shared_bank_search_toggle).
 *
 * The bank's own Group Storage button (bankmain:gim_storage op 1, or op 2 of
 * bankmain:popup_button_out when the bank shows its storage pop-up) opens the storage for a Group
 * Ironman; shared_bank:main_bank's "Back to bank" returns to the bank.
 */

const Items = require("./Items.GroupStorage");
const Session = require("./Session.GroupStorage");
const View = require("./View.GroupStorage");
const Access = require("./Access.GroupStorage");

const { MAX_AMOUNT } = Items;
const EXAMINE_OP = 10;
const X_PROMPT = "Enter amount:";
/** bankmain's quantity buttons in order: 1, 5, 10, X, All (bank_quantity_type 0-4). */
const QUANTITY_BUTTONS = ["quantity1", "quantity5", "quantity10", "quantityx", "quantityall"];
const QUANTITY_X_MODE = 3;
const UNLOCKS_UNAVAILABLE = "Storage unlocks aren't available on this world: the group storage has its first 80 spaces.";

let api;

function init(pluginApi) {
  api = pluginApi;
}

/** The amount an op means, with the player's bank settings; 0 for "ask". */
function amountFor(player, op, held) {
  const custom = player.getBankCustomQuantity();
  const preset = [1, 5, 10, custom, MAX_AMOUNT][player.getBankQuantityMode()] ?? 1;
  switch (op) {
    case 1: return preset;
    case 2: return 1;
    case 3: return 5;
    case 4: return 10;
    case 5: return custom;
    case 7: return MAX_AMOUNT;
    case 8: return Math.max(0, held - 1);
    default: return 0;
  }
}

/** Runs a move on the copies, marks the session edited when something moved, and says any refusal. */
function apply(player, session, result) {
  if (result.moved > 0) session.edited = true;
  if (result.message) player.getPacketSender().sendMessage(result.message);
  View.refresh(player, session);
}

function withdraw(player, session, slot, amount) {
  if (session.access !== Session.ACCESS.FULL) {
    player.getPacketSender().sendMessage(Access.MESSAGE.DEPOSIT_ONLY);
    return;
  }
  apply(player, session, Items.withdraw(session, slot, amount, player.withdrawAsNote(), Access.membersWorld()));
}

function deposit(player, session, slot, amount) {
  apply(player, session, Items.deposit(session, slot, amount, Access.membersWorld()));
}

/** Asks for X, remembers it as the bank does, then runs `then` with it if the session still stands. */
function askAmount(player, session, then) {
  const action = {
    acceptsZero: true,
    execute(amount) {
      if (player.getEnteredAmountAction() !== action) return;
      player.setEnteredAmountAction(null);
      if (Access.live(player) !== session || !Number.isSafeInteger(amount) || amount <= 0) return;
      player.setBankCustomQuantity(Math.min(MAX_AMOUNT, amount));
      player.getPacketSender().sendVarbit(View.varbit("bank_requestedquantity"), player.getBankCustomQuantity());
      if (then) then(player.getBankCustomQuantity());
    },
  };
  player.setEnteredAmountAction(action);
  player.getPacketSender().sendEnterAmountPrompt(X_PROMPT);
}

function itemOp(player, session, slot, op, stored) {
  const work = stored ? session.storage : session.inventory;
  if (!Number.isInteger(slot) || slot < 0 || slot >= work.length || !work[slot]) return;
  const item = stored ? work[slot] : { id: work[slot].getId(), amount: work[slot].getAmount() };
  if (op === EXAMINE_OP) {
    api.core.ExaminePrice.examineItem(player, item.id, item.amount);
    return;
  }
  const move = stored ? withdraw : deposit;
  if (op === 6) {
    askAmount(player, session, (amount) => move(player, session, slot, amount));
    return;
  }
  const amount = amountFor(player, op, item.amount);
  if (amount > 0) move(player, session, slot, amount);
  else if (op === 1 || op === 5) askAmount(player, session, (asked) => move(player, session, slot, asked));
}

function setting(player, name, op) {
  const sender = player.getPacketSender();
  if (name === "swap_insert") {
    player.setInsertMode(!player.insertModeReturn());
    sender.sendVarbit(View.varbit("bank_insertmode"), player.insertModeReturn() ? 1 : 0);
  } else if (name === "note") {
    player.setNoteWithdrawal(!player.withdrawAsNote());
    sender.sendVarbit(View.varbit("bank_withdrawnotes"), player.withdrawAsNote() ? 1 : 0);
  } else if (name === "quantityx" && op === 2) {
    askAmount(player, Session.current(player), null);
  } else {
    player.setBankQuantityMode(QUANTITY_BUTTONS.indexOf(name));
    sender.sendVarbit(View.varbit("bank_quantity_type"), player.getBankQuantityMode());
    if (name === "quantityx" && player.getBankCustomQuantity() <= 0) askAmount(player, Session.current(player), null);
  }
}

/** onInterfaceActionClick: everything on shared_bank and shared_bank_side. */
function click(event) {
  const { player, buttonId, slot, action } = event;
  const groupId = buttonId >>> 16;
  if (groupId !== View.MAIN() && groupId !== View.SIDE()) return;
  event.handled = true;
  const session = Access.live(player);
  if (!session || !Number.isInteger(action)) return;
  const name = componentName(buttonId);
  if (groupId === View.SIDE()) {
    if (name === "items") itemOp(player, session, slot, action, false);
    return;
  }
  switch (name) {
    case "items": return itemOp(player, session, slot, action, true);
    case "depositinv": return apply(player, session, Items.depositAll(session, Access.membersWorld()));
    case "compress": {
      Items.compress(session);
      session.edited = true;
      return View.refresh(player, session);
    }
    case "save_button": return void Access.save(player, false);
    case "main_bank": return void Access.backToBank(player);
    case "close": return void Access.save(player, true);
    case "storage_unlocks": return void player.getPacketSender().sendMessage(UNLOCKS_UNAVAILABLE);
    case "swap_insert": case "note": return setting(player, name, action);
    default:
      if (QUANTITY_BUTTONS.includes(name)) setting(player, name, action);
  }
}

const BUTTONS = ["items", "depositinv", "compress", "save_button", "close", "main_bank", "storage_unlocks", "swap_insert", "note",
  ...QUANTITY_BUTTONS];

/** The shared_bank / shared_bank_side component's gameval name ("items") from its id. */
function componentName(buttonId) {
  if (buttonId >>> 16 === View.SIDE()) return buttonId === View.uid("shared_bank_side:items") ? "items" : "";
  return BUTTONS.find((name) => View.uid(`shared_bank:${name}`) === buttonId) ?? "";
}

/** The bank's Group Storage button, for a Group Ironman; anyone else's click is the bank's. */
function bankButton(event) {
  const { player, packet } = event;
  const storage = packet.widgetId === View.uid("bankmain:gim_storage") && packet.buttonNum === 1;
  const popup = packet.widgetId === View.uid("bankmain:popup_button_out") && packet.buttonNum === 2;
  if (!(storage || popup) || !Access.isGroupIronman(player)) return;
  event.handled = true;
  Access.openFromBank(player);
}

/** "player:widget-action": the bank's button, and dragging within the storage or the side panel. */
function drag(event) {
  const { player, packet } = event;
  if (packet?.type === "widget_action") return bankButton(event);
  if (packet?.type !== "widget_drag") return;
  const source = packet.sourceWidgetId >>> 16;
  if (source !== View.MAIN() && source !== View.SIDE()) return;
  event.handled = true;
  const session = Access.live(player);
  if (!session || packet.sourceWidgetId !== packet.targetWidgetId) return;
  const stored = source === View.MAIN();
  const length = stored ? session.storage.length : session.inventory.length;
  const { sourceSlot: from, targetSlot: to } = packet;
  if (![from, to].every((n) => Number.isInteger(n) && n >= 0 && n < length)) return;
  const moved = stored
    ? Items.moveStored(session, from, to, player.insertModeReturn())
    : Items.moveHeld(session, from, to);
  if (moved) session.edited = true;
  View.refresh(player, session);
}

module.exports = { QUANTITY_BUTTONS, UNLOCKS_UNAVAILABLE, init, amountFor, click, drag };
