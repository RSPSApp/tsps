"use strict";

/**
 * Zulrah: the sacrificial boat from Zul-Andra, the fight at its shrine and what it leaves
 * behind. Each unit lives in ./zulrah/; add one line per unit.
 */
module.exports = {
  name: "Zulrah",
  register(api) {
    require("./zulrah/Shrine.Zulrah")(api);
    require("./zulrah/Commands.Zulrah")(api);
  },
};
