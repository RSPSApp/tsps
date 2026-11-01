/**
 * What the clan's channel hears about its members, in live's words (rsprox's
 * MessageClanChannelSystem lines) for those at the rank each Notifications permission asks for.
 */

const Core = require("./Core.Clans");

// Settings by the Permissions screen's rows (data/permissions.json).
const JOIN_LEAVE_SETTING = 27;
const QUEST_SETTING = 28;
const LOOT_SETTING = 29;
const LEVEL_SETTING = 30;
const COMBAT_TASK_SETTING = 100;
const COLLECTION_LOG_SETTING = 58;
const PERSONAL_BEST_SETTING = 59;
const PK_SETTING = 60;
const DIARY_SETTING = 62;
const HARDCORE_DEATH_SETTING = 63;
const POST_99_XP_SETTING = 64;
const LOOT_KEY_SETTING = 97;
const POST_99_INTERVAL = 69; // in millions
const LOOT_KEY_MINIMUM_VALUE = 98;
const XP_AT_99 = 13034431;
const MILLION = 1000000;
const TOTAL_LEVEL_STEP = 25; // rsprox has 1875; SkillLevelUp.plugin.js's step
// How far apart level-ups are told: every 10 from this level, every 5 from this, every 1 from this.
const LEVEL_TENS_FROM = 66;
const LEVEL_FIVES_FROM = 67;
const LEVEL_ONES_FROM = 68;
const LOOT_MINIMUM_VALUE = 31;
const TASK_THRESHOLD = 101;

const TIERS = ["easy", "medium", "hard", "elite", "master", "grandmaster"];

let core = null;

function init(apiCore) {
  core = apiCore;
}

function clanFor(player) {
  return player.isPlayerBot?.() === true ? undefined : Core.clanOf(player);
}

function tell(clan, setting, text) {
  const needed = Core.permissionRank(clan, setting);
  const channel = Core.channelFor(clan);
  if (!channel) return;
  for (const user of channel.users) {
    if (!user.guest && user.rank >= needed) Core.sendNotice(user.player, text);
  }
}

function levelIsTold(clan, level) {
  const value = (setting) => Core.settingValue(clan, setting);
  if (value(LEVEL_ONES_FROM) > 0 && level >= value(LEVEL_ONES_FROM)) return true;
  if (value(LEVEL_FIVES_FROM) > 0 && level >= value(LEVEL_FIVES_FROM) && level % 5 === 0) return true;
  return value(LEVEL_TENS_FROM) > 0 && level >= value(LEVEL_TENS_FROM) && level % 10 === 0;
}

function levelUp({ player, skill, oldLevel, newLevel }) {
  const clan = clanFor(player);
  if (!clan) return;
  const name = player.getUsername();
  if (levelIsTold(clan, newLevel)) tell(clan, LEVEL_SETTING, `${name} has reached ${skill.getName()} level ${newLevel}.`);
  const skills = player.getSkillManager();
  const total = skills.getTotalLevel();
  const reached = Math.floor(total / TOTAL_LEVEL_STEP) * TOTAL_LEVEL_STEP;
  if (reached > total - (newLevel - oldLevel)) tell(clan, LEVEL_SETTING, `${name} has reached a total level of ${reached}.`);
  const combat = skills.getCombatLevel();
  if (lastCombat.has(player) && combat > lastCombat.get(player)) tell(clan, LEVEL_SETTING, `${name} has reached combat level ${combat}.`);
  lastCombat.set(player, combat);
}

const lastCombat = new WeakMap();

function noteCombat(player) {
  lastCombat.set(player, player.getSkillManager().getCombatLevel());
}

function experience({ player, skill, experience: gained }) {
  const clan = clanFor(player);
  if (!clan) return;
  const after = player.getSkillManager().getExperience(skill);
  if (after <= XP_AT_99) return;
  const step = Math.max(1, Core.settingValue(clan, POST_99_INTERVAL)) * MILLION;
  const reached = Math.floor(after / step) * step;
  if (reached > after - gained && reached > XP_AT_99) {
    tell(clan, POST_99_XP_SETTING, `${player.getUsername()} has reached ${reached.toLocaleString("en-GB")} XP in ${skill.getName()}.`);
  }
}

