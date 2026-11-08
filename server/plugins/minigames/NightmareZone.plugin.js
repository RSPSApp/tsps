/**
 * Nightmare Zone (https://oldschool.runescape.wiki/w/Nightmare_Zone), built from rsprox recordings
 * of the lobby (234/03279) and a dream's start (224/01512) and the Wiki for the fights
 * (plugins/minigames/data/nightmare-zone.json). The units are in ./nightmarezone/:
 * - Dominic: his talk, the dream menus and prices, cancelling;
 * - Coffer: Dominic's coffer (deposit, withdraw) and the barrels' Check;
 * - Dream: the enclosure, the vial, the dream's arena, bosses, points and waking up;
 * - Potions: absorption, overload and the super potions in a dream, and the barrels;
 * - PowerUps: the Rumble's power-ups;
 * - Rewards: Dom Onion's Reward Shop (the rewards chest).
 */
const Common = require("./nightmarezone/Common.NightmareZone");
const Dominic = require("./nightmarezone/Dominic.NightmareZone");
const Coffer = require("./nightmarezone/Coffer.NightmareZone");
const Dream = require("./nightmarezone/Dream.NightmareZone");
const Potions = require("./nightmarezone/Potions.NightmareZone");
const PowerUps = require("./nightmarezone/PowerUps.NightmareZone");
const Rewards = require("./nightmarezone/Rewards.NightmareZone");

module.exports = {
  name: "Nightmare Zone",
  description: "Adds the Nightmare Zone: Dominic's dream menus and coffer, the dream arena and bosses, absorption and overload potions, and power-ups.",
  members: true,
  register(api) {
    Common.init(api);
    Dominic.attachDominic(api);
    Coffer.attachCoffer(api);
    Dream.attachDream(api);
    Potions.attachPotions(api);
    PowerUps.attachPowerUps(api);
    Rewards.attachRewards(api);
  },
};
