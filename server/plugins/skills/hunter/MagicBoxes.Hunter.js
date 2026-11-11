"use strict";

// The imp-in-a-box. Use it on an inventory item, or pick "Bank" to open its "Imp Release
// Negotiation Form" (bank_deposit_imp, widget 478, inventory in child 3), and the imp banks up to
// two items or stacks. https://oldschool.runescape.wiki/w/Imp-in-a-box lists where it refuses
// (Wilderness above level 30, Tele Block) and what it will not carry. The form opening on the
// "Bank" click is rsprox recording 2256.
const { H, exchange } = require("./Context.Hunter");

const FORM_INTERFACE = 478; // bank_deposit_imp
const FORM_INVENTORY_UID = (FORM_INTERFACE << 16) | 3; // bank_deposit_imp:inventory
const FORM_FLAGS = 0x402; // Op1 (Deposit) and Op10 (Examine), as the capture's if_setevents
const OP_DEPOSIT = 1, OP_EXAMINE = 10;
const CAN_BANK_SOURCE = "imp-in-a-box";
/** Items the Wiki lists the imp refusing; it says "including", so this is the listed part only. */
const REFUSED = new Set(["looting bag", "karamjan rum", "bloated toad", "glowing fungus", "gnomeball",
  "skeletal gorilla bones", "book of knowledge", "book of arcane knowledge", "ana in a barrel",
  "plague sample", "jim's wet cloth"]);
/**
 * Listed items whose name other items share: the Wiki links one item each, and only those pages
 * say "cannot be banked with an imp-in-a-box". The Stick is 4179 (not 9702 or 25285), the
 * Unholy symbol Icthlarin's Little Helper's 4683 (not the Zamorak symbol, 1724).
 */
const REFUSED_IDS = ["STICK", "UNHOLY_SYMBOL_3"];

function isBox(id) {
  const I = H.core.ItemIdentifiers;
  return id === I.IMP_IN_A_BOX_2_ || id === I.IMP_IN_A_BOX_1_;
}

function heldBox(player) {
  return player.getInventory().getItems().find(item => item && isBox(item.getId()))?.getId() ?? -1;
}

/** The imp's refusals that do not depend on the item. */
function blocked(player) {
  if (H.core.TeleBlock.isBlocked(player)) player.sendMessage("The imp refuses to bank while you are teleblocked.");
  else if (player.getWildernessLevel() > 30) player.sendMessage("The imp refuses to bank from this deep in the Wilderness.");
  else return H.api.emitCanBank(player, CAN_BANK_SOURCE) === false;
  return true;
}

function refuses(player, itemId) {
  const I = H.core.ItemIdentifiers;
  const name = H.core.ItemDefinition.forId(itemId)?.getName?.()?.toLowerCase();
  if ([I.MAGIC_BOX, I.IMP_IN_A_BOX_2_, I.IMP_IN_A_BOX_1_, ...REFUSED_IDS.map(key => I[key])].includes(itemId)
    || REFUSED.has(name)) {
    player.sendMessage("The imp refuses to bank that.");
    return true;
  }
  return blocked(player);
}

/** Banks the stack in `slot`; true when the imp delivered it. */
function bankSlot(player, slot) {
  const box = heldBox(player), item = player.getInventory().getItems()[slot];
  if (box < 0 || !item) return false;
  const itemId = item.getId();
  if (refuses(player, itemId)) return false;
  const I = H.core.ItemIdentifiers, next = box === I.IMP_IN_A_BOX_2_ ? I.IMP_IN_A_BOX_1_ : I.MAGIC_BOX;
  if (!exchange(player, [[box, 1]], [[next, 1]], false)) return false;
  const before = player.getInventory().getAmount(itemId);
  H.core.Bank.deposit(player, itemId, slot, item.getAmount(), true);
  if (player.getInventory().getAmount(itemId) >= before) return false;
  exchange(player, [[box, 1]], [[next, 1]]);
  player.sendMessage(next === I.MAGIC_BOX ? "The imp banks your item and escapes." : "The imp banks your item. It will deliver one more item or stack.");
  return true;
}

function use(event) {
  const pair = [event.usedItemId, event.usedWithItemId], box = pair.find(isBox);
  if (!box) return;
  event.handled = true;
  const itemId = pair[0] === box ? pair[1] : pair[0];
  const slot = event.player.getInventory().getItems().findIndex(item => item?.getId() === itemId);
  if (slot >= 0) bankSlot(event.player, slot);
}

/** "Bank": the negotiation form listing the inventory. */
function open({ player }) {
  if (blocked(player)) return true;
  const sender = player.getPacketSender();
  sender.sendInterface(FORM_INTERFACE);
  sender.sendInterfaceFlagsRange(FORM_INVENTORY_UID, 0, 27, FORM_FLAGS);
  sender.clearItemOnInterface(FORM_INVENTORY_UID);
  sender.sendItemContainer(player.getInventory(), FORM_INVENTORY_UID);
  return true;
}

function formClick(event) {
  const { player, slot } = event, op = event.opId ?? event.action;
  if (player.getInterfaceId?.() !== FORM_INTERFACE) return true;
  if (op === OP_EXAMINE) {
    const definition = player.getInventory().getItems()[slot]?.getDefinition?.();
    if (definition) player.sendMessage(definition.getExamine?.() || definition.getName());
  } else if (op === OP_DEPOSIT) {
    bankSlot(player, slot);
  }
  refreshForm(player);
  return true;
}

function refreshForm(player) {
  if (heldBox(player) < 0) player.getPacketSender().closeInterface(FORM_INTERFACE);
  else {
    player.getPacketSender().clearItemOnInterface(FORM_INVENTORY_UID);
    player.getPacketSender().sendItemContainer(player.getInventory(), FORM_INVENTORY_UID);
  }
}

function explain({ player }) {
  player.sendMessage("Use an imp-in-a-box on an inventory item to send that item or stack to your bank.");
  return true;
}

function release({ player, itemId }) {
  const I = H.core.ItemIdentifiers;
  if (!isBox(itemId)) return false;
  if (exchange(player, [[itemId, 1]], [[I.MAGIC_BOX, 1]])) player.sendMessage("You release the imp.");
  return true;
}

module.exports = { FORM_INVENTORY_UID, use, open, formClick, explain, release };
