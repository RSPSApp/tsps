"use strict";

/**
 * Minimus takes a spare Dizana's quiver (uncharged) used on him in the lobby (Wiki, Fortis Colosseum: "exchange it
 * with Minimus for a 1/200 chance at the Smol Heredit pet or for 4,000 sunfire splinters"; players who already have the
 * pet can only take the splinters). His transcript (npc-dialogues.json, Minimus) gives the words: the
 * "exchanging-a-quiver" variants, and "attempting-to-exchange-a-charged-or-blessed-dizana-s-quiver" for any other
 * quiver. The trade happens on the final "Yes" and the transcript's conditions read its outcome.
 */

const Shared = require("./Shared.Colosseum");
const Loot = require("./Loot.Colosseum");

const VARIANT = {
  OFFER: "exchanging-a-quiver",
  OFFER_HAS_PET: "exchanging-a-quiver-after-the-player-has-received-smol-heredit",
  REFUSE: "attempting-to-exchange-a-charged-or-blessed-dizana-s-quiver",
};
const SPLINTERS = 4000;
const PET_CHANCE = 200;
const INT_MAX = 2147483647;
/** The final "Yes" of each trade (the transcript's option text, case-folded). */
const TRADE_CHOICE = /^yes, exchange dizana's quiver for 4,000 sunfire splinters/i;
const GAMBLE_CHOICE = /^yes, gamble for a smol heredit/i;
/** The transcript's condition ids, and what each asks. */
const CONDITION = {
  dgiQD4: (outcome) => outcome.traded === false, // no room
  mejTXJ: (outcome) => outcome.traded === true,
  Eq1TOl: (outcome) => outcome.traded === true,
  "0dfjXe": (outcome) => outcome.traded === false, // no room
  "5jvCju": (outcome) => outcome.pet === false,
  "0LFF3m": (outcome) => outcome.pet === true,
};
/** Other quivers Minimus turns down: only spare uncharged ones (his transcript). */
const OTHER_QUIVERS = [
  "DIZANAS_QUIVER", "DIZANAS_QUIVER_L_", "DIZANAS_QUIVER_L_UNCHARGED_", "BLESSED_DIZANAS_QUIVER", "BLESSED_DIZANAS_QUIVER_L_",
];

const outcomes = new WeakMap();

function ownsSmolHeredit(player) {
  const request = { player, itemId: Loot.SMOL_HEREDIT, owns: false };
  Shared.api().emitCustomEvent("pets:owns", request);
  return request.owns === true;
}

function say(player, npc, variant) {
  Shared.api().emitCustomEvent("npc-dialogue:start", { player, npc, npcId: Shared.NPC.MINIMUS_LOBBY, variant, exact: true, handled: false });
}

function useQuiverOnMinimus(event) {
  if (event.npcId !== Shared.NPC.MINIMUS_LOBBY) return;
  const I = Shared.core().ItemIdentifiers;
  const { player } = event;
  if (event.itemId === Loot.DIZANAS_QUIVER) {
    event.handled = true;
    outcomes.delete(player);
    say(player, event.npc ?? null, ownsSmolHeredit(player) ? VARIANT.OFFER_HAS_PET : VARIANT.OFFER);
  } else if (OTHER_QUIVERS.some((name) => I[name] === event.itemId)) {
    event.handled = true;
    say(player, event.npc ?? null, VARIANT.REFUSE);
  }
}

/** Takes the quiver for the trade; false when it is no longer carried. */
function takeQuiver(player) {
  const inventory = player.getInventory();
  if (!inventory.contains(Loot.DIZANAS_QUIVER)) return false;
  inventory.deleteNumber(Loot.DIZANAS_QUIVER, 1);
  return true;
}

function trade(player) {
  const inventory = player.getInventory();
  // The quiver's own slot frees as it goes, so only a full splinter stack can refuse.
  if (!inventory.contains(Loot.DIZANAS_QUIVER) || inventory.getAmount(Loot.SUNFIRE_SPLINTERS) > INT_MAX - SPLINTERS) {
    return { traded: false };
  }
  takeQuiver(player);
  inventory.adds(Loot.SUNFIRE_SPLINTERS, SPLINTERS);
  inventory.refreshItems();
  return { traded: true };
}

function gamble(player) {
  if (ownsSmolHeredit(player) || !takeQuiver(player)) return { pet: false };
  player.getInventory().refreshItems();
  const won = Math.floor(Math.random() * PET_CHANCE) === 0;
  if (won) Shared.api().emitCustomEvent("pets:award", { player, itemId: Loot.SMOL_HEREDIT });
  return { pet: won };
}

function chose({ player, npcId, option }) {
  if (npcId !== Shared.NPC.MINIMUS_LOBBY || typeof option !== "string") return;
  if (TRADE_CHOICE.test(option)) outcomes.set(player, trade(player));
  else if (GAMBLE_CHOICE.test(option)) outcomes.set(player, gamble(player));
}

function answer({ player, npcId, stepId }) {
  if (npcId !== Shared.NPC.MINIMUS_LOBBY || !(stepId in CONDITION)) return null;
  const outcome = outcomes.get(player);
  return outcome ? CONDITION[stepId](outcome) : null;
}

module.exports = function registerColosseumQuiverExchange(api) {
  Shared.bind(api);
  api.onItemOnNpc(useQuiverOnMinimus);
  api.onCustomEvent("npc-dialogue:choice", chose);
  api.onNpcDialogueCondition(answer);
};

Object.assign(module.exports, { useQuiverOnMinimus, chose, answer, VARIANT, SPLINTERS });
