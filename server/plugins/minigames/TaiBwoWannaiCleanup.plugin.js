/**
 * Tai Bwo Wannai Cleanup (https://oldschool.runescape.wiki/w/Tai_Bwo_Wannai_Cleanup), from
 * plugins/minigames/data/tai-bwo-wannai-cleanup.json and the rsprox recordings 227/01858,
 * 237/01102 and 231/03030: hacking the jungle around the village, repairing its fence, the favour
 * that earns and the trading sticks the villagers give for it, what the jungle hides (its
 * monsters, Broodoo victims, gout tubers and gem rocks), and what the sticks buy: Gabooty's shop,
 * Safta Doc's gem machetes, Rionasta's parcels to the bank and the Hardwood Grove. Each part lives
 * in ./taibwowannaicleanup/.
 */
const Common = require("./taibwowannaicleanup/Common.TaiBwoWannaiCleanup");

module.exports = {
  name: "TaiBwoWannaiCleanup",
  description: "Adds Tai Bwo Wannai Cleanup: hacking the jungle, mending the fence, trading sticks and their shop, machetes, parcels and the Hardwood Grove.",
  members: true,
  register(api) {
    Common.init(api);
    require("./taibwowannaicleanup/Locs.TaiBwoWannaiCleanup").attachLocs(api);
    require("./taibwowannaicleanup/Favour.TaiBwoWannaiCleanup").attachFavour(api);
    require("./taibwowannaicleanup/Jungle.TaiBwoWannaiCleanup").attachJungle(api);
    require("./taibwowannaicleanup/Fence.TaiBwoWannaiCleanup").attachFence(api);
    require("./taibwowannaicleanup/Villagers.TaiBwoWannaiCleanup").attachVillagers(api);
    require("./taibwowannaicleanup/Skewers.TaiBwoWannaiCleanup").attachSkewers(api);
    require("./taibwowannaicleanup/Events.TaiBwoWannaiCleanup").attachEvents(api);
    require("./taibwowannaicleanup/GemRock.TaiBwoWannaiCleanup").attachGemRock(api);
    require("./taibwowannaicleanup/Broodoo.TaiBwoWannaiCleanup").attachBroodoo(api);
    require("./taibwowannaicleanup/Shop.TaiBwoWannaiCleanup").attachShop(api);
    require("./taibwowannaicleanup/Machetes.TaiBwoWannaiCleanup").attachMachetes(api);
    require("./taibwowannaicleanup/Parcels.TaiBwoWannaiCleanup").attachParcels(api);
    require("./taibwowannaicleanup/Grove.TaiBwoWannaiCleanup").attachGrove(api);
  },
};
