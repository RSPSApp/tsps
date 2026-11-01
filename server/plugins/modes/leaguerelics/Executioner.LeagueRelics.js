/**
 * Executioner (https://oldschool.runescape.wiki/w/Executioner_(Trailblazer_Reloaded_League)),
 * Trailblazer Reloaded's tier 8 relic: the Sage's axe it grants is a thrown weapon with no
 * bonuses, 5 tiles of reach (7 on long range), never used up, whose hit on an NPC under 20% of its
 * hitpoints takes the rest of them. The axe is a ranged weapon in core's table (it flies as a rune
 * thrown axe: the cache has no spotanim of its own); the execute is the relic's. Demonic Pacts'
 * Executioner (tier 8) is the same axe, sparing Yama (the effect's `spared`). Not here: its 6
 * tiles of reach (Wiki), since the axe's weapon profile is one for every league.
 */
const Common = require("./Common.LeagueRelics");

let core;
let effect;
let axes;

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

module.exports = function attach(api) {
  core = api.core;
  effect = Common.data.effects.executioner;
  api.registerWeaponProfile({ itemIds: [...axeIds()], attackDistance: effect.attackDistance, longRangeDistance: effect.longRangeDistance });
  api.registerRangedAmmoHandler(ammo);
  api.onCombatHitDamage(execute);
};
