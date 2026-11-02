/**
 * A player's Combat Achievements: the finished tasks (one bit each, in the 21 ca_task_completed
 * varps the cache's scripts test) and everything the interfaces show from them - points, tasks
 * done per tier and per boss, the tier thresholds and each tier's status.
 *
 * As captured finishing a task, all on the tick: its ca_task_completed varp, its tier's count,
 * ca_points, its boss's count, the tier's status when that crosses the threshold, the message
 * (CA_ID-prefixed from rev 234: the chat script makes it a "View" link), the unlock message, then
 * the "Combat Task Completed!" popup with jingle 76. Popups queue (Notifications.plugin.js).
 */
const Data = require("./Data.CombatAchievements");

const COMPLETED_ATTRIBUTE = "combat-achievements:completed";
const CLAIMED_ATTRIBUTE = "combat-achievements:claimed";

const POPUP_SETTING_VARBIT = 12455; // ca_task_popup: popups showed live while it was 0
const POPUP_OFF = 1;
const POPUP_TITLE = "Combat Task Completed!";
const POPUP_COLOUR = 14733725;
const JINGLE = { id: 76, length: 4974 };
const TASK_NAME_COLOUR = "0cc919";

let pluginApi;

/** The 21 varp values, task id N at bit N % 32 of the (N / 32)th. */
function words(player) {
  const stored = player.getAttribute(COMPLETED_ATTRIBUTE);
  return Data.TASK_VARPS.map((_, index) => (Array.isArray(stored) ? Number(stored[index]) | 0 : 0));
}

function isComplete(player, taskId) {
  const id = Number(taskId);
  return ((words(player)[id >>> 5] >>> (id & 31)) & 1) === 1;
}

function completedTasks(player) {
  return [...Data.tasks().values()].filter((task) => isComplete(player, task.id));
}

function points(player) {
  return completedTasks(player).reduce((sum, task) => sum + task.points, 0);
}

function claimedTiers(player) {
  const stored = player.getAttribute(CLAIMED_ATTRIBUTE);
  return new Set(Array.isArray(stored) ? stored.map(Number) : []);
}

/** 0 locked, 1 unlocked (rewards to claim), 2 claimed. */
function tierStatus(player, tier, total = points(player)) {
  if (claimedTiers(player).has(tier.tier)) return 2;
  return total >= tier.threshold ? 1 : 0;
}

/** The tiers with rewards waiting, Easy first. */
function claimableTiers(player) {
  const total = points(player);
  return Data.tiers().filter((tier) => tierStatus(player, tier, total) === 1);
}

function setClaimed(player, tier) {
  const claimed = claimedTiers(player);
  claimed.add(tier.tier);
  player.setAttribute(CLAIMED_ATTRIBUTE, [...claimed].sort((a, b) => a - b));
  const sender = player.getPacketSender();
  sender.sendVarbit(Data.TIER_VARBITS.STATUS[tier.index], 2);
  sender.sendVarbit(Data.TIER_VARBITS.LAMP_CLAIMED[tier.index], 1);
}

function tierCount(player, tier) {
  return tier.tasks.filter((task) => isComplete(player, task.id)).length;
}

function monsterCount(player, monster) {
  return monster.tasks.filter((task) => isComplete(player, task.id)).length;
}

/** Everything the interfaces read, as sent at login (only what is set, as captured). */
function sendAll(player, { onlySet = true } = {}) {
  const sender = player.getPacketSender();
  const send = (varbit, value) => { if (!onlySet || value !== 0) sender.sendVarbit(varbit, value); };
  const total = points(player);
  Data.TASK_VARPS.forEach((varp, index) => {
    const value = words(player)[index];
    if (!onlySet || value !== 0) sender.sendConfig(varp, value);
  });
  for (const tier of Data.tiers()) {
    send(Data.TIER_VARBITS.STATUS[tier.index], tierStatus(player, tier, total));
    send(Data.TIER_VARBITS.LAMP_CLAIMED[tier.index], claimedTiers(player).has(tier.tier) ? 1 : 0);
    send(Data.TIER_VARBITS.COMPLETED[tier.index], tierCount(player, tier));
  }
  for (const monster of Data.monsters().values()) {
    if (monster.tasksVarbit !== null) send(monster.tasksVarbit, monsterCount(player, monster));
  }
  send(Data.POINTS_VARBIT, total);
  for (const tier of Data.tiers()) sender.sendVarbit(Data.TIER_VARBITS.THRESHOLD[tier.index], tier.threshold);
}

