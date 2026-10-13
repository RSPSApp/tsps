/**
 * The pouch's "Open" interface (rune_pouch, 190) as captured: the server sets the slot count
 * (if1), busy, an op-less overlay on the inventory tab and opens 190 as the main modal; the
 * cache scripts draw the pouch from its varbits and the inventory from inv 93.
 *
 * Clicking a rune moves the amount the quantity buttons pick (1, 5, All or X); its other ops
 * are 1, 5, X (the remembered amount), X (asks for one) and All. Closing it puts the
 * inventory tab back.
 */
const Pouch = require("./Common.RunePouch");

const RUNE_POUCH = 190;
const MAIN_MODAL_UID = (161 << 16) | 16;
const INVENTORY_TAB_UID = (161 << 16) | 79;
const INVENTORY = 149;
const INVOVERLAY_NOOPS = 907;
const BUSY_VARBIT = 12393;
const TOPLEVEL_MAINMODAL_OPEN_SCRIPT = 2524;
const TOPLEVEL_SIDEBUTTON_SWITCH_SCRIPT = 915;
const INVENTORY_TAB = 3;
const INVENTORY_SLOTS = 28;
/** OP1-OP6, OP10 and DRAGTARGET, with the depth each list was captured with. */
const OPS = (0b1111110) | (1 << 10) | (1 << 20);
const POUCH_FLAGS = OPS | (3 << 17);
const INVENTORY_FLAGS = OPS | (2 << 17);
const POUCH_LIST_SLOTS = 6;
const QUANTITY_PROMPT = "Enter amount: (1 - 16,000)";
const AMOUNT_PROMPT = "Enter amount:";
/** rune_pouch_selectedquantity values. */
const MODE = { ONE: 0, FIVE: 1, ALL: 2, X: 3 };

let COMPONENT = null;

function components() {
  COMPONENT ??= {
    pouch: Pouch.component("rune_pouch:pouch"),
    inventory: Pouch.component("rune_pouch:inventory"),
    one: Pouch.component("rune_pouch:1"),
    five: Pouch.component("rune_pouch:5"),
    x: Pouch.component("rune_pouch:x"),
    all: Pouch.component("rune_pouch:all"),
  };
  return COMPONENT;
}

function isOpen(player) {
  return player.getInterfaceId?.() === RUNE_POUCH;
}

function open({ player, item }) {
  if (player.busy?.()) player.getPacketSender().sendInterfaceRemoval();
  const sender = player.getPacketSender();
  const { pouch, inventory } = components();
  Pouch.sendPouchSlots(player, item);
  sender.sendVarbit(BUSY_VARBIT, 1);
  sender.sendSubInterface(INVENTORY_TAB_UID, INVOVERLAY_NOOPS, 1);
  sender.sendClientScript(TOPLEVEL_MAINMODAL_OPEN_SCRIPT, -1, -1);
  player.setInterfaceId(RUNE_POUCH);
  sender.sendSubInterface(MAIN_MODAL_UID, RUNE_POUCH, 0);
  sender.sendInterfaceFlagsRange(pouch, 0, POUCH_LIST_SLOTS - 1, POUCH_FLAGS);
  sender.sendInterfaceFlagsRange(inventory, 0, INVENTORY_SLOTS - 1, INVENTORY_FLAGS);
  return true;
}

function closed({ player, interfaceId }) {
  if (interfaceId !== RUNE_POUCH) return;
  Pouch.closePrompt(player);
  player.getPacketSender()
    .sendSubInterface(INVENTORY_TAB_UID, INVENTORY, 1)
    .sendClientScript(TOPLEVEL_SIDEBUTTON_SWITCH_SCRIPT, INVENTORY_TAB);
}

// ------------------------------------------------------------------ amounts

