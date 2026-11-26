/**
 * Hallowfell (Wiki: Hallowfell): one full hit, plus up to two unique enemies in the
 * five adjacent tiles around the attacker's facing. Each extra hit rolls its own
 * accuracy and damage up to half its victim's maximum, before flat armour and XP.
 */
function resolver(api) {
  const { core } = api;
  const directions = [core.Direction.NORTH, core.Direction.NORTH_EAST, core.Direction.EAST,
    core.Direction.SOUTH_EAST, core.Direction.SOUTH, core.Direction.SOUTH_WEST,
    core.Direction.WEST, core.Direction.NORTH_WEST];
  const method = new (class HallowfellCombatMethod extends core.MeleeCombatMethod {
    hits(character, target) {
      const hits = super.hits(character, target);
      if (!core.CombatFactory.areaAttackSpreads(character, target)) return hits;
      const origin = character.getLocation();
      // Use the actor's attack facing, including its retained heading while overlapping.
      const facing = directions.indexOf(character.getFacingDirection());
      if (facing < 0) return hits;
      const arc = [-2, -1, 0, 1, 2].map(offset => directions[(facing + offset + 8) % 8]);
      const candidates = [];
      core.World.getNpcs().forEach(npc => candidates.push(npc));
      core.World.getPlayers().forEach(player => candidates.push(player));
      for (const victim of candidates) {
        if (hits.length === 3) break;
        if (victim === character || victim === target) continue;
        const at = victim.getLocation();
        const size = victim.isNpc() ? victim.getAsNpc().getSize() : 1;
        if (at.getZ() !== origin.getZ() || !arc.some(direction =>
          origin.getX() + direction.getX() >= at.getX() && origin.getX() + direction.getX() < at.getX() + size &&
          origin.getY() + direction.getY() >= at.getY() && origin.getY() + direction.getY() < at.getY() + size)) continue;
        // The arc already bounds reach; no distance from a distant Leagues primary is imposed.
        if (!core.CombatFactory.canAttackSecondaryTarget(character, target, victim)) continue;
        hits.push(new core.PendingHit(character, victim, this, { hitMaximumSplitCount: 2 }));
      }
      return hits;
    }
  })();
  function resolve(attacker) {
    if (!attacker?.isPlayer?.()) return null;
    const player = attacker.getAsPlayer();
    if (player.isSpecialActivated() || core.Autocasting.isActive(player) ||
      player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId() !== core.ItemIdentifiers.HALLOWFELL) return null;
    return method;
  }
  return { resolve };
}

module.exports = {
  name: "Hallowfell",
  description: "Hallowfell cleaves up to two additional nearby enemies, with independent accuracy and half-maximum damage rolls.",
  members: true,
  register(api) {
    api.registerCombatMethodResolver(resolver(api));
  },
};
