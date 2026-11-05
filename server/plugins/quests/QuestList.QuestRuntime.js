/** Cache 241 quest DB table 0. Column names are resolved through gamevals. */
const QUEST_TABLE = 0;
const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
let metadataCache;
function metadata(cache) {
  if (metadataCache) return metadataCache;
  if (!cache?.getDbTableRows) return new Map();
  const columns = cache.getDbColumns(QUEST_TABLE);
  const result = new Map();
  for (const row of cache.getDbTableRows(QUEST_TABLE)) {
    const data = { rowId: row.id };
    for (const name of columns) data[name] = row.column(cache.getDbColumn(QUEST_TABLE, name));
    result.set(normalize(data.displayname?.[0]), data);
  }
  metadataCache = result;
  return result;
}
/** A registered quest's row in the cache quest table (matched by display name), or undefined. */
function questMetadata(quest, cache) {
  return metadata(cache).get(normalize(quest.name));
}
/** Native 399:7 children use the cache id column, independent of visual order or filters. */
function nativeQuestIndex(quests, cache) {
  const all = [...metadata(cache).values()];
  const byRow = new Map(all.map(row => [row.rowId, row]));
  const registered = new Map();
  for (const quest of quests) {
    const row = questMetadata(quest, cache);
    if (row) registered.set(row.rowId, quest);
  }
  const result = new Map();
  for (const row of all) {
    let current = row;
    const seen = new Set();
    while (current && !registered.has(current.rowId) && !seen.has(current.rowId)) {
      seen.add(current.rowId);
      current = byRow.get(current.parent_quest?.[0]);
    }
    const id = row.id?.[0];
    if (current && registered.has(current.rowId) && Number.isInteger(id) && id >= 0 && id < 65535) {
      result.set(id, registered.get(current.rowId));
    }
  }
  return result;
}
function questRowById(id, cache) {
  if (!Number.isInteger(id) || id < 0) return undefined;
  return [...metadata(cache).values()].find(row => row.id?.[0] === id);
}
module.exports = { metadata, questMetadata, nativeQuestIndex, questRowById };
