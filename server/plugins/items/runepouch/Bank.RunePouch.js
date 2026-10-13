/**
 * The pouch in the bank (docs/rune-pouch.md). Its op1 in the bank's inventory panel shows the
 * pouch in place of the inventory (bank_viewcontainer 3, or 4 for the divine pouch, and
 * bank_viewcontainer_obj the pouch);
 * op9 empties it into the bank. In the view, a rune's ops bank 1, 5, 10, X or all of it (op1
 * follows the bank's quantity buttons), "Bank all" banks every slot and "Dismiss" goes back to
 * the inventory. Loadouts are in Loadouts.RunePouch.js.
 */
const Pouch = require("./Common.RunePouch");

/** bank_viewcontainer for the pouch, by its slots (captured: 3 for the rune pouch, 4 for the divine). */
const VIEW_BY_SLOTS = { 3: 3, 4: 4 };
const VIEWS = new Set(Object.values(VIEW_BY_SLOTS));
const BANK_SIDE = 15;
const VIEW_OP = 1;
const EMPTY_OP = 9;
const X_PROMPT_OP = 6;
const AMOUNT_PROMPT = "Enter amount:";
/** bank_requestedquantity: the bank's remembered X. */
const BANK_X_VARBIT = 3960;
/** OP1-OP7, OP10, DEPTH1, DRAGTARGET on the pouch's slots (captured). */
const POUCH_SLOT_FLAGS = 0b11111110 | (1 << 10) | (1 << 17) | (1 << 20);
const LOADOUT_SLOT_FLAGS = 1 << 1;
const NAME_LIST_FLAGS = (1 << 1) | (1 << 20);
/** The loadout name rows: row i of the list is enum 5864's i-th name, after one background per row. */
const NAME_ORDER_ENUM = 5864;
const LOADOUTS = "abcdefghij";

let COMPONENT = null;

function components() {
  COMPONENT ??= {
    top: Pouch.component("bankside:runepouch_top"),
    bankAll: Pouch.component("bankside:runepouch_bankall"),
    dismiss: Pouch.component("bankside:runepouch_dismiss"),
    nameList: Pouch.component("bankside:runepouch_name_select_list"),
    loadouts: [...LOADOUTS].map((letter) => Pouch.component(`bankside:runepouch_loadout_${letter}`)),
  };
  return COMPONENT;
}

function viewing(player) {
  const { Bank } = Pouch.core;
  return Bank.isOpen(player) && VIEWS.has(player.getPacketSender().getVarbit(Bank.VIEW_CONTAINER_VARBIT));
}

function nameRows() {
  return Pouch.core.CacheDefinitions.getEnumValues(NAME_ORDER_ENUM).size;
}

function openView(player, pouch) {
  const { Bank } = Pouch.core;
  const sender = player.getPacketSender();
  const { top, nameList, loadouts } = components();
  const slots = Pouch.slotCount(player, pouch);
  Pouch.setVarbit(player, Bank.VIEW_CONTAINER_VARBIT, VIEW_BY_SLOTS[slots]);
  sender.sendConfig(Bank.VIEW_CONTAINER_OBJ_VARP, pouch.getId());
  sender.sendInterfaceFlagsRange(top, 1, slots, POUCH_SLOT_FLAGS);
  sender.sendInterfaceFlagsRange(nameList, nameRows(), nameRows() * 2 - 1, NAME_LIST_FLAGS);
  for (const loadout of loadouts) sender.sendInterfaceFlagsRange(loadout, 1, slots, LOADOUT_SLOT_FLAGS);
}

function dismiss(player) {
  const { Bank } = Pouch.core;
  Pouch.setVarbit(player, Bank.VIEW_CONTAINER_VARBIT, 0);
  player.getPacketSender().sendConfig(Bank.VIEW_CONTAINER_OBJ_VARP, -1);
}

/** Moves up to `amount` of a slot into the bank. */
function bankSlot(player, slot, amount) {
  const taken = Pouch.take(player, slot, amount);
  if (!taken) return;
  Pouch.addToBank(player, taken.id, taken.amount);
}

/** Every slot into the bank: the pouch's own op9 in the bank, and "Bank all" in the view. */
function bankAll(player) {
  if (Pouch.isEmpty(player)) {
    player.sendMessage(Pouch.MESSAGE.EMPTY);
    return;
  }
  Pouch.slots(player).forEach((entry, slot) => {
    if (entry) bankSlot(player, slot, entry.amount);
  });
  Pouch.refreshBank(player);
}

/** An op on the pouch in the bank's inventory panel: View and Empty are the pouch's, the rest deposit. */
function inventoryOp(event) {
  if (!Pouch.isPouch(event.item)) return;
  if (event.op === VIEW_OP) openView(event.player, event.item);
  else if (event.op === EMPTY_OP) bankAll(event.player);
  else return;
  event.handled = true;
}

/** A rune in the view: the bank's withdraw amounts, banked rather than withdrawn. */
function clickPouchSlot(player, event) {
  const { Bank } = Pouch.core;
  const slot = event.slot - 1;
  const entry = Pouch.slots(player)[slot];
  if (!entry) return;
  const op = Number(event.action);
  // The client asks for Withdraw-X itself and sends the amount first; any other X op asks here.
  if (op === X_PROMPT_OP && !/-x$/i.test(event.option ?? "")) {
    Pouch.askAmount(player, AMOUNT_PROMPT, {
      execute(amount) {
        if (!(amount > 0)) return;
        player.setBankCustomQuantity(amount);
        player.getPacketSender().sendVarbit(BANK_X_VARBIT, amount);
        if (viewing(player)) {
          bankSlot(player, slot, amount);
          Pouch.refreshBank(player);
        }
      },
    });
    return;
  }
  const amount = Bank.actionAmount("withdraw", op, event.option, entry.amount,
    player.getBankCustomQuantity(), player.getBankQuantityMode());
  if (amount <= 0) return;
  bankSlot(player, slot, amount);
  Pouch.refreshBank(player);
}

function click(event) {
  if (event.groupId !== BANK_SIDE) return;
  const { top, bankAll: bankAllButton, dismiss: dismissButton } = components();
  const buttonId = (event.groupId << 16) | event.childId;
  if (buttonId !== top && buttonId !== bankAllButton && buttonId !== dismissButton) return;
  event.handled = true;
  const { player } = event;
  if (!viewing(player)) return;
  if (buttonId === dismissButton) dismiss(player);
  else if (buttonId === bankAllButton) bankAll(player);
  else if (Number.isInteger(event.slot)) clickPouchSlot(player, event);
}

/** Closing the bank closes a pouch view or loadout prompt left open in the chatbox. */
function closed({ player, interfaceId }) {
  if (interfaceId === Pouch.core.Bank.MAIN_INTERFACE_ID) Pouch.closePrompt(player);
}

module.exports = function attach(api) {
  api.onCustomEvent(Pouch.core.Bank.INVENTORY_OP_EVENT, inventoryOp);
  api.onCustomEvent("interface:closed", closed);
  api.onInterfaceActionClick(click);
};

module.exports._test = { openView, dismiss, bankAll, inventoryOp, click, viewing };
module.exports.viewing = viewing;
module.exports.LOADOUTS = LOADOUTS;
module.exports.NAME_ORDER_ENUM = NAME_ORDER_ENUM;
