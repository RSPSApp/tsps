/**
 * Garden of Tranquillity (members).
 *
 * The words come from the "Garden of Tranquillity" transcript page in
 * data/definitions/npc-dialogues.json; this plugin supplies the NPC variant
 * selector, the prose-condition answers, the gardener tasks, the statue/trolley
 * hauling, the Edgeville well ring recovery, the palace garden planting and the
 * completion.
 *
 * Stages (varbit 961 "garden_quest", varp 553 bits 0-5; `lookup-gameval varbit
 * garden` and the cache shortcut checker script 7856 that tests >= 60):
 *   0 not started, 10 sent to the Wise Old Man, 20 told to bring the Ring of
 *   Charos, 30 failed the diplomacy test (retake), 40 building the garden,
 *   50 garden finished, fetch King Roald, 60 complete. The stage values follow
 *   the RuneLite quest-helper step map (0/10/20/30/40/50) and the >= 60
 *   completion check in cache script 7856 (Varrock palace trellis shortcut).
 *
 * Sub-state lives in the cache's own varbits so the client renders the quest
 * correctly (all confirmed in `lookup-gameval varbit garden`):
 *   962 cutscene, 963 Saradomin statue, 964 king statue, 965 trolley cargo,
 *   966 ring in well, 967 Elstan, 968 Lyra, 969/970 Lyra onion patches,
 *   971 Kragen, 972/973 Kragen cabbage patches, 974/975 cabbage patches,
 *   976 Dantaera, 977 Althric, 979/980/981 red/white/pink rosebush,
 *   982 delphiniums, 983 snowdrops, 984/986 pink/yellow orchid pots,
 *   985 white tree, 987 vine, 988 Bernald (the vines object's own transform).
 * Patch varbits: 0-3 unplanted, 4 planted, 7 fully grown (white tree 8); the
 * gameval transform tables for objects 9165/9174/9175/9176/9197/9198/9209/9223/
 * 9232 confirm the mapping.
 *
 * Rewards per the wiki/transcript completion step (SqRZd7): 2 Quest Points,
 * 5,000 Farming XP, the activated Ring of Charos, an acorn, an apple tree seed
 * and 5 guam seeds (the wiki also lists a compost potion(4), granted too).
 *
 * Gaps/approximations:
 * - The 7-question diplomacy test answers are not in the transcript (the dump
 *   only carries the question messages), so the first attempt always fails and
 *   any retake passes; both transcript branches stay reachable.
 * - The trolley moves through ordinary collision-aware NPC steps for each
 *   Push/Pull/Big-push action. The Wiki's five-minute guard recapture and the
 *   transcript's two-minute timer text still conflict, so no timed recapture is
 *   simulated. Logging out during a haul resets its varbits and restores the
 *   original statue; Ellamaria's existing receipt action can issue another
 *   trolley. Placement is handled directly with the transcript's exact
 *   messages: the Saradomin variant nests its place conditions after an END
 *   step inside the "-McVRu" branch, so they can never be reached by the
 *   transcript runtime.
 * - The five pay-gardeners (Elstan, Lyra, Kragen, Dantaera, Alain) are claimed
 *   at Talk-to once the garden phase starts, because Services.Farming owns
 *   their Talk-to for its protect menu; their Pay/Trade options still reach the
 *   farming service. Before stage 40 the hook falls through to it.
 * - A failed diplomacy test retakes through the initial Wise Old Man
 *   conversation: the dedicated retake variant's lost wiki jump resolves to
 *   "end" before the test under NpcDialogues' same-branch guard.
 * - Elstan/Lyra/Dantaera/Alain have no standard transcript page (their index
 *   pages carry no variants), so before the garden phase they play their
 *   quest first-talk variant with the "not wearing the ring" answer instead of
 *   the unnamed generic gardener dialogue.
 * - The Elstan/Lyra/Kragen crop checks use the plugin's own planting timers
 *   (20/40/40 minutes per the wiki) rather than the Farming plugin's private
 *   state; the seeds are still planted/harvested through the real (Farming)
 *   patches. Growth is skipped with the agent:advance-time event.
 * - The List's "Read" interface (Transcript:List is all unavailable steps) and
 *   the guard cutscene actors are not spawned; the cutscene text steps that the
 *   page marks as prose actions are printed as messages.
 *
 * Source: OSRS Wiki (Garden of Tranquillity, Quick guide, Transcript:Garden of
 * Tranquillity); stage values from RuneLite quest-helper and cache script 7856;
 * ids from the cache gamevals.
 */
