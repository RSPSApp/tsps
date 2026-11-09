/**
 * Zombie pirates at the Chaos Temple (Wilderness, level 11).
 *
 * The Wiki gives them two drop tables, and npc-drops.json carries both, each calibrated to the
 * rate the Wiki states:
 *
 *   zombie_pirate_2  "Regular drops"                  15% chance of loot beyond bones
 *   zombie_pirate    "Medium Wilderness Diary drops"  50% chance, once the Medium Wilderness
 *                                                     Diary is complete
 *
 * The NPC lists the regular table first, so without an answer to npc-drops:table the diary table
 * is never rolled and completing the diary changes nothing. This picks the diary table for the
 * five Chaos Temple ids when the player has the diary.
 *
 * The level-57 zombie pirates (Braindeath Island, Harmony Island) are a different monster with a
 * single table and are not touched here.
 */
const ZOMBIE_PIRATE_IDS = new Set([13489, 13490, 13491, 13492, 13493]);
const DIARY_TABLE = "zombie_pirate";
const DIARY = "wilderness";
const TIER = "medium";

let api = null;

/** Whether the player has completed the Medium Wilderness Diary (asked of the diary plugin). */
function diaryComplete(player) {
  const query = { player, diary: DIARY, tier: TIER, complete: false };
  api.emitCustomEvent("diary:is-complete", query);
  return query.complete === true;
}

/** npc-drops:table { player, npc, npcId, tables, table }: pick the diary table when it applies. */
function chooseTable(request) {
  if (!ZOMBIE_PIRATE_IDS.has(request.npcId)) return;
  if (!request.player || !diaryComplete(request.player)) return;
  const diary = (request.tables || []).find((table) => table.table_id === DIARY_TABLE);
  if (diary) request.table = diary;
}

module.exports = {
  name: "ZombiePirates",
  description: "Picks the Medium Wilderness Diary drop table for Chaos Temple zombie pirates once the player has completed that diary.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    pluginApi.onCustomEvent("npc-drops:table", chooseTable);
  },
  _test: { chooseTable, diaryComplete, ZOMBIE_PIRATE_IDS, DIARY_TABLE, DIARY, TIER },
};
