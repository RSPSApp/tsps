/**
 * Quests. Each quest lives in ./quests/<Name>.Quest.js and registers its own
 * logic, handlers and (for transcript-driven quests) variant/condition answers
 * through `api.core`; add each quest to QUESTS (and F2P_QUESTS if free-to-play).
 *
 * Shield of Arrav is registered last so the shared Varrock NPCs it finishes on
 * (King Roald, Reldo, ...) fall back to it after the other quests' handlers.
 */
const QUESTS = [
  "RecipeForDisaster",
  "WhileGuthixSleeps",
  "ANightAtTheTheatre",
  // Sins of the Father is the last Myreque chapter, so it registers before the
  // earlier ones (In Search of/In Aid/Darkness of Hallowvale, A Taste of Hope):
  // its stage window wins the shared Myreque NPCs and it defers outside it.
  "SinsOfTheFather", "TheBloodMoonRises",
  "AKingdomDivided", "AnimalMagnetism", "AnotherSliceOfHAM", "ARuffSituation", "AscentOfArceuus",
  "AtFirstLight", "BelowIceMountain", "BeneathCursedSands", "BetweenARock",
  "BigChompyBirdHunting", "Biohazard", "BlackKnightsFortress", "BoneVoyage",
  "CabinFever", "ChildrenOfTheSun", "ClientOfKourend", "ClockTower",
  "ColdWar", "Contact", "CooksAssistant", "CorsairCurse",
  "CrabQuest", "CreatureOfFenkenstrain", "CurrentAffairs", "CurseOfArrav",
  "DarknessOfHallowvale", "DeathOnTheIsle", "DeathPlateau", "DeathToTheDorgeshuun",
  // BearYourSoul also searches the Arceuus Library shelves; DepthsOfDespair's active
  // book step must claim that shared search first.
  "DefenderOfVarrock", "DemonSlayer", "DepthsOfDespair", "BearYourSoul", "DesertTreasureI", "DesertTreasureII",
  "DeviousMinds", "DigSite", "DoricsQuest", "DragonSlayer", "DragonSlayerII",
  "DreamMentor", "DruidicRitual", "DwarfCannon", "EadgarsRuse",
  "EaglesPeak", "ElementalWorkshopI", "ElementalWorkshopII", "EnakhrasLament",
  "EnlightenedJourney", "ErnestTheChicken", "EthicallyAcquiredAntiquities", "EyesOfGlouphrie",
  "FairytaleIGrowingPains", "FairytaleIICureAQueen", "FallenFromGrace", "FamilyCrest",
  "FightArena", "FishingContest", "ForgettableTale", "ForsakenTower",
  // Exiles owns eligible Brundt conversations and yields for earlier quests and lost Seals.
  "TheFremennikExiles", "FremennikTrials", "GardenOfDeath", "GardenOfTranquillity", "GertrudesCat",
  "GettingAhead", "GhostsAhoy", "GiantDwarf", "GoblinDiplomacy",
  "GrandTree", "GreatBrainRobbery", "GrimTales", "HandInTheSand",
  "HauntedMine", "HazeelCult", "HeroesQuest", "HisFaithfulServants", "HolyGrail",
  "HorrorFromTheDeep", "IcthlarinsLittleHelper", "IdesOfMilk", "ImpCatcher",
  "InAidOfTheMyreque", "InSearchOfKnowledge", "InSearchOfTheMyreque", "JunglePotion", "KingsRansom",
  "KnightsSword", "LandOfTheGoblins", "LearningTheRopes", "LegendsQuest", "LostCity",
  "LostTribe", "LunarDiplomacy", "MakingFriendsWithMyArm", "MakingHistory",
  "MeatAndGreet", "MerlinsCrystal", "MisthalinMystery", "MonkeyMadnessI",
  "MonkeyMadnessII", "MonksFriend", "MountainDaughter", "MourningsEndPartI",
  "MourningsEndPartII", "MurderMystery", "MyArmsBigAdventure", "NatureSpirit",
  // Prying Times owns Steve after Pandemonium and yields outside its own stage window.
  "ObservatoryQuest", "OlafsQuest", "OneSmallFavour", "PryingTimes", "Pandemonium",
  "PathOfGlouphrie", "PerilousMoons", "PiratesTreasure", "PlagueCity",
  "PorcineOfInterest", "PriestInPeril", "PrinceAliRescue",
  "QueenOfThieves", "RagAndBoneManI", "RagAndBoneManII", "Ratcatchers",
  "RecruitmentDrive", "RedReef", "Regicide", "RestlessGhost",
  "RibbitingTale", "RomeoAndJuliet", "RovingElves", "RoyalTrouble",
  "RumDeal", "RuneMysteries", "ScorpionCatcher", "Scrambled",
  "SeaSlug", "SecretsOfTheNorth", "ShadesOfMortton", "ShadowOfTheStorm",
  "ShadowsOfCustodia", "SheepHerder", "SheepShearer", "ShieldOfArrav", "SongOfTheElves",
  "ShiloVillage", "SkippyAndTheMogres", "SleepingGiants", "SlugMenace", "SoulsBane",
  "SpiritsOfTheElid", "SwanSong", "TaiBwoWannaiTrio", "TailOfTwoCats",
  "TaleOfTheRighteous", "TasteOfHope", "TearsOfGuthix", "TempleOfIkov", "TempleOfTheEye",
  "TheFeud", "TheFinalDawn", "TheFremennikIsles",
  "TheGolem", "TheHeartOfDarkness", "ThroneOfMiscellania", "TouristTrap",
  "TowerOfLife", "TreeGnomeVillage", "TribalTotem", "TrollRomance",
  "TrollStronghold", "TroubledTortugans", "TwilightPromise", "UndergroundPass",
  "ValeTotems", "VampyreSlayer", "Wanted", "Watchtower", "WaterfallQuest",
  "WhatLiesBelow", "WitchsHouse", "WitchsPotion", "XMarksTheSpot",
  "ZogreFleshEaters",
  // Enter the Abyss shares the Mage of Zamorak with Temple of the Eye and Wanted.
  // Registering it last lets their own stage windows claim the shared NPC first.
  "EnterTheAbyss",
]

