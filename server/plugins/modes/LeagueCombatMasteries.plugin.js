/**
 * Raging Echoes' combat masteries (https://oldschool.runescape.wiki/w/Raging_Echoes_League/Combat_Masteries):
 * three styles of six tiers, each needing the previous tier of its style, paid with Combat
 * Mastery points earned by ten combat challenges; reaching a tier in any style for the first time
 * also grants a passive for every style. The cache's interface (311) draws the tree; the data
 * (data/league-combat-masteries.json) carries the tiers, effects, passives and challenges. Only
 * a Raging Echoes character (LeagueMode's `league:profile`) has any of it; other plugins ask
 * `league:masteries` { player } (docs/leagues.md).
 */
const Common = require("./leaguemasteries/Common.LeagueCombatMasteries");

module.exports = {
  name: "LeagueCombatMasteries",
  description: "Adds Raging Echoes combat masteries: three styles of six tiers bought with points from combat challenges, and the passives they grant.",
  members: true,
  dependsOn: ["LeagueMode"],
  register(api) {
    Common.init(api);
    require("./leaguemasteries/Points.LeagueCombatMasteries")(api);
    require("./leaguemasteries/Unlock.LeagueCombatMasteries")(api);
    require("./leaguemasteries/Interface.LeagueCombatMasteries")(api);
    require("./leaguemasteries/Commands.LeagueCombatMasteries")(api);
    require("./leaguemasteries/AttackRate.LeagueCombatMasteries")(api);
    require("./leaguemasteries/Passives.LeagueCombatMasteries")(api);
    require("./leaguemasteries/Melee.LeagueCombatMasteries")(api);
    require("./leaguemasteries/Ranged.LeagueCombatMasteries")(api);
    require("./leaguemasteries/Magic.LeagueCombatMasteries")(api);
  },
};
