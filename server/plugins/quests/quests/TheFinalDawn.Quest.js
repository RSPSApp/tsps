/**
 * The Final Dawn (members).
 *
 * The words come from the "The Final Dawn" transcript page (OSRS Wiki); this
 * plugin supplies the variant selector for the quest's NPCs, the prose-condition
 * answers, the temple infiltration (robe check, sermon, passphrase, bed/drawer
 * key + canvas, painting passage, chest + Enforcer fight), the Janus safe-house
 * trap (dog, sack, blackjack), the Teumo basement drink puzzle, the Neypotzli
 * keystone hunt and twins fight, the Crypt of Tonali assault (cultists + Ennius),
 * the sun/moon chambers and the Mokhaiotl archive that completes the quest.
 *
 * Stage varbit: 16663 "vmq4" (varp 4737 "vmq4_primary", bits 0-6). Evidence:
 * scripts/lookup-gameval.ts varbit vmq4 -> varp=4737 bits=0-6; sibling varbits
 * (16664 temple_secret_room_found, 16666 canvas_drawer, 16667
 * temple_draw_unlocked, 16672 janus_sack_given, 16675 sun_puzzle_progress,
 * 16677 moon_puzzle_progress, 16694 lift_activated, 16695-16697 final-chamber
 * inspects) all live in varp 4737/4738, so quest progress is varbit 16663.
 * The stub varp 7945 was a placeholder and is not used.
 *
 * Stages (varbit 16663) match the captured sequence in transcripts/3128.txt:
 * 1 started, 3 Queen briefing, 4 temple sermon, 5 passphrase, 6 basement
 * cutscene (bed/key/canvas), 7 canvas placed, 8 Enforcer confiscates the scroll,
 * 9 Enforcer dead, 10 scroll read, 11 Queen sends you to the safe house,
 * 14 Vibia outside, 15 window forced, 16 inside, 17 dog calmed, 18 door opened,
 * 19 upstairs, 20 purse opened, 21 purse filled, 22 blackjack ready, 23 Janus
 * captured, 24 basement key, 25 Queen reveals Cam Torum, 27 travelling,
 * 28 Katlo cutscene, 29 Attala market, 30 Teumo's house, 31 Galna drunk,
 * 32 drinks solved, 34 lever pulled, 35 eavesdropping ends, 36 report,
 * 37 Neypotzli, 38 Eyatlalli, 39 fragment, 40 locate, 41 symbol, 43 twins,
 * 44 twins dead, 45 Attala leaves, 46 crypt attacked, 47 waves, 50 waves clear,
 * 51 Ennius, 52 Ennius dead, 55 cavern, 60 both puzzles done, 61 doors,
 * 62 Metzli, 63 Metzli dead, 64 archive, 65 explore, 66 explore done,
 * 67 finale, 68 complete.
 *
 * Rewards per the OSRS Wiki: 3 Quest points, Arkan blade, 55,000 Thieving,
 * 25,000 Runecraft, 25,000 Fletching XP, an antique lamp (55,000 XP in any
 * combat skill), access to the Crypt of Tonali and the Doom of Mokhaiotl boss.
 *
 * Captured object ids used directly (3128.txt): 56534 bed, 56530-56533 drawers,
 * 56522 painting, 56537 chest, 56528 chamber entry, 56498 window, 56513 door,
 * 56470 plant, 56472 sand pot, 56487 shelf, 56490-56494 barrels, 56496
 * fireplace, 56478 passage, 56679/56682/56687 sun, 56690/56693/56697/56700/
 * 56703 moon, 56595 skeleton, 56600/56603 memorials, 56613 entrance,
 * 56642 final door. No synthetic loc copies are registered.
 *
 * Gaps / approximations:
 *  - Key captured camera/fade beats are implemented with QuestScenes at the
 *    Queen, temple, basement, safe-house, Cam Torum, Teumo, twins, crypt,
 *    Ennius, Metzli, archive and exploration hooks. Arc camera moves, some
 *    shakes and full instancing are still approximated; multi-speaker lines
 *    share the transcript NPC chathead.
 *  - The temple chest uses the shared captured four-pin lockpicking interface 811
 *    with real base-6 guesses and base-3 feedback; the sun puzzle uses Quest Helper's two altar orders and
 *    the player must tell Itzla where to stand; the moon puzzle uses the captured
 *    order-2 kindling counts (2, 6, 6); the crypt runs all six captured waves.
 *    Boss special attacks remain ordinary spawned bosses.
 *  - The safe-house window/door sequence and purse/branch steps use the captured
 *    stages, objects and a private Janus trap scene; the potato sack, knife and
 *    purse are the captured ground pickups. The Enforcer patrol and detection
 *    are simulated from capture 3128; the Tonali agility shortcuts are not.
 *  - Post-quest: Itzla's lost-blade repurchase checks the inventory (not the
 *    bank) for the Arkan blade and sells it back for 250,000 coins.
 *
 * Source: OSRS Wiki "The Final Dawn", its quick guide, transcript and journal;
 * every id via scripts/lookup-gameval.ts and the cache definitions.
 */
