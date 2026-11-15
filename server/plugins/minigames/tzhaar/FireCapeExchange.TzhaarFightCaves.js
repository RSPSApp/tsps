"use strict";

/**
 * TzHaar-Mej-Jal's fire cape exchange (Wiki: TzHaar-Mej-Jal): a fire cape sells back for 8,000 TokKul, or is
 * given up for a 1/200 roll at the TzRek-Jad pet. The words are the wiki transcript (NpcDialogues plugin); this
 * answers its conditions and carries out the hand-over. The "Exchange fire cape" option plays the same offer.
 */

const MEJ_JAL = "TzHaar-Mej-Jal";
const SELL_PRICE = 8000;
const PET_CHANCE = 200;
// The message step "You exchange your fire cape for 8,000 TokKul." in the standard dialogue.
const SELL_STEP = "wS-GnT";
const BARGAIN_OPTION = "Yes, I know I won't get my cape back.";
const NO_CAPE_MESSAGE = "You don't have a fire cape to exchange.";
// Right-click option; the wiki spells it with a lower-case "fire cape", the issue report with capitals.
const EXCHANGE_OPTIONS = ["Exchange fire cape", "Exchange Fire Cape"];

let api;
let core;
/** player -> whether the last pet bargain won; read by the "Upon a successful/failing roll" conditions. */
const rolls = new WeakMap();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const hasCape = (player) => player.getInventory().contains(core.ItemIdentifiers.FIRE_CAPE);

function ownsPet(player) {
  const request = { player, itemId: core.ItemIdentifiers.TZREK_JAD, owns: false };
  api.emitCustomEvent("pets:owns", request);
  return request.owns === true;
}

function answerCondition({ player, definition, text }) {
  if (definition?.getName?.() !== MEJ_JAL) return null;
  const value = String(text).toLowerCase();
  if (value.includes("does not have a firecape")) return !hasCape(player);
  if (value.includes("has a firecape")) return hasCape(player);
  if (value.includes("does not own the pet")) return !ownsPet(player);
  if (value.includes("successful roll")) return rolls.get(player) === true;
  if (value.includes("failing a roll")) return rolls.get(player) === false;
  return null;
}

function sellCape(event) {
  if (event.kind !== "message" || event.stepId !== SELL_STEP) return;
  if (event.definition?.getName?.() !== MEJ_JAL) return;
  const { player } = event;
  if (!hasCape(player)) {
    event.end = true;
    return;
  }
  player.getInventory().delete(core.ItemIdentifiers.FIRE_CAPE, 1);
  player.getInventory().adds(core.ItemIdentifiers.TOKKUL, SELL_PRICE);
}

/** The cape goes whether or not the toss is lucky. */
function bargain(event) {
  if (event.option !== BARGAIN_OPTION || event.definition?.getName?.() !== MEJ_JAL) return;
  const { player } = event;
  rolls.delete(player);
  if (!hasCape(player)) {
    event.end = true;
    player.sendMessage(NO_CAPE_MESSAGE);
    return;
  }
  player.getInventory().delete(core.ItemIdentifiers.FIRE_CAPE, 1);
  const won = core.Misc.getRandom(PET_CHANCE - 1) === 0;
  rolls.set(player, won);
  if (won) api.emitCustomEvent("pets:award", { player, itemId: core.ItemIdentifiers.TZREK_JAD, source: "tzhaar:fire-cape-exchange", awarded: false });
}

/** The right-click option plays the offer from "I have a fire cape here." */
function exchange({ player, npc }) {
  if (!hasCape(player)) {
    player.sendMessage(NO_CAPE_MESSAGE);
    return true;
  }
  // The standard dialogue's second step is the menu whose first option is the fire cape offer.
  const select = (steps) => steps.find((step) => step.type === "choice")?.options?.[0]?.steps;
  api.emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId: core.NpcIdentifiers.TZHAAR_MEJ_JAL, variant: "standard-dialogue", exact: true, select, handled: false,
  });
  return true;
}

function register(pluginApi) {
  init(pluginApi);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", sellCape);
  api.onCustomEvent("npc-dialogue:choice", bargain);
  api.onNpcInteraction(MEJ_JAL, Object.fromEntries(EXCHANGE_OPTIONS.map((option) => [option, exchange])));
}

module.exports = register;
module.exports.answerCondition = answerCondition;
module.exports.sellCape = sellCape;
module.exports.bargain = bargain;
module.exports.exchange = exchange;
module.exports.init = init;
