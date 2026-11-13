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
    request.message = Common.message("shopStock", { asMode: Common.asMode(request.player) });
  }
}

/** Presets (this server's PvP loadouts) hand out items, so an Ironman can't use them. */
function presets(request) {
  if (!Common.isIron(request.player)) return;
  request.barred = true;
  request.message = Common.message("presets", { asMode: Common.asMode(request.player) });
}

/** Ironmen may buy one tradeable bond per offer, but cannot sell or buy anything else. */
function grandExchangeOffer(request) {
  if (!Common.isIron(request.player)) return;
  if (request.sell || request.itemId !== Common.core.ItemIdentifiers.OLD_SCHOOL_BOND || request.quantity !== 1) {
    request.accepted = false;
    request.player.sendMessage(Common.message("grandExchange", { asMode: Common.asMode(request.player) }));
  }
}

module.exports = function attach(api) {
  api.onCustomEvent("shop:buy-limit", buyLimit);
  api.onCustomEvent("ge:offer-confirmed", grandExchangeOffer);
  api.onCustomEvent("presets:account-barred", presets);
};
