/**
 * The Harmonised nightmare staff's passive (Wiki: Harmonised nightmare staff): offensive spells from
 * the standard spellbook cast in 4 ticks instead of 5, "only when autocasting". A hand cast with
 * the staff wielded keeps the spell's 5 ticks, and the staff autocasts nothing from the other
 * spellbooks (Autocasting refuses them), so only a standard autocast is sped up.
 *
 * Ours: a hand cast is told from an autocast the way CombatRange does it, by the cast spell not
 * being the autocast one. A hand cast of the very spell being autocast can't be told apart, so it
 * casts in 4 ticks too.
 *
 * Dismantle (Wiki: "it can be reverted to its tradeable components at any time") gives back the
 * Nightmare staff and the Harmonised orb; the orb needs a free slot. The message is the item pages'
 * transcript line "You remove the orb from the staff." Combining is NightmareStaffOrbs.plugin.js. Preset (and other untradeable or unbankable) copies are refused, so a free
 * preset staff can't become tradeable parts.
 */
const AUTOCAST_SPEED = 4;
const PRESET_TEXT = "Preset items cannot be used for this.";
const REMOVE_TEXT = "You remove the orb from the staff.";

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

function restricted(item) {
  const { Item } = core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

/** Dismantle: the staff's own slot takes the Nightmare staff, a free slot the orb. */
function dismantle({ player, item }) {
  const { Item, ItemIdentifiers } = core;
  const inventory = player.getInventory();
  const slot = inventory.getItems().indexOf(item);
  if (slot < 0 || item.getId() !== ItemIdentifiers.HARMONISED_NIGHTMARE_STAFF) return false;
  if (restricted(item)) {
    player.sendMessage(PRESET_TEXT);
    return true;
  }
  if (inventory.getFreeSlots() < 1) {
    inventory.full();
    return true;
  }
  inventory.setItem(slot, new Item(ItemIdentifiers.NIGHTMARE_STAFF, 1));
  inventory.add(new Item(ItemIdentifiers.HARMONISED_ORB, 1), false);
  inventory.refreshItems();
  player.sendMessage(REMOVE_TEXT);
  return true;
}

module.exports = {
  name: "HarmonisedNightmareStaff",
  description: "The Harmonised nightmare staff autocasts standard-spellbook combat spells in 4 ticks, and dismantles into the Nightmare staff and Harmonised orb.",
  members: true,
  register(api) {
    core = api.core;
    api.onAttackSpeed(attackSpeed);
    api.onItemAction("Harmonised Nightmare staff", { Dismantle: dismantle });
  },
  _test: { dismantle },
};
