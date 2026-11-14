/**
 * Wizard Cromperty (East Ardougne, multinpc 5314; Wiki: Wizard Cromperty, Transcript:Wizard Cromperty,
 * Ardougne Diary rewards): once a day he gives 100 / 150 / 250 free pure essence by Ardougne medium /
 * hard / elite, from the right-click Claim option (added 20 September 2018, Wiki). The lines are the
 * Wiki transcript in npc-dialogues.json: the "Claim free pure essence." branch of the standard-dialogue
 * menu, which Claim plays directly; this unit answers its two conditions, does the hand-out at its
 * "receive" step and fills the "[amount]" of the "There you go" line.
 *
 * From the cache: 5314 shows 8480 (cromperty_pre_diary: Talk-to, Teleport) until varbit
 * ardougne_medium_reward (4500) is set, then 8481 (cromperty_post_diary: Talk-to, Teleport, Claim), so
 * the tier is the highest Ardougne tier claimed from Two-pints, as for the other diary allowances here.
 * Varbit ardougne_free_essence (4547) is set to 1 on a claim and sent again at login on the same day.
 * Not here: Talk-to plays Tribal Totem's copy of his conversation (TribalTotem.Quest.js picks it for
 * every Cromperty), which has no claim choice.
 *
 * Noted: Two-pints's medium reward line says "100 noted pure essence", and the 14 April 2016 update
 * made him count a stack of noted pure essence as room (Wiki). No RSProx capture includes a claim (the
 * index has 8481 in 10 recordings, no actions), so these are inferred. Ours: no animation or message
 * besides the transcript line; the day resets at 00:00 UTC, as the other diary allowances do; a full
 * inventory without noted pure essence refuses with a game message of our own (the transcript has no
 * line for it) and keeps the day's claim.
 */
const Rewards = require("./Common.DiaryRewards");
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const { BY_KEY, TIERS } = require("../../achievements/diaries/Data.AchievementDiaries");

const DAILY_KEY = "cromperty-essence";
const VARIANT = "standard-dialogue";
/** The claim choice of the standard-dialogue menu; its steps are what Claim plays. */
const OPTION = "Claim free pure essence.";
const OPEN = "If the player has not claimed their daily allowance:";
const CLAIMED = "If the player has claimed their daily allowance:";
const RECEIVE_TEXT = "[amount] pure essence";
const AMOUNT = "[amount]";
/** Ours: the transcript has no line for a full inventory. */
const NO_ROOM = "You don't have enough inventory space to claim your free pure essence.";

let pluginApi;
let core;
let essence;
let varbit;
let crompertyIds;

function data() {
  return Rewards.DATA.cromperty;
}

/** Today's essence from the highest Ardougne tier claimed from Two-pints, or 0. */
function allowance(player) {
  const claimed = Progress.claimedTiers(player, BY_KEY.get(data().diary));
  const tier = TIERS.reduce((best, name, index) => (claimed.has(name) ? index : best), -1);
  return tier < 0 ? 0 : data().perDay[tier];
}

const used = (player) => Rewards.dailyUses(player, DAILY_KEY) > 0;
const isCromperty = (npcId) => crompertyIds.has(npcId);

function condition({ player, npcId, text }) {
  if (!isCromperty(npcId)) return null;
  switch (text) {
    case OPEN: return !used(player);
    case CLAIMED: return used(player);
    default: return null;
  }
}

/** Gives today's essence; everything is checked again here. Returns the amount, or 0. */
function give(player) {
  const amount = allowance(player);
  if (amount === 0 || used(player)) return 0;
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(new core.Item(essence, amount)) < amount) {
    player.sendMessage(NO_ROOM);
    return 0;
  }
  inventory.adds(essence, amount);
  inventory.refreshItems();
  Rewards.useDaily(player, DAILY_KEY);
  player.getPacketSender().sendVarbit(varbit, 1);
  return amount;
}

/** The "receive" step hands the essence over; no hand-out ends the conversation there. */
function action(event) {
  if (!isCromperty(event.npcId) || event.action !== "receive" || event.text !== RECEIVE_TEXT) return;
  event.handled = true;
  if (give(event.player) === 0) event.end = true;
}

/** The "There you go" line names the day's amount. */
function line(event) {
  if (!isCromperty(event.npcId) || typeof event.text !== "string" || !event.text.includes(AMOUNT)) return;
  event.text = event.text.split(AMOUNT).join(String(allowance(event.player)));
}

/** The claim option's own steps out of the transcript's first menu. */
function claimSteps(steps) {
  const choice = steps.find((step) => step?.type === "choice");
  return choice?.options?.find((option) => option?.text === OPTION)?.steps ?? [];
}

function claim({ player, npc, npcId }) {
  if (allowance(player) === 0) return false;
  const request = {
    player, npc, npcId: npcId ?? npc.getId(), variant: VARIANT, exact: true, select: claimSteps, handled: false,
  };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function syncOnLogin({ player }) {
  if (used(player)) player.getPacketSender().sendVarbit(varbit, 1);
}

module.exports = function attachCromperty(api) {
  pluginApi = api;
  core = api.core;
  essence = Rewards.objId(data().item);
  varbit = Rewards.gamevalId("varbit", data().varbit);
  crompertyIds = new Set(data().npcGamevals.map((name) => core.CacheDefinitions.getNpcId(name)));
  api.onNpcInteraction(data().npc, { Claim: claim });
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:action", action);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onPlayerLogin(syncOnLogin);
};
