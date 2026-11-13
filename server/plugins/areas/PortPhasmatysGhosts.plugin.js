"use strict";

/**
 * The ghosts of Port Phasmatys are understood only through a worn ghostspeak amulet, or Morytania
 * legs 2 or better ([Wiki: Ghostspeak amulet](https://oldschool.runescape.wiki/w/Ghostspeak_amulet)).
 * Without one they only wail "Woooo wooo wooooo woooo".
 *
 * Their transcripts say this in three ways, and each is answered here:
 * - a variant for the player without ghostspeak (the sailor, the ghostship's captain, the villagers,
 *   Metarialus), played in place of the standard talk;
 * - sibling conditions on wearing ghostspeak (the banker, the shopkeeper, Gravingas, the Dragontooth
 *   captain), answered from what the player wears;
 * - nothing at all (the innkeeper), who wails all the same.
 *
 * Without ghostspeak, Bank on the ghost banker or a town bank booth shows the banker's quick-bank
 * box first ("The ghost banker wails incomprehensibly at you..."), then opens the bank.
 */

const Barrier = require("./PortPhasmatysBarrier.plugin");

/** The town's ghosts whose talk depends on ghostspeak (the guards are the barrier plugin's). */
const TOWN_GHOSTS = new Set([
  "Ghost sailor", "Ghost banker", "Ghost innkeeper", "Ghost shopkeeper", "Ghost villager",
  "Ghost captain", "Gravingas", "Metarialus",
]);
/** Ghosts whose transcript has no line for a player without ghostspeak. */
const WAIL_ONLY = "Ghost innkeeper";
const WAIL = "Woooo wooo wooooo woooo";
const GHOST_BANKER = "Ghost banker";
const BANK_BOOTH = "Bank booth";
const TOWN_BANK_BOOTH = "ahoy_bankbooth";
const QUICK_BANK_VARIANT = "quick-banking-while-not-wearing-a-ghostspeak-amulet-or-morytania-legs-2-or-above";
/** Its "The ghost banker wails incomprehensibly at you..." step: a message box, the bank on continue. */
const QUICK_BANK_MESSAGE_STEP = "_uIcDa";
/** Variant names for the talk without ghostspeak ("...-without-a-ghostspeak-amulet", "...-does-not-wear-either-an-amulet-of-ghostspeak-..."). */
const WITHOUT_GHOSTSPEAK_VARIANT = /(without|not-wear).*ghostspeak/;
/** Metarialus's transcript defaults to his talk without ghostspeak; this is the one with it. */
const WITH_GHOSTSPEAK_VARIANT = "standard-dialogue-with-ghostspeak";
/**
 * The transcripts' ghostspeak conditions: "If the player wears either an amulet of ghostspeak or
 * the Morytania legs 2+:", "If the player is not wearing a ghostspeak amulet:" and the like.
 */
const GHOSTSPEAK_CONDITION = /^If the player (?:is wearing|wears|is not wearing|does not wear)(?: either)? (?:a ghostspeak amulet|an amulet of ghostspeak)(?: or (?:the )?Morytania legs 2(?: or above|\+))?:$/;
const NEGATED_CONDITION = /^If the player (?:is not wearing|does not wear)/;

let api = null;
let core = null;

const isTownGhost = (definition) => TOWN_GHOSTS.has(definition?.getName?.());

/**
 * The variant on the NPC's own transcript page ("Ghost sailor", "Ghost captain (ghostship)") whose
 * name matches, or null. Quest pages are left to their quests.
 */
function pageVariant(name, pages, matches) {
  for (const entry of pages ?? []) {
    if (!String(entry.page ?? "").startsWith(name)) continue;
    const found = (entry.variants ?? []).find((name) => name !== QUICK_BANK_VARIANT && matches(name));
    if (found) return found;
  }
  return null;
}

/** Without ghostspeak, the transcript's own talk for it; with it, Metarialus's real talk. */
function ghostVariant({ player, definition, pages }) {
  if (!isTownGhost(definition)) return null;
  const npcName = definition.getName();
  if (!Barrier.understandsGhosts(player)) return pageVariant(npcName, pages, (name) => WITHOUT_GHOSTSPEAK_VARIANT.test(name));
  return pageVariant(npcName, pages, (name) => name === WITH_GHOSTSPEAK_VARIANT);
}

function ghostCondition({ player, definition, text }) {
  if (!isTownGhost(definition) || !GHOSTSPEAK_CONDITION.test(String(text ?? ""))) return null;
  return NEGATED_CONDITION.test(text) !== Barrier.understandsGhosts(player);
}

/** The innkeeper's Talk-to without ghostspeak: his wail, as the other ghosts'. */
function wail({ player, npc }) {
  if (Barrier.understandsGhosts(player)) return false;
  const { DialogueChainBuilder, NpcDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npc.getId(), WAIL)));
  return true;
}

/** The quick-bank box, then the bank: the banker's transcript section for it. */
function quickBank(player, npc = null) {
  const request = {
    player, npc, npcId: core.NpcIdentifiers.GHOST_BANKER, variant: QUICK_BANK_VARIANT, exact: true, handled: false,
  };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

function bankWithBanker({ player, npc }) {
  if (Barrier.understandsGhosts(player)) return false;
  return quickBank(player, npc);
}

function bankAtBooth({ player, objectId }) {
  if (objectId !== core.CacheDefinitions.getLocId(TOWN_BANK_BOOTH) || Barrier.understandsGhosts(player)) return false;
  return quickBank(player);
}

function quickBankBox(event) {
  if (event.kind !== "message" || event.stepId !== QUICK_BANK_MESSAGE_STEP) return;
  event.box = { statement: true };
}

function bind(registry) {
  api = registry;
  core = registry.core;
}

module.exports = {
  name: "PortPhasmatysGhosts",
  description: "Port Phasmatys ghosts: understood only through ghostspeak; the ghost bankers' quick-bank without it.",
  members: true,
  register(registry) {
    bind(registry);
    registry.onNpcDialogueVariant(ghostVariant);
    registry.onNpcDialogueCondition(ghostCondition);
    registry.onNpcInteraction(WAIL_ONLY, { "Talk-to": wail });
    registry.onNpcInteraction(GHOST_BANKER, { Bank: bankWithBanker });
    registry.onObjectInteraction(BANK_BOOTH, { Bank: bankAtBooth });
    registry.onCustomEvent("npc-dialogue:action", quickBankBox);
  },
  ghostVariant, ghostCondition, wail, bankWithBanker, bankAtBooth, quickBankBox,
  WAIL, QUICK_BANK_VARIANT,
};
