"use strict";

/**
 * Tombs of Amascut reward items: fortifying Masori with Armadylean plates (and chiselling
 * Armadyl armour into them), the arcane sigil on Elidinis' ward, the Thread of Elidinis on a
 * rune pouch, the keris partisan's jewels, and charging Tumeken's shadow.
 */

const Shared = require("./ToaShared");

const ANIMATION = { FORTIFY: 3676, CHISEL: 8833, FUSE: 791 };
const SHADOW_CHARGES_KEY = "tumekens-shadow-charges";
const SHADOW_MAX_CHARGES = 20000;
const SHADOW_SOULS_PER_CHARGE = 2;
const SHADOW_CHAOS_PER_CHARGE = 5;
const WARD_SOUL_RUNES = 10000;

function ids() {
  return Shared.core().ItemIdentifiers;
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(skill);
}

/** Holds the player for a moment with an animation, then runs `action` if they still can. */
function craft(player, animation, action) {
  const { Animation } = Shared.core();
  player.getMovementQueue().reset();
  player.performAnimation(new Animation(animation));
  Shared.later(player, 2, action);
}

function plural(amount, word) {
  return `${amount.toLocaleString()} ${word}${amount === 1 ? "" : "s"}`;
}

// ------------------------------------------------------------------ Masori and Armadyl

/** Plates per piece and the Crafting experience for fortifying it (NR ArmadyleanPlateOnMasori). */
function masoriPieces() {
  const I = ids();
  return [
    { name: "Masori mask", id: I.MASORI_MASK, fortified: I.MASORI_MASK_F_, plates: 1, xp: 830 },
    { name: "Masori body", id: I.MASORI_BODY, fortified: I.MASORI_BODY_F_, plates: 4, xp: 3320 },
    { name: "Masori chaps", id: I.MASORI_CHAPS, fortified: I.MASORI_CHAPS_F_, plates: 3, xp: 2490 },
  ];
}

function armadylPieces() {
  const I = ids();
  return [
    { name: "Armadyl helmet", id: I.ARMADYL_HELMET, plates: 1, xp: 210 },
    { name: "Armadyl chestplate", id: I.ARMADYL_CHESTPLATE, plates: 4, xp: 840 },
    { name: "Armadyl chainskirt", id: I.ARMADYL_CHAINSKIRT, plates: 3, xp: 630 },
  ];
}

function fortifyMasori(player, piece) {
  const { Skill, Item } = Shared.core();
  const I = ids();
  const inventory = player.getInventory();
  if (level(player, Skill.CRAFTING) < 90) {
    player.sendMessage("You need a Crafting level of 90 to do that.");
    return;
  }
  if (!inventory.contains(I.HAMMER)) {
    player.sendMessage("You need a hammer to fortify your armour.");
    return;
  }
  if (inventory.getAmount(I.ARMADYLEAN_PLATE) < piece.plates) {
    player.sendMessage(`You need ${plural(piece.plates, "Armadylean plate")} to fortify your ${piece.name}.`);
    return;
  }
  Shared.confirm(player, `Fortify your ${piece.name} with ${plural(piece.plates, "Armadylean plate")}?`, () => {
    craft(player, ANIMATION.FORTIFY, () => {
      if (!inventory.contains(piece.id) || inventory.getAmount(I.ARMADYLEAN_PLATE) < piece.plates) return;
      inventory.deleteNumber(piece.id, 1);
      inventory.deleteNumber(I.ARMADYLEAN_PLATE, piece.plates);
      inventory.addItem(new Item(piece.fortified, 1));
      player.getSkillManager().addExperiences(Skill.CRAFTING, piece.xp);
      player.sendMessage(`You use ${plural(piece.plates, "Armadylean plate")} to fortify your ${piece.name}.`);
    });
  });
}

function breakArmadyl(player, piece) {
  const { Skill, Item } = Shared.core();
  const I = ids();
  const inventory = player.getInventory();
  if (level(player, Skill.CRAFTING) < 90) {
    player.sendMessage("You need a Crafting level of 90 to do that.");
    return;
  }
  Shared.confirm(player, `Break apart your ${piece.name} into ${plural(piece.plates, "Armadylean plate")}?`, () => {
    Shared.options(player, `Really break apart your ${piece.name}?`,
      "No.", () => {},
      "Yes.", () => {
        if (!inventory.contains(piece.id)) return;
        if (!inventory.contains(I.ARMADYLEAN_PLATE) && inventory.getFreeSlots() < 1) {
          player.sendMessage("You don't have enough inventory space.");
          return;
        }
        player.sendMessage("You use your chisel to break the armour down into its base components.");
        craft(player, ANIMATION.CHISEL, () => {
          if (!inventory.contains(piece.id)) return;
          inventory.deleteNumber(piece.id, 1);
          inventory.addItem(new Item(I.ARMADYLEAN_PLATE, piece.plates));
          player.getSkillManager().addExperiences(Skill.CRAFTING, piece.xp);
        });
      });
  });
}

