const Common = require('./Common.ElementalSpells');
const Fragments = require('./Fragments.ElementalSpells');
function baseMaximum(request) {
  const player = request.attacker;
  if (!player?.isPlayer?.()) return;
  const entry = Common.metadata(request.spell);
  const element = Common.element(player, request.spell);
  if (!entry && !element) return;
  const level = player.getSkillManager().getMaxLevel(Common.core.Skill.MAGIC);
  // Add the scaling delta so other base additions commute with this handler. An Ancient family
  // counted as an element has no standard family to scale from; it still takes that element's
  // amulet and fragments.
  if (entry) request.maxHit += Common.familyMaximum(entry, level) - request.originalMaxHit;
  if (Common.matchingAmulet(player, element)) request.maxHit += 2;
  request.maxHit += Fragments.bonus(player, element);
}
function attach(api) { api.onCustomEvent('combat:magic-base-max-hit', baseMaximum); }
module.exports = { attach };
