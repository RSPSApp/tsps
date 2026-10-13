"use strict";

/**
 * The Tombs of Amascut's Combat Achievements (plugins/combatachievements/) that the raid's end
 * decides: the completion counts per mode (Entry's tasks count every mode, "Entry mode (or
 * above)"), the raid level, the deaths, the party size, the time and the invocations. The room
 * tasks (Perfect Het and the rest) need the rooms to say how they went and are not done yet.
 */

const Shared = require("./ToaShared");

const MONSTER = { entry: "EM: Tombs of Amascut", normal: "Tombs of Amascut", expert: "XM: Tombs of Amascut" };
/** "Complete the Tombs of Amascut in Entry mode (or above)": completions of any mode. */
const ANY_MODE = [["Novice Tomb Explorer", 1], ["Novice Tomb Looter", 25], ["Novice Tomb Raider", 50]];
const LEVEL = [["Movin' on up", 50], ["Confident Raider", 100]];
const LEVEL_WITHOUT_DEATHS = [["Something of an expert myself", 350], ["Amascut's Remnant", 500]];
const FULL_PARTY = 8;

function completed(raid, player, mode, counts) {
  const api = Shared.api();
  const complete = (task) => api.emitCustomEvent("combat-achievements:complete", { player, task });
  const key = mode.toLowerCase();
  api.emitCustomEvent("combat-achievements:kill", { player, monster: MONSTER[key], count: counts[key] });
  const total = Object.values(counts).reduce((sum, count) => sum + (Number(count) || 0), 0);
  for (const [task, needed] of ANY_MODE) if (total >= needed) complete(task);
  const level = raid.raidLevel;
  for (const [task, needed] of LEVEL) if (level >= needed) complete(task);
  const deathless = raid.totalDeaths === 0;
  if (deathless) for (const [task, needed] of LEVEL_WITHOUT_DEATHS) if (level >= needed) complete(task);
  const party = raid.original.size;
  if (party >= 2 && deathless) complete("Hardcore Raiders");
  if (party <= 1 && raid.member(player).deaths === 0) complete("Hardcore Tombs");
  if (deathless && raid.settings.isActive("ON_A_DIET") && raid.settings.isActive("DEHYDRATION")) complete("Resourceful Raider");
  const minutes = raid.totalTicks * 0.6 / 60;
  if (key === "normal" && minutes <= 18) complete("Tombs Speed Runner");
  if (key === "expert" && minutes <= 20) complete("Tombs Speed Runner II");
  if (key === "expert" && minutes <= 18 && party >= FULL_PARTY) complete("Tombs Speed Runner III");
}

/** At login: the completion counts, so earlier raids finish their kill-count tasks. */
function answerKillCount({ player, counts }) {
  // Required here: the raid requires this unit.
  const saved = player.getAttribute(require("./ToaRaid").ATTR_KILL_COUNTS) ?? {};
  for (const [key, monster] of Object.entries(MONSTER)) if (Number(saved[key]) > 0) counts[monster] = Number(saved[key]);
  const total = Object.values(saved).reduce((sum, count) => sum + (Number(count) || 0), 0);
  for (const [task, needed] of ANY_MODE) {
    if (total >= needed) Shared.api().emitCustomEvent("combat-achievements:complete", { player, task });
  }
}

module.exports = function registerToaCombatAchievements(api) {
  api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};
module.exports.completed = completed;
