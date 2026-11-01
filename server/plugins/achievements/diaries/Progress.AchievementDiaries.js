/**
 * Diary progress: which tasks a player has done and which rewards they have claimed, kept in
 * persisted attributes and shown through the varbits the cache's diary tab reads (scripts 56 and
 * 2200: started, and per tier count, complete and reward).
 *
 * As captured completing Ardougne easy tasks: the task's message and its tier's count land on the
 * same tick; when that was the tier's last task, its complete varbit and the congratulations box
 * follow 3 ticks later. (OSRS also sets a bit per task in a varp, but no cache script reads those,
 * so they are not sent.)
 */
const { TIERS, DIARIES, tierOfTask } = require("./Data.AchievementDiaries");

const TIER_COMPLETE_DELAY = 3;

/** Done task keys by diary key: { ardougne: ["<task key>", ...] }. */
const TASKS_ATTRIBUTE = "achievement-diaries:tasks";
/** Claimed tiers by diary key: { ardougne: ["easy"] }. */
const REWARDS_ATTRIBUTE = "achievement-diaries:rewards";
/** Save migration: each diary used to keep its own "diary.<key>.tasks" and "diary.<key>.rewards". */
const LEGACY_ATTRIBUTES = DIARIES.flatMap((diary) => [
  [`diary.${diary.key}.tasks`, TASKS_ATTRIBUTE, diary],
  [`diary.${diary.key}.rewards`, REWARDS_ATTRIBUTE, diary],
]);

let api;
let core;

function doneTasks(player, diary) {
  return new Set(player.getAttribute(TASKS_ATTRIBUTE)?.[diary.key] ?? []);
}

function claimedTiers(player, diary) {
  return new Set(player.getAttribute(REWARDS_ATTRIBUTE)?.[diary.key] ?? []);
}

/** Replaces one diary's entry in a progress attribute; an empty one is left out. */
function store(player, attribute, diary, values) {
  const all = { ...player.getAttribute(attribute) };
  if (values.length > 0) all[diary.key] = values;
  else delete all[diary.key];
  player.setAttribute(attribute, all);
}

function tierCount(player, diary, tier) {
  const done = doneTasks(player, diary);
  return diary.tiers[tier].tasks.filter((task) => done.has(task.key)).length;
}

function isTierComplete(player, diary, tier) {
  return tierCount(player, diary, tier) === diary.tiers[tier].tasks.length;
}

function isStarted(player, diary) {
  return doneTasks(player, diary).size > 0;
}

function sendTier(player, diary, tier, { onlySet = false } = {}) {
  const sender = player.getPacketSender();
  const data = diary.tiers[tier];
  const values = [
    [data.countVarbit, tierCount(player, diary, tier)],
    [data.completeVarbit, isTierComplete(player, diary, tier) ? (data.completeValue ?? 1) : 0],
    [data.rewardVarbit, claimedTiers(player, diary).has(tier) ? 1 : 0],
  ];
  for (const [varbit, value] of values) if (!onlySet || value !== 0) sender.sendVarbit(varbit, value);
}

function sendDiary(player, diary, options) {
  const started = isStarted(player, diary) ? 1 : 0;
  if (!options?.onlySet || started) player.getPacketSender().sendVarbit(diary.startedVarbit, started);
  for (const tier of TIERS) sendTier(player, diary, tier, options);
}

function migrateLegacy(player) {
  for (const [legacy, attribute, diary] of LEGACY_ATTRIBUTES) {
    const values = player.getAttribute(legacy);
    if (!Array.isArray(values)) continue;
    store(player, attribute, diary, values);
    player.setAttribute(legacy, null);
  }
}

/** On login, as captured: only what is set. */
function restore({ player }) {
  migrateLegacy(player);
  for (const diary of DIARIES) sendDiary(player, diary, { onlySet: true });
}

function announceTierComplete(player, diary, tier) {
  if (!player.isRegistered() || !isTierComplete(player, diary, tier)) return;
  const data = diary.tiers[tier];
  player.getPacketSender().sendVarbit(data.completeVarbit, data.completeValue ?? 1);
  api.emitCustomEvent("diary:tier-complete", { player, diary: diary.name, tier });
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(
    new core.StatementDialogue(0, `Congratulations! You have completed all of the ${tier} tasks in the ${diary.name} area. Speak to ${diary.npcAt} to claim your reward.`),
    new core.EndDialogue(1),
  ));
}

/** Marks a task done; false when it already was (or is unknown). */
function completeTask(player, diary, taskKey) {
  const tier = tierOfTask(diary, taskKey);
  if (!tier) return false;
  const done = doneTasks(player, diary);
  if (done.has(taskKey)) return false;
  const wasStarted = done.size > 0;
  done.add(taskKey);
  store(player, TASKS_ATTRIBUTE, diary, [...done]);
  const sender = player.getPacketSender();
  player.sendMessage(`<col=dc143c>Well done! You have completed ${tier === "easy" || tier === "elite" ? "an" : "a"} ${tier} task in the ${diary.name} area. Your Achievement Diary has been updated.</col>`);
  sender.sendVarbit(diary.tiers[tier].countVarbit, tierCount(player, diary, tier));
  if (!wasStarted) sender.sendVarbit(diary.startedVarbit, 1);
  if (isTierComplete(player, diary, tier)) {
    api.emitCustomEvent("persistence:save", { player, reason: "diary-tier-completion" });
    api.getTaskManager().submit(new (class extends core.Task {
      constructor() { super(TIER_COMPLETE_DELAY); }
      execute() { this.stop(); announceTierComplete(player, diary, tier); }
    })());
  }
  return true;
}

function claimTier(player, diary, tier) {
  const claimed = claimedTiers(player, diary);
  claimed.add(tier);
  store(player, REWARDS_ATTRIBUTE, diary, [...claimed]);
  api.emitCustomEvent("persistence:save", { player, reason: "diary-tier-reward" });
  player.getPacketSender().sendVarbit(diary.tiers[tier].rewardVarbit, 1);
}

/** Clears tiers' tasks and rewards (the admin command's reset). */
function resetTiers(player, diary, tiers) {
  const keys = new Set(tiers.flatMap((tier) => diary.tiers[tier].tasks.map((task) => task.key)));
  store(player, TASKS_ATTRIBUTE, diary, [...doneTasks(player, diary)].filter((key) => !keys.has(key)));
  store(player, REWARDS_ATTRIBUTE, diary, [...claimedTiers(player, diary)].filter((tier) => !tiers.includes(tier)));
  sendDiary(player, diary);
}

module.exports = function attachProgress(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.persistAttribute(TASKS_ATTRIBUTE, {});
  api.persistAttribute(REWARDS_ATTRIBUTE, {});
  for (const [legacy] of LEGACY_ATTRIBUTES) api.persistAttribute(legacy, null);
  api.onPlayerLogin(restore);
};

Object.assign(module.exports, {
  TASKS_ATTRIBUTE, REWARDS_ATTRIBUTE, doneTasks, claimedTiers, tierCount, isTierComplete,
  completeTask, claimTier, resetTiers, restore, sendDiary,
});
