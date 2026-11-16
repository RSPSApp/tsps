/**
 * The cross-style passives (https://oldschool.runescape.wiki/w/Raging_Echoes_League/Combat_Masteries#Passive_Buffs),
 * each live once any style reached its tier: 1 a 95% roll keeps the runes (`magic:rune-saving`,
 * asked once the cast checked the player has them), a powered staff's charge
 * (`combat:consume-charge`) and the ammunition (the ranged ammo handler claims the decrement, so
 * nothing is used or dropped); 2 every heal +20% (the core's `stats:heal`, floored); 3 the three
 * attack rolls x2; 4 damage taken x0.85 (the incoming-damage modifier); 5 Prayer restores x1.25
 * (the core's `skills:restore`); 6 60% Prayer penetration: the roll bypasses the target's
 * protection prayer and the damage then takes 40% of the usual reduction.
 */
const Common = require("./Common.LeagueCombatMasteries");

let core;

/** Attackers whose last roll this unit let through a protection prayer, and against whom. */
const penetrating = new WeakMap();

function saves(player) {
  const passive = Common.passiveEffect(player, 1);
  return !!passive && Math.random() < passive.saveChance;
}

function runeSaving(request) {
  if (!request || request.saved || !request.player) return;
  if (saves(request.player)) request.saved = true;
}

function consumeCharge(request) {
  if (!request || request.skip || !request.player) return;
  if (saves(request.player)) request.skip = true;
}

const ammoHandler = {
  checkAmmo() {
    return null;
  },
  /** True claims the decrement: the ammunition stays in the slot. */
  decrementAmmo(player) {
    return saves(player);
  },
};

function heal(event) {
  const passive = event?.player ? Common.passiveEffect(event.player, 2) : null;
  if (passive) event.amount = Math.floor(event.amount * passive.healMultiplier);
}

function accuracy(entity, roll) {
  const passive = Common.passiveEffect(entity, 3);
  return passive ? roll * passive.accuracyMultiplier : roll;
}

function incomingDamage(entity, hitDamage) {
  const passive = Common.passiveEffect(entity, 4);
  if (passive) hitDamage.setDamage(Math.floor(hitDamage.getDamage() * passive.incomingDamageMultiplier));
}

function restore(event) {
  if (!event?.player || event.skill !== core.Skill.PRAYER) return;
  const passive = Common.passiveEffect(event.player, 5);
  if (passive) event.amount = Math.floor(event.amount * passive.prayerGainMultiplier);
}

function praysAgainst(target, combatType) {
  return !!target && core.PrayerHandler.isActivated(target, core.PrayerHandler.getProtectingPrayer(combatType));
}

/**
 * What a protection prayer leaves of a player's hit on `target` once the roll bypassed it: 1 when
 * it does not pray against the style, what the core leaves when it does (none on a praying NPC),
 * and with the penetration passive 60% of the hit plus 40% of the reduced rest.
 */
function damageFactor(attacker, target, combatType) {
  if (!praysAgainst(target, combatType)) return 1;
  const reduced = core.CombatFactory.protectionPrayerFactor(attacker, target);
  const passive = Common.passiveEffect(attacker, 6);
  return passive ? passive.penetration + (1 - passive.penetration) * reduced : reduced;
}

function penetrateRoll(roll) {
  if (roll.bypassProtectionPrayer || !Common.passiveEffect(roll.attacker, 6) || !praysAgainst(roll.target, roll.combatType)) return;
  roll.bypassProtectionPrayer = true;
  penetrating.set(roll.attacker, roll.target);
}

function penetrateDamage({ attacker, target, combatType, damage }) {
  if (penetrating.get(attacker) !== target) return;
  penetrating.delete(attacker);
  damage.setDamage(Math.floor(damage.getDamage() * damageFactor(attacker, target, combatType)));
}

module.exports = function attach(api) {
  core = api.core;
  api.onCustomEvent("magic:rune-saving", runeSaving);
  api.onCustomEvent("combat:consume-charge", consumeCharge);
  api.registerRangedAmmoHandler(ammoHandler);
  api.onCustomEvent("stats:heal", heal);
  api.registerMeleeAttackAccuracyModifier(accuracy);
  api.registerRangedAttackAccuracyModifier(accuracy);
  api.registerMagicAttackAccuracyModifier(accuracy);
  api.registerIncomingDamageModifier(incomingDamage);
  api.onCustomEvent("skills:restore", restore);
  api.onCombatHitRoll(penetrateRoll);
  api.onCombatHitDamage(penetrateDamage);
};


