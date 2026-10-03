"use strict";

/**
 * Castle Wars bandages, from the supply tables.
 *
 * Healing yourself or a teammate restores 10% of max Hitpoints (rounded down), 30% run
 * energy and cures poison; a Castle wars bracelet active this game makes them heal 50% more
 * (OSRS Wiki: Bandages (Castle Wars)).
 */

const HEAL_FRACTION = 0.1;
const BRACELET_HEAL_MULTIPLIER = 1.5;
const RUN_ENERGY_RESTORE = 30;
const MAX_RUN_ENERGY = 100;

let game;
let core;

function bandage(healer, patient) {
  const maxHitpoints = patient.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  const multiplier = game.hasBraceletEffect(healer) ? BRACELET_HEAL_MULTIPLIER : 1;
  healer.getInventory().delete(core.ItemIdentifiers.BANDAGES, 1);
  patient.heal(Math.floor(Math.floor(maxHitpoints * HEAL_FRACTION) * multiplier));
  patient.setRunEnergy(Math.min(MAX_RUN_ENERGY, patient.getRunEnergy() + RUN_ENERGY_RESTORE));
  patient.setPoisonDamage(0);
}

function healSelf({ player }) {
  if (!game.isPlaying(player)) {
    return false;
  }
  bandage(player, player);
  return true;
}

function healTeammate(event) {
  const { player, target, itemId } = event;
  if (itemId !== core.ItemIdentifiers.BANDAGES || !game.isPlaying(player) || !game.isPlaying(target)) {
    return;
  }
  if (game.getTeamId(player) !== game.getTeamId(target)) {
    player.sendMessage("You don't want to be healing your enemies!");
  } else {
    bandage(player, target);
  }
  event.handled = true;
}

module.exports = function attachCastleWarsBandages(api, castleWars) {
  game = castleWars;
  core = api.core;
  api.onItemAction("Bandages", { Heal: healSelf });
  api.onItemOnPlayer(healTeammate);
};
