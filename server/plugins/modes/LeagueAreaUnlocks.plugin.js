/**
 * League areas (https://oldschool.runescape.wiki/w/Trailblazer_Reloaded_League/Areas,
 * https://oldschool.runescape.wiki/w/Raging_Echoes_League/Areas): a league character starts in
 * Misthalin and Karamja and unlocks up to three more areas as its completed tasks reach the
 * league's thresholds, through the cache's own area interface. Locked areas keep the character
 * out (walking, teleports, respawns) at the granularity of the map squares the data assigns them
 * (data/league-areas.json). Other plugins ask `league:areas` { player } and `league:area-at`
 * { x, y } (docs/leagues.md).
 */
const Common = require("./leagueareas/Common.LeagueAreaUnlocks");

module.exports = {
  name: "LeagueAreaUnlocks",
  members: true,
  dependsOn: ["LeagueMode", "LeaguePoints"],
  register(api) {
    Common.init(api);
    require("./leagueareas/Unlock.LeagueAreaUnlocks")(api);
    require("./leagueareas/Interface.LeagueAreaUnlocks")(api);
    require("./leagueareas/Enforcement.LeagueAreaUnlocks")(api);
    require("./leagueareas/Commands.LeagueAreaUnlocks")(api);
    require("./leagueareas/HomeTeleport.LeagueAreaUnlocks")(api);
    require("./leagueareas/YamaExit.LeagueAreaUnlocks")(api);
    require("./leagueareas/YamaStones.LeagueAreaUnlocks")(api);
  },
};
