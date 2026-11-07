/**
 * Crossbow Bolt Enchantments (Wiki: Enchant_Crossbow_Bolt): the spellbook entry that enchants gem
 * bolts, ten a cast. The menu, casts and data are boltenchanting/Cast.BoltEnchanting.js and
 * data/bolt-enchanting.json; docs/bolt-enchanting.md has the sources.
 */
module.exports = {
  name: "BoltEnchanting",
  members: true,
  register(api) {
    require("./boltenchanting/Cast.BoltEnchanting")(api);
  },
};
