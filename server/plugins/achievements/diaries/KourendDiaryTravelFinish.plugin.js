/**
 * Kourend & Kebos Diary finishing tasks for travel and services.
 *
 * Every task is credited only after its native action lands:
 * - Take a boat to Land's End: `ferries:arrived` route kourend-landsend (Veos/Cabin Boy
 *   Herbert), plugins/world/Ferries.plugin.js.
 * - Switch to the Necromancy Spellbook at Tyss: `tyss:spellbook-switched`,
 *   plugins/npcs/Tyss.plugin.js.
 * - Enter the Farming Guild: the guild's rectangular zone (the entrance doors are at 1248/1249,
 *   3723; the Guildmaster, seed vault and bank chest are inside).
 * - Use Kharedst's memoirs to teleport to all five cities: `kharedst:teleported`, recording each
 *   city until all five have been used.
 * - Teleport to Xeric's Heart using Xeric's talisman: `xerics-talisman:teleported` marked heart.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Kourend_%26_Kebos_Diary
 */
const DIARY = "kourend";
const DIARY_DATA = require("./Data.AchievementDiaries").BY_KEY.get(DIARY);
const DiaryProgress = require("./Progress.AchievementDiaries");
const BOAT_TASK = "take-a-boat-to-land-s-end";
const SPELLBOOK_TASK = "switch-to-the-necromancy-spellbook-at-tyss";
const FARMING_GUILD_TASK = "enter-the-farming-guild";
const MEMOIRS_TASK = "use-kharedst-s-memoirs-to-teleport-to-all-five-c";
const XERIC_TASK = "teleport-to-xeric-s-heart-using-xeric-s-talisman";
const MEMOIRS_CITIES = ["hosidius", "piscarilius", "shayzien", "lovakengj", "arceuus"];
const CITIES_ATTRIBUTE = "kourend-travel-finish:memoirs-cities";
const FARMING_GUILD_ZONE = { minX: 1237, maxX: 1269, minY: 3723, maxY: 3746, levels: [0] };

let api = null;

function active(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && player.isDyingReturn?.() !== true && player.getPrivateArea?.() == null;
}

function credit(player, task) {
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task });
}

function arrived({ player, route }) {
  if (route !== "kourend-landsend" || !active(player)) return;
  credit(player, BOAT_TASK);
}

function switchedBook({ player }) {
  if (!active(player)) return;
  credit(player, SPELLBOOK_TASK);
}

function enteredGuild({ player }) {
  if (!active(player)) return;
  credit(player, FARMING_GUILD_TASK);
}

function memoirs({ player, city }) {
  if (!active(player) || !MEMOIRS_CITIES.includes(city)) return;
  const seen = new Set(player.getAttribute(CITIES_ATTRIBUTE) ?? []);
  if (seen.has(city)) return;
  seen.add(city);
  player.setAttribute(CITIES_ATTRIBUTE, [...seen]);
  if (MEMOIRS_CITIES.every((name) => seen.has(name))) credit(player, MEMOIRS_TASK);
  else DiaryProgress.notifyTaskProgress(player, DIARY_DATA, MEMOIRS_TASK);
}

function xericsTalisman({ player, destination }) {
  if (destination !== "heart" || !active(player)) return;
  credit(player, XERIC_TASK);
}

module.exports = {
  name: "KourendDiaryTravelFinish",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(CITIES_ATTRIBUTE, []);
    api.onCustomEvent("ferries:arrived", arrived);
    api.onCustomEvent("tyss:spellbook-switched", switchedBook);
    api.onCustomEvent("kharedst:teleported", memoirs);
    api.onCustomEvent("xerics-talisman:teleported", xericsTalisman);
    api.onZoneEnter(FARMING_GUILD_ZONE, enteredGuild);
  },
  _test: {
    BOAT_TASK, SPELLBOOK_TASK, FARMING_GUILD_TASK, MEMOIRS_TASK, XERIC_TASK,
    MEMOIRS_CITIES, CITIES_ATTRIBUTE, FARMING_GUILD_ZONE, arrived, switchedBook, enteredGuild,
    memoirs, xericsTalisman,
  },
};
