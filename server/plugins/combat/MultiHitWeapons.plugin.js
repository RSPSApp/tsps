/**
 * Ordinary twin weapons: independent accuracy, two splats on the same tick, and a
 * split final maximum (odd remainder on the second hit). Wiki: Multi-hit weapons,
 * Sulphur blades, Glacial temotli, Earthbound tecpatl, Infernal tecpatl, Torag's hammers.
 * Uses the same PendingHit maximum splitting as DualMacuahuitl, without its first-hit gate.
 */
function resolver(core) {
  const { ItemIdentifiers: ids } = core;
  const weapons = new Set([
    ids.SULPHUR_BLADES, ids.GLACIAL_TEMOTLI, ids.EARTHBOUND_TECPATL, ids.INFERNAL_TECPATL,
    ids.TORAGS_HAMMERS, ids.TORAGS_HAMMERS_100, ids.TORAGS_HAMMERS_75,
    ids.TORAGS_HAMMERS_50, ids.TORAGS_HAMMERS_25,
  ]);
  const method = new (class extends core.MeleeCombatMethod {
    hits(character, target) {
      return [new core.PendingHit(character, target, this, {
        hitAmount: 2, hitMaximumSplitCount: 2, ordinary: true,
      })];
    }
  })();
  function resolve(attacker) {
    if (!attacker?.isPlayer?.()) return null;
    const player = attacker.getAsPlayer();
    if (player.isSpecialActivated() || core.Autocasting.isActive(player)
      || !weapons.has(player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId())) return null;
    return method;
  }
  return { resolve };
}

module.exports = {
  name: "MultiHitWeapons",
  description: "Twin-hit weapons such as sulphur blades, tecpatls and Torag's hammers: independent accuracy rolls and two hitsplats on the same tick.",
  register(api) {
    api.registerCombatMethodResolver(resolver(api.core));
  },
};
