/**
 * Where items come from other players or the server: an Ironman buys only a shop's own stock,
 * never what players sold to it (Wiki); only bond purchases on the Grand Exchange (Wiki); no presets (this server's
 * loadouts).
 */
const Common = require("./Common.Ironman");

function buyLimit(request) {
  if (!Common.isIron(request.player)) return;
  const own = Math.min(request.available, request.original);
  if (own < request.limit) {
    request.limit = own;
    request.message = Common.message("shopStock");
  }
}

/** Presets (this server's PvP loadouts) hand out items, so an Ironman can't use them. */
function presets(request) {
  if (!Common.isIron(request.player)) return;
  request.allow = false;
  request.message = Common.message("presets");
}

/** Ironmen may buy one tradeable bond per offer, but cannot sell or buy anything else. */
function grandExchangeOffer(request) {
  if (!Common.isIron(request.player)) return;
  if (request.sell || request.itemId !== Common.core.ItemIdentifiers.OLD_SCHOOL_BOND || request.quantity !== 1) {
    request.accepted = false;
    request.player.sendMessage(Common.message("grandExchange"));
  }
}

module.exports = function attach(api) {
  api.onCustomEvent("shop:buy-limit", buyLimit);
  api.onCustomEvent("ge:offer-confirmed", grandExchangeOffer);
  api.onCustomEvent("presets:can-use", presets);
};