// ------------------------------------------------------------------ Elidinis' ward, the thread, the keris

function fortifyWard({ player }) {
  const { Skill, Item } = Shared.core();
  const I = ids();
  const inventory = player.getInventory();
  if (player.getSkillManager().getMaxLevel(Skill.PRAYER) < 90) {
    player.sendMessage("You need a Prayer level of at least 90 to fortify Elidinis' ward.");
    return true;
  }
  if (level(player, Skill.SMITHING) < 90) {
    player.sendMessage("You need a Smithing level of at least 90 to fortify Elidinis' ward.");
    return true;
  }
  if (inventory.getAmount(I.SOUL_RUNE) < WARD_SOUL_RUNES) {
    player.sendMessage("You need at least 10,000 soul runes to fortify Elidinis' ward.");
    return true;
  }
  Shared.confirm(player, "Consume 10,000 soul runes to fortify Elidinis' ward?", () => {
    craft(player, ANIMATION.FUSE, () => {
      if (!inventory.contains(I.ARCANE_SIGIL) || !inventory.contains(I.ELIDINIS_WARD) || inventory.getAmount(I.SOUL_RUNE) < WARD_SOUL_RUNES) return;
      inventory.deleteNumber(I.ARCANE_SIGIL, 1);
      inventory.deleteNumber(I.ELIDINIS_WARD, 1);
      inventory.deleteNumber(I.SOUL_RUNE, WARD_SOUL_RUNES);
      inventory.addItem(new Item(I.ELIDINIS_WARD_F_, 1));
      player.getSkillManager().addExperiences(Skill.PRAYER, 260);
      player.getSkillManager().addExperiences(Skill.SMITHING, 260);
      player.sendMessage("You fuse the arcane sigil to Elidinis' ward, returning it to its former glory.");
    });
  });
  return true;
}

function threadRunePouch({ player }) {
  const { Skill, Item } = Shared.core();
  const I = ids();
  const inventory = player.getInventory();
  if (level(player, Skill.CRAFTING) < 75) {
    player.sendMessage("You need a Crafting level of at least 75 to augment your rune pouch.");
    return true;
  }
  if (!inventory.contains(I.NEEDLE)) {
    player.sendMessage("You need a needle to work with the Thread of Elidinis.");
    return true;
  }
  Shared.confirm(player, "Augment your rune pouch?", () => {
    craft(player, ANIMATION.CHISEL, () => {
      const pouch = inventory.getValidItems().find((item) => item.getId() === I.RUNE_POUCH);
      if (!pouch || !inventory.contains(I.THREAD_OF_ELIDINIS)) return;
      inventory.deleteNumber(I.RUNE_POUCH, 1);
      inventory.deleteNumber(I.THREAD_OF_ELIDINIS, 1);
      // The upgraded pouch keeps whatever runes the old one held.
      inventory.addItem(new Item(I.DIVINE_RUNE_POUCH, 1, pouch.getMeta()));
      player.sendMessage("You skillfully weave the Thread of Elidinis into the rune pouch and watch as it transforms into something more.");
    });
  });
  return true;
}

function kerisJewels() {
  const I = ids();
  return [
    { name: "Eye of the Corruptor", id: I.EYE_OF_THE_CORRUPTOR, partisan: I.KERIS_PARTISAN_OF_CORRUPTION },
    { name: "Breach of the Scarab", id: I.BREACH_OF_THE_SCARAB, partisan: I.KERIS_PARTISAN_OF_BREACHING },
    { name: "Jewel of the Sun", id: I.JEWEL_OF_THE_SUN, partisan: I.KERIS_PARTISAN_OF_THE_SUN },
  ];
}

function attachJewel(player, jewel) {
  const { Item } = Shared.core();
  const I = ids();
  const inventory = player.getInventory();
  if (!inventory.contains(jewel.id) || !inventory.contains(I.KERIS_PARTISAN)) return;
  inventory.deleteNumber(jewel.id, 1);
  inventory.deleteNumber(I.KERIS_PARTISAN, 1);
  inventory.addItem(new Item(jewel.partisan, 1));
  player.sendMessage(`You attach the ${jewel.name.toLowerCase()} to your keris partisan.`);
}

// ------------------------------------------------------------------ Tumeken's shadow

function shadowCharges(item) {
  return Math.max(0, Number(item?.getMetaValue?.(SHADOW_CHARGES_KEY)) || 0);
}

function setShadowCharges(player, item, charges) {
  const I = ids();
  item.setMetaValue(SHADOW_CHARGES_KEY, charges);
  item.setId(charges > 0 ? I.TUMEKENS_SHADOW : I.TUMEKENS_SHADOW_UNCHARGED_);
  player.getInventory().refreshItems();
}

