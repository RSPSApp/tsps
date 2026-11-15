"use strict";

/**
 * Rotten potato > Slice (Wiki: Rotten potato): "Anti-macro events (AMEs) - produces a quest-like interface
 * with a list of random events to activate on oneself". The list is the RandomEvents plugin's, shown as a
 * paged chatbox menu.
 */
const Common = require("./Common.RottenPotato");

const TITLE = "Anti-macro events";
const RESULT_MESSAGES = {
  started: (name) => `${name} has been summoned.`,
  busy: () => "Random events cannot appear here or while you are busy.",
  blocked: () => "There's no room beside you for a random event.",
  invalid: () => "That random event no longer exists.",
  unavailable: () => "Random events are not running on this world.",
};

function slice({ player }) {
  if (!Common.permitted(player)) return;
  Common.chooseRandomEvent(player, TITLE, startOnSelf);
}

function startOnSelf(player, index, name) {
  const result = Common.startRandomEvent(player, index);
  player.sendMessage((RESULT_MESSAGES[result] ?? RESULT_MESSAGES.unavailable)(name));
}

module.exports = function attach(api) {
  api.onItemAction(Common.POTATO_NAME, { Slice: slice });
};
module.exports.RESULT_MESSAGES = RESULT_MESSAGES;