function formatTicks(ticks) {
  const seconds = Math.round(ticks * 0.6);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function personalBest({ player, boss, ticks }) {
  const clan = clanFor(player);
  if (clan) tell(clan, PERSONAL_BEST_SETTING, `${player.getUsername()} has achieved a new ${boss} personal best: ${formatTicks(ticks)}`);
}

function diaryTier({ player, diary, tier }) {
  const clan = clanFor(player);
  if (clan) tell(clan, DIARY_SETTING, `${player.getUsername()} has completed the ${tier} ${diary} diary.`);
}

function hardcoreDeath({ player }) {
  const clan = clanFor(player);
  if (clan) tell(clan, HARDCORE_DEATH_SETTING, `${player.getUsername()} has died as a Hardcore Ironman.`);
}

function lootKey({ player, value }) {
  const clan = clanFor(player);
  if (clan && value >= Core.settingValue(clan, LOOT_KEY_MINIMUM_VALUE)) {
    tell(clan, LOOT_KEY_SETTING, `${player.getUsername()} has opened a loot key worth ${value.toLocaleString("en-GB")} coins.`);
  }
}

function questCompleted({ player, quest }) {
  const clan = clanFor(player);
  if (clan) tell(clan, QUEST_SETTING, `${player.getUsername()} has completed a quest: ${quest?.name ?? quest?.title ?? "a quest"}`);
}

function combatTask({ player, task }) {
  const clan = clanFor(player);
  if (!clan) return;
  const tier = TIERS[(task.tier ?? 1) - 1] ?? "";
  if ((task.tier ?? 1) < Core.settingValue(clan, TASK_THRESHOLD)) return;
  tell(clan, COMBAT_TASK_SETTING, `CA_ID:${task.id}|${player.getUsername()} has completed ${tier === "elite" ? "an" : tier === "easy" ? "an" : "a"} ${tier} combat task: ${task.name}.`);
}

function collectionLog(request) {
  if (request?.added !== true) return;
  const clan = clanFor(request.player);
  if (!clan) return;
  const name = core.ItemDefinition?.forId?.(Number(request.itemId))?.getName?.() ?? "an item";
  tell(clan, COLLECTION_LOG_SETTING, `${request.player.getUsername()} received a new collection log item: ${name}`);
}

function dropId(item) {
  return Number(item?.itemId ?? item?.id);
}

function lootValue(item) {
  return core.ItemDefinition?.forId?.(dropId(item))?.getValue?.() * (item.amount ?? 1) || 0;
}

function dropLine(player, item, source, value) {
  const name = core.ItemDefinition?.forId?.(dropId(item))?.getName?.() ?? "an item";
  const amount = (item.amount ?? 1) > 1 ? `${item.amount.toLocaleString("en-GB")} x ` : "";
  const from = source ? ` from ${source}` : "";
  return `${player.getUsername()} received a drop: ${amount}${name} (${value.toLocaleString("en-GB")} coins)${from}.`;
}

/** What "npc-drops:roll" reports (CollectionLog.plugin.js reads the same request). */
function drops(request) {
  const { player } = request ?? {};
  if (!player) return;
  const clan = clanFor(player);
  if (!clan) return;
  const minimum = Core.settingValue(clan, LOOT_MINIMUM_VALUE);
  for (const item of request.drops ?? []) {
    const value = lootValue(item);
    if (value >= minimum) tell(clan, LOOT_SETTING, dropLine(player, item, request.npc?.getDefinition?.()?.getName?.(), value));
  }
}

function defeated({ killer, victim }) {
  if (!killer?.getUsername || !victim?.getUsername) return;
  const clan = clanFor(killer);
  if (clan) tell(clan, PK_SETTING, `${killer.getUsername()} has defeated ${victim.getUsername()}.`);
}

function joined(clan, name) {
  tell(clan, JOIN_LEAVE_SETTING, `${name} has joined the clan.`);
}

function left(clan, name) {
  tell(clan, JOIN_LEAVE_SETTING, `${name} has left the clan.`);
}

module.exports = {
  collectionLog,
  combatTask,
  defeated,
  diaryTier,
  drops,
  experience,
  hardcoreDeath,
  init,
  joined,
  left,
  levelUp,
  lootKey,
  noteCombat,
  personalBest,
  questCompleted,
};
