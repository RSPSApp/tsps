/**
 * Wiki (Seeking arrows): every seeking arrow raises successful bow hits to at least three; special minima do
 * not stack. The bronze to rune, amethyst and broad ones fire as their normal counterparts (RangedData), so
 * they are told apart by the item in the ammo slot.
 */
let core;
let seekingIds = null;

function seekingMinimum(event) {
  const { attacker, damage, accurate } = event;
  if (!accurate || !attacker?.isPlayer?.() || event.combatType !== core.CombatType.RANGED) return;
  const player = attacker.getAsPlayer();
  if (player.isSpecialActivated()) return;
  const ammunition = player.getCombat().getAmmunition();
  const ammo = player.getEquipment?.()?.get?.(core.Equipment.AMMUNITION_SLOT)?.getId?.() ?? -1;
  if (ammunition === core.Ammunition.SEEKING_DRAGON_ARROW || seekingIds.has(ammo)) damage.setDamage(Math.max(3, damage.getDamage()));
}

module.exports = {
  name: "SeekingArrows",
  description: "Makes successful bow hits with seeking arrows deal at least three damage.",
  members: true,
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    seekingIds = new Set([
      I.SEEKING_BRONZE_ARROW, I.SEEKING_IRON_ARROW, I.SEEKING_STEEL_ARROW, I.SEEKING_MITHRIL_ARROW,
      I.SEEKING_ADAMANT_ARROW, I.SEEKING_RUNE_ARROW, I.SEEKING_AMETHYST_ARROW, I.SEEKING_BROAD_ARROWS,
    ]);
    api.onCombatHitDamage(seekingMinimum);
  },
};
