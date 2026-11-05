/**
 * Wilderness Diary tasks (https://oldschool.runescape.wiki/w/Wilderness_Diary) whose activity the server
 * already has, credited on that activity's own success event and only where the Wiki puts it. The easy
 * tasks are Diary.Wilderness.js's, the Edgeville Dungeon's and the levers'; #2435 owns the Fountain of
 * Rune, Demonic Ruins and progress notifications.
 *
 * - Medium: a Bloodveld killed in the Wilderness God Wars Dungeon; talking to the Edgeville Emblem Trader
 *   about emblems.
 * - Medium: a Yew log from a fallen Ent's trunk in the Wilderness (the trunk reports its logs).
 * - Medium: entering the Wilderness God Wars Dungeon, on arriving inside through a crevice. The Wiki gives the
 *   task 60 Agility or Strength, which the cave doesn't need, so that point of credit is inferred.
 * - Hard: a Spiritual warrior killed there; the Trollheim agility shortcut into the Wilderness; one of the
 *   three god spells hitting another player in the Wilderness ("you have to successfully hit the player",
 *   so a splash does not count; the spell is the hit's own, not the caster's last cast).
 * - Elite: a Spiritual mage killed there.
 *
 * The dungeon is the rectangle of its NPC spawns (x 3018-3054, y 10118-10163) and a little around it, on
 * the Wilderness's own level map; the main God Wars Dungeon and the Wilderness Slayer Cave have the same
 * NPCs and do not count. The Emblem Trader task fires on his conversation's emblems line (the Wiki says
 * only "talk to him about emblems"; that line is inferred as the point of credit). Not credited here, and
 * why, is in the audit table of #2430: the orbs wait on the Kandarin PR's `crafting:made` event, the boss
 * trios need their own sequence state. The Muddy chest and the Rogues' chest are in
 * plugins/items/WildernessChests.plugin.js; the Resource Area's gate and fee are in areas/ResourceArea.plugin.js
 * and its three reachable tasks in WildernessResourceDiary.plugin.js (the rune scimitar is not credited).
 */
const DIARY = "wilderness";

/** Wilderness God Wars Dungeon: its spawns' extent (x 3018-3054, y 10118-10163) with a margin. */
const GWD = { minX: 3010, maxX: 3065, minY: 10110, maxY: 10170 };
const KILLS = new Map([
  ["Bloodveld", "kill-a-bloodveld-in-the-wilderness-godwars-dunge"],
  ["Spiritual warrior", "kill-a-spiritual-warrior-in-the-wilderness-godwa"],
  ["Spiritual mage", "slay-a-spiritual-mage-inside-the-wilderness-godw"],
]);
const GWD_ENTRY = { crevice: 26767, task: "enter-the-wilderness-godwars-dungeon" };
const TROLLHEIM_SHORTCUT = { name: "Rocks (Wilderness, Trollheim)", task: "take-the-agility-shortcut-from-trollheim-into-th" };
const GOD_SPELLS = new Set([1190, 1191, 1192]); // Saradomin Strike, Claws of Guthix, Flames of Zamorak
const GOD_TASK = "cast-one-of-the-3-god-spells-against-another-pla";
const FALLEN_ENT = { where: "Wilderness", task: "chop-some-yew-logs-from-a-fallen-ent" };
const EMBLEM_TRADER = { npcId: 308, task: "talk-to-the-emblem-trader-in-edgeville-about-emb", line: "Don't suppose you've come across any strange emblems" };

let api;

const credit = (player, task) => api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
const inWilderness = (location) => api.core.Wilderness.levelAt(location.getX(), location.getY()) > 0;
const inPrivateArea = (entity) => (entity?.getPrivateArea?.() ?? null) !== null;

function inDungeon(location) {
  return location.getZ() === 0 && location.getX() >= GWD.minX && location.getX() <= GWD.maxX
    && location.getY() >= GWD.minY && location.getY() <= GWD.maxY && inWilderness(location);
}

function npcKilled({ killer, npc }) {
  if (killer?.isPlayer?.() !== true || inPrivateArea(npc)) return;
  const task = KILLS.get(npc?.getDefinition?.()?.getName?.());
  if (task && inDungeon(npc.getLocation())) credit(killer, task);
}

function enteredDungeon({ player, objectId }) {
  if (objectId === GWD_ENTRY.crevice && !inPrivateArea(player) && inDungeon(player.getLocation())) credit(player, GWD_ENTRY.task);
}

function shortcutCrossed({ player, shortcut }) {
  if (shortcut === TROLLHEIM_SHORTCUT.name && !inPrivateArea(player)) credit(player, TROLLHEIM_SHORTCUT.task);
}

function hitResolved({ attacker, target, hit }) {
  if (attacker?.isPlayer?.() !== true || target?.isPlayer?.() !== true || attacker === target) return;
  if (hit?.isAccurate?.() !== true || inPrivateArea(attacker)) return;
  // The hit's own spell: the caster's selected or previous cast outlives the cast (a later whip swing).
  if (GOD_SPELLS.has(hit.getSpell?.()?.spellId?.()) && inWilderness(attacker.getLocation()) && inWilderness(target.getLocation())) {
    credit(attacker, GOD_TASK);
  }
}

/** "Chop some yew logs from a fallen Ent": a Yew log from a Wilderness Ent's trunk (the guild's Ent is not). */
function entLogs({ player, itemId, where }) {
  if (itemId === api.core.ItemIdentifiers.YEW_LOGS && where === FALLEN_ENT.where && !inPrivateArea(player)) credit(player, FALLEN_ENT.task);
}

function dialogueLine(request) {
  if (request.npcId === EMBLEM_TRADER.npcId && typeof request.text === "string" && request.text.startsWith(EMBLEM_TRADER.line)) {
    credit(request.player, EMBLEM_TRADER.task);
  }
}

module.exports = {
  name: "WildernessDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    api.onNpcDeath(npcKilled);
    api.onCustomEvent("agility:obstacle", shortcutCrossed);
    api.onCustomEvent("loc-teleports:arrived", enteredDungeon);
    api.onCombatHitResolved(hitResolved);
    api.onCustomEvent("woodcutting:ent-logs", entLogs);
    api.onCustomEvent("npc-dialogue:line", dialogueLine);
  },
  _test: { inDungeon },
};
