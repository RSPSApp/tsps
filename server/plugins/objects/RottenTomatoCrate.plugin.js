/**
 * Pelters' Veg Stall (Wiki: Pelters' Veg Stall, Crate (Pelters' Veg Stall)): the crate of rotten
 * tomatoes by each pillory (Varrock, Seers' Village, Yanille, Hosidius) and Emir's Arena is the
 * shop. All five share its stock; Fadli's own Buy opens the Shop of Distaste instead.
 */
let core;
const SHOP_NAME = "Pelters' Veg Stall";

function buyFromCrate({ player }) {
  const shop = core.ShopDefinition.all().find((entry) => entry.getName() === SHOP_NAME);
  if (shop) core.ShopManager.open(player, shop.getId(), true);
}

module.exports = {
  name: "RottenTomatoCrate",
  members: true,
  register(api) {
    core = api.core;
    api.onObjectInteraction("Crate", { Buy: buyFromCrate });
  },
};
