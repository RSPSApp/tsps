/**
 * Rantz (Feldip Hills, multinpc 1470; Wiki: Rantz, Transcript:Rantz, Western Provinces Diary rewards):
 * once a day his Claim-arrows option hands out 25 / 50 / 100 / 150 free ogre arrows by Western
 * Provinces easy / medium / hard / elite. A claim made before a higher tier is done keeps that day's
 * amount; the higher amount starts the next day (Wiki: Rantz).
 *
 * From the cache: Claim-arrows is op3 of both forms 1470 shows, 14793 (rantz_pre_quest) and 14794
 * (rantz_post_quest), so the option is there with or without a diary. Varbit western_rantz_arrows
 * (4563) is set to 1 on a claim and sent again at login on the same day; a claim on a later day clears
 * a 1 left over from before the day turned. The tier is the highest Western Provinces tier claimed
 * from the Elder gnome child, as for the other diary allowances here.
 *
 * His lines are the Wiki transcript in npc-dialogues.json, three variants played as they are: the
 * hand-out ("Hav' da stabbies..."), no inventory space ("No space 'uman...") and already claimed
 * today ("You's already claimed da stabbies today..."). No RSProx capture or index row has a
 * Claim-arrows click, so the rest is inferred. Ours: the arrows are given as the hand-out line starts,
 * with no animation or other message; the day resets at 00:00 UTC, as the other diary allowances do;
 * without any Western Provinces tier, Claim-arrows answers with a game message of our own (neither the
 * Wiki nor the transcript says what Rantz does then).
 */
const Rewards = require("./Common.DiaryRewards");
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const { BY_KEY, TIERS } = require("../../achievements/diaries/Data.AchievementDiaries");

const DAILY_KEY = "rantz-arrows";
const PREFIX = "claiming-arrows-after-completing-any-tier-of-western-provinces-diary-";
const VARIANTS = {
  give: `${PREFIX}claiming-the-arrows`,
  noRoom: `${PREFIX}if-the-player-has-no-inventory-space`,
  claimed: `${PREFIX}trying-to-claim-arrows-after-having-claimed-them`,
};
/** Ours: neither the Wiki nor the transcript has Rantz's answer without a diary tier. */
const NO_DIARY = "You need to complete the easy Western Provinces Diary to claim free ogre arrows from Rantz.";

let pluginApi;
let core;
let arrows;
let varbit;

function data() {
  return Rewards.DATA.rantz;
}

/** Today's arrows from the highest Western Provinces tier claimed, or 0. */
function allowance(player) {
  const claimed = Progress.claimedTiers(player, BY_KEY.get(data().diary));
  const tier = TIERS.reduce((best, name, index) => (claimed.has(name) ? index : best), -1);
  return tier < 0 ? 0 : data().perDay[tier];
}

const used = (player) => Rewards.dailyUses(player, DAILY_KEY) > 0;

function say(player, npc, npcId, variant) {
  const request = { player, npc, npcId, variant, exact: true, handled: false };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function claim({ player, npc, npcId }) {
  const id = npcId ?? npc?.getId?.();
  const amount = allowance(player);
  if (amount === 0) {
    player.sendMessage(NO_DIARY);
    return true;
  }
  const sender = player.getPacketSender();
  if (used(player)) return say(player, npc, id, VARIANTS.claimed);
  // A player online across the day turn still has yesterday's 1; the new day's claim is open again.
  if (sender.getVarbit(varbit) !== 0) sender.sendVarbit(varbit, 0);
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(new core.Item(arrows, amount)) < amount) return say(player, npc, id, VARIANTS.noRoom);
  inventory.adds(arrows, amount);
  inventory.refreshItems();
  Rewards.useDaily(player, DAILY_KEY);
  sender.sendVarbit(varbit, 1);
  say(player, npc, id, VARIANTS.give);
  return true;
}

function syncOnLogin({ player }) {
  if (used(player)) player.getPacketSender().sendVarbit(varbit, 1);
}

module.exports = function attachRantz(api) {
  pluginApi = api;
  core = api.core;
  arrows = Rewards.objId(data().item);
  varbit = Rewards.gamevalId("varbit", data().varbit);
  api.onNpcInteraction(data().npc, { "Claim-arrows": claim });
  api.onPlayerLogin(syncOnLogin);
};
