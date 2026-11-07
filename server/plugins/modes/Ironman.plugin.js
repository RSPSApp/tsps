/**
 * Ironman account types: Ironman, Ultimate Ironman and Hardcore Ironman, per player, chosen with
 * the Ironman tutor on Tutorial Island (downgraded with Adam in Lumbridge) or set with the admin
 * command `::ironman` (docs/ironman.md; plugins/modes/data/ironman.json). Group Ironman comes later.
 */
const Common = require("./ironman/Common.Ironman");

module.exports = {
  name: "Ironman",
  register(api) {
    Common.init(api);
    require("./ironman/Account.Ironman")(api);
    require("./ironman/Commands.Ironman")(api);
    require("./ironman/Trading.Ironman")(api);
    require("./ironman/Loot.Ironman")(api);
    require("./ironman/Duelling.Ironman")(api);
    require("./ironman/Shops.Ironman")(api);
    require("./ironman/Ultimate.Ironman")(api);
    require("./ironman/Hardcore.Ironman")(api);
    require("./ironman/Setup.Ironman")(api);
    require("./ironman/Onboarding.Ironman")(api);
  },
};
