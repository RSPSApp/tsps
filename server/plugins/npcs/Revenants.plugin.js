/**
 * Revenants (https://oldschool.runescape.wiki/w/Revenants): their combat, the shared drop table,
 * the bracelet of ethereum, the amulet of avarice and the Revenant maledictus, each in
 * ./revenants/. The caves themselves are areas/RevenantCaves.plugin.js; the captured facts are in
 * docs/revenants.md.
 */
const Revenants = require("./revenants/Common.Revenants");

module.exports = {
  name: "Revenants",
  members: true,
  register(api) {
    Revenants.init(api);
    require("./revenants/Combat.Revenants")(api);
    require("./revenants/Loot.Revenants")(api);
    require("./revenants/Bracelet.Revenants")(api);
    require("./revenants/Avarice.Revenants")(api);
    require("./revenants/Maledictus.Revenants")(api);
  },
};
