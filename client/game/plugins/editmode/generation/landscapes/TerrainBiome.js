// Portable normalization of captured biome materials and native object profiles.
function normalizeTerrainBiome(doc) {
  const sortedUnique = values => [...new Set(values.filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
  const treeIds = sortedUnique(doc?.ids?.treeIds ?? []);
  const underlayIds = sortedUnique(doc?.ids?.underlayIds ?? []);
  const groundDecorationIds = sortedUnique(doc?.ids?.groundDecorationIds ?? []);
  const buildProfileById = (fieldName, ids, fallbackType) => {
    const counts = new Map();
    for (const sample of doc.samples) {
      const entries = Array.isArray(sample?.[fieldName]) ? sample[fieldName] : [];
      for (const entry of entries) {
        const id = entry?.id | 0;
        if (id <= 0) {
          continue;
        }
        const type = entry?.type | 0;
        const orientation = (entry?.orientation | 0) & 0x3;
        const weight = Math.max(1, entry?.count | 0);
        const key = `${id}:${type}:${orientation}`;
        counts.set(key, (counts.get(key) ?? 0) + weight);
      }
    }

    const profile = {};
    for (const id of ids) {
      let best = null;
      for (const [key, count] of counts.entries()) {
        const [idText, typeText, orientationText] = key.split(":");
        if ((Number.parseInt(idText, 10) | 0) !== (id | 0)) {
          continue;
        }
        const candidate = {
          type: Number.parseInt(typeText, 10) | 0,
          orientation: Number.parseInt(orientationText, 10) & 0x3,
          count: count | 0,
        };
        if (!best || candidate.count > best.count) {
          best = candidate;
        }
      }
      profile[String(id)] = best
        ? { type: best.type, orientation: best.orientation }
        : { type: fallbackType | 0, orientation: 0 };
    }
    return profile;
  };
  return {
    treeIds, underlayIds, groundDecorationIds,
    treeProfileById: buildProfileById("treeProfiles", treeIds, 10),
    groundDecorationProfileById: buildProfileById("groundDecorationProfiles", groundDecorationIds, 22),
  };
}
module.exports = { normalizeTerrainBiome };
