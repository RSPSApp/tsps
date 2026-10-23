/**
 * Ava's attractor and Ava's accumulator recover a share of the ammunition a player fires
 * before it hits the floor: 60% and 72% respectively. Core breaks 20% of every shot and drops
 * the rest where the target stood. The assembler and its Masori/max-cape variants recover 80%;
 * an accumulator max cape keeps 72%. A worn Ranging cape (or max cape) recovers as an
 * accumulator, or 80% once Vorkath's head has upgraded it (the Skillcapes plugin's
 * "skillcape:ammo-recovery").
 * OSRS Wiki: Ava's device, Ava's assembler, Ranging cape, Max cape.
 */

let Equipment;
let pluginApi;
let attractors;
let accumulators;
let assemblers;

function ids(ItemIdentifiers, names) {
  return new Set(names.map((name) => ItemIdentifiers[name]).filter(Number.isInteger));
}

function recoveryFor(player) {
  const capeId = player?.getEquipment?.()?.get?.(Equipment.CAPE_SLOT)?.getId?.() ?? -1;
  if (attractors.has(capeId)) return 60;
  if (accumulators.has(capeId)) return 72;
  if (assemblers.has(capeId)) return 80;
  const cape = { player, recovery: null };
  pluginApi?.emitCustomEvent("skillcape:ammo-recovery", cape);
  return cape.recovery;
}

module.exports = {
  name: "AvasAccumulator",
  register(api) {
    pluginApi = api;
    Equipment = api.core.Equipment;
    const ItemIdentifiers = api.core.ItemIdentifiers;
    attractors = ids(ItemIdentifiers, ["AVAS_ATTRACTOR", "AVAS_ATTRACTOR_2"]);
    accumulators = ids(ItemIdentifiers, [
      "AVAS_ACCUMULATOR", "AVAS_ACCUMULATOR_2", "AVAS_ACCUMULATOR_3", "AVAS_ACCUMULATOR_4",
      "ACCUMULATOR_MAX_CAPE", "ACCUMULATOR_MAX_CAPE_2",
    ]);
    assemblers = ids(ItemIdentifiers, [
      "AVAS_ASSEMBLER", "AVAS_ASSEMBLER_2", "AVAS_ASSEMBLER_L_",
      "MASORI_ASSEMBLER", "MASORI_ASSEMBLER_2", "MASORI_ASSEMBLER_L_",
      "ASSEMBLER_MAX_CAPE", "ASSEMBLER_MAX_CAPE_2",
      "MASORI_ASSEMBLER_MAX_CAPE", "MASORI_ASSEMBLER_MAX_CAPE_2",
    ]);
    api.registerRangedAmmoRecovery({ recovery: recoveryFor });
  },
};
