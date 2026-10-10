/**
 * Quests. Each quest lives in ./quests/<Name>.Quest.js and registers its own
 * logic, handlers and (for transcript-driven quests) variant/condition answers
 * through `api.core`; add each quest to QUESTS (and F2P_QUESTS if free-to-play).
 *
 * Shield of Arrav is registered last so the shared Varrock NPCs it finishes on
 * (King Roald, Reldo, ...) fall back to it after the other quests' handlers.
 */
const QUESTS = [
  "AnimalMagnetism", "AnotherSliceOfHAM", "ARuffSituation", "AscentOfArceuus",
  "AtFirstLight", "BelowIceMountain", "BeneathCursedSands", "BetweenARock",
  "BigChompyBirdHunting", "Biohazard", "BlackKnightsFortress", "BoneVoyage",
  "CabinFever", "ChildrenOfTheSun", "ClientOfKourend", "ClockTower",
  "ColdWar", "Contact", "CooksAssistant", "CorsairCurse",
  "CrabQuest", "CreatureOfFenkenstrain", "CurrentAffairs", "CurseOfArrav",
  "DarknessOfHallowvale", "DeathOnTheIsle", "DeathPlateau", "DeathToTheDorgeshuun",
  "DefenderOfVarrock", "DemonSlayer", "DepthsOfDespair", "DesertTreasureI",
  "DeviousMinds", "DigSite", "DoricsQuest", "DragonSlayer",
  "DreamMentor", "DruidicRitual", "DwarfCannon", "EadgarsRuse",
  "EaglesPeak", "ElementalWorkshopI", "ElementalWorkshopII", "EnakhrasLament",
  "EnlightenedJourney", "ErnestTheChicken", "EthicallyAcquiredAntiquities", "EyesOfGlouphrie",
  "FairytaleIGrowingPains", "FairytaleIICureAQueen", "FallenFromGrace", "FamilyCrest",
  "FightArena", "FishingContest", "ForgettableTale", "ForsakenTower",
  "FremennikTrials", "GardenOfDeath", "GardenOfTranquillity", "GertrudesCat",
  "GettingAhead", "GhostsAhoy", "GiantDwarf", "GoblinDiplomacy",
  "GrandTree", "GreatBrainRobbery", "GrimTales", "HandInTheSand",
  "HauntedMine", "HazeelCult", "HeroesQuest", "HolyGrail",
  "HorrorFromTheDeep", "IcthlarinsLittleHelper", "IdesOfMilk", "ImpCatcher",
  "InAidOfTheMyreque", "InSearchOfTheMyreque", "JunglePotion", "KingsRansom",
  "KnightsSword", "LandOfTheGoblins", "LegendsQuest", "LostCity",
  "LostTribe", "LunarDiplomacy", "MakingFriendsWithMyArm", "MakingHistory",
  "MeatAndGreet", "MerlinsCrystal", "MisthalinMystery", "MonkeyMadnessI",
  "MonkeyMadnessII", "MonksFriend", "MountainDaughter", "MourningsEndPartI",
  "MourningsEndPartII", "MurderMystery", "MyArmsBigAdventure", "NatureSpirit",
  "ObservatoryQuest", "OlafsQuest", "OneSmallFavour", "Pandemonium",
  "PathOfGlouphrie", "PerilousMoons", "PiratesTreasure", "PlagueCity",
  "PorcineOfInterest", "PriestInPeril", "PrinceAliRescue", "PryingTimes",
  "QueenOfThieves", "RagAndBoneManI", "RagAndBoneManII", "Ratcatchers",
  "RecruitmentDrive", "RedReef", "Regicide", "RestlessGhost",
  "RibbitingTale", "RomeoAndJuliet", "RovingElves", "RoyalTrouble",
  "RumDeal", "RuneMysteries", "ScorpionCatcher", "Scrambled",
  "SeaSlug", "SecretsOfTheNorth", "ShadesOfMortton", "ShadowOfTheStorm",
  "ShadowsOfCustodia", "SheepHerder", "SheepShearer", "ShieldOfArrav",
  "ShiloVillage", "SleepingGiants", "SlugMenace", "SoulsBane",
  "SpiritsOfTheElid", "SwanSong", "TaiBwoWannaiTrio", "TailOfTwoCats",
  "TaleOfTheRighteous", "TearsOfGuthix", "TempleOfIkov", "TempleOfTheEye",
  "TheFeud", "TheFinalDawn", "TheFremennikExiles", "TheFremennikIsles",
  "TheGolem", "TheHeartOfDarkness", "ThroneOfMiscellania", "TouristTrap",
  "TowerOfLife", "TreeGnomeVillage", "TribalTotem", "TrollRomance",
  "TrollStronghold", "TroubledTortugans", "TwilightPromise", "UndergroundPass",
  "VampyreSlayer", "Wanted", "Watchtower", "WaterfallQuest",
  "WhatLiesBelow", "WitchsHouse", "WitchsPotion", "XMarksTheSpot",
  "ZogreFleshEaters",
]

// Free-to-play quests (OSRS wiki); the rest stay unloaded on a free-to-play world.
const F2P_QUESTS = new Set([
  "BelowIceMountain",
  "BlackKnightsFortress", "CooksAssistant", "CorsairCurse", "DemonSlayer", "DoricsQuest",
  "DragonSlayer", "ErnestTheChicken", "GoblinDiplomacy", "ImpCatcher", "KnightsSword",
  "MisthalinMystery", "IdesOfMilk", "PiratesTreasure", "PrinceAliRescue", "RestlessGhost", "RomeoAndJuliet",
  "RuneMysteries", "SheepShearer", "ShieldOfArrav", "VampyreSlayer", "WitchsPotion",
  "XMarksTheSpot",
]);

/**
 * The api the quests get: their login hooks skip bots. A bot has no client to send quest progress
 * to and does no quests, and running every quest's login hook (about 160 of them) cost a bot
 * ~85 ms to log in: a minute of startup with the bot population, and a frozen tick when Pest
 * Control fills a lander with bots.
 */
function forPlayers(api) {
  return new Proxy(api, {
    get(target, property) {
      if (property === "onPlayerLogin") {
        return (handler) => target.onPlayerLogin((event) => {
          if (event?.player?.isPlayerBot?.() === true) return;
          return handler(event);
        });
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function questsForWorld({ WorldDefinition }) {
  return WorldDefinition.isMembersWorld() ? QUESTS : QUESTS.filter((quest) => F2P_QUESTS.has(quest));
}

module.exports = {
  name: "Quests",
  register(api) {
    const questApi = forPlayers(api);
    for (const quest of questsForWorld(api.core)) require(`./quests/${quest}.Quest`)(questApi);
  },
};
