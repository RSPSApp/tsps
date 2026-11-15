/** The bounded standard-bow rendition; ordinary combat owns arrows, rolls and floor items. */
const C = require("./Common.ClanWars");

const PROFILE_NAMES = Object.freeze([
  "SHORTBOW", "LONGBOW", "OAK_SHORTBOW", "OAK_LONGBOW",
  "WILLOW_SHORTBOW", "WILLOW_LONGBOW", "MAPLE_SHORTBOW", "MAPLE_LONGBOW",
  "YEW_SHORTBOW", "YEW_LONGBOW", "MAGIC_SHORTBOW", "MAGIC_LONGBOW",
]);
const SUPPORT = "TSPS Ranging supports ordinary normal, oak, willow, maple, yew and magic shortbows and longbows with equipped arrows. Other ranged weapons, loaded quivers and ranged special attacks are unavailable.";
const SPENDING = "Arrows are spent normally. Safe death does not restore spent arrows; uncollected floor arrows disappear when the battle ends.";

function supports(player) {
  const { RangedWeapon, Ammunition } = C.core;
  const profile = RangedWeapon.getFor(player);
  return PROFILE_NAMES.some((name) => profile === RangedWeapon[name])
    && Ammunition.firesFromAmmoSlot(player);
}
function rangedSpecial(id) {
  return C.core.CombatSpecial.getById(id)?.getCombatMethod()?.type() === C.core.CombatType.RANGED;
}
function canAttack(player, rules, method) {
  // Secondary/reflected hits have already passed their primary attack policy.
  if (method == null || method.type() === C.core.CombatType.MELEE) return true;
  if (method.type() !== C.core.CombatType.RANGED) return false;
  if (rules.ranged !== 0) {
    player.sendMessage("Ranging is disabled in this Clan Wars battle.");
    return false;
  }
  // Check the actual method and current equipment before start() can spend anything.
  if (method !== C.core.CombatFactory.RANGED_COMBAT || player.isSpecialActivated() || !supports(player)) {
    player.sendMessage(SUPPORT);
    return false;
  }
  return true;
}
module.exports = { PROFILE_NAMES, SUPPORT, SPENDING, supports, rangedSpecial, canAttack };
