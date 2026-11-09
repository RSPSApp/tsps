module.exports = {
  name: "EnchantJewellery",
  description: "The Lvl-1 to Lvl-7 Enchant spells, which enchant rings, necklaces, bracelets and amulets from the inventory.",
  register(api) {
    require("./Spells.EnchantJewellery")(api);
  },
};
