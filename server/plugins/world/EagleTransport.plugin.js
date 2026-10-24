/**
 * The eagle transport system (https://oldschool.runescape.wiki/w/Eagle_transport_system), unlocked
 * by Eagles' Peak (plugins/quests/quests/EaglesPeak.Quest.js), from plugins/world/data/
 * eagle-transport.json: the flights between the Eagles' Peak eyrie and the desert, jungle and polar
 * eyries, and the ways into those on foot. Each lives in ./eagletransport/.
 */
const Common = require("./eagletransport/Common.EagleTransport");
const Flight = require("./eagletransport/Flight.EagleTransport");
const Eyries = require("./eagletransport/Eyries.EagleTransport");

module.exports = {
  name: "EagleTransport",
  members: true,
  register(api) {
    Common.init(api);
    Flight.attach(api);
    Eyries.attach(api);
  },
};
