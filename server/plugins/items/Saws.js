"use strict";

/**
 * One rule for "the player has a saw", shared by every tool check that accepts one (Construction at
 * home and Mahogany Homes, STASH units, Tower of Life, Daddy's Home): the saw, the crystal saw or
 * Amy's saw, carried or wielded. Wiki (Amy's saw): it works as a saw and can be wielded, in the
 * weapon slot or, as its off-hand copy, the shield slot.
 */
function sawIds(core) {
  const I = core.ItemIdentifiers;
  return [I.SAW, I.CRYSTAL_SAW, I.AMYS_SAW, I.AMYS_SAW_OFF_HAND_];
}

function holdsSaw(core, player) {
  const ids = sawIds(core);
  const inventory = player.getInventory();
  if (ids.some((id) => inventory.getAmount(id) > 0)) return true;
  const equipment = player.getEquipment?.();
  const wielded = [core.Equipment.WEAPON_SLOT, core.Equipment.SHIELD_SLOT].map((slot) => equipment?.get?.(slot)?.getId?.());
  return ids.some((id) => wielded.includes(id));
}

module.exports = { sawIds, holdsSaw };
