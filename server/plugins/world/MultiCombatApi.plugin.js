let worldDefinition;

/** Public gameplay bounds only; the complete world/editor resource remains development-only. */
function multiCombatBounds(_query, segments) {
  if (segments.length) return undefined;
  return worldDefinition.getWorldDefinition().zones
    .filter((zone) => zone.tags.includes("multi-combat"))
    .flatMap(({ minX, maxX, minY, maxY, z }) => minX === undefined
      ? [0, 1, 2, 3].map((plane) => ({ minX: 0, maxX: 0x3fff, minY: 0, maxY: 0x3fff, z: plane }))
      : [{ minX, maxX, minY, maxY, z: z ?? 0 }]);
}

module.exports = {
  name: "MultiCombatApi",
  register(api) {
    worldDefinition = api.core.WorldDefinition;
    api.registerContentEndpoint("multi-combat", multiCombatBounds);
  },
};
