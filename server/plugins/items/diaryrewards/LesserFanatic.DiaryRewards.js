/**
 * The Lesser Fanatic (Jeffery, Edgeville; Wiki: Wilderness Diary hard rewards, Transcript:Lesser Fanatic)
 * buys ecumenical keys for 61,500 coins each once the hard Wilderness reward has been claimed. His lines
 * are the Wiki transcript in npc-dialogues.json (standard-dialogue); this unit answers its conditions
 * and makes the sales:
 * - the greeting (R1VamS / obLA2B), "Who are you?" (6Kk3JF) and "I'd like to sell ecumenical keys."
 *   (hTAuQX) by whether the hard reward is claimed, the same rule the other diary perks here use;
 * - no key held (53Bd71): his refusal; one key (99V9ts): the "Sell your ecumenical key for 61,500
 *   coins?" confirm, whose "You sell the key to the Fanatic." message (7w_Ekg) makes the sale;
 * - several keys (VFUBMi): the transcript's count input, "Sell ecumenical keys for 61,500 coins?",
 *   opened as the player continues past their line, then "You sell [#] keys to the Fanatic." with the
 *   number sold (at most the keys held).
 *
 * No RSProx capture or index row covers a sale (the index has no actions on lesser_fanatic_diary), so
 * these are the Wiki's. Ours: everything is checked again at the sale and a sale that no longer holds
 * sells nothing; after a count sale the conversation ends (the transcript jumps back to "initial");
 * "You sell [#] keys" keeps its plural for a count of 1; coins that would overflow the stack refuse with
 * the standard inventory-space line.
 */
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const { BY_KEY } = require("../../achievements/diaries/Data.AchievementDiaries");

const PRICE = 61500;
const MAX_STACK = 2147483647;
const PROMPT = "Sell ecumenical keys for 61,500 coins?";
const SOLD_MANY = "You sell [#] keys to the Fanatic.";
const SELL_LINE = "I'd like to sell ecumenical keys.";
const NO_ROOM = "You don't have enough inventory space.";
const NOT_CLAIMED = new Set(["R1VamS", "6Kk3JF"]);
const CLAIMED = new Set(["obLA2B", "hTAuQX"]);
const NO_KEYS = "53Bd71";
const ONE_KEY = "99V9ts";
const MANY_KEYS = "VFUBMi";
const SOLD_ONE = "7w_Ekg";

let core;
let fanaticId;

const isFanatic = (npcId) => npcId === fanaticId;
const keys = (player) => player.getInventory().getAmount(core.ItemIdentifiers.ECUMENICAL_KEY);

function hardClaimed(player) {
  return Progress.claimedTiers(player, BY_KEY.get("wilderness")).has("hard");
}

function condition({ player, npcId, stepId }) {
  if (!isFanatic(npcId)) return null;
  if (NOT_CLAIMED.has(stepId)) return !hardClaimed(player);
  if (CLAIMED.has(stepId)) return hardClaimed(player);
  switch (stepId) {
    case NO_KEYS: return keys(player) === 0;
    case ONE_KEY: return keys(player) === 1;
    // Played by the count input opened after the player's line (`line`), not by the runner.
    case MANY_KEYS: return false;
    default: return null;
  }
}

/** Sells up to `wanted` keys; returns how many were sold. Everything is checked again here. */
function sell(player, wanted) {
  if (!hardClaimed(player)) return 0;
  const inventory = player.getInventory();
  const coins = inventory.getAmount(core.ItemIdentifiers.COINS);
  const count = Math.min(Math.floor(wanted), keys(player));
  if (!(count > 0)) return 0;
  if (coins + count * PRICE > MAX_STACK) {
    player.sendMessage(NO_ROOM);
    return 0;
  }
  // The keys go first: when no coins are held, a key's slot takes them.
  inventory.deleteNumber(core.ItemIdentifiers.ECUMENICAL_KEY, count);
  inventory.adds(core.ItemIdentifiers.COINS, count * PRICE);
  inventory.refreshItems();
  return count;
}

function promptCount(player) {
  player.getDialogueManager().reset?.();
  player.setEnteredAmountAction({
    execute: (amount) => {
      const sold = sell(player, Number(amount));
      if (sold > 0) player.sendMessage(SOLD_MANY.replace("[#]", String(sold)));
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(PROMPT);
}

/** With two or more keys, the player's "I'd like to sell" line leads into the count input. */
function line(event) {
  if (!isFanatic(event.npcId) || event.text !== SELL_LINE) return;
  const { player } = event;
  if (hardClaimed(player) && keys(player) >= 2) event.after = () => promptCount(player);
}

/** "You sell the key to the Fanatic." after the one-key confirm. */
function soldOne(event) {
  if (!isFanatic(event.npcId) || event.kind !== "message" || event.stepId !== SOLD_ONE) return;
  if (sell(event.player, 1) === 1) return;
  event.handled = true;
  event.end = true;
}

module.exports = function attachLesserFanatic(api) {
  core = api.core;
  fanaticId = core.NpcIdentifiers.LESSER_FANATIC;
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:action", soldOne);
};

Object.assign(module.exports, { PRICE, sell });
