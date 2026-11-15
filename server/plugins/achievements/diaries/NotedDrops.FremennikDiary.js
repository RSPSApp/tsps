/**
 * Fremennik Diary drops that come noted (OSRS Wiki: Dagannoth bones, Aviansie, Thorodin):
 * - elite: the Dagannoth Kings' bones drop as bank notes;
 * - hard: the adamantite bars of the God Wars Dungeon's aviansie drop noted. Aviansie in the
 *   Wilderness (its God Wars Dungeon) always drop them noted, whatever the diary; anywhere else
 *   they drop unnoted.
 * Thorodin switches the Kings' bones back to unnoted and noted again (Wiki: Thorodin, 30 June 2021
 * update; Transcript:Thorodin "About the Dagannoth Kings..."): his generated transcript asks which
 * way it is set, and his "Very well. In future..." line makes the change as it shows. The option
 * is about the elite reward ("Because you've completed the elite tasks..."), so it is offered
 * only once the elite diary is done.
 */
const DAGANNOTH_KING_IDS = new Set([2265, 2266, 2267]); // Supreme, Prime, Rex
const UNNOTED_BONES_ATTRIBUTE = "fremennik-diary:unnoted-dagannoth-bones";
const THORODIN = "Thorodin";
const KINGS_OPTION = "About the Dagannoth Kings...";
const NOTING_CONDITION = /^If the option to note Dagannoth bones is (enabled|disabled):$/;
const TURN_OFF_LINE = "Very well. In future, when you kill a Dagannoth King, they will drop their bones normally.";
const TURN_ON_LINE = "Very well. In future, when you kill a Dagannoth King, their bones will be noted.";
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
  if (itemId === DAGANNOTH_BONES && DAGANNOTH_KING_IDS.has(npcId)) {
    return tierComplete(player, "elite") && player.getAttribute?.(UNNOTED_BONES_ATTRIBUTE) !== true;
  }
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

const isThorodin = (definition) => definition?.getName?.() === THORODIN;

/** His "About the Dagannoth Kings..." option waits for the elite diary. */
function thorodinMenu(notice) {
  if (!isThorodin(notice.definition) || !Array.isArray(notice.options) || tierComplete(notice.player, "elite")) return;
  notice.options = notice.options.filter((option) => option?.text !== KINGS_OPTION);
}

/** "If the option to note Dagannoth bones is enabled/disabled:". */
function notingCondition({ player, definition, text }) {
  const match = isThorodin(definition) ? NOTING_CONDITION.exec(String(text ?? "").trim()) : null;
  if (!match) return null;
  const noted = player.getAttribute(UNNOTED_BONES_ATTRIBUTE) !== true;
  return match[1] === "enabled" ? noted : !noted;
}

/** The switch happens as his confirming line shows. */
function thorodinLine(request) {
  if (!isThorodin(request.definition)) return;
  const unnoted = request.text === TURN_OFF_LINE ? true : request.text === TURN_ON_LINE ? false : null;
  if (unnoted === null) return;
  request.before = () => request.player.setAttribute(UNNOTED_BONES_ATTRIBUTE, unnoted);
}

module.exports = (pluginApi) => {
  api = pluginApi;
  api.persistAttribute(UNNOTED_BONES_ATTRIBUTE, false);
  api.onCustomEvent("npc-drops:roll", notedDrops);
  api.onCustomEvent("npc-dialogue:menu", thorodinMenu);
  api.onCustomEvent("npc-dialogue:line", thorodinLine);
  api.onNpcDialogueCondition(notingCondition);
};
module.exports._test = { notedDrops, thorodinMenu, notingCondition, thorodinLine, UNNOTED_BONES_ATTRIBUTE };
