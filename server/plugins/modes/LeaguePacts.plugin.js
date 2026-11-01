/**
 * Demonic Pacts' pact tree (https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Demonic_Pacts):
 * over 130 nodes of combat boosts, each bought with a pact point once linked to one already held,
 * from the central pact out; pact tasks give the points (up to 40 spent), and the whole tree can be
 * reset a few times. The tree is the cache's (DB table talent_tree, interface 647); the data
 * (data/league-pacts.json) carries what the cache lacks: each effect's varbit, the captured flow
 * and texts. Only a Demonic Pacts character (LeagueMode's `league:profile`) has any of it; the
 * effects ask `league:pact-effect` (docs/leagues.md, Demonic Pacts).
 */
const Common = require("./leaguepacts/Common.LeaguePacts");

module.exports = {
  name: "LeaguePacts",
  members: true,
  dependsOn: ["LeagueMode", "LeagueTasks"],
  register(api) {
    Common.init(api);
    require("./leaguepacts/Points.LeaguePacts")(api);
    require("./leaguepacts/Interface.LeaguePacts")(api);
    require("./leaguepacts/Commands.LeaguePacts")(api);
    require("./leaguepacts/General.LeaguePacts")(api);
    require("./leaguepacts/Melee.LeaguePacts")(api);
    require("./leaguepacts/Ranged.LeaguePacts")(api);
    require("./leaguepacts/Magic.LeaguePacts")(api);
  },
};
