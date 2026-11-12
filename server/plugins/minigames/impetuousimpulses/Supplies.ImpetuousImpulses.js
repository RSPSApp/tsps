"use strict";

// Wiki: Anchovy oil, revision 15186565: use eight paste on a vial while carrying a sieve.
let core;
function restricted(item) {
  const { Item } = core;
  return item.isPresetItem?.() === true || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}
function makeOil(event) {
  const I = core.ItemIdentifiers;
  if (event.handled || event.usedItemId !== I.ANCHOVY_PASTE || event.usedWithItemId !== I.VIAL) return;
  event.handled = true;
  const { player, usedItem: paste, usedWithItem: vial, usedItemSlot, usedWithItemSlot } = event;
  const inventory = player.getInventory();
  if (inventory.getItems()[usedItemSlot] !== paste || inventory.getItems()[usedWithItemSlot] !== vial
    || paste?.getId() !== I.ANCHOVY_PASTE || vial?.getId() !== I.VIAL) return;
  if (restricted(paste) || restricted(vial)) { player.sendMessage("Preset items cannot be used for this."); return; }
  if (!inventory.contains(I.SIEVE) || paste.getAmount() < 8) {
    player.sendMessage("You need eight anchovy paste and a sieve to make anchovy oil.");
    return;
  }
  inventory.deleteAtSlot(usedItemSlot, 8, false);
  vial.setId(I.ANCHOVY_OIL);
  inventory.refreshItems();
}
module.exports = function attach(api) {
  core = api.core;
  api.onItemOnItem(makeOil, { noted: false });
};
