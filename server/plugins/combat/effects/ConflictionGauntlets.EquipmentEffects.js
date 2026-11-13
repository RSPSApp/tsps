/**
 * Confliction gauntlets passive (Wiki: Confliction gauntlets#Passive effect, docs/confliction-gauntlets.md).
 * - A missed magic attack makes the next magic attack with the same spell (a powered staff's
 *   built-in spell is its own) on the same target roll accuracy twice: a second attack roll
 *   against the same defence roll, hitting if either beats it (the Wiki's two-roll formula is
 *   the fang's outside the Tombs of Amascut).
 * - A multi-target spell only does this for its primary target; the secondary targets roll once
 *   and neither use nor set the passive.
 * - Never with a two-handed weapon (Wiki: Tormented bracelet#Upgrading), nor for ice spells cast
 *   on players (Wiki citing a DMM video; Mod Ash found the check only for smoke, shadow and blood).
 */
const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { asPlayer, wornName } = require("./GearChecks.EquipmentEffects");

const GAUNTLETS_NAME = "confliction gauntlets";
const ICE_SPELLS = ["ICE_RUSH", "ICE_BURST", "ICE_BLITZ", "ICE_BARRAGE"];

let core;

/**
 * Each wearer's last missed primary magic attack: { target, spell }. A landed one clears it. Spells are
 * compared by object: the standard spells are single objects, and PoweredStaff.js keeps one per staff.
 */
const missed = new WeakMap();

function wearer(entity) {
  const player = asPlayer(entity);
  if (!player || wornName(player, Equipment.HANDS_SLOT) !== GAUNTLETS_NAME) return null;
  const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  if (weapon > 0 && ItemDefinition.forId(weapon)?.isDoubleHanded?.() === true) return null;
  return player;
}

function spellOf(player) {
  return player.getCombat?.()?.getSelectedSpell?.() ?? null;
}

function isIceSpell(spell) {
  const id = spell?.spellId?.();
  return id != null && ICE_SPELLS.some((name) => core.CombatSpells[name]?.spellId?.() === id);
}

/** The attack this passive can see: a wearer's magic attack on its own combat target, the spell known. */
function primaryAttack(event) {
  if (event?.combatType !== core.CombatType.MAGIC) return null;
  const player = wearer(event.attacker);
  if (!player || !event.target || player.getCombat?.()?.getTarget?.() !== event.target) return null;
  const spell = spellOf(player);
  if (!spell) return null;
  if (event.target.isPlayer?.() && isIceSpell(spell)) return null;
  return { player, target: event.target, spell };
}

/** `combat:accuracy-rolled`: after a miss on this target with this spell, roll the attack again. */
function secondAccuracyRoll(rolled) {
  if (rolled.accurate) return;
  const attack = primaryAttack(rolled);
  if (!attack) return;
  const last = missed.get(attack.player);
  if (!last || last.target !== attack.target || last.spell !== attack.spell) return;
  const max = Math.max(0, Math.floor(rolled.attack));
  rolled.accurate = Math.floor(Math.random() * (max + 1)) > rolled.defenceRolled;
}

/** The hit's accuracy is settled: a miss arms the passive for this target and spell, a hit clears it. */
function noteOutcome(event) {
  const attack = primaryAttack(event);
  if (!attack) {
    // Any other magic attack on the player's own target is the "next" one too, and uses it up.
    const player = asPlayer(event?.attacker);
    if (player && event.combatType === core.CombatType.MAGIC && player.getCombat?.()?.getTarget?.() === event.target) missed.delete(player);
    return;
  }
  if (event.accurate) missed.delete(attack.player);
  else missed.set(attack.player, { target: attack.target, spell: attack.spell });
}

module.exports = function registerConflictionGauntletsEffects(api) {
  core = api.core;
  api.onCustomEvent("combat:accuracy-rolled", secondAccuracyRoll);
  api.onCombatHitDamage(noteOutcome);
};
module.exports.missed = missed;
