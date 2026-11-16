/**
 * Thirus (Lovakengj blast mine, multinpc 8627; Wiki: Thirus, Transcript:Thirus, Kourend & Kebos Diary
 * rewards): once a day his Claim option hands out 20 / 40 / 80 free dynamite by Kourend & Kebos medium /
 * hard / elite. His lines are the Wiki transcript in npc-dialogues.json (variant claiming-dynamite); this
 * unit answers its two conditions and gives the dynamite as the "There you go" line is shown, filling in
 * the transcript's "[20/40/80]".
 *
 * From the cache: the Claim option exists only on 8547 (lovakengj_thirus_post_diary), which 8627 shows
 * once varbit kourend_medium_reward (7930) is set, i.e. once the medium reward has been claimed from Elise,
 * so the tier is the highest Kourend tier claimed, as for the other diary allowances here. Varbit
 * kourend_free_dynamite (7939) is set to 1 on a claim and sent again at login on the same day.
 *
 * No RSProx capture includes a Claim (the index has the NPC in 5 recordings, no actions), so these are
 * inferred. Ours: the dynamite is given noted (cert_lovakengj_dynamite_fused): the unnoted kind does not
 * stack in the cache, so 40 or 80 could not fit an inventory; Zaff's and the flax keeper's allowances
 * are noted too. No message besides the transcript line, no animation; the day resets at 00:00 UTC, as
 * the other diary allowances do; a full inventory without noted dynamite refuses with a game message of
 * our own (the transcript has no line for it) and keeps the day's claim.
 */
const Rewards = require("./Common.DiaryRewards");
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const { BY_KEY, TIERS } = require("../../achievements/diaries/Data.AchievementDiaries");

const DAILY_KEY = "thirus-dynamite";
const VARIANT = "claiming-dynamite";
const OPEN = "If the player has not claimed their free dynamite for the day:";
const CLAIMED = "If the player has already claimed their free dynamite for the day:";
const AMOUNTS = "[20/40/80]";
/** Ours: the transcript has no line for a full inventory. */
const NO_ROOM = "You don't have enough inventory space to claim your free dynamite.";

let pluginApi;
let core;
let dynamite;
let varbit;
let thirusId;

function data() {
  return Rewards.DATA.thirus;
}

/** Today's dynamite from the highest Kourend & Kebos tier claimed from Elise, or 0. */
function allowance(player) {
  const claimed = Progress.claimedTiers(player, BY_KEY.get(data().diary));
  const tier = TIERS.reduce((best, name, index) => (claimed.has(name) ? index : best), -1);
  return tier < 0 ? 0 : data().perDay[tier];
}

const used = (player) => Rewards.dailyUses(player, DAILY_KEY) > 0;

/** The post-diary variant (the one with Claim); 8627 resolves to it once the medium reward is claimed. */
const isThirus = (npcId) => npcId === thirusId;

function condition({ player, npcId, text }) {
  if (!isThirus(npcId)) return null;
  switch (text) {
    case OPEN: return !used(player);
    case CLAIMED: return used(player);
    default: return null;
  }
}

/** Gives today's dynamite; everything is checked again here. Returns the amount, or 0. */
function give(player) {
  const amount = allowance(player);
  if (amount === 0 || used(player)) return 0;
  const inventory = player.getInventory();
  if (inventory.getAddableAmount(new core.Item(dynamite, amount)) < amount) {
    player.sendMessage(NO_ROOM);
    return 0;
  }
  inventory.adds(dynamite, amount);
  inventory.refreshItems();
  Rewards.useDaily(player, DAILY_KEY);
  player.getPacketSender().sendVarbit(varbit, 1);
  return amount;
}

/** The "There you go" line hands the dynamite over and names the amount; no hand-out drops the line. */
function line(event) {
  if (!isThirus(event.npcId) || typeof event.text !== "string" || !event.text.includes(AMOUNTS)) return;
  const amount = give(event.player);
  if (amount === 0) {
    event.skip = true;
    return;
  }
  event.text = event.text.split(AMOUNTS).join(String(amount));
}

function claim({ player, npc }) {
  if (allowance(player) === 0) return false;
  const request = { player, npc, npcId: thirusId, variant: VARIANT, exact: true, handled: false };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function syncOnLogin({ player }) {
  if (used(player)) player.getPacketSender().sendVarbit(varbit, 1);
}

module.exports = function attachThirus(api) {
  pluginApi = api;
  core = api.core;
  dynamite = Rewards.objId(data().item);
  varbit = Rewards.gamevalId("varbit", data().varbit);
  thirusId = core.CacheDefinitions.getNpcId(data().npcGameval);
  api.onNpcInteraction(data().npc, { Claim: claim });
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onPlayerLogin(syncOnLogin);
};
