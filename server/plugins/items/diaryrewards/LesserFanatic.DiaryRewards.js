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
 *   opened as the player continues past their line; a sale then plays the rest of that branch from
 *   the transcript: "You sell [#] keys to the Fanatic." (NFj8sY) with the number sold (at most the
 *   keys held), and its jump back to the first menu (ucDguL).
 * Both sale messages are item boxes with the key and coins pictures (the Wiki's tbox pic/pic2; the
 * dump keeps only the text).
 *
 * No RSProx capture or index row covers a sale (the index has only a Leagues Talk-to, rec 787), so
 * these are the Wiki's. Ours: everything is checked again at the sale and a sale that no longer holds
 * sells nothing, nor does a count answered after moving off the tile it opened on; "You sell [#] keys" keeps its plural
 * for a count of 1; coins that would overflow the stack refuse with the standard inventory-space line.
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
const SOLD_MANY_ID = "NFj8sY";
const COUNT_INPUT = "r_i5HT";

/** Keys sold by the count input, read by the transcript's "You sell [#] keys" message. */
const soldCounts = new WeakMap();

let core;
let api;
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

/**
 * The steps after the count input in the several-keys branch: the sale message, then its jump back to
 * "initial". A fresh playback has no menu history for that jump to land on, so it becomes the
 * transcript's first menu itself.
 */
function afterInput(steps) {
  const first = steps.find((step) => step?.type === "choice");
  return tailAfterInput(steps).map((step) =>
    step?.type === "jump" && /^initial/i.test(String(step.reference ?? "")) && first ? first : step);
}

function tailAfterInput(steps) {
  const stack = [...steps];
  while (stack.length) {
    const step = stack.pop();
    if (step?.type === "condition" && step.id === MANY_KEYS) {
      const at = step.steps.findIndex((entry) => entry.id === COUNT_INPUT);
      return at >= 0 ? step.steps.slice(at + 1) : [];
    }
    for (const child of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
      if (Array.isArray(child)) stack.push(...child);
    }
  }
  return [];
}

function promptCount(player, npc) {
  player.getDialogueManager().reset?.();
  // Ours: an answer given after walking or teleporting off the tile the input opened on sells nothing.
  const opened = player.getLocation().clone();
  player.setEnteredAmountAction({
    execute: (amount) => {
      if (!player.getLocation().equals(opened)) return;
      const sold = sell(player, Number(amount));
      if (!(sold > 0)) return;
      soldCounts.set(player, sold);
      const request = { player, npc, npcId: fanaticId, select: afterInput, handled: false };
      api.emitCustomEvent("npc-dialogue:start", request);
      if (!request.handled) {
        soldCounts.delete(player);
        player.sendMessage(SOLD_MANY.replace("[#]", String(sold)));
      }
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(PROMPT);
}

/** With two or more keys, the player's "I'd like to sell" line leads into the count input. */
function line(event) {
  if (!isFanatic(event.npcId) || event.text !== SELL_LINE) return;
  const { player } = event;
  if (hardClaimed(player) && keys(player) >= 2) event.after = () => promptCount(player, event.npc);
}

const saleBox = () => ({ items: [core.ItemIdentifiers.ECUMENICAL_KEY, core.ItemIdentifiers.COINS] });

/** The sale messages: "You sell the key" after the one-key confirm sells it; "You sell [#] keys" follows a count sale. */
function soldMessage(event) {
  if (!isFanatic(event.npcId) || event.kind !== "message") return;
  if (event.stepId === SOLD_ONE) {
    if (sell(event.player, 1) === 1) {
      event.box = saleBox();
      return;
    }
  } else if (event.stepId === SOLD_MANY_ID) {
    const sold = soldCounts.get(event.player);
    soldCounts.delete(event.player);
    if (sold > 0) {
      event.text = SOLD_MANY.replace("[#]", String(sold));
      event.box = saleBox();
      return;
    }
  } else return;
  event.handled = true;
  event.end = true;
}

module.exports = function attachLesserFanatic(pluginApi) {
  api = pluginApi;
  core = api.core;
  fanaticId = core.NpcIdentifiers.LESSER_FANATIC;
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:action", soldMessage);
};

Object.assign(module.exports, { PRICE, sell });
