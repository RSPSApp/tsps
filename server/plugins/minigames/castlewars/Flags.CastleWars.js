"use strict";

/**
 * Castle Wars flags: take the enemy standard, score it at your own stand while your flag is home,
 * return your own, pick up a dropped one, and drop the banner when swapping weapons.
 * Flag state itself (carry, drop, restore) lives in Game.CastleWars.js; deaths and the end of a
 * game use it too.
 */

let game;
let core;
let data;

function requireFreeWeapon(player, message) {
  if (player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT) <= 0) {
    return true;
  }
  player.sendMessage(message);
  return false;
}

function captureFlag(player, flagTeam) {
  if (game.flagStatus[flagTeam] !== 0 || !requireFreeWeapon(player, "Please remove your weapon before attempting to capture the flag.")) {
    return;
  }
  game.updateFlagStand(flagTeam, game.getTeamData(flagTeam).emptyStandId);
  game.carryFlag(player, flagTeam);
}

function returnCarriedFlag(player) {
  const teamId = game.getTeamId(player);
  const carriedFlagTeam = game.getCarriedFlagTeam(player);
  if (!teamId || !carriedFlagTeam) {
    return;
  }
  if (carriedFlagTeam === teamId) {
    game.restoreFlagToBase(carriedFlagTeam);
    game.clearWeaponSlot(player);
    player.sendMessage(`Returned the ${game.getTeamData(carriedFlagTeam).name.toLowerCase()} flag!`);
    return;
  }
  if (game.flagStatus[teamId] !== 0) {
    player.sendMessage("You need your own flag safely returned before you can score.");
    return;
  }
  game.restoreFlagToBase(carriedFlagTeam);
  game.clearWeaponSlot(player);
  game.score[teamId] += 1;
  player.sendMessage(`The team of ${game.getTeamData(teamId).name} scores 1 point!`);
}

function pickupDroppedFlag(player, flagTeam, object) {
  if (game.flagStatus[flagTeam] !== 2 || !requireFreeWeapon(player, "Please remove your weapon before attempting to pick up the flag.")) {
    return;
  }
  game.removeDroppedFlagObject(flagTeam);
  game.carryFlag(player, flagTeam);
  game.sendGameHintRemoval(object.getLocation());
}

function useFlagObject(event) {
  const { player, object } = event;
  const id = object.getId();
  const standTeam = data.STAND_TEAMS[id];
  const droppedTeam = data.DROPPED_FLAG_TEAMS[id];
  if (!standTeam && !droppedTeam) {
    return;
  }
  event.handled = true;
  if (!game.getTeamId(player)) {
    return;
  }
  if (droppedTeam) {
    pickupDroppedFlag(player, droppedTeam, object);
  } else if (game.getTeamId(player) === standTeam) {
    returnCarriedFlag(player);
  } else {
    captureFlag(player, standTeam);
  }
}

/** Swapping the banner out of the hands drops it where the carrier stands. */
function dropFlagForWeapon({ player, slot }) {
  const { WEAPON_SLOT, SHIELD_SLOT } = core.Equipment;
  if (player?.getArea?.() !== game.gameArea || (slot !== WEAPON_SLOT && slot !== SHIELD_SLOT) || !game.getCarriedFlagTeam(player)) {
    return false;
  }
  game.dropCarriedFlag(player);
  return true;
}

function dropFlagOnUnequip(event) {
  if (dropFlagForWeapon(event)) {
    event.allow = false;
  }
}

module.exports = function attachCastleWarsFlags(api, castleWars) {
  game = castleWars;
  core = api.core;
  data = castleWars.data;
  api.onObjectInteraction(useFlagObject);
  api.onCanEquip(dropFlagForWeapon);
  api.onCanUnequip(dropFlagOnUnequip);
};
