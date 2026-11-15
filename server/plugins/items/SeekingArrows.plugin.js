/**
 * Wiki (Seeking arrows): every seeking arrow raises successful bow hits to at least three; special minima do
 * not stack. The bronze to rune, amethyst and broad ones fire as their normal counterparts (RangedData), so
 * they are told apart by the item actually fired: the ammo slot's when the bow fires from it, or Dizana's
 * quiver's when the quiver supplies the shot. A seeking arrow merely worn (with darts, a crystal bow, a
 * blowpipe) gets nothing.
 */
const QUIVER_ATTRIBUTE = "dizanas-quiver";
let core;
let seekingIds = null;

/** The item id the shot fires, or -1: the ammo slot's for a bow firing from it, else a quiver's stored ammo. */
function firedAmmoId(player, hit, ammunition) {
  const { Ammunition, Equipment } = core;
  if (ammunition == null) return -1;
  if (Ammunition.firesFromAmmoSlot(player)) {
    const slot = hit?.getFiredRangedShot?.()?.ammo ?? player.getEquipment?.()?.get?.(Equipment.AMMUNITION_SLOT);
    const id = slot?.getId?.() ?? -1;
    return Ammunition.getForItem(id) === ammunition ? id : -1;
  }
  // Dizana's quiver fires its own ammo through the ranged ammo resolver, so the bow no longer reads the slot.
  const stored = Number(player.getAttribute?.(QUIVER_ATTRIBUTE)?.id ?? -1);
  return stored > 0 && Ammunition.getForItem(stored) === ammunition ? stored : -1;
}

function seekingMinimum(event) {
  const { attacker, damage, accurate } = event;
  if (!accurate || !attacker?.isPlayer?.() || event.combatType !== core.CombatType.RANGED) return;
  const player = attacker.getAsPlayer();
  if (player.isSpecialActivated()) return;
  const ammunition = player.getCombat().getAmmunition();
  if (ammunition === core.Ammunition.SEEKING_DRAGON_ARROW || seekingIds.has(firedAmmoId(player, event.hit, ammunition))) {
    damage.setDamage(Math.max(3, damage.getDamage()));
  }
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
