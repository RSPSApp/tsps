"use strict";

/**
 * The training ground's rules (Wiki, Knight Waves Training Ground): melee only, and no Prayer.
 * Merlin's spell prevents Ranged and Magic outright, so an attack in either style is refused;
 * Prayer is turned off on entry and cannot be switched on again while inside.
 *
 * The Wiki gives no refusal wording, so the lines are ours and say plainly what the spell does.
 */
const Common = require("./Common.KnightWaves");

function inRoom(player) {
  return !!player && Common.inRoom(player);
}

/** Ranged and Magic attacks on the player's own knight are refused. */
function canAttack(event) {
  const { attacker, target, method } = event;
  if (!inRoom(attacker) || !target?.__knightWaves || target.__knightWaves.player !== attacker) return;
  const type = method?.type?.();
  const { CombatType } = Common.core;
  if (type !== CombatType.RANGED && type !== CombatType.MAGIC) return;
  event.allow = false;
  event.message = Common.MESSAGES.meleeOnly;
}

/** No Prayer inside the room; the entry reset in Room also clears anything already lit. */
function noPrayer(event) {
  if (!inRoom(event.player)) return;
  event.disabled = true;
  event.message = Common.MESSAGES.noPrayer;
}

function attachRestrictions(api) {
  api.onCanAttack(canAttack);
  api.onPrayerDisabled(noPrayer);
}

module.exports = { attachRestrictions, canAttack, noPrayer };
