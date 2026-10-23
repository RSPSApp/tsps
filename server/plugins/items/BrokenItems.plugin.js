"use strict";

/**
 * Untradeables that break on a PvP death, and Perdu, who repairs, locks and unlocks them
 * (https://oldschool.runescape.wiki/w/(broken), docs/broken-items.md). Each part lives in
 * ./brokenitems/.
 */
const Common = require("./brokenitems/Common.BrokenItems");

module.exports = {
  name: "BrokenItems",
  register(api) {
    Common.init(api);
    require("./brokenitems/Death.BrokenItems")(api);
    require("./brokenitems/Perdu.BrokenItems")(api);
  },
};
