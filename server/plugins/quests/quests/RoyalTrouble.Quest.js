/**
 * Royal Trouble (members). The sequel to Throne of Miscellania.
 *
 * The words come from the "Royal Trouble" transcript page; this plugin supplies
 * the variant selector for King Vargas, Queen Sigrid, Prince Brand, Princess
 * Astrid, Advisor Ghrim, the Miscellanian workers, the Etceterian citizens, the
 * Sailor, the dungeon guard and the Etceterian hole guard, the start hook, the
 * theft investigation, the dungeon access/scroll, the lift repair, the burnt
 * diary, the meddling kids, the Giant Sea Snake, the heavy box/letter hand-ins
 * and the completion reward.
 *
 * Stages: the quest's progress lives on varp 730 ("royal_questvarbits"); the
 * journal varbit is 2140 royal_quest (bits 0-9), started 10, complete 30. The
 * cache splits the same varp into royal_misc (2141, bits 10-19) and royal_etc
 * (2142, bits 20-29), so setStage writes varbit 2140 only and the investigation
 * sub-progress is mirrored to 2141/2142 - writing the whole varp would clobber
 * the sibling bits. Values 10 (Ghrim start -> partner) and 20 (partner informed)
 * on ROYAL_QUEST, and 10/20/30/40/50/60/80/110/120 on ROYAL_MISC and
 * 10/20/40 on ROYAL_ETC are pinned by Quest Helper's RoyalTrouble guide (the
 * only published stage map; 70 is skipped there). Quest Helper tracks quest
 * completion separately, so the completion value 30 is this plugin's choice,
 * following the 10/20/30 convention.
 *
 * Side state is also mirrored to the cache's own bits: 2143
 * royal_misc_villagers_aboutthefts, 2144 royal_etc_villagers_aboutthefts,
 * 2145 royal_misc_usedminingprop, 2146 royal_liftstage (0-7 build, 9 = lift at
 * top), 2147 royal_misc_ropeloc, 2148 royal_misc_numberofchapters, 2149-2153
 * royal_misc_diarychapterNread, 2154 royal_noticed_fires, 2155
 * royal_lift_platformattop, 2156 royal_coalinengine, 2157
 * royal_meddlingkids_cutscene. The cache's own multilocs read 2146/2147/2141
 * (15238-15242 engine platform/lift platform/side scaffold/top scaffold/lift at
 * top, 15252 ropeswing, 15200/15203 exit rock/hole, 15193 light exit), so
 * sending those varbits makes the client redraw the repaired lift and the exit
 * rope.
 *
 * ToM cross-quest reads: the relationship greetings and the diary's
 * "[daughter/son]" depend on Throne of Miscellania's persisted keys
 * "throne-of-miscellania:partner" (0 = Astrid, 1 = Brand) and
 * "throne-of-miscellania:married"; those constants are declared in that file.
 * The start hook requires Throne of Miscellania complete (quest:is-complete).
 *
 * Source: OSRS Wiki "Royal Trouble" + "Transcript:Royal Trouble"; object/item
 * ids from the cache (lookup-gameval/dump:loc) and Object/ItemIdentifiers.
 *
 * Gaps / approximations:
 *  - No instance engine: the Giant Sea Snake is an owner-only spawn in the
 *    shared boss room rather than an instance (killing it despawns it). The
 *    meddling-kids scene plays the captured transcript with its camera move and
 *    returns the player to (2580, 10268); the snake room itself has no camera.
 *  - Doors 15204, steam-vent and rockfall damage are not in capture 91, so they
 *    are not implemented. The "approaching the first fire remains" line is not
 *    hooked. The lift manual (7972) opens its captured two-page book from the
 *    floor spawn or inventory.
 *  - "the burnt diary" Read shows the wiki diary text as a book; nothing in the
 *    cache is read for its [] page count beyond the item id. Reading with all
 *    five chapters advances the recorded stage to 100.
 *  - The "(Continues with Changing heirs dialogue.)"/relationship continuation
 *    markers close the chat instead of replaying Throne of Miscellania's page.
 *  - Fisherman Frodi has no Royal Trouble transcript variant in the pack, so
 *    only Gunnhild, Leif and Magnus advance the theft investigation.
 *  - The 20,000 coins are handed over by Queen Sigrid's transcript action
 *    (oTxB6D), matching OSRS; the completion scroll lists them as a reward line.
 */