module.exports = function registerTheFinalDawnQuest(api) {
  const {
    ActionDialogue,
    CountdownTask,
    DialogueChainBuilder,
    Equipment,
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectManager,
    RegionManager,
    Skill,
    StatementDialogue,
    TaskManager,
  } = api.core;
  const { registerQuest, startTranscript, loadTranscripts, refreshQuestList } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const { createQuestLockpicking } = require("../QuestLockpicking");

  const PAGE = "The Final Dawn";

  // Varp 4737 "vmq4_primary"; the stage is varbit 16663 "vmq4" (bits 0-6).
  const VARP_FINAL_DAWN = 4737;
  const STAGE_VARBIT = 16663;

  // Values below are the captured varbit 16663 values in transcripts 3128.txt.
  const STAGE_STARTED = 1;
  const STAGE_TASKED = 3; // Queen sends the player back to the temple
  const STAGE_SERMON = 4; // Metzli presents Itzla
  const STAGE_BASEMENT = 5; // correct passphrase
  const STAGE_BACKROOM = 6; // basement cutscene; bed/key/drawers share this stage
  const STAGE_KEY = 6;
  const STAGE_CANVAS = 6;
  const STAGE_SCROLL = 7; // canvas placed in the painting
  const STAGE_FIGHT = 8; // Enforcer confiscates the scroll
  const STAGE_ENFORCER = 9; // Enforcer dead, scroll on the floor
  const STAGE_REPORTED = 10; // scroll picked up/read
  const STAGE_SAFEHOUSE = 11; // Queen briefs the player
  const STAGE_VIBIA = 14; // Captain Vibia outside the house
  const STAGE_WINDOW = 15; // window cover forced open
  const STAGE_HOME = 16; // climbed inside
  const STAGE_DOG = 17; // dog calmed, door code revealed
  const STAGE_HOUSE_OPEN = 18; // door opened, Vibia inside
  const STAGE_UPSTAIRS = 19;
  const STAGE_PURSE_OPEN = 20;
  const STAGE_PURSE_SAND = 21;
  const STAGE_TRAP = 22; // blackjack ready; show the sack to Vibia
  const STAGE_JANUS = 23; // Janus knocked out
  const STAGE_BASEMENT_KEY = 24;
  const STAGE_QUEEN_CAM = 25; // Queen reveals Cam Torum and the crypt
  const STAGE_TRAVEL = 26; // travel offer
  const STAGE_ARRIVED = 27; // accepted the Queen's teleport
  const STAGE_CAM_TORUM = 28; // Katlo cutscene ends
  const STAGE_MARKET = 29; // Attala in the market
  const STAGE_TEUMO = 30; // Teumo's house / Galna
  const STAGE_TEUMO_BASEMENT = 31; // Galna drunk
  const STAGE_PUZZLE = 32; // all five drinks placed
  const STAGE_LEVER = 34; // fireplace lever pulled
  const STAGE_EAVESDROP = 35; // eavesdropping cutscene ends
  const STAGE_REPORT2 = 36; // Attala/Servius report
  const STAGE_NEYPOTZLI_ENTRY = 37; // arrived at Neypotzli
  const STAGE_EYAT = 38; // Eyatlalli explains the keystone
  const STAGE_NEYPOTZLI = 39; // keystone fragment received
  const STAGE_LOCATE = 40; // entered Streambound
  const STAGE_SYMBOL = 41; // glowing symbol revealed
  const STAGE_TWINS_FIGHT = 43; // Lucius and Chimalli
  const STAGE_TWINS = 44; // twins defeated
  const STAGE_ATTALA_DONE = 45; // Attala departs
  const STAGE_CRYPT = 46; // Servius: crypt under attack
  const STAGE_WAVES = 47; // crypt defence
  const STAGE_WAVES_END = 50; // last wave cleared
  const STAGE_ENNIUS = 51; // Ennius fight
  const STAGE_ENNIUS_DEAD = 52;
  const STAGE_DESCEND = 53;
  const STAGE_CAVERN = 55; // sun and moon chambers are both available
  const STAGE_PUZZLES_DONE = 60; // both chambers finished
  const STAGE_DOORS = 61; // final doors opened
  const STAGE_METZLI = 62; // Metzli fight
  const STAGE_METZLI_DEAD = 63;
  const STAGE_ARCHIVE = 64; // post-Metzli dialogue, explore the ruins
  const STAGE_EXPLORE = 65; // Ralos/Ranul/door/skeleton inspection
  const STAGE_EXPLORE_DONE = 66;
  const STAGE_FINALE = 67;
  const STAGE_COMPLETE = 68;

  const START_HOOK = "quest:the-final-dawn:start";

  const PHRASE_WORDS = new Set(["Suffering.", "Dark.", "Light.", "Final.", "Rise.", "Dawn.", "Sacrifice.", "Eclipse."]);

  // ==========================================================================
  // Ids
  // ==========================================================================

  const SERVIUS_IDS = new Set([
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS, // 12652
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_2, // 12899
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_3, // 12900
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_4, // 12901
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_5, // 13694
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_6, // 14307
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_7, // 14374
    NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_8, // 14377
    14054, // vmq3_servius_palace (captured start NPC)
    14249, // vmq4_servius_basement
    14307, // vmq4_servius_cs
    14308, // vmq4_servius_cam_torum_market
    14309, // vmq4_servius_tal_teklan
    14310, // vmq4_servius_teumo_house
    14311, // vmq4_servius_teumo_house_downstairs
    14374, // vmq4_servius_cutscene
    14376, // vmq4_servius_palace
  ]);
  const SERVIUS_BASEMENT_ID = 14311; // vmq4_servius_teumo_house_downstairs (captured Talk-to variant)
  const SERVIUS_CRYPT_ID = 14309; // vmq4_servius_tal_teklan
  const QUEEN_IDS = new Set([
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN, // 11012
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_2, // 13695
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_3, // 14287
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_4, // 14288
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_5, // 14289
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_6, // 14290
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_7, // 14291
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_8, // 14292
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_9, // 14294
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_10, // 14296
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_11, // 14297
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_12, // 14373
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_13, // 14389
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_14, // 14396
    NpcIdentifiers.QUEEN_ZYANYI_ARKAN_15, // 14469
    14251, // vmq4_queen_basement
    14287, 14288, 14290, 14291, 14292, 14293, // vmq4_queen_*
    14373, 14389, 14396, 14469,
  ]);
  const QUEEN_TALK_ID = 14293; // vmq4_queen_palace
  const ITZLA_IDS = new Set([
    NpcIdentifiers.PRINCE_ITZLA_ARKAN, // 12650
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_2, // 12651
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_3, // 12896
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_4, // 12897
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_5, // 12898
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_6, // 13690
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_7, // 13691
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_8, // 13692
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_9, // 13693
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_17, // 14277
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_19, // 14279
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_20, // 14280
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_21, // 14281
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_22, // 14283 option variant
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_23, // 14284 moved option variant
    14282, // vmq4_itzla_crypt_puzzle_sun raw base
    NpcIdentifiers.PRINCE_ITZLA_ARKAN_24, // 14286
  ]);
  const ITZLA_QUEST_ID = NpcIdentifiers.PRINCE_ITZLA_ARKAN_19; // 14279
  const SUN_PUZZLE_ITZLA_ID = 14282; // vmq4_itzla_crypt_puzzle_sun (raw base; 14283/14284 are option variants)
  const MOON_PUZZLE_ITZLA_ID = NpcIdentifiers.PRINCE_ITZLA_ARKAN_21; // 14281 vmq4_itzla_crypt_puzzle_moon
  const SUN_PUZZLE_ITZLA_TILE = { x: 1327, y: 9446, z: 1 }; // QH VMQ4_ITZLA_CRYPT_PUZZLE_SUN
  const MOON_PUZZLE_ITZLA_TILE = { x: 1298, y: 9446, z: 1 }; // QH VMQ4_ITZLA_CRYPT_PUZZLE_MOON
  // Only E/N/NW have captured/QH Itzla stand tiles; solved orders use only these three.
  // Other menu directions fall back to the cache altar tile, never an invented stand tile.
  const SUN_ITZLA_STAND_TILES = {
    1: [1338, 9446], // east
    6: [1324, 9452], // north-west
    7: [1330, 9454], // north
  };
  const SUN_ITZLA_IDS = new Set([14282, 14283, 14284]); // raw + resolved puzzle-sun variants
  const ATTALA_IDS = new Set([
    NpcIdentifiers.ATTALA, // 12861
    NpcIdentifiers.ATTALA_2, // 13099
    NpcIdentifiers.ATTALA_3, // 14336
    NpcIdentifiers.ATTALA_4, // 14339
    13415, 14337, 14338, 14340, 16669,
  ]);
  const ATTALA_TALK_ID = 13415; // cam_torum_attala (transcript metadata)
  const ATTALA_BASEMENT_ID = 14338; // vmq4_attala_teumo_house (captured basement Talk-to variant)
  const GALNA_ID = NpcIdentifiers.GALNA; // 14342
  const VIBIA_OUTSIDE_ID = 14302; // vmq4_captain_vibia_outside_house
  const VIBIA_INSIDE_ID = 14303; // vmq4_captain_vibia_inside_house
  const VIBIA_IDS = new Set([
    NpcIdentifiers.CAPTAIN_VIBIA, // 14298
    NpcIdentifiers.CAPTAIN_VIBIA_2, // 14299
    NpcIdentifiers.CAPTAIN_VIBIA_3, // 14301
    VIBIA_OUTSIDE_ID,
    VIBIA_INSIDE_ID,
  ]);
  const EYATLALLI_IDS = new Set([
    NpcIdentifiers.EYATLALLI, // 12869
    NpcIdentifiers.EYATLALLI_2, // 12870
    NpcIdentifiers.EYATLALLI_3, // 14355
    14354, // vmq4_eyatlalli
  ]);
  const EYATLALLI_TALK_ID = 14354; // vmq4_eyatlalli
  const KATLO_IDS = new Set([
    NpcIdentifiers.HIGHLORD_KATLO, // 14346
    NpcIdentifiers.HIGHLORD_KATLO_2, // 14347
    NpcIdentifiers.HIGHLORD_KATLO_3, // 14348
    14347, 14348,
  ]);
  const KATLO_TALK_ID = 14347; // vmq4_highlord_katlo_cs
  const JANUS_TALK_ID = 14241; // vmq4_janus_house_janus
  const JANUS_UNCONSCIOUS_ID = NpcIdentifiers.FOREBEARER_JANUS_5; // 14243 [Search]
  // Capture 3128 basement interrogation cast and tiles after the trap capture.
  const JANUS_BASEMENT_ID = 14245; // vmq4_janus_basement_cs
  const QUEEN_INTERROGATION_ID = NpcIdentifiers.QUEEN_ZYANYI_ARKAN_6; // 14290 has Talk-to (14287 CS is actionless)
  const INTERROGATION_BOUNDS = [[1644, 1660, 9486, 9500, 0]];
  const INTERROGATION_PLAYER_TILE = { x: 1650, y: 9493, z: 0 };
  const INTERROGATION_CAST = [
    [14307, 1651, 9491, 1652, 9492], // Servius
    [JANUS_BASEMENT_ID, 1655, 9492, 1652, 9492], // Janus
    [QUEEN_INTERROGATION_ID, 1652, 9492, 1655, 9492], // Queen
    [14368, 1651, 9495, 1652, 9492], // Kualti scimitar
    [14367, 1649, 9490, 1652, 9492], // Kualti warhammer
    [14371, 1648, 9495, 1652, 9492], // Kualti hasta
    [NpcIdentifiers.CAPTAIN_VIBIA_2, 1652, 9490, 1652, 9492], // Vibia
  ];
  const FURIA_TALK_ID = NpcIdentifiers.FURIA_TULLUS_10; // 14330 prisoner
  const EMISSARY_TEMPLE_ID = NpcIdentifiers.EMISSARY_ASCENDED; // 13706
  // Captured temple-family NPCs; 13744 is the visible transformed Ascended.
  const EMISSARY_TEMPLE_NPC_IDS = new Set([13706, 13707, 13708, 13709, 13710, 13711, 13712, 13713, 13720, 13721, 13744]);
  const GUARD_DOG_ID = 14236; // vmq4_janus_dog [Pet]
  const GUARD_DOG_IDS = new Set([GUARD_DOG_ID, 14237]); // calm/base + alert content id
  const ENFORCER_ID = NpcIdentifiers.EMISSARY_ENFORCER_3; // 14268
  const TEMPLE_PATROL_ID = 14266; // vmq4_temple_guard_boss_patrol
  const CHIMALLI_ID = NpcIdentifiers.CHIMALLI; // 14362
  const LUCIUS_ID = NpcIdentifiers.LUCIUS; // 14363
  const ENNIUS_BOSS_ID = NpcIdentifiers.ENNIUS_TULLUS_5; // 14331
  const METZLI_BOSS_ID = NpcIdentifiers.AUGUR_METZLI_2; // 14313
  const CULTIST_MELEE_ID = 14401; // vmq4_crypt_attacker_melee_variant_1a
  const CULTIST_RANGED_ID = 14407; // vmq4_crypt_attacker_ranged_variant_1

  const EMISSARY_SCROLL_ITEM = ItemIdentifiers.EMISSARY_SCROLL; // 30949
  const CANVAS_PIECE_ITEM = ItemIdentifiers.CANVAS_PIECE; // 30950
  const DRAWER_KEY_ITEM = ItemIdentifiers.KEY_37; // 30951
  const KUHU_ESSENCE_ITEM = ItemIdentifiers.KUHU_ESSENCE; // 30962
  const KNIFE_BLADE_ITEM = ItemIdentifiers.KNIFE_BLADE; // 30965
  const ANCIENT_ROOTS_ITEM = ItemIdentifiers.ANCIENT_ROOTS; // 30963
  const ROOT_KINDLING_ITEM = ItemIdentifiers.ROOT_KINDLING; // 30964
  const KEYSTONE_FRAGMENT_ITEM = ItemIdentifiers.KEYSTONE_FRAGMENT; // 30961
  const ARKAN_BLADE_ITEM = ItemIdentifiers.ARKAN_BLADE; // 30955
  const ANTIQUE_LAMP_ITEM = ItemIdentifiers.ANTIQUE_LAMP_37; // 30960
  const SANDY_COIN_PURSE_ITEM = ItemIdentifiers.SANDY_COIN_PURSE; // 30943
  const COIN_PURSE_ITEM = ItemIdentifiers.COIN_PURSE; // 30941
  const EMPTY_COIN_PURSE_ITEM = ItemIdentifiers.EMPTY_COIN_PURSE; // 30942
  const MAKESHIFT_BLACKJACK_ITEM = ItemIdentifiers.MAKESHIFT_BLACKJACK; // 30944
  const BRANCH_ITEM = ItemIdentifiers.BRANCH_4; // 30945
  const ALANS_BONES_ITEM = ItemIdentifiers.ALANS_BONES; // 30973
  const BONES_ITEM = ItemIdentifiers.BONES; // 526
  const COOKED_MEAT_ITEM = ItemIdentifiers.COOKED_MEAT; // 2142
  const RAW_MEAT_IDS = new Set([
    ItemIdentifiers.RAW_BEEF, // 2132
    ItemIdentifiers.RAW_CHICKEN, // 2138
  ]);
  const KNIFE_ITEM = ItemIdentifiers.KNIFE; // 946
  const EMPTY_SACK_ITEM = ItemIdentifiers.EMPTY_SACK; // 5418
  const POTATO_ITEM = ItemIdentifiers.POTATO; // 1942
  const BEER_ITEM = ItemIdentifiers.BEER; // 1917
  const DWARVEN_STOUT_ITEM = ItemIdentifiers.DWARVEN_STOUT; // 1913
  const STEAMFORGE_BREW_ITEM = ItemIdentifiers.STEAMFORGE_BREW; // 29412
  const MIND_BOMB_ITEM = ItemIdentifiers.WIZARDS_MIND_BOMB; // 1907
  const BEER_GLASS_ITEM = ItemIdentifiers.BEER_GLASS; // 1919
  const COINS_ITEM = ItemIdentifiers.COINS; // 995
  const STONE_TABLET_ITEM = ItemIdentifiers.STONE_TABLET_12; // 30952
  const BLADE_PRICE = 250000;

  // Temple basement. Transcript 3128 clicks the base loc ids.
  const TEMPLE_BED_OBJECT = 56534; // vmq4_temple_bed_with_key
  const TEMPLE_DRAWERS = new Set([56530, 56531, 56532, 56533]); // closed/open north and south
  const TEMPLE_PAINTING_OBJECTS = new Set([56522, 56526]); // twilight_temple_metzli_painting
  const TEMPLE_CHEST_OBJECT = 56537; // vmq4_temple_metzli_chamber_chest_closed
  const TEMPLE_CHEST_LOCKPICK_VARBIT = 16693; // vmq4_temple_chest_lockpick_solved
  const TEMPLE_CHEST_SOLVED_ATTRIBUTE = "the-final-dawn:chest-lockpick-solved";
  const TEMPLE_PATROL_TILE = { x: 1684, y: 9706, z: 0 };
  const TEMPLE_PATROL_MAX_X = 1703;
  const TEMPLE_PATROL_KICK_TILE = { x: 1679, y: 9698, z: 0 };
  const POTATO_SACK_ITEM = 5424; // sack_potato_3
  const TEMPLE_ENTRY_OBJECTS = new Set([56528, 56539, 56540]); // chamber entry and door
  const TEMPLE_STAIRS_OBJECT = 54518; // twilight_temple_stairs
  const TEMPLE_BASEMENT_ENTRY_TILE = { x: 1672, y: 9687, z: 0 };
  // Janus safe house (captured base ids).
  const SAFEHOUSE_WINDOW_OBJECT = 56498;
  const SAFEHOUSE_DOOR_OBJECT = 56513;
  const SAFEHOUSE_DOOR_OPEN = 56514; // vmq4_janus_house_puzzle_door_open at (1648,3093) face3
  const SAFEHOUSE_ZONE = { minX: 1643, maxX: 1655, minY: 3087, maxY: 3099, levels: [0, 1, 2] };
  const STRANGE_TILE_LINKS = new Map([
    ["1299,9455,1", [1304, 9446, 2]], ["1304,9446,2", [1299, 9455, 1]],
    ["1323,9443,1", [1316, 9446, 2]], ["1316,9446,2", [1323, 9443, 1]],
  ]);
  const SAFEHOUSE_PLANT_OBJECT = 56470;
  const SAFEHOUSE_SAND_POT_OBJECT = 56472;
  const SAFEHOUSE_STAIRS_OBJECT = 52630;
  // Teumo's basement (Cam Torum, region ~1463-1471, 9560-9573).
  const TEUMO_SHELF_OBJECTS = new Set([56487, 56489]); // vmq4_teumo_basement_shelf[_op]
  const TEUMO_STAIRS_OBJECT = 56476; // vmq4_teumo_house_stairs_down
  const TEUMO_BARRELS = new Set([56490, 56491, 56492, 56493, 56494]); // barrel_1..5
  const FIREPLACE_OBJECT = 56496; // vmq4_teumo_basement_fire_out
  const HOLE_OBJECTS = new Set([56478, 56479, 56480, 56483]); // secret passage entry/opened/hole
  // Sun and moon rooms (captured base ids).
  const SUN_STATUE_OBJECT = 56679; // vmq4_sun_puzzle_statue
  const SUN_URN_OBJECT = 56682; // vmq4_sun_puzzle_urn
  const SUN_ALTAR_OBJECT = 56687; // vmq4_sun_altar
  const MOON_STATUE_OBJECT = 56690; // vmq4_moon_puzzle_statue
  const MOON_ROOTS_OBJECT = 56693; // vmq4_moon_puzzle_root
  const MOON_TOOLS_OBJECT = 56697; // vmq4_moon_puzzle_old_tools
  const MOON_PLATFORMS = new Set([56700, 56703]); // platform_1 / platform_2
  // Clockwise from the north-east altar, as Quest Helper and the capture use them.
  const SUN_ALTAR_TILES = [
    [1337, 9453], [1339, 9446], [1337, 9439], [1330, 9436],
    [1323, 9439], [1320, 9446], [1323, 9453], [1330, 9456],
  ];
  const SUN_ALTAR_NAMES = ["north-east", "east", "south-east", "south", "south-west", "west", "north-west", "north"];
  const SUN_WORDS = { 2: "Oma", 4: "Naui", 5: "Kuli", 6: "Chaki", 7: "Koma", 8: "Ueai" };
  // QH VMQ4_SUN_PUZZLE_ORDER: [Itzla altar, player altar], clockwise from NE.
  const SUN_ORDER_STEPS = {
    1: [[1, 5], [7, 3], [6, 4]],
    2: [[7, 3], [1, 5], [6, 4]],
  };
  // Capture 3128 moon order 2 accepts these three offerings.
  const MOON_KINDLING_NEEDS = [2, 6, 6];
  const DIRECTION_INDEX = { "North-east.": 0, "East.": 1, "South-east.": 2, "South.": 3, "South-west.": 4, "West.": 5, "North-west.": 6, "North.": 7 };
  // Neypotzli / Mokhaiotl (captured base ids).
  const GLOWING_SYMBOL_OBJECT = 56620; // vmq4_keystone_chamber_entrance
  const NEYPOTZLI_ENTRY_OBJECT = 51375; // pmoon_telebox
  const STREAMBOUND_ENTRY_OBJECT = 51376; // pmoon_telebox_diagonal
  const EARTHBOUND_ENTRY_OBJECT = 51378; // pmoon_telebox_cave
  const ANCIENT_PRISON_ENTRY_OBJECT = 51377; // pmoon_telebox_3x3
  const CRYPT_ENTRY_OBJECT = 56636; // vmq4_crypt_of_tonali_entry
  const CRYPT_DOOR_OBJECTS = new Set([56642, 56643, 56644]); // vmq4_crypt_door_to_moki
  const RUINS_SKELETON_OBJECT = 56595; // vmq4_moki_skeleton_tablet
  const RUINS_RALOS_OBJECT = 56600; // vmq4_moki_memorial_ralos
  const RUINS_RANUL_OBJECTS = new Set([56602, 56603, 56604]); // vmq4_moki_memorial_ranul
  const RUINS_DOOR_OBJECTS = new Set([56613, 56614, 56615]); // moki_entrance_to_dom_boss[_noop|_inspect]

  const TEMPLE_CORRIDOR_TILE = { x: 1711, y: 9704, z: 0 };
  const TEMPLE_HIDDEN_ROOM_TILE = { x: 1723, y: 9708, z: 0 };
  const TEMPLE_ENFORCER_TILE = { x: 1723, y: 9707, z: 0 };
  const PALACE_TILE = { x: 1680, y: 3176, z: 0 };
  const CAM_TORUM_TILE = { x: 1440, y: 9560, z: 1 };
  const CAM_TORUM_MARKET_TILE = { x: 1441, y: 9550, z: 1 };
  const TEUMO_HOUSE_TILE = { x: 1466, y: 9571, z: 1 };
  const TEUMO_BASEMENT_TILE = { x: 1468, y: 9572, z: 0 };
  const NEYPOTZLI_TILE = { x: 1439, y: 9600, z: 1 };
  const NEYPOTZLI_INTERIOR_TILE = { x: 1440, y: 9616, z: 1 };
  const STREAMBOUND_TILE = { x: 1481, y: 9669, z: 0 };
  const EARTHBOUND_TILE = { x: 1390, y: 9676, z: 0 };
  const ANCIENT_PRISON_TILE = { x: 1347, y: 9590, z: 0 };
  const TWINS_ARENA_TILE = { x: 1362, y: 9520, z: 0 };
  const TWINS_ARENA_LANDING = { x: 1363, y: 9518, z: 0 }; // capture 3128 after the twins cutscene
  const TONALI_CAVERN_TILE = { x: 1330, y: 9450, z: 1 };
  const METZLI_CHAMBER_TILE = { x: 1311, y: 9497, z: 1 };

  // Capture 3128 places these owner-only quest barrels over the decorative 56495 row.
  const TEUMO_BARREL_OBJECTS = [
    { id: 56490, x: 1469, y: 9571, face: 3 },
    { id: 56491, x: 1466, y: 9573, face: 1 },
    { id: 56492, x: 1464, y: 9568, face: 2 },
    { id: 56493, x: 1466, y: 9568, face: 3 },
    { id: 56494, x: 1471, y: 9567, face: 2 },
  ];
  const TEUMO_BASEMENT_ZONE = { minX: 1460, maxX: 1474, minY: 9563, maxY: 9576, levels: [0] };
  const TEUMO_FIRE_TILE = { x: 1463, y: 9571, z: 0, face: 3 };
  const TEUMO_FIRE_LIT_OBJECT = 56497;
  const TEUMO_FIRE_OUT_OBJECT = 56496;
  const DRINK_BY_BARREL = new Map([
    [56490, BEER_GLASS_ITEM],
    [56491, BEER_ITEM],
    [56492, STEAMFORGE_BREW_ITEM],
    [56493, DWARVEN_STOUT_ITEM],
    [56494, MIND_BOMB_ITEM],
  ]);
  const BARREL_INSPECT_MESSAGES = new Map([
    [56490, "The barrel seems to be empty."],
    [56491, "The barrel smells like a standard Gielinorian pub."],
    [56492, "A very small amount of steam seems to be coming out of the barrel."],
    [56493, "Parts of the barrel have been stained by some sort of black liquid."],
    [56494, "It sounds like whatever is in the barrel is bubbling a fair bit."],
  ]);
  const PLACED_DRINK_MESSAGES = new Map([
    [BEER_ITEM, "You place a glass of beer on the barrel and hear a clicking sound as you do so."],
    [DWARVEN_STOUT_ITEM, "You place a glass of dwarven stout on the barrel and hear a clicking sound as you do so."],
    [STEAMFORGE_BREW_ITEM, "You place a glass of steamforge brew on the barrel and hear a clicking sound as you do so."],
    [MIND_BOMB_ITEM, "You place a glass of wizard's mind bomb on the barrel and hear a clicking sound as you do so."],
    [BEER_GLASS_ITEM, "You place the empty beer glass on the barrel and hear a clicking sound as you do so."],
  ]);

  const BITS_ATTRIBUTE = "quest.the_final_dawn.bits";
  const SUN_ATTRIBUTE = "quest.the_final_dawn.sun";
  const MOON_ATTRIBUTE = "quest.the_final_dawn.moon";
  const FRAGMENT_ATTRIBUTE = "quest.the_final_dawn.fragment"; // legacy ladder, read-only migration
  const NEYPOTZLI_CHECKPOINT_ATTRIBUTE = "the-final-dawn:neypotzli-checkpoint";
  const NEYPOTZLI_CHECKPOINT_VARBIT = 16671; // vmq4_neypotzli_checkpoint
  const BARRELS_ATTRIBUTE = "quest.the_final_dawn.barrels";
  const SUN_ITZLA_ATTRIBUTE = "the-final-dawn:sun-itzla";
  const SUN_ORDER_ATTRIBUTE = "the-final-dawn:sun-order";
  const MOON_ORDER_ATTRIBUTE = "the-final-dawn:moon-order";
  const SUN_ORDER_VARBIT = 16676; // vmq4_sun_puzzle_order
  const MOON_ORDER_VARBIT = 16692; // vmq4_moon_puzzle_order
  // Quest Helper mirrors of captured progress. Only values produced by the
  // plugin's real actions/attributes are sent; route features it does not model
  // (drawer choice 16666, lift 16694) are left untouched.
  const BEER_GIVEN_VARBIT = 16670; // vmq4_teumo_wife_beer_given
  const TEMPLE_DRAW_UNLOCKED_VARBIT = 16667; // vmq4_temple_draw_unlocked
  const SUN_PROGRESS_VARBIT = 16675; // vmq4_sun_puzzle_progress
  const MOON_PROGRESS_VARBIT = 16677; // vmq4_moon_puzzle_progress
  const SUN_ITZLA_STATE_VARBIT = 16712; // vmq4_sun_puzzle_itzla_state
  const FINAL_RALOS_VARBIT = 16695; // vmq4_final_chamber_ralos_inspect
  const FINAL_RANUL_VARBIT = 16696; // vmq4_final_chamber_ranul_inspect
  const FINAL_TABLET_VARBIT = 16697; // vmq4_final_chamber_tablet_inspect
  const FINAL_DOOR_VARBIT = 16717; // vmq4_final_chamber_door_inspect
  const WAVE_ATTRIBUTE = "the-final-dawn:wave";
  const SAFEHOUSE_ATTRIBUTE = "quest.the_final_dawn.safehouse-talked";
  const TEUMO_INTRO_ATTRIBUTE = "quest.the_final_dawn.teumo-intro";
  const POST_ATTALA_ATTRIBUTE = "quest.the_final_dawn.post-talk";
  const BIT_DOG_CALMED = 1 << 0;
  const BIT_SACK_GIVEN = 1 << 1;
  const BIT_JANUS_CAPTURED = 1 << 2;
  const BIT_LEVER = 1 << 3;
  const BIT_TABLET_ONE = 1 << 4;
  const BIT_TABLET_TWO = 1 << 5;
  const BIT_RALOS = 1 << 6;
  const BIT_RANUL = 1 << 7;
  const BIT_BLADE_PENDING = 1 << 8;
  const BIT_HOLE_SEEN = 1 << 9;
  const BIT_DOOR = 1 << 10;
  const EXPLORE_BITS = BIT_TABLET_ONE | BIT_TABLET_TWO | BIT_RALOS | BIT_RANUL | BIT_DOOR;

  // Condition step ids (page "The Final Dawn").
  const COND_NOT_ELIGIBLE = "8Zj1PE";
  const COND_ELIGIBLE = "K8OGHQ";
  const COND_NO_ROBES = "wxJxRs";
  const COND_ROBES = "wULtBo";
  const COND_BAD_PHRASE = "IeESHx";
  const COND_GOOD_PHRASE = "frNcbs";
  const COND_NO_SPACE_BRANCH = "5hwIng";
  const COND_SPACE_BRANCH = "GZ5Gg7";
  const COND_SACK_GIVEN = "9nEa5R";
  const COND_NO_SACK = "CBvjdi";
  const COND_HAS_EMPTY_SACK = "nT7qU3";
  const COND_HAS_BRANCH = "Sd5Thx";
  const COND_HAS_BLACKJACK = "Evghag";
  const COND_PUZZLE_UNSOLVED = "QMfGQr";
  const COND_PUZZLE_UNSOLVED_SERVIUS = "07bk2p";
  const COND_PUZZLE_SOLVED_SERVIUS = "_kun3N";
  const COND_LEVER_NOT_PULLED = "LrZDqN";
  const COND_LEVER_PULLED = "y941EW";
  const COND_SUN_FIRST = "52ox-c";
  const COND_SUN_PROGRESS = "QX5yBI";
  const COND_SUN_NO_ESSENCE = "SHgONb";
  const COND_SUN_ESSENCE = "7s3Ci4";
  const COND_SUN_OK = "fdj1r5";
  const COND_SUN_FIRST_OK = "aBwKM-";
  const COND_SUN_DONE_STEP = "6LdoIs";
  const COND_SUN_FAIL = "XtiIjZ";
  const COND_ONE_CHAMBER = "PZsbxy";
  const COND_BOTH_CHAMBERS = "2UJ3XG";
  const COND_ITZLA_IN_COMBAT = "FVFktT";
  const COND_ITZLA_IDLE = "C-MNGR";
  const COND_INV_FULL_BLADE = "B8vwDI";
  const COND_INV_SPACE_BLADE = "TIcAVX";
  const COND_BLADE_LOST = "W691bV";
  const COND_NOT_ENOUGH_MONEY = "eUjzBe";
  const COND_ENOUGH_MONEY = "bH7R4B";
  const COND_BLADE_STORED = "gx8OJj";
  const COND_AKD_NOT_DONE = "VHoYmf";
  const COND_AKD_DONE = "pNnvX8";

  // Action/message step ids.
  const ACTION_MEETING_OPENS = "8udrXG";
  const ACTION_MEETING_ENDS = "EPLBr8";
  const ACTION_SERMON_OPENS = "QNa_aF";
  const ACTION_BACKROOM_ENDS = "1cZjnd";
  const ACTION_CHEST_CUTSCENE = "eBkDUz";
  const ACTION_CHEST_FIGHT = "6XJh_e";
  const ACTION_SAFEHOUSE_ENTER = "y4Y42F";
  const ACTION_SACK_GIVEN = "pghDpt";
  const ACTION_JANUS_CAPTURE = "XR0VTA";
  const ACTION_INTERROGATE_ARRIVE = "ZWqy3O";
  const ACTION_TRAVEL_CAM_TORUM = "U0zok7";
  const ACTION_CAM_TORUM_ENDS = "_IdqnD";
  const ACTION_ATTALA_DEPART = "Suwm5i";
  const ACTION_BEER_GIVEN = "FvNbYY";
  const ACTION_PULL_LEVER = "pRXkuK";
  const ACTION_HIDDEN_ENDS = "oo0Amt";
  const ACTION_REPORT2_DEPART = "AxIldc";
  const ACTION_FRAGMENT_GIVEN = "PEbJCo";
  const ACTION_TWINS_ENDS = "maos4n";
  const ACTION_TWINS_DEFEATED = "pLwSTY";
  const ACTION_ATTALA_DEPARTS = "CyoNQR";
  const ACTION_WAVES_ENDS = "QwN4C2";
  const ACTION_DESCEND = "Lv4I-P";
  const ACTION_DOORS_OPEN = "Harl6K";
  const ACTION_COMPLETE = "P0uE8w";

  /** Transient passphrase selections, keyed per player. */
  const phraseWords = new WeakMap();
  const patrolStates = new WeakMap();
  /** Per-player owner-only quest NPCs. */
  const trackedNpcs = new Map();
  const safehouseDoorNpcs = new WeakMap();
  const safehouseTrapNpcs = new WeakMap();
  const safehouseTopObjects = new WeakMap();
  const teumoBarrels = new WeakMap();
  const teumoFireplace = new WeakMap();
  const strangeTileArrivals = new WeakMap();
  const moonKindlingPrompt = new WeakMap();
  const Scenes = createQuestScenes(api);
  let quest;

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit, on = true) {
    player.setAttribute(BITS_ATTRIBUTE, on ? bits(player) | bit : bits(player) & ~bit);
  }

  function held(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function give(player, itemId, fullMessage) {
    if (freeSlots(player) <= 0) {
      if (fullMessage) player.sendMessage(fullMessage);
      return false;
    }
    player.getInventory().adds(itemId, 1);
    return true;
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function twilightOwnsCrypt(player) {
    const request = { player, key: "twilights_promise", stage: null };
    api.emitCustomEvent("quest:get-stage", request);
    return request.stage >= 8 && request.stage <= 12;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.THIEVING) >= 66 &&
      skills.getMaxLevel(Skill.RUNECRAFTING) >= 52 &&
      skills.getMaxLevel(Skill.FLETCHING) >= 52 &&
      questComplete(player, "the_heart_of_darkness") &&
      questComplete(player, "perilous_moons") &&
      questComplete(player, "twilights_promise") &&
      questComplete(player, "children_of_the_sun")
    );
  }

  function wearingEmissaryRobes(player) {
    const equipment = player.getEquipment();
    const body = equipment.get(Equipment.BODY_SLOT)?.getId?.();
    const legs = equipment.get(Equipment.LEG_SLOT)?.getId?.();
    return body === ItemIdentifiers.EMISSARY_ROBE_TOP && legs === ItemIdentifiers.EMISSARY_ROBE_BOTTOM;
  }

  function play(player, npcId, variant, select, npc = null) {
    return startTranscript(api, player, npcId, PAGE, variant, select, npc);
  }

  function correctPassphrase(player) {
    const words = phraseWords.get(player) ?? [];
    return words.length === 2 && words[0] === "Final." && words[1] === "Dawn.";
  }

  /** Plays a captured camera move and resets it unless the scene replaces it first. */
  const cameraTokens = new WeakMap();

  function cameraBeat(player, move, look, resetTicks = 40) {
    const token = (cameraTokens.get(player) ?? 0) + 1;
    cameraTokens.set(player, token);
    Scenes.camera(player, move, look);
    Scenes.later(player, resetTicks, () => {
      if (player.isRegistered?.() === false || cameraTokens.get(player) !== token) return;
      player.getPacketSender().sendCameraReset();
    });
  }

  /** The capture's short fade-out/fade-in beat around a scene change. */
  function fadePulse(player) {
    Scenes.fade(player, true);
    Scenes.later(player, 2, () => {
      Scenes.fade(player, false);
      Scenes.later(player, 2, () => Scenes.closeFade(player));
    });
  }

  /** Fades to black, runs `action`, then fades back in on the captured 2-tick beat. */
  function fadedStep(player, action, holdTicks = 2) {
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    Scenes.later(player, holdTicks, () => {
      action();
      Scenes.fade(player, false);
      Scenes.later(player, 2, () => {
        Scenes.closeFade(player);
        Scenes.controls(player, false);
      });
    });
  }

  /** Runs `action` once the player's chatbox is clear, so a closing transcript cannot wipe it. */
  function whenIdle(player, action) {
    if (!TaskManager || !CountdownTask) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 2, () => {
        if (player.isRegistered?.() === false) return;
        const chatting =
          player.getDialogueManager?.()?.isActive?.() === true ||
          api.core.MultiChatboxPrompt?.getPending?.(player) != null;
        if (chatting) {
          whenIdle(player, action);
          return;
        }
        action();
      })
    );
  }

  function isEmissaryTempleNpc(npcId) {
    return EMISSARY_TEMPLE_NPC_IDS.has(npcId);
  }

  function npcIdOf(event) {
    return event.npcId ?? event.npc?.getId?.();
  }

  // ==========================================================================
  // Tracked owner-only NPC spawns
  // ==========================================================================

  function tracked(player, key) {
    return trackedNpcs.get(player)?.get(key) ?? null;
  }

  function syncTracked(player, key, definition) {
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    const existing = tracked.get(key);
    if (!definition) {
      if (existing?.isRegistered?.()) api.removeNpc(existing);
      if (existing) tracked.delete(key);
      return null;
    }
    if (existing?.isRegistered?.() && existing.getId?.() === definition.id) {
      const at = existing.getLocation?.();
      if (at && (at.getX() !== definition.x || at.getY() !== definition.y || at.getZ() !== definition.z)) {
        existing.moveTo?.(new Location(definition.x, definition.y, definition.z));
      }
      return existing;
    }
    if (existing?.isRegistered?.()) api.removeNpc(existing);
    const npc = api.spawnNpc({ ...definition, owner: player, ownerOnly: true });
    if (npc) tracked.set(key, npc);
    return npc;
  }

  const SAFEHOUSE_LOOT = [
    { itemId: POTATO_SACK_ITEM, x: 1645, y: 3091, z: 0 },
    { itemId: KNIFE_ITEM, x: 1646, y: 3095, z: 0 },
  ];

  /** Captured ground loot inside the Janus house; the purse appears upstairs. */
  function ensureSafehouseLoot(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_HOME || stage > STAGE_JANUS) return;
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation) return;
    const area = player.getPrivateArea?.() ?? null;
    const loot = stage >= STAGE_UPSTAIRS && stage <= STAGE_PURSE_SAND
      ? [...SAFEHOUSE_LOOT, { itemId: COIN_PURSE_ITEM, x: 1649, y: 3096, z: 1 }]
      : SAFEHOUSE_LOOT;
    for (const entry of loot) {
      if (entry.itemId === KNIFE_ITEM && held(player, KNIFE_ITEM)) continue;
      if (entry.itemId === POTATO_SACK_ITEM &&
        (held(player, POTATO_SACK_ITEM) || held(player, EMPTY_SACK_ITEM))) continue;
      if (entry.itemId === COIN_PURSE_ITEM &&
        (held(player, COIN_PURSE_ITEM) || held(player, EMPTY_COIN_PURSE_ITEM) || held(player, SANDY_COIN_PURSE_ITEM))) continue;
      const tile = new Location(entry.x, entry.y, entry.z);
      if (manager.getGroundItem?.(player.getUsername(), entry.itemId, tile, area)) continue;
      manager.registerLocation(player, new Item(entry.itemId, 1), tile);
    }
  }

  /** Owner-only temple patrol from capture 3128; stops at the Enforcer fight. */
  function startTemplePatrol(player, npc) {
    if (patrolStates.has(player)) return;
    const state = { npc, x: TEMPLE_PATROL_TILE.x, direction: 1, key: {} };
    patrolStates.set(player, state);
    const step = () => {
      if (patrolStates.get(player) !== state || npc.isRegistered?.() === false) return;
      state.x += state.direction;
      if (state.x > TEMPLE_PATROL_MAX_X || state.x < TEMPLE_PATROL_TILE.x) {
        state.direction *= -1;
        state.x += state.direction * 2;
      }
      npc.moveTo?.(new Location(state.x, TEMPLE_PATROL_TILE.y, TEMPLE_PATROL_TILE.z));
      const location = player.getLocation();
      const guard = npc.getLocation?.();
      if (
        guard &&
        location.getZ() === TEMPLE_PATROL_TILE.z &&
        Math.abs(location.getX() - guard.getX()) <= 2 &&
        Math.abs(location.getY() - guard.getY()) <= 1
      ) {
        Lockpicking.cancel(player);
        player.getPacketSender().sendInterfaceRemoval();
        npc.forceChat?.("This area is off limits to you!");
        player.sendMessage("A guard spots you in a restricted area and kicks you out.");
        player.moveTo(new Location(TEMPLE_PATROL_KICK_TILE.x, TEMPLE_PATROL_KICK_TILE.y, TEMPLE_PATROL_KICK_TILE.z));
      }
      TaskManager.submit(new CountdownTask(state.key, 1, step));
    };
    TaskManager.submit(new CountdownTask(state.key, 1, step));
  }

  function stopTemplePatrol(player) {
    const state = patrolStates.get(player);
    if (!state) return;
    TaskManager.cancelTasks(state.key);
    patrolStates.delete(player);
  }

  function ensureQuestNpcs(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return;
    const templePhase = stage >= STAGE_TASKED && stage < STAGE_REPORTED;
    syncTracked(player, "emissary-temple", templePhase
      ? { id: EMISSARY_TEMPLE_ID, x: 1676, y: 3244, z: 0, wanderRadius: 0 }
      : null);
    const patrolActive = stage >= STAGE_SERMON && stage < STAGE_FIGHT;
    const patrol = syncTracked(player, "temple-patrol", patrolActive
      ? { id: TEMPLE_PATROL_ID, ...TEMPLE_PATROL_TILE, wanderRadius: 0 }
      : null);
    if (patrolActive && patrol) startTemplePatrol(player, patrol);
    else stopTemplePatrol(player);
    const homeInvasion = stage >= STAGE_REPORTED && stage <= STAGE_JANUS;
    syncTracked(player, "vibia-house", homeInvasion
      ? (stage >= STAGE_HOUSE_OPEN
        ? { id: VIBIA_INSIDE_ID, x: 1651, y: 3093, z: 0, wanderRadius: 0 }
        : { id: VIBIA_OUTSIDE_ID, x: 1653, y: 3087, z: 0, wanderRadius: 0 })
      : null);
    syncTracked(player, "guard-dog", homeInvasion
      ? { id: GUARD_DOG_ID, x: stage === STAGE_JANUS ? 1650 : 1651, y: 3094, z: 0, wanderRadius: 0 }
      : null);
    syncTracked(player, "janus-captured", stage === STAGE_JANUS && hasBit(player, BIT_JANUS_CAPTURED)
      ? { id: JANUS_UNCONSCIOUS_ID, x: 1647, y: 3093, z: 0, wanderRadius: 0 }
      : null);
    syncTracked(player, "galna", stage >= STAGE_MARKET && stage < STAGE_NEYPOTZLI
      ? { id: GALNA_ID, x: TEUMO_HOUSE_TILE.x, y: TEUMO_HOUSE_TILE.y, z: TEUMO_HOUSE_TILE.z, wanderRadius: 0 }
      : null);
    const inTeumoBasement = stage >= STAGE_TEUMO_BASEMENT && stage < STAGE_NEYPOTZLI;
    syncTracked(player, "attala-basement", inTeumoBasement
      ? { id: ATTALA_BASEMENT_ID, x: 1466, y: 9571, z: 0, wanderRadius: 0 }
      : null);
    syncTracked(player, "servius-basement", inTeumoBasement
      ? { id: SERVIUS_BASEMENT_ID, x: 1467, y: 9570, z: 0, wanderRadius: 0 }
      : null);
    syncTracked(player, "eyatlalli", stage >= STAGE_NEYPOTZLI_ENTRY && stage < STAGE_LOCATE
      ? { id: EYATLALLI_TALK_ID, x: 1439, y: 9627, z: 1, wanderRadius: 0 }
      : null);
    if (stage === STAGE_TWINS_FIGHT) {
      spawnTwins(player);
    } else {
      syncTracked(player, "chimalli", null);
      syncTracked(player, "lucius", null);
    }
    // A saved stage-62 fight resumes with the captured Metzli actor; spawnMetzli is idempotent.
    if (stage === STAGE_METZLI) spawnMetzli(player);
    syncTracked(player, "servius-teklan", stage === STAGE_TWINS || stage === STAGE_ATTALA_DONE || stage === STAGE_CRYPT
      ? { id: SERVIUS_CRYPT_ID, x: 1236, y: 3105, z: 0, wanderRadius: 0 }
      : null);
    const itzlaTile = itzlaTileForStage(stage);
    const sunPuzzle = stage === STAGE_CAVERN;
    const sunStand = sunItzlaStandTile(player);
    syncTracked(player, "itzla", itzlaTile && !sunPuzzle
      ? { id: ITZLA_QUEST_ID, x: itzlaTile.x, y: itzlaTile.y, z: itzlaTile.z, wanderRadius: 0 }
      : null);
    syncTracked(player, "itzla-sun", sunPuzzle
      ? { id: SUN_PUZZLE_ITZLA_ID, x: sunStand[0], y: sunStand[1], z: SUN_PUZZLE_ITZLA_TILE.z, wanderRadius: 0 }
      : null);
    syncTracked(player, "itzla-moon", sunPuzzle
      ? { id: MOON_PUZZLE_ITZLA_ID, x: MOON_PUZZLE_ITZLA_TILE.x, y: MOON_PUZZLE_ITZLA_TILE.y, z: MOON_PUZZLE_ITZLA_TILE.z, wanderRadius: 0 }
      : null);
    ensureTeumoBarrels(player);
    ensureSafehouseLoot(player);
  }

  function itzlaTileForStage(stage) {
    if (stage >= STAGE_ENNIUS && stage <= STAGE_DESCEND) return { x: 1312, y: 9493, z: 1 };
    if (stage === STAGE_CAVERN) return { x: 1327, y: 9446, z: 1 };
    if (stage >= STAGE_PUZZLES_DONE && stage <= STAGE_DOORS) return { x: 1311, y: 9464, z: 1 };
    if (stage >= STAGE_METZLI && stage <= STAGE_ARCHIVE) return { x: 1311, y: 9497, z: 1 };
    if (stage >= STAGE_EXPLORE) return { x: 1311, y: 9533, z: 1 };
    return null;
  }

  /** Mirror only the progress the plugin actually holds into Quest Helper's subvarbits. */
  function syncQuestVarbits(player) {
    const stage = quest.getStage(player);
    const flags = bits(player);
    const sun = Math.max(0, Math.min(3, Number(player.getAttribute(SUN_ATTRIBUTE)) || 0));
    const moon = Math.max(0, Math.min(3, Number(player.getAttribute(MOON_ATTRIBUTE)) || 0));
    const sender = player.getPacketSender();
    sender.sendVarbit(BEER_GIVEN_VARBIT, stage >= STAGE_TEUMO_BASEMENT ? 1 : 0);
    // The key actually opening the drawers is only represented by its result:
    // the canvas was taken or has already been used on the painting.
    sender.sendVarbit(TEMPLE_DRAW_UNLOCKED_VARBIT,
      stage >= STAGE_BACKROOM && (held(player, CANVAS_PIECE_ITEM) || stage >= STAGE_SCROLL) ? 1 : 0);
    sender.sendVarbit(SUN_PROGRESS_VARBIT, sun);
    sender.sendVarbit(SUN_ITZLA_STATE_VARBIT, sun < 3 && ensureSunItzla(player) !== -1 ? 1 : 0);
    sender.sendVarbit(MOON_PROGRESS_VARBIT, moon);
    sender.sendVarbit(FINAL_RALOS_VARBIT, flags & BIT_RALOS ? 1 : 0);
    sender.sendVarbit(FINAL_RANUL_VARBIT, flags & BIT_RANUL ? 1 : 0);
    sender.sendVarbit(FINAL_TABLET_VARBIT, flags & BIT_TABLET_ONE ? 1 : 0);
    sender.sendVarbit(FINAL_DOOR_VARBIT, flags & BIT_DOOR ? 1 : 0);
  }

  function handleBootstrap({ player }) {
    syncQuestVarbits(player);
  }

  function setStage(player, stage) {
    quest.setStage(player, stage);
    if (stage === STAGE_CAVERN) ensureSunItzla(player);
    ensureQuestNpcs(player);
    syncQuestVarbits(player);
  }

  // ==========================================================================
  // Quest scenery the cache maps only in its non-interactive variant
  // ==========================================================================

  // ==========================================================================
  // Talk-to handlers
  // ==========================================================================

  function talkServius(event) {
    const npcId = npcIdOf(event);
    if (!SERVIUS_IDS.has(npcId)) return false;
    const { player } = event;
    // Yield only during Twilight's crypt conversation, preserving later quests'
    // post-quest dialogue when the earlier quest is already complete.
    if (npcId === NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_2 && twilightOwnsCrypt(player)) return false;
    if (quest.isComplete(player)) {
      play(player, npcId, "post-quest-dialogue-talking-to-servius");
      return true;
    }
    if (!questActive(player)) {
      // Cache 14054 transforms to 13694/14377 on varbit 16668; all are the
      // same palace Servius and must be able to offer the start.
      if (!SERVIUS_IDS.has(npcId)) return false;
      // The Heart of Darkness owns Servius for its own stage-74 hand-in; only
      // offer the next quest's start once that quest is actually complete.
      if (!questComplete(player, "the_heart_of_darkness")) return false;
      play(player, npcId, "infiltration-ii-talking-to-servius");
      return true;
    }
    const stage = quest.getStage(player);
    if (stage === STAGE_STARTED) {
      play(player, npcId, "infiltration-ii-talking-to-servius-talking-to-servius-again-before-going-to-meet-with-queen-zyanyi");
      return true;
    }
    if (stage < STAGE_REPORTED) {
      play(player, npcId, "infiltration-ii-talking-to-servius-talking-to-servius-again-after-meeting-with-queen-zyanyi");
      return true;
    }
    if (stage >= STAGE_REPORTED && stage <= STAGE_JANUS) {
      play(player, npcId, "home-invasion-interrogating-janus-talking-to-servius-before-leaving-for-cam-torum");
      return true;
    }
    if (stage === STAGE_MARKET) {
      play(player, npcId, "dwarven-traitor-talking-to-servius-or-attala");
      return true;
    }
    if (stage === STAGE_TEUMO_BASEMENT || stage === STAGE_PUZZLE) {
      play(player, npcId, "dwarven-traitor-talking-to-servius-in-the-basement");
      return true;
    }
    if (stage >= STAGE_LEVER && stage <= STAGE_EAVESDROP) {
      play(player, npcId, "dwarven-traitor-talking-to-servius-or-attala-2");
      return true;
    }
    if (stage === STAGE_TWINS || stage === STAGE_ATTALA_DONE) {
      play(player, npcId, "crypt-assault-talking-to-servius");
      setStage(player, STAGE_CRYPT);
      return true;
    }
    if (stage === STAGE_CRYPT) {
      play(player, npcId, "crypt-assault-talking-to-servius-talking-to-servius-again");
      return true;
    }
    return false;
  }

  function talkQueen(event) {
    const npcId = npcIdOf(event);
    if (!QUEEN_IDS.has(npcId)) return false;
    const { player } = event;
    if (quest.isComplete(player)) {
      play(player, npcId, "post-quest-dialogue-talking-to-queen-zyanyi");
      return true;
    }
    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED && stage < STAGE_REPORTED) {
      play(player, npcId, "infiltration-ii-talking-to-servius-talking-to-queen-zyanyi-again");
      return true;
    }
    if (stage === STAGE_REPORTED) {
      play(player, npcId, "home-invasion-talking-to-queen-zyanyi-or-servius");
      setStage(player, STAGE_SAFEHOUSE);
      return true;
    }
    if (stage >= STAGE_SAFEHOUSE && stage < STAGE_QUEEN_CAM) {
      play(player, npcId, "home-invasion-talking-to-queen-zyanyi-or-servius-talking-to-queen-zyanyi-again");
      return true;
    }
    if (stage >= STAGE_QUEEN_CAM && stage < STAGE_CAM_TORUM) {
      play(player, npcId, "home-invasion-interrogating-janus-talking-to-the-queen-again-after-refusing-her-offer-to-travel-to-cam-torum");
      return true;
    }
    return false;
  }

  function talkItzla(event) {
    const npcId = npcIdOf(event);
    if (!ITZLA_IDS.has(npcId)) return false;
    const { player } = event;
    if (quest.isComplete(player)) {
      play(player, npcId, "post-quest-dialogue-talking-to-prince-itzla");
      return true;
    }
    const stage = quest.getStage(player);
    if (stage === STAGE_CAVERN && inSunRoom(player)) {
      play(player, npcId, "crypt-assault-sun-chamber-talking-to-prince-itzla");
      return true;
    }
    if (stage >= STAGE_ENNIUS && stage <= STAGE_DESCEND) {
      play(player, npcId, "crypt-assault-upon-entering-the-southern-area-of-the-tonali-cavern-after-the-cutscene");
      return true;
    }
    if (stage === STAGE_CAVERN || stage === STAGE_PUZZLES_DONE) {
      play(player, npcId, "crypt-assault-talking-to-prince-itzla-arkan-in-the-area-between-the-sun-and-moon-chambers");
      return true;
    }
    if (stage === STAGE_METZLI_DEAD) {
      play(player, npcId, "crypt-assault-upon-defeating-metzli-talking-to-itzla-again");
      return true;
    }
    if (stage === STAGE_ARCHIVE) {
      cameraBeat(player, [1311, 9563, 540], [1311, 9576, 539], 30);
      Scenes.later(player, 10, () => cameraBeat(player, [1318, 9570, 450], [1302, 9572, 449], 30));
      play(player, npcId, "crypt-assault-entering-the-archive");
      return true;
    }
    if (stage >= STAGE_EXPLORE_DONE && hasBit(player, BIT_BLADE_PENDING)) {
      play(player, npcId, "crypt-assault-upon-fully-exploring-the-area-talking-again-if-inventory-was-full");
      return true;
    }
    if (stage === STAGE_EXPLORE_DONE || stage === STAGE_FINALE) {
      play(player, npcId, "crypt-assault-upon-fully-exploring-the-area");
      return true;
    }
    return false;
  }

  function talkAttala(event) {
    const npcId = npcIdOf(event);
    if (!ATTALA_IDS.has(npcId)) return false;
    const { player } = event;
    if (quest.isComplete(player)) {
      const talked = player.getAttribute(POST_ATTALA_ATTRIBUTE) === true;
      play(player, npcId, talked
        ? "post-quest-dialogue-talking-to-attala-subsequent-post-quest"
        : "post-quest-dialogue-talking-to-attala-initial-post-quest");
      player.setAttribute(POST_ATTALA_ATTRIBUTE, true);
      return true;
    }
    const stage = quest.getStage(player);
    if (stage === STAGE_CAM_TORUM || stage === STAGE_MARKET) {
      play(player, npcId, "dwarven-traitor-talking-to-servius-or-attala");
      return true;
    }
    if (stage === STAGE_TEUMO) {
      play(player, npcId, "dwarven-traitor-talking-to-attala-or-galna");
      return true;
    }
    if (stage === STAGE_TEUMO_BASEMENT) {
      play(player, npcId, "dwarven-traitor-talking-to-attala-in-the-basement");
      return true;
    }
    if (stage >= STAGE_LEVER && stage <= STAGE_EAVESDROP) {
      play(player, npcId, "dwarven-traitor-talking-to-servius-or-attala-2");
      return true;
    }
    return false;
  }

  function talkGalna(event) {
    if (npcIdOf(event) !== GALNA_ID) return false;
    const { player } = event;
    if (quest.getStage(player) === STAGE_MARKET) {
      play(player, GALNA_ID, "dwarven-traitor-entering-teumo-s-home");
      setStage(player, STAGE_TEUMO);
      player.setAttribute(TEUMO_INTRO_ATTRIBUTE, true);
      if (!held(player, BEER_ITEM)) player.getInventory().adds(BEER_ITEM, 1);
      return true;
    }
    if (quest.getStage(player) !== STAGE_TEUMO) return false;
    if (player.getAttribute(TEUMO_INTRO_ATTRIBUTE) === true) {
      play(player, GALNA_ID, "dwarven-traitor-talking-to-attala-or-galna");
      return true;
    }
    play(player, GALNA_ID, "dwarven-traitor-entering-teumo-s-home");
    player.setAttribute(TEUMO_INTRO_ATTRIBUTE, true);
    if (!held(player, BEER_ITEM)) player.getInventory().adds(BEER_ITEM, 1);
    return true;
  }

  function inTeumoBasement(player) {
    const location = player.getLocation();
    return location && location.getZ() === 0
      && location.getX() >= TEUMO_BASEMENT_ZONE.minX && location.getX() <= TEUMO_BASEMENT_ZONE.maxX
      && location.getY() >= TEUMO_BASEMENT_ZONE.minY && location.getY() <= TEUMO_BASEMENT_ZONE.maxY;
  }

  function clearTeumoBarrels(player) {
    for (const object of teumoBarrels.get(player) ?? []) ObjectManager.deregister(object, true);
    teumoBarrels.delete(player);
    const fire = teumoFireplace.get(player);
    if (fire) ObjectManager.deregister(fire, true);
    teumoFireplace.delete(player);
  }

  /** Owner-only Teumo puzzle barrels and the captured lit/out fireplace state. */
  function ensureTeumoBarrels(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_TEUMO_BASEMENT || stage > STAGE_PUZZLE || !inTeumoBasement(player)) {
      clearTeumoBarrels(player);
      return;
    }
    if (!teumoBarrels.has(player)) {
      const objects = [];
      for (const entry of TEUMO_BARREL_OBJECTS) {
        const object = new GameObject(entry.id, new Location(entry.x, entry.y, 0), 10, entry.face, null).setOwner(player);
        ObjectManager.register(object, true);
        objects.push(object);
      }
      teumoBarrels.set(player, objects);
    }
    const fireId = stage >= STAGE_PUZZLE ? TEUMO_FIRE_OUT_OBJECT : TEUMO_FIRE_LIT_OBJECT;
    const current = teumoFireplace.get(player);
    if (current?.getId?.() !== fireId) {
      if (current) ObjectManager.deregister(current, true);
      const fire = new GameObject(fireId, new Location(TEUMO_FIRE_TILE.x, TEUMO_FIRE_TILE.y, TEUMO_FIRE_TILE.z),
        10, TEUMO_FIRE_TILE.face, null).setOwner(player);
      ObjectManager.register(fire, true);
      teumoFireplace.set(player, fire);
    }
  }

  function clearSafehouseTopObjects(player) {
    const existing = safehouseTopObjects.get(player);
    if (!existing) return;
    ObjectManager.deregister(existing.plant, true);
    ObjectManager.deregister(existing.pot, true);
    safehouseTopObjects.delete(player);
  }

  function inSafehouseZone(player) {
    const l = player.getLocation();
    return l && SAFEHOUSE_ZONE.levels.includes(l.getZ())
      && l.getX() >= SAFEHOUSE_ZONE.minX && l.getX() <= SAFEHOUSE_ZONE.maxX
      && l.getY() >= SAFEHOUSE_ZONE.minY && l.getY() <= SAFEHOUSE_ZONE.maxY;
  }

  /** Captured dynamic top-floor blackjack objects; owner-only, no global map mutation. */
  function ensureSafehouseTopObjects(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_PURSE_OPEN || stage > STAGE_JANUS || !inSafehouseZone(player)) {
      clearSafehouseTopObjects(player);
      return;
    }
    if (safehouseTopObjects.has(player)) return;
    const area = player.getPrivateArea() ?? null;
    const plant = new GameObject(SAFEHOUSE_PLANT_OBJECT, new Location(1650, 3095, 2), 10, 1, area).setOwner(player);
    const pot = new GameObject(SAFEHOUSE_SAND_POT_OBJECT, new Location(1645, 3098, 2), 10, 0, area).setOwner(player);
    ObjectManager.register(plant, true);
    ObjectManager.register(pot, true);
    safehouseTopObjects.set(player, { plant, pot });
  }

  /** Owner-only open-door state at the captured west tile; global map door stays untouched. */
  function ensureSafehouseDoorState(player) {
    const stage = quest.getStage(player);
    const doorOpen = stage >= STAGE_HOUSE_OPEN && (stage < STAGE_TRAP || stage === STAGE_JANUS);
    if (!doorOpen || !inSafehouseZone(player)) return;
    const current = Scenes.get(player);
    if (current?.name === "safehouse-door") return;
    const scene = Scenes.open(player, "safehouse-door", [
      [SAFEHOUSE_ZONE.minX, SAFEHOUSE_ZONE.maxX, SAFEHOUSE_ZONE.minY, SAFEHOUSE_ZONE.maxY, 0],
      [SAFEHOUSE_ZONE.minX, SAFEHOUSE_ZONE.maxX, SAFEHOUSE_ZONE.minY, SAFEHOUSE_ZONE.maxY, 1],
      [SAFEHOUSE_ZONE.minX, SAFEHOUSE_ZONE.maxX, SAFEHOUSE_ZONE.minY, SAFEHOUSE_ZONE.maxY, 2],
    ], { beforeEnd: (owner, ending) => {
      for (const npc of safehouseDoorNpcs.get(owner) ?? []) ending.area?.leave(npc, false);
      safehouseDoorNpcs.delete(owner);
      clearSafehouseTopObjects(owner);
    } });
    // Hide the shared closed door for this owner and remove only its private collision copy.
    const closed = new GameObject(SAFEHOUSE_DOOR_OBJECT, new Location(1649, 3093, 0), 0, 0, scene.area);
    ObjectManager.deregister(closed, false); // Replay this private removal after scene rebuilds.
    RegionManager.removeObjectClipping(closed);
    player.getPacketSender().sendObjectRemoval(closed);
    Scenes.loc(scene, { id: SAFEHOUSE_DOOR_OPEN, x: 1648, y: 3093, z: 0, type: 0, face: 3 });
    const attached = [];
    for (const key of ["vibia-house", "guard-dog", "janus-captured"]) {
      const npc = tracked(player, key);
      if (npc) { scene.area.enter(npc); attached.push(npc); }
    }
    safehouseDoorNpcs.set(player, attached);
  }

  function handleStrangeTileStep({ player }) {
    const stage = quest.getStage(player);
    // Sun and moon are both available from stage55; their mandatory Strange-Tile links
    // are what let the player reach the moon room and earn stage60.
    if (stage < STAGE_CAVERN || stage > STAGE_DOORS) return;
    const location = player.getLocation();
    const key = `${location.getX()},${location.getY()},${location.getZ()}`;
    const landing = strangeTileArrivals.get(player);
    if (landing === key) {
      strangeTileArrivals.delete(player);
      return;
    }
    const destination = STRANGE_TILE_LINKS.get(key);
    if (!destination) return;
    const [x, y, z] = destination;
    strangeTileArrivals.set(player, `${x},${y},${z}`);
    player.getMovementQueue().reset();
    player.moveTo(new Location(x, y, z));
  }

  function handleTeumoBasementEnter({ player }) {
    ensureTeumoBarrels(player);
  }

  function handleTeumoBasementExit({ player }) {
    clearTeumoBarrels(player);
  }

  function handleSafehouseZoneEnter({ player }) {
    const stage = quest.getStage(player);
    if (stage < STAGE_HOUSE_OPEN || (stage >= STAGE_TRAP && stage !== STAGE_JANUS)) return;
    ensureQuestNpcs(player);
    ensureSafehouseDoorState(player);
    ensureSafehouseTopObjects(player);
  }

  function openSafehouseScene(player) {
    if (Scenes.get(player)?.name === "safehouse-trap") return;
    clearSafehouseTopObjects(player);
    if (Scenes.get(player)) Scenes.end(player, false);
    const scene = Scenes.open(player, "safehouse-trap", [[1643, 1652, 3091, 3106, 0]], { beforeEnd: (owner, ending) => {
      for (const npc of safehouseTrapNpcs.get(owner) ?? []) ending.area?.leave(npc, false);
      safehouseTrapNpcs.delete(owner);
    } });
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    // The capture's trap instance contains Vibia and the dog as well as Janus.
    // Re-enter the tracked NPCs after the door scene detached them.
    const attached = [];
    for (const key of ["vibia-house", "guard-dog"]) {
      const npc = tracked(player, key);
      if (npc) { scene.area.enter(npc); attached.push(npc); }
    }
    safehouseTrapNpcs.set(player, attached);
    Scenes.later(scene, 2, () => {
      Scenes.actor(scene, 14241, [1648, 3104, 0], [1648, 3093]);
      Scenes.camera(player, [1648, 3104, 500], [1648, 3103, 499]);
      Scenes.fade(player, false);
    });
  }

  const TRAP_CONDITION_STEPS = new Set([COND_HAS_EMPTY_SACK, COND_HAS_BRANCH, COND_HAS_BLACKJACK]);

  /** The captured repeat request when the trap still lacks a way to restrain Janus. */
  function trapRecoverySteps() {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.["home-invasion-in-janus-safehouse-talking-to-vibia-again"];
    return Array.isArray(steps) && steps[0]?.type === "line" ? [steps[0]] : [];
  }

  /**
   * The captured stage-22 conversation checks the sack, branch and blackjack one
   * after another: with both the sack and the blackjack it gives the sack, then
   * continues into the blackjack show and Janus capture. The wiki dump stores
   * those checks as sibling conditions, which the shared flattener treats as
   * alternatives. Resolve this variant's checks in order instead.
   *
   * Janus needs both the sack and the blackjack: the blackjack branch is only
   * played once the sack is held or was already handed to Vibia. Otherwise the
   * canonical request to keep searching is shown and the stage stays at 22.
   */
  function selectTrapSteps(player, npcId) {
    return (steps) => {
      const out = [];
      const sackReady = hasBit(player, BIT_SACK_GIVEN) || held(player, EMPTY_SACK_ITEM);
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        if (step.type !== "condition") {
          out.push(step);
          continue;
        }
        const run = [step];
        while (steps[index + 1]?.type === "condition") run.push(steps[++index]);
        if (!run.every((condition) => TRAP_CONDITION_STEPS.has(condition.id))) {
          out.push(...run);
          continue;
        }
        for (const condition of run) {
          if (answerCondition({ player, npcId, stepId: condition.id }) === true) {
            out.push(...(condition.steps ?? []));
          }
        }
        if (!sackReady && held(player, MAKESHIFT_BLACKJACK_ITEM)) out.push(...trapRecoverySteps());
      }
      return out;
    };
  }

  function inInterrogationZone(player) {
    const location = player.getLocation();
    if (!location || location.getZ() !== 0) return false;
    const [[minX, maxX, minY, maxY]] = INTERROGATION_BOUNDS;
    return location.getX() >= minX && location.getX() <= maxX
      && location.getY() >= minY && location.getY() <= maxY;
  }

  /** Owner-only basement interrogation scene, reused by the capture action and login resume. */
  function openInterrogationScene(player, movePlayer) {
    if (Scenes.get(player)?.name === "janus-interrogation") return Scenes.get(player);
    Scenes.end(player, false);
    const scene = Scenes.open(player, "janus-interrogation", INTERROGATION_BOUNDS);
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    if (movePlayer) player.moveTo(new Location(INTERROGATION_PLAYER_TILE.x, INTERROGATION_PLAYER_TILE.y, INTERROGATION_PLAYER_TILE.z));
    Scenes.later(scene, 2, () => {
      for (const [id, x, y, faceX, faceY] of INTERROGATION_CAST) Scenes.actor(scene, id, [x, y, 0], [faceX, faceY]);
      Scenes.camera(player, [1650, 9485, 590], [1652, 9492, 130]);
      Scenes.fade(player, false);
    });
    return scene;
  }

  /** The part of the captured transcript after ZWqy3O, so login resumes at the Queen scene. */
  function interrogationContinuationSteps() {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.["home-invasion-interrogating-janus"];
    if (!Array.isArray(steps)) return [];
    const arrival = steps.findIndex((step) => step.id === ACTION_INTERROGATE_ARRIVE);
    return arrival >= 0 ? steps.slice(arrival + 1) : [];
  }

  function restoreInterrogationControls(player) {
    if (quest.getStage(player) !== STAGE_QUEEN_CAM) return;
    if (Scenes.get(player)?.name !== "janus-interrogation") return;
    Scenes.controls(player, false);
  }

  function resumeInterrogation(player) {
    openInterrogationScene(player, false);
    const continuation = interrogationContinuationSteps();
    if (continuation.length) {
      play(player, JANUS_UNCONSCIOUS_ID, "home-invasion-interrogating-janus", () => continuation);
    }
    whenIdle(player, () => restoreInterrogationControls(player));
  }

  function talkVibia(event) {
    const npcId = npcIdOf(event);
    if (!VIBIA_IDS.has(npcId)) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage === STAGE_SAFEHOUSE) {
      play(player, npcId, "home-invasion-talking-to-captain-vibia");
      setStage(player, STAGE_VIBIA);
      return true;
    }
    if (stage >= STAGE_VIBIA && stage < STAGE_HOUSE_OPEN) {
      play(player, npcId, "home-invasion-giving-the-dog-bones-talking-to-captain-vibia-after-giving-the-dog-bones");
      return true;
    }
    if (stage === STAGE_HOUSE_OPEN) {
      play(player, npcId, "home-invasion-in-janus-safehouse");
      return true;
    }
    if (stage >= STAGE_TRAP && stage < STAGE_JANUS) {
      openSafehouseScene(player);
      play(player, npcId, "home-invasion-talking-to-captain-vibia-2", selectTrapSteps(player, npcId),
        tracked(player, "vibia-house"));
      return true;
    }
    if (stage >= STAGE_JANUS && stage < STAGE_CAM_TORUM) {
      play(player, npcId, "home-invasion-interrogating-janus-talking-to-captain-vibia-before-leaving-for-cam-torum");
      return true;
    }
    return false;
  }

  function talkEyatlalli(event) {
    const npcId = npcIdOf(event);
    if (!EYATLALLI_IDS.has(npcId)) return false;
    const { player } = event;
    if (quest.isComplete(player)) {
      const talked = player.getAttribute(POST_ATTALA_ATTRIBUTE) === true;
      play(player, npcId, talked
        ? "post-quest-dialogue-talking-to-eyatlalli-subsequent-post-quest"
        : "post-quest-dialogue-talking-to-eyatlalli-initial-post-quest");
      player.setAttribute(POST_ATTALA_ATTRIBUTE, true);
      return true;
    }
    const stage = quest.getStage(player);
    if (stage === STAGE_NEYPOTZLI_ENTRY) {
      play(player, EYATLALLI_TALK_ID, "interlopers-in-neypotzli-upon-entering-neypotzli");
      setStage(player, STAGE_EYAT);
      return true;
    }
    // The fragment's canonical Destroy text says to ask Eyatlalli for another.
    // Replay her recorded handoff until it succeeds; the action keeps the
    // current Locate stage instead of regressing it.
    if ((stage === STAGE_EYAT || stage === STAGE_LOCATE) && !held(player, KEYSTONE_FRAGMENT_ITEM)) {
      play(player, EYATLALLI_TALK_ID, "interlopers-in-neypotzli-upon-entering-neypotzli");
      return true;
    }
    if (stage === STAGE_NEYPOTZLI) {
      if (!held(player, KEYSTONE_FRAGMENT_ITEM)) {
        play(player, EYATLALLI_TALK_ID, "interlopers-in-neypotzli-upon-entering-neypotzli");
        return true;
      }
      play(player, EYATLALLI_TALK_ID, "interlopers-in-neypotzli-upon-entering-neypotzli-talking-to-eyatlalli-again");
      return true;
    }
    return false;
  }

  function talkKatlo(event) {
    if (!KATLO_IDS.has(npcIdOf(event))) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage >= STAGE_CAM_TORUM && stage < STAGE_REPORT2) {
      play(player, KATLO_TALK_ID, "dwarven-traitor-talking-to-highlord-katlo-in-his-chamber");
      return true;
    }
    return false;
  }

  function talkJanus(event) {
    const npcId = npcIdOf(event);
    if (npcId !== JANUS_TALK_ID) return false;
    if (quest.getStage(event.player) !== STAGE_JANUS) return false;
    play(event.player, npcId, "home-invasion-interrogating-janus-talking-to-servius-before-leaving-for-cam-torum");
    return true;
  }

  function searchJanus(event) {
    if (npcIdOf(event) !== JANUS_UNCONSCIOUS_ID) return false;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_JANUS || !hasBit(player, BIT_JANUS_CAPTURED)) return false;
    play(player, JANUS_UNCONSCIOUS_ID, "home-invasion-interrogating-janus");
    setStage(player, STAGE_BASEMENT_KEY);
    whenIdle(player, () => restoreInterrogationControls(player));
    return true;
  }

  function talkFuria(event) {
    const npcId = npcIdOf(event);
    if (npcId !== FURIA_TALK_ID) return false;
    if (!quest.isComplete(event.player)) return false;
    play(event.player, npcId, "post-quest-dialogue-talking-to-furia");
    return true;
  }

  function talkEmissary(event) {
    const npcId = npcIdOf(event);
    if (!isEmissaryTempleNpc(npcId)) return false;
    const { player } = event;
    if (quest.isComplete(player)) return false;
    const stage = quest.getStage(player);
    if (stage === STAGE_TASKED) {
      play(player, npcId, "infiltration-ii-entering-the-twilight-temple");
      return true;
    }
    if (stage === STAGE_SERMON) {
      play(player, npcId, "infiltration-ii-attempting-to-climb-downstairs");
      return true;
    }
    if (stage >= STAGE_BASEMENT && stage < STAGE_REPORTED) {
      play(player, npcId, "infiltration-ii-talking-to-an-emissary-ascended-chosen-or-acolyte");
      return true;
    }
    return false;
  }

  function petDog(event) {
    const npcId = npcIdOf(event);
    if (!GUARD_DOG_IDS.has(npcId)) return false;
    const { player } = event;
    if (!hasBit(player, BIT_DOG_CALMED)) {
      play(player, npcId, "home-invasion-attempting-to-open-the-safe-house-door-or-using-bones-raw-or-cooked-meat-on-the-guard-dog");
      return true;
    }
    play(player, npcId, "home-invasion-giving-the-dog-bones-petting-the-dog");
    return true;
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  function handleItemOnNpc(event) {
    const npcId = npcIdOf(event);
    const { player, itemId } = event;
    if (GUARD_DOG_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (stage < STAGE_REPORTED || stage > STAGE_JANUS) return;
      if (itemId !== BONES_ITEM && itemId !== COOKED_MEAT_ITEM && itemId !== ALANS_BONES_ITEM && !RAW_MEAT_IDS.has(itemId)) {
        return;
      }
      event.handled = true;
      if (hasBit(player, BIT_DOG_CALMED)) return;
      player.getInventory().deleteNumber(itemId, 1);
      setBit(player, BIT_DOG_CALMED);
      if (stage >= STAGE_HOME) setStage(player, STAGE_DOG);
      play(player, GUARD_DOG_ID, itemId === ALANS_BONES_ITEM
        ? "home-invasion-giving-the-dog-bones-giving-the-dog-alan-s-bones"
        : "home-invasion-giving-the-dog-bones");
      return;
    }
    if (npcId === GALNA_ID && itemId === BEER_ITEM && quest.getStage(player) === STAGE_TEUMO) {
      event.handled = true;
      player.getInventory().deleteNumber(BEER_ITEM, 1);
      play(player, GALNA_ID, "dwarven-traitor-using-beer-on-galna");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId === SAFEHOUSE_SAND_POT_OBJECT && itemId === EMPTY_COIN_PURSE_ITEM) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_PURSE_OPEN) return;
      player.getInventory().deleteNumber(EMPTY_COIN_PURSE_ITEM, 1);
      player.getInventory().adds(SANDY_COIN_PURSE_ITEM, 1);
      setStage(player, STAGE_PURSE_SAND);
      player.sendMessage("You fill the coin purse with sand from the plant pot.");
      return;
    }
    if (objectId === SAFEHOUSE_PLANT_OBJECT && itemId === KNIFE_ITEM) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_PURSE_SAND || held(player, BRANCH_ITEM)) return;
      player.getInventory().adds(BRANCH_ITEM, 1);
      setStage(player, STAGE_TRAP);
      player.sendMessage("You cut a dead branch from the plant.");
      return;
    }
    if (itemId === CANVAS_PIECE_ITEM && TEMPLE_PAINTING_OBJECTS.has(objectId)) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_CANVAS) return;
      player.getInventory().deleteNumber(CANVAS_PIECE_ITEM, 1);
      setStage(player, STAGE_SCROLL);
      play(player, EMISSARY_TEMPLE_ID, "infiltration-ii-entering-the-backroom-using-the-canvas-piece-on-the-drawing");
      return;
    }
    const wanted = DRINK_BY_BARREL.get(objectId);
    if (wanted === undefined) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_TEUMO_BASEMENT || stage > STAGE_PUZZLE) return;
    event.handled = true;
    if (wanted !== itemId || !held(player, itemId)) return;
    const placed = Number(player.getAttribute(BARRELS_ATTRIBUTE)) || 0;
    if (placed >= 5) return;
    player.getInventory().deleteNumber(itemId, 1);
    player.sendMessage(PLACED_DRINK_MESSAGES.get(itemId));
    player.setAttribute(BARRELS_ATTRIBUTE, placed + 1);
    if (placed + 1 === 5) {
      setStage(player, STAGE_PUZZLE);
      cameraBeat(player, [1469, 9569, 690], [1463, 9571, 65], 30);
      player.sendMessage("With the last drink in place, the fireplace extinguishes, revealing a hidden lever.");
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const pair = new Set([event.usedItemId, event.usedWithItemId]);
    if (pair.has(BRANCH_ITEM) && pair.has(SANDY_COIN_PURSE_ITEM)) {
      event.handled = true;
      player.getInventory().deleteNumber(BRANCH_ITEM, 1);
      player.getInventory().deleteNumber(SANDY_COIN_PURSE_ITEM, 1);
      player.getInventory().adds(MAKESHIFT_BLACKJACK_ITEM, 1);
      player.sendMessage("You bind the sand-filled purse to the end of the springy branch, creating a makeshift blackjack.");
      return;
    }
    if (pair.has(KNIFE_BLADE_ITEM) && pair.has(ANCIENT_ROOTS_ITEM)) {
      event.handled = true;
      fletchAncientRoots(player);
    }
  }

  function fletchAncientRoots(player) {
    if (!held(player, KNIFE_BLADE_ITEM)) {
      player.sendMessage("You need a knife blade to fletch the ancient roots.");
      return false;
    }
    player.getInventory().deleteNumber(ANCIENT_ROOTS_ITEM, 1);
    player.getInventory().adds(ROOT_KINDLING_ITEM, 4);
    player.sendMessage("You fletch the ancient roots into root kindling.");
    return true;
  }

  function handleFletchAncientRoots(event) {
    if (event.itemId !== ANCIENT_ROOTS_ITEM || event.option !== "Fletch") return;
    event.handled = true;
    fletchAncientRoots(event.player);
  }

  function readEmissaryScroll(event) {
    const { player, itemId, option } = event;
    if (itemId !== EMISSARY_SCROLL_ITEM || (option !== undefined && option !== "Read")) return;
    if (!held(player, EMISSARY_SCROLL_ITEM)) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_ENFORCER) return;
    setStage(player, STAGE_REPORTED);
    player.sendMessage("You read the emissary scroll.");
  }

  function emptyPotatoSack(event) {
    const { player, itemId, option } = event;
    if (itemId !== POTATO_SACK_ITEM || option !== "Empty") return;
    if (quest.getStage(player) < STAGE_HOME || quest.getStage(player) > STAGE_JANUS) return;
    event.handled = true;
    player.getInventory().deleteNumber(POTATO_SACK_ITEM, 1);
    player.getInventory().adds(EMPTY_SACK_ITEM, 1);
    player.getInventory().adds(POTATO_ITEM, 3);
    player.sendMessage("You empty the sack of potatoes.");
  }

  function emptyCoinPurse(event) {
    const { player, itemId } = event;
    if (itemId !== SANDY_COIN_PURSE_ITEM && itemId !== COIN_PURSE_ITEM) return;
    event.handled = true;
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(EMPTY_COIN_PURSE_ITEM, 1);
    if (itemId === COIN_PURSE_ITEM) player.sendMessage("You open the coin purse and find a few coins inside.");
    else player.sendMessage("You empty the sand from the coin purse.");
    if (quest.getStage(player) === STAGE_UPSTAIRS) {
      setStage(player, STAGE_PURSE_OPEN);
      ensureSafehouseTopObjects(player);
    }
  }

  // ==========================================================================
  // Temple chest lockpick (interface 811, four pins)
  // ==========================================================================

  function finishTempleChestLockpick(player) {
    player.setEnteredAmountAction(null);
    if (!questActive(player) || quest.getStage(player) !== STAGE_SCROLL) return;
    if (player.getAttribute(TEMPLE_CHEST_SOLVED_ATTRIBUTE)) return;
    player.setAttribute(TEMPLE_CHEST_SOLVED_ATTRIBUTE, true);
    player.getPacketSender().sendInterfaceRemoval();
    player.getPacketSender().sendVarbit(TEMPLE_CHEST_LOCKPICK_VARBIT, 1);
    player.sendMessage("You picklock the chest and find a scroll inside.");
    stopTemplePatrol(player);
    syncTracked(player, "temple-patrol", null);
    searchTempleChest(player);
  }

  function searchTempleChest(player) {
    cameraBeat(player, [1719, 9710, 530], [1712, 9707, 529], 30);
    play(player, ENFORCER_ID, "infiltration-ii-entering-the-backroom-searching-the-chest");
  }

  const Lockpicking = createQuestLockpicking(api, {
    activePins: 4,
    target: 153, // captured [3,1,4,0,0,0], low digit first
    onSolved: finishTempleChestLockpick,
  });

  /** Let the real Ladders move happen, but advance the safehouse leg on its normal click. */
  function advanceSafehouseStairs(request) {
    if (!request || request.handled || request.objectId !== SAFEHOUSE_STAIRS_OBJECT) return;
    const { player } = request;
    if (!player || quest.getStage(player) !== STAGE_HOUSE_OPEN) return;
    const location = request.object?.getLocation?.();
    if (!location?.equals(new Location(1647, 3091, 0))) return;
    setStage(player, STAGE_UPSTAIRS);
  }

  /** Claim the generic Ladders climb for the captured temple-stairs passphrase. */
  function claimTempleStairs(request) {
    if (!request || request.handled || request.objectId !== TEMPLE_STAIRS_OBJECT) return;
    const { player } = request;
    if (!player || quest.getStage(player) !== STAGE_SERMON) return;
    request.handled = true;
    phraseWords.delete(player);
    play(player, EMISSARY_TEMPLE_ID, "infiltration-ii-attempting-to-climb-downstairs");
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleObject(event) {
    const { player, objectId } = event;
    const stage = quest.getStage(player);

    if (objectId === SAFEHOUSE_WINDOW_OBJECT) {
      if (stage !== STAGE_VIBIA && stage !== STAGE_WINDOW) return;
      event.handled = true;
      if (stage === STAGE_VIBIA) {
        setStage(player, STAGE_WINDOW);
        player.sendMessage("You manage to force open the window cover. Inside the room you see a dog roaming around.");
      } else {
        setStage(player, STAGE_HOME);
        player.moveTo(new Location(1651, 3094, 0));
      }
      return;
    }

    if (objectId === SAFEHOUSE_DOOR_OBJECT) {
      if (stage !== STAGE_DOG || !hasBit(player, BIT_DOG_CALMED)) return;
      event.handled = true;
      setStage(player, STAGE_HOUSE_OPEN);
      ensureSafehouseDoorState(player);
      player.moveTo(new Location(1651, 3094, 0));
      player.sendMessage("You unlock the door and call in Captain Vibia to join you.");
      return;
    }

    if (objectId === SAFEHOUSE_STAIRS_OBJECT && stage === STAGE_HOUSE_OPEN) {
      setStage(player, STAGE_UPSTAIRS);
      return;
    }

    if (objectId === TEMPLE_BED_OBJECT) {
      event.handled = true;
      if (stage < STAGE_BACKROOM) return;
      if (held(player, DRAWER_KEY_ITEM)) {
        player.sendMessage("You have already taken the key.");
        return;
      }
      if (!give(player, DRAWER_KEY_ITEM, "You search the bed and find a key under one of the pillows, but you don't have enough room to take it.")) return;
      player.sendMessage("You search the bed and find a key under one of the pillows.");
      setStage(player, STAGE_KEY);
      return;
    }

    if (TEMPLE_DRAWERS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_KEY || !held(player, DRAWER_KEY_ITEM)) {
        player.sendMessage("The drawers are locked.");
        return;
      }
      if (held(player, CANVAS_PIECE_ITEM) || stage >= STAGE_SCROLL) {
        player.sendMessage("The drawers are empty.");
        return;
      }
      if (!give(player, CANVAS_PIECE_ITEM, "You search the drawers and find a piece of canvas, but you don't have enough room to take it.")) return;
      player.sendMessage("You search the drawers and find a piece of canvas.");
      setStage(player, STAGE_CANVAS);
      return;
    }

    if (objectId === TEMPLE_CHEST_OBJECT) {
      event.handled = true;
      if (stage === STAGE_ENFORCER && !held(player, EMISSARY_SCROLL_ITEM)) {
        if (give(player, EMISSARY_SCROLL_ITEM, "You have no room for the emissary scroll.")) {
          player.sendMessage("You recover the emissary scroll from the floor.");
        }
        return;
      }
      if (stage >= STAGE_FIGHT || held(player, EMISSARY_SCROLL_ITEM)) {
        play(player, ENFORCER_ID, "infiltration-ii-entering-the-backroom-searching-the-chest-again");
        return;
      }
      if (stage !== STAGE_SCROLL) return;
      if (!player.getAttribute(TEMPLE_CHEST_SOLVED_ATTRIBUTE)) {
        Lockpicking.open(player);
        return;
      }
      searchTempleChest(player);
      return;
    }

    if (TEMPLE_PAINTING_OBJECTS.has(objectId)) {
      // The canvas opened the passage; walking through it again re-enters.
      if (stage < STAGE_SCROLL || stage >= STAGE_ENFORCER) return;
      event.handled = true;
      player.moveTo(new Location(TEMPLE_HIDDEN_ROOM_TILE.x, TEMPLE_HIDDEN_ROOM_TILE.y, TEMPLE_HIDDEN_ROOM_TILE.z));
      return;
    }

    if (TEMPLE_ENTRY_OBJECTS.has(objectId)) {
      if (stage !== STAGE_BASEMENT) return;
      event.handled = true;
      play(player, EMISSARY_TEMPLE_ID, "infiltration-ii-entering-the-backroom");
      player.moveTo(new Location(1712, 9703, 0));
      return;
    }

    if (
      objectId === NEYPOTZLI_ENTRY_OBJECT ||
      objectId === STREAMBOUND_ENTRY_OBJECT ||
      objectId === EARTHBOUND_ENTRY_OBJECT ||
      objectId === ANCIENT_PRISON_ENTRY_OBJECT
    ) {
      event.handled = true;
      if (objectId === NEYPOTZLI_ENTRY_OBJECT && stage === STAGE_NEYPOTZLI_ENTRY) {
        player.moveTo(new Location(NEYPOTZLI_INTERIOR_TILE.x, NEYPOTZLI_INTERIOR_TILE.y, NEYPOTZLI_INTERIOR_TILE.z));
        return;
      }
      if (objectId === STREAMBOUND_ENTRY_OBJECT && (stage === STAGE_NEYPOTZLI || stage === STAGE_LOCATE)) {
        setStage(player, STAGE_LOCATE);
        player.moveTo(new Location(STREAMBOUND_TILE.x, STREAMBOUND_TILE.y, STREAMBOUND_TILE.z));
        return;
      }
      if (objectId === EARTHBOUND_ENTRY_OBJECT && stage === STAGE_LOCATE && neypotzliCheckpoint(player) >= 1) {
        player.moveTo(new Location(EARTHBOUND_TILE.x, EARTHBOUND_TILE.y, EARTHBOUND_TILE.z));
        return;
      }
      if (objectId === ANCIENT_PRISON_ENTRY_OBJECT && stage === STAGE_LOCATE && neypotzliCheckpoint(player) >= 2) {
        player.moveTo(new Location(ANCIENT_PRISON_TILE.x, ANCIENT_PRISON_TILE.y, ANCIENT_PRISON_TILE.z));
        return;
      }
      return;
    }

    if (objectId === TEUMO_STAIRS_OBJECT) {
      if (stage < STAGE_TEUMO_BASEMENT || stage >= STAGE_NEYPOTZLI) return;
      event.handled = true;
      player.moveTo(new Location(TEUMO_BASEMENT_TILE.x, TEUMO_BASEMENT_TILE.y, TEUMO_BASEMENT_TILE.z));
      return;
    }

    if (TEUMO_SHELF_OBJECTS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_TEUMO_BASEMENT || stage > STAGE_PUZZLE) return;
      for (const itemId of [BEER_ITEM, DWARVEN_STOUT_ITEM, STEAMFORGE_BREW_ITEM, MIND_BOMB_ITEM, BEER_GLASS_ITEM]) {
        if (!held(player, itemId)) player.getInventory().adds(itemId, 1);
      }
      player.sendMessage("You take a selection of drinks from the cabinet.");
      return;
    }

    if (TEUMO_BARRELS.has(objectId)) {
      event.handled = true;
      player.sendMessage(BARREL_INSPECT_MESSAGES.get(objectId));
      return;
    }

    if (objectId === FIREPLACE_OBJECT) {
      event.handled = true;
      if (stage < STAGE_TEUMO_BASEMENT || stage > STAGE_PUZZLE) return;
      if ((Number(player.getAttribute(BARRELS_ATTRIBUTE)) || 0) < 5) {
        player.sendMessage("The fireplace is still lit. You need to extinguish it first.");
        return;
      }
      play(player, ATTALA_TALK_ID, "dwarven-traitor-inspecting-the-fireplace");
      return;
    }

    if (HOLE_OBJECTS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_LEVER || stage > STAGE_EAVESDROP || !hasBit(player, BIT_LEVER) || hasBit(player, BIT_HOLE_SEEN)) return;
      play(player, ATTALA_TALK_ID, "dwarven-traitor-hidden-entrance");
      return;
    }

    if (objectId === SUN_URN_OBJECT) {
      event.handled = true;
      if (stage < STAGE_CAVERN) return;
      if (held(player, KUHU_ESSENCE_ITEM)) {
        player.sendMessage("The urn appears to be empty.");
        return;
      }
      player.getInventory().adds(KUHU_ESSENCE_ITEM, 1);
      player.sendMessage("You find some strange essence inside the urn.");
      return;
    }

    if (objectId === SUN_STATUE_OBJECT) {
      event.handled = true;
      if (stage < STAGE_CAVERN) return;
      const progress = Number(player.getAttribute(SUN_ATTRIBUTE)) || 0;
      const [playerAltar, itzlaAltar] = sunPair(player, progress);
      player.sendMessage("Light reflects off the statue, revealing some words engraved upon it: [Old Ones text]");
      const words = [playerAltar + 1, itzlaAltar + 1].map((number) => SUN_WORDS[number] ?? SUN_ALTAR_NAMES[number - 1]);
      player.sendMessage(`The engraving reads: ${words.join(" ")}.`);
      player.sendMessage(`The engraving points to the ${SUN_ALTAR_NAMES[playerAltar]} and ${SUN_ALTAR_NAMES[itzlaAltar]} altars.`);
      if (Number(player.getAttribute(SUN_ITZLA_ATTRIBUTE)) !== itzlaAltar) {
        player.sendMessage(`Itzla needs to stand at the ${SUN_ALTAR_NAMES[itzlaAltar]} altar.`);
      }
      play(player, ITZLA_QUEST_ID, "crypt-assault-sun-chamber-inspecting-the-sun-statue");
      return;
    }

    if (objectId === SUN_ALTAR_OBJECT) {
      event.handled = true;
      imbueSunAltar(player, event.location);
      return;
    }

    if (objectId === MOON_STATUE_OBJECT) {
      event.handled = true;
      if (stage < STAGE_CAVERN || stage > STAGE_DOORS) return;
      openMoonKindling(player);
      return;
    }

    if (objectId === MOON_ROOTS_OBJECT) {
      event.handled = true;
      if (stage < STAGE_CAVERN) return;
      if (freeSlots(player) <= 0) {
        player.sendMessage("You need some space in your inventory to do that.");
        return;
      }
      player.getInventory().adds(ANCIENT_ROOTS_ITEM, 1);
      player.sendMessage("You pull up some roots.");
      return;
    }

    if (objectId === MOON_TOOLS_OBJECT) {
      event.handled = true;
      if (stage < STAGE_CAVERN) return;
      if (held(player, KNIFE_BLADE_ITEM)) return;
      if (freeSlots(player) <= 0) {
        player.sendMessage("You search the tools and find an old knife blade, but you don't have enough room to take it.");
        return;
      }
      player.getInventory().adds(KNIFE_BLADE_ITEM, 1);
      player.sendMessage("You search the tools and find an old knife blade.");
      return;
    }

    if (MOON_PLATFORMS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_CAVERN) return;
      play(player, ITZLA_QUEST_ID, "crypt-assault-moon-chamber-moving-prince-itzla");
      return;
    }

    if (objectId === RUINS_SKELETON_OBJECT) {
      event.handled = true;
      if (stage !== STAGE_EXPLORE) return;
      if (!give(player, STONE_TABLET_ITEM, "You search the skeleton and find a tablet, but you don't have enough room to take it.")) return;
      player.sendMessage("You search the skeleton and find a tablet.");
      setBit(player, BIT_TABLET_ONE);
      setBit(player, BIT_TABLET_TWO);
      syncQuestVarbits(player);
      for (const axis of [0, 1]) player.getPacketSender().sendCameraShake(axis, 4);
      player.getPacketSender().sendCameraShake(2, 2);
      Scenes.later(player, 2, () => player.getPacketSender().sendCameraReset());
      checkRuinsExplored(player);
      return;
    }

    if (RUINS_DOOR_OBJECTS.has(objectId)) {
      event.handled = true;
      if (stage !== STAGE_EXPLORE) return;
      setBit(player, BIT_DOOR);
      syncQuestVarbits(player);
      player.sendMessage("You go to return to the chamber where you found Metzli, but hear a horrifying screeching sound coming from within. You decide it's probably best to remain here.");
      checkRuinsExplored(player);
      return;
    }

    if (objectId === RUINS_RALOS_OBJECT) {
      event.handled = true;
      if (stage !== STAGE_EXPLORE) return;
      player.sendMessage("The statue appears to be some sort of memorial. It has a single word engraved upon it: 'Ralos'");
      setBit(player, BIT_RALOS);
      syncQuestVarbits(player);
      checkRuinsExplored(player);
      return;
    }

    if (RUINS_RANUL_OBJECTS.has(objectId)) {
      event.handled = true;
      if (stage !== STAGE_EXPLORE) return;
      player.sendMessage("The statue appears to be some sort of memorial. It has a single word engraved upon it: 'Ranul'");
      setBit(player, BIT_RANUL);
      syncQuestVarbits(player);
      checkRuinsExplored(player);
      return;
    }

    if (objectId === CRYPT_ENTRY_OBJECT) {
      event.handled = true;
      if (stage === STAGE_CRYPT) {
        cameraBeat(player, [1307, 9358, 470], [1313, 9354, 469], 90);
        fadePulse(player);
        player.moveTo(new Location(1331, 9353, 2));
        openCryptScene(player);
        play(player, QUEEN_TALK_ID, "crypt-assault-entering-the-temple");
        player.setAttribute(WAVE_ATTRIBUTE, 1);
        setStage(player, STAGE_WAVES);
        spawnCultistWave(player);
        return;
      }
      if (stage === STAGE_WAVES) spawnCultistWave(player);
    }
  }

  function sunOrder(player) {
    const stored = Number(player.getAttribute(SUN_ORDER_ATTRIBUTE));
    const order = stored === 2 ? 2 : 1;
    if (stored !== order) {
      player.setAttribute(SUN_ORDER_ATTRIBUTE, order);
      player.getPacketSender().sendVarbit(SUN_ORDER_VARBIT, order);
    }
    return order;
  }

  /** QH/captured sun pair: returned as [player altar, Itzla altar]. */
  function sunPair(player, step) {
    const [itzlaAltar, playerAltar] = SUN_ORDER_STEPS[sunOrder(player)][step] ?? SUN_ORDER_STEPS[1][0];
    return [playerAltar, itzlaAltar];
  }

  function plainTile(location) {
    const x = typeof location?.getX === "function" ? location.getX() : location?.x;
    const y = typeof location?.getY === "function" ? location.getY() : location?.y;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function sunAltarIndex(location) {
    const tile = plainTile(location);
    if (!tile) return -1;
    let best = -1, distance = 5;
    SUN_ALTAR_TILES.forEach(([x, y], index) => {
      const d = Math.abs(tile.x - x) + Math.abs(tile.y - y);
      if (d < distance) { distance = d; best = index; }
    });
    return best;
  }

  function inSunRoom(player) {
    const l = player.getLocation();
    return l.getZ() === 1 && l.getX() >= 1318 && l.getX() <= 1345 && l.getY() >= 9433 && l.getY() <= 9458;
  }

  /** Itzla only moves when the player uses the captured altar prompt. */
  function ensureSunItzla(player) {
    const current = player.getAttribute(SUN_ITZLA_ATTRIBUTE);
    return current === undefined || current === null ? -1 : Number(current) || 0;
  }

  /** The saved prompt choice places the sun actor at its recorded stand tile on login. */
  function sunItzlaStandTile(player) {
    const index = Number(player.getAttribute(SUN_ITZLA_ATTRIBUTE));
    return Number.isInteger(index) && index >= 0 && index < 8
      ? (SUN_ITZLA_STAND_TILES[index] ?? SUN_ALTAR_TILES[index])
      : [SUN_PUZZLE_ITZLA_TILE.x, SUN_PUZZLE_ITZLA_TILE.y];
  }

  function moveSunItzla(player, index) {
    const itzla = tracked(player, "itzla-sun");
    if (!itzla) return;
    const [x, y] = SUN_ITZLA_STAND_TILES[index] ?? SUN_ALTAR_TILES[index] ?? [SUN_PUZZLE_ITZLA_TILE.x, SUN_PUZZLE_ITZLA_TILE.y];
    itzla.moveTo(new Location(x, y, SUN_PUZZLE_ITZLA_TILE.z));
  }



  function moonNeed(player, progress) {
    player.getPacketSender().sendVarbit(MOON_ORDER_VARBIT, 2);
    return MOON_KINDLING_NEEDS[progress] ?? MOON_KINDLING_NEEDS[0];
  }

  /**
   * Capture 3128: clicking the moon statue shows the burnt-kindling messagebox once before the
   * first successful offering, then opens the native numeric prompt
   * "How much kindling do you want to place on the statue? (1 - <held>)"
   * (meslayer_mode7 / resume_countdialog).
   */
  function cancelMoonKindlingPrompt(player) {
    const action = moonKindlingPrompt.get(player);
    if (action && player.getEnteredAmountAction?.() === action) player.setEnteredAmountAction(null);
    moonKindlingPrompt.delete(player);
  }

  function openMoonKindling(player) {
    cancelMoonKindlingPrompt(player);
    const progress = Number(player.getAttribute(MOON_ATTRIBUTE)) || 0;
    const held = player.getInventory().getAmount(ROOT_KINDLING_ITEM);
    if (progress >= 3 || held <= 0) {
      player.sendMessage("There looks to be a small amount of burnt kindling around the statue.");
      return;
    }
    moonNeed(player, progress);
    if (progress === 0) {
      player.getDialogueManager().startDialogues(new DialogueChainBuilder()
        .add(new StatementDialogue(0, "There looks to be a small amount of burnt kindling around the statue."))
        .add(new ActionDialogue(1, { execute: () => startMoonKindlingPrompt(player, held) })));
      return;
    }
    startMoonKindlingPrompt(player, held);
  }

  function startMoonKindlingPrompt(player, held) {
    player.getDialogueManager().reset();
    const action = { execute: (amount) => handleMoonKindlingAmount(player, action, amount) };
    moonKindlingPrompt.set(player, action);
    player.setEnteredAmountAction(action);
    player.getPacketSender().sendEnterAmountPrompt(
      `How much kindling do you want to place on the statue? (1 - ${held})`
    );
  }

  function handleMoonKindlingAmount(player, action, amount) {
    if (moonKindlingPrompt.get(player) !== action) return;
    if (player.getEnteredAmountAction?.() !== action) return;
    cancelMoonKindlingPrompt(player);
    if (quest.getStage(player) < STAGE_CAVERN || quest.getStage(player) > STAGE_DOORS) return;
    const progress = Number(player.getAttribute(MOON_ATTRIBUTE)) || 0;
    if (progress >= 3) return;
    const held = player.getInventory().getAmount(ROOT_KINDLING_ITEM);
    if (!Number.isInteger(amount) || amount <= 0) return;
    if (held < amount) {
      player.sendMessage("You do not have that much kindling.");
      return;
    }
    const need = moonNeed(player, progress);
    player.getInventory().deleteNumber(ROOT_KINDLING_ITEM, amount);
    if (amount !== need) {
      player.sendMessage("<col=ff3045>The statue rejects the kindling and incinerates it.");
      return;
    }
    const next = progress + 1;
    player.setAttribute(MOON_ATTRIBUTE, next);
    syncQuestVarbits(player);
    if (next >= 3) {
      player.sendMessage("<col=a53fff>The statue lights up with energy as it accepts your offering of kindling.");
      if ((Number(player.getAttribute(SUN_ATTRIBUTE)) || 0) >= 3) {
        setStage(player, STAGE_PUZZLES_DONE);
        player.sendMessage("<col=229628>The ruins shake as you activate the final statue.");
      }
      return;
    }
    player.sendMessage("<col=a53fff>The statue seems to glow as it accepts your offering of kindling.");
    if (progress === 0) player.sendMessage("Whatever you're doing seems to be working. Keep at it!");
  }

  /** Three successful imbues require the player and Itzla at the engraved altars. */
  function imbueSunAltar(player, location) {
    if (quest.getStage(player) < STAGE_CAVERN) return;
    const progress = Number(player.getAttribute(SUN_ATTRIBUTE)) || 0;
    if (progress >= 3) {
      player.sendMessage("The altar has already been imbued.");
      return;
    }
    if (!held(player, KUHU_ESSENCE_ITEM)) {
      player.sendMessage("You have nothing to imbue the altar with.");
      return;
    }
    const [playerAltar, itzlaAltar] = sunPair(player, progress);
    const clicked = sunAltarIndex(location);
    const itzla = ensureSunItzla(player);
    if (clicked !== playerAltar || itzla !== itzlaAltar) {
      player.sendMessage("You imbue the altar, but it doesn't seem to work.");
      return;
    }
    player.getInventory().deleteNumber(KUHU_ESSENCE_ITEM, 1);
    const next = progress + 1;
    player.setAttribute(SUN_ATTRIBUTE, next);
    if (next >= 3) {
      syncQuestVarbits(player);
      player.sendMessage("You imbue the altar and the central statue lights up with energy.");
      if ((Number(player.getAttribute(MOON_ATTRIBUTE)) || 0) >= 3) setStage(player, STAGE_PUZZLES_DONE);
      return;
    }
    player.setAttribute(SUN_ITZLA_ATTRIBUTE, -1);
    syncQuestVarbits(player);
    player.sendMessage("You imbue the altar, and hear a grinding sound coming from the central statue.");
    if (progress === 0) player.sendMessage("That seemed to do the trick! Keep it up.");
  }

  function neypotzliCheckpoint(player) {
    const stored = Number(player.getAttribute(NEYPOTZLI_CHECKPOINT_ATTRIBUTE));
    const legacy = Number(player.getAttribute(FRAGMENT_ATTRIBUTE));
    const savedValue = player.getPacketSender?.().getVarbit?.(NEYPOTZLI_CHECKPOINT_VARBIT);
    const saved = Number.isFinite(savedValue) ? savedValue : 0;
    const stage = quest.getStage(player);
    const value = stage === STAGE_LOCATE || stage === STAGE_SYMBOL
      ? Math.max(stored || 0, legacy || 0, saved || 0)
      : 0;
    return Math.max(0, Math.min(2, value));
  }

  function setNeypotzliCheckpoint(player, value) {
    const checkpoint = Math.max(0, Math.min(2, value | 0));
    player.setAttribute(NEYPOTZLI_CHECKPOINT_ATTRIBUTE, checkpoint);
    player.getPacketSender().sendVarbit(NEYPOTZLI_CHECKPOINT_VARBIT, checkpoint);
  }

  function syncNeypotzliCheckpoint(player) {
    setNeypotzliCheckpoint(player, neypotzliCheckpoint(player));
  }

  function locateTileMatches(player, x, y) {
    const location = player.getLocation();
    return location.getX() === x && location.getY() === y && location.getZ() === 0;
  }

  /** The fragment's own Locate op; coordinates and varbit16671 are mandatory. */
  function handleLocateKeystone(event) {
    if (event.itemId !== KEYSTONE_FRAGMENT_ITEM || (event.option !== "Locate" && event.option !== "Touch")) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_LOCATE || !held(player, KEYSTONE_FRAGMENT_ITEM)) return;
    const checkpoint = neypotzliCheckpoint(player);
    if (checkpoint === 0 && locateTileMatches(player, 1511, 9702)) {
      setNeypotzliCheckpoint(player, 1);
      player.sendMessage("The fragment shakes and rises out of your hand, it then falls back into your palm, now pointing north east.");
      play(player, EYATLALLI_TALK_ID, "interlopers-in-neypotzli-the-first-fragment-checkpoint");
      return;
    }
    if (checkpoint === 1 && locateTileMatches(player, 1375, 9684)) {
      setNeypotzliCheckpoint(player, 2);
      player.sendMessage("The fragment shakes and rises out of your hand, it then falls back into your palm, now pointing south.");
      play(player, EYATLALLI_TALK_ID, "interlopers-in-neypotzli-the-second-fragment-checkpoint");
      return;
    }
    if (checkpoint === 2 && locateTileMatches(player, 1373, 9539)) {
      player.sendMessage("The fragment crumbles in your hand and the dust blows towards a nearby wall, causing a symbol to appear.");
      for (const axis of [0, 1, 2]) player.getPacketSender().sendCameraShake(axis, 5);
      Scenes.later(player, 2, () => player.getPacketSender().sendCameraReset());
      player.getInventory().deleteNumber(KEYSTONE_FRAGMENT_ITEM, 1);
      setStage(player, STAGE_SYMBOL);
      return;
    }
    player.sendMessage("The fragment doesn't react here.");
  }

  /** Perilous Moons owns the Neypotzli entrances; claim only the captured Dawn realm landings. */
  function handlePerilousTransport(request) {
    const { player, objectId, source } = request;
    if (!player || !source) return;
    const at = (x, y, z) => source.x === x && source.y === y && source.z === z;
    const stage = quest.getStage(player);
    if (objectId === STREAMBOUND_ENTRY_OBJECT && stage === STAGE_NEYPOTZLI
      && at(1458, 9650, 1) && request.destination?.x === 1481 && request.destination?.y === 9669
      && request.destination?.z === 0) {
      setStage(player, STAGE_LOCATE);
      return;
    }
    if (objectId === EARTHBOUND_ENTRY_OBJECT && stage === STAGE_LOCATE
      && neypotzliCheckpoint(player) >= 1 && at(1521, 9720, 0)) {
      request.destination = { ...EARTHBOUND_TILE };
      return;
    }
    if (objectId === ANCIENT_PRISON_ENTRY_OBJECT && stage === STAGE_LOCATE
      && neypotzliCheckpoint(player) >= 2 && at(1373, 9664, 0)) {
      request.destination = { ...ANCIENT_PRISON_TILE };
    }
  }

  function handleGlowingSymbol(event) {
    if (event.objectId !== GLOWING_SYMBOL_OBJECT) return;
    const { player } = event;
    const stage = quest.getStage(player);
    const tile = plainTile(event.location);
    if (!tile || tile.x !== 1375 || tile.y !== 9537) return;
    event.handled = true;
    if (stage === STAGE_SYMBOL) {
      play(player, ENNIUS_BOSS_ID, "interlopers-in-neypotzli-confronting-the-twins");
      return;
    }
    // Saved stage43 outside the arena: the visible symbol remains the normal re-entry.
    if (stage === STAGE_TWINS_FIGHT) {
      fadedStep(player, () => enterTwinsArena(player), 2);
    }
  }

  function handleDoorToggle(request) {
    if (!request?.player) return;
    const { player, objectId } = request;
    if (TEMPLE_ENTRY_OBJECTS.has(objectId)) {
      if (quest.getStage(player) === STAGE_BASEMENT) {
        play(player, EMISSARY_TEMPLE_ID, "infiltration-ii-entering-the-backroom");
      }
      return;
    }
    if (!CRYPT_DOOR_OBJECTS.has(objectId)) return;
    if ((Number(player.getAttribute(SUN_ATTRIBUTE)) || 0) < 3 || (Number(player.getAttribute(MOON_ATTRIBUTE)) || 0) < 3) return;
    request.handled = true;
    play(player, ITZLA_QUEST_ID, "crypt-assault-opening-the-final-doors");
  }

  function checkRuinsExplored(player) {
    if ((bits(player) & EXPLORE_BITS) === EXPLORE_BITS && quest.getStage(player) === STAGE_EXPLORE) {
      finishExploration(player);
    }
  }

  function finishExploration(player) {
    if (quest.getStage(player) !== STAGE_EXPLORE) return;
    setStage(player, STAGE_EXPLORE_DONE);
    const sender = player.getPacketSender();
    sender.sendCameraMoveTo(1318, 9524, 455, { rate: 232, rate2: 100 });
    sender.sendCameraLookAt(1302, 9526, 454, { rate: 232, rate2: 100 });
    play(player, ITZLA_QUEST_ID, "crypt-assault-upon-fully-exploring-the-area");
  }

  // ==========================================================================
  // Combat progression
  // ==========================================================================

  const CRYPT_SCENE_LOCS = [
    [56638, 1308, 9358, 3], [56638, 1307, 9357, 2], [56638, 1304, 9354, 1],
    [56638, 1310, 9358, 1], [56638, 1313, 9359, 0], [56638, 1316, 9357, 0],
    [56808, 1309, 9359, 1], [56808, 1306, 9355, 1], [56810, 1305, 9356, 0],
    [56808, 1318, 9357, 2], [56808, 1315, 9358, 2], [56808, 1308, 9351, 3],
  ];

  function spawnSceneNpc(player, definition) {
    const npc = api.spawnNpc(definition);
    const area = Scenes.get(player)?.area;
    if (npc && area) area.enter(npc);
    return npc;
  }

  function openCryptScene(player) {
    if (Scenes.get(player)) return;
    const scene = Scenes.open(player, "crypt-assault", [[1300, 1343, 9340, 9385, 2]]);
    for (const [id, x, y, face] of CRYPT_SCENE_LOCS) Scenes.loc(scene, { id, x, y, z: 2, face });
  }

  const WAVE_COMPOSITION = [
    [4, 0], [3, 0], [2, 1], [2, 2], [3, 2], [2, 2],
  ];

  function spawnCultistWave(player) {
    if (ownedNpcAlive(player, new Set([CULTIST_MELEE_ID, CULTIST_RANGED_ID]))) return;
    const wave = Math.min(6, Math.max(1, Number(player.getAttribute(WAVE_ATTRIBUTE)) || 1));
    const [melee, ranged] = WAVE_COMPOSITION[wave - 1];
    const tile = player.getLocation();
    for (let i = 0; i < melee; i++) {
      spawnSceneNpc(player, { id: CULTIST_MELEE_ID, x: tile.getX() + 1 + (i % 2), y: tile.getY() + Math.floor(i / 2), z: tile.getZ(), wanderRadius: 2, owner: player, ownerOnly: true });
    }
    for (let i = 0; i < ranged; i++) {
      spawnSceneNpc(player, { id: CULTIST_RANGED_ID, x: tile.getX() - 1 - (i % 2), y: tile.getY() + Math.floor(i / 2), z: tile.getZ(), wanderRadius: 2, owner: player, ownerOnly: true });
    }
  }

  function spawnTwins(player) {
    syncTracked(player, "chimalli", { id: CHIMALLI_ID, x: TWINS_ARENA_TILE.x - 1, y: TWINS_ARENA_TILE.y, z: TWINS_ARENA_TILE.z, wanderRadius: 0 });
    syncTracked(player, "lucius", { id: LUCIUS_ID, x: TWINS_ARENA_TILE.x + 1, y: TWINS_ARENA_TILE.y, z: TWINS_ARENA_TILE.z, wanderRadius: 0 });
  }

  /** Capture 3128: fade out, land inside the twins arena, then release controls and fight. */
  function enterTwinsArena(player) {
    player.getPacketSender().sendCameraReset();
    player.moveTo(new Location(TWINS_ARENA_LANDING.x, TWINS_ARENA_LANDING.y, TWINS_ARENA_LANDING.z));
    spawnTwins(player);
    Scenes.controls(player, false);
  }

  function spawnEnforcer(player) {
    if (tracked(player, "enforcer")) return;
    syncTracked(player, "enforcer", {
      id: ENFORCER_ID,
      x: TEMPLE_ENFORCER_TILE.x,
      y: TEMPLE_ENFORCER_TILE.y,
      z: TEMPLE_ENFORCER_TILE.z,
      wanderRadius: 0,
    });
  }

  function spawnEnnius(player) {
    if (tracked(player, "ennius-boss")) return;
    cameraBeat(player, [1327, 9349, 420], [1336, 9359, 419], 80);
    const tile = player.getLocation();
    const boss = syncTracked(player, "ennius-boss", {
      id: ENNIUS_BOSS_ID,
      x: tile.getX(),
      y: tile.getY() + 2,
      z: tile.getZ(),
      wanderRadius: 0,
    });
    if (boss) Scenes.get(player)?.area?.enter(boss);
    setStage(player, STAGE_ENNIUS);
  }

  function spawnMetzli(player) {
    if (tracked(player, "metzli-boss")) return;
    syncTracked(player, "metzli-boss", {
      id: METZLI_BOSS_ID,
      x: METZLI_CHAMBER_TILE.x + 1,
      y: METZLI_CHAMBER_TILE.y + 3,
      z: METZLI_CHAMBER_TILE.z,
      wanderRadius: 0,
    });
  }

  function ownedNpcAlive(player, ids) {
    const world = api.getWorld();
    if (!world?.getNpcs) return false;
    const username = player.getUsername?.();
    for (const npc of world.getNpcs()) {
      if (!ids.has(npc?.getId?.())) continue;
      if (npc.isRegistered?.() === false) continue;
      // The death event fires while the corpse is still in the world: a dying npc
      // must not count, or the last kill never clears the wave.
      if (npc.isDyingFunction?.() === true || (npc.getHitpoints?.() ?? 1) <= 0) continue;
      // Identity fails after a relog recreates the Player, so match the name too.
      // An ownerless npc never belongs to this wave.
      const owner = npc.getOwner?.();
      if (owner === player || (username && owner?.getUsername?.() === username)) return true;
    }
    return false;
  }

  function handleNpcDeath(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    const player = event.killer?.isPlayer?.() ? event.killer : event.player;
    if (!player) return;
    const stage = quest.getStage(player);
    if (npcId === ENFORCER_ID) {
      if (stage !== STAGE_FIGHT) return;
      syncTracked(player, "enforcer", null);
      setStage(player, STAGE_ENFORCER);
      give(player, EMISSARY_SCROLL_ITEM, "You pick up the emissary scroll.");
      player.sendMessage("You pick up the emissary scroll.");
      // The fight happens in the walled-off room; leave it with the scroll.
      player.moveTo(new Location(TEMPLE_CORRIDOR_TILE.x, TEMPLE_CORRIDOR_TILE.y, TEMPLE_CORRIDOR_TILE.z));
      return;
    }
    if (npcId === CULTIST_MELEE_ID || npcId === CULTIST_RANGED_ID) {
      if (stage !== STAGE_WAVES) return;
      if (ownedNpcAlive(player, new Set([CULTIST_MELEE_ID, CULTIST_RANGED_ID]))) return;
      const wave = Number(player.getAttribute(WAVE_ATTRIBUTE)) || 1;
      if (wave < 6) {
        player.setAttribute(WAVE_ATTRIBUTE, wave + 1);
        spawnCultistWave(player);
        player.sendMessage("Another wave of cultists charges in!");
        return;
      }
      setStage(player, STAGE_WAVES_END);
      play(player, QUEEN_TALK_ID, "crypt-assault-upon-clearing-the-waves-of-cultists");
      return;
    }
    if (npcId === ENNIUS_BOSS_ID) {
      if (stage !== STAGE_ENNIUS) return;
      syncTracked(player, "ennius-boss", null);
      setStage(player, STAGE_ENNIUS_DEAD);
      play(player, QUEEN_TALK_ID, "crypt-assault-upon-killing-ennius");
      return;
    }
    if (npcId === METZLI_BOSS_ID) {
      if (stage !== STAGE_METZLI) return;
      syncTracked(player, "metzli-boss", null);
      setStage(player, STAGE_METZLI_DEAD);
      play(player, ITZLA_QUEST_ID, "crypt-assault-upon-defeating-metzli");
      return;
    }
    if (npcId === CHIMALLI_ID || npcId === LUCIUS_ID) {
      if (stage !== STAGE_TWINS_FIGHT) return;
      if (ownedNpcAlive(player, new Set([CHIMALLI_ID, LUCIUS_ID]))) return;
      play(player, ATTALA_TALK_ID, "interlopers-in-neypotzli-upon-defeating-lucius-and-chimalli");
    }
  }

  // ==========================================================================
  // Transcript events
  // ==========================================================================

  /** Captured stage changes that ride on the final archive dialogue lines. */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (player && quest.getStage(player) === STAGE_TRAP && VIBIA_IDS.has(npcId) && event.step?.speaker === "Guard Dog"
      && event.pages?.some(page => page.page === PAGE && page.variants?.includes("home-invasion-talking-to-captain-vibia-2"))
      && Scenes.get(player)?.name === "safehouse-trap") {
      event.actor = tracked(player, "guard-dog") ?? undefined;
    }
    if (!player || !ITZLA_IDS.has(npcId)) return;
    const line = String(text ?? "");
    if (/Let's get after her/i.test(line) && quest.getStage(player) === STAGE_METZLI_DEAD) {
      setStage(player, STAGE_ARCHIVE);
    }
    if (/I want to take a look around first/i.test(line) && quest.getStage(player) === STAGE_ARCHIVE) {
      setStage(player, STAGE_EXPLORE);
    }
  }

  function handleHook(event) {
    if (event.hook !== START_HOOK) return;
    const { player } = event;
    if (quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) {
      player.sendMessage("You do not meet all of the requirements to start The Final Dawn.");
      return;
    }
    setStage(player, STAGE_STARTED);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (isEmissaryTempleNpc(npcId)) {
      if (PHRASE_WORDS.has(option)) {
        const words = [...(phraseWords.get(player) ?? []), option].slice(-2);
        phraseWords.set(player, words);
        // Quest Helper enters "Final." then "Dawn." directly; the dump also nests
        // a second menu under "Eclipse.", so award the good branch here too.
        if (correctPassphrase(player)) {
          setStage(player, STAGE_BASEMENT);
          player.moveTo(new Location(TEMPLE_BASEMENT_ENTRY_TILE.x, TEMPLE_BASEMENT_ENTRY_TILE.y, TEMPLE_BASEMENT_ENTRY_TILE.z));
        }
      }
      if (option === "Enter the passage.") {
        player.moveTo(new Location(TEMPLE_HIDDEN_ROOM_TILE.x, TEMPLE_HIDDEN_ROOM_TILE.y, TEMPLE_HIDDEN_ROOM_TILE.z));
      }
      return;
    }
    const direction = DIRECTION_INDEX[option] ?? DIRECTION_INDEX[String(option)
      .replace(/north west/i, 'North-west').replace(/north east/i, 'North-east')
      .replace(/south west/i, 'South-west').replace(/south east/i, 'South-east')];
    if (SUN_ITZLA_IDS.has(npcId) && quest.getStage(player) === STAGE_CAVERN && inSunRoom(player)
      && direction !== undefined) {
      player.setAttribute(SUN_ITZLA_ATTRIBUTE, direction);
      moveSunItzla(player, direction);
      syncQuestVarbits(player);
    }
    if (VIBIA_IDS.has(npcId) && option === "I'll get searching.") {
      if (quest.getStage(player) !== STAGE_HOUSE_OPEN) return;
      ensureSafehouseLoot(player);
      return;
    }
    if (ITZLA_IDS.has(npcId) && quest.isComplete(player) && option === "Yes.") {
      if (held(player, ARKAN_BLADE_ITEM)) return;
      if (player.getInventory().getAmount(COINS_ITEM) < BLADE_PRICE) return;
      player.getInventory().deleteNumber(COINS_ITEM, BLADE_PRICE);
      player.getInventory().adds(ARKAN_BLADE_ITEM, 1);
      player.sendMessage("You give Itzla 250,000 coins and he gives you the Arkan Blade in return.");
    }
  }

  function answerCondition(event) {
    const { player, npcId, stepId } = event;
    if (SERVIUS_IDS.has(npcId) && quest.getStage(player) === 0) {
      if (stepId === COND_NOT_ELIGIBLE) return !meetsRequirements(player);
      if (stepId === COND_ELIGIBLE) return meetsRequirements(player);
    }
    if (isEmissaryTempleNpc(npcId)) {
      if (stepId === COND_NO_ROBES) return !wearingEmissaryRobes(player);
      if (stepId === COND_ROBES) return wearingEmissaryRobes(player);
      if (stepId === COND_BAD_PHRASE || stepId === COND_GOOD_PHRASE) {
        return stepId === COND_GOOD_PHRASE ? correctPassphrase(player) : !correctPassphrase(player);
      }
    }
    if (ATTALA_IDS.has(npcId)) {
      if (stepId === COND_PUZZLE_UNSOLVED) return !hasBit(player, BIT_LEVER);
      if (stepId === COND_LEVER_NOT_PULLED) return !hasBit(player, BIT_LEVER);
      if (stepId === COND_LEVER_PULLED) return hasBit(player, BIT_LEVER);
    }
    if (npcId === SERVIUS_BASEMENT_ID) {
      if (stepId === COND_PUZZLE_UNSOLVED_SERVIUS) return !hasBit(player, BIT_LEVER);
      if (stepId === COND_PUZZLE_SOLVED_SERVIUS) return hasBit(player, BIT_LEVER);
    }
    if (VIBIA_IDS.has(npcId)) {
      if (stepId === COND_NO_SPACE_BRANCH) return freeSlots(player) <= 0;
      if (stepId === COND_SPACE_BRANCH) return freeSlots(player) > 0;
      if (stepId === COND_SACK_GIVEN) return hasBit(player, BIT_SACK_GIVEN);
      if (stepId === COND_NO_SACK) return !hasBit(player, BIT_SACK_GIVEN);
      if (stepId === COND_HAS_EMPTY_SACK) return !hasBit(player, BIT_SACK_GIVEN) && held(player, EMPTY_SACK_ITEM);
      if (stepId === COND_HAS_BRANCH) return held(player, BRANCH_ITEM) && !held(player, MAKESHIFT_BLACKJACK_ITEM);
      if (stepId === COND_HAS_BLACKJACK) {
        return held(player, MAKESHIFT_BLACKJACK_ITEM) && (hasBit(player, BIT_SACK_GIVEN) || held(player, EMPTY_SACK_ITEM));
      }
    }
    if (ITZLA_IDS.has(npcId)) {
      const sun = Number(player.getAttribute(SUN_ATTRIBUTE)) || 0;
      const moon = Number(player.getAttribute(MOON_ATTRIBUTE)) || 0;
      if (stepId === COND_SUN_FIRST) return sun === 0;
      if (stepId === COND_SUN_PROGRESS) return sun > 0;
      if (stepId === COND_SUN_NO_ESSENCE) return !held(player, KUHU_ESSENCE_ITEM);
      if (stepId === COND_SUN_ESSENCE) return held(player, KUHU_ESSENCE_ITEM);
      if (stepId === COND_SUN_OK) return true;
      if (stepId === COND_SUN_FIRST_OK) return sun === 1;
      if (stepId === COND_SUN_DONE_STEP) return sun >= 3;
      if (stepId === COND_SUN_FAIL) return false;
      if (stepId === COND_ONE_CHAMBER) return sun >= 3 && moon < 3;
      if (stepId === COND_BOTH_CHAMBERS) return sun >= 3 && moon >= 3;
      if (stepId === COND_ITZLA_IN_COMBAT) return false;
      if (stepId === COND_ITZLA_IDLE) return true;
      if (stepId === COND_INV_FULL_BLADE) return freeSlots(player) <= 0;
      if (stepId === COND_INV_SPACE_BLADE) return freeSlots(player) > 0;
      if (stepId === COND_BLADE_LOST) return !held(player, ARKAN_BLADE_ITEM);
      if (stepId === COND_BLADE_STORED) return false;
      if (stepId === COND_NOT_ENOUGH_MONEY) return player.getInventory().getAmount(COINS_ITEM) < BLADE_PRICE;
      if (stepId === COND_ENOUGH_MONEY) return player.getInventory().getAmount(COINS_ITEM) >= BLADE_PRICE;
    }
    if (QUEEN_IDS.has(npcId)) {
      if (stepId === COND_AKD_NOT_DONE) return !questComplete(player, "a_kingdom_divided");
      if (stepId === COND_AKD_DONE) return questComplete(player, "a_kingdom_divided");
    }
    return null;
  }

  /** The chosen condition branch; side effects only (the branch answer lives in answerCondition). */
  function handleCondition(event) {
    const { player, npcId, stepId } = event;
    if (isEmissaryTempleNpc(npcId) && stepId === COND_GOOD_PHRASE) {
      setStage(player, STAGE_BASEMENT);
      player.moveTo(new Location(TEMPLE_CORRIDOR_TILE.x, TEMPLE_CORRIDOR_TILE.y, TEMPLE_CORRIDOR_TILE.z));
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      case ACTION_MEETING_OPENS:
        if (!SERVIUS_IDS.has(npcId)) return;
        cameraBeat(player, [1681, 3161, 560], [1670, 3157, 559], 60);
        return;
      case ACTION_MEETING_ENDS:
        if (!SERVIUS_IDS.has(npcId)) return;
        setStage(player, STAGE_TASKED);
        player.moveTo(new Location(PALACE_TILE.x, PALACE_TILE.y, PALACE_TILE.z));
        return;
      case ACTION_SERMON_OPENS:
        if (!isEmissaryTempleNpc(npcId) || quest.getStage(player) !== STAGE_TASKED) return;
        cameraBeat(player, [1693, 3245, 520], [1686, 3247, 519], 50);
        setStage(player, STAGE_SERMON);
        return;
      case ACTION_CHEST_CUTSCENE:
      case ACTION_CHEST_FIGHT:
        if (npcId !== ENFORCER_ID) return;
        setStage(player, STAGE_FIGHT);
        spawnEnforcer(player);
        return;
      case ACTION_BACKROOM_ENDS:
        if (!isEmissaryTempleNpc(npcId) || quest.getStage(player) !== STAGE_BASEMENT) return;
        cameraBeat(player, [1705, 9706, 1000], [1707, 9706, 680], 40);
        fadePulse(player);
        setStage(player, STAGE_BACKROOM);
        return;
      case ACTION_SAFEHOUSE_ENTER:
        if (!VIBIA_IDS.has(npcId)) return;
        setStage(player, STAGE_HOUSE_OPEN);
        return;
      case ACTION_SACK_GIVEN:
        if (!VIBIA_IDS.has(npcId)) return;
        if (held(player, EMPTY_SACK_ITEM)) player.getInventory().deleteNumber(EMPTY_SACK_ITEM, 1);
        setBit(player, BIT_SACK_GIVEN);
        return;
      case ACTION_JANUS_CAPTURE:
        if (!VIBIA_IDS.has(npcId)) return;
        Scenes.end(player, false);
        cameraBeat(player, [1652, 3093, 330], [1651, 3093, 329], 30);
        setBit(player, BIT_JANUS_CAPTURED);
        setStage(player, STAGE_JANUS);
        // Capture 3128 returns from the trap instance to the house with the door open.
        ensureSafehouseDoorState(player);
        return;
      case ACTION_INTERROGATE_ARRIVE:
        if (npcId !== JANUS_UNCONSCIOUS_ID) return;
        openInterrogationScene(player, true);
        setStage(player, STAGE_QUEEN_CAM);
        return;
      case ACTION_TRAVEL_CAM_TORUM:
        if (npcId !== JANUS_UNCONSCIOUS_ID && !QUEEN_IDS.has(npcId)) return;
        Scenes.end(player, false);
        setStage(player, STAGE_TRAVEL);
        setStage(player, STAGE_ARRIVED);
        player.moveTo(new Location(CAM_TORUM_TILE.x, CAM_TORUM_TILE.y, CAM_TORUM_TILE.z));
        // The consent transcript's terminal close would wipe a scene played inline.
        whenIdle(player, () => play(player, KATLO_TALK_ID, "dwarven-traitor"));
        return;
      case ACTION_CAM_TORUM_ENDS:
        if (npcId !== KATLO_TALK_ID) return;
        setStage(player, STAGE_CAM_TORUM);
        player.moveTo(new Location(CAM_TORUM_MARKET_TILE.x, CAM_TORUM_MARKET_TILE.y, CAM_TORUM_MARKET_TILE.z));
        return;
      case ACTION_ATTALA_DEPART:
        if (!ATTALA_IDS.has(npcId)) return;
        setStage(player, STAGE_MARKET);
        return;
      case ACTION_BEER_GIVEN:
        if (npcId !== GALNA_ID) return;
        setStage(player, STAGE_TEUMO_BASEMENT);
        player.moveTo(new Location(TEUMO_BASEMENT_TILE.x, TEUMO_BASEMENT_TILE.y, TEUMO_BASEMENT_TILE.z));
        return;
      case ACTION_PULL_LEVER:
        setBit(player, BIT_LEVER);
        setStage(player, STAGE_LEVER);
        return;
      case ACTION_HIDDEN_ENDS:
        if (!ATTALA_IDS.has(npcId)) return;
        cameraBeat(player, [1487, 9550, 650], [1481, 9556, 20], 60);
        fadePulse(player);
        setBit(player, BIT_HOLE_SEEN);
        setStage(player, STAGE_EAVESDROP);
        player.moveTo(new Location(TEUMO_BASEMENT_TILE.x, TEUMO_BASEMENT_TILE.y, TEUMO_BASEMENT_TILE.z));
        return;
      case ACTION_REPORT2_DEPART:
        if (!ATTALA_IDS.has(npcId) && !SERVIUS_IDS.has(npcId)) return;
        setStage(player, STAGE_REPORT2);
        player.moveTo(new Location(NEYPOTZLI_TILE.x, NEYPOTZLI_TILE.y, NEYPOTZLI_TILE.z));
        setStage(player, STAGE_NEYPOTZLI_ENTRY);
        return;
      case ACTION_FRAGMENT_GIVEN:
        if (!EYATLALLI_IDS.has(npcId)) return;
        if (!give(player, KEYSTONE_FRAGMENT_ITEM, "Eyatlalli holds out the fragment, but you have no room for it.")) return;
        if (quest.getStage(player) < STAGE_NEYPOTZLI) setStage(player, STAGE_NEYPOTZLI);
        return;
      case ACTION_TWINS_ENDS:
        if (npcId !== ENNIUS_BOSS_ID) return;
        cameraBeat(player, [1371, 9520, 490], [1357, 9513, 390], 50);
        setStage(player, STAGE_TWINS_FIGHT);
        fadedStep(player, () => enterTwinsArena(player), 2);
        return;
      case ACTION_TWINS_DEFEATED:
        if (!ATTALA_IDS.has(npcId)) return;
        setStage(player, STAGE_TWINS);
        return;
      case ACTION_ATTALA_DEPARTS:
        if (!ATTALA_IDS.has(npcId)) return;
        setStage(player, STAGE_ATTALA_DONE);
        return;
      case ACTION_WAVES_ENDS:
        if (!QUEEN_IDS.has(npcId)) return;
        spawnEnnius(player);
        return;
      case ACTION_DESCEND:
        if (!QUEEN_IDS.has(npcId)) return;
        Scenes.end(player, false);
        player.moveTo(new Location(TONALI_CAVERN_TILE.x, TONALI_CAVERN_TILE.y, TONALI_CAVERN_TILE.z));
        setStage(player, STAGE_CAVERN);
        return;
      case ACTION_DOORS_OPEN:
        if (npcId !== ITZLA_QUEST_ID) return;
        cameraBeat(player, [1318, 9492, 460], [1305, 9498, 459], 80);
        setStage(player, STAGE_DOORS);
        player.moveTo(new Location(METZLI_CHAMBER_TILE.x, METZLI_CHAMBER_TILE.y, METZLI_CHAMBER_TILE.z));
        setStage(player, STAGE_METZLI);
        spawnMetzli(player);
        play(player, ITZLA_QUEST_ID, "crypt-assault-confronting-metzli");
        return;
      case ACTION_COMPLETE:
        if (npcId !== ITZLA_QUEST_ID) return;
        player.getPacketSender().sendCameraReset();
        completeQuest(player);
        return;
      default:
        return;
    }
  }

  function completeQuest(player) {
    if (quest.isComplete(player)) return;
    if (freeSlots(player) <= 0) {
      setBit(player, BIT_BLADE_PENDING);
      return;
    }
    setBit(player, BIT_BLADE_PENDING, false);
    setStage(player, STAGE_FINALE);
    quest.complete(player);
  }

  // ==========================================================================
  // Login
  // ==========================================================================

  function handleLogin({ player }) {
    if (quest.getStage(player) === 0 && questComplete(player, "the_heart_of_darkness")) {
      player.getPacketSender().sendVarbit(16668, 1);
    }
    ensureQuestNpcs(player);
    ensureSafehouseDoorState(player);
    ensureSafehouseTopObjects(player);
    syncNeypotzliCheckpoint(player);
    syncQuestVarbits(player);
    if (quest.getStage(player) === STAGE_WAVES) spawnCultistWave(player);
    if (quest.getStage(player) === STAGE_QUEEN_CAM && inInterrogationZone(player)) resumeInterrogation(player);
    refreshQuestList(player);
  }

  function clearTrackedNpcs(player) {
    const tracked = trackedNpcs.get(player);
    if (!tracked) return;
    for (const npc of tracked.values()) {
      if (npc?.isRegistered?.()) api.removeNpc(npc);
    }
    trackedNpcs.delete(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    cancelMoonKindlingPrompt(player);
    Scenes.end(player, true);
    stopTemplePatrol(player);
    clearSafehouseTopObjects(player);
    clearTeumoBarrels(player);
    clearTrackedNpcs(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Servius asked for my help when the Twilight Emissaries</str>",
        "<str>took Prince Itzla, and Queen Zyanyi had me infiltrate</str>",
        "<str>the cult. I followed them through Civitas, Cam Torum,</str>",
        "<str>Neypotzli and the Crypt of Tonali, and Metzli fell at</str>",
        "<str>Mokhaiotl. Itzla gave me the Arkan blade.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by talking to <col=800000>Servius, Teokan of Ralos</col>",
        "in the <col=800000>Sunrise Palace</col>.",
        "",
        "I need 66 Thieving, 52 Runecraft and 52 Fletching, and to",
        "have completed The Heart of Darkness, Twilight's Promise,",
        "Children of the Sun and Perilous Moons.",
      ];
    }
    const lines = [];
    if (stage < STAGE_REPORTED) {
      lines.push("I have agreed to infiltrate the <col=800000>Twilight Emissaries</col>");
      lines.push("for Queen Zyanyi and find out what they are doing with Itzla.");
      if (stage >= STAGE_SERMON) lines.push("I watched Metzli present Itzla at the Twilight Temple.");
      if (stage >= STAGE_BASEMENT) lines.push("I gave the passphrase and entered the temple basement.");
      if (stage >= STAGE_BACKROOM) lines.push("I found a key under the pillows of the bed.");
      if (stage >= STAGE_BACKROOM) lines.push("I found a canvas piece in the drawers.");
      if (stage >= STAGE_SCROLL) lines.push("I opened the hidden chest behind the painting.");
      if (stage >= STAGE_ENFORCER) lines.push("I defeated the Emissary Enforcer and have the scroll to report.");
    } else if (stage < STAGE_CAM_TORUM) {
      lines.push("The scroll reveals the cult is using a safe house by the western bank.");
      lines.push("Captain Vibia is waiting there to help me capture Forebearer Janus.");
      if (stage >= STAGE_HOUSE_OPEN) lines.push("The house is secured and Vibia is inside.");
      if (stage >= STAGE_TRAP) lines.push("The trap is ready, we are waiting for Janus to return.");
      if (stage >= STAGE_JANUS) lines.push("Janus is captured. Next stop: Cam Torum.");
    } else if (stage < STAGE_NEYPOTZLI) {
      lines.push("I am in <col=800000>Cam Torum</col> hunting the cult's dwarven contact.");
      lines.push("Attala is helping with the investigation.");
      if (stage >= STAGE_MARKET) lines.push("Attala suspects Highseer Vandra's advisor, Teumo.");
      if (stage >= STAGE_TEUMO) lines.push("We are searching Teumo's house for clues.");
      if (stage >= STAGE_TEUMO_BASEMENT) lines.push("I befriended Galna and can search Teumo's basement.");
      if (stage >= STAGE_PUZZLE) lines.push("The basement puzzle is solved; the cult wants a Neypotzli keystone.");
      if (stage >= STAGE_REPORT2) lines.push("I should go to Neypotzli and stop the Tullus twins.");
    } else if (stage < STAGE_CRYPT) {
      lines.push("In <col=800000>Neypotzli</col> the Tullus twins are after the keystone.");
      if (stage >= STAGE_NEYPOTZLI) lines.push("Eyatlalli gave me a keystone fragment to track them.");
      if (stage >= STAGE_TWINS) lines.push("The twins escaped, but I defeated Lucius and Chimalli.");
      lines.push("I should report to the Queen at Tal Teklan.");
    } else if (stage < STAGE_CAVERN) {
      lines.push("The <col=800000>Crypt of Tonali</col> is under attack by the cult.");
      if (stage >= STAGE_WAVES) lines.push("I am holding the crypt against the cultists.");
      if (stage >= STAGE_ENNIUS_DEAD) lines.push("Ennius is dead; Itzla and I are descending into the caverns.");
    } else if (stage < STAGE_METZLI) {
      lines.push("Itzla and I are solving the sun and moon chambers of the Tonali cavern.");
      lines.push("Sun chamber: " + ((Number(player.getAttribute(SUN_ATTRIBUTE)) || 0) >= 3 ? "done" : "not done") + ".");
      lines.push("Moon chamber: " + ((Number(player.getAttribute(MOON_ATTRIBUTE)) || 0) >= 3 ? "done" : "not done") + ".");
    } else {
      lines.push("Itzla and I are hunting Metzli through the Ruins of Mokhaiotl.");
      if (stage >= STAGE_ARCHIVE) lines.push("The archive is empty; Furia killed Metzli. I should explore the ruins.");
      if (stage >= STAGE_EXPLORE_DONE) lines.push("I have explored the ruins. I should return to the crypt.");
    }
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.THIEVING, 55000);
    skills.addExperiences(Skill.RUNECRAFTING, 25000);
    skills.addExperiences(Skill.FLETCHING, 25000);
    if (freeSlots(player) > 0) player.getInventory().adds(ANTIQUE_LAMP_ITEM, 1);
  }

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(SUN_ATTRIBUTE);
  api.persistAttribute(MOON_ATTRIBUTE);
  api.persistAttribute(BARRELS_ATTRIBUTE);
  api.persistAttribute(SUN_ITZLA_ATTRIBUTE, -1);
  api.persistAttribute(SUN_ORDER_ATTRIBUTE, 0);
  api.persistAttribute(MOON_ORDER_ATTRIBUTE, 2);
  api.persistAttribute(TEMPLE_CHEST_SOLVED_ATTRIBUTE, 0);
  api.persistAttribute(WAVE_ATTRIBUTE, 1);
  api.persistAttribute(NEYPOTZLI_CHECKPOINT_ATTRIBUTE, 0);
  api.persistAttribute(SAFEHOUSE_ATTRIBUTE);
  api.persistAttribute(TEUMO_INTRO_ATTRIBUTE);
  api.persistAttribute(POST_ATTALA_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "the_final_dawn",
    name: "The Final Dawn",
    varpId: VARP_FINAL_DAWN,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [
      { skillId: Skill.THIEVING.getIndex(), amount: 55000, label: "Thieving" },
      { skillId: Skill.RUNECRAFTING.getIndex(), amount: 25000, label: "Runecraft" },
      { skillId: Skill.FLETCHING.getIndex(), amount: 25000, label: "Fletching" },
    ],
    rewardItemId: ARKAN_BLADE_ITEM,
    rewardItemLabel: "Arkan blade, antique lamp",
    otherRewards: ["Access to the Crypt of Tonali", "Access to the Doom of Mokhaiotl"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction("Servius, Teokan of Ralos", { "Talk-to": talkServius });
  api.onNpcInteraction("Queen Zyanyi Arkan", { "Talk-to": talkQueen });
  api.onNpcInteraction("Prince Itzla Arkan", { "Talk-to": talkItzla });
  api.onNpcInteraction("Attala", { "Talk-to": talkAttala });
  api.onNpcInteraction("Galna", { "Talk-to": talkGalna });
  api.onNpcInteraction("Captain Vibia", { "Talk-to": talkVibia });
  api.onNpcInteraction("Eyatlalli", { "Talk-to": talkEyatlalli });
  api.onNpcInteraction("Highlord Katlo", { "Talk-to": talkKatlo });
  api.onNpcInteraction("Forebearer Janus", { "Talk-to": talkJanus, Search: searchJanus });
  api.onNpcInteraction("Furia Tullus", { "Talk-to": talkFuria });
  api.onNpcInteraction("Emissary Ascended", { "Talk-to": talkEmissary });
  api.onNpcInteraction("Dog", { Pet: petDog });
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem, { noted: false });
  api.onItemAction("Keystone fragment", { Locate: handleLocateKeystone, Touch: handleLocateKeystone });
  api.onItemAction("Ancient roots", { Fletch: handleFletchAncientRoots });
  api.onItemAction("Potatoes(3)", { Empty: emptyPotatoSack });
  api.onItemAction("Sandy coin purse", { Empty: emptyCoinPurse });
  api.onItemAction("Coin purse", { Open: emptyCoinPurse, Empty: emptyCoinPurse });
  api.onItemAction("Emissary scroll", { Read: readEmissaryScroll });
  api.onObjectInteraction(handleObject);
  api.onObjectInteraction(handleGlowingSymbol);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("perilous-moons:transport", handlePerilousTransport);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  for (const key of STRANGE_TILE_LINKS.keys()) {
    const [x, y, z] = key.split(",").map(Number);
    api.onZoneEnter({ minX: x, maxX: x, minY: y, maxY: y, levels: [z] }, handleStrangeTileStep);
  }
  api.onZoneEnter(SAFEHOUSE_ZONE, handleSafehouseZoneEnter);
  api.onZoneEnter(TEUMO_BASEMENT_ZONE, handleTeumoBasementEnter);
  api.onZoneExit(TEUMO_BASEMENT_ZONE, handleTeumoBasementExit);
  api.onCustomEvent("ladders:climb", advanceSafehouseStairs);
  api.onCustomEvent("ladders:climb", claimTempleStairs);
};
