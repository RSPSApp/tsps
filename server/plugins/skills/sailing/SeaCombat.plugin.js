// Sailing's boat combat (docs/sailing.md, Combat): manning cannons and firing at sea creatures,
// the creatures fighting the boat, its HP and repairs, harvesting their corpses, and ranged and
// magic from the deck. The units are in ./seacombat/; crew gunners and repairs are in ./crew/,
// bounty tasks in ./porttasks/.
const common = require("./seacombat/Common.SeaCombat");

module.exports = {
  name: "SailingSeaCombat",
  description: "Sailing boat combat: manning cannons, sea creatures attacking the boat, boat HP and repairs, corpse harvesting and ranged or magic from the deck.",
  members: true,
  register(api) {
    common.init(api);
    require("./seacombat/BoatHp.SeaCombat")(api);
    require("./seacombat/Cannon.SeaCombat")(api);
    require("./seacombat/Creatures.SeaCombat")(api);
    require("./seacombat/Loot.SeaCombat")(api);
    require("./seacombat/Repairs.SeaCombat")(api);
    require("./seacombat/DeckCombat.SeaCombat")(api);
  },
};