module.exports = function registerRoyalTroubleQuest(api) {
  const {
    DialogueChainBuilder,
    EndDialogue,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    StatementDialogue,
  } = api.core;
  const { openBook, registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Royal Trouble";

  const KING_VARGAS_NPC_ID = NpcIdentifiers.KING_VARGAS; // 3668
  const QUEEN_SIGRID_NPC_ID = NpcIdentifiers.QUEEN_SIGRID; // 765
  const PRINCE_BRAND_NPC_IDS = new Set([
    NpcIdentifiers.PRINCE_BRAND, // 3666
    NpcIdentifiers.PRINCE_BRAND_2, // 3918
  ]);
  const PRINCESS_ASTRID_NPC_IDS = new Set([
    NpcIdentifiers.PRINCESS_ASTRID, // 3667
    NpcIdentifiers.PRINCESS_ASTRID_2, // 3919
  ]);
  const ADVISOR_GHRIM_NPC_IDS = new Set([
    NpcIdentifiers.ADVISOR_GHRIM, // 5447
    NpcIdentifiers.ADVISOR_GHRIM_2, // 5448
  ]);
  const DUNGEON_GUARD_NPC_ID = NpcIdentifiers.GUARD_14; // 1099, dungeon ladder guard
  const HOLE_GUARD_NPC_ID = NpcIdentifiers.GUARD_15; // 1100, Etceteria cave-exit guard
  const DONAL_NPC_ID = NpcIdentifiers.DONAL; // 1096
  const ARMOD_NPC_ID = NpcIdentifiers.ARMOD; // 1088
  const GIANT_SEA_SNAKE_NPC_ID = NpcIdentifiers.GIANT_SEA_SNAKE; // 1101
  const MISC_WORKER_NPC_IDS = new Set([
    NpcIdentifiers.GARDENER_GUNNHILD, // 3656
    NpcIdentifiers.LUMBERJACK_LEIF, // 3653
    NpcIdentifiers.MINER_MAGNUS, // 3654
  ]);
  const ETC_VILLAGER_NPC_IDS = new Set([
    NpcIdentifiers.MATILDA, // 771
    NpcIdentifiers.HELGA, // 770
    NpcIdentifiers.ASHILD, // 772
    NpcIdentifiers.MOLDOF, // 769
    NpcIdentifiers.ARNOR, // 767
  ]);
  const SAILOR_NPC_IDS = new Set([
    NpcIdentifiers.SAILOR, // 3680
    NpcIdentifiers.SAILOR_2, // 3936
  ]);
  const KID_NPC_IDS = new Set([
    NpcIdentifiers.SIGNY, // 1086
    NpcIdentifiers.HILD, // 1087
    ARMOD_NPC_ID,
    NpcIdentifiers.BEIGARTH, // 1089
    NpcIdentifiers.REINN, // 1090
  ]);

  const VARBIT_ROYAL_QUEST = 2140; // royal_quest, varp 730 bits 0-9
  const VARBIT_ROYAL_MISC = 2141; // royal_misc, bits 10-19
  const VARBIT_ROYAL_ETC = 2142; // royal_etc, bits 20-29
  const VARBIT_MISC_VILLAGERS = 2143; // royal_misc_villagers_aboutthefts
  const VARBIT_ETC_VILLAGERS = 2144; // royal_etc_villagers_aboutthefts
  const VARBIT_USED_MINING_PROP = 2145; // royal_misc_usedminingprop
  const VARBIT_LIFT_STAGE = 2146; // royal_liftstage bits 3-6
  const VARBIT_ROPELOC = 2147; // royal_misc_ropeloc
  const VARBIT_CHAPTERS = 2148; // royal_misc_numberofchapters bits 8-12
  const VARBIT_DIARY_READ_1 = 2149; // royal_misc_diarychapter1read
  const VARBIT_NOTICED_FIRES = 2154; // royal_noticed_fires
  const VARBIT_PLATFORM_AT_TOP = 2155; // royal_lift_platformattop
  const VARBIT_COAL = 2156; // royal_coalinengine bits 20-22
  const VARBIT_KIDS_CUTSCENE = 2157; // royal_meddlingkids_cutscene

  const STAGE_STARTED = 10;
  const STAGE_PARTNER = 20;
  const STAGE_COMPLETE = 30;

  const MISC_INVESTIGATE = 10;
  const MISC_REPORTED = 20;
  const MISC_GHRIM = 30;
  const MISC_SAILOR = 40;
  const MISC_SCROLL = 50;
  const MISC_DUNGEON = 60;
  const MISC_DONAL = 80;
  const MISC_LIFT = 90;
  const MISC_DIARY = 100;
  const MISC_KIDS = 110;
  const MISC_BOSS = 120;
  const MISC_COMPLETE = 130;

  const ETC_SIGRID = 10;
  const ETC_REPORTED = 20;
  const ETC_BOX = 40;

  const LIFT_PULLEY_1 = 1;
  const LIFT_LONGER_PULLEY = 2;
  const LIFT_PULLEY_2 = 3;
  const LIFT_ROPE = 4;
  const LIFT_BEAM = 5;
  const LIFT_ENGINE = 6;
  const LIFT_DONE = 7;
  const LIFT_AT_TOP = 9;

  const MISC_ATTRIBUTE = "royal-trouble:royal-misc";
  const ETC_ATTRIBUTE = "royal-trouble:royal-etc";
  const MISC_VILLAGERS_ATTRIBUTE = "royal-trouble:misc-villagers";
  const ETC_VILLAGERS_ATTRIBUTE = "royal-trouble:etc-villagers";
  const USED_PROP_ATTRIBUTE = "royal-trouble:used-mining-prop";
  const LIFT_ATTRIBUTE = "royal-trouble:lift-stage";
  const ROPELOC_ATTRIBUTE = "royal-trouble:ropeloc";
  const CHAPTERS_ATTRIBUTE = "royal-trouble:chapters";
  const FIRE_BITS_ATTRIBUTE = "royal-trouble:fire-bits";
  const DIARY_READ_ATTRIBUTE = "royal-trouble:diary-read";
  const PLATFORM_TOP_ATTRIBUTE = "royal-trouble:platform-at-top";
  const COAL_ATTRIBUTE = "royal-trouble:coal-in-engine";
  const CUTSCENE_ATTRIBUTE = "royal-trouble:kids-cutscene";
  const COINS_ATTRIBUTE = "royal-trouble:coins-given";

  // Throne of Miscellania's persisted keys (module constants in that file).
  const THRONE_PARTNER_ATTRIBUTE = "throne-of-miscellania:partner";
  const THRONE_MARRIED_ATTRIBUTE = "throne-of-miscellania:married";
  const THRONE_PARTNER_BRAND = 1;

  const START_HOOK = "quest:royal-trouble:start";

  const MINING_PROP_ITEM_ID = ItemIdentifiers.MINING_PROP; // 7958
  const HEAVY_BOX_ITEM_ID = ItemIdentifiers.HEAVY_BOX; // 7959
  const BURNT_DIARY_ITEM_IDS = [
    ItemIdentifiers.BURNT_DIARY, // 7961
    ItemIdentifiers.BURNT_DIARY_2, // 7962
    ItemIdentifiers.BURNT_DIARY_3, // 7963
    ItemIdentifiers.BURNT_DIARY_4, // 7964
    ItemIdentifiers.BURNT_DIARY_5, // 7965
  ];
  const LETTER_ITEM_ID = ItemIdentifiers.LETTER_6; // 7966
  const ENGINE_ITEM_ID = ItemIdentifiers.ENGINE; // 7967
  const LIFT_MANUAL_ITEM_ID = ItemIdentifiers.LIFT_MANUAL; // 7972
  const SCROLL_ITEM_ID = ItemIdentifiers.SCROLL_2; // 7968
  const PULLEY_BEAM_ITEM_ID = ItemIdentifiers.PULLEY_BEAM; // 7969
  const LONG_PULLEY_BEAM_ITEM_ID = ItemIdentifiers.LONG_PULLEY_BEAM; // 7970
  const LONGER_PULLEY_BEAM_ITEM_ID = ItemIdentifiers.LONGER_PULLEY_BEAM; // 7971
  const BEAM_ITEM_ID = ItemIdentifiers.BEAM; // 7973
  const COAL_ITEM_ID = ItemIdentifiers.COAL; // 453
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK; // 960
  const BRONZE_PICKAXE_ITEM_ID = ItemIdentifiers.BRONZE_PICKAXE; // 1265
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const PULLEY_ITEMS = new Set([
    PULLEY_BEAM_ITEM_ID,
    LONG_PULLEY_BEAM_ITEM_ID,
    LONGER_PULLEY_BEAM_ITEM_ID,
  ]);
  const LIFT_ITEM_IDS = new Set([
    ENGINE_ITEM_ID,
    PULLEY_BEAM_ITEM_ID,
    LONG_PULLEY_BEAM_ITEM_ID,
    LONGER_PULLEY_BEAM_ITEM_ID,
    BEAM_ITEM_ID,
    COAL_ITEM_ID,
    ROPE_ITEM_ID,
  ]);

  const CRACK_IN_OBJECT_ID = ObjectIdentifiers.CREVICE_10; // 15186 crack outside
  const CRACK_OUT_OBJECT_ID = ObjectIdentifiers.CREVICE_11; // 15187 crack lift-room side
  const TUNNEL_IN_OBJECT_ID = ObjectIdentifiers.TUNNEL_15; // 15188 tunnel from plank room
  const TUNNEL_OUT_OBJECT_ID = ObjectIdentifiers.TUNNEL_16; // 15189 tunnel from caves
  const FREMENNIK_CRACK_IN_OBJECT_ID = ObjectIdentifiers.CREVICE_12; // 15194 kids' crevice in
  const FREMENNIK_CRACK_OUT_OBJECT_ID = ObjectIdentifiers.CREVICE_13; // 15195 kids' crevice out
  const SNAKE_CRACK_IN_OBJECT_ID = ObjectIdentifiers.CREVICE_14; // 15196 boss crevice in
  const SNAKE_CRACK_OUT_OBJECT_ID = ObjectIdentifiers.CREVICE_15; // 15197 boss crevice out
  const FIRE_REMAINS_OBJECT_IDS = [
    ObjectIdentifiers.FIRE_REMAINS_3, // 15206
    ObjectIdentifiers.FIRE_REMAINS_4, // 15207
    ObjectIdentifiers.FIRE_REMAINS_5, // 15208
    ObjectIdentifiers.FIRE_REMAINS_6, // 15209
    ObjectIdentifiers.FIRE_REMAINS_7, // 15210
  ];
  const SLIPPERY_ROCKS_OBJECT_ID = ObjectIdentifiers.ROCKS_70; // 15213
  const ROPESWING_OBJECT_ID = ObjectIdentifiers.ROPESWING; // 15216 (resolved from 15252)
  // Nameless cache multilocs (no identifier exists; named here like
  // ElementalWorkshopI's BELLOWS_BASE and RibbitingTale's multilocs).
  const ENGINE_PLATFORM_MULTILOC_ID = 15238; // -> 15226/15227/15228/15229 by 2146
  const LIFT_PLATFORM_MULTILOC_ID = 15239; // -> 15222-15225 by 2146
  const SIDE_SCAFFOLD_MULTILOC_ID = 15240; // -> 15230-15232 by 2146
  const TOP_SCAFFOLD_MULTILOC_ID = 15241; // -> 15233-15236 by 2146
  const LIFT_TOP_MULTILOC_ID = 15242; // -> 15237 by 2146
  const ROPESWING_MULTILOC_ID = 15252; // -> 15217/15216 by 2147
  const LIGHT_EXIT_MULTILOC_ID = 15193; // -> 15190/15191 by 2141
  const PICKAXE_ROCK_OBJECT_ID = ObjectIdentifiers.ROCKS_68; // 15127 Take-pickaxe
  const CRATE_BEAM_OBJECT_ID = ObjectIdentifiers.CRATE_116; // 15243 Take-Beam
  const CRATE_PULLEY_OBJECT_ID = ObjectIdentifiers.CRATE_117; // 15244 Take-Pulley-Beam
  const CRATE_ROPE_OBJECT_ID = ObjectIdentifiers.CRATE_118; // 15245 Take-Rope
  const LADDER_DOWN_OBJECT_ID = ObjectIdentifiers.LADDER_184; // 15116 Climb-down

  const DUNGEON_ZONE = { minX: 2494, maxX: 2625, minY: 10240, maxY: 10304, levels: [0, 1, 2] };
  const BOSS_ROOM_ZONE = { minX: 2608, maxX: 2622, minY: 10272, maxY: 10290, levels: [0] };
  const BOSS_TILE = { x: 2615, y: 10280 };
  // Capture 91 drops the heavy box on the walkable fight ledge, not the boss island.
  const HEAVY_BOX_TILE = { x: 2613, y: 10278 };
  const LIFT_BOTTOM_TILE = { x: 2508, y: 10288, z: 0 };
  const LIFT_TOP_TILE = { x: 2508, y: 10288, z: 1 };
  const CAVE_EXIT_TILE = { x: 2621, y: 3866, z: 0 };
  // Capture 91's meddling-kids scene: camera over the kids, then the player
  // returns to the path at (2580, 10268).
  const KIDS_SCENE_TILE = { x: 2571, y: 10276, z: 0 };
  const KIDS_EXIT_TILE = { x: 2580, y: 10268, z: 0 };
  const KIDS_CAMERA_MOVE = { x: 2571, y: 10273, height: 350, rate: 100 };
  const KIDS_CAMERA_LOOK = { x: 2571, y: 10277, height: 300, rate: 100 };
  // Capture 91 sends a second, faster reveal toward the kids before resetting.
  const KIDS_REVEAL_MOVE = { x: 2567, y: 10274, height: 400, rate: 13 };
  const KIDS_REVEAL_LOOK = { x: 2582, y: 10270, height: 300, rate: 13 };
  const KIDS_REVEAL_RETARGET = { x: 2571, y: 10277, height: 300, rate: 2 };
  const CUTSCENE_END_ACTION = "P_Qf1k";

  const MANUAL_TITLE = "AMCE Lift-In-A-Box User Manual";
  // Capture 91 opens this book from the manual on the lift-room floor (item 7972).
  function manualPage(left, right = []) {
    const page = {};
    left.forEach((text, line) => { page[44 + line] = text; });
    right.forEach((text, line) => { page[60 + line] = text; });
    return page;
  }
  const LIFT_MANUAL_PAGES = [
    manualPage(
      ["Troubleshooting your AMCE", "Lift-In-A-Box", "", "<col=800000>'My lift doesn't work!'<col=000080>", "",
        "1. Have you added the", "pulleys? Make sure you have", "a long top beam with a", "pulley, and pulleys on the",
        "two crossbeams. We", "recommend AMCE Pulley-", "Beams-In-A-Box.", "", "2. Have you attached a", "rope? Wind one of your"],
      ["AMCE Ropes-In-A-Box", "through the pulleys.", "", "3. Is the platform broken?", "Repair it with one of your",
        "AMCE Beams-In-A-Box.", "", "4. Have you added the", "engine? The AMCE Lift-In-", "A-Box does not include an",
        "engine.", "", "5. Have you added coal to", "the engine? All compatible", "coal engines have a maximum"]
    ),
    manualPage(
      ["load of five chunks of coal.", "", "(AMCE Lift-In-A-Box,", "Pulley-Beams-In-A-Box,", "Beams-In-A-Box and Ropes-",
        "In-A-Box are all registered", "trademarks of Ali Morrisane", "Commercial Enterprises", "(AMCE) Ltd.)"]
    ),
  ];

  const FIRE_BITS = new Map([
    [FIRE_REMAINS_OBJECT_IDS[0], 1 << 0],
    [FIRE_REMAINS_OBJECT_IDS[1], 1 << 1],
    [FIRE_REMAINS_OBJECT_IDS[2], 1 << 2],
    [FIRE_REMAINS_OBJECT_IDS[3], 1 << 3],
    [FIRE_REMAINS_OBJECT_IDS[4], 1 << 4],
  ]);

  // ==========================================================================
  // Transcript variants
  // ==========================================================================

  // Advisor Ghrim.
  const GHRIM_PAGE = "Advisor Ghrim";
  const V_GHRIM_MAIN = "getting-started-talking-to-advisor-ghrim";
  const V_GHRIM_WAIT = "getting-started-talking-to-advisor-ghrim-after-starting-the-quest";
  const V_GHRIM_DUNGEON = "to-the-dungeon-with-you-talking-to-advisor-ghrim";
  const V_GHRIM_DUNGEON_2 = "to-the-dungeon-with-you-talking-to-advisor-ghrim-2";
  const V_GHRIM_POST = "standard-dialogue-after-completing-royal-trouble";

  // King Vargas.
  const V_VARGAS_AFTER_START = "getting-started-talking-to-king-vargas-after-starting-the-quest";
  const V_VARGAS_SPEAK = "getting-started-speaking-to-king-vargas";
  const V_VARGAS_REPORT = "investigating-the-stolen-goods-talking-to-king-vargas";
  const V_VARGAS_DUNGEON = "to-the-dungeon-with-you-talking-to-king-vargas";
  const V_VARGAS_ASK = "to-the-dungeon-with-you-asking-king-vargas-for-permission-to-enter-the-dungeon";
  const V_VARGAS_SCROLL_AGAIN = "to-the-dungeon-with-you-talking-to-king-vargas-again";
  const V_VARGAS_AT_PEACE = "at-peace-once-again-returning-to-king-vargas";
  const V_VARGAS_POST = "post-quest-talking-to-king-vargas";

  // Queen Sigrid.
  const V_SIGRID_FIRST = "investigating-the-stolen-goods-talking-to-queen-sigrid";
  const V_SIGRID_SEARCH = "investigating-the-stolen-goods-talking-to-queen-sigrid-again";
  const V_SIGRID_RETURN = "investigating-the-stolen-goods-returning-to-queen-sigrid";
  const V_SIGRID_BOX = "those-meddling-kids-talking-to-queen-sigrid-with-the-heavy-box";
  const V_SIGRID_AGAIN = "those-meddling-kids-talking-to-sigrid-again";
  const V_SIGRID_POST = "post-quest-talking-to-queen-sigrid";

  // Prince Brand / Princess Astrid.
  const V_BRAND_START = "getting-started-talking-to-prince-brand";
  const V_BRAND_INVESTIGATE = "investigating-the-stolen-goods-talking-to-prince-brand";
  const V_BRAND_POST = "post-quest-talking-to-prince-brand";
  const V_ASTRID_START = "getting-started-talking-to-princess-astrid";
  const V_ASTRID_INVESTIGATE = "investigating-the-stolen-goods-talking-to-princess-astrid";
  const V_ASTRID_POST = "post-quest-talking-to-princess-astrid";

  // Investigation speakers.
  const GUNNHILD_PAGE = "Gardener Gunnhild";
  const LEIF_PAGE = "Lumberjack Leif";
  const MAGNUS_PAGE = "Miner Magnus";
  const V_GUNNHILD = "investigating-the-stolen-goods-talking-to-gardener-gunhild";
  const V_LEIF = "investigating-the-stolen-goods-talking-to-lumberjack-leif";
  const V_MAGNUS = "investigating-the-stolen-goods-talking-to-miner-magnus";
  const V_GUNNHILD_AFTER_THRONE = "standard-dialogue-after-completion-of-throne-of-miscellania";
  const V_LEIF_AFTER_THRONE = "standard-dialogue-after-throne-of-miscellania";
  const V_MAGNUS_AFTER_THRONE = "standard-dialogue-after-throne-of-miscellania";
  const V_MATILDA = "investigating-the-stolen-goods-talking-to-matilda";
  const V_HELGA = "investigating-the-stolen-goods-talking-to-helga";
  const V_ASHILD = "investigating-the-stolen-goods-talking-to-ashild";
  const V_MOLDOF = "investigating-the-stolen-goods-talking-to-moldof";
  const V_ARNOR = "investigating-the-stolen-goods-talking-to-arnor";
  const V_SAILOR = "to-the-dungeon-with-you-talking-to-the-sailor";

  // Guards / Donal / kids / boss.
  const GUARD_PAGE = "Guard (Miscellania)";
  const V_GUARD_POST = "standard-dialogue-after-completing-royal-trouble";
  const V_GUARD_NO_SCROLL = "to-the-dungeon-with-you-attempting-to-enter-the-dungeon-without-the-scroll";
  const V_GUARD_SCROLL = "to-the-dungeon-with-you-entering-the-dungeon-with-the-scroll";
  const V_GUARD_LAIR = "those-meddling-kids-leaving-the-giant-sea-snake-s-lair";
  const V_GUARD_HOLE = "those-meddling-kids-talking-to-the-guard-near-the-hole";
  const V_GUARD_BACK = "those-meddling-kids-trying-to-go-back-into-the-hole";
  const V_DONAL = "to-the-dungeon-with-you-talking-to-donal";
  const V_DONAL_AGAIN = "to-the-dungeon-with-you-talking-to-donal-again";
  const V_KIDS = "those-meddling-kids-squeezing-through-the-crevice";
  const V_BOSS_DEAD = "those-meddling-kids-upon-killing-the-giant-sea-snake";

  // Lift repair / diary messages.
  const V_PROP_REFUSE = "repairing-the-lift-attempting-to-squeeze-through-the-crevice-before-adding-the-mining-prop";
  const V_PROP_POSITION = "repairing-the-lift-putting-the-prop-in-position";
  const V_TAKE_PULLEY = "repairing-the-lift-taking-a-pulley-beam";
  const V_TAKE_BEAM = "repairing-the-lift-taking-a-beam";
  const V_TAKE_ROPE = "repairing-the-lift-taking-some-rope";
  const V_LONG_BEAM = "repairing-the-lift-creating-a-long-pulley-beam";
  const V_LONGER_BEAM = "repairing-the-lift-creating-a-longer-pulley-beam";
  const V_LIFT_PULLEY = "repairing-the-lift-adding-the-pulley-beam";
  const V_LIFT_LONGER = "repairing-the-lift-adding-the-longer-pulley-beam";
  const V_LIFT_ROPE = "repairing-the-lift-adding-the-rope";
  const V_LIFT_BEAM = "repairing-the-lift-adding-a-beam-to-the-platform";
  const V_LIFT_COAL = "repairing-the-lift-adding-coal-to-the-engine";
  const V_LIFT_COAL_FULL = "repairing-the-lift-attempting-to-overfill-the-engine";
  const V_LIFT_ENGINE = "repairing-the-lift-adding-the-engine";
  const V_LIFT_UP = "repairing-the-lift-taking-the-lift-up";
  const V_LIFT_DOWN = "repairing-the-lift-taking-the-lift-down";
  const V_LIFT_DONE = "repairing-the-lift-using-items-on-the-lift-after-repairing-it-fully";
  const V_TUNNEL_BEAMS = "the-burnt-diary-entering-the-tunnel-with-beams-or-pulley-beams";
  const V_ROCK_ROPE = "the-burnt-diary-using-a-rope-on-the-rock-formation";
  const V_FIRE_FIRST = "the-burnt-diary-searching-the-first-fire-remains";
  const V_FIRE_MORE = "the-burnt-diary-searching-the-second-third-fourth-and-fifth-fire-remains";
  const V_FIRE_NONE = "the-burnt-diary-searching-fire-remains-you-ve-already-collected-the-pages-from";
  const V_ROCKS_LOOK = "the-burnt-diary-look-at-rocks";
  const V_ROCKS_PLANK = "the-burnt-diary-using-a-plank-on-the-rocks";
  const V_CREVICE_LOCKED = "those-meddling-kids-trying-to-enter-the-crevice-without-all-the-diary-pages";
  const V_LETTER_READ = "at-peace-once-again-reading-the-letter-queen-sigrid-gives-the-player";

  // Condition step ids.
  const COND_ASTRID_RELATION = "M-wG2E";
  const COND_BRAND_RELATION = "9MWtFf";
  const COND_BRAND_RELATION_2 = "1wOLkM";
  const COND_ASTRID_RELATION_2 = "dgjUcS";
  const COND_GHRIM_ASTRID = "R2NoGA";
  const COND_GHRIM_BRAND = "j4Z8Ra";
  const COND_HAS_SCROLL = "Uuwe8a";
  const COND_LOST_SCROLL = "iq_pN-";
  const COND_LOST_PROP = "j11h8I";
  const COND_MARRIED = "7feX1P";
  const COND_NOT_MARRIED = "SLFNsR";
  const COND_HAS_BOX_GUARD = "-af_uQ";
  const COND_LOST_BOX_GUARD = "lAKjBl";
  const COND_LOST_BOX_SIGRID = "X7NF6M";
  const COND_HAS_BOX_SIGRID = "Bez4o-";
  const COND_HAS_LETTER_SIGRID = "ymQa_q";
  const COND_LOST_LETTER_SIGRID = "gXkW0W";
  const COND_LOST_LETTER_VARGAS = "6lWgHj";
  const COND_HAS_LETTER_VARGAS = "yDRo8A";
  const OWN_CONDITION_IDS = new Set([
    COND_ASTRID_RELATION, COND_BRAND_RELATION, COND_BRAND_RELATION_2, COND_ASTRID_RELATION_2,
    COND_GHRIM_ASTRID, COND_GHRIM_BRAND, COND_HAS_SCROLL, COND_LOST_SCROLL, COND_LOST_PROP,
    COND_MARRIED, COND_NOT_MARRIED, COND_HAS_BOX_GUARD, COND_LOST_BOX_GUARD,
    COND_LOST_BOX_SIGRID, COND_HAS_BOX_SIGRID, COND_HAS_LETTER_SIGRID, COND_LOST_LETTER_SIGRID,
    COND_LOST_LETTER_VARGAS, COND_HAS_LETTER_VARGAS,
  ]);

  // Action step ids.
  const ACTION_CUTSCENE_BRAND = "kIbgqV";
  const ACTION_CUTSCENE_ASTRID = "SQJNBj";
  const ACTION_CUTSCENE_END_BRAND = "bSl0-S";
  const ACTION_CUTSCENE_END_ASTRID = "1XAyvr";
  const ACTION_RECEIVE_SCROLL = "CUZcng";
  const ACTION_RECEIVE_PROP = "KriJ8h";
  const ACTION_DONAL_CONTINUE = "UhPyoe";
  const ACTION_RECEIVE_LETTER = "ARzdfn";
  const ACTION_RECEIVE_COINS = "oTxB6D";
  const ACTION_COMPLETE = "2rSWNl";
  const ACTION_RELATION_BRAND = "P2OA_C";
  const ACTION_RELATION_ASTRID = "uKqDn7";
  // "(Continues with Changing heirs dialogue.)" markers on this page.
  const ACTION_CONTINUE_CHANGE_HEIRS = new Set([
    "umbqUh", "FtS4yX", "mS8Qly", "z94pTN", "clSfQu",
    "xfoPx0", "YeaEfW", "9yuFB5", "VrAN6W",
  ]);
  const ACTION_SEND_TO_CITIZENS = "mS8Qly";
  const ACTION_REPORT_TO_VARGAS = "z94pTN";
  const ACTION_ASK_GHRIM = "clSfQu";
  const ACTION_SCROLL_CONTINUE = "YeaEfW";
  const OWN_ACTION_IDS = new Set([
    ACTION_CUTSCENE_BRAND, ACTION_CUTSCENE_ASTRID, ACTION_CUTSCENE_END_BRAND, ACTION_CUTSCENE_END_ASTRID,
    ACTION_RECEIVE_SCROLL, ACTION_RECEIVE_PROP, ACTION_DONAL_CONTINUE, ACTION_RECEIVE_LETTER,
    ACTION_RECEIVE_COINS, ACTION_COMPLETE, ACTION_RELATION_BRAND, ACTION_RELATION_ASTRID,
    ...ACTION_CONTINUE_CHANGE_HEIRS,
  ]);

  const bosses = new Map();

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function royalMisc(player) {
    return Number(player.getAttribute(MISC_ATTRIBUTE)) || 0;
  }

  function setRoyalMisc(player, value) {
    player.setAttribute(MISC_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_ROYAL_MISC, value | 0);
  }

  function advanceMisc(player, value) {
    if (royalMisc(player) < value) setRoyalMisc(player, value);
  }

  function royalEtc(player) {
    return Number(player.getAttribute(ETC_ATTRIBUTE)) || 0;
  }

  function setRoyalEtc(player, value) {
    player.setAttribute(ETC_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_ROYAL_ETC, value | 0);
  }

  function advanceEtc(player, value) {
    if (royalEtc(player) < value) setRoyalEtc(player, value);
  }

  function hasAttribute(player, key) {
    return (Number(player.getAttribute(key)) || 0) === 1;
  }

  function setAttributeFlag(player, key, value) {
    player.setAttribute(key, value ? 1 : 0);
  }

  function liftStage(player) {
    return Math.max(0, Number(player.getAttribute(LIFT_ATTRIBUTE)) || 0);
  }

  function setLiftStage(player, value) {
    player.setAttribute(LIFT_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_LIFT_STAGE, value | 0);
  }

  function coalInEngine(player) {
    return Math.max(0, Number(player.getAttribute(COAL_ATTRIBUTE)) || 0);
  }

  function setCoalInEngine(player, value) {
    player.setAttribute(COAL_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_COAL, value | 0);
  }

  function chapters(player) {
    return Math.max(0, Number(player.getAttribute(CHAPTERS_ATTRIBUTE)) || 0);
  }

  function diaryRead(player) {
    return hasAttribute(player, DIARY_READ_ATTRIBUTE);
  }

  function married(player) {
    return hasAttribute(player, THRONE_MARRIED_ATTRIBUTE);
  }

  function partnerIsBrand(player) {
    return Number(player.getAttribute(THRONE_PARTNER_ATTRIBUTE)) === THRONE_PARTNER_BRAND;
  }

  function diaryKinship(player) {
    return partnerIsBrand(player) ? "son" : "daughter";
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /**
   * The ::quest command resets the registered stage but not this plugin's side
   * attributes; clear them the next time the quest is seen unstarted.
   */
  function syncResetSideState(player) {
    if (quest.getStage(player) !== 0) return;
    const dirty =
      royalMisc(player) !== 0 || royalEtc(player) !== 0 ||
      liftStage(player) !== 0 || coalInEngine(player) !== 0 || chapters(player) !== 0 ||
      (Number(player.getAttribute(ROPELOC_ATTRIBUTE)) || 0) !== 0 ||
      (Number(player.getAttribute(FIRE_BITS_ATTRIBUTE)) || 0) !== 0 ||
      hasAttribute(player, MISC_VILLAGERS_ATTRIBUTE) || hasAttribute(player, ETC_VILLAGERS_ATTRIBUTE) ||
      hasAttribute(player, USED_PROP_ATTRIBUTE) || hasAttribute(player, DIARY_READ_ATTRIBUTE) ||
      hasAttribute(player, PLATFORM_TOP_ATTRIBUTE) || hasAttribute(player, CUTSCENE_ATTRIBUTE) ||
      hasAttribute(player, COINS_ATTRIBUTE);
    if (!dirty) return;
    for (const key of [
      MISC_ATTRIBUTE, ETC_ATTRIBUTE, MISC_VILLAGERS_ATTRIBUTE, ETC_VILLAGERS_ATTRIBUTE,
      USED_PROP_ATTRIBUTE, LIFT_ATTRIBUTE, ROPELOC_ATTRIBUTE, CHAPTERS_ATTRIBUTE,
      FIRE_BITS_ATTRIBUTE, DIARY_READ_ATTRIBUTE, PLATFORM_TOP_ATTRIBUTE, COAL_ATTRIBUTE,
      CUTSCENE_ATTRIBUTE, COINS_ATTRIBUTE,
    ]) {
      player.setAttribute(key, 0);
    }
    sendSideVarbits(player);
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  function sendSideVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_ROYAL_MISC, royalMisc(player));
    sender.sendVarbit(VARBIT_ROYAL_ETC, royalEtc(player));
    sender.sendVarbit(VARBIT_MISC_VILLAGERS, hasAttribute(player, MISC_VILLAGERS_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_ETC_VILLAGERS, hasAttribute(player, ETC_VILLAGERS_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_USED_MINING_PROP, hasAttribute(player, USED_PROP_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_LIFT_STAGE, liftStage(player));
    sender.sendVarbit(VARBIT_ROPELOC, Number(player.getAttribute(ROPELOC_ATTRIBUTE)) || 0);
    sender.sendVarbit(VARBIT_CHAPTERS, chapters(player));
    for (let bit = 0; bit < 5; bit++) {
      sender.sendVarbit(VARBIT_DIARY_READ_1 + bit, diaryRead(player) ? 1 : 0);
    }
    sender.sendVarbit(VARBIT_NOTICED_FIRES, chapters(player) > 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_PLATFORM_AT_TOP, hasAttribute(player, PLATFORM_TOP_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_COAL, coalInEngine(player));
    sender.sendVarbit(VARBIT_KIDS_CUTSCENE, hasAttribute(player, CUTSCENE_ATTRIBUTE) ? 1 : 0);
  }

  function movePlayer(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z ?? player.getLocation().getZ()));
  }

  /** Plays a named variant through NpcDialogues; falls back to the runtime replay. */
  function playVariant(player, npcId, variant, select) {
    const request = { player, npcId, variant, select, handled: false };
    api.emitCustomEvent("npc-dialogue:start", request);
    if (!request.handled) startTranscript(api, player, npcId, PAGE, variant, select);
  }

  /** A message-only variant (repair messages, fire remains); no chathead is used. */
  function playMessages(player, variant) {
    startTranscript(api, player, DONAL_NPC_ID, PAGE, variant);
  }

  function replayNextTick(player, action) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask({}, 1, () => {
        if (player.isRegistered?.() === false) return;
        action();
      })
    );
  }

  function giveItem(player, itemId, amount = 1) {
    player.getInventory().adds(itemId, amount);
  }

  function takeItem(player, itemId, amount = 1) {
    player.getInventory().deleteNumber(itemId, amount);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    syncResetSideState(player);
    if (npcId === KING_VARGAS_NPC_ID) return selectVargas(player);
    if (npcId === QUEEN_SIGRID_NPC_ID) return selectSigrid(player);
    if (PRINCE_BRAND_NPC_IDS.has(npcId)) return selectBrand(player);
    if (PRINCESS_ASTRID_NPC_IDS.has(npcId)) return selectAstrid(player);
    if (ADVISOR_GHRIM_NPC_IDS.has(npcId)) return selectGhrim(player);
    if (MISC_WORKER_NPC_IDS.has(npcId)) return selectMiscWorker(player, npcId);
    if (ETC_VILLAGER_NPC_IDS.has(npcId)) return selectEtcVillager(player, npcId);
    if (SAILOR_NPC_IDS.has(npcId)) return selectSailor(player);
    if (npcId === DUNGEON_GUARD_NPC_ID) return selectDungeonGuard(player);
    if (npcId === DONAL_NPC_ID) return selectDonal(player);
    return null;
  }

  function variant(page, name) {
    return { page, variant: name };
  }

  function selectGhrim(player) {
    const stage = quest.getStage(player);
    if (!questComplete(player, "throne_of_miscellania")) return null;
    if (stage >= STAGE_COMPLETE) return variant(GHRIM_PAGE, V_GHRIM_POST);
    if (royalMisc(player) >= MISC_SCROLL) return variant(PAGE, V_GHRIM_DUNGEON_2);
    if (royalMisc(player) >= MISC_GHRIM) return variant(PAGE, V_GHRIM_DUNGEON);
    if (stage === STAGE_STARTED) return variant(PAGE, V_GHRIM_WAIT);
    return variant(PAGE, V_GHRIM_MAIN);
  }

  function selectVargas(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return null; // Throne of Miscellania's post-quest Vargas
    if (stage >= STAGE_COMPLETE) return variant(PAGE, V_VARGAS_POST);
    if (stage === STAGE_STARTED) return variant(PAGE, V_VARGAS_AFTER_START);
    const misc = royalMisc(player);
    if (royalEtc(player) >= ETC_BOX) return variant(PAGE, V_VARGAS_AT_PEACE);
    if (misc >= MISC_SCROLL) return variant(PAGE, V_VARGAS_SCROLL_AGAIN);
    if (misc >= MISC_SAILOR) return variant(PAGE, V_VARGAS_ASK);
    if (misc >= MISC_GHRIM) return variant(PAGE, V_VARGAS_DUNGEON);
    if (misc >= MISC_REPORTED) {
      return royalEtc(player) >= ETC_REPORTED
        ? variant(PAGE, V_VARGAS_DUNGEON)
        : variant(PAGE, V_VARGAS_REPORT);
    }
    if (misc >= MISC_INVESTIGATE) {
      return hasAttribute(player, MISC_VILLAGERS_ATTRIBUTE)
        ? variant(PAGE, V_VARGAS_REPORT)
        : variant(PAGE, V_VARGAS_SPEAK);
    }
    return variant(PAGE, V_VARGAS_SPEAK);
  }

  function selectSigrid(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return null; // Throne of Miscellania's post-quest Sigrid
    if (stage >= STAGE_COMPLETE) return variant(PAGE, V_SIGRID_POST);
    if (royalEtc(player) >= ETC_BOX) return variant(PAGE, V_SIGRID_AGAIN);
    if (royalEtc(player) >= ETC_REPORTED) {
      return held(player, HEAVY_BOX_ITEM_ID) || royalMisc(player) >= MISC_BOSS
        ? variant(PAGE, V_SIGRID_BOX)
        : variant(PAGE, V_SIGRID_AGAIN);
    }
    if (royalEtc(player) >= ETC_SIGRID) {
      return hasAttribute(player, ETC_VILLAGERS_ATTRIBUTE)
        ? variant(PAGE, V_SIGRID_RETURN)
        : variant(PAGE, V_SIGRID_SEARCH);
    }
    if (royalMisc(player) >= MISC_REPORTED) return variant(PAGE, V_SIGRID_FIRST);
    return null;
  }

  function selectBrand(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return null; // Throne of Miscellania's post-quest Brand
    if (stage >= STAGE_COMPLETE) return variant(PAGE, V_BRAND_POST);
    if (stage === STAGE_STARTED) return variant(PAGE, V_BRAND_START);
    return variant(PAGE, V_BRAND_INVESTIGATE);
  }

  function selectAstrid(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return null; // Throne of Miscellania's post-quest Astrid
    if (stage >= STAGE_COMPLETE) return variant(PAGE, V_ASTRID_POST);
    if (stage === STAGE_STARTED) return variant(PAGE, V_ASTRID_START);
    return variant(PAGE, V_ASTRID_INVESTIGATE);
  }

  function selectMiscWorker(player, npcId) {
    const misc = royalMisc(player);
    if (misc < MISC_INVESTIGATE || misc >= MISC_GHRIM) {
      if (!questComplete(player, "throne_of_miscellania")) return null;
      if (npcId === NpcIdentifiers.GARDENER_GUNNHILD) return variant(GUNNHILD_PAGE, V_GUNNHILD_AFTER_THRONE);
      if (npcId === NpcIdentifiers.LUMBERJACK_LEIF) return variant(LEIF_PAGE, V_LEIF_AFTER_THRONE);
      return variant(MAGNUS_PAGE, V_MAGNUS_AFTER_THRONE);
    }
    if (!hasAttribute(player, MISC_VILLAGERS_ATTRIBUTE)) {
      setAttributeFlag(player, MISC_VILLAGERS_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_MISC_VILLAGERS, 1);
    }
    if (npcId === NpcIdentifiers.GARDENER_GUNNHILD) return variant(PAGE, V_GUNNHILD);
    if (npcId === NpcIdentifiers.LUMBERJACK_LEIF) return variant(PAGE, V_LEIF);
    return variant(PAGE, V_MAGNUS);
  }

  function selectEtcVillager(player, npcId) {
    if (royalEtc(player) !== ETC_SIGRID) return null;
    if (!hasAttribute(player, ETC_VILLAGERS_ATTRIBUTE)) {
      setAttributeFlag(player, ETC_VILLAGERS_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_ETC_VILLAGERS, 1);
    }
    if (npcId === NpcIdentifiers.MATILDA) return variant(PAGE, V_MATILDA);
    if (npcId === NpcIdentifiers.HELGA) return variant(PAGE, V_HELGA);
    if (npcId === NpcIdentifiers.ASHILD) return variant(PAGE, V_ASHILD);
    if (npcId === NpcIdentifiers.MOLDOF) return variant(PAGE, V_MOLDOF);
    return variant(PAGE, V_ARNOR);
  }

  function selectSailor(player) {
    if (royalMisc(player) !== MISC_GHRIM) return null;
    return variant(PAGE, V_SAILOR);
  }

  function selectDungeonGuard(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return null;
    if (quest.isComplete(player)) return variant(GUARD_PAGE, V_GUARD_POST);
    const misc = royalMisc(player);
    if (misc < MISC_SCROLL) return variant(PAGE, V_GUARD_NO_SCROLL);
    if (misc === MISC_SCROLL) return variant(PAGE, V_GUARD_SCROLL);
    return null;
  }

  function selectDonal(player) {
    const stage = quest.getStage(player);
    if (stage === 0) return null;
    const misc = royalMisc(player);
    if (misc >= MISC_DONAL) return variant(PAGE, V_DONAL_AGAIN);
    if (misc >= MISC_DUNGEON) return variant(PAGE, V_DONAL);
    return null;
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId }) {
    if (!player || !OWN_CONDITION_IDS.has(stepId)) return null;
    switch (stepId) {
      case COND_ASTRID_RELATION:
      case COND_ASTRID_RELATION_2:
      case COND_GHRIM_ASTRID:
        return !partnerIsBrand(player);
      case COND_BRAND_RELATION:
      case COND_BRAND_RELATION_2:
      case COND_GHRIM_BRAND:
        return partnerIsBrand(player);
      case COND_MARRIED:
        return married(player);
      case COND_NOT_MARRIED:
        return !married(player);
      case COND_HAS_SCROLL:
        return held(player, SCROLL_ITEM_ID);
      case COND_LOST_SCROLL:
        return royalMisc(player) >= MISC_SAILOR && !held(player, SCROLL_ITEM_ID);
      case COND_LOST_PROP:
        return royalMisc(player) >= MISC_DONAL && !held(player, MINING_PROP_ITEM_ID);
      case COND_HAS_BOX_GUARD:
      case COND_HAS_BOX_SIGRID:
        return held(player, HEAVY_BOX_ITEM_ID);
      case COND_LOST_BOX_GUARD:
      case COND_LOST_BOX_SIGRID:
        return royalMisc(player) >= MISC_BOSS && !ownsHeavyBox(player);
      case COND_HAS_LETTER_SIGRID:
      case COND_HAS_LETTER_VARGAS:
        return held(player, LETTER_ITEM_ID);
      case COND_LOST_LETTER_SIGRID:
      case COND_LOST_LETTER_VARGAS:
        return royalEtc(player) >= ETC_BOX && !held(player, LETTER_ITEM_ID);
      default:
        return null;
    }
  }

  /** Side effects for a condition branch the runtime actually played. */
  function handleConditionChosen(event) {
    const { player, stepId } = event;
    if (!player || !OWN_CONDITION_IDS.has(stepId)) return;
    switch (stepId) {
      case COND_LOST_SCROLL:
        if (!held(player, SCROLL_ITEM_ID)) giveItem(player, SCROLL_ITEM_ID);
        advanceMisc(player, MISC_SCROLL);
        break;
      case COND_LOST_PROP:
        if (!held(player, MINING_PROP_ITEM_ID)) giveItem(player, MINING_PROP_ITEM_ID);
        break;
      case COND_LOST_BOX_GUARD:
        if (!ownsHeavyBox(player)) giveItem(player, HEAVY_BOX_ITEM_ID);
        break;
      case COND_HAS_BOX_SIGRID:
        if (held(player, HEAVY_BOX_ITEM_ID)) takeItem(player, HEAVY_BOX_ITEM_ID);
        break;
      case COND_LOST_LETTER_SIGRID:
        if (!held(player, LETTER_ITEM_ID)) giveItem(player, LETTER_ITEM_ID);
        break;
      case COND_HAS_LETTER_VARGAS:
        if (held(player, LETTER_ITEM_ID)) takeItem(player, LETTER_ITEM_ID);
        break;
      default:
        break;
    }
  }

  // ==========================================================================
  // Hooks, choices, lines, actions
  // ==========================================================================

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (!player || hook !== START_HOOK || !ADVISOR_GHRIM_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0) return;
    if (!questComplete(player, "throne_of_miscellania")) {
      player.sendMessage("You must complete Throne of Miscellania before you can help with this.");
      return;
    }
    quest.setStage(player, STAGE_STARTED);
    sendSideVarbits(player);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || typeof option !== "string") return;
    if (npcId === KING_VARGAS_NPC_ID && royalMisc(player) === 0 && quest.getStage(player) === STAGE_PARTNER) {
      if (option === "Right away, your Majesty." || option === "I'm sorry, I have some other things to do.") {
        setRoyalMisc(player, MISC_INVESTIGATE);
      }
      return;
    }
    if (SAILOR_NPC_IDS.has(npcId) && option === "I'm looking for a sailor..." && royalMisc(player) === MISC_GHRIM) {
      setRoyalMisc(player, MISC_SAILOR);
      return;
    }
    if (npcId === QUEEN_SIGRID_NPC_ID) {
      if (royalEtc(player) === 0 && royalMisc(player) >= MISC_REPORTED) {
        if (option === "Of course, it's my duty." || option === "Of course not, it's not my fault.") {
          setRoyalEtc(player, ETC_SIGRID);
        }
        return;
      }
      if (royalEtc(player) === ETC_SIGRID && hasAttribute(player, ETC_VILLAGERS_ATTRIBUTE)) {
        if (option === "I suppose so..." || option === "Me?") {
          setRoyalEtc(player, ETC_REPORTED);
        }
      }
    }
  }

  function handleDialogueLine(event) {
    const { player, text } = event;
    if (!player || typeof text !== "string") return;
    if (!event.text.includes("[Fremennik name]") && !event.text.includes("Dalkar") &&
      !event.text.includes("[dear/dear friend]") && !event.text.includes("[dear/[Fremennik name]]")) {
      return;
    }
    const name = player.getUsername?.() ?? "";
    let line = event.text.split("[dear/[Fremennik name]]").join(married(player) ? "dear" : name);
    line = line.split("[Fremennik name]").join(name);
    line = line.split("[dear/dear friend]").join(married(player) ? "dear" : "dear friend");
    line = line.split("Dalkar").join(name);
    event.text = line;
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === CUTSCENE_END_ACTION) {
      const sender = player.getPacketSender();
      sender.sendCameraMoveTo(KIDS_REVEAL_MOVE.x, KIDS_REVEAL_MOVE.y, KIDS_REVEAL_MOVE.height,
        { rate: KIDS_REVEAL_MOVE.rate, rate2: 0 });
      sender.sendCameraLookAt(KIDS_REVEAL_LOOK.x, KIDS_REVEAL_LOOK.y, KIDS_REVEAL_LOOK.height,
        { rate: KIDS_REVEAL_LOOK.rate, rate2: 0 });
      sender.sendCameraLookAt(KIDS_REVEAL_RETARGET.x, KIDS_REVEAL_RETARGET.y, KIDS_REVEAL_RETARGET.height,
        { rate: KIDS_REVEAL_RETARGET.rate, rate2: 0 });
      replayNextTick(player, () => {
        player.getPacketSender().sendCameraReset();
        player.getPacketSender().sendVarbit(VARBIT_KIDS_CUTSCENE, 1);
        movePlayer(player, KIDS_EXIT_TILE);
      });
      return;
    }
    if (!OWN_ACTION_IDS.has(stepId)) return;
    if (ACTION_CONTINUE_CHANGE_HEIRS.has(stepId)) {
      if (stepId === ACTION_SEND_TO_CITIZENS) advanceMisc(player, MISC_INVESTIGATE);
      if (stepId === ACTION_REPORT_TO_VARGAS) advanceMisc(player, MISC_REPORTED);
      if (stepId === ACTION_ASK_GHRIM) advanceMisc(player, MISC_GHRIM);
      if (stepId === ACTION_SCROLL_CONTINUE) advanceMisc(player, MISC_SCROLL);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === ACTION_CUTSCENE_BRAND || stepId === ACTION_CUTSCENE_ASTRID) {
      // No cutscene engine: the conversation plays in place.
      event.handled = true;
      return;
    }
    if (stepId === ACTION_CUTSCENE_END_BRAND || stepId === ACTION_CUTSCENE_END_ASTRID) {
      event.handled = true;
      event.end = true;
      if (quest.getStage(player) < STAGE_PARTNER) quest.setStage(player, STAGE_PARTNER);
      return;
    }
    if (stepId === ACTION_RECEIVE_SCROLL) {
      event.handled = true;
      if (!held(player, SCROLL_ITEM_ID)) giveItem(player, SCROLL_ITEM_ID);
      advanceMisc(player, MISC_SCROLL);
      return;
    }
    if (stepId === ACTION_RECEIVE_PROP) {
      event.handled = true;
      if (!held(player, MINING_PROP_ITEM_ID)) giveItem(player, MINING_PROP_ITEM_ID);
      advanceMisc(player, MISC_DONAL);
      return;
    }
    if (stepId === ACTION_DONAL_CONTINUE) {
      event.handled = true;
      if (!held(player, MINING_PROP_ITEM_ID)) giveItem(player, MINING_PROP_ITEM_ID);
      advanceMisc(player, MISC_DONAL);
      return;
    }
    if (stepId === ACTION_RECEIVE_LETTER) {
      event.handled = true;
      if (!held(player, LETTER_ITEM_ID)) giveItem(player, LETTER_ITEM_ID);
      advanceEtc(player, ETC_BOX);
      return;
    }
    if (stepId === ACTION_RECEIVE_COINS) {
      event.handled = true;
      if (!hasAttribute(player, COINS_ATTRIBUTE)) {
        setAttributeFlag(player, COINS_ATTRIBUTE, true);
        if (held(player, COINS_ITEM_ID) || player.getInventory().getFreeSlots() > 0) {
          giveItem(player, COINS_ITEM_ID, 20000);
        } else {
          api.getItemOnGroundManager().registerLocation(
            player,
            new Item(COINS_ITEM_ID, 20000),
            player.getLocation()
          );
        }
      }
      return;
    }
    if (stepId === ACTION_COMPLETE) {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player) && royalEtc(player) >= ETC_BOX) {
        setRoyalMisc(player, MISC_COMPLETE);
        setAttributeFlag(player, MISC_VILLAGERS_ATTRIBUTE, false);
        setAttributeFlag(player, ETC_VILLAGERS_ATTRIBUTE, false);
        setAttributeFlag(player, DIARY_READ_ATTRIBUTE, false);
        sendSideVarbits(player);
        quest.complete(player);
      }
      return;
    }
    if (stepId === ACTION_RELATION_BRAND || stepId === ACTION_RELATION_ASTRID) {
      event.handled = true;
      event.end = true;
    }
  }

  // ==========================================================================
  // NPC interactions the transcript index cannot select (sliced variants)
  // ==========================================================================

  function sliceCutscene(steps) {
    const end = steps.findIndex((step) => step?.id === "P_Qf1k");
    return end === -1 ? steps : steps.slice(0, end + 1);
  }

  function sliceKidsTalk(steps) {
    const end = steps.findIndex((step) => step?.id === "P_Qf1k");
    return end === -1 ? steps : steps.slice(end + 1);
  }

  function handleNpcInteraction(event) {
    const { player, npcId, clickType } = event;
    if (!player || !Number.isInteger(clickType)) return;
    const option = event.definition?.getActions?.()[clickType - 1];
    if (option !== "Talk-to") return;
    if (!KID_NPC_IDS.has(npcId)) return;
    if (!questActive(player) || royalMisc(player) < MISC_DUNGEON) return;
    event.handled = true;
    if (royalMisc(player) < MISC_KIDS) advanceMisc(player, MISC_KIDS);
    playVariant(player, ARMOD_NPC_ID, V_KIDS, sliceKidsTalk);
  }

  function handleHoleGuardTalk(event) {
    const { player, npcId } = event;
    if (npcId !== HOLE_GUARD_NPC_ID) return false;
    if (!questActive(player) || royalMisc(player) < MISC_BOSS) return false;
    // npc 1100's index has no Royal Trouble page (only 1099's does), so the
    // index cannot pick the variant; play it straight from the page instead.
    const variant = royalEtc(player) >= ETC_BOX ? V_GUARD_BACK : V_GUARD_HOLE;
    startTranscript(api, player, HOLE_GUARD_NPC_ID, PAGE, variant);
    return true;
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player, objectId, clickType } = event;
    if (!player || clickType !== 1) return;
    if (objectId === CRACK_IN_OBJECT_ID || objectId === CRACK_OUT_OBJECT_ID) {
      event.handled = true;
      squeezeMiningCrack(player);
      return;
    }
    if (objectId === TUNNEL_IN_OBJECT_ID) {
      event.handled = true;
      enterTunnelFromPlankRoom(player);
      return;
    }
    if (objectId === TUNNEL_OUT_OBJECT_ID) {
      event.handled = true;
      movePlayer(player, { x: 2512, y: 10287, z: 1 });
      return;
    }
    if (objectId === FREMENNIK_CRACK_IN_OBJECT_ID || objectId === FREMENNIK_CRACK_OUT_OBJECT_ID) {
      event.handled = true;
      squeezeFremennikCrack(player, objectId);
      return;
    }
    if (objectId === SNAKE_CRACK_IN_OBJECT_ID || objectId === SNAKE_CRACK_OUT_OBJECT_ID) {
      event.handled = true;
      squeezeSnakeCrack(player, objectId);
      return;
    }
    if (objectId === LIGHT_EXIT_MULTILOC_ID) {
      event.handled = true;
      climbCaveExit(player);
      return;
    }
    if (objectId === PICKAXE_ROCK_OBJECT_ID) {
      event.handled = true;
      if (!held(player, BRONZE_PICKAXE_ITEM_ID)) giveItem(player, BRONZE_PICKAXE_ITEM_ID);
      return;
    }
    if (objectId === CRATE_BEAM_OBJECT_ID) {
      event.handled = true;
      giveItem(player, BEAM_ITEM_ID);
      playMessages(player, V_TAKE_BEAM);
      return;
    }
    if (objectId === CRATE_PULLEY_OBJECT_ID) {
      event.handled = true;
      giveItem(player, PULLEY_BEAM_ITEM_ID);
      playMessages(player, V_TAKE_PULLEY);
      return;
    }
    if (objectId === CRATE_ROPE_OBJECT_ID) {
      event.handled = true;
      giveItem(player, ROPE_ITEM_ID);
      playMessages(player, V_TAKE_ROPE);
      return;
    }
    if (FIRE_BITS.has(objectId)) {
      event.handled = true;
      searchFireRemains(player, objectId);
      return;
    }
    if (objectId === SLIPPERY_ROCKS_OBJECT_ID) {
      event.handled = true;
      playMessages(player, V_ROCKS_LOOK);
      return;
    }
    if (objectId === ROPESWING_MULTILOC_ID || objectId === ROPESWING_OBJECT_ID) {
      event.handled = true;
      useRopeswing(player);
      return;
    }
    if (objectId === LIFT_PLATFORM_MULTILOC_ID) {
      event.handled = true;
      useLift(player, false);
      return;
    }
    if (objectId === LIFT_TOP_MULTILOC_ID) {
      event.handled = true;
      useLift(player, true);
    }
  }

  function squeezeMiningCrack(player) {
    if (!questActive(player)) return;
    if (!hasAttribute(player, USED_PROP_ATTRIBUTE)) {
      playVariant(player, ARMOD_NPC_ID, V_PROP_REFUSE);
      return;
    }
    const location = player.getLocation();
    const destination = location.getY() <= 10281 ? { x: 2505, y: 10283, z: 0 } : { x: 2505, y: 10280, z: 0 };
    movePlayer(player, destination);
  }

  function enterTunnelFromPlankRoom(player) {
    if ([...PULLEY_ITEMS].some((id) => held(player, id))) {
      for (const id of PULLEY_ITEMS) {
        if (held(player, id)) takeItem(player, id, player.getInventory().getAmount(id));
      }
      playMessages(player, V_TUNNEL_BEAMS);
    }
    player.sendMessage("You squeeze through the small hole in the wall.");
    // Capture 91 tunnels from (2511,10287,1) to the walkable ledge at (2514,10291,0).
    movePlayer(player, { x: 2514, y: 10291, z: 0 });
  }

  function squeezeFremennikCrack(player, objectId) {
    if (!questActive(player)) return;
    const entering = objectId === FREMENNIK_CRACK_IN_OBJECT_ID;
    if (!entering) {
      movePlayer(player, { x: 2585, y: 10263, z: 0 });
      return;
    }
    if (chapters(player) < 5 || !diaryRead(player)) {
      playVariant(player, ARMOD_NPC_ID, V_CREVICE_LOCKED);
      return;
    }
    if (!hasAttribute(player, CUTSCENE_ATTRIBUTE)) {
      setAttributeFlag(player, CUTSCENE_ATTRIBUTE, true);
      movePlayer(player, KIDS_SCENE_TILE);
      const sender = player.getPacketSender();
      sender.sendCameraMoveTo(KIDS_CAMERA_MOVE.x, KIDS_CAMERA_MOVE.y, KIDS_CAMERA_MOVE.height,
        { rate: KIDS_CAMERA_MOVE.rate, rate2: 0 });
      sender.sendCameraLookAt(KIDS_CAMERA_LOOK.x, KIDS_CAMERA_LOOK.y, KIDS_CAMERA_LOOK.height,
        { rate: KIDS_CAMERA_LOOK.rate, rate2: 0 });
      playVariant(player, ARMOD_NPC_ID, V_KIDS, sliceCutscene);
      return;
    }
    movePlayer(player, KIDS_EXIT_TILE);
  }

  function squeezeSnakeCrack(player, objectId) {
    if (!questActive(player)) return;
    const entering = objectId === SNAKE_CRACK_IN_OBJECT_ID;
    movePlayer(player, entering ? { x: 2617, y: 10275, z: 0 } : { x: 2617, y: 10270, z: 0 });
  }

  function searchFireRemains(player, objectId) {
    const bit = FIRE_BITS.get(objectId);
    let bits = Number(player.getAttribute(FIRE_BITS_ATTRIBUTE)) || 0;
    if ((bits & bit) !== 0) {
      playMessages(player, V_FIRE_NONE);
      return;
    }
    bits |= bit;
    player.setAttribute(FIRE_BITS_ATTRIBUTE, bits);
    const found = chapters(player);
    if (found >= 5) {
      playMessages(player, V_FIRE_NONE);
      return;
    }
    if (found === 0) {
      giveItem(player, BURNT_DIARY_ITEM_IDS[0]);
      playMessages(player, V_FIRE_FIRST);
    } else {
      for (const id of BURNT_DIARY_ITEM_IDS) {
        if (held(player, id)) takeItem(player, id, player.getInventory().getAmount(id));
      }
      giveItem(player, BURNT_DIARY_ITEM_IDS[found]);
      playMessages(player, V_FIRE_MORE);
    }
    player.setAttribute(CHAPTERS_ATTRIBUTE, found + 1);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_CHAPTERS, found + 1);
    sender.sendVarbit(VARBIT_NOTICED_FIRES, 1);
  }

  function useRopeswing(player) {
    if (Number(player.getAttribute(ROPELOC_ATTRIBUTE)) !== 1) return;
    const location = player.getLocation();
    const destination = location.getX() < 2540 ? { x: 2540, y: 10296, z: 0 } : { x: 2539, y: 10296, z: 0 };
    movePlayer(player, destination);
  }

  function crossSlipperyRocks(player) {
    const location = player.getLocation();
    const destination = location.getX() >= 2544 ? { x: 2538, y: 10287, z: 0 } : { x: 2549, y: 10287, z: 0 };
    movePlayer(player, destination);
  }

  function climbCaveExit(player) {
    if (quest.getStage(player) === 0 || royalMisc(player) < MISC_BOSS) return;
    startTranscript(api, player, HOLE_GUARD_NPC_ID, PAGE, V_GUARD_LAIR);
    movePlayer(player, CAVE_EXIT_TILE);
  }

  function useLift(player, fromTop) {
    const stage = liftStage(player);
    if (fromTop) {
      if (stage !== LIFT_AT_TOP) return;
      setLiftStage(player, LIFT_DONE);
      setAttributeFlag(player, PLATFORM_TOP_ATTRIBUTE, false);
      player.getPacketSender().sendVarbit(VARBIT_PLATFORM_AT_TOP, 0);
      playMessages(player, V_LIFT_DOWN);
      movePlayer(player, LIFT_BOTTOM_TILE);
      return;
    }
    if (stage < LIFT_DONE || coalInEngine(player) < 5) return;
    setLiftStage(player, LIFT_AT_TOP);
    setAttributeFlag(player, PLATFORM_TOP_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_PLATFORM_AT_TOP, 1);
    playMessages(player, V_LIFT_UP);
    movePlayer(player, LIFT_TOP_TILE);
  }

  // ==========================================================================
  // The lift repair (items)
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    const liftObject =
      objectId === LIFT_PLATFORM_MULTILOC_ID || objectId === ENGINE_PLATFORM_MULTILOC_ID ||
      objectId === SIDE_SCAFFOLD_MULTILOC_ID || objectId === TOP_SCAFFOLD_MULTILOC_ID ||
      objectId === LIFT_TOP_MULTILOC_ID;
    if (liftObject && LIFT_ITEM_IDS.has(itemId) && liftStage(player) >= LIFT_DONE) {
      event.handled = true;
      playMessages(player, V_LIFT_DONE);
      return;
    }
    if ((itemId === MINING_PROP_ITEM_ID) && (objectId === CRACK_IN_OBJECT_ID || objectId === CRACK_OUT_OBJECT_ID)) {
      event.handled = true;
      if (!questActive(player) || hasAttribute(player, USED_PROP_ATTRIBUTE)) return;
      takeItem(player, MINING_PROP_ITEM_ID);
      setAttributeFlag(player, USED_PROP_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_USED_MINING_PROP, 1);
      playMessages(player, V_PROP_POSITION);
      return;
    }
    if (objectId === ROPESWING_MULTILOC_ID && itemId === ROPE_ITEM_ID) {
      event.handled = true;
      if (Number(player.getAttribute(ROPELOC_ATTRIBUTE)) === 1) return;
      takeItem(player, ROPE_ITEM_ID);
      player.setAttribute(ROPELOC_ATTRIBUTE, 1);
      player.getPacketSender().sendVarbit(VARBIT_ROPELOC, 1);
      playMessages(player, V_ROCK_ROPE);
      return;
    }
    if (objectId === SLIPPERY_ROCKS_OBJECT_ID && itemId === PLANK_ITEM_ID) {
      event.handled = true;
      playMessages(player, V_ROCKS_PLANK);
      crossSlipperyRocks(player);
      return;
    }
    if (objectId === SIDE_SCAFFOLD_MULTILOC_ID) {
      handleScaffoldItem(player, event, itemId);
      return;
    }
    if (objectId === LIFT_PLATFORM_MULTILOC_ID && itemId === BEAM_ITEM_ID) {
      event.handled = true;
      if (liftStage(player) !== LIFT_ROPE) return;
      takeItem(player, BEAM_ITEM_ID);
      setLiftStage(player, LIFT_BEAM);
      playMessages(player, V_LIFT_BEAM);
      return;
    }
    if (objectId === ENGINE_PLATFORM_MULTILOC_ID) {
      handleEnginePlatformItem(player, event, itemId);
    }
  }

  function handleScaffoldItem(player, event, itemId) {
    const stage = liftStage(player);
    if (itemId === PULLEY_BEAM_ITEM_ID) {
      event.handled = true;
      if (stage === 0) {
        takeItem(player, PULLEY_BEAM_ITEM_ID);
        setLiftStage(player, LIFT_PULLEY_1);
        playMessages(player, V_LIFT_PULLEY);
        return;
      }
      if (stage === LIFT_LONGER_PULLEY) {
        takeItem(player, PULLEY_BEAM_ITEM_ID);
        setLiftStage(player, LIFT_PULLEY_2);
        playMessages(player, V_LIFT_PULLEY);
      }
      return;
    }
    if (itemId === LONGER_PULLEY_BEAM_ITEM_ID) {
      event.handled = true;
      if (stage !== LIFT_PULLEY_1) return;
      takeItem(player, LONGER_PULLEY_BEAM_ITEM_ID);
      setLiftStage(player, LIFT_LONGER_PULLEY);
      playMessages(player, V_LIFT_LONGER);
      return;
    }
    if (itemId === ROPE_ITEM_ID) {
      event.handled = true;
      if (stage !== LIFT_PULLEY_2) return;
      takeItem(player, ROPE_ITEM_ID);
      setLiftStage(player, LIFT_ROPE);
      playMessages(player, V_LIFT_ROPE);
    }
  }

  function handleEnginePlatformItem(player, event, itemId) {
    const stage = liftStage(player);
    if (itemId === ENGINE_ITEM_ID && stage === LIFT_BEAM) {
      event.handled = true;
      takeItem(player, ENGINE_ITEM_ID);
      const complete = coalInEngine(player) >= 5;
      setLiftStage(player, complete ? LIFT_DONE : LIFT_ENGINE);
      if (complete) advanceMisc(player, MISC_LIFT);
      playMessages(player, V_LIFT_ENGINE);
      return;
    }
    if (itemId === COAL_ITEM_ID) {
      event.handled = true;
      if (stage < LIFT_ENGINE) return;
      addCoal(player);
    }
  }

  function addCoal(player) {
    if (coalInEngine(player) >= 5) {
      playMessages(player, V_LIFT_COAL_FULL);
      return;
    }
    takeItem(player, COAL_ITEM_ID);
    setCoalInEngine(player, coalInEngine(player) + 1);
    if (liftStage(player) >= LIFT_ENGINE && coalInEngine(player) >= 5) {
      setLiftStage(player, LIFT_DONE);
      advanceMisc(player, MISC_LIFT);
    }
    playMessages(player, V_LIFT_COAL);
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const pair = (a, b) =>
      (usedItemId === a && usedWithItemId === b) || (usedItemId === b && usedWithItemId === a);
    if (pair(COAL_ITEM_ID, ENGINE_ITEM_ID)) {
      event.handled = true;
      if (liftStage(player) >= LIFT_ENGINE) return;
      addCoal(player);
      return;
    }
    if (pair(BEAM_ITEM_ID, PULLEY_BEAM_ITEM_ID)) {
      event.handled = true;
      takeItem(player, BEAM_ITEM_ID);
      takeItem(player, PULLEY_BEAM_ITEM_ID);
      giveItem(player, LONG_PULLEY_BEAM_ITEM_ID);
      playMessages(player, V_LONG_BEAM);
      return;
    }
    if (pair(BEAM_ITEM_ID, LONG_PULLEY_BEAM_ITEM_ID)) {
      event.handled = true;
      takeItem(player, BEAM_ITEM_ID);
      takeItem(player, LONG_PULLEY_BEAM_ITEM_ID);
      giveItem(player, LONGER_PULLEY_BEAM_ITEM_ID);
      playMessages(player, V_LONGER_BEAM);
    }
  }

  // ==========================================================================
  // Items (diary, letter)
  // ==========================================================================

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player || String(option ?? "").toLowerCase() !== "read") return;
    if (BURNT_DIARY_ITEM_IDS.includes(itemId)) {
      event.handled = true;
      setAttributeFlag(player, DIARY_READ_ATTRIBUTE, true);
      for (let bit = 0; bit < 5; bit++) player.getPacketSender().sendVarbit(VARBIT_DIARY_READ_1 + bit, 1);
      if (chapters(player) >= 5) advanceMisc(player, MISC_DIARY);
      openDiary(player);
      return;
    }
    if (itemId === LIFT_MANUAL_ITEM_ID) {
      event.handled = true;
      openBook(player, MANUAL_TITLE, LIFT_MANUAL_PAGES);
      return;
    }
    if (itemId === LETTER_ITEM_ID) {
      event.handled = true;
      playVariant(player, QUEEN_SIGRID_NPC_ID, V_LETTER_READ);
    }
  }

  function handleGroundItemClick(event) {
    const { player, groundItemId } = event;
    if (!player || groundItemId !== LIFT_MANUAL_ITEM_ID) return;
    event.handled = true;
    openBook(player, MANUAL_TITLE, LIFT_MANUAL_PAGES);
  }

  function openDiary(player) {
    const paragraphs = diaryParagraphs(player);
    const builder = new DialogueChainBuilder();
    paragraphs.forEach((paragraph, index) => builder.add(new StatementDialogue(index, paragraph)));
    builder.add(new EndDialogue(paragraphs.length));
    player.getDialogueManager().startDialogues(builder);
  }

  /** Text from the OSRS Wiki "Transcript:Burnt diary". */
  function diaryParagraphs(player) {
    const kin = diaryKinship(player);
    return [
      "Property of Armod Brundtson",
      "Read at your peril!",
      "If you steal this book, my dad will beat you up!",
      "Year 3 of trials, day 20",
      "We're doing really badly at the trials. Beigarth broke his lyre for the fifth time, Hild got lost in the maze again, and Reinn and Signy were both sick all over Manni. When are we going to finish these trials and become adults? My father keeps telling me to improve, saying that I should try harder to become a proper Fremennik adult.",
      "Year 4 of trials, day 144",
      "The trials aren't going well. I broke my arm while fighting a cow, and Beigarth almost fell into the furnace. Luckily, my father saved him and Signy from spilling molten iron all over the adults. Askeladden's already become an adult and keeps making fun of us. He really annoys me.",
      "Year 5 of trials, day 78",
      "It's not fair! Father said that me and my friends might never pass our trials. They don't want us helping other people with their trials, either. And now he says we have to leave Rellekka! How can they exile us?",
      "Year 5 of trials, day 89",
      "Signy said she heard about two island kingdoms that had been at war for hundreds of years. If we go there and make peace, will my father finally agree that we're true Fremennik adults?",
      "Year 5 of trials, day 93",
      "Life's not fair! We got to the island kingdoms and they said that an adventurer had recently made peace, by promising to marry the " + kin + " of the king! Why does this always happen to us? If we'd just been a little earlier, I could have married the king's " + kin + ".",
      "Year 5 of trials, day 95",
      "Beigarth says that just because they're at peace now doesn't mean they always will be. He says he has a plan.",
      "Beigarth's plan is great! Now all we have to do is find the right armour, and a place in one of the caves. Father's going to be so impressed with me...",
      "Year 5 of trials, day 98",
      "The plan's worked! The kingdoms are at war again, and no-one knows we were those soldiers. All we need to do is make peace, and the council at home will be so impressed that they'll make us adults right away!",
      "Year 5 of trials, day 99",
      "Why did it go so wrong? We were just about to get the goods back, but there are MONSTERS in there! I'm not going anywhere near that giant snake, and I think the others agree with me. We're cold and hungry and can't go back to the town, because we got drunk in the inn and then couldn't pay. It's so bad that we've had to burn bits of my diary to keep warm.",
      "Someone, please help us...",
    ];
  }

  // ==========================================================================
  // Ladders, zones, boss
  // ==========================================================================

  function handleClimb(request) {
    if (!request || request.handled || !request.player) return;
    const { player } = request;
    if (request.objectId === LIGHT_EXIT_MULTILOC_ID) {
      if (quest.getStage(player) === 0 || royalMisc(player) < MISC_BOSS) return;
      request.handled = true;
      climbCaveExit(player);
      return;
    }
    if (request.objectId !== LADDER_DOWN_OBJECT_ID) return;
    if (quest.isComplete(player)) return; // the regent may visit the dungeon freely
    if (quest.getStage(player) === 0 || royalMisc(player) < MISC_SCROLL || !held(player, SCROLL_ITEM_ID)) {
      request.handled = true;
      playVariant(player, DUNGEON_GUARD_NPC_ID, V_GUARD_NO_SCROLL);
      return;
    }
    if (royalMisc(player) === MISC_SCROLL) {
      playVariant(player, DUNGEON_GUARD_NPC_ID, V_GUARD_SCROLL);
    }
  }

  function handleZoneEnter({ player, zone }) {
    if (!player || quest.getStage(player) === 0) return;
    if (zone === DUNGEON_ZONE) {
      if (royalMisc(player) >= MISC_SCROLL && royalMisc(player) < MISC_DUNGEON) {
        setRoyalMisc(player, MISC_DUNGEON);
      }
      return;
    }
    if (zone === BOSS_ROOM_ZONE) {
      ensureBoss(player);
      recoverHeavyBox(player);
    }
  }

  function handleBossRoomExit({ player }) {
    if (player) clearBoss(player);
  }

  function ownsHeavyBox(player) {
    if (held(player, HEAVY_BOX_ITEM_ID)) return true;
    if ((player.getBank?.()?.getAmount?.(HEAVY_BOX_ITEM_ID) ?? 0) > 0) return true;
    return Boolean(api.getItemOnGroundManager?.().getGroundItemById?.(HEAVY_BOX_ITEM_ID, player));
  }

  /** A single reachable copy: death, expiry, relog and re-entry all use the captured tile. */
  function dropHeavyBox(player) {
    if (!player || ownsHeavyBox(player)) return false;
    const groundItems = api.getItemOnGroundManager?.();
    if (!groundItems) return false;
    groundItems.registerLocation(
      player,
      new Item(HEAVY_BOX_ITEM_ID, 1),
      new Location(HEAVY_BOX_TILE.x, HEAVY_BOX_TILE.y, 0)
    );
    return true;
  }

  function recoverHeavyBox(player) {
    if (!player || quest.getStage(player) === 0 || quest.isComplete(player)) return;
    if (royalMisc(player) < MISC_BOSS) return;
    dropHeavyBox(player);
  }

  function ensureBoss(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const misc = royalMisc(player);
    if (misc < MISC_KIDS || misc >= MISC_BOSS || quest.isComplete(player)) return;
    if (bosses.has(player)) return;
    const npc = api.spawnNpc({
      id: GIANT_SEA_SNAKE_NPC_ID,
      x: BOSS_TILE.x,
      y: BOSS_TILE.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) bosses.set(player, npc);
  }

  function clearBoss(player) {
    const npc = bosses.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    bosses.delete(player);
  }

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (npcId !== GIANT_SEA_SNAKE_NPC_ID || !killer || !npc) return;
    if (bosses.get(killer) !== npc) return;
    bosses.delete(killer);
    if (quest.getStage(killer) === 0) return;
    if (royalMisc(killer) < MISC_BOSS) setRoyalMisc(killer, MISC_BOSS);
    dropHeavyBox(killer);
    playMessages(killer, V_BOSS_DEAD);
  }

  // ==========================================================================
  // Journal / rewards / lifecycle
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Advisor Ghrim sent me to investigate the quarrel between King</str>",
        "<str>Vargas and Queen Sigrid.</str>",
        "<str>I repaired the dungeon lift and found the burnt diary of Armod,</str>",
        "<str>one of five Rellekkan teenagers hiding in the caves.</str>",
        "<str>I killed the giant sea snake and returned the stolen goods.</str>",
        "<str>Queen Sigrid's letter of apology brought peace once again.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_PARTNER) {
      const misc = royalMisc(player);
      const lines = [];
      if (misc >= MISC_BOSS) {
        lines.push("I should take the heavy box to <col=800000>Queen Sigrid</col> in Etceteria.");
      } else if (misc >= MISC_KIDS) {
        lines.push("I must kill the <col=800000>giant sea snake</col> in the caves and take back the stolen goods.");
      } else if (misc >= MISC_DIARY) {
        lines.push("I have the full diary. I should squeeze through the crevice and deal with the snake.");
      } else if (misc >= MISC_LIFT) {
        lines.push("The lift is working. I should explore the caves and find the burnt diary pages.");
      } else if (misc >= MISC_DONAL) {
        lines.push("Donal gave me a mining prop. I should explore the caves the dwarves uncovered,");
        lines.push("collect the burnt diary pages and find the monster.");
      } else if (misc >= MISC_SCROLL) {
        lines.push("The King gave me a scroll. I should enter the dungeons beneath the castle.");
      } else if (misc >= MISC_SAILOR) {
        lines.push("The sailor says the only visitors were some teenagers. I should ask");
        lines.push("<col=800000>King Vargas</col> for permission to enter the dungeons.");
      } else if (misc >= MISC_GHRIM) {
        lines.push("I should ask <col=800000>Advisor Ghrim</col> about the suspicious soldiers.");
      } else if (misc >= MISC_REPORTED) {
        lines.push("I should speak to <col=800000>Queen Sigrid</col> in Etceteria.");
      } else if (misc >= MISC_INVESTIGATE) {
        lines.push("I should ask the citizens of Miscellania about the thefts,");
        lines.push("then report back to <col=800000>King Vargas</col>.");
      } else {
        lines.push("I should speak to <col=800000>King Vargas</col> about the kingdom.");
      }
      if (royalEtc(player) >= ETC_BOX) {
        lines.length = 0;
        lines.push("I should deliver <col=800000>Queen Sigrid's letter</col> to King Vargas.");
      }
      return lines;
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Advisor Ghrim says King Vargas and Queen Sigrid are quarrelling again.",
        "I should talk to <col=800000>Prince Brand</col> or <col=800000>Princess Astrid</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Advisor Ghrim</col> in",
      "Miscellania Castle. It requires <col=800000>Throne of Miscellania</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.AGILITY, 5000);
    skills.addExperiences(Skill.SLAYER, 5000);
    skills.addExperiences(Skill.HITPOINTS, 5000);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendSideVarbits(player);
    recoverHeavyBox(player);
  }

  function handleLogout({ player }) {
    clearBoss(player);
    player?.getPacketSender?.().sendCameraReset();
  }

  function handlePlayerDeath({ player }) {
    clearBoss(player);
    player?.getPacketSender?.().sendCameraReset();
  }

  function handleBootstrapComplete({ player }) {
    sendSideVarbits(player);
  }

  api.persistAttribute(MISC_ATTRIBUTE);
  api.persistAttribute(ETC_ATTRIBUTE);
  api.persistAttribute(MISC_VILLAGERS_ATTRIBUTE);
  api.persistAttribute(ETC_VILLAGERS_ATTRIBUTE);
  api.persistAttribute(USED_PROP_ATTRIBUTE);
  api.persistAttribute(LIFT_ATTRIBUTE);
  api.persistAttribute(ROPELOC_ATTRIBUTE);
  api.persistAttribute(CHAPTERS_ATTRIBUTE);
  api.persistAttribute(FIRE_BITS_ATTRIBUTE);
  api.persistAttribute(DIARY_READ_ATTRIBUTE);
  api.persistAttribute(PLATFORM_TOP_ATTRIBUTE);
  api.persistAttribute(COAL_ATTRIBUTE);
  api.persistAttribute(CUTSCENE_ATTRIBUTE);
  api.persistAttribute(COINS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "royal_trouble",
    name: "Royal Trouble",
    varpId: 730,
    varbitId: VARBIT_ROYAL_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.AGILITY.getIndex(), amount: 5000, label: "Agility" },
      { skillId: Skill.SLAYER.getIndex(), amount: 5000, label: "Slayer" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 5000, label: "Hitpoints" },
    ],
    rewardItemLabel: "20,000 Coins",
    otherRewards: [
      "Access to Managing Miscellania",
      "Etceteria docking (Sailing 65)",
      "Bosun Zarah crewmate (Sailing 80)",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handleConditionChosen);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction("Guard", { "Talk-to": handleHoleGuardTalk });
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onGroundItemClick([LIFT_MANUAL_ITEM_ID], 3, handleGroundItemClick);
  api.onCustomEvent("ladders:climb", handleClimb);
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(DUNGEON_ZONE, handleZoneEnter);
  api.onZoneEnter(BOSS_ROOM_ZONE, handleZoneEnter);
  api.onZoneExit(BOSS_ROOM_ZONE, handleBossRoomExit);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
};
