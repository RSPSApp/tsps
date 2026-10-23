/**
 * Crafting (Wiki: Crafting; facts and capture ids in docs/crafting.md): sewing leather and
 * hides, cutting gems and amethyst, gold and silver jewellery, glassblowing, pottery,
 * spinning and weaving, and battlestaves. Each unit is in ./crafting/.
 */
const Shared = require("./crafting/Shared.Crafting");

module.exports = {
  name: "Crafting",
  register(api) {
    Shared.attach(api);
    require("./crafting/Leather.Crafting")(api);
    require("./crafting/Gems.Crafting")(api);
    require("./crafting/Jewellery.Crafting")(api);
    require("./crafting/Glassblowing.Crafting")(api);
    require("./crafting/Pottery.Crafting")(api);
    require("./crafting/Spinning.Crafting")(api);
    require("./crafting/Battlestaves.Crafting")(api);
  },
};
