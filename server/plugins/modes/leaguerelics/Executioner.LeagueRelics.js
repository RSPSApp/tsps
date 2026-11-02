/**
 * Executioner (https://oldschool.runescape.wiki/w/Executioner_(Trailblazer_Reloaded_League)),
 * Trailblazer Reloaded's tier 8 relic: the Sage's axe it grants is a thrown weapon with no
 * bonuses, 5 tiles of reach (7 on long range: its dart styles' Longrange, the profile's
 * `longRangeFightType`, adds the 2), never used up, whose hit on an NPC under 20% of its
 * hitpoints takes the rest of them. The axe is a ranged weapon in core's table (it flies as a rune
 * thrown axe: the cache has no spotanim of its own); the execute is the relic's. Demonic Pacts'
 * Executioner (tier 8) is the same axe, sparing Yama and the Gemstone Crab (the effect's `spared`), reaching 6 tiles
 * (8 on long range; the effect's `reach`, Wiki): the shared weapon profile's reach, raised for
 * that league's owner as combat asks it (`onCombatAttackDistance`), so Trailblazer Reloaded's
 * axe keeps its 5.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;
let axes;
/** No weapon reaches past 10 tiles (Wiki: Attack range). */
const MAX_REACH = 10;

function active(player) {
  return Common.effectActive(player, effect);
}

function axeIds() {
  if (!axes) axes = new Set(effect.items.map((name) => core.ItemIdentifiers[name]).filter(Number.isInteger));
  return axes;
}

function wieldsAxe(player) {
  return player?.isPlayer?.() === true && axeIds().has(player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.());
}

/** The axe is its own ammunition but is never thrown away. */
const ammo = {
  checkAmmo: () => null,
  decrementAmmo: (player) => wieldsAxe(player),
};

/** An NPC under a fifth of its hitpoints loses the rest. */
function execute(event) {
  const { attacker, target, combatType, damage } = event;
  if (Common.isBuildingDerivedHit() || combatType !== core.CombatType.RANGED || !target?.isNpc?.() || !wieldsAxe(attacker) || !active(attacker)) return;
  const spared = effect.spared?.[Common.leagueOf(attacker)] ?? [];
  if (spared.includes(target.getDefinition?.()?.getName?.())) return;
  const hitpoints = target.getHitpointsAfterPendingDamage?.() ?? target.getHitpoints();
  if (hitpoints <= 0 || hitpoints >= target.getMaxHitpoints() * effect.executeBelowFraction) return;
  damage.setDamage(hitpoints);
  event.accurate = true;
}

/** A league's own reach for the axe: the tiles it adds over the shared profile's. */
function reach(event) {
  const { attacker, combatType } = event;
  if (combatType !== core.CombatType.RANGED || !wieldsAxe(attacker) || !active(attacker)) return;
  const tiles = effect.reach?.[Common.leagueOf(attacker)];
  if (Number.isInteger(tiles)) event.distance = Math.min(MAX_REACH, event.distance + tiles - effect.attackDistance);
}

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.executioner;
  api.registerWeaponProfile({ itemIds: [...axeIds()], attackDistance: effect.attackDistance, longRangeFightType: core.FightType[effect.longRangeFightType] });
  api.registerRangedAmmoHandler(ammo);
  api.onCombatHitDamage(execute);
  api.onCombatAttackDistance(reach);
};
