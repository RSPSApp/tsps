/**
 * Wanted! (members).
 *
 * The words come from the "Wanted!" transcript page (npc-dialogues.json); this
 * plugin supplies the variant selectors for Sir Tiffy Cashien (4687), Sir Amik
 * Varze (4771, shared) and Lord Daquarius (4929), the prose-condition answers,
 * the CommOrb (item 6635) Contact/Scan/Playback actions, the seven-stop trail,
 * the Solus fight and the completion hand-in. Sir Amik, Sir Tiffy and Lord
 * Daquarius are all Talk-to'd through quest-scoped name hooks (the same pattern
 * My Arm's Big Adventure uses for Burntmeat): while this quest is active the
 * Wanted page is played explicitly with startTranscript so Black Knights'
 * Fortress / Recruitment Drive selectors and the shared id-index pages cannot
 * shadow it; when the quest is not active the hooks return false and those
 * other conversations run untouched.
 *
 * Stages (durable `quest.wanted.stage`; transmitted through varbit 1051
 * "wanted_main", bits 0-10 of varp 571 "quest_wanted"; confirmed with
 * `ts-node scripts/lookup-gameval.ts varbit wanted`). The cache's quest 156
 * completion threshold is varbit 1051 >= 11, and Quest Helper's loadSteps keys
 * run 0-10, so WIRE_STAGE_BY_STAGE maps this plugin's finer durable stages onto
 * the helper keys and sends 11 only on completion:
 *   0 not started, 1 Sir Tiffy briefed (see Sir Amik),
 *   2 squireship offer answered (see Tiffy for a crisis), 3 crisis arranged,
 *   4 deputised (see Tiffy for equipment), 5 CommOrb obtained (contact Savant),
 *   6 Savant briefed (see Lord Daquarius), 7 Daquarius refuses (kill a Black
 *   Knight), 8 fur clue (see the Zamorakian mage), 9 the mage's price (20
 *   essence), 10 Solus went east (go to Canifis), 11 scanning the trail,
 *   12 Solus defeated (take his hat to Sir Amik), 13 complete.
 *
 * The trail uses persisted "quest.wanted.mission" as the 1..7 chase position
 * and "wanted:destination" as the current QH mission id. Position 1 is
 * Canifis, 3 the Champions' Guild, 5 the Dorgesh-Kaan mine and 7 the rune
 * essence mine; positions 2, 4 and 6 are picked from the fifteen canonical
 * random destinations. The QH WANTED_MISSION1..19 varbits (1065..1101) carry
 * the current destination and their *complete bits carry visited stops, so the
 * helper and the client see the same route. The clue received at a stop points
 * at the next one: random items at 1/3/5, blue cape at 2, bone spear at 4 and
 * 20 noted essence at 6.
 *
 * Source: OSRS Wiki "Wanted!" and "Transcript:Wanted!"; cache ids from the
 * generated identifiers and scripts/lookup-gameval.ts. Rewards per the Wiki:
 * 1 Quest point, 5,000 Slayer XP and access to the White Knights' armoury.
 * Start requires 32 quest points, The Lost Tribe, Recruitment Drive and Priest
 * in Peril. Rune Mysteries is a transitive prerequisite of The Lost Tribe.
 * Wanted's mage leg needs only the genuine partial Abyss discovery (492>=1):
 * the canonical wilderness invitation reveals his Varrock map parent. QH's
 * general list asks for the full miniquest, but its step-8 graph and the Wiki
 * support this first meeting during Wanted; no miniquest completion is granted.
 *
 * Gaps / approximations:
 *   - The transcript's generic toy-horsey clue has no colour, so the brown base
 *     toy horsey (2520) is the handed-over item.
 *   - The CommOrb "Playback" log plays only the two Solus observation records;
 *     the dossiers are wiki sub-pages the transcript dump could not expand.
 *   - The Black Knight kill that intimidates Daquarius counts anywhere, not
 *     only inside his Taverley room (the wiki's leave-the-room rule is not
 *     modelled).
 *   - The second and fourth scans teleport the player to Camelot / outside
 *     Falador Castle but Solus deals no damage (no death edge case).
 *   - Solus's hat is only received when there is inventory room, per the wiki.
 *   - OSRS loops Asgarnian ale if the player accepts the squireship; here either
 *     reply ("Yes please!" / "No, not right now...") at the offer advances to
 *     the crisis plan, with Tiffy playing his "after agreeing to be Amik's
 *     squire" variant when the player accepted. A completed player falls
 *     through to Sir Tiffy's own transcript page.
 */
