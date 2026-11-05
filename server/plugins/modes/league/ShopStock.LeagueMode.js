/**
 * Shops whose stock never changes (leagues.json `shopStock`, Leagues VI's "most shop stock will not
 * deplete"): a league character's purchase leaves the shop's own stock as it was, and what they sell
 * to a shop is paid for but never added to it. It answers the shop's `shop:keep-stock` both ways
 * (`selling` on a sale), so only stock a main character sold it goes when bought
 * (ShopManager.takeStock); a main character, or another league's, buys and sells as on any world.
 * Captures: league sales left the stock as it was (237/01102, 21 sapphires sold to Toci's Gem Store
 * and its 3 unchanged), and none of 10 general store opens in Leagues VI recordings showed an item
 * the store doesn't stock, so a sale to a general store adds nothing either.
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
