"use strict";

/**
 * Castle wars bracelet. A worn bracelet spends a charge as the game starts (CastleWars.plugin.js);
 * for that game its wearer hits 20% harder against whoever carries their team's flag
 * (OSRS Wiki: Castle wars bracelet). The bandage bonus lives in Bandages.CastleWars.js.
 */

const FLAG_CARRIER_DAMAGE_MULTIPLIER = 1.2;

let game;

function boostAgainstFlagCarrier(attacker, maxHit) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  const target = attacker?.getCombat?.()?.getTarget?.();
  if (!player || !target?.isPlayer?.() || !game.hasBraceletEffect(player)) {
    return maxHit;
  }
  const carrier = target.getAsPlayer();
  if (!game.isPlaying(carrier) || game.getCarriedFlagTeam(carrier) !== game.getTeamId(player)) {
    return maxHit;
  }
  return Math.floor(maxHit * FLAG_CARRIER_DAMAGE_MULTIPLIER);
}

module.exports = function attachCastleWarsBracelet(api, castleWars) {
  game = castleWars;
  api.registerMeleeHitModifier(boostAgainstFlagCarrier);
  api.registerRangedHitModifier(boostAgainstFlagCarrier);
  api.registerMagicHitModifier(boostAgainstFlagCarrier);
};
