/**
 * Skotizo (https://oldschool.runescape.wiki/w/Skotizo), from plugins/bosses/data/skotizo.json, as
 * captured: dark totems and their pieces, the lair a totem opens from the altar in the centre of
 * the Catacombs of Kourend, the fight with its awakened altars, spawns and dark ankou, the kill
 * and its Combat Achievements. Each lives in ./skotizo/. See docs/skotizo.md.
 */
const Common = require("./skotizo/Common.Skotizo");
const Lair = require("./skotizo/Lair.Skotizo");
const Fight = require("./skotizo/Fight.Skotizo");
const CombatAchievements = require("./skotizo/CombatAchievements.Skotizo");

module.exports = {
  name: "Skotizo",
  description: "Skotizo in the Catacombs of Kourend: dark totems, the altar that opens the lair, awakened altars, spawns, the kill and Combat Achievements.",
  members: true,
  register(api) {
    Common.init(api);
    require("./skotizo/Totems.Skotizo")(api);
    Lair.attachLair(api);
    Fight.attachFight(api);
    require("./skotizo/Kills.Skotizo")(api);
    CombatAchievements.attachCombatAchievements(api);
    require("./skotizo/Commands.Skotizo")(api);
  },
};
