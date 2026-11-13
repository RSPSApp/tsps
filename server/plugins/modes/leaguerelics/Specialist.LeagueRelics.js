/**
 * Specialist (https://oldschool.runescape.wiki/w/Specialist_(Raging_Echoes_League)), Raging
 * Echoes' tier 8 relic: every special attack costs 20% energy and rolls accuracy twice as high, a
 * special that misses returns 10% energy, and killing any NPC restores 15%.
 */
const Common = require("./Common.LeagueRelics");

let effect;

function active(player) {
  return Common.effectActive(player, effect);
}

function cost(request) {
  if (active(request.player)) request.cost = effect.cost;
}

function specialAccuracy(entity, roll) {
  return entity.isSpecialActivated?.() && active(entity) ? roll * effect.accuracyMultiplier : roll;
}

/** Each hitsplat of a special that fails its accuracy roll gives back a tenth of the bar (Wiki). */
function missRefund({ player, hit }) {
  const failed = hit.getFailedAccuracyChecks?.() ?? 0;
  if (failed <= 0 || !player.isSpecialActivated() || !active(player)) return;
  Common.restoreSpecial(player, effect.missRefundPercent * failed);
}

function killRestore({ killer }) {
  if (killer?.isPlayer?.() && active(killer)) Common.restoreSpecial(killer, effect.killRestorePercent);
}

module.exports = function attach(api) {
  effect = Common.data.effects.specialist;
  api.onCustomEvent("combat-special:cost", cost);
  api.registerMeleeAttackAccuracyModifier(specialAccuracy);
  api.registerRangedAttackAccuracyModifier(specialAccuracy);
  api.registerMagicAttackAccuracyModifier(specialAccuracy);
  api.onPlayerDealtDamage(missRefund);
  api.onNpcDeath(killRestore);
};
