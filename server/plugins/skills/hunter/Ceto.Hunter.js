"use strict";

// Ceto's drift net cavern, played from her Wiki transcript (npc-dialogues.json, "Ceto"): Talk-to is
// the transcript's standard dialogue, and her Pay option and the tunnel's Enter and Pay play its
// other sections. This module answers the transcript's conditions and runs its actions.
// https://oldschool.runescape.wiki/w/Transcript:Ceto
const C = require("./Context.Hunter"), { H } = C;
const DriftNets = require("./DriftNets.Hunter");

/** The tunnel beside Ceto: a multiloc on fossil_driftnet_unlimitedaccess (Enter, Pay; Enter once access is permanent). */
const DRIFT_NET_TUNNEL = 30958;
const ENTERS_LINE = "The player enters the drift net fishing instance.";
const PERMANENT_LINE = "Thanks - no more entry fees for you!";
const PAY_TEXT = "200 numulites to Ceto";

function isCeto(npcId) {
  return npcId === H.core.NpcIdentifiers.CETO;
}

function numulites(player, amount) {
  return player.getInventory().getAmount(H.core.ItemIdentifiers.NUMULITE) >= amount;
}

/** The transcript's conditions, by their Wiki prose. */
function conditions(player) {
  const levels = DriftNets.levels(player), until = DriftNets.state(player).until;
  const permanent = until === -1, day = !permanent && until > Date.now(), paid = permanent || day;
  return {
    "if does not have the level requirements to drift net fish:": !levels,
    "if the player does not have the level requirements to drift net fish:": !levels,
    "if the player has the level requirements to drift net fish, but has not paid for any access:": levels && !paid,
    "if the player has the level requirements to drift net fish, but has not paid for a day's access:": levels && !paid,
    "if the player has the level requirements to drift net fish, but doesn't have enough numulites:": levels && !paid && !numulites(player, 200),
    "if the player has the level requirements to drift net fish, and has enough numulites:": levels && !paid && numulites(player, 200),
    "if the player has 200 numulites:": numulites(player, 200),
    "if the player has at least 200 numulites in their inventory:": numulites(player, 200),
    "if the player does not have at least 200 numulites in their inventory:": !numulites(player, 200),
    "if the player has 20,000 numulites in their inventory:": numulites(player, 20000),
    "if the player does not have at least 20,000 numulites in their inventory:": !numulites(player, 20000),
    "if the player has paid to access the instance for the day:": day,
    "if the player has paid to access for the day:": day,
    "if the player has paid for permanent access:": permanent,
    "if the player has already paid for any kind of access:": paid,
  };
}

function condition({ player, npcId, text }) {
  if (!isCeto(npcId)) return null;
  return conditions(player)[String(text).trim().toLowerCase()] ?? null;
}

/** "gives 200 numulites to Ceto" pays for the day; "enters the instance" goes in. */
function action(event) {
  if (!isCeto(event.npcId) || event.kind === "message") return;
  if (event.action === "give" && event.text === PAY_TEXT) {
    event.handled = true;
    if (!DriftNets.buyDay(event.player)) event.end = true;
  } else if (event.text === ENTERS_LINE) {
    event.handled = true;
    event.end = true;
    event.player.getPacketSender().sendInterfaceRemoval();
    DriftNets.enter(event.player);
  }
}

/** Her thanks for permanent access is where the 20,000 numulites change hands. */
function line(request) {
  if (!isCeto(request.npcId) || request.text !== PERMANENT_LINE) return;
  if (!DriftNets.buyPermanent(request.player)) request.skip = true;
}

function play(player, npc, variant) {
  const request = { player, npc, npcId: H.core.NpcIdentifiers.CETO, variant, handled: false };
  H.api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function pay({ player, npc }) {
  play(player, npc, "right-click-pay-option");
  return true;
}

function tunnel(event, variant) {
  if (event.object?.getId() !== DRIFT_NET_TUNNEL) return false;
  // The transcript checks levels first, then lets permanent access straight in.
  if (C.nearby(event.player, event.object)) play(event.player, null, variant);
  return true;
}

function tunnelEnter(event) {
  return tunnel(event, "entering-the-tunnel");
}

function tunnelPay(event) {
  return tunnel(event, "entering-the-tunnel-right-click-pay-option");
}

module.exports = { condition, action, line, pay, tunnelEnter, tunnelPay, DRIFT_NET_TUNNEL, ENTERS_LINE, PERMANENT_LINE, PAY_TEXT };
