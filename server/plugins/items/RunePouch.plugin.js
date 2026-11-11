"use strict";

/**
 * Rune pouch and divine rune pouch (https://oldschool.runescape.wiki/w/Rune_pouch), from rsprox
 * captures and the Wiki (docs/rune-pouch.md): up to 16,000 of three rune types (four in the
 * divine pouch), kept on the player in the varbits the client reads. Each part lives in
 * ./runepouch/.
 */
const Pouch = require("./runepouch/Common.RunePouch");

module.exports = {
  name: "RunePouch",
  description: "Adds the rune pouch and divine rune pouch: storing up to 16,000 of three or four rune types, the interface, bank deposits, loadouts and the Rune-picking setting.",
  members: true,
  register(api) {
    Pouch.init(api);
    require("./runepouch/Inventory.RunePouch")(api);
    require("./runepouch/Interface.RunePouch")(api);
    require("./runepouch/Bank.RunePouch")(api);
    require("./runepouch/Loadouts.RunePouch")(api);
    require("./runepouch/Death.RunePouch")(api);
    require("./runepouch/Pickup.RunePouch")(api);
  },
};
