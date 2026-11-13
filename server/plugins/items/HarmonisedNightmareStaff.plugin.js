/**
 * The Harmonised nightmare staff's passive (Wiki: Harmonised nightmare staff): offensive spells from
 * the standard spellbook cast in 4 ticks instead of 5, "only when autocasting". A hand cast with
 * the staff wielded keeps the spell's 5 ticks, and the staff autocasts nothing from the other
 * spellbooks (Autocasting refuses them), so only a standard autocast is sped up.
 *
 * Ours: a hand cast is told from an autocast the way CombatRange does it, by the cast spell not
 * being the autocast one. A hand cast of the very spell being autocast can't be told apart, so it
 * casts in 4 ticks too.
 */
const AUTOCAST_SPEED = 4;

let core;

function wieldsHarmonisedStaff(player) {
  const weapon = player.getEquipment().get(core.Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === core.ItemIdentifiers.HARMONISED_NIGHTMARE_STAFF;
}

/** The swing is the player's standard-spellbook autocast. */
function isStandardAutocast(player) {
  const combat = player.getCombat();
  const spell = combat.getCastSpell();
  if (spell == null || spell !== combat.getAutocastSpell()) return false;
  if (!core.Autocasting.isActive(player)) return false;
  return spell.getSpellbook?.() === core.MagicSpellbook.NORMAL;
}

function attackSpeed(event) {
  if (event.combatType !== core.CombatType.MAGIC || !event.attacker?.isPlayer?.()) return;
  const player = event.attacker.getAsPlayer();
  if (!wieldsHarmonisedStaff(player) || !isStandardAutocast(player)) return;
  event.speed = Math.min(event.speed, AUTOCAST_SPEED);
}

module.exports = {
  name: "HarmonisedNightmareStaff",
  description: "The Harmonised nightmare staff autocasts standard-spellbook combat spells in 4 ticks.",
  members: true,
  register(api) {
    core = api.core;
    api.onAttackSpeed(attackSpeed);
  },
};
