"use strict";

/**
 * Extra rewards from crashed stars (Wiki, Crashed star). Clue geodes and the rock golem come from
 * the "mining:success" event the Mining unit emits (the Mining plugin's clue geodes, the Pets
 * plugin's golem, both from the star's base of 521,550).
 *
 * The uncut gem table is rolled before the stardust roll on every attempt: 1/256, or 1/64.2 with
 * a charged amulet of glory (or the eternal one) worn. A hit gives a gem or nothing, never stardust
 * and never experience.
 */

const Common = require("./Common.ShootingStars");

const { DATA } = Common;

/** A charged glory: "Amulet of glory(1)".."(6)", their (t) versions, or the eternal glory. */
const CHARGED_GLORY = /^Amulet of (eternal glory|glory ?\(t?\d\))$/;

let gemIds = null;

function gemRolls() {
  if (gemIds) return gemIds;
  const ids = Common.core.ItemIdentifiers;
  gemIds = DATA.gemTable.rolls.map((roll) => ({
    weight: roll.weight,
    itemId: roll.item ? ids[roll.item.toUpperCase().replace(/[^A-Z0-9]+/g, "_")] : null,
  }));
  return gemIds;
}

function wearsChargedGlory(player) {
  const amulet = player.getEquipment().getItems()[Common.core.Equipment.AMULET_SLOT];
  if (!amulet || amulet.getId() <= 0) return false;
  return CHARGED_GLORY.test(Common.core.ItemDefinition.forId(amulet.getId()).getName());
}

function pickGem(random) {
  const rolls = gemRolls();
  const total = rolls.reduce((sum, roll) => sum + roll.weight, 0);
  let pick = random() * total;
  for (const roll of rolls) {
    pick -= roll.weight;
    if (pick < 0) return roll.itemId;
  }
  return null;
}

/** True when the gem table took this attempt (a gem was given, or nothing). */
function rollGemTable(player, random = Math.random) {
  const chance = wearsChargedGlory(player) ? DATA.gemTable.gloryChance : DATA.gemTable.chance;
  if (random() * chance >= 1) return false;
  const gemId = pickGem(random);
  if (gemId != null && player.getInventory().getFreeSlots() > 0) player.getInventory().adds(gemId, 1);
  return true;
}

module.exports = { rollGemTable, wearsChargedGlory, pickGem, CHARGED_GLORY };
