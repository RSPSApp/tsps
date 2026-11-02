/**
 * Achievement diaries (https://oldschool.runescape.wiki/w/Achievement_Diary): progress, the diary
 * tab's task lists, reward claiming and the reward lamps, from
 * plugins/achievements/diaries/data/achievement-diaries.json. See docs/achievement-diaries.md.
 *
 * Other plugins complete tasks and ask about tiers through custom events:
 *   api.emitCustomEvent("diary:task", { player, diary: "ardougne", task: "<task key>" })
 *     -> sets `completed` true when the task was newly done
 *   api.emitCustomEvent("diary:is-complete", { player, diary: "ardougne", tier: "hard" })
 *     -> sets `complete`
 *   api.emitCustomEvent("diary:is-reward-claimed", { player, diary: "western", tier: "elite" })
 *     -> sets `claimed` from the canonical claimed-tier record, not task completion
 *   api.emitCustomEvent("diary:all-complete", { player })
 *     -> sets `complete` when every tier of every diary is done
 *   api.emitCustomEvent("diary:tokkul", { player, amount })
 *     -> doubles `amount` for the Elite Karamja Diary (TzHaar Fight Cave, Inferno, Ket-Rak's Challenges)
 *
 *   ::diary <name>                          each tier's progress
 *   ::diary <name> <tier|all> complete      complete the tier(s) task by task
 *   ::diary <name> <tier|all> reset         clear the tier(s), rewards included
 */
const { TIERS, DIARIES, BY_KEY } = require("./diaries/Data.AchievementDiaries");
const Progress = require("./diaries/Progress.AchievementDiaries");
const Journal = require("./diaries/Journal.AchievementDiaries");
const Rewards = require("./diaries/Rewards.AchievementDiaries");
const Lamps = require("./diaries/Lamps.AchievementDiaries");

const USAGE = "Usage: ::diary <name> [easy|medium|hard|elite|all] [complete|reset]";

function normalise(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A diary by key or name, any case, or a unique part of a name. */
function findDiaries(text) {
  const wanted = normalise(text);
  const exact = DIARIES.filter((diary) => diary.key === wanted || normalise(diary.name) === wanted);
  return exact.length > 0 ? exact : DIARIES.filter((diary) => normalise(diary.name).includes(wanted));
}

function onTask(request) {
  const diary = BY_KEY.get(request.diary);
  if (diary && request.player) request.completed = Progress.completeTask(request.player, diary, request.task);
}

function onIsComplete(request) {
  const diary = BY_KEY.get(request.diary);
  if (diary && request.player && TIERS.includes(request.tier)) {
    request.complete = Progress.isTierComplete(request.player, diary, request.tier);
  }
}
/** Claimed rewards are distinct from completed tasks (e.g. pet eligibility). */
function onIsRewardClaimed(request) {
  const diary = BY_KEY.get(request.diary);
  if (diary && request.player && TIERS.includes(request.tier))
    request.claimed = Progress.claimedTiers(request.player, diary).has(request.tier);
}

/** The Elite Karamja Diary doubles the Tokkul from the Fight Cave, the Inferno and Ket-Rak's Challenges. */
function onTokkul(request) {
  const diary = BY_KEY.get("karamja");
  if (diary && request.player && Progress.isTierComplete(request.player, diary, "elite")) request.amount *= 2;
}

function onAllComplete(request) {
  if (request.player) {
    request.complete = DIARIES.every((diary) => TIERS.every((tier) => Progress.isTierComplete(request.player, diary, tier)));
  }
}

function describe(player, diary) {
  const tiers = TIERS.map((tier) => `${tier} ${Progress.tierCount(player, diary, tier)}/${diary.tiers[tier].tasks.length}`);
  return `${diary.name}: ${tiers.join(", ")}.`;
}

function diaryCommand({ player, parts }) {
  const args = parts.slice(1).map((part) => part.toLowerCase());
  const action = ["complete", "reset"].includes(args.at(-1)) ? args.pop() : null;
  const tierArg = [...TIERS, "all"].includes(args.at(-1)) ? args.pop() : null;
  const name = args.join(" ");
  if (!name || (action && !tierArg)) {
    player.sendMessage(USAGE);
    return true;
  }
  const matches = findDiaries(name);
  if (matches.length !== 1) {
    player.sendMessage(matches.length === 0
      ? `No diary matches "${name}".`
      : `"${name}" matches ${matches.map((diary) => diary.name).join(", ")}.`);
    return true;
  }
  const [diary] = matches;
  const tiers = tierArg === "all" ? TIERS : tierArg ? [tierArg] : [];
  if (action === "complete") {
    for (const tier of tiers) for (const task of diary.tiers[tier].tasks) Progress.completeTask(player, diary, task.key);
  } else if (action === "reset") {
    Progress.resetTiers(player, diary, tiers);
  }
  player.sendMessage(describe(player, diary));
  return true;
}

module.exports = {
  name: "AchievementDiaries",
  members: true,
  register(api) {
    Progress(api);
    Journal(api);
    Rewards(api);
    Lamps(api);
    require("./diaries/Actions.AchievementDiaries")(api);
    api.onCustomEvent("diary:task", onTask);
    api.onCustomEvent("diary:is-complete", onIsComplete);
    api.onCustomEvent("diary:is-reward-claimed", onIsRewardClaimed);
    api.onCustomEvent("diary:all-complete", onAllComplete);
    api.onCustomEvent("diary:tokkul", onTokkul);
    api.registerCommand("diary", diaryCommand, api.core.PlayerRights.ADMINISTRATOR, "Show or set achievement diary progress: ::diary <name> [tier|all] [complete|reset]");
  },
  _test: { diaryCommand, findDiaries, onTask, onIsComplete, onAllComplete, onTokkul },
};
