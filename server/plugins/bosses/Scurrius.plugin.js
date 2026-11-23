/**
 * Scurrius, the Rat King, in the Varrock Sewers (Wiki: Scurrius; docs/scurrius.md): his lair
 * with its public room and private instances, the fight, the food piles, the kill count and loot,
 * Historian Aldo's spine trades, the sewer rat patrol, and Combat Achievements.
 */
const Common = require("./scurrius/Common.Scurrius");
const Fight = require("./scurrius/Fight.Scurrius");
const Lair = require("./scurrius/Lair.Scurrius");
const FoodPile = require("./scurrius/FoodPile.Scurrius");
const Kills = require("./scurrius/Kills.Scurrius");
const Aldo = require("./scurrius/Aldo.Scurrius");
const Patrol = require("./scurrius/Patrol.Scurrius");
const CombatAchievements = require("./scurrius/CombatAchievements.Scurrius");

module.exports = {
  name: "Scurrius",
  description: "Scurrius in the Varrock Sewers: the public and private lair, the fight, food piles, kill count, loot and Historian Aldo's lamps.",
  members: true,
  register(api) {
    Common.init(api);
    Fight.attach(api);
    Lair.attach(api);
    FoodPile.attach(api);
    Kills.attach(api);
    Aldo.attach(api);
    Patrol.attach(api);
    CombatAchievements.attach(api);
  },
};
