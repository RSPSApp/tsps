/** Cache 241 quest DB table 0. Column names are resolved through gamevals. */
const QUEST_TABLE = 0;
const SORT_VARBIT = 13772;
const HIDE_BY_STATUS = [13775, 13776, 13777];
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
function questListGroups(quests, player, cache, statusOf, Skill) {
  const sender = player.getPacketSender();
  const value = id => sender.getVarbit?.(id) ?? 0;
  const all = metadata(cache);
  const number = (data, name) => Number(data?.[name]?.[0] ?? 0);
  const skillManager = player.getSkillManager?.();
  const stat = id => {
    const skill = Skill?.values().find(skill => skill.getClientId() === id);
    return skill ? skillManager?.getMaxLevel?.(skill) ?? 1 : skillManager?.getMaxLevels?.(id) ?? 1;
  };
  const combat = skillManager?.getCombatLevel?.() ?? 3;
  const completed = new Set(quests.filter(q => statusOf(q, player) === 2).map(q => all.get(normalize(q.name))?.rowId));
  const pairsMet = values => {
    for (let i = 0; i < (values?.length ?? 0); i += 2) if (stat(Number(values[i])) < Number(values[i + 1])) return false;
    return true;
  };
  const sort = value(SORT_VARBIT);
  const enumLabel = (id, key, fallback) => String(cache?.getEnumValues?.(id)?.get(key) ?? fallback);
  const list = [];
  for (const quest of quests) {
    const data = all.get(normalize(quest.name));
    const status = statusOf(quest, player);
    const type = number(data, 'type');
    if (value(HIDE_BY_STATUS[status]) || (type === 1 && value(13773)) || (type === 0 && value(13774))) continue;
    const requirements = pairsMet(data?.requirement_stats)
      && (data?.requirement_quests ?? []).every(id => completed.has(id))
      && (Number(player.getAttribute('quest.points')) || 0) >= number(data, 'requirement_questpoints')
      && combat >= number(data, 'requirement_combat');
    const recommended = pairsMet(data?.recommended_stats) && combat >= number(data, 'recommended_combat');
    const lackReq = status !== 2 && !requirements;
    const lackRec = status !== 2 && !recommended;
    const unavailable = (lackReq && value(13778) === 1) || (lackRec && value(13779) === 1);
    if ((lackReq && value(13778) === 2) || (lackRec && value(13779) === 2) || (unavailable && value(13890))) continue;
    const sortName = String(data?.sortname?.[0] ?? quest.name.replace(/^the\s+/i, ''));
    let group = '', order = '';
    switch (sort) {
      case 0: order = type === 1 ? 2 : number(data, 'members'); group = ['Free Quests', "Members' Quests", 'Miniquests'][order]; break;
      case 9: order = number(data, 'members'); group = order ? 'Members' : 'Free'; break;
      case 1: group = sortName.charAt(0).toUpperCase(); order = group; break;
      case 2: order = unavailable ? 3 : status; group = unavailable ? 'Unavailable' : enumLabel(2092, status, ['In progress', 'Not started', 'Complete'][status]); break;
      case 3: order = number(data, 'difficulty'); group = enumLabel(2094, order, order); break;
      case 4: order = number(data, 'length'); group = enumLabel(2095, order, order); break;
      case 5: group = enumLabel(2097, number(data, 'series'), 'Other'); order = group; break;
      case 6: group = enumLabel(2096, number(data, 'location'), 'Other'); order = group; break;
      case 7: order = Math.max(number(data, 'requirement_combat'), number(data, 'recommended_combat')); group = `Level ${order}`; break;
      case 8: { const [day = 0, month = 0, year = 0] = data?.releasedate ?? []; order = year * 10000 + month * 100 + day; group = year ? String(year) : 'Unknown Year'; break; }
      case 10: order = type; group = enumLabel(2093, order, type ? 'Miniquests' : 'Quests'); break;
      case 11: order = number(data, 'ftue_starter'); group = enumLabel(5763, order, order); break;
      default: group = sortName.charAt(0).toUpperCase(); order = group;
    }
    list.push({ quest, status: unavailable ? 3 : status, sortName, group, order,
      seriesOrder: number(data, 'seriesno') });
  }
  list.sort((a, b) => (typeof a.order === 'number' ? a.order - b.order : String(a.order).localeCompare(String(b.order)))
    || (sort === 5 ? a.seriesOrder - b.seriesOrder : 0)
    || a.sortName.localeCompare(b.sortName) || a.quest.key.localeCompare(b.quest.key));
  const groups = [];
  for (const entry of list) {
    const title = value(13889) ? '' : entry.group;
    const previous = groups[groups.length - 1];
    if (previous && previous.title === title) previous.quests.push(entry);
    else groups.push({ title, quests: [entry] });
  }
  return groups;
}
module.exports = { questListGroups, metadata };
