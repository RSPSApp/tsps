/**
 * Leagues (https://oldschool.runescape.wiki/w/Leagues): a world that runs a league (world.json
 * `"pluginConfig": { "league:type": 4 }`) logs every account into its league character, a save
 * of its own (docs/leagues.md). This plugin gives that character its league (data/leagues.json), its XP
 * rate, the journal's Leagues tab and its Summary / Info / Rank panels, its rank and the
 * summary's statistics, the relic tiers' passives, and sends the structs and enums its screens need (Content). A main
 * character gets the main game's records (trophies, statistics, rankings and firsts) and the
 * Leagues Reward Shop. Points are LeaguePoints.plugin.js, relics LeagueRelics.plugin.js; they
 * talk over the `league:*` events listed in the docs. Apart from the records and the shop, a plain
 * world's characters see none of it.
 */
const Common = require("./league/Common.LeagueMode");

module.exports = {
  name: "LeagueMode",
  members: true,
  register(api) {
    Common.init(api);
    require("./league/Account.LeagueMode")(api);
    require("./league/Content.LeagueMode")(api);
    require("./league/Journal.LeagueMode")(api);
    require("./league/Modals.LeagueMode")(api);
    require("./league/Panels.LeagueMode")(api);
    require("./league/Rank.LeagueMode")(api);
    require("./league/Statistics.LeagueMode")(api);
    require("./league/Tutorial.LeagueMode")(api);
    require("./league/Welcome.LeagueMode")(api);
    require("./league/Records.LeagueMode")(api);
    require("./league/Rewards.LeagueMode")(api);
    require("./league/Passives.LeagueMode")(api);
    require("./league/BoostedDrops.LeagueMode")(api);
    require("./league/ShopStock.LeagueMode")(api);
    require("./league/Shattered.LeagueMode")(api);
    require("./league/Fragments.LeagueMode")(api);
    require("./league/FragmentDrops.LeagueMode")(api);
    require("./league/FragmentEffects.LeagueMode")(api);
    require("./league/FragmentGathering.LeagueMode")(api);
    require("./league/FragmentProduction.LeagueMode")(api);
    require("./league/FragmentSkilling.LeagueMode")(api);
    require("./league/FragmentMinigames.LeagueMode")(api);
    require("./league/FragmentSage.LeagueMode")(api);
    require("./league/Unlocks.LeagueMode")(api);
    require("./league/Sage.LeagueMode")(api);
    require("./league/Commands.LeagueMode")(api);
  },
};
