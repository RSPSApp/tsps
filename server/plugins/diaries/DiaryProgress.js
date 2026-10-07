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
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { EndDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");
const { TIERS, DIARIES, tierOfTask } = require("./DiaryData");

const TIER_COMPLETE_DELAY = 3;

let TaskManager;

function bind(api) {
  TaskManager = api.getTaskManager();
}

const tasksAttribute = (diary) => `diary.${diary.key}.tasks`;
const rewardsAttribute = (diary) => `diary.${diary.key}.rewards`;

function doneTasks(player, diary) {
  return new Set(player.getAttribute(tasksAttribute(diary)) ?? []);
}

function claimedTiers(player, diary) {
  return new Set(player.getAttribute(rewardsAttribute(diary)) ?? []);
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

/** On login, as captured: only what is set. */
function restore({ player }) {
  for (const diary of DIARIES) sendDiary(player, diary, { onlySet: true });
}

class TierCompleteTask extends Task {
  constructor(player, diary, tier) {
    super(TIER_COMPLETE_DELAY);
    this.player = player;
    this.diary = diary;
    this.tier = tier;
  }

  execute() {
    this.stop();
    const { player, diary, tier } = this;
    if (!player.isRegistered() || !isTierComplete(player, diary, tier)) return;
    const data = diary.tiers[tier];
    player.getPacketSender().sendVarbit(data.completeVarbit, data.completeValue ?? 1);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, `Congratulations! You have completed all of the ${tier} tasks in the ${diary.name} area. Speak to ${diary.npcAt} to claim your reward.`),
      new EndDialogue(1),
    ));
  }
}

/** Marks a task done; false when it already was (or is unknown). */
function completeTask(player, diary, taskKey) {
  const tier = tierOfTask(diary, taskKey);
  if (!tier) return false;
  const done = doneTasks(player, diary);
  if (done.has(taskKey)) return false;
  const wasStarted = done.size > 0;
  done.add(taskKey);
  player.setAttribute(tasksAttribute(diary), [...done]);
  const sender = player.getPacketSender();
  player.sendMessage(`<col=dc143c>Well done! You have completed ${tier === "easy" || tier === "elite" ? "an" : "a"} ${tier} task in the ${diary.name} area. Your Achievement Diary has been updated.</col>`);
  sender.sendVarbit(diary.tiers[tier].countVarbit, tierCount(player, diary, tier));
  if (!wasStarted) sender.sendVarbit(diary.startedVarbit, 1);
  if (isTierComplete(player, diary, tier)) TaskManager.submit(new TierCompleteTask(player, diary, tier));
  return true;
}

function claimTier(player, diary, tier) {
  const claimed = claimedTiers(player, diary);
  claimed.add(tier);
  player.setAttribute(rewardsAttribute(diary), [...claimed]);
  player.getPacketSender().sendVarbit(diary.tiers[tier].rewardVarbit, 1);
}

/** Clears tiers' tasks and rewards (the admin command's reset). */
function resetTiers(player, diary, tiers) {
  const keys = new Set(tiers.flatMap((tier) => diary.tiers[tier].tasks.map((task) => task.key)));
  player.setAttribute(tasksAttribute(diary), [...doneTasks(player, diary)].filter((key) => !keys.has(key)));
  player.setAttribute(rewardsAttribute(diary), [...claimedTiers(player, diary)].filter((tier) => !tiers.includes(tier)));
  sendDiary(player, diary);
}

module.exports = {
  bind, tasksAttribute, rewardsAttribute, doneTasks, claimedTiers, tierCount, isTierComplete,
  completeTask, claimTier, resetTiers, restore, sendDiary,
};
