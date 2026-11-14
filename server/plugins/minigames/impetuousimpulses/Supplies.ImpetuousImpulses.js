"use strict";

/**
 * Anchovy oil: eight anchovy paste, an empty vial and a sieve (docs/impetuous-impulses.md).
 * - Paste on the sieve, carrying a vial: rsprox capture rec 468 (rev 233) tick 4567: 8 paste
 *   and the vial go, the oil goes into the first free slot, no message, animation or sound.
 * - Sieve on the paste with too few: rec 468 tick 4686, "You need 8 lots of anchovy paste to
 *   make anchovy oil." Ours: with eight it makes the oil like paste on the sieve.
 * - Paste on the vial, carrying a sieve: Wiki "Anchovy oil" (rev 15186565). The Wiki says no
 *   other order works, which rec 468 contradicts for the sieve. Vial on paste does nothing.
 */
const PASTE_NEEDED = 8;
const TOO_FEW = "You need 8 lots of anchovy paste to make anchovy oil.";
// Ours: no capture of a missing sieve or vial.
const NO_SIEVE = "You need a sieve to make anchovy oil.";
const NO_VIAL = "You need an empty vial to make anchovy oil.";

let core;
function restricted(item) {
  const { Item } = core;
  return item.isPresetItem?.() === true || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

/** Which slot of the pair holds the paste and which tool it is used with, or null. */
function pairing(event) {
  const I = core.ItemIdentifiers;
  const { usedItemId: used, usedWithItemId: target } = event;
  if (used === I.ANCHOVY_PASTE && (target === I.VIAL || target === I.SIEVE)) {
    return { pasteSlot: event.usedItemSlot, paste: event.usedItem, tool: target, toolSlot: event.usedWithItemSlot, toolItem: event.usedWithItem };
  }
  if (used === I.SIEVE && target === I.ANCHOVY_PASTE) {
    return { pasteSlot: event.usedWithItemSlot, paste: event.usedWithItem, tool: I.SIEVE, toolSlot: event.usedItemSlot, toolItem: event.usedItem };
  }
  return null;
}

function firstSlotOf(items, id, skip) {
  return items.findIndex((item, slot) => slot !== skip && item?.getId() === id);
}

function makeOil(event) {
  if (event.handled) return;
  const pair = pairing(event);
  if (!pair) return;
  event.handled = true;
  const I = core.ItemIdentifiers;
  const { player } = event;
  const inventory = player.getInventory();
  const items = inventory.getItems();
  if (items[pair.pasteSlot] !== pair.paste || items[pair.toolSlot] !== pair.toolItem
    || pair.paste?.getId() !== I.ANCHOVY_PASTE || pair.toolItem?.getId() !== pair.tool) return;
  const vialSlot = pair.tool === I.VIAL ? pair.toolSlot : firstSlotOf(items, I.VIAL, pair.pasteSlot);
  const vial = vialSlot >= 0 ? items[vialSlot] : null;
  if (restricted(pair.paste) || (vial && restricted(vial))) { player.sendMessage("Preset items cannot be used for this."); return; }
  if (pair.paste.getAmount() < PASTE_NEEDED) { player.sendMessage(TOO_FEW); return; }
  if (pair.tool === I.VIAL && !inventory.contains(I.SIEVE)) { player.sendMessage(NO_SIEVE); return; }
  if (!vial) { player.sendMessage(NO_VIAL); return; }
  inventory.deleteAtSlot(pair.pasteSlot, PASTE_NEEDED, false);
  inventory.deleteAtSlot(vialSlot, 1, false);
  inventory.addItem(new core.Item(I.ANCHOVY_OIL, 1));
}

module.exports = function attach(api) {
  core = api.core;
  api.onItemOnItem(makeOil, { noted: false });
};
