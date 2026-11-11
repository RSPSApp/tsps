/**
 * Lundail (NPC 1601, Mage Arena bank; Wiki: Lundail, Wilderness Diary rewards): once a day he gives
 * one type of rune, picked at random from the seven kinds in his shop that are not elemental, 40 / 80 /
 * 120 / 200 of them by Wilderness tier (easy to elite; the elemental runes were dropped from the roll
 * on 30 August 2023). His Talk-to "Claim free runes." branch is the Wiki transcript in npc-dialogues.json
 * (variant standard-dialogue); this unit answers its conditions and does the hand-out at its "receive"
 * step. The right-click Claim-runes option plays the same lines, since the transcript only carries the
 * Talk-to variant.
 *
 * The words, the amounts and the rule are the Wiki's. No RSProx capture includes Lundail (text searches
 * for "Lundail" find nothing; "free runes" matches only unrelated recordings), so the Claim-runes
 * conversation, the game message's wording ("Lundail hands you 40 free chaos runes.") and the daily reset
 * at 00:00 UTC are inferred. INFERRED: the tier is the highest Wilderness tier claimed from the diary
 * master, not merely completed (the Wiki says "completing"), like the other diary allowances here.
 *
 * Nothing is given until the "receive" step, which checks the tier, the day's claim and the room again.
 * The allowance is a stored day + count (no timer, no logout cleanup).
 */
const Rewards = require("./Common.DiaryRewards");
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const { BY_KEY, TIERS } = require("../../achievements/diaries/Data.AchievementDiaries");

const DAILY_KEY = "lundail-runes";
const RECEIVE_TEXT = "runes";
const AMOUNT = "[amount]";
const TYPE = "[type]";
const NO_DIARY = "If the player hasn't completed the Easy Wilderness Diary:";
const FULL = "If the player's inventory is full:";
const HAS_DIARY = "If the player has completed the Easy Wilderness Diary:";
const CLAIMED = "If the player has already claimed runes today:";

const NO_DIARY_LINE = "You'll need to have completed the Easy Wilderness Achievement Diary to qualify for free runes.";
const FULL_LINE = "You need more free space before you can claim your free runes.";
const THERE_YOU_GO_LINE = "There you go. Come back tomorrow for some more!";
const CLAIMED_LINE = "You've already claimed your free runes today. Come back tomorrow for some more.";

let core;
/** The rune picked for each player's claim in progress, read by the transcript's message step. */
const PICKED = new WeakMap();

function data() {
  return Rewards.DATA.lundail;
}

/** Today's amount from the highest Wilderness tier claimed from the diary master, or 0. */
function allowance(player) {
  const claimed = Progress.claimedTiers(player, BY_KEY.get(data().diary));
  const tier = TIERS.reduce((best, name, index) => (claimed.has(name) ? index : best), -1);
  return tier < 0 ? 0 : data().perDay[tier];
}

const used = (player) => Rewards.dailyUses(player, DAILY_KEY) > 0;

const isLundail = (npcId) => npcId === core.NpcIdentifiers.LUNDAIL;

/** Room for the amount whichever rune is rolled: every kind in the pool must fit, since the pick comes later. */
function hasRoom(player, amount) {
  const inventory = player.getInventory();
  return amount > 0 && data().runes.every((name) =>
    inventory.getAddableAmount(new core.Item(core.ItemIdentifiers[name], amount)) >= amount);
}

/** The transcript's Wiki prose conditions; a claimed day beats a full inventory, as the Wiki lists it. */
function condition({ player, npcId, text }) {
  if (!isLundail(npcId)) return null;
  const amount = allowance(player);
  const open = amount > 0 && !used(player);
  switch (text) {
    case NO_DIARY: return amount === 0;
    case FULL: return open && !hasRoom(player, amount);
    case HAS_DIARY: return open && hasRoom(player, amount);
    case CLAIMED: return amount > 0 && used(player);
    default: return null;
  }
}

/** Hands over the day's runes; everything is checked again here. Returns the pick, or null. */
function give(player) {
  const amount = allowance(player);
  if (amount === 0 || used(player) || !hasRoom(player, amount)) return null;
  const names = data().runes;
  const name = names[Math.floor(Math.random() * names.length)];
  player.getInventory().adds(core.ItemIdentifiers[name], amount);
  Rewards.useDaily(player, DAILY_KEY);
  const pick = { amount, type: name.replace(/_RUNE$/, "").toLowerCase() };
  PICKED.set(player, pick);
  return pick;
}

function messageText(text, pick) {
  return String(text).split(AMOUNT).join(String(pick.amount)).split(TYPE).join(pick.type);
}

/** The "receive" step hands the runes over; its message step then reports them as a game message. */
function action(event) {
  if (!isLundail(event.npcId)) return;
  if (event.kind === "message") {
    const pick = PICKED.get(event.player);
    if (!pick) return;
    PICKED.delete(event.player);
    event.handled = true;
    event.player.sendMessage(messageText(event.text, pick));
    return;
  }
  if (event.action !== "receive" || event.text !== RECEIVE_TEXT) return;
  event.handled = true;
  if (!give(event.player)) event.end = true;
}

/** Right-click Claim-runes: the same lines and rule as the Talk-to branch. */
function claimRunes({ player, npc }) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core;
  const npcId = npc.getId();
  const say = (text) => player.getDialogueManager().startDialogues(
    new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text), new EndDialogue(1)));
  const amount = allowance(player);
  if (amount === 0) say(NO_DIARY_LINE);
  else if (used(player)) say(CLAIMED_LINE);
  else if (!hasRoom(player, amount)) say(FULL_LINE);
  else {
    const pick = give(player);
    if (pick) player.sendMessage(`Lundail hands you ${pick.amount} free ${pick.type} runes.`);
    say(THERE_YOU_GO_LINE);
  }
  return true;
}

module.exports = function attachLundail(api) {
  core = api.core;
  api.onNpcInteraction(data().npc, { "Claim-runes": claimRunes });
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:action", action);
};
