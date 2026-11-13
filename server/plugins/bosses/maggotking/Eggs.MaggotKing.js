"use strict";

const Common = require("./Common.MaggotKing");

// Jagex, The Blood Moon Rises & Bank Tags Tweaks (15 July 2026), Maggot Eggs table.
// These are the chances from popping an existing egg, not corpse reward probabilities.
const EGG_CHANCES = [
  ["MAGGOT_EGG", 3000],
  ["MAGGOT_EGG_3", 2500],
  ["MAGGOT_EGG_5", 1250],
  ["MAGGOT_EGG_7", 500],
  ["MAGGOT_EGG_9", 10],
  ["MAGGOT_EGG_11", 2],
];
let chances = new Map();

function pop({ player, interfaceId, item, itemId, slot }) {
  const { Inventory, ItemIdentifiers } = Common.core();
  const denominator = chances.get(itemId);
  const inventory = player.getInventory();
  if (!denominator || interfaceId !== Inventory.INTERFACE_ID
      || inventory.getItems()[slot] !== item || item.getId() !== itemId || item.getAmount() < 1) return false;
  if (player.busy()) return true;

  // Consume the current physical stack before the pet event can reenter item handling.
  inventory.deleteAtSlot(slot, 1);
  if (Math.floor(Math.random() * denominator) === 0) {
    Common.api().emitCustomEvent("pets:award", {
      player, itemId: ItemIdentifiers.MAGGOT_MARQUESS, source: "Maggot egg",
    });
  } else {
    // Descriptive feedback; exact retail wording has not been observed.
    player.sendMessage("You pop the egg, but find nothing inside.");
  }
  return true;
}

function attach(api) {
  chances = new Map(EGG_CHANCES.map(([key, denominator]) => [api.core.ItemIdentifiers[key], denominator]));
  api.onItemAction("Maggot egg", { Pop: pop });
}

module.exports = { attach };