module.exports = function registerGardenOfTranquillityQuest(api) {
  const {
    Bank,
    Equipment,
    Item,
    ItemIdentifiers,
    Location,
    MapObjects,
    NpcIdentifiers,
    ObjectIdentifiers,
    RegionManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  // ==========================================================================
  // Ids
  // ==========================================================================

  const PAGE = "Garden of Tranquillity";
  const START_HOOK = "quest:garden-of-tranquillity:start";

  const VARP_GARDEN = 553;
  const VARBIT_GARDEN_QUEST = 961; // "garden_quest", varp 553 bits 0-5

  const STAGE_SENT_TO_WOM = 10;
  const STAGE_RING_WANTED = 20;
  const STAGE_TEST_FAILED = 30;
  const STAGE_BUILDING = 40;
  const STAGE_FETCH_ROALD = 50;
  const STAGE_COMPLETE = 60;

  const VARBIT_SARADOMIN_STATUE = 963;
  const VARBIT_KING_STATUE = 964;
  const VARBIT_TROLLEY = 965;
  const VARBIT_RING_IN_WELL = 966;
  const VARBIT_ELSTAN = 967;
  const VARBIT_LYRA = 968;
  const VARBIT_LYRA_PATCH_WEST = 969;
  const VARBIT_LYRA_PATCH_EAST = 970;
  const VARBIT_KRAGEN = 971;
  const VARBIT_KRAGEN_PATCH_NORTH = 972;
  const VARBIT_KRAGEN_PATCH_SOUTH = 973;
  const VARBIT_CABBAGE_PATCH_NORTH = 974;
  const VARBIT_CABBAGE_PATCH_SOUTH = 975;
  const VARBIT_DANTAERA = 976;
  const VARBIT_ALTHRIC = 977;
  const VARBIT_ROSE_RED = 979;
  const VARBIT_ROSE_WHITE = 980;
  const VARBIT_ROSE_PINK = 981;
  const VARBIT_DELPHINIUM = 982;
  const VARBIT_SNOWDROP = 983;
  const VARBIT_ORCHID_PINK = 984;
  const VARBIT_WHITE_TREE = 985;
  const VARBIT_ORCHID_YELLOW = 986;
  const VARBIT_VINE = 987;
  const VARBIT_BERNALD = 988;

  // NPCs (NpcIdentifiers unless the id only exists as a QuestRuntime page).
  const ELLAMARIA_NPC_IDS = new Set([
    NpcIdentifiers.QUEEN_ELLAMARIA, // 1390
    NpcIdentifiers.QUEEN_ELLAMARIA_2, // 11025
  ]);
  const WISE_OLD_MAN_NPC_IDS = new Set([
    NpcIdentifiers.WISE_OLD_MAN, // 2108
    NpcIdentifiers.WISE_OLD_MAN_2, // 2110
    NpcIdentifiers.WISE_OLD_MAN_3, // 2111
    NpcIdentifiers.WISE_OLD_MAN_4, // 2112
    NpcIdentifiers.WISE_OLD_MAN_5, // 2113
    NpcIdentifiers.WISE_OLD_MAN_7, // 4306
    NpcIdentifiers.WISE_OLD_MAN_8, // 4307
    NpcIdentifiers.WISE_OLD_MAN_9, // 8052
    NpcIdentifiers.WISE_OLD_MAN_10, // 8154
    NpcIdentifiers.WISE_OLD_MAN_11, // 8162
    NpcIdentifiers.WISE_OLD_MAN_12, // 8170
    NpcIdentifiers.WISE_OLD_MAN_13, // 8407
    NpcIdentifiers.WISE_OLD_MAN_14, // 8409
    NpcIdentifiers.WISE_YOUNG_MAN, // 8410, shares the page
  ]);
  const KING_ROALD_NPC_IDS = new Set([
    NpcIdentifiers.KING_ROALD, // 1399
    NpcIdentifiers.KING_ROALD_3, // 5215 (the spawned Varrock king)
    NpcIdentifiers.KING_ROALD_5, // 8042
    NpcIdentifiers.KING_ROALD_6, // 11019
    NpcIdentifiers.KING_ROALD_7, // 12621
  ]);
  const BERNALD_NPC_ID = NpcIdentifiers.BERNALD; // 1389
  const BROTHER_ALTHRIC_NPC_ID = NpcIdentifiers.BROTHER_ALTHRIC; // 1397
  const ELSTAN_NPC_ID = NpcIdentifiers.ELSTAN; // 2663
  const DANTAERA_NPC_ID = NpcIdentifiers.DANTAERA; // 2664
  const KRAGEN_NPC_ID = NpcIdentifiers.KRAGEN; // 2665
  const LYRA_NPC_ID = NpcIdentifiers.LYRA; // 2666
  const ALAIN_NPC_ID = NpcIdentifiers.ALAIN; // 2678
  const GARDENER_NPC_IDS = new Set([
    ELSTAN_NPC_ID,
    DANTAERA_NPC_ID,
    KRAGEN_NPC_ID,
    LYRA_NPC_ID,
    ALAIN_NPC_ID,
  ]);
  const CUTSCENE_NPC_ID = NpcIdentifiers.BILLY_A_GUARD_OF_FALADOR; // 1395, chathead for the guard cutscene

  const TROLLEY_CONTENT_IDS = new Set([
    NpcIdentifiers.TROLLEY, // 1391, saradomin cargo
    NpcIdentifiers.TROLLEY_2, // 1392, king cargo
    NpcIdentifiers.TROLLEY_3, // 1393, empty
  ]);
  // 1394 "garden_trolley" multi-NPC (lookup-gameval npc trolley): varbit 965
  // picks 1393 empty / 1391 saradomin / 1392 king. No generated identifier.
  const GARDEN_TROLLEY_MULTI_NPC = 1394;

  // Objects. The placed base ids have no cache names (they are multi-locs), so
  // they have no generated constants; each was confirmed with
  // `lookup-gameval loc garden` and `dump:loc` (placements below).
  const DELPHINIUM_PATCH = 9165; // garden_delphinium_patch, varbit 982, 3225-3227,3474-3478
  const ROSE_PATCH_WHITE = 9174; // garden_rosebush_patch_white, varbit 980, 3232-3233,3471-3472
  const ROSE_PATCH_RED = 9175; // 3229-3230,3471-3472
  const ROSE_PATCH_PINK = 9176; // 3226-3227,3471-3472
  const ORCHID_POT_PINK = 9197; // garden_orchid_pink_patch, varbit 984, 3229,3486
  const ORCHID_POT_YELLOW = 9198; // garden_orchid_yellow_patch, varbit 986, 3231,3486
  const PATCH_WHITE_TREE = 9209; // garden_white_tree_patch, varbit 985, 3x3 at 3229,3474
  const PATCH_SNOWDROP = 9223; // garden_snowdrop_patch, varbit 983, 3232-3233,3479-3484
  const PATCH_VINE = 9232; // garden_vine_patch, varbit 987, 3227,3480-3488
  const FALADOR_STATUE = 9250; // garden_saradomin_statue, varbit 963, 2965,3381
  const LUMBRIDGE_STATUE = 9251; // garden_lumbridge_statue, varbit 964, 3231,3217
  const GARDEN_KING_STATUE = 9252; // garden_king_statue_multi, varbit 964, 3233,3487
  const GARDEN_SARADOMIN_STATUE = 9253; // garden_saradomin_statue_multi, varbit 963, 2x1 at 3229,3479
  const BURTHORPE_VINES = 9254; // garden_burthorpe_vines, varbit 988, 2913-2915,3534
  const EDGEVILLE_WELL = ObjectIdentifiers.WELL_2; // 884 at 3084,3502
  const ROSES_RED = ObjectIdentifiers.ROSES_3; // 9260 "Roses" Take-seed, 3048,3503-3506
  const ROSES_PINK = ObjectIdentifiers.ROSES_4; // 9261, 3050-3053,3506
  const ROSES_WHITE = ObjectIdentifiers.ROSES_5; // 9262, 3055,3503-3506
  const ICE_MOUNTAIN_WHITE_TREE = ObjectIdentifiers.WHITE_TREE; // 9263, 3007,3497

  // Items.
  const LIST = ItemIdentifiers.LIST; // 6479
  const TROLLEY = ItemIdentifiers.TROLLEY; // 6478
  const RING_OF_CHAROS = ItemIdentifiers.RING_OF_CHAROS; // 4202
  const RING_OF_CHAROS_A = ItemIdentifiers.RING_OF_CHAROS_A_; // 6465
  const PLANT_CURE = ItemIdentifiers.PLANT_CURE; // 6036
  const STRONG_PLANT_CURE = ItemIdentifiers.PLANT_CURE_3; // 6468
  const RUNE_ESSENCE = ItemIdentifiers.RUNE_ESSENCE; // 1436
  const PURE_ESSENCE = ItemIdentifiers.PURE_ESSENCE; // 7936
  const RUNE_SHARDS = ItemIdentifiers.RUNE_SHARDS; // 6466
  const RUNE_DUST = ItemIdentifiers.RUNE_DUST; // 6467
  const PESTLE_AND_MORTAR = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const HAMMER = ItemIdentifiers.HAMMER; // 2347
  const SECATEURS = ItemIdentifiers.SECATEURS; // 5329
  const MAGIC_SECATEURS = ItemIdentifiers.MAGIC_SECATEURS; // 7409
  const MARIGOLD_SEED = ItemIdentifiers.MARIGOLD_SEED; // 5096
  const MARIGOLDS = ItemIdentifiers.MARIGOLDS; // 6010
  const ONION_SEED = ItemIdentifiers.ONION_SEED; // 5319
  const CABBAGE_SEED = ItemIdentifiers.CABBAGE_SEED; // 5324
  const DELPHINIUM_SEED = ItemIdentifiers.DELPHINIUM_SEED; // 6457
  const SNOWDROP_SEED = ItemIdentifiers.SNOWDROP_SEED; // 6460
  const ORCHID_PINK_SEED = ItemIdentifiers.ORCHID_SEED; // 6458
  const ORCHID_YELLOW_SEED = ItemIdentifiers.ORCHID_SEED_2; // 6459
  const ROSE_WHITE_SEED = ItemIdentifiers.WHITE_ROSE_SEED; // 6453
  const ROSE_RED_SEED = ItemIdentifiers.RED_ROSE_SEED; // 6454
  const ROSE_PINK_SEED = ItemIdentifiers.PINK_ROSE_SEED; // 6455
  const VINE_SEED = ItemIdentifiers.VINE_SEED; // 6456
  const WHITE_TREE_SHOOT = ItemIdentifiers.WHITE_TREE_SHOOT; // 6461
  const WHITE_TREE_SHOOT_POTTED = ItemIdentifiers.WHITE_TREE_SHOOT_2; // 6462
  const WHITE_TREE_SHOOT_WATERED = ItemIdentifiers.WHITE_TREE_SHOOT_W_; // 6463
  const WHITE_TREE_SAPLING = ItemIdentifiers.WHITE_TREE_SAPLING; // 6464
  const FILLED_PLANT_POT = ItemIdentifiers.FILLED_PLANT_POT; // 5354
  const BUCKET = ItemIdentifiers.BUCKET; // 1925
  const FISHING_ROD = ItemIdentifiers.FISHING_ROD; // 307
  const FLY_FISHING_ROD = ItemIdentifiers.FLY_FISHING_ROD; // 309
  const OILY_FISHING_ROD = ItemIdentifiers.OILY_FISHING_ROD; // 1585
  const ACORN = ItemIdentifiers.ACORN; // 5312
  const APPLE_TREE_SEED = ItemIdentifiers.APPLE_TREE_SEED; // 5283
  const GUAM_SEED = ItemIdentifiers.GUAM_SEED; // 5291
  const COMPOST_POTION_4 = ItemIdentifiers.COMPOST_POTION_4_; // 6470

  const COMPOSTS = new Set([
    ItemIdentifiers.COMPOST, // 6032
    ItemIdentifiers.SUPERCOMPOST, // 6034
    ItemIdentifiers.ULTRACOMPOST, // 21483
  ]);
  const WATERING_CANS = new Set([
    ItemIdentifiers.WATERING_CAN, // 5331
    ItemIdentifiers.WATERING_CAN_2, // 5332
    ItemIdentifiers.WATERING_CAN_1_, // 5333
    ItemIdentifiers.WATERING_CAN_2_, // 5334
    ItemIdentifiers.WATERING_CAN_3_, // 5335
    ItemIdentifiers.WATERING_CAN_4_, // 5336
    ItemIdentifiers.WATERING_CAN_5_, // 5337
    ItemIdentifiers.WATERING_CAN_6_, // 5338
    ItemIdentifiers.WATERING_CAN_7_, // 5339
    ItemIdentifiers.WATERING_CAN_8_, // 5340
  ]);
  const FISHING_RODS = new Set([FISHING_ROD, FLY_FISHING_ROD]);
  const SECATEURS_ITEMS = new Set([SECATEURS, MAGIC_SECATEURS]);
  const WHITE_TREE_SHOOT_ITEMS = new Set([
    WHITE_TREE_SHOOT,
    WHITE_TREE_SHOOT_POTTED,
    WHITE_TREE_SHOOT_WATERED,
    WHITE_TREE_SAPLING,
  ]);

  // ==========================================================================
  // Timing
  // ==========================================================================

  const GARDEN_GROWTH_MS = 15 * 60 * 1000; // the palace patches: 10-15 min per wiki
  const MARIGOLD_GROWTH_MS = 20 * 60 * 1000;
  const CROP_GROWTH_MS = 40 * 60 * 1000; // onions/cabbages at Lyra/Kragen
  const SAPLING_GROWTH_MS = 5 * 60 * 1000; // potted, watered shoot -> sapling

  // ==========================================================================
  // The nine palace garden patches
  // ==========================================================================

  const GARDEN_PATCHES = [
    { key: "delphinium", varbit: VARBIT_DELPHINIUM, objectId: DELPHINIUM_PATCH, seed: DELPHINIUM_SEED, grown: 7, label: "delphiniums",
      tiles: [[3225, 3475], [3225, 3476], [3225, 3477], [3225, 3478], [3226, 3475], [3226, 3476], [3226, 3477], [3226, 3478], [3227, 3474], [3227, 3475], [3227, 3476]] },
    { key: "snowdrop", varbit: VARBIT_SNOWDROP, objectId: PATCH_SNOWDROP, seed: SNOWDROP_SEED, grown: 7, label: "snowdrops",
      tiles: [[3232, 3479], [3232, 3480], [3232, 3481], [3232, 3482], [3232, 3483], [3232, 3484], [3233, 3479], [3233, 3480], [3233, 3481], [3233, 3482], [3233, 3483], [3233, 3484]] },
    // Rose patches share the varbit with the Edgeville bushes: picking seeds sets
    // it to 4, so planting starts at 5 (the 0-4 transform table still shows weeds
    // at 0-3 and a seedling at 4).
    { key: "white_rose", varbit: VARBIT_ROSE_WHITE, objectId: ROSE_PATCH_WHITE, seed: ROSE_WHITE_SEED, planted: 5, grown: 7, label: "the white rosebush",
      tiles: [[3232, 3471], [3232, 3472], [3233, 3471], [3233, 3472]] },
    { key: "red_rose", varbit: VARBIT_ROSE_RED, objectId: ROSE_PATCH_RED, seed: ROSE_RED_SEED, planted: 5, grown: 7, label: "the red rosebush",
      tiles: [[3229, 3471], [3229, 3472], [3230, 3471], [3230, 3472]] },
    { key: "pink_rose", varbit: VARBIT_ROSE_PINK, objectId: ROSE_PATCH_PINK, seed: ROSE_PINK_SEED, planted: 5, grown: 7, label: "the pink rosebush",
      tiles: [[3226, 3471], [3226, 3472], [3227, 3471], [3227, 3472]] },
    { key: "pink_orchid", varbit: VARBIT_ORCHID_PINK, objectId: ORCHID_POT_PINK, seed: ORCHID_PINK_SEED, grown: 7, label: "the pink orchids",
      tiles: [[3229, 3486]] },
    { key: "yellow_orchid", varbit: VARBIT_ORCHID_YELLOW, objectId: ORCHID_POT_YELLOW, seed: ORCHID_YELLOW_SEED, grown: 7, label: "the yellow orchids",
      tiles: [[3231, 3486]] },
    { key: "white_tree", varbit: VARBIT_WHITE_TREE, objectId: PATCH_WHITE_TREE, seed: WHITE_TREE_SAPLING, grown: 8, label: "the white tree",
      tiles: [[3229, 3474]] },
    { key: "vine", varbit: VARBIT_VINE, objectId: PATCH_VINE, seed: VINE_SEED, grown: 7, label: "the Burthorpe vine",
      tiles: [[3227, 3480], [3227, 3481], [3227, 3482], [3227, 3483], [3227, 3484], [3227, 3485], [3227, 3486], [3227, 3487], [3227, 3488]] },
  ];
  const GARDEN_PATCH_BY_OBJECT = new Map(
    GARDEN_PATCHES.map((patch) => [patch.objectId, patch])
  );

  const BURTHORPE_VINE_TILES = [[2913, 3534], [2914, 3534], [2915, 3534]];
  const BURTHORPE_VINE_AREA = { x1: 2911, y1: 3532, x2: 2917, y2: 3536 };

  // The three "real" Farming patches the gardeners ask the player to use.
  const ELSTAN_PATCH_AREA = { x1: 3046, y1: 3302, x2: 3062, y2: 3316 };
  const LYRA_PATCH_AREA = { x1: 3595, y1: 3523, x2: 3609, y2: 3537 };
  const KRAGEN_PATCH_AREA = { x1: 2661, y1: 3371, x2: 2677, y2: 3385 };
  const EDGEVILLE_WELL_AREA = { x1: 3081, y1: 3499, x2: 3089, y2: 3507 };

  // Statue sites and destinations (source tiles and the garden plinths from
  // `dump:loc`; the trolley stops next to its plinth).
  const STATUE_SARADOMIN = {
    varbit: VARBIT_SARADOMIN_STATUE,
    sourceObject: FALADOR_STATUE,
    objectTile: { x: 2965, y: 3381 },
    source: { x: 2965, y: 3382 },
    plinthObject: GARDEN_SARADOMIN_STATUE,
    plinth: { x: 3229, y: 3479 },
    stop: { x: 3229, y: 3480 },
    useVariant: "pushing-the-statues-statue-of-saradomin-falador",
  };
  const STATUE_KING = {
    varbit: VARBIT_KING_STATUE,
    sourceObject: LUMBRIDGE_STATUE,
    objectTile: { x: 3231, y: 3217 },
    source: { x: 3231, y: 3218 },
    plinthObject: GARDEN_KING_STATUE,
    plinth: { x: 3233, y: 3487 },
    stop: { x: 3233, y: 3488 },
    useVariant: "pushing-the-statues-lumbridge-king",
  };
  const STATUE_BY_VARBIT = new Map([
    [1, STATUE_SARADOMIN],
    [2, STATUE_KING],
  ]);

  // ==========================================================================
  // Condition step ids (every prose condition on the page, so an unanswered one
  // defaults to false rather than playing its branch)
  // ==========================================================================

  const GARDEN_CONDITION_IDS = new Set([
    "-GHnLE", "-McVRu", "-O8CtU", "-T8hZe", "-_9mwd", "0NoXjB", "15eFr0", "1Jm_e8",
    "2SAIrr", "2bZE3g", "5m3Bor", "6Ke5IK", "6vva1d", "747GEi", "7BOj2X", "7O53gr",
    "7rSFk_", "82BstK", "8f8ovQ", "96Yxsb", "9jX7Nq", "A1V4Dc", "C2l964", "CEvbLN",
    "CLXY_i", "Ce3SnJ", "DCxr1x", "ED_1a4", "EF1-2N", "EjzGhc", "FE6n_t", "FGN0NU",
    "Fp6Zr0", "GtAu9-", "H6HCCk", "HAhsGB", "HEQTi0", "Heut9r", "HszfnZ", "INprox",
    "IZc3nv", "IdCT0T", "IvLJx8", "JNe-bm", "Jif1m0", "KSSVCU", "KfmZlX", "Ks4RFG",
    "Ks_-Uj", "L-9bWw", "L4AcaY", "MjQth1", "N0eqXG", "NCs4Fo", "NiHZvK", "Nj1EU9",
    "P5LnAu", "PBebcs", "PIfUWk", "PJG3SE", "PZVJvu", "PaXKoM", "Pex-hM", "Pgl-Rj",
    "Q2yvmr", "QM3nkf", "QQDbw9", "QbWR-k", "RSBD4A", "RV6jQC", "RlKECi", "RnF8Ar",
    "RoQujd", "S5Y6LF", "SMBSOR", "Sgr3kt", "T738F6", "TJBXD4", "UM_i91", "UWWBxf",
    "UjG13q", "UowjWN", "UvOYOt", "VfXvC_", "VsX4SB", "VzVPy7", "XHGLQ6", "XQepny",
    "XWelxT", "XaqLma", "Y4dNZC", "YRgczq", "Yi1jJz", "ZluqZI", "ZxgaO8", "ZyMUXw",
    "_lru_g", "aNbCRo", "biSWEe", "ciLJzE", "cjBRaq", "clXIIc", "coo4GB", "cvWn-w",
    "dnJymy", "dz2FuV", "e1a52L", "ewZkGk", "fPLMDi", "fmSO5r", "fuPeOB", "gdOmTD",
    "gwlRoy", "ie_X6K", "ixshUo", "jGaiJa", "l-NaJG", "lMEGU5", "lPU8xm", "lroBLx",
    "mALSSB", "mdKMdt", "n0vCAB", "oCcygL", "ofpllR", "p6_fVN", "pafMtZ", "pg3jbd",
    "poFE0R", "r7-V0a", "rPj9J0", "rR0Uxm", "sXknco", "tr8vQ5", "tv25x9", "uBaVsz",
    "uIAHcH", "ubdQWM", "vE8Hfw", "vIsD1i", "vKsv44", "vNPoP6", "wUCFpU", "wakmKJ",
    "xkbmtS", "xx4rzY", "xxLtip", "y15w5H", "yb-ee9", "ykJrJ-", "zPDfLG", "zxpkbw",
  ]);

  // Action steps whose text the page marks as prose (the runtime only speaks
  // "message" steps): the guard cutscene and the palace finale.
  const SPOKEN_ACTION_IDS = new Set([
    "4QExCc", "T9Jhnk", "BlJddi", // finale
    "ddEalu", "uwyKbH", "_y6evL", "hFKwLa", // Falador guard cutscene
  ]);
  // Wiki annotations that should not surface in game.
  const SILENT_ACTION_IDS = new Set(["O-3q6x", "SOKMDa", "ASuVin"]);

  // ==========================================================================
  // Persisted state
  // ==========================================================================

  const STATE_ATTRIBUTE = "quest.garden_of_tranquillity.state";
  const stateCache = new WeakMap();
  const interaction = new WeakMap();
  const trolleys = new WeakMap();

  const jsonObject = (value) => (value && typeof value === "object" ? value : {});

  function stateOf(player) {
    let state = stateCache.get(player);
    if (state) return state;
    let parsed;
    try {
      parsed = JSON.parse(player.getAttribute(STATE_ATTRIBUTE) || "{}");
    } catch {
      parsed = {};
    }
    state = { v: jsonObject(parsed.v), t: jsonObject(parsed.t), f: jsonObject(parsed.f) };
    stateCache.set(player, state);
    return state;
  }

  function saveState(player) {
    player.setAttribute(STATE_ATTRIBUTE, JSON.stringify(stateOf(player)));
  }

  function vget(player, varbit) {
    return Number(stateOf(player).v[varbit]) | 0;
  }

  function vset(player, varbit, value) {
    stateOf(player).v[varbit] = value | 0;
    saveState(player);
    player.getPacketSender().sendVarbit(varbit, value | 0);
  }

  function flag(player, key) {
    return stateOf(player).f[key] === true;
  }

  function setFlag(player, key, value) {
    stateOf(player).f[key] = value === true;
    saveState(player);
  }

  function timerOf(player, key) {
    return Number(stateOf(player).t[key]) || 0;
  }

  function setTimer(player, key, value) {
    stateOf(player).t[key] = value;
    saveState(player);
  }

  function elapsedSince(player, key, ms) {
    const at = timerOf(player, key);
    return at > 0 && Date.now() - at >= ms;
  }

  function patchTimer(player, objectId) {
    const gp = stateOf(player).t.gp;
    return (gp && Number(gp[objectId])) || 0;
  }

  function setPatchTimer(player, objectId, value) {
    const state = stateOf(player);
    state.t.gp = jsonObject(state.t.gp);
    state.t.gp[objectId] = value;
    saveState(player);
  }

  function ctxOf(player) {
    return interaction.get(player) || {};
  }

  function setCtx(player, ctx) {
    interaction.set(player, ctx);
  }

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function stage(player) {
    return quest.getStage(player);
  }

  function inArea(location, area) {
    return location && location.x >= area.x1 && location.x <= area.x2 &&
      location.y >= area.y1 && location.y <= area.y2;
  }

  function wearing(player, itemId) {
    return player.getEquipment().get(Equipment.RING_SLOT)?.getId?.() === itemId;
  }

  function hasAnyCharos(player, { wore, inventory, bank }) {
    if (wore && (wearing(player, RING_OF_CHAROS) || wearing(player, RING_OF_CHAROS_A))) return true;
    if (inventory && (held(player, RING_OF_CHAROS) || held(player, RING_OF_CHAROS_A))) return true;
    if (bank) {
      for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
        const container = player.getBank(tab);
        if (container?.contains?.(RING_OF_CHAROS) || container?.contains?.(RING_OF_CHAROS_A)) return true;
      }
    }
    return false;
  }

  function hasRingEquippedOrHeld(player) {
    return hasAnyCharos(player, { wore: true, inventory: true, bank: false });
  }

  function hasCharosAnywhere(player) {
    return hasAnyCharos(player, { wore: true, inventory: true, bank: true });
  }

  function wearingCharosA(player) {
    return wearing(player, RING_OF_CHAROS_A);
  }

  function meetRequirements(player) {
    if (player.getSkillManager().getMaxLevel(Skill.FARMING) < 25) return false;
    const request = { player, key: "creature_of_fenkenstrain", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function activateRing(player) {
    const equipment = player.getEquipment();
    const equipped = equipment.get(Equipment.RING_SLOT);
    if (equipped?.getId?.() === RING_OF_CHAROS) {
      equipment.setItem(Equipment.RING_SLOT, new Item(RING_OF_CHAROS_A, 1));
      return;
    }
    if (equipped?.getId?.() === RING_OF_CHAROS_A) return;
    if (held(player, RING_OF_CHAROS)) {
      player.getInventory().deleteNumber(RING_OF_CHAROS, 1);
      player.getInventory().adds(RING_OF_CHAROS_A, 1);
      return;
    }
    if (held(player, RING_OF_CHAROS_A)) return;
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      const bank = player.getBank(tab);
      if (bank?.contains?.(RING_OF_CHAROS)) {
        bank.deleteNumber(RING_OF_CHAROS, 1);
        bank.adds(RING_OF_CHAROS_A, 1);
        return;
      }
      if (bank?.contains?.(RING_OF_CHAROS_A)) return;
    }
    player.getInventory().forceAdd(player, new Item(RING_OF_CHAROS_A, 1));
  }

  /** The four statuses of the potted white tree shoot. */
  function convertSapling(player) {
    if (timerOf(player, "sapling") > 0 && elapsedSince(player, "sapling", SAPLING_GROWTH_MS)) {
      setTimer(player, "sapling", 0);
      if (held(player, WHITE_TREE_SHOOT_WATERED)) {
        player.getInventory().deleteNumber(WHITE_TREE_SHOOT_WATERED, 1);
        player.getInventory().adds(WHITE_TREE_SAPLING, 1);
      }
    }
  }

  function hasWhiteTreeShoot(player) {
    for (const itemId of WHITE_TREE_SHOOT_ITEMS) if (held(player, itemId)) return true;
    return false;
  }

  function marigoldReady(player) {
    return elapsedSince(player, "elstan", MARIGOLD_GROWTH_MS) && held(player, MARIGOLDS);
  }

  function onionsGrown(player) {
    return elapsedSince(player, "lyra", CROP_GROWTH_MS);
  }

  function cabbagesGrown(player) {
    return elapsedSince(player, "kragen", CROP_GROWTH_MS);
  }

  function gardenPatchGrown(player, patch) {
    const at = patchTimer(player, patch.objectId);
    return at > 0 && Date.now() - at >= GARDEN_GROWTH_MS;
  }

  function unfinishedPatches(player) {
    return GARDEN_PATCHES.filter((patch) => !gardenPatchGrown(player, patch));
  }

  function statuesPlaced(player) {
    return vget(player, VARBIT_SARADOMIN_STATUE) >= 2 && vget(player, VARBIT_KING_STATUE) >= 2;
  }

  function hasList(player) {
    return held(player, LIST);
  }

  function refreshPatchObjects(player, objectId, tiles) {
    const sender = player.getPacketSender();
    for (const [x, y] of tiles) {
      const object = MapObjects.get(objectId, new Location(x, y, 0), player.getPrivateArea());
      if (!object) continue;
      sender.sendObjectRemoval(object);
      sender.sendObject(object);
    }
  }

  function refreshGrowth(player) {
    convertSapling(player);
    for (const patch of GARDEN_PATCHES) {
      if (!gardenPatchGrown(player, patch)) continue;
      if (vget(player, patch.varbit) >= 4 && vget(player, patch.varbit) < patch.grown) {
        vset(player, patch.varbit, patch.grown);
        refreshPatchObjects(player, patch.objectId, patch.tiles);
      }
    }
  }

  // ==========================================================================
  // NPC variant selection
  // ==========================================================================

  function ellamariaVariant(player) {
    const current = stage(player);
    if (current >= STAGE_COMPLETE) return "post-quest-dialogue-talking-to-queen-ellamaria";
    if (current >= STAGE_FETCH_ROALD) return "planting-the-seeds-talking-to-ellamaria-before-fetching-roald";
    if (current >= STAGE_BUILDING) {
      if (statuesPlaced(player)) return "planting-the-seeds-talking-to-ellamaria-after-planting-the-seeds";
      return "starting-off-talking-to-queen-ellamaria-again";
    }
    if (current >= STAGE_SENT_TO_WOM) return "starting-off-talking-to-queen-ellamaria-again";
    return "starting-off-talking-to-ellamaria";
  }

  function wiseOldManVariant(player) {
    const current = stage(player);
    // Post-quest the Wise Old Man belongs to other quests (Swan Song asks him for
    // runes at close range); yield like kingRoaldVariant so their pages play.
    if (current >= STAGE_COMPLETE) return null;
    if (current >= STAGE_BUILDING) {
      return "talking-to-the-wise-old-man-talking-to-the-wise-old-man-again-after-he-activates-the-ring-of-charos";
    }
    if (current >= STAGE_TEST_FAILED) {
      // The retake variant's wiki jump lost its target; NpcDialogues' same-branch
      // guard resolves it to "end" before the test, so a failed test retakes it
      // through the initial conversation, whose ring branch still reaches the test.
      return "talking-to-the-wise-old-man";
    }
    if (current >= STAGE_RING_WANTED) {
      // With the ring in hand the initial conversation's ring branch reaches the
      // diplomacy test directly, which is more reliable than the "bring the ring"
      // variant's lost-target jump; keep that variant only for fetching the ring.
      if (hasRingEquippedOrHeld(player)) return "talking-to-the-wise-old-man";
      return "talking-to-the-wise-old-man-talking-to-the-wise-old-man-again-after-being-told-to-bring-him-the-ring-of-charos";
    }
    if (current >= STAGE_SENT_TO_WOM) return "talking-to-the-wise-old-man";
    return null;
  }

  function kingRoaldVariant(player) {
    const current = stage(player);
    if (current >= STAGE_COMPLETE) return null;
    if (current < STAGE_FETCH_ROALD) return null;
    return flag(player, "roald") ? "the-garden-of-tranquillity" : "talking-to-king-roald";
  }

  function althricVariant(player) {
    if (stage(player) < STAGE_BUILDING) return null;
    if (stage(player) >= STAGE_COMPLETE) return null;
    if (vget(player, VARBIT_ALTHRIC) < 1) return "talking-to-brother-althric";
    setCtx(player, { kind: "althric-talk" });
    return "talking-to-brother-althric-talking-to-brother-althric-again";
  }

  function bernaldVariant(player) {
    if (stage(player) < STAGE_BUILDING) return null;
    const value = vget(player, VARBIT_BERNALD);
    if (value === 0 || value === 1) return "talking-to-bernald";
    if (value === 2) return "talking-to-bernald-talking-to-bernald-after-trying-to-cure-the-vines";
    if (value <= 4) return "talking-to-alain-talking-to-bernald-with-the-stronger-plant-cure";
    return "talking-to-alain-subsequent-dialogue-with-bernald";
  }

  function elstanVariant(player) {
    const value = vget(player, VARBIT_ELSTAN);
    if (value >= 4) return "talking-to-elstan-subsequent-dialogue-with-elstan";
    if (value >= 1) return "talking-to-elstan-talking-to-elstan-again";
    return "talking-to-elstan";
  }

  function lyraVariant(player) {
    const value = vget(player, VARBIT_LYRA);
    if (value >= 3) return "talking-to-lyra-subsequent-dialogue-with-lyra";
    if (value >= 1) return "talking-to-lyra-talking-to-lyra-again";
    return "talking-to-lyra";
  }

  function kragenVariant(player) {
    const value = vget(player, VARBIT_KRAGEN);
    if (stage(player) < STAGE_BUILDING) return null; // standard Kragen page
    if (value >= 3) return "talking-to-kragen-subsequent-dialogue-with-kragen";
    if (value >= 1) return "talking-to-kragen-talking-to-kragen-again";
    return "talking-to-kragen";
  }

  function dantaeraVariant(player) {
    const value = vget(player, VARBIT_DANTAERA);
    if (value >= 2) {
      if (hasWhiteTreeShoot(player)) return "talking-to-dantaera-getting-the-white-tree-shoot-talking-to-dantaera-again";
      if (vget(player, VARBIT_WHITE_TREE) < 4) return "talking-to-dantaera-getting-the-white-tree-shoot-talking-to-dantaera-again";
      return "talking-to-dantaera";
    }
    return "talking-to-dantaera";
  }

  /** The gardener Talk-to variant, shared by the index path and the direct claim. */
  function gardenerTalkVariant(player, npcId) {
    if (npcId === ELSTAN_NPC_ID) return elstanVariant(player);
    if (npcId === LYRA_NPC_ID) return lyraVariant(player);
    if (npcId === KRAGEN_NPC_ID) return kragenVariant(player);
    if (npcId === DANTAERA_NPC_ID) return dantaeraVariant(player);
    if (npcId === ALAIN_NPC_ID) return "talking-to-alain"; // Alain has no page of his own
    return null;
  }

  function selectVariant({ npcId, player }) {
    refreshGrowth(player);
    // A new Talk-to starts with no transient interaction context.
    interaction.delete(player);
    if (ELLAMARIA_NPC_IDS.has(npcId)) return ellamariaVariant(player);
    if (WISE_OLD_MAN_NPC_IDS.has(npcId)) return wiseOldManVariant(player);
    if (KING_ROALD_NPC_IDS.has(npcId)) return kingRoaldVariant(player);
    if (npcId === BERNALD_NPC_ID) return bernaldVariant(player);
    if (npcId === BROTHER_ALTHRIC_NPC_ID) return althricVariant(player);
    if (GARDENER_NPC_IDS.has(npcId)) return gardenerTalkVariant(player, npcId);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function evaluateCondition({ player, stepId }) {
    const state = stateOf(player);
    const ctx = ctxOf(player);
    const inventory = player.getInventory();
    const current = stage(player);
    switch (stepId) {
      // Start / Queen Ellamaria details.
      case "H6HCCk": return !meetRequirements(player);
      case "wUCFpU": return meetRequirements(player);
      case "wakmKJ": return inventory.isFull();
      case "Sgr3kt": return !inventory.isFull();
      case "1Jm_e8": return current >= STAGE_BUILDING && inventory.isFull();
      case "rPj9J0": return current >= STAGE_BUILDING && !inventory.isFull();
      case "cvWn-w": case "CEvbLN": return !hasList(player);
      case "gdOmTD": return !hasList(player) && inventory.isFull();
      case "XQepny": return !hasList(player) && !inventory.isFull();
      case "mdKMdt": return ctx.kind === "queen-use";
      case "QbWR-k": return ctx.kind === "inspect" && ctx.target === "south";
      case "ie_X6K": return ctx.kind === "inspect" && ctx.target === "north";
      case "ED_1a4": return ctx.kind === "inspect" && ctx.target === "east-pot";
      case "rR0Uxm": return ctx.kind === "inspect" && ctx.target === "west-pot";

      // Wise Old Man.
      case "IvLJx8": case "ykJrJ-": return hasAnyCharos(player, { wore: true, inventory: false, bank: false });
      case "15eFr0": case "HEQTi0": return hasAnyCharos(player, { wore: false, inventory: true, bank: false });
      case "vIsD1i": return !hasRingEquippedOrHeld(player) && hasAnyCharos(player, { wore: false, inventory: false, bank: true });
      case "vNPoP6": return !hasRingEquippedOrHeld(player) && !hasCharosAnywhere(player);
      case "IZc3nv": return !hasRingEquippedOrHeld(player);
      case "uIAHcH": case "KfmZlX": return hasRingEquippedOrHeld(player);
      case "RlKECi": return !hasCharosAnywhere(player);
      case "KSSVCU": return !hasRingEquippedOrHeld(player) && hasAnyCharos(player, { wore: false, inventory: false, bank: true });
      case "aNbCRo": return !hasCharosAnywhere(player);
      case "dz2FuV": return hasCharosAnywhere(player);
      case "INprox": return wearingCharosA(player);
      case "uBaVsz": return (Number(state.f.attempts) | 0) === 0;
      case "p6_fVN": return (Number(state.f.attempts) | 0) >= 1;

      // Elstan.
      case "PJG3SE": return !wearingCharosA(player);
      case "FE6n_t": return wearingCharosA(player);
      case "XHGLQ6": return held(player, MARIGOLDS);
      case "tv25x9": return !marigoldReady(player);
      case "SMBSOR": return marigoldReady(player);
      case "n0vCAB": return false;
      case "xx4rzY": return !held(player, DELPHINIUM_SEED);
      case "-GHnLE": return inventory.isFull();
      case "tr8vQ5": return !inventory.isFull();

      // Lyra.
      case "8f8ovQ": return !wearingCharosA(player);
      case "XaqLma": return wearingCharosA(player);
      case "ofpllR": return timerOf(player, "lyra") > 0 && !onionsGrown(player);
      case "gwlRoy": return onionsGrown(player);
      case "Y4dNZC": return inventory.isFull();
      case "NCs4Fo": return !inventory.isFull();
      case "Yi1jJz": return false;
      case "fPLMDi": return false;
      case "DCxr1x": return inventory.isFull();
      case "pafMtZ": return !inventory.isFull();

      // Kragen.
      case "0NoXjB": return !wearingCharosA(player);
      case "6vva1d": return wearingCharosA(player);
      case "RSBD4A": return !cabbagesGrown(player);
      case "jGaiJa": return cabbagesGrown(player);
      case "vE8Hfw": return inventory.isFull();
      case "oCcygL": return !inventory.isFull();
      case "Heut9r": return false;
      case "ZxgaO8": return false;
      case "747GEi": return inventory.isFull();
      case "VzVPy7": return !inventory.isFull();

      // Dantaera / white tree.
      case "5m3Bor": return !wearingCharosA(player);
      case "ciLJzE": return wearingCharosA(player);
      case "cjBRaq": return ctx.kind === "shoot" && ctx.result === "first";
      case "UWWBxf": return ctx.kind === "shoot" && ctx.result === "have";
      case "PZVJvu": return ctx.kind === "shoot" && ctx.result === "again";
      case "ewZkGk": return vget(player, VARBIT_DANTAERA) >= 2 && !hasWhiteTreeShoot(player);
      case "-O8CtU": return hasWhiteTreeShoot(player);

      // Brother Althric / the well.
      case "pg3jbd": return !wearingCharosA(player);
      case "zPDfLG": return wearingCharosA(player);
      case "HszfnZ": return ctx.kind === "althric-talk";
      case "fmSO5r": return ctx.kind === "althric-pick" && vget(player, VARBIT_RING_IN_WELL) !== 1;
      case "Ks4RFG": return ctx.kind === "althric-pick" && vget(player, VARBIT_RING_IN_WELL) === 1;
      case "mALSSB": return ctx.kind === "althric-well" && ctx.use === "ring" && vget(player, VARBIT_ALTHRIC) < 1;
      case "N0eqXG": return ctx.kind === "althric-well" && ctx.use === "ring" && vget(player, VARBIT_ALTHRIC) >= 1 && vget(player, VARBIT_RING_IN_WELL) !== 1;
      case "96Yxsb": return ctx.kind === "althric-well" && ctx.use === "rod" && (vget(player, VARBIT_ALTHRIC) < 1 || vget(player, VARBIT_RING_IN_WELL) !== 1);
      case "L-9bWw": return ctx.kind === "althric-well" && ctx.use === "oily";
      case "-T8hZe": return ctx.kind === "althric-well" && ctx.use === "rod" && vget(player, VARBIT_RING_IN_WELL) === 1;
      case "82BstK": return ctx.kind === "althric-well" && ctx.cast === true;
      case "r7-V0a": return ctx.kind === "althric-well" && ctx.cast === false;
      case "HAhsGB": return ctx.kind === "althric-pick" && ctx.bush === "red";
      case "Nj1EU9": return ctx.kind === "althric-pick" && ctx.bush === "white";
      case "RoQujd": return ctx.kind === "althric-pick" && ctx.bush === "pink";
      case "YRgczq": case "vKsv44": case "PIfUWk": return inventory.isFull();
      case "poFE0R": case "P5LnAu": case "GtAu9-": return !inventory.isFull();

      // Bernald / Alain.
      case "RV6jQC": return ctx.kind !== "bernald-cure" && !wearingCharosA(player);
      case "EjzGhc": return ctx.kind !== "bernald-cure" && wearingCharosA(player);
      case "7O53gr": return ctx.kind === "bernald-cure";
      case "UvOYOt": return ctx.kind === "bernald-strong";
      case "FGN0NU": return vget(player, VARBIT_BERNALD) === 4 && ctx.kind !== "bernald-strong";
      case "IdCT0T": return vget(player, VARBIT_BERNALD) !== 4 && ctx.kind !== "bernald-strong";
      case "ZyMUXw": case "MjQth1": return inventory.isFull();
      case "2SAIrr": case "VsX4SB": return !inventory.isFull();
      case "XWelxT": return !hasVineSeedsAnywhere(player);
      case "-_9mwd": return hasVineSeedsAnywhere(player);
      case "PBebcs": return ctx.kind === "alain" && ctx.craft === "pestle-essence";
      case "Ce3SnJ": return ctx.kind === "alain" && ctx.craft === "hammer";
      case "ixshUo": return ctx.kind === "alain" && ctx.craft === "shards";
      case "Pgl-Rj": return ctx.kind === "alain" && ctx.craft === "dust";

      // Planting the palace patches.
      case "6Ke5IK": return ctx.kind === "plant" && ctx.correct === true;
      case "A1V4Dc": return ctx.kind === "plant" && ctx.correct === false;
      case "biSWEe": return ctx.kind === "plant-water";
      case "QM3nkf": return ctx.kind === "plant-compost";
      case "2bZE3g": return ctx.kind === "plant-spade";
      case "UM_i91": return ctx.kind === "pot-soil";
      case "S5Y6LF": return ctx.kind === "pot-seeds-first";
      case "ZluqZI": return ctx.kind === "pot-wrong-seeds";

      // Ellamaria checks the garden.
      case "9jX7Nq": return unfinishedPatches(player).length >= 1;
      case "7BOj2X": return unfinishedPatches(player).length >= 2;
      case "e1a52L": return unfinishedPatches(player).length >= 3;
      case "sXknco": return unfinishedPatches(player).length >= 4;
      case "lroBLx": return unfinishedPatches(player).length >= 5;
      case "VfXvC_": return unfinishedPatches(player).length >= 6;
      case "QQDbw9": return unfinishedPatches(player).length >= 7;
      case "T738F6": return unfinishedPatches(player).length >= 8;
      case "dnJymy": return unfinishedPatches(player).length >= 9;
      case "yb-ee9": return unfinishedPatches(player).length === 0 && statuesPlaced(player);

      // Seeds used on Queen Ellamaria.
      case "coo4GB": return ctx.kind === "queen-seeds" && ctx.seed === "sapling";
      case "ubdQWM": return ctx.kind === "queen-seeds" && ctx.seed === "delphinium";
      case "_lru_g": return ctx.kind === "queen-seeds" && ctx.seed === "orchid";
      case "clXIIc": return ctx.kind === "queen-seeds" && ctx.seed === "vine";
      case "Fp6Zr0": return ctx.kind === "queen-seeds" && ctx.seed === "rose";
      case "zxpkbw": return ctx.kind === "queen-seeds" && ctx.seed === "snowdrop";

      // King Roald.
      case "lMEGU5": return !wearingCharosA(player);
      case "JNe-bm": return wearingCharosA(player);

      // Statues.
      case "NiHZvK": return ctx.kind === "statue" && ctx.site === "falador-north";
      case "fuPeOB": return ctx.kind === "statue" && ctx.site === "saradomin";
      case "7rSFk_": return ctx.kind === "statue" && ctx.site === "lumbridge-queen";
      case "TJBXD4": return ctx.kind === "statue" && ctx.site === "king";
      case "Ks_-Uj": case "l-NaJG": return ctx.kind === "statue-place" && ctx.result === "too-far";
      case "Pex-hM": case "Jif1m0": return ctx.kind === "statue-place" && ctx.result === "wrong";
      case "Q2yvmr": case "xxLtip": return ctx.kind === "statue-place" && ctx.result === "correct";

      default:
        return undefined;
    }
  }

  function hasVineSeedsAnywhere(player) {
    if (held(player, VINE_SEED)) return true;
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      if (player.getBank(tab)?.contains?.(VINE_SEED)) return true;
    }
    return false;
  }

  function answerCondition(event) {
    const answer = evaluateCondition(event);
    if (answer !== undefined) return answer;
    if (GARDEN_CONDITION_IDS.has(event.stepId)) return false;
    return null;
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !ELLAMARIA_NPC_IDS.has(npcId)) return;
    if (stage(player) === 0) quest.setStage(player, STAGE_SENT_TO_WOM);
  }

  function handleConditionEvent(event) {
    const { player, stepId } = event;
    if (!GARDEN_CONDITION_IDS.has(stepId)) return;
    const current = stage(player);
    switch (stepId) {
      case "IvLJx8": case "15eFr0": case "vIsD1i": case "vNPoP6":
        if (current === STAGE_SENT_TO_WOM) quest.setStage(player, STAGE_RING_WANTED);
        return;
      case "uBaVsz":
        stateOf(player).f.attempts = (Number(stateOf(player).f.attempts) | 0) + 1;
        saveState(player);
        if (current < STAGE_TEST_FAILED) quest.setStage(player, STAGE_TEST_FAILED);
        return;
      case "p6_fVN":
        activateRing(player);
        stateOf(player).f.attempts = Math.max(1, Number(stateOf(player).f.attempts) | 0);
        saveState(player);
        if (current < STAGE_BUILDING) quest.setStage(player, STAGE_BUILDING);
        return;
      case "zPDfLG":
        if (vget(player, VARBIT_ALTHRIC) < 1) vset(player, VARBIT_ALTHRIC, 1);
        return;
      case "N0eqXG": {
        const equipment = player.getEquipment();
        const equipped = equipment.get(Equipment.RING_SLOT);
        if (equipped?.getId?.() === RING_OF_CHAROS || equipped?.getId?.() === RING_OF_CHAROS_A) {
          equipment.setItem(Equipment.RING_SLOT, new Item(-1, 1));
        } else {
          for (const id of [RING_OF_CHAROS, RING_OF_CHAROS_A]) {
            if (held(player, id)) { player.getInventory().deleteNumber(id, 1); break; }
          }
        }
        vset(player, VARBIT_RING_IN_WELL, 1);
        if (vget(player, VARBIT_ALTHRIC) < 2) vset(player, VARBIT_ALTHRIC, 2);
        return;
      }
      case "82BstK":
        if (!held(player, RING_OF_CHAROS_A) && !wearing(player, RING_OF_CHAROS_A)) {
          // forceAdd drops the ring at the player's tile when the bag is full,
          // so the well state may clear only after delivery (inventory or ground).
          player.getInventory().forceAdd(player, new Item(RING_OF_CHAROS_A, 1));
        }
        vset(player, VARBIT_RING_IN_WELL, 0);
        if (vget(player, VARBIT_ALTHRIC) < 2) vset(player, VARBIT_ALTHRIC, 2);
        return;
      case "7O53gr":
        if (held(player, PLANT_CURE)) player.getInventory().deleteNumber(PLANT_CURE, 1);
        vset(player, VARBIT_BERNALD, 2);
        return;
      case "UvOYOt":
        if (held(player, STRONG_PLANT_CURE)) player.getInventory().deleteNumber(STRONG_PLANT_CURE, 1);
        vset(player, VARBIT_BERNALD, 4);
        refreshPatchObjects(player, BURTHORPE_VINES, BURTHORPE_VINE_TILES);
        return;
      case "cjBRaq":
        vset(player, VARBIT_DANTAERA, 2);
        return;
      case "PZVJvu":
        if (!hasWhiteTreeShoot(player)) player.getInventory().adds(WHITE_TREE_SHOOT, 1);
        vset(player, VARBIT_DANTAERA, 2);
        return;
      case "yb-ee9":
        if (current < STAGE_FETCH_ROALD) quest.setStage(player, STAGE_FETCH_ROALD);
        return;
      case "Q2yvmr":
        placeStatueFor(player, STATUE_SARADOMIN);
        return;
      case "xxLtip":
        placeStatueFor(player, STATUE_KING);
        return;
      default:
        void current;
        return;
    }
  }

  function handleDialogueChoice({ player, npcId, option }) {
    const text = String(option ?? "").toLowerCase();
    if (npcId === BERNALD_NPC_ID && text.includes("i accept the deal")) {
      if (vget(player, VARBIT_BERNALD) === 0) vset(player, VARBIT_BERNALD, 1);
      return;
    }
    if (npcId === ALAIN_NPC_ID && text.includes("nothing you can suggest")) {
      if (vget(player, VARBIT_BERNALD) === 2) vset(player, VARBIT_BERNALD, 3);
      return;
    }
    if (npcId === ELSTAN_NPC_ID && text.includes("grow you some marigolds")) {
      if (vget(player, VARBIT_ELSTAN) === 0) vset(player, VARBIT_ELSTAN, 1);
      return;
    }
    if (npcId === LYRA_NPC_ID && text.includes("grow a patch of onions")) {
      if (vget(player, VARBIT_LYRA) === 0) vset(player, VARBIT_LYRA, 1);
      return;
    }
    if (npcId === KRAGEN_NPC_ID && text.includes("cabbages are ready")) {
      if (vget(player, VARBIT_KRAGEN) === 0) vset(player, VARBIT_KRAGEN, 1);
      return;
    }
    if (npcId === DANTAERA_NPC_ID && text.includes("she will die anyway")) {
      if (vget(player, VARBIT_DANTAERA) === 0) vset(player, VARBIT_DANTAERA, 1);
      return;
    }
    if (KING_ROALD_NPC_IDS.has(npcId) && text.includes("the queen asked me to bring you")) {
      setFlag(player, "roald", true);
    }
  }

  const PLANT_NAME_LINE = /\[plant name\]/;

  /** Fills the wiki's bracketed blanks with the player's actual state. */
  function fillPlaceholders(player, raw) {
    let text = String(raw ?? "");
    if (PLANT_NAME_LINE.test(text)) {
      const names = unfinishedPatches(player).map((patch) => patch.label);
      const label = names.length <= 1
        ? (names[0] ?? "the plants")
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      text = text
        .replace(PLANT_NAME_LINE, label)
        .replace(/\[hasn't\/haven't\]/, names.length <= 1 ? "hasn't" : "haven't");
    }
    if (text.includes("[3-4] seeds")) text = text.replace("[3-4]", "4");
    if (text.includes("[grapevine/delphinium/snowdrop/[white/red/yellow] rosebush/white tree]")) {
      const ctx = ctxOf(player);
      const planted = GARDEN_PATCHES.find((patch) => patch.key === ctx.patchKey)
        ?? GARDEN_PATCHES.find((patch) => patchTimer(player, patch.objectId) > 0);
      text = text.replace(
        "[grapevine/delphinium/snowdrop/[white/red/yellow] rosebush/white tree]",
        planted ? planted.label.replace(/^the /, "") : "plant"
      );
    }
    if (text.includes("[red/white/yellow] rosebush")) text = text.replace(/\[red\/white\/yellow\]/g, "rose");
    if (text.includes("[rune/pure essence]")) text = text.replace("[rune/pure essence]", "rune essence");
    if (text.includes("[rune/pure]")) text = text.replace(/\[rune\/pure\]/g, "rune");
    return text;
  }

  function handleDialogueLine(event) {
    event.text = fillPlaceholders(event.player, event.text);
  }

  // ==========================================================================
  // Dialogue actions (receives, cutscene text, completion)
  // ==========================================================================

  function handleAction(event) {
    const { player, stepId, kind } = event;
    if (kind === "message" && event.step) {
      event.step.text = fillPlaceholders(player, event.step.text);
    }
    if (SPOKEN_ACTION_IDS.has(stepId)) {
      event.handled = true;
      if (event.text) player.sendMessage(String(event.text));
      return;
    }
    if (SILENT_ACTION_IDS.has(stepId)) {
      event.handled = true;
      return;
    }
    switch (stepId) {
      case "m-VVpe":
        event.handled = true;
        if (!hasList(player)) player.getInventory().adds(LIST, 1);
        if (stage(player) === 0) quest.setStage(player, STAGE_SENT_TO_WOM);
        return;
      case "uPDn0-": case "tvi1Yf":
        event.handled = true;
        if (!hasList(player)) player.getInventory().adds(LIST, 1);
        return;
      case "16ihMw":
        event.handled = true;
        if (!held(player, TROLLEY)) player.getInventory().adds(TROLLEY, 1);
        setFlag(player, "trolley", true);
        return;
      case "StZldH": case "jkEsoU":
        event.handled = true;
        player.getInventory().adds(DELPHINIUM_SEED, 4);
        if (held(player, MARIGOLDS)) player.getInventory().deleteNumber(MARIGOLDS, 1);
        vset(player, VARBIT_ELSTAN, 4);
        return;
      case "Raq_4r":
        event.handled = true;
        player.getInventory().adds(DELPHINIUM_SEED, 4);
        return;
      case "_FjB0S": case "8xsMcL":
        event.handled = true;
        player.getInventory().adds(ORCHID_PINK_SEED, 3);
        player.getInventory().adds(ORCHID_YELLOW_SEED, 3);
        vset(player, VARBIT_LYRA, 3);
        return;
      case "b3RCCp": case "G67zgV":
        event.handled = true;
        player.getInventory().adds(SNOWDROP_SEED, 4);
        vset(player, VARBIT_KRAGEN, 3);
        return;
      case "TJjHns": {
        event.handled = true;
        const ctx = ctxOf(player);
        const essence = ctx.essence === PURE_ESSENCE ? PURE_ESSENCE : RUNE_ESSENCE;
        if (held(player, essence)) player.getInventory().deleteNumber(essence, 1);
        player.getInventory().adds(RUNE_SHARDS, 1);
        return;
      }
      case "1bplqz":
        event.handled = true;
        if (held(player, RUNE_SHARDS)) player.getInventory().deleteNumber(RUNE_SHARDS, 1);
        player.getInventory().adds(RUNE_DUST, 1);
        return;
      case "yUlUJi":
        event.handled = true;
        if (held(player, RUNE_DUST)) player.getInventory().deleteNumber(RUNE_DUST, 1);
        if (held(player, PLANT_CURE)) player.getInventory().deleteNumber(PLANT_CURE, 1);
        player.getInventory().adds(STRONG_PLANT_CURE, 1);
        return;
      case "i06M8V": case "WFJQ9O":
        event.handled = true;
        player.getInventory().adds(VINE_SEED, 4);
        vset(player, VARBIT_BERNALD, 5);
        return;
      case "qr_hUI":
        event.handled = true;
        if (!hasWhiteTreeShoot(player)) player.getInventory().adds(WHITE_TREE_SHOOT, 1);
        vset(player, VARBIT_DANTAERA, 2);
        return;
      case "eMqaFw":
        event.handled = true;
        player.getInventory().adds(ROSE_RED_SEED, 4);
        vset(player, VARBIT_ROSE_RED, 4);
        return;
      case "3mb09S":
        event.handled = true;
        player.getInventory().adds(ROSE_WHITE_SEED, 4);
        vset(player, VARBIT_ROSE_WHITE, 4);
        return;
      case "eYOoGS":
        event.handled = true;
        player.getInventory().adds(ROSE_PINK_SEED, 4);
        vset(player, VARBIT_ROSE_PINK, 4);
        return;
      case "UV3jly":
        event.handled = true; // the trolley is handed back in placeStatueFor
        return;
      case "JSUqhR":
        event.handled = true; // complete() sends the same line once
        return;
      case "SqRZd7":
        event.handled = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        void kind;
        return;
    }
  }

  // ==========================================================================
  // Trolley and statues
  // ==========================================================================

  function removeTrolley(player) {
    const npc = trolleys.get(player);
    if (npc) api.removeNpc(npc);
    trolleys.delete(player);
  }

  function spawnTrolley(player, x, y) {
    removeTrolley(player);
    const npc = api.spawnNpc({
      id: GARDEN_TROLLEY_MULTI_NPC,
      x,
      y,
      z: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) trolleys.set(player, npc);
    return npc;
  }

  function moveTrolley(player, npc, action) {
    const playerLocation = player.getLocation();
    const trolleyLocation = npc?.getLocation?.();
    if (!playerLocation || !trolleyLocation) return;
    const deltaX = trolleyLocation.getX() - playerLocation.getX();
    const deltaY = trolleyLocation.getY() - playerLocation.getY();
    let dx = Math.abs(deltaX) >= Math.abs(deltaY) ? Math.sign(deltaX) : 0;
    let dy = dx === 0 ? Math.sign(deltaY) : 0;
    if (action === "pull") {
      dx = -dx;
      dy = -dy;
    }
    if (dx === 0 && dy === 0) return;
    const distance = action === "big-push" ? 4 : 1;
    const movement = npc.getMovementQueue();
    movement.reset();
    const size = npc.getSize?.() ?? 1;
    const privateArea = npc.getPrivateArea?.() ?? player.getPrivateArea?.() ?? null;
    let from = trolleyLocation;
    for (let step = 0; step < distance; step++) {
      const to = new Location(from.getX() + dx, from.getY() + dy, from.getZ());
      if (!RegionManager.canMovestart(from, to, size, size, privateArea)) {
        player.sendMessage("The trolley is blocked in that direction.");
        return;
      }
      from = to;
    }
    movement.addSteps(from);
  }

  function placeStatueFor(player, site) {
    const cargo = site === STATUE_SARADOMIN ? 1 : 2;
    if (vget(player, VARBIT_TROLLEY) !== cargo) return;
    vset(player, site.varbit, 2);
    vset(player, VARBIT_TROLLEY, 0);
    refreshPatchObjects(player, site.plinthObject, [[site.plinth.x, site.plinth.y]]);
    removeTrolley(player);
    if (!held(player, TROLLEY)) player.getInventory().adds(TROLLEY, 1);
  }

  function handleNpcInteraction(event) {
    const { player, npcId, npc } = event;
    const click = Number(event.clickType) | 0;
    const option = String(event.definition?.getActions?.()?.[click - 1] ?? "").toLowerCase();

    if (TROLLEY_CONTENT_IDS.has(npcId)) {
      const cargo = vget(player, VARBIT_TROLLEY);
      if (cargo === 0) return;
      if (["push", "pull", "big-push"].includes(option)) {
        event.handled = true;
        moveTrolley(player, npc, option);
        return;
      }
      if (option !== "place") return;
      event.handled = true;
      // Placement is handled directly: the Saradomin variant nests its place
      // conditions after an END step inside the "-McVRu" branch, so the
      // transcript can never reach them.
      const site = STATUE_BY_VARBIT.get(cargo);
      if (!site) return;
      const location = npc.getLocation();
      const distance = (target) =>
        Math.max(Math.abs(location.getX() - target.x), Math.abs(location.getY() - target.y));
      if (distance(site.plinth) > 1) {
        const other = site === STATUE_SARADOMIN ? STATUE_KING : STATUE_SARADOMIN;
        player.sendMessage(distance(other.plinth) <= 1
          ? "This statue needs to go on the other plinth."
          : "You need to move the trolley next to a plinth before you can place the statue - it's too heavy to carry very far.");
        return;
      }
      placeStatueFor(player, site);
      player.sendMessage(site === STATUE_SARADOMIN
        ? "You place the state of Saradomin on the plinth."
        : "You place the statue of the king on a plinth.");
      return;
    }

    // The Farming service claims Talk-to for every pay-gardener near a patch
    // (Elstan, Lyra, Kragen, Dantaera and Alain all advertise Pay), so during
    // the garden phase this quest takes the conversation first; before then the
    // hook falls through so the farming service still owns them for everyone
    // else.
    if (option !== "talk-to" || !GARDENER_NPC_IDS.has(npcId)) return;
    if (stage(player) < STAGE_BUILDING) return;
    const variant = gardenerTalkVariant(player, npcId);
    if (!variant) return;
    event.handled = true;
    interaction.delete(player);
    refreshGrowth(player);
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function handleUseTrolleyOnStatue(event, site) {
    const { player } = event;
    event.handled = true;
    if (stage(player) < STAGE_BUILDING) return;
    if (vget(player, site.varbit) !== 0) return;
    if (!held(player, TROLLEY)) return;
    player.getInventory().deleteNumber(TROLLEY, 1);
    vset(player, site.varbit, 1);
    vset(player, VARBIT_TROLLEY, site === STATUE_SARADOMIN ? 1 : 2);
    refreshPatchObjects(player, site.sourceObject, [[site.objectTile.x, site.objectTile.y]]);
    spawnTrolley(player, site.source.x, site.source.y);
    setCtx(player, { kind: "statue", site: site === STATUE_SARADOMIN ? "saradomin" : "king" });
    startTranscript(api, player, CUTSCENE_NPC_ID, PAGE, site.useVariant);
  }

  // ==========================================================================
  // Item on object
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    convertSapling(player);
    if (itemId === TROLLEY) {
      if (objectId === FALADOR_STATUE) return handleUseTrolleyOnStatue(event, STATUE_SARADOMIN);
      if (objectId === LUMBRIDGE_STATUE) return handleUseTrolleyOnStatue(event, STATUE_KING);
      return;
    }
    if (objectId === ICE_MOUNTAIN_WHITE_TREE) return cutWhiteTreeShoot(event);
    if (objectId === BURTHORPE_VINES && inArea(location, BURTHORPE_VINE_AREA)) {
      return useItemOnVines(event);
    }
    if (objectId === EDGEVILLE_WELL && inArea(location, EDGEVILLE_WELL_AREA)) {
      return useItemOnWell(event);
    }
    const patch = GARDEN_PATCH_BY_OBJECT.get(objectId);
    if (patch) return useItemOnGardenPatch(event, patch);
    // The three gardener crop tasks run on real Farming patches: record the
    // planting so the gardener conversations know it happened, and let the
    // Farming plugin do the actual planting.
    if (itemId === MARIGOLD_SEED && inArea(location, ELSTAN_PATCH_AREA)) {
      if (stage(player) >= STAGE_BUILDING && timerOf(player, "elstan") === 0) setTimer(player, "elstan", Date.now());
      return;
    }
    if (itemId === ONION_SEED && inArea(location, LYRA_PATCH_AREA)) {
      if (stage(player) >= STAGE_BUILDING && timerOf(player, "lyra") === 0) setTimer(player, "lyra", Date.now());
      if (stage(player) >= STAGE_BUILDING) {
        vset(player, VARBIT_LYRA_PATCH_WEST, 1);
        vset(player, VARBIT_LYRA_PATCH_EAST, 1);
      }
      return;
    }
    if (itemId === CABBAGE_SEED && inArea(location, KRAGEN_PATCH_AREA)) {
      if (stage(player) >= STAGE_BUILDING && timerOf(player, "kragen") === 0) setTimer(player, "kragen", Date.now());
      if (stage(player) >= STAGE_BUILDING) {
        vset(player, VARBIT_KRAGEN_PATCH_NORTH, 1);
        vset(player, VARBIT_KRAGEN_PATCH_SOUTH, 1);
        vset(player, VARBIT_CABBAGE_PATCH_NORTH, 1);
        vset(player, VARBIT_CABBAGE_PATCH_SOUTH, 1);
      }
      return;
    }
  }

  function showPlantingStep(player, kind) {
    setCtx(player, { kind });
    startTranscript(api, player, NpcIdentifiers.QUEEN_ELLAMARIA, PAGE, "planting-the-seeds");
  }

  function useItemOnGardenPatch(event, patch) {
    const { player, itemId } = event;
    event.handled = true;
    if (stage(player) < STAGE_BUILDING) return;

    if (patch.objectId === ORCHID_POT_PINK || patch.objectId === ORCHID_POT_YELLOW) {
      const expected = patch.objectId === ORCHID_POT_PINK ? ORCHID_PINK_SEED : ORCHID_YELLOW_SEED;
      const other = patch.objectId === ORCHID_POT_PINK ? ORCHID_YELLOW_SEED : ORCHID_PINK_SEED;
      if (COMPOSTS.has(itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        player.getInventory().adds(BUCKET, 1);
        vset(player, patch.varbit, 1);
        refreshPatchObjects(player, patch.objectId, patch.tiles);
        player.sendMessage("You fill the plantpot with compost.");
        return;
      }
      if (itemId === FILLED_PLANT_POT) return showPlantingStep(player, "pot-soil");
      if (itemId === other) return showPlantingStep(player, "pot-wrong-seeds");
      if (itemId === expected) {
        if (vget(player, patch.varbit) < 1) return showPlantingStep(player, "pot-seeds-first");
        return plantGardenPatch(player, patch);
      }
      return;
    }
    if (WATERING_CANS.has(itemId)) return showPlantingStep(player, "plant-water");
    if (COMPOSTS.has(itemId)) return showPlantingStep(player, "plant-compost");
    if (itemId === ItemIdentifiers.SPADE) return showPlantingStep(player, "plant-spade");
    if (itemId === patch.seed) return plantGardenPatch(player, patch);
    // The watered shoot turns into the sapling on the next item-on-object use;
    // the click still carries the watered id, so accept it once the conversion ran.
    if (patch.seed === WHITE_TREE_SAPLING && itemId === WHITE_TREE_SHOOT_WATERED &&
        held(player, WHITE_TREE_SAPLING)) {
      return plantGardenPatch(player, patch);
    }
  }

  function plantGardenPatch(player, patch) {
    const planted = patch.planted ?? 4;
    if (vget(player, patch.varbit) >= planted) return;
    if (!held(player, patch.seed)) return;
    player.getInventory().deleteNumber(patch.seed, 1);
    setPatchTimer(player, patch.objectId, Date.now());
    vset(player, patch.varbit, planted);
    refreshPatchObjects(player, patch.objectId, patch.tiles);
    setCtx(player, { kind: "plant", correct: true, patchKey: patch.key });
    startTranscript(api, player, NpcIdentifiers.QUEEN_ELLAMARIA, PAGE, "planting-the-seeds");
  }

  function useItemOnVines(event) {
    const { player, itemId } = event;
    const value = vget(player, VARBIT_BERNALD);
    if (itemId === PLANT_CURE && value === 1) {
      event.handled = true;
      setCtx(player, { kind: "bernald-cure" });
      startTranscript(api, player, BERNALD_NPC_ID, PAGE, "talking-to-bernald");
      return;
    }
    if (itemId === STRONG_PLANT_CURE && value >= 3 && value < 5) {
      event.handled = true;
      setCtx(player, { kind: "bernald-strong" });
      startTranscript(api, player, BERNALD_NPC_ID, PAGE, "talking-to-alain-talking-to-bernald-with-the-stronger-plant-cure");
    }
  }

  function cutWhiteTreeShoot(event) {
    const { player, itemId } = event;
    if (!SECATEURS_ITEMS.has(itemId)) return;
    if (stage(player) < STAGE_BUILDING) return;
    event.handled = true;
    const value = vget(player, VARBIT_DANTAERA);
    let result = "first";
    if (value >= 2) result = hasWhiteTreeShoot(player) ? "have" : "again";
    setCtx(player, { kind: "shoot", result });
    startTranscript(api, player, DANTAERA_NPC_ID, PAGE, "talking-to-dantaera-getting-the-white-tree-shoot");
  }

  function useItemOnWell(event) {
    const { player, itemId } = event;
    if (itemId === RING_OF_CHAROS || itemId === RING_OF_CHAROS_A) {
      event.handled = true;
      setCtx(player, { kind: "althric-well", use: "ring" });
    } else if (FISHING_RODS.has(itemId)) {
      event.handled = true;
      const success = vget(player, VARBIT_RING_IN_WELL) === 1 && Math.random() < 0.5;
      setCtx(player, { kind: "althric-well", use: "rod", cast: success });
    } else if (itemId === OILY_FISHING_ROD) {
      event.handled = true;
      setCtx(player, { kind: "althric-well", use: "oily" });
    } else {
      return;
    }
    startTranscript(api, player, BROTHER_ALTHRIC_NPC_ID, PAGE, "talking-to-brother-althric-the-edgeville-well");
  }

  // ==========================================================================
  // Item on item
  // ==========================================================================

  function craftPair(player, craft, essence) {
    setCtx(player, { kind: "alain", craft, essence });
    startTranscript(api, player, ALAIN_NPC_ID, PAGE, "talking-to-alain-making-a-stronger-plant-cure");
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    const isPair = (a, b) => pair.has(a) && pair.has(b) && usedItemId !== usedWithItemId;

    if (isPair(PESTLE_AND_MORTAR, RUNE_ESSENCE) || isPair(PESTLE_AND_MORTAR, PURE_ESSENCE)) {
      event.handled = true;
      craftPair(player, "pestle-essence", pair.has(PURE_ESSENCE) ? PURE_ESSENCE : RUNE_ESSENCE);
      return;
    }
    if (isPair(HAMMER, RUNE_ESSENCE) || isPair(HAMMER, PURE_ESSENCE)) {
      event.handled = true;
      craftPair(player, "hammer", pair.has(PURE_ESSENCE) ? PURE_ESSENCE : RUNE_ESSENCE);
      return;
    }
    if (isPair(PESTLE_AND_MORTAR, RUNE_SHARDS)) {
      event.handled = true;
      craftPair(player, "shards", null);
      return;
    }
    if (isPair(RUNE_DUST, PLANT_CURE)) {
      event.handled = true;
      craftPair(player, "dust", null);
      return;
    }
    if (isPair(WHITE_TREE_SHOOT, FILLED_PLANT_POT)) {
      event.handled = true;
      player.getInventory().deleteNumber(WHITE_TREE_SHOOT, 1);
      player.getInventory().deleteNumber(FILLED_PLANT_POT, 1);
      player.getInventory().adds(WHITE_TREE_SHOOT_POTTED, 1);
      return;
    }
    const waterOnShoot =
      (usedItemId === WHITE_TREE_SHOOT_POTTED && WATERING_CANS.has(usedWithItemId)) ||
      (usedWithItemId === WHITE_TREE_SHOOT_POTTED && WATERING_CANS.has(usedItemId));
    if (waterOnShoot) {
      event.handled = true;
      player.getInventory().deleteNumber(WHITE_TREE_SHOOT_POTTED, 1);
      player.getInventory().adds(WHITE_TREE_SHOOT_WATERED, 1);
      setTimer(player, "sapling", Date.now());
      return;
    }
  }

  // ==========================================================================
  // Item on NPC
  // ==========================================================================

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!ELLAMARIA_NPC_IDS.has(npcId)) return;
    if (itemId === LIST || itemId === TROLLEY) {
      event.handled = true;
      setCtx(player, { kind: "queen-use" });
      startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-queen-ellamaria-again");
      return;
    }
    let seed;
    if (itemId === WHITE_TREE_SAPLING) seed = "sapling";
    else if (itemId === DELPHINIUM_SEED) seed = "delphinium";
    else if (itemId === ORCHID_PINK_SEED || itemId === ORCHID_YELLOW_SEED) seed = "orchid";
    else if (itemId === VINE_SEED) seed = "vine";
    else if (itemId === ROSE_WHITE_SEED || itemId === ROSE_RED_SEED || itemId === ROSE_PINK_SEED) seed = "rose";
    else if (itemId === SNOWDROP_SEED) seed = "snowdrop";
    else return;
    event.handled = true;
    setCtx(player, { kind: "queen-seeds", seed });
    startTranscript(api, player, npcId, PAGE, "talking-to-ellamaria-with-the-seeds");
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player, objectId, clickType } = event;
    const option = String(event.definition?.getInteractions?.()?.[clickType - 1] ?? "").toLowerCase();
    if (objectId === GARDEN_SARADOMIN_STATUE || objectId === GARDEN_KING_STATUE) {
      if (option !== "inspect") return;
      event.handled = true;
      setCtx(player, { kind: "inspect", target: objectId === GARDEN_SARADOMIN_STATUE ? "south" : "north" });
      startTranscript(api, player, NpcIdentifiers.QUEEN_ELLAMARIA, PAGE, "starting-off-inspecting-the-statue-plinth");
      return;
    }
    if (objectId === ORCHID_POT_PINK || objectId === ORCHID_POT_YELLOW) {
      if (option !== "inspect") return;
      event.handled = true;
      setCtx(player, { kind: "inspect", target: objectId === ORCHID_POT_YELLOW ? "east-pot" : "west-pot" });
      startTranscript(api, player, NpcIdentifiers.QUEEN_ELLAMARIA, PAGE, "starting-off-inspecting-the-plantpots");
      return;
    }
    if (objectId === ROSES_RED || objectId === ROSES_PINK || objectId === ROSES_WHITE) {
      if (option !== "take-seed") return;
      event.handled = true;
      pickRoseSeeds(player, objectId);
    }
  }

  function pickRoseSeeds(player, objectId) {
    if (stage(player) < STAGE_BUILDING) return;
    const bush = objectId === ROSES_RED ? "red" : objectId === ROSES_PINK ? "pink" : "white";
    if (vget(player, VARBIT_RING_IN_WELL) !== 1) {
      setCtx(player, { kind: "althric-pick" });
      startTranscript(api, player, BROTHER_ALTHRIC_NPC_ID, PAGE, "talking-to-brother-althric-talking-to-brother-althric-again");
      return;
    }
    setCtx(player, { kind: "althric-pick", bush });
    startTranscript(
      api,
      player,
      BROTHER_ALTHRIC_NPC_ID,
      PAGE,
      "talking-to-brother-althric-talking-to-brother-althric-again-taking-seeds-from-the-roses"
    );
  }

  // ==========================================================================
  // Login / timing
  // ==========================================================================

  function sendSubVarbits(player) {
    const sender = player.getPacketSender();
    for (const [id, value] of Object.entries(stateOf(player).v)) {
      const numeric = Number(id);
      if (Number.isFinite(numeric) && (value | 0) !== 0) sender.sendVarbit(numeric, value | 0);
    }
  }

  function handleLogin({ player }) {
    removeTrolley(player);
    refreshGrowth(player);
    const cargo = vget(player, VARBIT_TROLLEY);
    if (cargo !== 0) {
      const site = STATUE_BY_VARBIT.get(cargo);
      if (site) {
        // The Wiki says logging out resets an unfinished statue haul; Ellamaria
        // can issue a replacement trolley through the existing receipt action.
        vset(player, site.varbit, 0);
        vset(player, VARBIT_TROLLEY, 0);
        refreshPatchObjects(player, site.sourceObject, [[site.objectTile.x, site.objectTile.y]]);
      }
    }
    sendSubVarbits(player);
    refreshQuestList(player);
  }

  /** The login bootstrap can clobber varps (553/554) that carry the sub-varbits. */
  function handleBootstrap({ player }) {
    sendSubVarbits(player);
    refreshGrowth(player);
  }

  function handleLogout({ player }) {
    removeTrolley(player);
    stateCache.delete(player);
    interaction.delete(player);
  }

  function handleAdvanceTime(event) {
    const { player, ms } = event;
    if (!player || !Number.isFinite(ms) || ms <= 0) return;
    const state = stateOf(player);
    let moved = false;
    const shift = (timers) => {
      for (const key of Object.keys(timers)) {
        const value = Number(timers[key]) || 0;
        if (value > 0) {
          timers[key] = Math.max(1, value - ms);
          moved = true;
        }
      }
    };
    shift(state.t);
    if (state.t.gp && typeof state.t.gp === "object") shift(state.t.gp);
    if (!moved) return;
    saveState(player);
    refreshGrowth(player);
    if (Array.isArray(event.handledBy)) event.handledBy.push("GardenOfTranquillity");
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function taskLine(done, open, closed) {
    return done ? `<str>${closed}</str>` : open;
  }

  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    if (current >= STAGE_COMPLETE) {
      return [
        "<str>Queen Ellamaria asked me to build a garden of tranquillity in</str>",
        "<str>the garden of Varrock Palace.</str>",
        "<str>I gathered the plants and moved the two statues, and King Roald</str>",
        "<str>was delighted (after the Queen insisted).</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (current >= STAGE_FETCH_ROALD) {
      return [
        "<str>Queen Ellamaria asked me to build a garden of tranquillity in</str>",
        "<str>the garden of Varrock Palace.</str>",
        "",
        "I should bring <col=800000>King Roald</col> to see the finished garden.",
      ];
    }
    if (current >= STAGE_BUILDING) {
      const lines = [
        "<str>The Wise Old Man activated my Ring of Charos.</str>",
        "",
        "I need to help the gardeners, plant the palace patches and move",
        "the two statues into the garden:",
        taskLine(vget(player, VARBIT_ELSTAN) >= 4, "I still need to grow marigolds for Elstan.", "I have Elstan's delphinium seeds."),
        taskLine(vget(player, VARBIT_LYRA) >= 3, "I still need to grow onions for Lyra.", "I have Lyra's orchid seeds."),
        taskLine(vget(player, VARBIT_KRAGEN) >= 3, "I still need to grow cabbages for Kragen.", "I have Kragen's snowdrop seeds."),
        taskLine(vget(player, VARBIT_DANTAERA) >= 2, "I need a shoot from the White Tree.", "I have the White Tree shoot."),
        taskLine(vget(player, VARBIT_ALTHRIC) >= 2, "I need rose seeds from Brother Althric.", "I have the rose seeds."),
        taskLine(vget(player, VARBIT_BERNALD) >= 5, "I need to cure Bernald's vines.", "I have the Burthorpe vine seeds."),
        taskLine(statuesPlaced(player), "I still need to move the two statues to the garden.", "Both statues stand in the garden."),
      ];
      const notPlanted = GARDEN_PATCHES.filter((patch) => patchTimer(player, patch.objectId) === 0);
      if (notPlanted.length) {
        lines.push(taskLine(false, "I still need to plant the seed patches.", ""));
      } else {
        lines.push(taskLine(unfinishedPatches(player).length === 0, "The seed patches are still growing.", "All the palace plants are fully grown."));
      }
      return lines;
    }
    if (current >= STAGE_TEST_FAILED) {
      return [
        "<str>Queen Ellamaria sent me to the Wise Old Man to learn persuasion.</str>",
        "",
        "I failed his diplomacy test. I should talk to him again to retake it.",
      ];
    }
    if (current >= STAGE_RING_WANTED) {
      return [
        "<str>Queen Ellamaria sent me to the Wise Old Man to learn persuasion.</str>",
        "",
        "He wants to see the <col=800000>Ring of Charos</col> before he will help me.",
      ];
    }
    if (current >= STAGE_SENT_TO_WOM) {
      return [
        "<str>Queen Ellamaria gave me a list of the plants she wants growing</str>",
        "<str>in her new garden.</str>",
        "",
        "I should ask the <col=800000>Wise Old Man</col> in Draynor Village",
        "about diplomacy and persuasion.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Queen Ellamaria</col>",
      "in the garden of <col=800000>Varrock Palace</col>.",
      "",
      "I need level 25 Farming and to have completed <col=800000>Creature of</col>",
      "<col=800000>Fenkenstrain</col>.",
    ];
  }

  function grantReward(player) {
    activateRing(player);
    player.getSkillManager().addExperiences(Skill.FARMING, 5000);
    const inventory = player.getInventory();
    inventory.forceAdd(player, new Item(ACORN, 1));
    inventory.forceAdd(player, new Item(APPLE_TREE_SEED, 1));
    inventory.forceAdd(player, new Item(GUAM_SEED, 5));
    inventory.forceAdd(player, new Item(COMPOST_POTION_4, 1));
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(STATE_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "garden_of_tranquillity",
    name: "Garden of Tranquillity",
    varpId: VARP_GARDEN,
    varbitId: VARBIT_GARDEN_QUEST,
    startedValue: STAGE_SENT_TO_WOM,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.FARMING.getIndex(), amount: 5000, label: "Farming" }],
    otherRewards: [
      "The Ring of Charos(a) (the same ring, activated)",
      "An acorn",
      "An apple tree seed",
      "5 Guam seeds",
      "Compost potion(4)",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleConditionEvent);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onCustomEvent("agent:advance-time", handleAdvanceTime);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
