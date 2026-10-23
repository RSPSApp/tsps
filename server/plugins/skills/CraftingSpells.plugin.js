/**
 * Spells that make Crafting materials (Wiki; data in data/crafting-spells.json, facts in
 * docs/crafting.md): the Lunar Spin Flax, Tan Leather and Superglass Make, and Charge
 * Water/Earth/Fire/Air Orb on the obelisks.
 */
module.exports = {
  name: "CraftingSpells",
  members: true,
  register(api) {
    require("./craftingspells/Lunar.CraftingSpells")(api);
    require("./craftingspells/ChargeOrbs.CraftingSpells")(api);
  },
};
