/**
 * Fremennik Diary drops that come noted (OSRS Wiki: Dagannoth bones, Aviansie, Thorodin):
 * - elite: the Dagannoth Kings' bones drop as bank notes;
 * - hard: the adamantite bars of the God Wars Dungeon's aviansie drop noted. Aviansie in the
 *   Wilderness (its God Wars Dungeon) always drop them noted, whatever the diary; anywhere else
 *   they drop unnoted.
 * The Wiki also lets Thorodin switch the bones' noting off; that toggle is not here (no capture of
 * his lines, and his dialogue is generated).
 */
const DAGANNOTH_KING_IDS = new Set([2265, 2266, 2267]); // Supreme, Prime, Rex
const AVIANSIE = "Aviansie";
const GODWARS_DUNGEON = { minX: 2816, maxX: 2943, minY: 5248, maxY: 5375 };

let api;

function tierComplete(player, tier) {
  const request = { player, diary: "fremennik", tier, complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function inGodWarsDungeon(location) {
  const x = location?.getX?.();
  const y = location?.getY?.();
  return x >= GODWARS_DUNGEON.minX && x <= GODWARS_DUNGEON.maxX && y >= GODWARS_DUNGEON.minY && y <= GODWARS_DUNGEON.maxY;
}

function notesDrop(player, npc, npcId, itemId) {
  const { ADAMANTITE_BAR, DAGANNOTH_BONES } = api.core.ItemIdentifiers;
  if (itemId === DAGANNOTH_BONES && DAGANNOTH_KING_IDS.has(npcId)) return tierComplete(player, "elite");
  if (itemId === ADAMANTITE_BAR && npc?.getDefinition?.()?.getName?.() === AVIANSIE) {
    const location = npc.getLocation?.();
    if (api.core.Wilderness.isInLocation(location)) return true;
    return inGodWarsDungeon(location) && tierComplete(player, "hard");
  }
  return false;
}

/** Marks the rolled drops this diary tier notes. */
function notedDrops({ player, npc, npcId, drops }) {
  if (player?.isPlayer?.() !== true) return;
  for (const drop of drops) {
    if (drop.noted !== true && notesDrop(player, npc, npcId ?? npc?.getId?.(), drop.itemId)) drop.noted = true;
  }
}

module.exports = (pluginApi) => {
  api = pluginApi;
  api.onCustomEvent("npc-drops:roll", notedDrops);
};
module.exports._test = { notedDrops };
