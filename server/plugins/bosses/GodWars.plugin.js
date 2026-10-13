"use strict";

/**
 * God Wars Dungeon: the dungeon and its essence, the camp crossings, the generals' chambers
 * (shared, or a private instance) and the generals' and bodyguards' fights. Each unit lives in
 * ./godwars/; add one line per unit. See docs/god-wars-dungeon.md.
 */
const Common = require("./godwars/Common.GodWars");
const { attachDungeon } = require("./godwars/Dungeon.GodWars");
const { attachChambers } = require("./godwars/Chambers.GodWars");
const { attachCrossings } = require("./godwars/Crossings.GodWars");
const { attachBandos } = require("./godwars/Bandos.GodWars");
const { attachArmadyl } = require("./godwars/Armadyl.GodWars");
const { attachSaradomin } = require("./godwars/Saradomin.GodWars");
const { attachZamorak } = require("./godwars/Zamorak.GodWars");

module.exports = {
  name: "GodWars",
  members: true,
  register(api) {
    Common.init(api);
    attachDungeon(api);
    attachChambers(api);
    attachCrossings(api);
    attachBandos(api);
    attachArmadyl(api);
    attachSaradomin(api);
    attachZamorak(api);
  },
};
