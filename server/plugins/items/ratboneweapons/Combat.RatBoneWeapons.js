/**
 * Rat bone weapons in a fight (Wiki: Rat bone weapons): they hit rats only, refusing anything else
 * with "You can only use this weapon against rats." (captured), and add 10 to the maximum hit
 * against rats. The bone staff's spell carries its +10 itself (Staff.RatBoneWeapons.js); the
 * no-delay hits on Scurrius' rats are the Scurrius plugin's.
 */
const Common = require("./Common.RatBoneWeapons");

function onlyRats(event) {
  const { attacker, target } = event;
  if (!attacker?.isPlayer?.() || !Common.wieldsRatBone(attacker.getAsPlayer())) return;
  if (Common.isRat(target)) return;
  event.allow = false;
  attacker.getAsPlayer().sendMessage(Common.ONLY_RATS_MESSAGE);
}

/** Melee and ranged maximum hit: +10 with a rat bone weapon against a rat. */
function ratbane(entity, value) {
  if (!entity?.isPlayer?.() || !Common.wieldsRatBone(entity.getAsPlayer())) return value;
  return Common.isRat(Common.api.core.hitTargetOf(entity)) ? value + Common.RAT_MAX_HIT_BONUS : value;
}

function attach(api) {
  api.onCanAttack(onlyRats);
  api.registerMeleeHitModifier(ratbane);
  api.registerRangedHitModifier(ratbane);
}

module.exports = { attach, _test: { onlyRats, ratbane } };
