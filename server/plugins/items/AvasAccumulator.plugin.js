/**
 * Ava's attractor and Ava's accumulator recover a share of the ammunition a player fires
 * before it hits the floor: 60% and 72% respectively. Core breaks 20% of every shot and drops
 * the rest where the target stood. The assembler and its Masori/max-cape variants recover 80%;
 * an accumulator max cape keeps 72%. A worn Ranging cape (or max cape) recovers as an
 * accumulator, or 80% once Vorkath's head has upgraded it (the Skillcapes plugin's
 * "skillcape:ammo-recovery").
 * None of them recovers anything while the player wears a metal torso from the Wiki's
 * Metallic interference table (data/avas-metallic-interference.json); Dizana's quiver, which
 * answers for itself, is not affected.
 * OSRS Wiki: Ava's device, Ava's assembler, Ranging cape, Max cape.
 */

const INTERFERENCE = require("./data/avas-metallic-interference.json");

let Equipment;
let pluginApi;
let attractors;
let accumulators;
let assemblers;
let interferingTorsos;

function ids(ItemIdentifiers, names) {
  return new Set(names.map((name) => ItemIdentifiers[name]).filter(Number.isInteger));
}

function objIds(CacheDefinitions, rows) {
  const result = new Set();
  for (const name of Object.values(rows).flat()) {
    const id = CacheDefinitions.getObjId(name);
    if (!Number.isInteger(id)) throw new Error(`[AvasAccumulator] unknown obj gameval ${name}`);
    result.add(id);
  }
  return result;
}

function worn(player, slot) {
  return player?.getEquipment?.()?.get?.(slot)?.getId?.() ?? -1;
}

function capeRecovery(player) {
  const capeId = worn(player, Equipment.CAPE_SLOT);
  if (attractors.has(capeId)) return 60;
  if (accumulators.has(capeId)) return 72;
  if (assemblers.has(capeId)) return 80;
  const cape = { player, recovery: null };
  pluginApi?.emitCustomEvent("skillcape:ammo-recovery", cape);
  return cape.recovery;
}

function recoveryFor(player) {
  const recovery = capeRecovery(player);
  if (recovery == null) return null;
  return interferingTorsos.has(worn(player, Equipment.BODY_SLOT)) ? 0 : recovery;
}

module.exports = {
  name: "AvasAccumulator",
  description: "Ava's attractor, accumulator and assembler: recover 60% to 80% of fired ammunition, blocked by metal body armour.",
  register(api) {
    pluginApi = api;
    Equipment = api.core.Equipment;
    const ItemIdentifiers = api.core.ItemIdentifiers;
    interferingTorsos = objIds(api.core.CacheDefinitions, INTERFERENCE.interferes);
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
