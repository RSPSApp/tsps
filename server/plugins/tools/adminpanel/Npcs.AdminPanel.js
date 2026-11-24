const catalogues = new WeakMap();
function search(core, query) {
  const wanted = query.trim().toLowerCase();
  if (wanted.length < 2 && !/^\d+$/.test(wanted)) return [];
  let catalogue = catalogues.get(core);
  if (!catalogue || Date.now() - catalogue.at > 15000) {
    const count = (core.CacheDefinitions.getBaseCounts?.() ?? core.CacheDefinitions.getCounts()).npcs;
    const ids = new Set(Array.from({ length: count }, (_, id) => id));
    for (const entry of core.CacheDefinitions.getCustomDefinitions()) if (entry.kind === "npc") ids.add(entry.id);
    const rows = [];
    for (const id of ids) {
      try {
        const cached = core.CacheDefinitions.getNpc(id);
        const name = cached?.name;
        if (!name || name.toLowerCase() === "null" || !(cached.modelIds?.length || cached.models?.length)) continue;
        rows.push({ id, name, level: cached.combatLevel >= 0 ? cached.combatLevel : undefined,
          hp: cached.hitpoints > 0 ? cached.hitpoints : undefined });
      } catch { /* A cache hole is not a spawnable result. */ }
    }
    catalogue = { at: Date.now(), rows }; catalogues.set(core, catalogue);
  }
  return catalogue.rows.filter(row => row.name.toLowerCase().includes(wanted) || String(row.id) === wanted)
    .sort((a, b) => Number(b.name.toLowerCase() === wanted) - Number(a.name.toLowerCase() === wanted) || a.name.localeCompare(b.name) || a.id - b.id).slice(0, 50);
}
module.exports = { search };
