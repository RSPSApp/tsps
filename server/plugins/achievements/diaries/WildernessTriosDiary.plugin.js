/**
 * The Wilderness Diary's boss trios (https://oldschool.runescape.wiki/w/Wilderness_Diary):
 * - hard, "Kill the Crazy Arc., Chaos Fanatic & Scorpia";
 * - elite, "Kill Callisto, Venenatis & Vet'ion", where the lesser versions Artio, Spindel and Calvar'ion
 *   count for their greater ones.
 * The bosses can be killed in any order, but "completing or updating any other task in-between will reset
 * the progress for this task" (Wiki). The progress is the set of the trio's bosses killed so far, saved
 * with the player.
 *
 * A kill is the boss rewarding the player ("npc-drops:roll": the generic drops for the Crazy archaeologist,
 * Chaos Fanatic and Scorpia, and the Wilderness lairs' per-player shares for the rest), so everyone the boss
 * rewards is credited, as for its kill count. Another task's update is a task newly completed in this diary
 * ("diary:task" with `completed`), or the other trio advancing. INFERRED, no capture: killing the same boss
 * again is not progress; a completed trio no longer takes part (its bosses do not reset the other); and the
 * partial progress of the Red spiders' eggs task is not an event on main yet (#2435's progress
 * notifications), so it does not reset a trio until that lands.
 */
const Progress = require("./Progress.AchievementDiaries");
const { BY_KEY } = require("./Data.AchievementDiaries");
const BOSS_DATA = require("../../bosses/data/wilderness-bosses.json");

const DIARY = "wilderness";
const ATTRIBUTE = "wilderness-diary:trios";
const TRIOS = {
  hard: { task: "kill-the-crazy-arc-chaos-fanatic-scorpia", size: 3 },
  elite: { task: "kill-callisto-venenatis-vet-ion", size: 3 },
};
const HARD_BY_NAME = new Map([["Crazy archaeologist", "crazy"], ["Chaos Fanatic", "fanatic"], ["Scorpia", "scorpia"]]);
/** Every id of a lair boss and of its lesser version, by the greater boss it counts as ("Callisto" for Artio). */
const ELITE_BY_ID = new Map(BOSS_DATA.lairs.flatMap((lair) => lair.bossIds.map((id) => [id, lair.monster])));

let api;

const taskDone = (player, task) => Progress.doneTasks(player, BY_KEY.get(DIARY)).has(task);

function read(player) {
  const saved = player.getAttribute(ATTRIBUTE) ?? {};
  return { hard: new Set(saved.hard ?? []), elite: new Set(saved.elite ?? []) };
}

function write(player, state) {
  player.setAttribute(ATTRIBUTE, { hard: [...state.hard], elite: [...state.elite] });
}

function bossOf(npc, npcId) {
  if (ELITE_BY_ID.has(npcId)) return { trio: "elite", key: ELITE_BY_ID.get(npcId) };
  const key = HARD_BY_NAME.get(npc?.getDefinition?.()?.getName?.());
  return key ? { trio: "hard", key } : null;
}

/** A kill the boss was rewarded for: progress for its trio, forgetting the other's. */
function rewarded({ player, npc, npcId }) {
  if (player?.isPlayer?.() !== true || (player.getPrivateArea?.() ?? null) !== null) return;
  const boss = bossOf(npc, npcId ?? npc?.getId?.());
  if (!boss || taskDone(player, TRIOS[boss.trio].task)) return;
  const state = read(player);
  const other = boss.trio === "hard" ? "elite" : "hard";
  if (state[boss.trio].has(boss.key)) return;
  state[boss.trio].add(boss.key);
  // This task's update is another task's: the other trio starts again.
  state[other].clear();
  if (state[boss.trio].size >= TRIOS[boss.trio].size) {
    // Completing the task is itself an update, forgetting both runs.
    state[boss.trio].clear();
    write(player, state);
    api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TRIOS[boss.trio].task });
    return;
  }
  write(player, state);
  Progress.notifyTaskProgress(player, BY_KEY.get(DIARY), TRIOS[boss.trio].task);
}

/** Any task newly completed in this diary, a trio's own included, resets both trios. */
function taskUpdated(request) {
  if (request.diary !== DIARY || request.completed !== true || request.player == null) return;
  const state = read(request.player);
  if (state.hard.size === 0 && state.elite.size === 0) return;
  write(request.player, { hard: new Set(), elite: new Set() });
}

module.exports = {
  name: "WildernessTriosDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(ATTRIBUTE, null);
    api.onCustomEvent("npc-drops:roll", rewarded);
    api.onCustomEvent("diary:task", taskUpdated);
  },
  _test: { bossOf },
};
