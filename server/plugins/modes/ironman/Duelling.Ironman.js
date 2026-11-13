/**
 * No staking in the Duel Arena (Wiki: Ironmen cannot stake anything). A free duel stays open to
 * them; a duel with a stake on either side is refused, so an Ironman can never win another
 * player's items through the stake screen.
 */
const Common = require("./Common.Ironman");

function canStake(request) {
  if (!Common.isIron(request.player)) return;
  request.allow = false;
  request.message = Common.message("duelStake");
}

module.exports = function attach(api) {
  api.onCustomEvent("duelarena:can-stake", canStake);
};