/** The counts again (points, per tier, per boss), as captured when a boss page goes back to the list. */
function sendCounts(player) {
  const sender = player.getPacketSender();
  sender.sendVarbit(Data.POINTS_VARBIT, points(player));
  for (const tier of Data.tiers()) sender.sendVarbit(Data.TIER_VARBITS.COMPLETED[tier.index], tierCount(player, tier));
  for (const monster of Data.monsters().values()) {
    if (monster.tasksVarbit !== null) sender.sendVarbit(monster.tasksVarbit, monsterCount(player, monster));
  }
}

function article(tierName) {
  return /^[aeiou]/i.test(tierName) ? "an" : "a";
}

function pointsText(task) {
  return `${task.points} point${task.points === 1 ? "" : "s"}`;
}

function announce(player, task) {
  const tierName = Data.tiers()[task.tier - 1].name.toLowerCase();
  player.sendMessage(`CA_ID:${task.id}|Congratulations, you've completed ${article(tierName)} ${tierName} combat task: <col=${TASK_NAME_COLOUR}>${task.name}</col> (${pointsText(task)}).`);
}

function announceUnlock(player, tier) {
  player.sendMessage(`You've completed enough Combat Achievement tasks to unlock ${tier.name} Tier rewards! You can now claim your rewards from Ghommal.`);
}

function popup(player, task) {
  if (player.getPacketSender().getVarbit?.(POPUP_SETTING_VARBIT) === POPUP_OFF) return;
  pluginApi?.emitCustomEvent("notification:show", {
    player,
    title: POPUP_TITLE,
    text: `Task Completed: <col=ffffff>${task.name}</col> (${pointsText(task)})`,
    colour: POPUP_COLOUR,
    jingle: JINGLE,
  });
}

/**
 * Finishes a task, by id, cache name or task. True when it was not done before. `silent` skips the
 * messages and popup (retroactive completions at login).
 */
function complete(player, taskRef, { silent = false } = {}) {
  const task = typeof taskRef === "object" ? taskRef : typeof taskRef === "string" ? Data.taskNamed(taskRef) : Data.task(taskRef);
  if (!player || !task || isComplete(player, task.id)) return false;
  const before = points(player);
  const all = words(player);
  all[task.id >>> 5] = (all[task.id >>> 5] | (1 << (task.id & 31))) | 0;
  player.setAttribute(COMPLETED_ATTRIBUTE, all);
  const after = before + task.points;

  const sender = player.getPacketSender();
  sender.sendConfig(Data.TASK_VARPS[task.id >>> 5], all[task.id >>> 5]);
  const tier = Data.tiers()[task.tier - 1];
  sender.sendVarbit(Data.TIER_VARBITS.COMPLETED[tier.index], tierCount(player, tier));
  sender.sendVarbit(Data.POINTS_VARBIT, after);
  if (task.monster?.tasksVarbit != null) sender.sendVarbit(task.monster.tasksVarbit, monsterCount(player, task.monster));
  const unlocked = Data.tiers().filter((each) => before < each.threshold && after >= each.threshold && !claimedTiers(player).has(each.tier));
  for (const each of unlocked) sender.sendVarbit(Data.TIER_VARBITS.STATUS[each.index], 1);
  if (!silent) {
    announce(player, task);
    for (const each of unlocked) announceUnlock(player, each);
    popup(player, task);
  }
  pluginApi?.emitCustomEvent("combat-achievements:completed", { player, silent, task: { id: task.id, name: task.name, tier: task.tier } });
  return true;
}

function reset(player) {
  player.setAttribute(COMPLETED_ATTRIBUTE, Data.TASK_VARPS.map(() => 0));
  player.setAttribute(CLAIMED_ATTRIBUTE, []);
  sendAll(player, { onlySet: false });
}

module.exports = function attachProgress(api) {
  pluginApi = api;
  api.persistAttribute(COMPLETED_ATTRIBUTE, Data.TASK_VARPS.map(() => 0));
  api.persistAttribute(CLAIMED_ATTRIBUTE, []);
};

Object.assign(module.exports, {
  COMPLETED_ATTRIBUTE, CLAIMED_ATTRIBUTE,
  isComplete, completedTasks, points, claimedTiers, tierStatus, claimableTiers, setClaimed,
  tierCount, monsterCount, sendAll, sendCounts, complete, reset,
});
