/**
 * The Volcanic Mine on Fossil Island (https://oldschool.runescape.wiki/w/Volcanic_Mine), from
 * plugins/minigames/data/volcanic-mine.json and the rsprox recordings 1858 and 1854: Petrified
 * Pete and the fee, one game a world in an instance of the mine, its vents, chambers, gas holes and
 * lava, the boulder down the central channel, and the reward on the way out. Each part lives in
 * ./volcanicmine/, the hazards (lava beasts, earthquakes, meteors) and Pete's item retrieval among them.
 */
const Common = require("./volcanicmine/Common.VolcanicMine");
const Capacity = require("./volcanicmine/Capacity.VolcanicMine");

module.exports = {
  name: "VolcanicMine",
  members: true,
  register(api) {
    Common.init(api);
    require("./volcanicmine/Game.VolcanicMine").attachGame(api);
    require("./volcanicmine/Entry.VolcanicMine").attachEntry(api);
    api.persistAttribute(Capacity.CAPACITY_ATTRIBUTE, false);
    api.onCustomEvent("shop:buy-limit", Capacity.limitCapacityPurchase);
    api.onCustomEvent("shop:delivery", Capacity.captureCapacityDelivery);
    api.onCustomEvent("shop:purchase", Capacity.purchaseCapacity);
    api.onCustomEvent("shop:opened", Capacity.explainCapacityShop);
    require("./volcanicmine/Mine.VolcanicMine").attachMine(api);
    require("./volcanicmine/Boulder.VolcanicMine").attachBoulder(api);
    require("./volcanicmine/Hazards.VolcanicMine").attachHazards(api);
    require("./volcanicmine/Retrieval.VolcanicMine").attachRetrieval(api);
  },
};
