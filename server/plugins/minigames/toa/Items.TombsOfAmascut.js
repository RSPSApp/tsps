"use strict";

/**
 * Tombs of Amascut reward items: fortifying Masori with Armadylean plates (and chiselling
 * Armadyl armour into them), the arcane sigil on Elidinis' ward, the Thread of Elidinis on a
 * rune pouch and the keris partisan's jewels. Tumeken's shadow is plugins/items/TumekensShadow.plugin.js.
 */

const Shared = require("./ToaShared");

const ANIMATION = { FORTIFY: 3676, CHISEL: 8833, FUSE: 791 };
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
      // A pouch's runes are kept on the player (RunePouch), so the upgraded pouch has them too.
      inventory.addItem(new Item(I.DIVINE_RUNE_POUCH, 1));
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
};
