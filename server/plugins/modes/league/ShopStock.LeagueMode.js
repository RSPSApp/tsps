/**
 * Shops that never deplete (leagues.json `shopStock`, Leagues VI's "most shop stock will not
 * deplete"): a league character's purchase leaves the shop's own stock as it was. It answers the
 * shop's `shop:keep-stock`, so only stock players sold it goes (ShopManager.takeStock); a main
 * character, or another league's, buys as on any world.
 */
const Common = require("./Common.LeagueMode");

function keepStock(request) {
  if (request.keep) return;
  const type = Common.leagueOf(request.player);
  if (type !== null && Common.league(type)?.shopStock?.keep === true) request.keep = true;
}

module.exports = function attach(api) {
  api.onCustomEvent("shop:keep-stock", keepStock);
};
