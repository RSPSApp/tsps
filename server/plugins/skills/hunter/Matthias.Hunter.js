"use strict";

// Matthias's one-time falconry investment (Wiki: Falconry): players "may invest in Matthias'
// operation for a one-time fee of 500,000 coins", after which his falcons are lent without the
// 500-coin fee. His transcript (npc-dialogues.json, "Matthias") asks the four conditions below and
// takes the coins on its give step (_q4osw); Catching.Hunter.js hire() skips the fee once invested.
const C = require("./Context.Hunter"), { H } = C;

const MATTHIAS = "Matthias";
const ATTRIBUTE = "hunter:falconry-invested";
const INVESTMENT = 500000;

function invested(player) {
  return player.getAttribute(ATTRIBUTE) === true;
}

function coins(player) {
  return player.getInventory().getAmount(H.core.ItemIdentifiers.COINS);
}

function condition({ player, definition, text }) {
  if (definition?.getName?.() !== MATTHIAS) return null;
  switch (String(text ?? "")) {
    case "If the player hasn't invested in the Falconry area:": return !invested(player);
    case "If the player has invested in the Falconry area already:": return invested(player);
    case "If the player does not have 500,000 coins in their inventory:": return coins(player) < INVESTMENT;
    case "If the player has 500,000 coins in their inventory:": return coins(player) >= INVESTMENT;
    default: return null;
  }
}

/** "Unlock permanent access for 500,000 coins?" Yes: the transcript's give step. */
function action(event) {
  if (event.action !== "give" || (event.target ?? event.text) !== "500,000 coins") return;
  if (event.definition?.getName?.() !== MATTHIAS) return;
  event.handled = true;
  const { player } = event;
  if (invested(player) || coins(player) < INVESTMENT) return;
  player.getInventory().delete(H.core.ItemIdentifiers.COINS, INVESTMENT);
  player.setAttribute(ATTRIBUTE, true);
}

module.exports = { ATTRIBUTE, INVESTMENT, invested, condition, action };
