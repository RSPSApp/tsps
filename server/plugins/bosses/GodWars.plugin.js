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
const { attachKeys } = require("./godwars/Keys.GodWars");

module.exports = {
  name: "GodWars",
  description: "God Wars Dungeon: the dungeon and its essence, camp crossings, the generals' shared or private chambers, and the generals' and bodyguards' fights.",
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
    attachKeys(api);
  },
};