module.exports = function registerWantedQuest(api) {
  const { ItemIdentifiers, Location, NpcIdentifiers, Skill } = api.core;
  const { loadTranscripts, refreshQuestList, registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "Wanted!";
  const VARP_WANTED = 571; // "quest_wanted"
  const VARBIT_WANTED_MAIN = 1051; // "wanted_main", varp 571 bits 0-10
  const VARBIT_SQUIRE = 1052;
  const VARBIT_INTEL = 1053;
  const VARBIT_DAQUARIUS = 1055;
  const VARBIT_MAGE = 1056;
  const VARBIT_EXPOSITION = 1058;
  const VARP_ABYSS_DISCOVERY = 492;

  const LOST_TRIBE_QUEST_KEY = "the_lost_tribe";
  const RECRUITMENT_DRIVE_QUEST_KEY = "recruitment_drive";
  const PRIEST_IN_PERIL_QUEST_KEY = "priest_in_peril";
  const QUEST_POINTS_ATTRIBUTE = "quest.points";
  const REQUIRED_QUEST_POINTS = 32;

  // Quest Helper's keys are the live varbit 1051 values. This plugin's durable
  // stages split several of those steps further (orb conversation, hunt
  // checkpoints), so the wire value cannot be the durable stage. Key meanings:
  //   3 see Sir Amik, 4 see Tiffy, 5 see Sir Amik again, 6 see Tiffy for the
  //   orb, 7 orb purchase conversation, 8 contact Savant/investigate, 9 hunt Solus,
  //   10 take the hat to Sir Amik, 11 complete.
  const WIRE_STAGE_BY_STAGE = [0, 3, 4, 5, 6, 8, 8, 8, 8, 8, 9, 9, 10, 11];
  const WIRE_COMPLETE = 11;

  const STAGE_STARTED = 1;
  const STAGE_DECLINED = 2;
  const STAGE_CRISIS = 3;
  const STAGE_MISSION = 4;
  const STAGE_COMMORB = 5;
  const STAGE_CONTACTED = 6;
  const STAGE_DAQUARIUS = 7;
  const STAGE_FUR = 8;
  const STAGE_MAGE_DEAL = 9;
  const STAGE_EAST = 10;
  const STAGE_HUNT = 11;
  const STAGE_DEFEATED = 12;
  const STAGE_COMPLETE = 13;

  // The seven chase positions. 1 Canifis, 3 Champions' Guild, 5 Dorgesh-Kaan
  // and 7 rune essence mine are fixed; 2, 4 and 6 are randomly picked from the
  // fifteen canonical random missions below.
  const POSITION_CANIFIS = 1;
  const POSITION_SECOND = 2;
  const POSITION_CHAMPIONS_GUILD = 3;
  const POSITION_FOURTH = 4;
  const POSITION_DORGESHUUN_MINE = 5;
  const POSITION_SIXTH = 6;
  const POSITION_RUNE_ESSENCE_MINE = 7;

  // Quest Helper's WANTED_MISSION1..19 ids (cache varbits 1065..1101). These
  // name the next destination; the matching *complete varbit is the next id.
  const MISSION_CANIFIS = 1;
  const MISSION_CHAMPIONS_GUILD = 2;
  const MISSION_DORGESHUUN_MINE = 3;
  const MISSION_RUNE_ESSENCE_MINE = 4;
  const MISSION_MUSA_POINT = 5;
  const MISSION_DRAYNOR_MARKET = 6;
  const MISSION_GOBLIN_VILLAGE = 7;
  const MISSION_ARDOUGNE_MARKET = 8;
  const MISSION_GRAND_TREE = 9;
  const MISSION_SCORPIUS_SHRINE = 10;
  const MISSION_ALI_MORRISANE = 11;
  const MISSION_WIZARDS_TOWER = 12;
  const MISSION_BRIMHAVEN_PUB = 13;
  const MISSION_CASTLE_WARS = 14;
  const MISSION_RELLEKKA = 15;
  const MISSION_MCGRUBORS_WOOD = 16;
  const MISSION_SLAYER_TOWER = 17;
  const MISSION_YANILLE_PUB = 18;
  const MISSION_LUMBRIDGE_SWAMP = 19;

  const RANDOM_MISSIONS = [
    MISSION_MUSA_POINT, MISSION_DRAYNOR_MARKET, MISSION_GOBLIN_VILLAGE,
    MISSION_ARDOUGNE_MARKET, MISSION_GRAND_TREE, MISSION_SCORPIUS_SHRINE,
    MISSION_ALI_MORRISANE, MISSION_WIZARDS_TOWER, MISSION_BRIMHAVEN_PUB,
    MISSION_CASTLE_WARS, MISSION_RELLEKKA, MISSION_MCGRUBORS_WOOD,
    MISSION_SLAYER_TOWER, MISSION_YANILLE_PUB, MISSION_LUMBRIDGE_SWAMP,
  ];

  const MISSION_VARBIT = {
    [MISSION_CANIFIS]: 1065,
    [MISSION_CHAMPIONS_GUILD]: 1067,
    [MISSION_DORGESHUUN_MINE]: 1069,
    [MISSION_RUNE_ESSENCE_MINE]: 1071,
    [MISSION_MUSA_POINT]: 1073,
    [MISSION_DRAYNOR_MARKET]: 1075,
    [MISSION_GOBLIN_VILLAGE]: 1077,
    [MISSION_ARDOUGNE_MARKET]: 1079,
    [MISSION_GRAND_TREE]: 1081,
    [MISSION_SCORPIUS_SHRINE]: 1083,
    [MISSION_ALI_MORRISANE]: 1085,
    [MISSION_WIZARDS_TOWER]: 1087,
    [MISSION_BRIMHAVEN_PUB]: 1089,
    [MISSION_CASTLE_WARS]: 1091,
    [MISSION_RELLEKKA]: 1093,
    [MISSION_MCGRUBORS_WOOD]: 1095,
    [MISSION_SLAYER_TOWER]: 1097,
    [MISSION_YANILLE_PUB]: 1099,
    [MISSION_LUMBRIDGE_SWAMP]: 1101,
  };

  // The old plugin fixed positions 2/4/6 to these destinations. Keep them for
  // saves written before the random mission varbits existed.
  const OLD_DESTINATION_BY_POSITION = {
    [POSITION_CANIFIS]: MISSION_CANIFIS,
    [POSITION_SECOND]: MISSION_RELLEKKA,
    [POSITION_CHAMPIONS_GUILD]: MISSION_CHAMPIONS_GUILD,
    [POSITION_FOURTH]: MISSION_WIZARDS_TOWER,
    [POSITION_DORGESHUUN_MINE]: MISSION_DORGESHUUN_MINE,
    [POSITION_SIXTH]: MISSION_CASTLE_WARS,
    [POSITION_RUNE_ESSENCE_MINE]: MISSION_RUNE_ESSENCE_MINE,
  };

  const FIXED_DESTINATION_BY_POSITION = {
    [POSITION_CANIFIS]: MISSION_CANIFIS,
    [POSITION_CHAMPIONS_GUILD]: MISSION_CHAMPIONS_GUILD,
    [POSITION_DORGESHUUN_MINE]: MISSION_DORGESHUUN_MINE,
    [POSITION_RUNE_ESSENCE_MINE]: MISSION_RUNE_ESSENCE_MINE,
  };

  const SIR_TIFFY_CASHIEN_NPC_ID = NpcIdentifiers.SIR_TIFFY_CASHIEN; // 4687
  const SIR_AMIK_VARZE_NPC_ID = NpcIdentifiers.SIR_AMIK_VARZE_4; // 4771
  const LORD_DAQUARIUS_NPC_ID = NpcIdentifiers.LORD_DAQUARIUS; // 4929
  // Map parents 3228/3229 resolve to these wilderness/chapel dialogue actors.
  const WILDERNESS_MAGE_NPC_ID = NpcIdentifiers.MAGE_OF_ZAMORAK; // 2580
  const VARROCK_MAGE_NPC_ID = NpcIdentifiers.MAGE_OF_ZAMORAK_3; // 2582
  const SAVANT_NPC_ID = NpcIdentifiers.SAVANT; // 4931
  const SOLUS_DELLAGAR_NPC_ID = NpcIdentifiers.SOLUS_DELLAGAR; // 4930
  const SOLUS_DELLAGAR_FIGHT_NPC_ID = NpcIdentifiers.SOLUS_DELLAGAR_3; // 4962
  const BLACK_KNIGHT_SUMMONED_NPC_ID = NpcIdentifiers.BLACK_KNIGHT_6; // 4959
  const TAVERLEY_BLACK_KNIGHT_IDS = new Set([
    NpcIdentifiers.BLACK_KNIGHT_2, // 516
    NpcIdentifiers.BLACK_KNIGHT_3, // 517
    NpcIdentifiers.BLACK_KNIGHT_4, // 4331
  ]);

  const COMMORB_ITEM_ID = ItemIdentifiers.COMMORB; // 6635
  const SOLUSS_HAT_ITEM_ID = ItemIdentifiers.SOLUSS_HAT; // 6636
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const LAW_RUNE_ITEM_ID = ItemIdentifiers.LAW_RUNE; // 563
  const ENCHANTED_GEM_ITEM_ID = ItemIdentifiers.ENCHANTED_GEM; // 4155
  const MOLTEN_GLASS_ITEM_ID = ItemIdentifiers.MOLTEN_GLASS; // 1775
  const RUNE_ESSENCE_ITEM_ID = ItemIdentifiers.RUNE_ESSENCE; // 1436
  const PURE_ESSENCE_ITEM_ID = ItemIdentifiers.PURE_ESSENCE; // 7936
  const NOTED_RUNE_ESSENCE_ITEM_ID = ItemIdentifiers.RUNE_ESSENCE_2; // 1437, noted
  const FREMENNIK_PURPLE_CLOAK_ITEM_ID = ItemIdentifiers.FREMENNIK_PURPLE_CLOAK; // 3785
  const BLUE_CAPE_ITEM_ID = ItemIdentifiers.BLUE_CAPE; // 1021
  const BLUE_WIZARD_HAT_ITEM_ID = ItemIdentifiers.BLUE_WIZARD_HAT; // 579
  const BONE_SPEAR_ITEM_ID = ItemIdentifiers.BONE_SPEAR; // 5016
  const CASTLE_WARS_TICKET_ITEM_ID = ItemIdentifiers.CASTLE_WARS_TICKET; // 4067
  const BANANA_ITEM_ID = ItemIdentifiers.BANANA; // 1963
  const BROWN_TOY_HORSEY_ITEM_ID = ItemIdentifiers.BROWN_TOY_HORSEY; // 2520 (colour-agnostic clue)
  const GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.GOBLIN_MAIL; // 288
  const BEAR_FUR_ITEM_ID = ItemIdentifiers.BEAR_FUR; // 948
  const CREAM_HAT_ITEM_ID = ItemIdentifiers.CREAM_HAT; // 662
  const UNHOLY_SYMBOL_ITEM_ID = ItemIdentifiers.UNHOLY_SYMBOL; // 1724
  const FAKE_BEARD_ITEM_ID = ItemIdentifiers.FAKE_BEARD; // 4593
  const RIGHT_EYE_PATCH_ITEM_ID = ItemIdentifiers.RIGHT_EYE_PATCH; // 1025
  const EARMUFFS_ITEM_ID = ItemIdentifiers.EARMUFFS; // 4166
  const GREENMANS_ALE_ITEM_ID = ItemIdentifiers.GREENMANS_ALE; // 1909
  const RED_VINE_WORM_ITEM_ID = ItemIdentifiers.RED_VINE_WORM; // 25
  const GIANT_FROG_LEGS_ITEM_ID = ItemIdentifiers.GIANT_FROG_LEGS; // 4517
  const INITIATE_ARMOUR_ITEM_IDS = new Set([
    ItemIdentifiers.INITIATE_SALLET, // 5574
    ItemIdentifiers.INITIATE_HAUBERK, // 5575
    ItemIdentifiers.INITIATE_CUISSE, // 5576
  ]);

  // Transcript variants on the "Wanted!" page.
  const V_TIFFY_START = "starting-off";
  const V_TIFFY_CONTINUE = "starting-off-continuing-the-dialogue";
  const V_TIFFY_SQUIRE_FIX = "falador-park-the-crisis-talking-to-sir-tiffy-after-agreeing-to-be-amik-s-squire";
  const V_TIFFY_CRISIS = "falador-park-the-crisis-talking-to-sir-tiffy-after-declining-to-be-amik-s-squire";
  const V_TIFFY_BEFORE_AMIK = "falador-park-the-crisis-talking-to-sir-tiffy-before-revisiting-sir-amik";
  const V_TIFFY_MISSION = "falador-park-mission-details";
  const V_TIFFY_BEFORE_USE = "falador-park-mission-details-talking-to-tiffy-before-using-the-communication-orb";
  const V_TIFFY_ORB_LOST = "falador-park-mission-details-claiming-another-communication-orb-from-tiffy";
  const V_TIFFY_DONE = "completing-the-quest-talking-to-tiffy";
  const V_AMIK_FIRST = "falador-castle-first-visit-to-sir-amik";
  const V_AMIK_REFUSED = "falador-castle-first-visit-to-sir-amik-talking-to-sir-amik-after-refusing-to-become-his-squire";
  const V_AMIK_SECOND = "falador-castle-second-visit-to-sir-amik";
  const V_AMIK_MISSION = "falador-castle-second-visit-to-sir-amik-talking-to-sir-amik-after-agreeing-to-go-after-solus";
  const V_AMIK_DONE = "completing-the-quest-talking-to-sir-amik";
  const V_SAVANT_FIRST = "falador-park-mission-details-contacting-savant";
  const V_SAVANT_AGAIN = "falador-park-mission-details-contacting-savant-again";
  const V_SAVANT_PLAYBACK = "commorb-files-playback";
  const V_RECORD_1 = "commorb-files-playback-solus-observation-record-1";
  const V_RECORD_2 = "commorb-files-playback-solus-observation-record-2";
  const V_RECORD_DOSSIER = "commorb-files-playback-dossier-of-solus-dellagar";
  const V_SAVANT_CANIFIS_CALL = "approaching-canifis";
  const V_SAVANT_FAILING = "approaching-canifis-failing-scans";
  const V_SAVANT_HINT = "approaching-canifis-talking-to-savant-again";
  const V_SCAN_CANIFIS = "approaching-canifis-scanning-in-canifis";
  const V_SCAN_SECOND = "scanning-the-second-location";
  const V_SCAN_CHAMPIONS = "scanning-at-champion-s-guild";
  const V_SCAN_FOURTH = "scanning-the-fourth-location";
  const V_SCAN_DORGESHUUN = "scanning-in-dorgeshuun-mines";
  const V_SCAN_SIXTH = "scanning-the-sixth-location";
  const V_SCAN_SIXTH_DONE = "scanning-the-sixth-location-after-the-black-knight-is-defeated";
  const V_SCAN_FINAL = "rune-essence-mine-ending-the-hunt";
  const V_SCAN_FINAL_DONE = "rune-essence-mine-ending-the-hunt-after-defeating-solus";
  const V_SAVANT_HAT = "rune-essence-mine-ending-the-hunt-communicating-with-savant-after-defeating-solus";
  const V_DAQUARIUS = "lord-daquarius";
  const V_DAQUARIUS_BEFORE = "lord-daquarius-talking-to-lord-daquarius-again-before-killing-any-knights";
  const V_DAQUARIUS_STOP = "lord-daquarius-after-killing-a-black-knight";
  const V_DAQUARIUS_AFTER = "lord-daquarius-talking-to-lord-daquarius-after-killing-a-black-knight";
  const V_DAQUARIUS_LEARNED = "lord-daquarius-talking-to-lord-daquarius-after-learning-about-solus";
  const V_MAGE = "zamorakian-mage";
  const V_MAGE_DEAL = "zamorakian-mage-the-essence-deal";
  const V_MAGE_AGAIN = "zamorakian-mage-talking-to-the-mage-of-zamorak-again";

  const START_HOOK = "quest:wanted:start";

  const ZONE_LEVEL_0_ONLY = [0];
  const CANIFIS_ZONE = { minX: 3455, maxX: 3530, minY: 3455, maxY: 3520, levels: ZONE_LEVEL_0_ONLY };
  const RELLEKKA_ZONE = { minX: 2630, maxX: 2700, minY: 3635, maxY: 3690, levels: ZONE_LEVEL_0_ONLY };
  const CHAMPIONS_GUILD_ZONE = { minX: 3185, maxX: 3206, minY: 3351, maxY: 3371, levels: ZONE_LEVEL_0_ONLY };
  const WIZARDS_TOWER_ZONE = { minX: 3098, maxX: 3120, minY: 3153, maxY: 3178, levels: [0, 1, 2] };
  const DORGESHUUN_MINE_ZONE = { minX: 3280, maxX: 3390, minY: 9580, maxY: 9660, levels: ZONE_LEVEL_0_ONLY };
  const CASTLE_WARS_ZONE = { minX: 2420, maxX: 2460, minY: 3075, maxY: 3105, levels: ZONE_LEVEL_0_ONLY };
  const RUNE_ESSENCE_MINE_ZONE = { minX: 2880, maxX: 2950, minY: 4800, maxY: 4865, levels: ZONE_LEVEL_0_ONLY };
  const WHITE_KNIGHTS_CASTLE_ZONE = { minX: 2964, maxX: 2997, minY: 3333, maxY: 3356, levels: [0, 1, 2] };
  // QH Musa Point has 1366..3158; correcting 1366 to 3166 includes its 2916,3160 marker.
  // shortcut: exact OSRS scan edges are uncaptured; verify them before changing this bounded correction.
  const MUSA_POINT_ZONE = { minX: 2913, maxX: 2919, minY: 3158, maxY: 3166, levels: ZONE_LEVEL_0_ONLY };
  const DRAYNOR_MARKET_ZONE = { minX: 3077, maxX: 3085, minY: 3246, maxY: 3254, levels: ZONE_LEVEL_0_ONLY };
  const GOBLIN_VILLAGE_ZONE = { minX: 2947, maxX: 2967, minY: 3499, maxY: 3516, levels: ZONE_LEVEL_0_ONLY };
  const ARDOUGNE_MARKET_ZONE = { minX: 2655, maxX: 2668, minY: 3301, maxY: 3313, levels: ZONE_LEVEL_0_ONLY };
  const GRAND_TREE_ZONE = { minX: 2463, maxX: 2469, minY: 3493, maxY: 3499, levels: ZONE_LEVEL_0_ONLY };
  const SCORPIUS_SHRINE_ZONE = { minX: 2461, maxX: 2470, minY: 3225, maxY: 3231, levels: ZONE_LEVEL_0_ONLY };
  const ALI_MORRISANE_ZONE = { minX: 3300, maxX: 3306, minY: 3209, maxY: 3216, levels: ZONE_LEVEL_0_ONLY };
  const BRIMHAVEN_PUB_ZONE = { minX: 2791, maxX: 2800, minY: 3154, maxY: 3170, levels: ZONE_LEVEL_0_ONLY };
  const MCGRUBORS_WOOD_ZONES = [
    { minX: 2624, maxX: 2654, minY: 3470, maxY: 3502, levels: ZONE_LEVEL_0_ONLY },
    { minX: 2662, maxX: 2677, minY: 3484, maxY: 3504, levels: ZONE_LEVEL_0_ONLY },
  ];
  const SLAYER_TOWER_ZONE = { minX: 3405, maxX: 3453, minY: 3534, maxY: 3580, levels: ZONE_LEVEL_0_ONLY };
  const YANILLE_PUB_ZONE = { minX: 2548, maxX: 2557, minY: 3077, maxY: 3082, levels: ZONE_LEVEL_0_ONLY };
  const LUMBRIDGE_SWAMP_CAVES_ZONE = { minX: 3216, maxX: 3239, minY: 9540, maxY: 9555, levels: ZONE_LEVEL_0_ONLY };

  const CAMELOT_TILE = { x: 2757, y: 3477, z: 0 };
  const FALADOR_CASTLE_OUTSIDE_TILE = { x: 2977, y: 3338, z: 0 };

  // Each entry describes the destination (QH mission id), the zone to scan in,
  // the clue item that points there, and the transcript condition/message ids
  // for that clue. Fixed destinations keep their predetermined clue item.
  const MISSION_DEFINITIONS = {
    [MISSION_CANIFIS]: { name: "Canifis", zone: CANIFIS_ZONE },
    [MISSION_CHAMPIONS_GUILD]: { name: "Champions' Guild", zone: CHAMPIONS_GUILD_ZONE, clueItem: BLUE_CAPE_ITEM_ID },
    [MISSION_DORGESHUUN_MINE]: { name: "Dorgesh-Kaan mine", zone: DORGESHUUN_MINE_ZONE, clueItem: BONE_SPEAR_ITEM_ID },
    [MISSION_RUNE_ESSENCE_MINE]: { name: "Rune essence mine", zone: RUNE_ESSENCE_MINE_ZONE, clueItem: NOTED_RUNE_ESSENCE_ITEM_ID, clueAmount: 20 },
    [MISSION_MUSA_POINT]: { name: "Musa Point", zone: MUSA_POINT_ZONE, clueItem: BANANA_ITEM_ID, firstCondition: "j5Pacg", firstStep: "NZOIUt", recapCondition: "HFiKqm" },
    [MISSION_DRAYNOR_MARKET]: { name: "Draynor Market", zone: DRAYNOR_MARKET_ZONE, clueItem: BROWN_TOY_HORSEY_ITEM_ID, firstCondition: "fvpmF5", firstStep: "DjOVBv", recapCondition: "LDNa0G" },
    [MISSION_GOBLIN_VILLAGE]: { name: "Goblin Village", zone: GOBLIN_VILLAGE_ZONE, clueItem: GOBLIN_MAIL_ITEM_ID, firstCondition: "xsrPZk", firstStep: "s_gm2c", recapCondition: "VfLdkk" },
    [MISSION_ARDOUGNE_MARKET]: { name: "Ardougne Market", zone: ARDOUGNE_MARKET_ZONE, clueItem: BEAR_FUR_ITEM_ID, firstCondition: "TgXuG7", firstStep: "sjgyQZ", recapCondition: "CXVORn" },
    [MISSION_GRAND_TREE]: { name: "Grand Tree", zone: GRAND_TREE_ZONE, clueItem: CREAM_HAT_ITEM_ID, firstCondition: "ORbz7w", firstStep: "YCBBF7", recapCondition: "54UVrf" },
    [MISSION_SCORPIUS_SHRINE]: { name: "Shrine of Scorpius", zone: SCORPIUS_SHRINE_ZONE, clueItem: UNHOLY_SYMBOL_ITEM_ID, firstCondition: "A4f-N_", firstStep: "f3dlmQ", recapCondition: "ZjlBeQ" },
    [MISSION_ALI_MORRISANE]: { name: "Ali Morrisane", zone: ALI_MORRISANE_ZONE, clueItem: FAKE_BEARD_ITEM_ID, firstCondition: "HZgS0z", firstStep: "X-jLCw", recapCondition: "7vXk1y" },
    [MISSION_WIZARDS_TOWER]: { name: "Wizards' Tower", zone: WIZARDS_TOWER_ZONE, clueItem: BLUE_WIZARD_HAT_ITEM_ID, firstCondition: "YnbS1i", firstStep: "VTgt8I", recapCondition: "A8CgM8" },
    [MISSION_BRIMHAVEN_PUB]: { name: "Brimhaven pub", zone: BRIMHAVEN_PUB_ZONE, clueItem: RIGHT_EYE_PATCH_ITEM_ID, firstCondition: "CAIvwn", firstStep: "yzrPqL", recapCondition: "ISP8Fl" },
    [MISSION_CASTLE_WARS]: { name: "Castle Wars", zone: CASTLE_WARS_ZONE, clueItem: CASTLE_WARS_TICKET_ITEM_ID, firstCondition: "DPRk5N", firstStep: "yCYScL", recapCondition: "DjhHrd" },
    [MISSION_RELLEKKA]: { name: "Rellekka", zone: RELLEKKA_ZONE, clueItem: FREMENNIK_PURPLE_CLOAK_ITEM_ID, firstCondition: "Xhbln-", firstStep: "WB1yMP", recapCondition: "z3YtI9" },
    [MISSION_MCGRUBORS_WOOD]: { name: "McGrubor's Wood", zone: MCGRUBORS_WOOD_ZONES, clueItem: RED_VINE_WORM_ITEM_ID, firstCondition: "ErFows", firstStep: "o_opbE", recapCondition: "bUhFQQ" },
    [MISSION_SLAYER_TOWER]: { name: "Slayer Tower", zone: SLAYER_TOWER_ZONE, clueItem: EARMUFFS_ITEM_ID, firstCondition: "jdDxg7", firstStep: "Cv9NjI", recapCondition: "wtbH4I" },
    [MISSION_YANILLE_PUB]: { name: "Yanille pub", zone: YANILLE_PUB_ZONE, clueItem: GREENMANS_ALE_ITEM_ID, firstCondition: "WhEdiy", firstStep: "sH7QJd", recapCondition: "4znMoL" },
    [MISSION_LUMBRIDGE_SWAMP]: { name: "Lumbridge Swamp Caves", zone: LUMBRIDGE_SWAMP_CAVES_ZONE, clueItem: GIANT_FROG_LEGS_ITEM_ID, firstCondition: "2ZR-Ny", firstStep: "idUV-w", recapCondition: "JAC5WU" },
  };

  const FIRST_RUN_CONDITION_MISSION = new Map();
  const FIRST_RUN_STEP_MISSION = new Map();
  const RECAP_CONDITION_MISSION = new Map();
  for (const [id, definition] of Object.entries(MISSION_DEFINITIONS)) {
    const mission = Number(id);
    if (definition.firstCondition) {
      FIRST_RUN_CONDITION_MISSION.set(definition.firstCondition, mission);
      FIRST_RUN_STEP_MISSION.set(definition.firstStep, mission);
    }
    if (definition.recapCondition) RECAP_CONDITION_MISSION.set(definition.recapCondition, mission);
  }
  // Recaps of the predetermined clues and the cake/fur variants that also point
  // at Ardougne Market.
  RECAP_CONDITION_MISSION.set("Nx6niM", MISSION_CHAMPIONS_GUILD);
  RECAP_CONDITION_MISSION.set("pLYUGv", MISSION_DORGESHUUN_MINE);
  RECAP_CONDITION_MISSION.set("lTnXsm", MISSION_RUNE_ESSENCE_MINE);
  RECAP_CONDITION_MISSION.set("uEBRbB", MISSION_ARDOUGNE_MARKET);

  const FIXED_CLUE_BY_STEP = {
    qUGLsM: { position: POSITION_SECOND, next: MISSION_CHAMPIONS_GUILD, itemId: BLUE_CAPE_ITEM_ID },
    mdADDD: { position: POSITION_FOURTH, next: MISSION_DORGESHUUN_MINE, itemId: BONE_SPEAR_ITEM_ID },
    "3AZ4ZV": { position: POSITION_SIXTH, next: MISSION_RUNE_ESSENCE_MINE, itemId: NOTED_RUNE_ESSENCE_ITEM_ID, amount: 20 },
  };

  const SCAN_VARIANT_BY_POSITION = {
    [POSITION_CANIFIS]: V_SCAN_CANIFIS,
    [POSITION_SECOND]: V_SCAN_SECOND,
    [POSITION_CHAMPIONS_GUILD]: V_SCAN_CHAMPIONS,
    [POSITION_FOURTH]: V_SCAN_FOURTH,
    [POSITION_DORGESHUUN_MINE]: V_SCAN_DORGESHUUN,
    [POSITION_SIXTH]: V_SCAN_SIXTH,
    [POSITION_RUNE_ESSENCE_MINE]: V_SCAN_FINAL,
  };

  const MISSION_ATTRIBUTE = "quest.wanted.mission";
  const DESTINATION_ATTRIBUTE = "wanted:destination";
  const PENDING_DESTINATION_ATTRIBUTE = "wanted:pending-destination";
  const COMPLETED_MISSIONS_ATTRIBUTE = "wanted:completed-missions";
  const SQUIRE_ATTRIBUTE = "quest.wanted.squire";
  const BLACK_KNIGHT_DEAD_ATTRIBUTE = "quest.wanted.black-knight-dead";
  const INTEL_ATTRIBUTE = "wanted:commorb-intel";
  const DAQUARIUS_ATTRIBUTE = "wanted:daquarius-hint";
  const EXPOSITION_ATTRIBUTE = "wanted:lord-d-exposition";
  const MAGE_HINT_ATTRIBUTE = "wanted:zammy-mage-hint";
  const MAGE_INVITATION_ATTRIBUTE = "mage-of-zamorak:varrock-invitation";
  const INVESTIGATION_FLAGS = [
    [INTEL_ATTRIBUTE, VARBIT_INTEL],
    [DAQUARIUS_ATTRIBUTE, VARBIT_DAQUARIUS],
    [EXPOSITION_ATTRIBUTE, VARBIT_EXPOSITION],
    [MAGE_HINT_ATTRIBUTE, VARBIT_MAGE],
  ];

  let quest;
  /** Player -> owner-only quest spawns. */
  const summonedKnightByPlayer = new Map();
  const solusByPlayer = new Map();
  /** Player -> "buy" | "make" for the current CommOrb purchase conversation. */
  const orbPathByPlayer = new Map();
  /** Players whose squireship entail branch still needs the Yes/No offer. */
  const squirePromptPlayers = new Set();
  const otherMageTopics = new WeakSet();
  let clueTailCache = null;

  function wantedVariant(variant) {
    return { page: PAGE, variant };
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function hasHat(player) {
    return hasItem(player, SOLUSS_HAT_ITEM_ID);
  }

  function bankHasHat(player) {
    return Number(player.getBank?.()?.getAmount?.(SOLUSS_HAT_ITEM_ID) ?? 0) > 0;
  }

  function wearsInitiateArmour(player) {
    return player
      .getEquipment()
      .getValidItems()
      .some((item) => INITIATE_ARMOUR_ITEM_IDS.has(item.getId?.()));
  }

  function commorbComponents(player) {
    let count = 0;
    if (hasItem(player, LAW_RUNE_ITEM_ID)) count++;
    if (hasItem(player, ENCHANTED_GEM_ITEM_ID)) count++;
    if (hasItem(player, MOLTEN_GLASS_ITEM_ID)) count++;
    return count;
  }

  function essenceAmount(player) {
    return (
      player.getInventory().getAmount(RUNE_ESSENCE_ITEM_ID) +
      player.getInventory().getAmount(PURE_ESSENCE_ITEM_ID)
    );
  }

  function hasEssenceStack(player) {
    return hasItem(player, RUNE_ESSENCE_ITEM_ID, 20) || hasItem(player, PURE_ESSENCE_ITEM_ID, 20);
  }

  /** Durable chase position, 1..7 (old saves already use this meaning). */
  function getPosition(player) {
    return Number(player.getAttribute(MISSION_ATTRIBUTE)) || 0;
  }

  function setPosition(player, value) {
    player.setAttribute(MISSION_ATTRIBUTE, value | 0);
  }

  /** QH mission id of the current destination (1..19). */
  function getDestination(player) {
    return Number(player.getAttribute(DESTINATION_ATTRIBUTE)) || 0;
  }

  function setDestination(player, value) {
    player.setAttribute(DESTINATION_ATTRIBUTE, value | 0);
  }

  /** Random destination chosen by the current scan but not yet handed over. */
  function getPendingDestination(player) {
    return Number(player.getAttribute(PENDING_DESTINATION_ATTRIBUTE)) || 0;
  }

  function setPendingDestination(player, value) {
    player.setAttribute(PENDING_DESTINATION_ATTRIBUTE, value | 0);
  }

  function readVarbit(player, varbit) {
    return Number(player.getPacketSender().getVarbit(varbit)) || 0;
  }

  function writeVarbit(player, varbit, value) {
    player.getPacketSender().sendVarbit(varbit, value | 0);
  }

  function isRandomMission(mission) {
    return RANDOM_MISSIONS.includes(mission);
  }

  function completedMissions(player) {
    return Number(player.getAttribute(COMPLETED_MISSIONS_ATTRIBUTE)) || 0;
  }

  function setCompletedMissions(player, mask) {
    player.setAttribute(COMPLETED_MISSIONS_ATTRIBUTE, mask | 0);
  }

  function isMissionComplete(player, mission) {
    return (completedMissions(player) & (1 << (mission - 1))) !== 0;
  }

  function markMissionComplete(player, mission) {
    setCompletedMissions(player, completedMissions(player) | (1 << (mission - 1)));
  }

  function syncCompletedMissions(player) {
    let mask = completedMissions(player);
    for (let mission = 1; mission <= MISSION_LUMBRIDGE_SWAMP; mission++) {
      if (readVarbit(player, MISSION_VARBIT[mission] + 1) === 1) mask |= 1 << (mission - 1);
    }
    setCompletedMissions(player, mask);
    return mask;
  }

  function missionFromVarbits(player) {
    for (let mission = 1; mission <= MISSION_LUMBRIDGE_SWAMP; mission++) {
      if (readVarbit(player, MISSION_VARBIT[mission]) === 1) return mission;
    }
    return 0;
  }

  function normalizePosition(value) {
    return value >= POSITION_CANIFIS && value <= POSITION_RUNE_ESSENCE_MINE ? value : POSITION_CANIFIS;
  }

  function chooseRandomMission(player) {
    const available = RANDOM_MISSIONS.filter((mission) => !isMissionComplete(player, mission));
    const pool = available.length ? available : RANDOM_MISSIONS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function ensurePendingDestination(player) {
    const pending = getPendingDestination(player);
    if (isRandomMission(pending) && !isMissionComplete(player, pending)) return pending;
    const choice = chooseRandomMission(player);
    setPendingDestination(player, choice);
    return choice;
  }

  /**
   * Keeps the seven-position trail and the QH mission varbits in one canonical
   * shape. Old saves only have the position, so positions 2/4/6 migrate to the
   * destinations the previous plugin fixed (Rellekka/Wizards' Tower/Castle Wars)
   * and their completion bits are filled in.
   */
  function ensureHuntState(player) {
    const rawPosition = getPosition(player);
    const position = normalizePosition(rawPosition);
    if (position !== rawPosition) setPosition(player, position);

    syncCompletedMissions(player);
    const storedDestination = getDestination(player);
    const nativeDestination = missionFromVarbits(player);
    const oldSave = !storedDestination && !nativeDestination;
    const fixed = FIXED_DESTINATION_BY_POSITION[position];
    let destination = storedDestination;

    if (fixed) {
      destination = fixed;
    } else if (!isRandomMission(destination) || isMissionComplete(player, destination)) {
      if (isRandomMission(nativeDestination) && !isMissionComplete(player, nativeDestination)) {
        destination = nativeDestination;
      } else if (oldSave) {
        destination = OLD_DESTINATION_BY_POSITION[position];
      } else {
        destination = chooseRandomMission(player);
      }
    }
    if (!MISSION_DEFINITIONS[destination]) destination = MISSION_CANIFIS;
    setDestination(player, destination);

    for (let mission = 1; mission <= MISSION_LUMBRIDGE_SWAMP; mission++) {
      const expected = mission === destination ? 1 : 0;
      if (readVarbit(player, MISSION_VARBIT[mission]) !== expected) {
        writeVarbit(player, MISSION_VARBIT[mission], expected);
      }
    }
    if (oldSave) {
      for (let prior = POSITION_CANIFIS; prior < position; prior++) {
        const mission = OLD_DESTINATION_BY_POSITION[prior];
        if (mission) markMissionComplete(player, mission);
      }
    }
    for (let mission = 1; mission <= MISSION_LUMBRIDGE_SWAMP; mission++) {
      writeVarbit(player, MISSION_VARBIT[mission] + 1, isMissionComplete(player, mission) ? 1 : 0);
    }
    return { position, destination };
  }

  /** Marks the current stop complete, sets the next mission bit and advances. */
  function advanceTrail(player, position, nextMission) {
    const current = getDestination(player);
    if (current && MISSION_VARBIT[current]) {
      writeVarbit(player, MISSION_VARBIT[current], 0);
      writeVarbit(player, MISSION_VARBIT[current] + 1, 1);
      markMissionComplete(player, current);
    }
    setDestination(player, nextMission);
    writeVarbit(player, MISSION_VARBIT[nextMission], 1);
    setPendingDestination(player, 0);
    setPosition(player, position + 1);
  }

  function completeMission(player, mission) {
    if (!MISSION_VARBIT[mission]) return;
    writeVarbit(player, MISSION_VARBIT[mission], 0);
    writeVarbit(player, MISSION_VARBIT[mission] + 1, 1);
    markMissionComplete(player, mission);
  }

  /** Re-sends the QH mission/complete varbits after the login bootstrap. */
  function sendMissionVarbits(player) {
    const stage = quest.getStage(player);
    const current = stage === STAGE_HUNT ? getDestination(player) : 0;
    const mask = completedMissions(player);
    for (let mission = 1; mission <= MISSION_LUMBRIDGE_SWAMP; mission++) {
      writeVarbit(player, MISSION_VARBIT[mission], mission === current ? 1 : 0);
      writeVarbit(player, MISSION_VARBIT[mission] + 1, (mask & (1 << (mission - 1))) !== 0 ? 1 : 0);
    }
  }

  function handleBootstrapComplete({ player }) {
    if (player) {
      sendMissionVarbits(player);
      syncInvestigation(player);
    }
  }

  function squireJoke(player) {
    return Number(player.getAttribute(SQUIRE_ATTRIBUTE)) === 1;
  }

  function setSquireJoke(player, value) {
    player.setAttribute(SQUIRE_ATTRIBUTE, value ? 1 : 0);
    writeVarbit(player, VARBIT_SQUIRE, value ? 1 : 0);
  }

  function blackKnightDead(player) {
    return Number(player.getAttribute(BLACK_KNIGHT_DEAD_ATTRIBUTE)) === 1;
  }

  function setBlackKnightDead(player, value) {
    player.setAttribute(BLACK_KNIGHT_DEAD_ATTRIBUTE, value ? 1 : 0);
    if (value) earnInvestigation(player, DAQUARIUS_ATTRIBUTE, VARBIT_DAQUARIUS, 2);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function earnInvestigation(player, attribute, varbit, value = 1) {
    const earned = Math.max(Number(player.getAttribute(attribute)) || 0, value);
    player.setAttribute(attribute, earned);
    writeVarbit(player, varbit, earned);
  }

  function syncMageInvitation(player) {
    const sender = player.getPacketSender();
    if (Number(player.getAttribute(MAGE_INVITATION_ATTRIBUTE)) === 1 && sender.getVarp(VARP_ABYSS_DISCOVERY) === 0) {
      sender.sendConfig(VARP_ABYSS_DISCOVERY, 1);
    }
  }

  function syncInvestigation(player) {
    writeVarbit(player, VARBIT_SQUIRE, squireJoke(player) ? 1 : 0);
    for (const [attribute, varbit] of INVESTIGATION_FLAGS) {
      writeVarbit(player, varbit, Number(player.getAttribute(attribute)) || 0);
    }
    syncMageInvitation(player);
  }

  function wireStage(stage, player) {
    const value = Number.isInteger(stage) ? stage : 0;
    if (value <= 0) return 0;
    if (value >= STAGE_COMPLETE) return WIRE_COMPLETE;
    if (value === STAGE_DECLINED && squireJoke(player)) return 3;
    return WIRE_STAGE_BY_STAGE[value] ?? 10;
  }

  function meetsRequirements(player) {
    // The mage's partial Abyss discovery is earned later at his actual meeting.
    return (
      (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= REQUIRED_QUEST_POINTS &&
      questComplete(player, LOST_TRIBE_QUEST_KEY) &&
      questComplete(player, RECRUITMENT_DRIVE_QUEST_KEY) &&
      questComplete(player, PRIEST_IN_PERIL_QUEST_KEY)
    );
  }

  function inZone(player, zone) {
    if (Array.isArray(zone)) return zone.some((entry) => inZone(player, entry));
    const location = player.getLocation();
    return (
      zone.levels.includes(location.getZ()) &&
      location.getX() >= zone.minX &&
      location.getX() <= zone.maxX &&
      location.getY() >= zone.minY &&
      location.getY() <= zone.maxY
    );
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  /** Gives one clue; a full inventory still lets the trail advance. */
  function grantClueItem(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    if (inventory.isFull() && inventory.getAmount(itemId) === 0) {
      player.sendMessage("Savant transfers the item, but you have no room for it.");
      return;
    }
    inventory.adds(itemId, amount);
  }

  /** The item-branch list (conditions onward) of the Canifis scan variant. */
  function clueBranchSteps() {
    if (clueTailCache) return clueTailCache;
    const data = loadTranscripts(api);
    const raw = data?.[PAGE]?.variants?.[V_SCAN_CANIFIS];
    if (!Array.isArray(raw)) return [];
    const index = raw.findIndex((step) => step.type === "condition");
    clueTailCache = index >= 0 ? raw.slice(index) : [];
    return clueTailCache;
  }

  function clearFightSpawns(player) {
    const knight = summonedKnightByPlayer.get(player);
    if (knight) {
      api.removeNpc(knight);
      summonedKnightByPlayer.delete(player);
    }
    const solus = solusByPlayer.get(player);
    if (solus) {
      api.removeNpc(solus);
      solusByPlayer.delete(player);
    }
  }

  function spawnSummonedKnight(player) {
    if (summonedKnightByPlayer.has(player)) return;
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: BLACK_KNIGHT_SUMMONED_NPC_ID,
      x: location.getX() + 1,
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) summonedKnightByPlayer.set(player, npc);
  }

  function spawnSolus(player) {
    if (solusByPlayer.has(player)) return;
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: SOLUS_DELLAGAR_FIGHT_NPC_ID,
      x: location.getX() + 1,
      y: location.getY(),
      z: location.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) solusByPlayer.set(player, npc);
  }

  // ==========================================================================
  // Conversation selectors and Talk-to name hooks
  //
  // Sir Amik, Sir Tiffy and Lord Daquarius are shared NPCs: their id-index
  // pages and the earlier-loading Black Knights' Fortress / Recruitment Drive
  // selectors can otherwise win. Their Talk-to is claimed by name while this
  // quest is active and the Wanted variant is played explicitly, so the other
  // quests' pages cannot intercept; inactive players fall through to those
  // conversations untouched.
  // ==========================================================================

  function amikVariantKey(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return null;
    if (stage === STAGE_STARTED) return V_AMIK_FIRST;
    if (stage === STAGE_DECLINED) return V_AMIK_REFUSED;
    if (stage === STAGE_CRISIS) return V_AMIK_SECOND;
    if (stage < STAGE_DEFEATED) return V_AMIK_MISSION;
    return V_AMIK_DONE;
  }

  function selectAmik(player) {
    const variant = amikVariantKey(player);
    return variant ? wantedVariant(variant) : null;
  }

  function tiffyVariantKey(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    // Before starting, Sir Tiffy's common menu also offers armour. Its jobs
    // reference enters this quest below, after checking the start requirements.
    if (stage === 0) return null;
    if (stage === STAGE_STARTED) return V_TIFFY_CONTINUE;
    if (stage === STAGE_DECLINED) {
      quest.setStage(player, STAGE_CRISIS);
      if (squireJoke(player)) {
        setSquireJoke(player, false);
        return V_TIFFY_SQUIRE_FIX;
      }
      return V_TIFFY_CRISIS;
    }
    if (stage === STAGE_CRISIS) return V_TIFFY_BEFORE_AMIK;
    if (stage === STAGE_MISSION) {
      return hasItem(player, COMMORB_ITEM_ID) ? V_TIFFY_BEFORE_USE : V_TIFFY_MISSION;
    }
    if (!hasItem(player, COMMORB_ITEM_ID)) return V_TIFFY_ORB_LOST;
    return stage >= STAGE_DEFEATED ? V_TIFFY_DONE : V_TIFFY_BEFORE_USE;
  }

  function selectTiffy(player) {
    const variant = tiffyVariantKey(player);
    return variant ? wantedVariant(variant) : null;
  }

  function daquariusVariantKey(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CONTACTED || stage >= STAGE_COMPLETE) return null;
    if (stage === STAGE_CONTACTED) {
      quest.setStage(player, STAGE_DAQUARIUS);
      return V_DAQUARIUS;
    }
    if (stage === STAGE_DAQUARIUS) {
      if (blackKnightDead(player)) {
        quest.setStage(player, STAGE_FUR);
        return V_DAQUARIUS_AFTER;
      }
      return V_DAQUARIUS_BEFORE;
    }
    return V_DAQUARIUS_LEARNED;
  }

  function selectDaquarius(player) {
    const variant = daquariusVariantKey(player);
    return variant ? wantedVariant(variant) : null;
  }

  /** Plays a claimed Talk-to; false leaves the NPC to the other plugins. */
  function playClaimedVariant(player, npcId, variant) {
    if (!variant) return false;
    if (!startTranscript(api, player, npcId, PAGE, variant)) return false;
    return undefined;
  }

  function talkToAmik(event) {
    const { player, npcId } = event;
    if (!quest.isStarted(player) || quest.isComplete(player)) return false;
    return playClaimedVariant(player, npcId, amikVariantKey(player));
  }

  function talkToTiffy(event) {
    const { player, npcId } = event;
    if (quest.isComplete(player)) return false;
    if (quest.getStage(player) === 0) return false;
    return playClaimedVariant(player, npcId, tiffyVariantKey(player));
  }

  function talkToDaquarius(event) {
    const { player, npcId } = event;
    return playClaimedVariant(player, npcId, daquariusVariantKey(player));
  }

  function talkToMage({ player, npcId }) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FUR || stage > STAGE_MAGE_DEAL) return false;
    if (npcId !== WILDERNESS_MAGE_NPC_ID) return false;
    return startTranscript(api, player, npcId, "Mage of Zamorak", "standard-dialogue-wilderness");
  }

  function mageDealMenu([menu]) {
    const deal = loadTranscripts(api)[PAGE].variants[V_MAGE_DEAL];
    return [{
      ...menu,
      options: menu.options.map((option) =>
        option.text === "Solus Dellagar." ? { ...option, steps: deal } : option
      ),
    }];
  }

  function offerVarrockMageTopics(event) {
    const { player, npc, npcId, definition, clickType } = event;
    if (npcId !== VARROCK_MAGE_NPC_ID || otherMageTopics.has(player)) return;
    if (definition.getActions()[clickType - 1] !== "Talk-to") return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FUR || stage > STAGE_MAGE_DEAL) return;
    // Temple of the Eye claims this same Talk-to, even after completion.
    event.handled = startTranscript(api, player, npcId, PAGE, V_MAGE,
      stage === STAGE_MAGE_DEAL ? mageDealMenu : undefined, npc);
  }

  function openOtherMageTopics(event) {
    const { player, npc, npcId, definition } = event;
    const location = npc.getLocation();
    event.end = true;
    otherMageTopics.add(player);
    try {
      api.core.PluginManager.emitNpcInteraction({
        player, npc, npcId, definition, npcIndex: npc.getIndex(),
        clickType: definition.getActions().indexOf("Talk-to") + 1,
        location: { x: location.getX(), y: location.getY(), z: location.getZ() },
        handled: false,
      });
    } finally {
      otherMageTopics.delete(player);
    }
  }

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (npcId === SIR_AMIK_VARZE_NPC_ID) return selectAmik(player);
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID) return selectTiffy(player);
    if (npcId === LORD_DAQUARIUS_NPC_ID) return selectDaquarius(player);
    if (npcId === VARROCK_MAGE_NPC_ID && stage >= STAGE_EAST) return wantedVariant(V_MAGE_AGAIN);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    if (!player || typeof stepId !== "string") return null;
    if (npcId === SIR_AMIK_VARZE_NPC_ID) {
      if (stepId === "ANzKYK") return false; // only routed here after asking Tiffy
      if (stepId === "w_d7ap") return wearsInitiateArmour(player);
      if (stepId === "OUdNKz") return hasHat(player);
      if (stepId === "T0nCk0") return !hasHat(player) && bankHasHat(player);
      if (stepId === "bv_oxV") return !hasHat(player) && !bankHasHat(player);
      return null;
    }
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID) {
      const components = commorbComponents(player);
      if (stepId === "Pih8D4") return player.getInventory().isFull();
      if (stepId === "vV_n5V") return !player.getInventory().isFull() && hasItem(player, COINS_ITEM_ID, 10000);
      if (stepId === "MklfQk") return components === 0;
      if (stepId === "r7GxEv") return components > 0 && components < 3;
      if (stepId === "WCsTWQ") return components === 3;
      if (stepId === "bre0MU") return components > 0 && components < 3;
      return null;
    }
    if (npcId === VARROCK_MAGE_NPC_ID) {
      const essence = essenceAmount(player);
      if (stepId === "_jNeLm") return essence === 0;
      if (stepId === "7EAVsM") return essence > 0 && !hasEssenceStack(player);
      if (stepId === "V6Gbp-") return hasEssenceStack(player);
      return null;
    }
    if (npcId === SAVANT_NPC_ID && stepId === "6G5sML") {
      return !hasHat(player) && !bankHasHat(player);
    }
    if (npcId === SOLUS_DELLAGAR_NPC_ID || npcId === SAVANT_NPC_ID) {
      // A scan's clue branch is chosen from the pending next destination; the
      // Current Assignment recap describes the destination already being hunted.
      if (FIRST_RUN_CONDITION_MISSION.has(stepId)) {
        return FIRST_RUN_CONDITION_MISSION.get(stepId) === getPendingDestination(player);
      }
      if (RECAP_CONDITION_MISSION.has(stepId)) {
        return RECAP_CONDITION_MISSION.get(stepId) === getDestination(player);
      }
    }
    return null;
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleHook({ player, npcId, hook }) {
    if (!player || npcId !== SIR_TIFFY_CASHIEN_NPC_ID) return;
    if (hook !== START_HOOK || quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) return;
    quest.setStage(player, STAGE_STARTED);
  }

  const TIFFY_NO_SPACE_TEXT = "Well we in the Temple Knights have some specific equipment for situations such as this dontchaknow, but you'll need to free up some inventory space first!";

  /** A free slot, or one the payment frees: the made orb's gem and glass, or a stack of exactly 10,000 coins. */
  function roomForCommorb(player, path) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() > 0) return true;
    if (path === "make") return true;
    return path != null && inventory.getAmount(COINS_ITEM_ID) === 10000;
  }

  function grantCommorbFromTiffy(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MISSION || quest.isComplete(player) || hasItem(player, COMMORB_ITEM_ID)) return;
    // The transcript checks for space when Buy One is picked (Pih8D4), but worn gear taken off since can fill the
    // slot; paying first would then lose the coins. Refuse with Tiffy's own full-inventory line from that check.
    if (!roomForCommorb(player, stage === STAGE_MISSION ? orbPathByPlayer.get(player) : null)) {
      player.sendMessage(TIFFY_NO_SPACE_TEXT);
      return;
    }
    if (stage === STAGE_MISSION) {
      const path = orbPathByPlayer.get(player);
      orbPathByPlayer.delete(player);
      if (path === "make") {
        player.getInventory().deleteNumber(LAW_RUNE_ITEM_ID, 1);
        player.getInventory().deleteNumber(ENCHANTED_GEM_ITEM_ID, 1);
        player.getInventory().deleteNumber(MOLTEN_GLASS_ITEM_ID, 1);
      } else if (hasItem(player, COINS_ITEM_ID, 10000)) {
        player.getInventory().deleteNumber(COINS_ITEM_ID, 10000);
      }
    }
    player.getInventory().adds(COMMORB_ITEM_ID, 1);
    if (stage === STAGE_MISSION) quest.setStage(player, STAGE_COMMORB);
  }

  function grantLostHat(player) {
    if (quest.getStage(player) !== STAGE_DEFEATED || hasHat(player) || bankHasHat(player)) return;
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot for Solus's hat.");
      return;
    }
    player.getInventory().adds(SOLUSS_HAT_ITEM_ID, 1);
  }

  function takeEssencePrice(player) {
    if (quest.getStage(player) !== STAGE_MAGE_DEAL) return;
    if (hasItem(player, PURE_ESSENCE_ITEM_ID, 20)) {
      player.getInventory().deleteNumber(PURE_ESSENCE_ITEM_ID, 20);
    } else if (hasItem(player, RUNE_ESSENCE_ITEM_ID, 20)) {
      player.getInventory().deleteNumber(RUNE_ESSENCE_ITEM_ID, 20);
    }
    quest.setStage(player, STAGE_EAST);
  }

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string") return;
    if (npcId === WILDERNESS_MAGE_NPC_ID && quest.getStage(player) >= STAGE_FUR
      && quest.getStage(player) <= STAGE_MAGE_DEAL && text.startsWith("This isn't the place to talk. Visit me in Varrock's Chaos Temple")) {
      const previous = event.after;
      event.after = () => {
        previous?.();
        player.setAttribute(MAGE_INVITATION_ATTRIBUTE, 1);
        syncMageInvitation(player);
      };
    }
    if (npcId === SAVANT_NPC_ID && (text === "From the look of the record, he would be worth talking to as well."
      || text.startsWith("Record 1 shows Lord Daquarius"))) earnInvestigation(player, INTEL_ATTRIBUTE, VARBIT_INTEL);
    if (npcId === LORD_DAQUARIUS_NPC_ID) {
      if (text.startsWith("You're going to have to find some other way to intimidate him")) earnInvestigation(player, DAQUARIUS_ATTRIBUTE, VARBIT_DAQUARIUS);
      if (text.startsWith("All I know is that he left behind some fur")
        || text.startsWith("I have already told you, I know nothing except that he left some fur")) earnInvestigation(player, EXPOSITION_ATTRIBUTE, VARBIT_EXPOSITION);
    }
    if (npcId === VARROCK_MAGE_NPC_ID && (text.startsWith("Twenty parts of rune essence is my price")
      || text === "I do indeed. My price for this information is 20 pieces of rune essence.")) earnInvestigation(player, MAGE_HINT_ATTRIBUTE, VARBIT_MAGE);
    if (
      npcId === SIR_TIFFY_CASHIEN_NPC_ID &&
      (text.includes("Here, take this Communications Orb") ||
        text.includes("Here, take another"))
    ) {
      grantCommorbFromTiffy(player);
      return;
    }
    if (npcId === SAVANT_NPC_ID && text.includes("I have sent you a duplicate")) {
      grantLostHat(player);
      return;
    }
    if (npcId === VARROCK_MAGE_NPC_ID && text.includes("I have your essences right here")) {
      takeEssencePrice(player);
    }
  }

  /**
   * The entail branch of the squireship offer is parser-split from the Yes/No
   * node (a "shows other options" marker sits between them). The central runtime
   * now skips that marker, but if the flattened queue ever ends before the node
   * this fallback re-offers it once the chatbox is clear, so stage 1 -> 2 is
   * always reachable. Picking either reply (transcript node or fallback prompt)
   * runs through applySquireReply.
   */
  function applySquireReply(player, accepted) {
    squirePromptPlayers.delete(player);
    if (quest.getStage(player) !== STAGE_STARTED) return;
    setSquireJoke(player, accepted);
    quest.setStage(player, STAGE_DECLINED);
  }

  function openSquirePrompt(player) {
    if (quest.getStage(player) !== STAGE_STARTED) return;
    api.sendMultiChatboxPrompt(
      player,
      "Select an Option",
      "Yes please!",
      () => applySquireReply(player, true),
      "No, not right now...",
      () => applySquireReply(player, false)
    );
  }

  /** Runs done once the player's chatbox is clear (no dialogue, no prompt). */
  function waitForChatbox(player, done) {
    if (player.isRegistered?.() === false) return;
    const { CountdownTask, TaskManager, MultiChatboxPrompt } = api.core;
    if (!CountdownTask || !TaskManager) {
      done();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        const prompt = MultiChatboxPrompt?.getPending?.(player) ?? null;
        if (player.getDialogueManager?.()?.isActive?.() === true || prompt !== null) {
          waitForChatbox(player, done);
          return;
        }
        done();
      })
    );
  }

  function armSquireFallback(player) {
    squirePromptPlayers.add(player);
    waitForChatbox(player, () => {
      if (!squirePromptPlayers.has(player)) return;
      squirePromptPlayers.delete(player);
      openSquirePrompt(player);
    });
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || typeof option !== "string") return;
    const text = option.toLowerCase();
    if (npcId === SIR_AMIK_VARZE_NPC_ID) {
      if (quest.getStage(player) === STAGE_STARTED) {
        if (text.includes("what does being a squire entail")) {
          armSquireFallback(player);
          return;
        }
        // The squireship offer: either reply moves on to the crisis plan (OSRS
        // loops Asgarnian ale for "Yes please!"; see the header gap).
        if (text.includes("yes please")) {
          applySquireReply(player, true);
        } else if (text.includes("no, not right now")) {
          applySquireReply(player, false);
        }
        return;
      }
      if (quest.getStage(player) === STAGE_CRISIS && text.includes("sure, i'll help you")) {
        quest.setStage(player, STAGE_MISSION);
      }
      return;
    }
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID && quest.getStage(player) === STAGE_MISSION) {
      if (text.includes("buy one")) {
        orbPathByPlayer.set(player, "buy");
        return;
      }
      if (text.includes("have one made")) {
        orbPathByPlayer.set(player, "make");
        return;
      }
      // The transcript's "Yes" branches jump around the page; grant the orb from
      // the choices themselves so the purchase does not depend on jump resolution.
      if (text.startsWith("yes")) {
        const path = orbPathByPlayer.get(player);
        if (path === "make") grantCommorbFromTiffy(player);
        else if (path === "buy") orbPathByPlayer.set(player, "buy-confirm");
        else if (path === "buy-confirm") grantCommorbFromTiffy(player);
      }
      return;
    }
    if (npcId !== VARROCK_MAGE_NPC_ID || !event.pages?.some(({ page }) => page === PAGE)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FUR || stage > STAGE_MAGE_DEAL) return;
    if (text === "solus dellagar." && stage === STAGE_FUR) quest.setStage(player, STAGE_MAGE_DEAL);
    if (text === "something else." && event.npc) openOtherMageTopics(event);
  }

  function handleClueReference(event) {
    const { player, stepId } = event;
    if (stepId !== "BO-ZlI" && stepId !== "WF7PuA") return;
    if (quest.getStage(player) !== STAGE_HUNT) return;
    const position = getPosition(player);
    if (stepId === "BO-ZlI" && position !== POSITION_CHAMPIONS_GUILD) return;
    if (stepId === "WF7PuA" && position !== POSITION_DORGESHUUN_MINE) return;
    const tail = clueBranchSteps();
    if (!tail.length) return;
    event.handled = true;
    event.steps = tail;
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (!player) return;
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID && stepId === "jx2XNl"
      && quest.getStage(player) === 0 && meetsRequirements(player)) {
      // The common post-Recruitment Drive menu's jobs reference enters the
      // existing Wanted! offer without replaying another copy of that menu.
      event.handled = true;
      event.end = true;
      startTranscript(api, player, npcId, PAGE, V_TIFFY_START, (steps) =>
        steps.find((step) => step.type === "choice")?.options
          ?.find((option) => option.text === "Do you have any jobs for me yet?")?.steps ?? [], event.npc);
      return;
    }
    if (stepId === "WqZIre") { // "The player is teleported to Camelot."
      event.handled = true;
      teleport(player, CAMELOT_TILE);
      return;
    }
    if (stepId === "uq8DV_") { // "The player wakes up outside Falador Castle."
      event.handled = true;
      teleport(player, FALADOR_CASTLE_OUTSIDE_TILE);
      return;
    }
    if (stepId === "CfRFgE") { // "A Black Knight appears."
      event.handled = true;
      spawnSummonedKnight(player);
      return;
    }
    if (stepId === "UK6zld") { // the rangers fall; the weakened Solus turns on the player
      event.handled = true;
      spawnSolus(player);
      return;
    }
    if (stepId === "BO-ZlI" || stepId === "WF7PuA") {
      handleClueReference(event);
      return;
    }
    if (npcId === SIR_AMIK_VARZE_NPC_ID && stepId === "iDVsvn") { // "Congratulations! Quest complete!"
      event.handled = true;
      if (quest.getStage(player) >= STAGE_DEFEATED && hasHat(player) && !quest.isComplete(player)) {
        player.getInventory().deleteNumber(SOLUSS_HAT_ITEM_ID, 1);
        quest.complete(player);
      }
      return;
    }
    if (FIRST_RUN_STEP_MISSION.has(stepId)) {
      if (quest.getStage(player) !== STAGE_HUNT) return;
      const position = getPosition(player);
      if (
        position !== POSITION_CANIFIS &&
        position !== POSITION_CHAMPIONS_GUILD &&
        position !== POSITION_DORGESHUUN_MINE
      ) return;
      const mission = FIRST_RUN_STEP_MISSION.get(stepId);
      if (getPendingDestination(player) !== mission) return;
      const definition = MISSION_DEFINITIONS[mission];
      grantClueItem(player, definition.clueItem, definition.clueAmount || 1);
      advanceTrail(player, position, mission);
      return;
    }
    const fixedClue = FIXED_CLUE_BY_STEP[stepId];
    if (fixedClue) {
      if (quest.getStage(player) !== STAGE_HUNT || getPosition(player) !== fixedClue.position) return;
      grantClueItem(player, fixedClue.itemId, fixedClue.amount || 1);
      advanceTrail(player, fixedClue.position, fixedClue.next);
    }
  }

  // ==========================================================================
  // CommOrb (Scan / Contact / Playback)
  // ==========================================================================

  function beginHunt(player) {
    if (quest.getStage(player) !== STAGE_EAST) return;
    quest.setStage(player, STAGE_HUNT);
    setPosition(player, POSITION_CANIFIS);
    setDestination(player, MISSION_CANIFIS);
    setPendingDestination(player, 0);
    setCompletedMissions(player, 0);
    for (let mission = 1; mission <= MISSION_LUMBRIDGE_SWAMP; mission++) {
      writeVarbit(player, MISSION_VARBIT[mission], mission === MISSION_CANIFIS ? 1 : 0);
      writeVarbit(player, MISSION_VARBIT[mission] + 1, 0);
    }
    startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_CANIFIS_CALL);
  }

  function triggerMission(player, position) {
    // Positions 1/3/5 hand over a random clue; choose (or reuse) its destination
    // before the transcript's clue conditions are answered.
    if (
      position === POSITION_CANIFIS ||
      position === POSITION_CHAMPIONS_GUILD ||
      position === POSITION_DORGESHUUN_MINE
    ) {
      ensurePendingDestination(player);
    }
    const variant = SCAN_VARIANT_BY_POSITION[position];
    if (!variant) return;
    if (position === POSITION_RUNE_ESSENCE_MINE) {
      if (solusByPlayer.has(player)) {
        player.sendMessage("Solus is right here - finish him!");
        return;
      }
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, variant);
      return;
    }
    startTranscript(api, player, SOLUS_DELLAGAR_NPC_ID, PAGE, variant);
  }

  function handleScan(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_EAST) {
      if (inZone(player, CANIFIS_ZONE)) beginHunt(player);
      else startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_FAILING);
      return;
    }
    if (stage !== STAGE_HUNT) {
      player.sendMessage("You have no Solus trail to scan for right now.");
      return;
    }
    const state = ensureHuntState(player);
    const zone = MISSION_DEFINITIONS[state.destination]?.zone;
    if (zone && inZone(player, zone)) {
      triggerMission(player, state.position);
      return;
    }
    startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_FAILING);
  }

  function handleContact(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return;
    if (stage < STAGE_MISSION) {
      player.sendMessage("You have no Temple Knight contact to reach yet.");
      return;
    }
    if (stage === STAGE_MISSION) {
      player.sendMessage("You should ask Sir Tiffy Cashien about your equipment first.");
      return;
    }
    if (stage === STAGE_COMMORB) {
      quest.setStage(player, STAGE_CONTACTED);
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_FIRST);
      return;
    }
    if (stage < STAGE_HUNT) {
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_AGAIN);
      return;
    }
    if (stage === STAGE_HUNT) {
      ensureHuntState(player);
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_HINT);
      return;
    }
    startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_HAT);
  }

  function replayRecord(player, variant) {
    startTranscript(api, player, SAVANT_NPC_ID, PAGE, variant);
  }

  function handlePlayback(player) {
    if (quest.getStage(player) < STAGE_COMMORB) {
      player.sendMessage("There is nothing recorded on the CommOrb yet.");
      return;
    }
    if (!inZone(player, WHITE_KNIGHTS_CASTLE_ZONE)) {
      startTranscript(api, player, SAVANT_NPC_ID, PAGE, V_SAVANT_PLAYBACK, () => [
        { type: "call", branch: "gqybR2" },
      ]);
      return;
    }
    api.sendMultiChatboxPrompt(
      player,
      "Select Information",
      "Dossier on Solus Dellagar",
      () => replayRecord(player, V_RECORD_DOSSIER),
      "Solus Observation Record 1",
      () => replayRecord(player, V_RECORD_1),
      "Solus Observation Record 2",
      () => replayRecord(player, V_RECORD_2),
      "Cancel",
      () => player.getPacketSender().sendInterfaceRemoval()
    );
  }

  function handleCommorbAction(event) {
    if (!event.player || event.itemId !== COMMORB_ITEM_ID) return;
    if (event.clickType === 1) {
      event.handled = true;
      handleScan(event.player);
      return;
    }
    if (event.clickType === 2) {
      event.handled = true;
      handleContact(event.player);
      return;
    }
    if (event.clickType === 4) {
      event.handled = true;
      handlePlayback(event.player);
    }
  }

  // ==========================================================================
  // World events
  // ==========================================================================

  function handleNpcDeath(event) {
    const killer = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!killer) return;
    const npc = event.npc;
    if (npc === summonedKnightByPlayer.get(killer)) {
      summonedKnightByPlayer.delete(killer);
      if (quest.getStage(killer) === STAGE_HUNT && getPosition(killer) === POSITION_SIXTH) {
        startTranscript(api, killer, SAVANT_NPC_ID, PAGE, V_SCAN_SIXTH_DONE);
      }
      return;
    }
    if (npc === solusByPlayer.get(killer)) {
      solusByPlayer.delete(killer);
      if (quest.getStage(killer) === STAGE_HUNT && getPosition(killer) === POSITION_RUNE_ESSENCE_MINE) {
        if (killer.getInventory().isFull()) {
          killer.sendMessage("You have no room for Solus's hat.");
        } else {
          killer.getInventory().adds(SOLUSS_HAT_ITEM_ID, 1);
        }
        completeMission(killer, MISSION_RUNE_ESSENCE_MINE);
        quest.setStage(killer, STAGE_DEFEATED);
        startTranscript(api, killer, SAVANT_NPC_ID, PAGE, V_SCAN_FINAL_DONE);
      }
      return;
    }
    if (TAVERLEY_BLACK_KNIGHT_IDS.has(event.npcId) && quest.getStage(killer) === STAGE_DAQUARIUS && !blackKnightDead(killer)) {
      setBlackKnightDead(killer, true);
      startTranscript(api, killer, LORD_DAQUARIUS_NPC_ID, PAGE, V_DAQUARIUS_STOP);
    }
  }

  function handleCanifisZoneEnter({ player }) {
    if (!player) return;
    if (quest.getStage(player) === STAGE_EAST) beginHunt(player);
  }

  function handleLogin({ player }) {
    if (!player) return;
    const stage = quest.getStage(player);
    if (stage === STAGE_HUNT) ensureHuntState(player);
    syncInvestigation(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    clearFightSpawns(player);
    orbPathByPlayer.delete(player);
    squirePromptPlayers.delete(player);
  }

  function handlePlayerDeath({ player }) {
    clearFightSpawns(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function huntJournal(player) {
    const position = normalizePosition(getPosition(player));
    const destination = getDestination(player);
    const currentLabel = MISSION_DEFINITIONS[destination]?.name ?? "the location Savant's clue points to";
    const randomStop = (index, future) => {
      if (position === index) return currentLabel;
      return position > index ? "a previous clue's location" : future;
    };
    const stops = [
      [POSITION_CANIFIS, "Canifis"],
      [POSITION_SECOND, randomStop(POSITION_SECOND, "the location Savant's clue points to")],
      [POSITION_CHAMPIONS_GUILD, "Champions' Guild"],
      [POSITION_FOURTH, randomStop(POSITION_FOURTH, "a location indicated by Savant's clue")],
      [POSITION_DORGESHUUN_MINE, "Dorgesh-Kaan mine"],
      [POSITION_SIXTH, randomStop(POSITION_SIXTH, "a location indicated by Savant's clue")],
      [POSITION_RUNE_ESSENCE_MINE, "Rune essence mine"],
    ];
    const lines = ["I am chasing Solus Dellagar across Gielinor:"];
    for (const [index, label] of stops) {
      const line = `- Scan for Solus at ${label}`;
      if (index < position) lines.push(`<str>${line}</str>`);
      else if (index === position) lines.push(`<col=800000>${line}</col>`);
      else lines.push(line);
    }
    return lines;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I was deputised into the White Knights and tracked down the</str>",
        "<str>murder-mage Solus Dellagar.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_DEFEATED) {
      return [
        "I have defeated Solus Dellagar and taken his hat.",
        "",
        "I should take <col=800000>Solus's hat</col> to <col=800000>Sir Amik Varze</col>",
        "in the <col=800000>White Knights' Castle</col> to become a",
        "White Knight.",
      ];
    }
    if (stage >= STAGE_HUNT) return huntJournal(player);
    if (stage >= STAGE_EAST) {
      return [
        "Solus Dellagar went east, and the fur clue points to the werewolves.",
        "",
        "I should search for him in <col=800000>Canifis</col> and use the",
        "<col=800000>Scan</col> option of my CommOrb.",
      ];
    }
    if (stage >= STAGE_MAGE_DEAL) {
      return [
        "The Mage of Zamorak in Varrock will sell me information about",
        "Solus for <col=800000>20 unnoted rune or pure essence</col>.",
      ];
    }
    if (stage >= STAGE_FUR) {
      return [
        "Lord Daquarius told me Solus left some fur behind, but it was",
        "not bear fur.",
        "",
        "Savant suggests the <col=800000>Zamorakian mage</col> in south-east",
        "<col=800000>Varrock</col> may know more.",
      ];
    }
    if (stage >= STAGE_DAQUARIUS) {
      return [
        "Lord Daquarius refuses to talk.",
        "",
        "Kill one of his <col=800000>Black Knights</col> in the",
        "<col=800000>Taverley Dungeon</col> to make him bargain.",
      ];
    }
    if (stage >= STAGE_CONTACTED) {
      return [
        "Savant sent me two observation records through the CommOrb.",
        "",
        "Investigate <col=800000>Lord Daquarius</col> in the",
        "<col=800000>Taverley Dungeon</col> and the <col=800000>Zamorakian",
        "mage</col> in south-east Varrock.",
      ];
    }
    if (stage >= STAGE_COMMORB) {
      return [
        "Sir Tiffy gave me a <col=800000>CommOrb</col>.",
        "",
        "Use its <col=800000>Contact</col> option to speak to",
        "<col=800000>Savant</col>.",
      ];
    }
    if (stage >= STAGE_MISSION) {
      return [
        "Sir Amik deputised me to hunt Solus Dellagar.",
        "",
        "I should ask <col=800000>Sir Tiffy Cashien</col> in",
        "<col=800000>Falador Park</col> for my equipment.",
      ];
    }
    if (stage >= STAGE_CRISIS) {
      return [
        "Sir Tiffy has arranged a crisis to force Sir Amik's hand.",
        "",
        "Report to <col=800000>Sir Amik Varze</col> in the",
        "<col=800000>White Knights' Castle</col>.",
      ];
    }
    if (stage >= STAGE_DECLINED) {
      return [
        "<str>I told Sir Amik Varze I have quit the Temple Knights.</str>",
        "",
        "Report back to <col=800000>Sir Tiffy Cashien</col> in",
        "<col=800000>Falador Park</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Sir Tiffy wants me to tell Sir Amik that I have quit the",
        "Temple Knights and to decline his offer of a squireship.",
        "",
        "Speak to <col=800000>Sir Amik Varze</col> in the",
        "<col=800000>White Knights' Castle</col>.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Sir Tiffy Cashien</col>",
      "in <col=800000>Falador Park</col>.",
      "",
      "I need to have completed <col=800000>The Lost Tribe</col> and",
      "<col=800000>Recruitment Drive</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.SLAYER, 5000);
  }

  api.persistAttribute(MISSION_ATTRIBUTE);
  api.persistAttribute(DESTINATION_ATTRIBUTE, 0);
  api.persistAttribute(PENDING_DESTINATION_ATTRIBUTE, 0);
  api.persistAttribute(COMPLETED_MISSIONS_ATTRIBUTE, 0);
  api.persistAttribute(SQUIRE_ATTRIBUTE);
  api.persistAttribute(BLACK_KNIGHT_DEAD_ATTRIBUTE);
  for (const [attribute] of INVESTIGATION_FLAGS) api.persistAttribute(attribute, 0);
  api.persistAttribute(MAGE_INVITATION_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "wanted",
    name: "Wanted!",
    varpId: VARP_WANTED,
    varbitId: VARBIT_WANTED_MAIN,
    varbitValue: wireStage,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.SLAYER.getIndex(), amount: 5000, label: "Slayer" }],
    otherRewards: ["Access to the White Knights' armoury (white equipment from Sir Vyvin)"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Sir Tiffy Cashien", { "Talk-to": talkToTiffy });
  api.onNpcInteraction("Sir Amik Varze", { "Talk-to": talkToAmik });
  api.onNpcInteraction("Lord Daquarius", { "Talk-to": talkToDaquarius });
  api.onBeforeNpcInteraction(offerVarrockMageTopics);
  api.onNpcInteraction("Mage of Zamorak", { "Talk-to": talkToMage });
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onItemAction(handleCommorbAction);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(CANIFIS_ZONE, handleCanifisZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
};
