"use strict";

/**
 * One rule for "the player has a hammer", shared by the tool checks that accept any hammer (Construction at home,
 * Smithing, STASH units): the hammer or the Imcando hammer, carried or wielded. Wiki (Imcando hammer): it works as a
 * hammer and can be wielded, in the weapon slot or, as its off-hand copy, the shield slot.
 */
function hammerIds(core) {
  const I = core.ItemIdentifiers;
  return [I.HAMMER, I.IMCANDO_HAMMER, I.IMCANDO_HAMMER_OFF_HAND_];
}

function holdsHammer(core, player) {
  const ids = hammerIds(core);
  const inventory = player.getInventory();
  if (ids.some((id) => inventory.getAmount(id) > 0)) return true;
  const equipment = player.getEquipment?.();
  const wielded = [core.Equipment.WEAPON_SLOT, core.Equipment.SHIELD_SLOT].map((slot) => equipment?.get?.(slot)?.getId?.());
  return ids.some((id) => wielded.includes(id));
}

module.exports = { hammerIds, holdsHammer };
