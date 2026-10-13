/**
 * Yama on his throne (the throne NPC, Yama while yama_throne_state is 0), as captured and from the
 * Wiki transcript:
 * - Talk-to: the first meeting (questions, then the contract), "after backing out" while the
 *   contract is unsigned, then the greeting that follows the last fight's result, or the usual
 *   "Have you come to challenge me?";
 * - Challenge: before a signature, Yama asks for one first; after it, the fight starts at once;
 * - "Yes. Let's do this." starts it from the chat.
 * The contract counts as offered once Yama says "Sign right here.", signed once he answers the
 * second "Yes." ("Excellent... Challenge me when you are ready").
 */
const Common = require("./Common.Yama");
const Domain = require("./Domain.Yama");
const Fight = require("./Fight.Yama");

const VARIANTS = {
  first: "standard-dialogue-first-time",
  backedOut: "standard-dialogue-after-backing-out-from-signing-the-contract",
  challengeUnsigned: "standard-dialogue-using-the-right-click-challenge-option-before-being-presented-with-the-contract",
  afterwards: "standard-dialogue-afterwards",
  victorious: "standard-dialogue-after-battle-victorious",
  defeated: "standard-dialogue-after-battle-defeated",
  escaped: "standard-dialogue-after-battle-having-escaped-midfight",
};
const OFFER_LINE = "Sign right here.";
const SIGNED_LINE = "Excellent... Challenge me when you are ready";
const FIGHT_OPTION = "Yes. Let's do this.";
const FIGHT_ACTION = "Yama snaps his fingers and teleports off his throne.";
const HISCORES_ACTION = "open_interface";
/** The quest's key as the quest plugin spells it. */
const ICTHLARINS_LITTLE_HELPER = "ictlharins_little_helper";

const isThrone = (npcId) => npcId === Common.data.npcs.throne || npcId === Common.data.npcs.throneYama;
const signed = (player) => player.getAttribute(Common.CONTRACT_SIGNED_ATTRIBUTE) === true;

function throneVariant({ player, npcId }) {
  if (!isThrone(npcId) || !Domain.sessionOf(player)) return null;
  if (!signed(player)) {
    return player.getAttribute(Common.CONTRACT_OFFERED_ATTRIBUTE) === true ? VARIANTS.backedOut : VARIANTS.first;
  }
  const result = player.getAttribute(Common.LAST_RESULT_ATTRIBUTE);
  if (result) {
    // Said once, the next time he is spoken to.
    player.setAttribute(Common.LAST_RESULT_ATTRIBUTE, null);
    return VARIANTS[result] ?? VARIANTS.afterwards;
  }
  return VARIANTS.afterwards;
}

/** The contract's progress, from what Yama says. */
function followContract({ player, npcId, text }) {
  if (!isThrone(npcId)) return;
  if (text === OFFER_LINE) player.setAttribute(Common.CONTRACT_OFFERED_ATTRIBUTE, true);
  if (String(text).startsWith(SIGNED_LINE)) player.setAttribute(Common.CONTRACT_SIGNED_ATTRIBUTE, true);
}

/** Yama's transcript asks after Icthlarin's Little Helper and the player's Ironman mode. */
function answerCondition({ player, npcId, text }) {
  if (!isThrone(npcId)) return null;
  const prose = String(text);
  if (prose.includes("Icthlarin's Little Helper")) {
    const request = { player, key: ICTHLARINS_LITTLE_HELPER, complete: false };
    Common.api.emitCustomEvent("quest:is-complete", request);
    return prose.includes("hasn't") ? request.complete !== true : request.complete === true;
  }
  if (prose.includes("Ironman")) {
    const request = { player, mode: null };
    Common.api.emitCustomEvent("ironman:mode", request);
    const iron = Boolean(request.mode) && request.mode !== "none";
    return prose.includes("not an Ironman") ? !iron : iron;
  }
  return null;
}

function startFromChat({ player, npcId, option }) {
  if (!isThrone(npcId) || option !== FIGHT_OPTION) return;
  const session = Domain.sessionOf(player);
  if (session && signed(player)) Common.later(1, () => Fight.challenge(session));
}

/** The transcript's narration of the challenge ends the chat; the fight shows it. No hiscores yet. */
function endThroneActions(action) {
  if (!isThrone(action.npcId)) return;
  if (action.text === FIGHT_ACTION || action.action === HISCORES_ACTION) {
    action.handled = true;
    action.end = true;
  }
}

function challenge({ player, npc }) {
  const session = Domain.sessionOf(player);
  if (!session || npc?.__yamaSession !== session || session.fight) return false;
  if (!signed(player)) {
    const request = { player, npc, npcId: Common.data.npcs.throneYama, variant: VARIANTS.challengeUnsigned, handled: false };
    Common.api.emitCustomEvent("npc-dialogue:start", request);
    return request.handled;
  }
  player.getMovementQueue().reset();
  player.setPositionToFace(npc.getLocation());
  Fight.challenge(session);
  return true;
}

function attachThrone(api) {
  api.persistAttribute(Common.CONTRACT_OFFERED_ATTRIBUTE);
  api.persistAttribute(Common.CONTRACT_SIGNED_ATTRIBUTE);
  api.onNpcDialogueVariant(throneVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", followContract);
  api.onCustomEvent("npc-dialogue:choice", startFromChat);
  api.onCustomEvent("npc-dialogue:action", endThroneActions);
  api.onNpcInteraction("Yama", { Challenge: challenge });
}

module.exports = { attachThrone };
