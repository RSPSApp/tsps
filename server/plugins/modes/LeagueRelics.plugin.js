/**
 * League relics (https://oldschool.runescape.wiki/w/Trailblazer_Reloaded_League/Relics,
 * https://oldschool.runescape.wiki/w/Raging_Echoes_League/Relics): eight tiers unlocked with
 * League Points, three relics a tier, chosen for good, through the cache's relic interface. The
 * catalog (data/league-relics.json) reaches the client as structs and enums through LeagueMode's
 * `league:content-rows`, since the cache only carries the current league's (Demonic Pacts, which is
 * read from it instead, https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Relics). Other plugins ask `league:has-relic` { player, relic } and
 * apply a relic's effect themselves (docs/leagues.md).
 */
const Common = require("./leaguerelics/Common.LeagueRelics");

module.exports = {
  name: "LeagueRelics",
  members: true,
  dependsOn: ["LeagueMode", "LeaguePoints"],
  register(api) {
    Common.init(api);
    require("./leaguerelics/Unlock.LeagueRelics")(api);
    require("./leaguerelics/Catalog.LeagueRelics")(api);
    require("./leaguerelics/Interface.LeagueRelics")(api);
    require("./leaguerelics/Commands.LeagueRelics")(api);
    require("./leaguerelics/Collect.LeagueRelics")(api);
    require("./leaguerelics/SuperiorSorcerer.LeagueRelics")(api);
    require("./leaguerelics/Berserker.LeagueRelics")(api);
    require("./leaguerelics/UndyingRetribution.LeagueRelics")(api);
    require("./leaguerelics/ArchersEmbrace.LeagueRelics")(api);
    require("./leaguerelics/BrawlersResolve.LeagueRelics")(api);
    require("./leaguerelics/SoulStealer.LeagueRelics")(api);
    require("./leaguerelics/WeaponMaster.LeagueRelics")(api);
    require("./leaguerelics/Executioner.LeagueRelics")(api);
    require("./leaguerelics/Specialist.LeagueRelics")(api);
    require("./leaguerelics/LastStand.LeagueRelics")(api);
    require("./leaguerelics/Equilibrium.LeagueRelics")(api);
    require("./leaguerelics/Toggles.LeagueRelics")(api);
    require("./leaguerelics/Hotfoot.LeagueRelics")(api);
    require("./leaguerelics/Woodsman.LeagueRelics")(api);
    require("./leaguerelics/EndlessHarvest.LeagueRelics")(api);
    require("./leaguerelics/Trickster.LeagueRelics")(api);
    require("./leaguerelics/PowerMiner.LeagueRelics")(api);
    require("./leaguerelics/Lumberjack.LeagueRelics")(api);
    require("./leaguerelics/AnimalWrangler.LeagueRelics")(api);
    require("./leaguerelics/CornerCutter.LeagueRelics")(api);
    require("./leaguerelics/DodgyDeals.LeagueRelics")(api);
    require("./leaguerelics/ProductionProdigy.LeagueRelics")(api);
    require("./leaguerelics/ProductionMaster.LeagueRelics")(api);
    require("./leaguerelics/FriendlyForager.LeagueRelics")(api);
    require("./leaguerelics/FireSale.LeagueRelics")(api);
    require("./leaguerelics/GoldenGod.LeagueRelics")(api);
    require("./leaguerelics/FarmersFortune.LeagueRelics")(api);
    require("./leaguerelics/Overgrown.LeagueRelics")(api);
    require("./leaguerelics/PocketKingdom.LeagueRelics")(api);
    require("./leaguerelics/TreasureSeeker.LeagueRelics")(api);
    require("./leaguerelics/TreasureArbiter.LeagueRelics")(api);
    require("./leaguerelics/Bloodthirsty.LeagueRelics")(api);
    require("./leaguerelics/SlayerMaster.LeagueRelics")(api);
    require("./leaguerelics/FairysFlight.LeagueRelics")(api);
    require("./leaguerelics/Globetrotter.LeagueRelics")(api);
    require("./leaguerelics/BankersNote.LeagueRelics")(api);
    require("./leaguerelics/ClueCompass.LeagueRelics")(api);
    require("./leaguerelics/TotalRecall.LeagueRelics")(api);
    require("./leaguerelics/Grimoire.LeagueRelics")(api);
    require("./leaguerelics/BankHeist.LeagueRelics")(api);
    require("./leaguerelics/ArcaneGrimoire.LeagueRelics")(api);
    require("./leaguerelics/BarbarianGathering.LeagueRelics")(api);
    require("./leaguerelics/Abundance.LeagueRelics")(api);
    require("./leaguerelics/ConnivingClues.LeagueRelics")(api);
    require("./leaguerelics/NaturesAccord.LeagueRelics")(api);
    require("./leaguerelics/Larcenist.LeagueRelics")(api);
    require("./leaguerelics/SoulHarvest.LeagueRelics")(api);
    require("./leaguerelics/EternalSustenance.LeagueRelics")(api);
    require("./leaguerelics/CullingSpree.LeagueRelics")(api);
    require("./leaguerelics/FlowState.LeagueRelics")(api);
    require("./leaguerelics/FlaskOfFervour.LeagueRelics")(api);
    require("./leaguerelics/Transmute.LeagueRelics")(api);
    require("./leaguerelics/ButlersBell.LeagueRelics")(api);
    require("./leaguerelics/Minion.LeagueRelics")(api);
    require("./leaguerelics/EvilEye.LeagueRelics")(api);
    require("./leaguerelics/MapOfAlacrity.LeagueRelics")(api);
    require("./leaguerelics/Hotfoot.LeagueRelics").late(api);
  },
};
