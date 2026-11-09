"use strict";

/**
 * Chests opened with a key (docs/key-chests.md): the crystal chest in Taverley, the brimstone
 * chest on Mount Karuulm, Larran's small and big chests in the Wilderness and the Elven Crystal
 * Chest in Prifddinas; joining the crystal key halves and singing the enhanced crystal key.
 * Units in ./keychests/.
 */
const UNITS = [
  require("./keychests/Data.KeyChests"),
  require("./keychests/Loot.KeyChests"),
  require("./keychests/Chests.KeyChests"),
  require("./keychests/CrystalKey.KeyChests"),
];

module.exports = {
  name: "KeyChests",
  description: "Key-opened chests: Taverley crystal chest, Mount Karuulm brimstone chest, Larran's Wilderness chests and Prifddinas' Elven chest, plus crystal key crafting.",
  members: true,
  register(api) {
    for (const unit of UNITS) unit.init?.(api);
    for (const unit of UNITS) unit.attach?.(api);
  },
};
