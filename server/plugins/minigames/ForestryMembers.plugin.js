/**
 * Forestry's members events (https://oldschool.runescape.wiki/w/Forestry), as rsprox records them
 * (plugins/minigames/data/forestry.json). They join the free-to-play ones in Forestry.plugin.js's
 * event table, on members worlds only:
 * - Pheasant: Pheasant Control;
 * - Poachers: the frightened fox;
 * - Ritual: the Enchantment Ritual;
 * - Flowering: the Flowering Bush;
 * - Entlings: pruning the entlings;
 * - Beehive: the bee keeper's hives;
 * - Leprechaun: the Woodcutting Leprechaun's rainbows and banking.
 */
const Pheasant = require("./forestry/Pheasant.Forestry");
const Poachers = require("./forestry/Poachers.Forestry");
const Ritual = require("./forestry/Ritual.Forestry");
const Flowering = require("./forestry/Flowering.Forestry");
const Entlings = require("./forestry/Entlings.Forestry");
const Beehive = require("./forestry/Beehive.Forestry");
const Leprechaun = require("./forestry/Leprechaun.Forestry");

module.exports = {
  name: "Forestry (members)",
  description: "Adds Forestry's members-only events on members worlds: Pheasant Control, the frightened fox, the Enchantment Ritual, the Flowering Bush and entlings.",
  members: true,
  register(api) {
    Pheasant.attachPheasant(api);
    Poachers.attachPoachers(api);
    Ritual.attachRitual(api);
    Flowering.attachFlowering(api);
    Entlings.attachEntlings(api);
    Beehive.attachBeehive(api);
    Leprechaun.attachLeprechaun(api);
  },
};
