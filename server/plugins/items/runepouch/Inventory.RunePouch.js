/**
 * The pouch in the inventory (docs/rune-pouch.md): using a rune on it stores the whole stack
 * that fits, "Empty" puts every rune back in the inventory, and spells take the runes the
 * inventory is short of from it. Login sends the pouch's varbits, which the spellbook, the
 * pouch interface and the bank's pouch view all read.
 */
const Pouch = require("./Common.RunePouch");

/** Captured: no prompt, every rune of the stack that fits goes in on the same tick. */
function useRuneOnPouch(event) {
  const { player, usedItem, usedWithItem } = event;
  const pouch = Pouch.isPouch(usedItem) ? usedItem : Pouch.isPouch(usedWithItem) ? usedWithItem : null;
  const rune = pouch === usedItem ? usedWithItem : usedItem;
  if (!pouch || !Pouch.isRune(rune?.getId?.())) return;
  event.handled = true;
  const runeId = rune.getId();
  const inventory = player.getInventory();
  const moved = Pouch.store(player, runeId, inventory.getAmount(runeId));
  if (moved <= 0) {
    player.sendMessage(Pouch.MESSAGE.CANT_HOLD);
    return;
  }
  inventory.deleteNumber(runeId, moved);
  inventory.refreshItems();
}

/**
 * Captured: every slot is cleared into the inventory. With the bank open, or with no room,
 * "It was not possible to empty the pouch." Runes with no room stay in the pouch.
 */
function empty({ player }) {
  const { Bank } = Pouch.core;
  if (Bank.isOpen(player)) {
    player.sendMessage(Pouch.MESSAGE.CANT_EMPTY);
    return true;
  }
  if (Pouch.isEmpty(player)) {
    player.sendMessage(Pouch.MESSAGE.EMPTY);
    return true;
  }
  let stuck = false;
  Pouch.slots(player).forEach((entry, slot) => {
    if (!entry) return;
    if (!Pouch.inventoryFits(player, entry.id)) {
      stuck = true;
      return;
    }
    const taken = Pouch.take(player, slot, entry.amount);
    Pouch.addToInventory(player, taken.id, taken.amount);
  });
  if (stuck) player.sendMessage(Pouch.MESSAGE.CANT_EMPTY);
  return true;
}

/** True when the carried pouch holds the whole shortfall the inventory could not cover. */
function checkSpellRunes(player, missingItems) {
  if (!Pouch.findPouch(player)) return false;
  return missingItems.every((item) => Pouch.amountOf(player, item.getId()) >= item.getAmount());
}

function consumeSpellRunes(player, missingItems) {
  if (!checkSpellRunes(player, missingItems)) return;
  for (const item of missingItems) Pouch.spend(player, item.getId(), item.getAmount());
}

function login({ player }) {
  Pouch.login(player);
}

module.exports = function attach(api) {
  api.persistAttribute(Pouch.RUNES_ATTRIBUTE);
  api.persistAttribute(Pouch.SELECTED_QUANTITY_ATTRIBUTE);
  api.persistAttribute(Pouch.CUSTOM_QUANTITY_ATTRIBUTE);
  api.onPlayerLogin(login);
  api.onItemOnItem(useRuneOnPouch);
  for (const { name } of Pouch.POUCHES) api.onItemAction(name, { Empty: empty });
  api.registerSpellRuneSource({ check: checkSpellRunes, consume: consumeSpellRunes });
};

module.exports._test = { useRuneOnPouch, empty, checkSpellRunes, consumeSpellRunes };
