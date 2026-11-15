"use strict";

/**
 * Rotten potato (Wiki: Rotten potato): Jagex moderators' testing item, here for owners and developers.
 * Each option is a unit in ./rottenpotato/: Eat, Slice, Peel and Mash open their menus; Uses covers using
 * items with it. Docs: docs/rotten-potato.md.
 */
const Common = require("./rottenpotato/Common.RottenPotato");

module.exports = {
  name: "RottenPotato",
  description: "The Rotten potato, the moderators' testing item: stats, inventory, house, teleports, random events, rares and transmogrification, for owners and developers.",
  register(api) {
    Common.init(api);
    require("./rottenpotato/Eat.RottenPotato")(api);
    require("./rottenpotato/Slice.RottenPotato")(api);
    require("./rottenpotato/Peel.RottenPotato")(api);
    require("./rottenpotato/Mash.RottenPotato")(api);
    require("./rottenpotato/Uses.RottenPotato")(api);
  },
};