/** Two soul runes and five chaos runes a charge, as many as the inventory affords. */
function chargeShadow(event) {
  const { player } = event;
  const I = ids();
  const shadowIds = [I.TUMEKENS_SHADOW, I.TUMEKENS_SHADOW_UNCHARGED_];
  const staff = shadowIds.includes(event.usedItemId) ? event.usedItem : event.usedWithItem;
  if (!staff) return false;
  const inventory = player.getInventory();
  const current = shadowCharges(staff);
  if (current >= SHADOW_MAX_CHARGES) {
    player.sendMessage("Your Tumeken's shadow is already fully charged.");
    return true;
  }
  const affordable = Math.min(
    Math.floor(inventory.getAmount(I.SOUL_RUNE) / SHADOW_SOULS_PER_CHARGE),
    Math.floor(inventory.getAmount(I.CHAOS_RUNE) / SHADOW_CHAOS_PER_CHARGE),
    SHADOW_MAX_CHARGES - current,
  );
  if (affordable < 1) {
    player.sendMessage("You need two soul runes and five chaos runes for each charge.");
    return true;
  }
  inventory.deleteNumber(I.SOUL_RUNE, affordable * SHADOW_SOULS_PER_CHARGE);
  inventory.deleteNumber(I.CHAOS_RUNE, affordable * SHADOW_CHAOS_PER_CHARGE);
  setShadowCharges(player, staff, current + affordable);
  player.sendMessage(current === 0
    ? `You apply ${plural(affordable, "charge")} to your Tumeken's shadow.`
    : `You apply an additional ${plural(affordable, "charge")} to your Tumeken's shadow. It now has ${plural(current + affordable, "charge")} in total.`);
  return true;
}

function checkShadow({ player, item }) {
  player.sendMessage(`Your Tumeken's shadow has ${plural(shadowCharges(item), "charge")} remaining.`);
  return true;
}

function unchargeShadow({ player, item }) {
  const { Item } = Shared.core();
  const I = ids();
  const charges = shadowCharges(item);
  if (charges <= 0) {
    player.sendMessage("Your Tumeken's shadow has no charges to remove.");
    return true;
  }
  const inventory = player.getInventory();
  const needed = (inventory.contains(I.SOUL_RUNE) ? 0 : 1) + (inventory.contains(I.CHAOS_RUNE) ? 0 : 1);
  if (inventory.getFreeSlots() < needed) {
    player.sendMessage("Your inventory is too full to hold the runes.");
    return true;
  }
  Shared.confirm(player, "Uncharge all the charges from your staff?", () => {
    const left = shadowCharges(item);
    if (left <= 0) return;
    inventory.addItem(new Item(I.SOUL_RUNE, left * SHADOW_SOULS_PER_CHARGE));
    inventory.addItem(new Item(I.CHAOS_RUNE, left * SHADOW_CHAOS_PER_CHARGE));
    setShadowCharges(player, item, 0);
    player.sendMessage(`You uncharge your Tumeken's shadow, regaining ${plural(left * SHADOW_SOULS_PER_CHARGE, "soul rune")} and ${plural(left * SHADOW_CHAOS_PER_CHARGE, "chaos rune")} in the process.`);
  });
  return true;
}

// ------------------------------------------------------------------ named wrappers

function useArmadyleanPlate(event) {
  const piece = masoriPieces().find((entry) => entry.id === event.usedItemId || entry.id === event.usedWithItemId);
  if (!piece) return false;
  fortifyMasori(event.player, piece);
  return true;
}

function useChisel(event) {
  const piece = armadylPieces().find((entry) => entry.id === event.usedItemId || entry.id === event.usedWithItemId);
  if (!piece) return false;
  breakArmadyl(event.player, piece);
  return true;
}

function useKerisJewel(event) {
  const jewel = kerisJewels().find((entry) => entry.id === event.usedItemId || entry.id === event.usedWithItemId);
  if (!jewel) return false;
  attachJewel(event.player, jewel);
  return true;
}

module.exports = function registerTombsItems(api) {
  Shared.bind(api);
  for (const name of ["Masori mask", "Masori body", "Masori chaps"]) api.onItemOnItem("Armadylean plate", name, useArmadyleanPlate);
  for (const name of ["Armadyl helmet", "Armadyl chestplate", "Armadyl chainskirt"]) api.onItemOnItem("Chisel", name, useChisel);
  api.onItemOnItem("Arcane sigil", "Elidinis' ward", fortifyWard);
  api.onItemOnItem("Thread of Elidinis", "Rune pouch", threadRunePouch);
  for (const name of ["Eye of the Corruptor", "Breach of the Scarab", "Jewel of the Sun"]) api.onItemOnItem("Keris partisan", name, useKerisJewel);
  for (const rune of ["Soul rune", "Chaos rune"]) {
    api.onItemOnItem(rune, "Tumeken's shadow", chargeShadow);
    api.onItemOnItem(rune, "Tumeken's shadow (uncharged)", chargeShadow);
  }
  api.onItemAction("Tumeken's shadow", { Check: checkShadow, Uncharge: unchargeShadow });
};

/** Where a staff keeps its charges, for the shadow's combat (Shadow.TombsOfAmascut.js). */
module.exports.SHADOW_CHARGES_KEY = SHADOW_CHARGES_KEY;
