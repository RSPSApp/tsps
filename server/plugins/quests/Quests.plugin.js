/**
 * Quests. Each quest lives in ./quests/<Name>.Quest.js and registers its own
 * logic, handlers and (for transcript-driven quests) variant/condition answers
 * through `api.core`; add each quest to QUESTS (and F2P_QUESTS if free-to-play).
 *
 * Shield of Arrav is registered last so the shared Varrock NPCs it finishes on
 * (King Roald, Reldo, ...) fall back to it after the other quests' handlers.
 */
const QUESTS = [
  "BigChompyBirdHunting", "Biohazard", "BlackKnightsFortress", "ClockTower",
  "CooksAssistant", "CreatureOfFenkenstrain", "DeathPlateau", "DemonSlayer",
  "DesertTreasureI", "DigSite", "DoricsQuest", "DragonSlayer", "DruidicRitual",
  "DwarfCannon", "EadgarsRuse", "ElementalWorkshopI", "ErnestTheChicken", "FamilyCrest",
  "FightArena", "FishingContest", "FremennikTrials", "GertrudesCat", "GhostsAhoy",
  "GoblinDiplomacy", "GrandTree", "HandInTheSand", "HazeelCult", "HeroesQuest",
  "HolyGrail", "HorrorFromTheDeep", "ImpCatcher", "InSearchOfTheMyreque", "JunglePotion",
  "KnightsSword", "LegendsQuest", "LostCity", "MerlinsCrystal", "MisthalinMystery",
  "MonksFriend", "MurderMystery", "NatureSpirit", "ObservatoryQuest", "PiratesTreasure",
  "PlagueCity", "PriestInPeril", "PrinceAliRescue", "Regicide", "RestlessGhost",
  "RomeoAndJuliet", "RumDeal", "RuneMysteries", "ScorpionCatcher", "SeaSlug",
  "ShadesOfMortton", "SheepHerder", "SheepShearer", "ShiloVillage", "TaiBwoWannaiTrio",
  "TearsOfGuthix", "TempleOfIkov", "TheGolem", "TouristTrap", "TreeGnomeVillage",
  "TribalTotem", "TrollStronghold", "UndergroundPass", "VampyreSlayer", "Watchtower",
  "WaterfallQuest", "WitchsHouse", "WitchsPotion", "ZogreFleshEaters", "ShieldOfArrav",
];

// Free-to-play quests (OSRS wiki); the rest stay unloaded on a free-to-play world.
const F2P_QUESTS = new Set([
  "BlackKnightsFortress", "CooksAssistant", "DemonSlayer", "DoricsQuest", "DragonSlayer",
  "ErnestTheChicken", "GoblinDiplomacy", "ImpCatcher", "KnightsSword", "MisthalinMystery",
  "PiratesTreasure", "PrinceAliRescue", "RestlessGhost", "RomeoAndJuliet", "RuneMysteries",
  "SheepShearer", "ShieldOfArrav", "VampyreSlayer", "WitchsPotion",
]);

function questsForWorld({ WorldDefinition }) {
  return WorldDefinition.isMembersWorld() ? QUESTS : QUESTS.filter((quest) => F2P_QUESTS.has(quest));
}

module.exports = {
  name: "Quests",
  register(api) {
    for (const quest of questsForWorld(api.core)) require(`./quests/${quest}.Quest`)(api);
  },
};