/** The amount an op moves; null for the op that asks for one. */
function opAmount(player, op) {
  const custom = Pouch.customQuantity(player);
  if (op === 1) return [1, 5, Infinity, custom][Pouch.selectedQuantity(player)] ?? 1;
  return { 2: 1, 3: 5, 4: custom, 6: Infinity }[op] ?? null;
}

/** Op5 asks for an amount, which becomes the remembered X, then moves it. */
function askAmount(player, then) {
  Pouch.askAmount(player, AMOUNT_PROMPT, {
    execute(amount) {
      const value = Math.min(Pouch.MAX_AMOUNT, Math.max(1, Math.floor(amount)));
      Pouch.setCustomQuantity(player, value);
      if (isOpen(player)) then(value);
    },
  });
}

function withdraw(player, slot, amount) {
  const entry = Pouch.slots(player)[slot];
  if (!entry || !(amount > 0)) return;
  if (!Pouch.inventoryFits(player, entry.id)) {
    player.sendMessage(Pouch.MESSAGE.NO_SPACE);
    return;
  }
  const taken = Pouch.take(player, slot, amount);
  if (taken) Pouch.addToInventory(player, taken.id, taken.amount);
}

function deposit(player, runeId, amount) {
  const inventory = player.getInventory();
  const moved = Pouch.store(player, runeId, Math.min(amount, inventory.getAmount(runeId)));
  if (moved <= 0) {
    player.sendMessage(Pouch.MESSAGE.CANT_HOLD);
    return;
  }
  inventory.deleteNumber(runeId, moved);
  inventory.refreshItems();
}

// ------------------------------------------------------------------ clicks

function clickPouchSlot(player, slot, op) {
  if (!Pouch.slots(player)[slot]) return;
  if (op === 5) return askAmount(player, (amount) => withdraw(player, slot, amount));
  withdraw(player, slot, opAmount(player, op));
}

function clickInventorySlot(player, slot, op, itemId) {
  const item = player.getInventory().getItems()[slot];
  if (!item || item.getId() !== itemId) return;
  if (!Pouch.isRune(itemId)) return;
  if (op === 5) return askAmount(player, (amount) => deposit(player, itemId, amount));
  deposit(player, itemId, opAmount(player, op));
}

/** X: op1 picks it (asking first while no amount is set), op2 "Set custom quantity". */
function clickX(player, op) {
  if (op === 1 && Pouch.customQuantity(player) > 0) {
    Pouch.setSelectedQuantity(player, MODE.X);
    return;
  }
  Pouch.askAmount(player, QUANTITY_PROMPT, {
    execute(amount) {
      Pouch.setCustomQuantity(player, Math.min(Pouch.MAX_AMOUNT, Math.max(1, Math.floor(amount))));
      Pouch.setSelectedQuantity(player, MODE.X);
    },
  });
}

function click(event) {
  if (event.groupId !== RUNE_POUCH) return;
  const { player } = event;
  event.handled = true;
  if (!isOpen(player) || !Pouch.findPouch(player)) return;
  const op = Number(event.action);
  const buttonId = (event.groupId << 16) | event.childId;
  const { pouch, inventory, one, five, x, all } = components();
  if (buttonId === pouch && Number.isInteger(event.slot)) clickPouchSlot(player, event.slot, op);
  else if (buttonId === inventory && Number.isInteger(event.slot)) clickInventorySlot(player, event.slot, op, event.itemId);
  else if (buttonId === one) Pouch.setSelectedQuantity(player, MODE.ONE);
  else if (buttonId === five) Pouch.setSelectedQuantity(player, MODE.FIVE);
  else if (buttonId === all) Pouch.setSelectedQuantity(player, MODE.ALL);
  else if (buttonId === x) clickX(player, op);
}

module.exports = function attach(api) {
  for (const { name } of Pouch.POUCHES) api.onItemAction(name, { Open: open });
  api.onInterfaceActionClick(click);
  api.onCustomEvent("interface:closed", closed);
};

module.exports._test = { open, click, opAmount, MODE };
