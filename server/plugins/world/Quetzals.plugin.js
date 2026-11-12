/**
 * The Quetzal Transport System (https://oldschool.runescape.wiki/w/Quetzal_Transport_System): the
 * cache's landing sites (dbtable 64) and the maps that list them. Each part lives in ./quetzals/:
 *
 * - Renu.Quetzals.js: Renu's Travel / Last-destination and her flight (rsprox 1695, 237/1105);
 * - Sites.Quetzals.js: building the six landing sites that don't come with the system;
 * - Whistle.Quetzals.js: the quetzal whistles, their flight (rsprox 237/4002), charges and crafting;
 * - Pitri.Quetzals.js: Soar Leader Pitri's recharges and blueprints;
 * - Primio.Quetzals.js: Primio and Regulus Cento's Varrock - Fortis trips, the first one included.
 *
 * A site can be flown to when the table marks it auto-unlocked or its bit is set in
 * quetzals_unlocked (client script 5015). The quetzal varps are saved as one snapshot and sent
 * again on login.
 *
 * Not modelled: Renu's colours from Regulus Cento (his transcripts here have no such choice), the
 * Perfected quetzal whistle(i)'s imbuing and Pitri's spare perfected whistles.
 */
const Common = require("./quetzals/Common.Quetzals");
const Renu = require("./quetzals/Renu.Quetzals");
const Sites = require("./quetzals/Sites.Quetzals");
const Whistle = require("./quetzals/Whistle.Quetzals");
const Pitri = require("./quetzals/Pitri.Quetzals");
const Primio = require("./quetzals/Primio.Quetzals");

module.exports = {
  name: "Quetzals",
  description: "Quetzal Transport System: Renu's flights, landing sites, quetzal whistles and recharges from Pitri, and Primio's Varrock to Fortis trips.",
  members: true,
  _test: {
    landingSites: () => Common.landingSites(), introduce: Renu.introduce, unlock: Renu.unlock, chooseSite: Renu.chooseSite,
    Common, Renu, Sites, Whistle, Pitri, Primio, VARPS_ATTRIBUTE: Common.VARPS_ATTRIBUTE,
  },
  register(api) {
    Common.init(api);
    api.persistAttribute(Common.VARPS_ATTRIBUTE, null);
    api.onPlayerLogin(Common.restore);
    api.onPlayerDeath(Common.endTimeline);
    Renu.attach(api);
    Sites.attach(api);
    Whistle.attach(api);
    Pitri.attach(api);
    Primio.attach(api);
  },
};
