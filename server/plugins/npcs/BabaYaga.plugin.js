// shops.json binds both of her wiki shops to Trade, which Shopkeepers leaves unbound as ambiguous.
const AFTER_LUNAR_DIPLOMACY_SHOP_ID = 1032;

function trade(core, { player }) {
  core.ShopManager.open(player, AFTER_LUNAR_DIPLOMACY_SHOP_ID, true);
}

module.exports = {
  name: "BabaYaga",
  members: true,
  register(api) {
    api.onNpcInteraction("Baba Yaga", { Trade: trade.bind(null, api.core) });
  },
};
