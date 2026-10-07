/**
 * Ava's attractor (10498) and Ava's accumulator (10499) recover a share of the
 * ammunition a player fires before it hits the floor: 60% and 72% respectively.
 * Core breaks 20% of every shot and drops the rest where the target stood.
 * OSRS Wiki: Ava's device.
 */

let Equipment;
let ItemIdentifiers;

function recoveryFor(player) {
  const capeId = player?.getEquipment?.()?.get?.(Equipment.CAPE_SLOT)?.getId?.() ?? -1;
  if (capeId === ItemIdentifiers.AVAS_ATTRACTOR) return 60;
  if (capeId === ItemIdentifiers.AVAS_ACCUMULATOR) return 72;
  return null;
}

module.exports = {
  name: "AvasAccumulator",
  register(api) {
    Equipment = api.core.Equipment;
    ItemIdentifiers = api.core.ItemIdentifiers;
    api.registerRangedAmmoRecovery({ recovery: recoveryFor });
  },
};