// Free-to-play quests (OSRS wiki); the rest stay unloaded on a free-to-play world.
const F2P_QUESTS = new Set([
  "BelowIceMountain",
  "BlackKnightsFortress", "CooksAssistant", "CorsairCurse", "DemonSlayer", "DoricsQuest",
  "DragonSlayer", "ErnestTheChicken", "GoblinDiplomacy", "ImpCatcher", "KnightsSword",
  "LearningTheRopes", "MisthalinMystery", "IdesOfMilk", "PiratesTreasure", "PrinceAliRescue", "RestlessGhost", "RomeoAndJuliet",
  "RuneMysteries", "SheepShearer", "ShieldOfArrav", "VampyreSlayer", "WitchsPotion",
  "XMarksTheSpot",
]);

/**
 * The api the quests get: their login and death hooks skip bots. A bot has no client to send
 * quest progress to and does no quests, and running every quest's login hook (about 160 of them)
 * cost a bot ~85 ms to log in: a minute of startup with the bot population, and a frozen tick
 * when Pest Control fills a lander with bots. The death hooks are worse per event: the bot
 * population dies constantly in combat training, and Horror from the Deep's cleanup scans every
 * NPC in the world (about 30k) on each one, which showed up as the Quests plugin's top cost in
 * `::pluginperf`.
 */
const BOT_SKIPPED_HOOKS = new Set(["onPlayerLogin", "onPlayerDeath"]);

function forPlayers(api) {
  return new Proxy(api, {
    get(target, property) {
      if (BOT_SKIPPED_HOOKS.has(property)) {
        return (handler) => {
          const guarded = (event) => {
            if (event?.player?.isPlayerBot?.() === true) return;
            return handler(event);
          };
          Object.defineProperty(guarded, "name", { value: handler.name });
          return target[property](guarded);
        };
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
  QUESTS,
  register(api) {
    require("./Equipment.Quests")(api);
    require("./QuestRuntime").registerQuestWidgets(forPlayers(api));
    for (const quest of questsForWorld(api.core)) {
      const questApi = forPlayers(api.withProfileLabel?.(`Quests/${quest}`) ?? api);
      require(`./quests/${quest}.Quest`)(questApi);
    }
  },
};
