const { plain } = require('../monsterexamine/Drops.MonsterExamine');
const MAX_DEFINITIONS = 65536;
const MAX_QUERY = 50;

// A cache entry can be a tournament, prop or cutscene copy with Attack and combat
// stats. Only configured spawns and source-owned playable encounters establish
// catalogue membership. Never infer it from a name or a combat-method binding.
function playableIds(core, encounters = []) {
  const ids = new Set();
  const count = Math.min(MAX_DEFINITIONS, core.CacheDefinitions.getCounts().npcs);
  const pending = [...encounters];
  for (const spawn of core.NpcSpawnDefinition.all()) pending.push(spawn.getId());
  while (pending.length && ids.size < MAX_DEFINITIONS) {
    const id = pending.pop();
    if (!Number.isInteger(id) || id < 0 || id >= count || ids.has(id)) continue;
    ids.add(id);
    for (const child of core.CacheDefinitions.getNpc(id).transforms ?? []) pending.push(child);
  }
  return ids;
}
function encounterIds(api) {
  const request = { npcIds: new Set() };
  api.emitCustomEvent('bestiary:encounters', request);
  return request.npcIds;
}
function catalog(core, encounters = []) {
  const rows = [];
  const count = Math.min(MAX_DEFINITIONS, core.CacheDefinitions.getCounts().npcs);
  for (const id of playableIds(core, encounters)) {
    if (id >= count) continue;
    const definition = core.NpcDefinition.forId(id);
    const level = definition.getCombatLevel();
    if (!definition.isAttackable() || !Number.isInteger(level) || level <= 0) continue;
    const name = plain(definition.getName(), 100);
    if (!name || name.toLowerCase() === 'null') continue;
    rows.push({ id, name, level, hp: definition.getHitpoints() });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.level - b.level || a.id - b.id);
}
function normalizeQuery(query) { return plain(String(query ?? '').trim(), MAX_QUERY); }
function search(rows, query) {
  const term = normalizeQuery(query).toLowerCase();
  if (!term) return rows;
  if (/^\d+$/.test(term)) return rows.filter(row => row.id === Number(term));
  const words = term.split(/\s+/);
  return rows.filter(row => words.every(word => row.name.toLowerCase().includes(word)));
}
function groupedEntries(rows, animationFor) {
  const names = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.name, row.level]);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(row);
  }
  const entries = []; let groupId = rows.reduce((max, row) => Math.max(max, row.id + 1), 0) + 1;
  const entry = row => ({ id: row.id + 1, name: row.name, detail: String(row.level), npc: row.id, terms: String(row.id),
    animation: animationFor(row.id), panel: { stats: `NPC ID ${row.id}` } });
  for (const variants of names.values()) {
    if (variants.length === 1) { entries.push(entry(variants[0])); continue; }
    const id = groupId++, first = variants[0];
    entries.push({ ...entry(first), id, terms: '', expandable: true, collapsed: true,
      panel: { stats: `${variants.length} Variants` } });
    entries.push(...variants.map(row => ({ ...entry(row), parentId: id })));
  }
  return entries;
}
module.exports = { catalog, playableIds, encounterIds, groupedEntries, search, normalizeQuery, MAX_DEFINITIONS, MAX_QUERY };
