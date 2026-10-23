/**
 * In Aid of the Myreque (members).
 *
 * The words come from the "In Aid of the Myreque" transcript page; this plugin
 * supplies the variant selection (Talk-to interception for the quest's cast,
 * because most of the world spawns for these NPCs are cache placeholders),
 * the prose-condition answers, the start hook, the Burgh de Rott rebuild
 * (cellar rubble, general store, bank, furnace), the Gadderanks fight, the
 * Ivan escort and the Rod of Ivandis chain, plus the completion reward.
 *
 * Stages (the native quest status reads varbit 1990 "myreque_2_quest", base
 * varp 705 "myreque2_multivar" bits 0-8; the sub-flags in 705/706 are kept
 * here as persisted attributes instead of mirroring unknown bit positions):
 *   0 unstarted, 20 Veliaf briefed, 30 food placed at the gate, 50 told about
 *   the inn cellar, 60 entrance rubble mined, 80 trapdoor opened,
 *   100 cellar cleared, 120 agreed to fix the store, 150 roof fixed,
 *   160 wall fixed, 165 crate given, 170 crate handed in, 180 bank booth
 *   fixed, 190 bank wall fixed, 200 Cornelius recruited, 205 furnace hole
 *   fixed, 210 furnace fuelled, 220 furnace lit (Castle Drakan cutscene),
 *   230 Gadderanks in the store, 240 fight, 260 Gadderanks wounded,
 *   280 Gadderanks dead / Gadderhammer, 290 Veliaf back at the store,
 *   300 return talk at the hideout, 310 Ivan escort, 320 Ivan delivered,
 *   350 library key, 360 library opened, 370 The Sleeping Seven read,
 *   380 boards removed, 390 rod mould, 400 silvthrill rod enchanted,
 *   410 Rod of Ivandis blessed, 420 complete.
 * Stage values mirror the Quest Helper plugin's step map for varbit 1990
 * (0/20/30/40-50/60-70/80-90/100/110/120-160/165/170-220/230-260/280/290/
 * 300-310/315-340/350/360-370/375-410/420). QH's final key 420 is the
 * hand-in step; the native completion threshold is 430, so the wire mapper
 * below emits 430 for the completed stage while keeping durable saves at 420.
 *
 * Source: OSRS Wiki (transcript, quick guide) and the Quest Helper plugin's
 * InAidOfTheMyreque steps/conditions for the varp ladder and sub-varbits.
 *
 * Gaps / approximations:
 * - The Burgh de Rott quest scenery (roof, walls, booth, furnace, rubble,
 *   boards, trapdoor) is not placed in this cache's maps, so it is registered
 *   as runtime objects (EaglesPeak's pattern) and swapped on repair. The swaps
 *   are world-global, so a second player sees a repaired world.
 * - NPCs the spawn file only holds as cache placeholders (Veliaf, Cornelius,
 *   Wiskit, Gadderanks, Radigad, Polmafi, Ivan, Drezel) are spawned owner-only
 *   at the canonical tiles; Florin (4454), Aurel (4445) and the swamp
 *   juvinates come from the map.
 * - No instances: the Ivan escort spawns two juvinate attackers at the swamp
 *   trek tiles and moves the player back to Paterdomus when they die; Ivan's
 *   own health/food teleport-out roll and the long/short route choice are
 *   simplified to the short route (the transcript's condition is answered
 *   "short route").
 * - Lvl-1 Enchant on the silvthrill rod uses the standard jewellery spell cast
 *   with a quest-provided result recipe.
 * - "The Sleeping Seven" read text and the "you craft a silvthrill rod"
 *   line are not in the wiki transcript pack; short standalone lines are sent.
 */
module.exports = function registerInAidOfTheMyrequeQuest(api) {
  const {
    Skill,
    Location,
    Equipment,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    GameObject,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "In Aid of the Myreque";
  const AUREL_PAGE = "Aurel";
  const DREZEL_PAGE = "Drezel";
  const START_HOOK = "quest:in-aid-of-the-myreque:start";

  const VARBIT_IN_AID_OF_THE_MYREQUE = 1990; // "myreque_2_quest" (varp 705 bits 0-8)
  const STAGE_COMPLETE_WIRE = 430; // native DB table 0 column 19 completion threshold

  const STAGE_STARTED = 20;
  const STAGE_FOOD_PLACED = 30;
  const STAGE_TOLD_INN = 50;
  const STAGE_ENTRANCE_MINED = 60;
  const STAGE_TRAPDOOR_OPEN = 80;
  const STAGE_CELLAR_CLEARED = 100;
  const STAGE_STORE_AGREED = 120;
  const STAGE_ROOF_FIXED = 150;
  const STAGE_WALL_FIXED = 160;
  const STAGE_CRATE_GIVEN = 165;
  const STAGE_CRATE_HANDED = 170;
  const STAGE_BOOTH_FIXED = 180;
  const STAGE_BANK_WALL_FIXED = 190;
  const STAGE_BANKER = 200;
  const STAGE_FURNACE_FIXED = 205;
  const STAGE_FURNACE_FUELLED = 210;
  const STAGE_FURNACE_LIT = 220;
  const STAGE_GADDERANKS = 230;
  const STAGE_FIGHT = 240;
  const STAGE_WOUNDED = 260;
  const STAGE_GADDERANKS_DEAD = 280;
  const STAGE_VELIAF_STORE = 290;
  const STAGE_HIDEOUT_TALK = 300;
  const STAGE_ESCORT = 310;
  const STAGE_DREZEL = 320;
  const STAGE_LIBRARY_KEY = 350;
  const STAGE_LIBRARY_OPEN = 360;
  const STAGE_BOOK_READ = 370;
  const STAGE_BOARDS_REMOVED = 380;
  const STAGE_MOULD = 390;
  const STAGE_ROD_ENCHANTED = 400;
  const STAGE_ROD_BLESSED = 410;
  const STAGE_COMPLETE = 420;

  // ---------------------------------------------------------------------------
  // NPCs
  // ---------------------------------------------------------------------------

  const VELIAF_NPC_IDS = new Set([
    NpcIdentifiers.VELIAF_HURTZ, // 989
    NpcIdentifiers.VELIAF_HURTZ_2, // 5048
    15879, // Veliaf Hurtz (cache id, no identifier)
    15885, // Veliaf Hurtz (cache id, no identifier)
  ]);
  const AUREL_NPC_IDS = new Set([NpcIdentifiers.AUREL]); // 4445 (world spawn)
  const FLORIN_NPC_IDS = new Set([NpcIdentifiers.FLORIN]); // 4454 (world spawn)
  const IVAN_NPC_IDS = new Set([
    NpcIdentifiers.IVAN_STROM, // 4440
    NpcIdentifiers.IVAN_STROM_2, // 4441
    NpcIdentifiers.IVAN_STROM_3, // 5053
    NpcIdentifiers.IVAN_STROM_5, // 9531
    NpcIdentifiers.IVAN_STROM_6, // 9532
    NpcIdentifiers.IVAN_STROM_7, // 9533
    NpcIdentifiers.IVAN_STROM_8, // 9534
    NpcIdentifiers.IVAN_STROM_9, // 9535
    NpcIdentifiers.IVAN_STROM_10, // 9536
    NpcIdentifiers.IVAN_STROM_11, // 9631
  ]);
  const GADDERANKS_NPC_IDS = new Set([
    NpcIdentifiers.GADDERANKS, // 4483
    NpcIdentifiers.GADDERANKS_2, // 4484
    NpcIdentifiers.GADDERANKS_3, // 4485
    NpcIdentifiers.GADDERANKS_4, // 9635
  ]);
  const WISKIT_NPC_IDS = new Set([NpcIdentifiers.WISKIT, NpcIdentifiers.WISKIT_2]); // 4480, 9634
  const JUVI_PEACEFUL_NPC_IDS = new Set([
    NpcIdentifiers.VAMPYRE_JUVINATE, // 3694
    NpcIdentifiers.VAMPYRE_JUVINATE_2, // 3695
  ]);
  const FLORIN_GROUP_NPC_IDS = new Set([NpcIdentifiers.FLORIN]); // 4454
  const RAZVAN_GROUP_NPC_IDS = new Set([
    NpcIdentifiers.VASILE, // 4467
    NpcIdentifiers.RAZVAN, // 4468
    NpcIdentifiers.LUMINATA, // 4469
  ]);
  const JUVI_FIGHT_NPC_IDS = new Set([
    NpcIdentifiers.VAMPYRE_JUVINATE_15, // 4486
    NpcIdentifiers.VAMPYRE_JUVINATE_16, // 4487
  ]);
  const DREZEL_NPC_ID = NpcIdentifiers.DREZEL; // 9636
  const CORNELIUS_NPC_ID = NpcIdentifiers.CORNELIUS; // 4470
  const RAZVAN_NPC_ID = NpcIdentifiers.RAZVAN; // 4468
  const POLMAFI_NPC_ID = NpcIdentifiers.POLMAFI_FERDYGRIS; // 5052
  const RADIGAD_NPC_ID = NpcIdentifiers.RADIGAD_PONFIT; // 5051
  const GADDERANKS_PEACE_ID = NpcIdentifiers.GADDERANKS; // 4483
  const GADDERANKS_FIGHT_ID = NpcIdentifiers.GADDERANKS_2; // 4484
  const GADDERANKS_WOUNDED_ID = NpcIdentifiers.GADDERANKS_3; // 4485
  const JUVI_FIGHT_ID_1 = NpcIdentifiers.VAMPYRE_JUVINATE_15; // 4486
  const JUVI_FIGHT_ID_2 = NpcIdentifiers.VAMPYRE_JUVINATE_16; // 4487

  // Canonical tiles (Quest Helper's step coordinates).
  const VELIAF_HIDEOUT_TILE = { x: 3506, y: 9837, z: 0 };
  const VELIAF_STORE_TILE = { x: 3515, y: 3242, z: 0 };
  const VELIAF_BASEMENT_TILE = { x: 3494, y: 9628, z: 0 };
  const RAZVAN_TILE = { x: 3493, y: 3235, z: 0 };
  const CORNELIUS_TILE = { x: 3495, y: 3211, z: 0 };
  const WISKIT_TILE = { x: 3512, y: 3241, z: 0 };
  const GADDERANKS_TILE = { x: 3514, y: 3241, z: 0 };
  const POLMAFI_TILE = { x: 3509, y: 9838, z: 0 };
  const RADIGAD_TILE = { x: 3508, y: 9840, z: 0 };
  const IVAN_TILE = { x: 3511, y: 9841, z: 0 };
  const DREZEL_TILE = { x: 3439, y: 9896, z: 0 };
  const SWAMP_TREK_TILE = { x: 2859, y: 4564, z: 0 };
  const COFFIN_ROOM_TILE = { x: 3505, y: 9863, z: 0 };
  const LIBRARY_TILE = { x: 3355, y: 9902, z: 0 };

  // ---------------------------------------------------------------------------
  // Objects (mostly absent from this cache's maps; installed at runtime)
  // ---------------------------------------------------------------------------

  const RUBBLE_ENTRANCE_ID = ObjectIdentifiers.RUBBLE_7; // 12746, inn entrance (Mine)
  const TRAPDOOR_CLOSED_ID = ObjectIdentifiers.TRAPDOOR_50; // 12744, Open
  const TRAPDOOR_OPEN_ID = ObjectIdentifiers.TRAPDOOR_51; // 12745, Climb-down
  const RUBBLE_BASEMENT_IDS = [
    ObjectIdentifiers.RUBBLE_8, // 12812
    ObjectIdentifiers.RUBBLE_9, // 12813
    ObjectIdentifiers.RUBBLE_10, // 12814
  ];
  const PILE_OF_RUBBLE_ID = ObjectIdentifiers.PILE_OF_RUBBLE_3; // 12747
  const BROKEN_ROOF_ID = ObjectIdentifiers.BROKEN_ROOF; // 12782
  const REPAIRED_ROOF_ID = ObjectIdentifiers.REPAIRED_ROOF; // 12783
  const DAMAGED_WALL_ID = ObjectIdentifiers.DAMAGED_WALL; // 12787
  const REPAIRED_WALL_ID = ObjectIdentifiers.REPAIRED_WALL; // 12786
  const BROKEN_BOOTH_ID = ObjectIdentifiers.BANK_BOOTH_11; // 12799, Inspect
  const WORKING_BOOTH_ID = ObjectIdentifiers.BANK_BOOTH_10; // 12798, Bank
  const BROKEN_FURNACE_ID = ObjectIdentifiers.BROKEN_FURNACE; // 12806
  const REPAIRED_FURNACE_ID = ObjectIdentifiers.REPAIRED_FURNACE; // 12807, Inspect
  const REPAIRED_FURNACE_FUELLED_ID = ObjectIdentifiers.REPAIRED_FURNACE_2; // 12808, Inspect
  const WORKING_FURNACE_ID = ObjectIdentifiers.FURNACE_11; // 12809, Smelt
  const WOODEN_BOARDS_ID = ObjectIdentifiers.WOODEN_BOARDS_2; // 12773
  const LIBRARY_TRAPDOOR_ID = ObjectIdentifiers.TRAPDOOR_52; // 12763
  const OPEN_CHEST_ID = ObjectIdentifiers.OPEN_CHEST_21; // 12736
  const RUBBLE_PILE_ID = ObjectIdentifiers.RUBBLE_PILE; // 12749
  const BROKEN_WALL_INN_ID = ObjectIdentifiers.BROKEN_WALL_7; // 12737, Climb-over
  const SHOP_LADDER_UP_ID = ObjectIdentifiers.LADDER_164; // 12780
  const SHOP_LADDER_DOWN_ID = ObjectIdentifiers.LADDER_165; // 12781
  const HIDEOUT_LADDER_ID = ObjectIdentifiers.LADDER_163; // 12779, pub basement at 3490,9632
  const LIBRARY_LADDER_ID = ObjectIdentifiers.LADDER_162; // 12764
  const CAVE_ENTRANCE_TOMB_ID = ObjectIdentifiers.CAVE_ENTRANCE_47; // 12770, Enter
  const COFFIN_ID = ObjectIdentifiers.COFFIN_16; // 12802, Inspect
  const KEYHOLE_ID = ObjectIdentifiers.KEYHOLE; // 12765, Inspect
  const BOOKCASE_SEVEN_ID = ObjectIdentifiers.BOOKCASE_52; // 12767 burgh_library_bookcase_ivandis, Search
  const BOOKCASE_OTHER_ID = ObjectIdentifiers.BOOKCASE_51; // 12766 burgh_library_bookcase_history, Search
  const PATERDOMUS_WELL_ID = 3485; // "Well" at 3423,9890 (cache id, no identifier)
  const BURGH_GATE_IDS = new Set([
    ObjectIdentifiers.GATE_113, // 12816
    ObjectIdentifiers.GATE_114, // 12817
  ]);

  const ROOF_TILE = { x: 3515, y: 3240, z: 2 };
  const SHOP_WALL_TILE = { x: 3517, y: 3238, z: 0 };
  const BANK_WALL_TILE = { x: 3491, y: 3211, z: 0 };
  const BOOTH_TILE = { x: 3494, y: 3211, z: 0 };
  const FURNACE_TILE = { x: 3528, y: 3210, z: 0 };
  const ENTRANCE_TRAPDOOR_TILE = { x: 3490, y: 3232, z: 0 };
  const BASEMENT_LANDING = { x: 3494, y: 9627, z: 0 };
  const BASEMENT_RUBBLE_TILES = [
    { x: 3489, y: 9627, z: 0 },
    { x: 3491, y: 9627, z: 0 },
    { x: 3493, y: 9627, z: 0 },
  ];
  const BASEMENT_PILE_TILE = { x: 3492, y: 9627, z: 0 };
  const BOARDS_TILE = { x: 3484, y: 9832, z: 0 };
  const LIBRARY_TRAPDOOR_TILE = { x: 3441, y: 9899, z: 0 };

  // ---------------------------------------------------------------------------
  // Items
  // ---------------------------------------------------------------------------

  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET; // 1925
  const BUCKET_OF_RUBBLE_ITEM_ID = ItemIdentifiers.BUCKET_OF_RUBBLE; // 7622
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE; // 952
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK; // 960
  const HAMMER_ITEM_IDS = new Set([ItemIdentifiers.HAMMER, ItemIdentifiers.HAMMER_2]); // 2347/2348
  const PICKAXE_ITEM_IDS = new Set([
    ItemIdentifiers.BRONZE_PICKAXE,
    ItemIdentifiers.IRON_PICKAXE,
    ItemIdentifiers.STEEL_PICKAXE,
    ItemIdentifiers.MITHRIL_PICKAXE,
    ItemIdentifiers.ADAMANT_PICKAXE,
    ItemIdentifiers.RUNE_PICKAXE,
  ]);
  const NAIL_ITEM_IDS = [
    ItemIdentifiers.BRONZE_NAILS, // 4819
    ItemIdentifiers.IRON_NAILS, // 4820
    ItemIdentifiers.STEEL_NAILS, // 1539
    ItemIdentifiers.BLACK_NAILS, // 4821
    ItemIdentifiers.MITHRIL_NAILS, // 4822
    ItemIdentifiers.ADAMANTITE_NAILS, // 4823
    ItemIdentifiers.RUNE_NAILS, // 4824
  ];
  const SWAMP_PASTE_ITEM_ID = ItemIdentifiers.SWAMP_PASTE; // 1941
  const BRONZE_AXE_ITEM_ID = ItemIdentifiers.BRONZE_AXE; // 1351
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const RAW_MACKEREL_ITEM_ID = ItemIdentifiers.RAW_MACKEREL; // 353
  const SNAIL_MEAT_ITEM_IDS = new Set([
    ItemIdentifiers.THIN_SNAIL_MEAT, // 3369
    ItemIdentifiers.LEAN_SNAIL_MEAT, // 3371
    ItemIdentifiers.FAT_SNAIL_MEAT, // 3373
  ]);
  // The crate takes either raw or cooked snails (QH setup supplies raw
  // SNAIL_CORPSE1/2/3; the wiki says either version works).
  const CRATE_SNAIL_ITEM_IDS = new Set([
    ItemIdentifiers.THIN_SNAIL, // 3363
    ItemIdentifiers.LEAN_SNAIL, // 3365
    ItemIdentifiers.FAT_SNAIL, // 3367
    ...SNAIL_MEAT_ITEM_IDS,
  ]);
  const COINS_ITEM_ID = ItemIdentifiers.COINS; // 995
  const STEEL_BAR_ITEM_ID = ItemIdentifiers.STEEL_BAR; // 2353
  const COAL_ITEM_ID = ItemIdentifiers.COAL; // 453
  const SOFT_CLAY_ITEM_ID = ItemIdentifiers.SOFT_CLAY; // 1761
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const SILVER_BAR_ITEM_ID = ItemIdentifiers.SILVER_BAR; // 2355
  const MITHRIL_BAR_ITEM_ID = ItemIdentifiers.MITHRIL_BAR; // 2359
  const SAPPHIRE_ITEM_ID = ItemIdentifiers.SAPPHIRE; // 1607
  const CRATE_EMPTY_ITEM_ID = ItemIdentifiers.CRATE; // 7630
  const CRATE_FULL_ITEM_ID = ItemIdentifiers.CRATE_2; // 7631
  const TEMPLE_LIBRARY_KEY_ITEM_ID = ItemIdentifiers.TEMPLE_LIBRARY_KEY; // 7632
  const SLEEPING_SEVEN_ITEM_ID = ItemIdentifiers.THE_SLEEPING_SEVEN; // 7633
  const ROD_MOULD_ITEM_ID = ItemIdentifiers.ROD_MOULD; // 7649
  const SILVTHRILL_ROD_ITEM_ID = ItemIdentifiers.SILVTHRILL_ROD_2; // 7637, unenchanted
  const ENCHANTED_SILVTHRILL_ROD_ITEM_ID = ItemIdentifiers.SILVTHRILL_ROD_3; // 7638
  const ROD_OF_IVANDIS_ITEM_ID = ItemIdentifiers.ROD_OF_IVANDIS_10_; // 7639, 10 charges
  const GADDERHAMMER_ITEM_ID = ItemIdentifiers.GADDERHAMMER; // 7668
  const STEEL_HELM_ITEM_ID = ItemIdentifiers.STEEL_MED_HELM; // 1141
  const STEEL_CHAIN_ITEM_ID = ItemIdentifiers.STEEL_CHAINBODY; // 1105
  const STEEL_LEGS_ITEM_ID = ItemIdentifiers.STEEL_PLATELEGS; // 1069
  const SILVER_SICKLE_ITEM_ID = ItemIdentifiers.SILVER_SICKLE; // 2961
  const COOKED_SLIMY_EEL_ITEM_ID = ItemIdentifiers.COOKED_SLIMY_EEL; // 3381
  const SALMON_ITEM_ID = ItemIdentifiers.SALMON; // 329
  const STEW_ITEM_ID = ItemIdentifiers.STEW; // 2003
  const IVAN_FOOD_ITEM_IDS = new Set([
    COOKED_SLIMY_EEL_ITEM_ID,
    SALMON_ITEM_ID,
    STEW_ITEM_ID,
    ...SNAIL_MEAT_ITEM_IDS,
  ]);

  /** Any edible food accepted by the gate chest (the wiki asks for "any food"). */
  const FOOD_ITEM_IDS = new Set([
    ItemIdentifiers.SHRIMPS, // 315
    ItemIdentifiers.ANCHOVIES, // 319
    ItemIdentifiers.SARDINE, // 325
    ItemIdentifiers.SALMON, // 329
    ItemIdentifiers.TROUT, // 333
    ItemIdentifiers.HERRING, // 347
    ItemIdentifiers.MACKEREL, // 355
    ItemIdentifiers.TUNA, // 361
    ItemIdentifiers.BASS, // 365
    ItemIdentifiers.SWORDFISH, // 373
    ItemIdentifiers.LOBSTER, // 379
    ItemIdentifiers.SHARK, // 385
    ItemIdentifiers.BREAD, // 2309
    ItemIdentifiers.STEW, // 2003
    ItemIdentifiers.CAKE, // 1891
    ItemIdentifiers.MEAT_PIE, // 2327
    ItemIdentifiers.COOKED_MEAT, // 2142
    ItemIdentifiers.COOKED_CHICKEN, // 2140
    ItemIdentifiers.RAW_MACKEREL, // 353
    ...SNAIL_MEAT_ITEM_IDS,
  ]);

  // ---------------------------------------------------------------------------
  // Sub-state bits and counters (persisted attributes)
  // ---------------------------------------------------------------------------

  const BITS_ATTRIBUTE = "quest.in_aid_of_the_myreque.bits";
  const BIT_AUREL_MET = 1 << 0;
  const BIT_AUREL_AGAIN = 1 << 1;
  const BIT_GADDERANKS_TALKED = 1 << 2;
  const BIT_JUVI_TALKED = 1 << 3;
  const BIT_WISKIT_TALKED = 1 << 4;
  const BIT_MEMBERS_INFORMED = 1 << 5;
  const BIT_IVAN_HELM = 1 << 6;
  const BIT_IVAN_BODY = 1 << 7;
  const BIT_IVAN_LEGS = 1 << 8;
  const BIT_IVAN_SICKLE = 1 << 9;
  const BIT_RUBBLE_1 = 1 << 10;
  const BIT_RUBBLE_2 = 1 << 11;
  const BIT_RUBBLE_3 = 1 << 12;
  const BIT_VELIAF_HIDEOUT_MET = 1 << 13;

  const CRATE_AXES_ATTRIBUTE = "quest.in_aid_of_the_myreque.crate.axes";
  const CRATE_FISH_ATTRIBUTE = "quest.in_aid_of_the_myreque.crate.fish";
  const CRATE_FISH_TYPE_ATTRIBUTE = "quest.in_aid_of_the_myreque.crate.fishtype"; // 0 mackerel, 1 snail
  const CRATE_TINDER_ATTRIBUTE = "quest.in_aid_of_the_myreque.crate.tinder";
  const CRATE_REFUSED_ATTRIBUTE = "quest.in_aid_of_the_myreque.crate.refused";
  const IVAN_FOOD_ATTRIBUTE = "quest.in_aid_of_the_myreque.ivan.food";
  const ENCOUNTER_ATTRIBUTE = "quest.in_aid_of_the_myreque.encounter";
  const FIGHT_ATTRIBUTE = "quest.in_aid_of_the_myreque.fight";

  const CRATE_AXES_NEEDED = 10;
  const CRATE_FISH_NEEDED = 10;
  const CRATE_TINDER_NEEDED = 3;
  const IVAN_FOOD_MAX = 15;

  const REWARD_SKILLS = [
    { skill: Skill.ATTACK, label: "Attack" },
    { skill: Skill.STRENGTH, label: "Strength" },
    { skill: Skill.CRAFTING, label: "Crafting" },
    { skill: Skill.DEFENCE, label: "Defence" },
  ];
  const REWARD_XP = 2000;

  let quest;
  let objectsInstalled = false;
  const spawnedByPlayer = new Map();
  const installedObjects = [];

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function give(player, itemId, amount = 1) {
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function hasBit(player, bit) {
    return ((Number(player.getAttribute(BITS_ATTRIBUTE)) || 0) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, (Number(player.getAttribute(BITS_ATTRIBUTE)) || 0) | bit);
  }

  function attributeNumber(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function advance(player, stage) {
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
    applyStageSpawns(player);
  }

  function play(player, npcId, variant, select, page = PAGE) {
    return startTranscript(api, player, npcId, page, variant, select);
  }

  const hasHammer = (player) => [...HAMMER_ITEM_IDS].some((id) => held(player, id));

  function countNails(player) {
    return NAIL_ITEM_IDS.reduce((sum, id) => sum + player.getInventory().getAmount(id), 0);
  }

  function removeNails(player, amount) {
    let left = amount;
    for (const id of NAIL_ITEM_IDS) {
      if (left <= 0) return;
      const have = player.getInventory().getAmount(id);
      const take = Math.min(have, left);
      if (take > 0) {
        player.getInventory().deleteNumber(id, take);
        left -= take;
      }
    }
  }

  function hasRepairKit(player, planks, nails) {
    return hasHammer(player) && held(player, PLANK_ITEM_ID, planks) && countNails(player) >= nails;
  }

  function countFish(player) {
    let count = player.getInventory().getAmount(RAW_MACKEREL_ITEM_ID);
    for (const id of CRATE_SNAIL_ITEM_IDS) count += player.getInventory().getAmount(id);
    return count;
  }

  function hasPickaxe(player) {
    return [...PICKAXE_ITEM_IDS].some((id) => held(player, id));
  }

  function wearingRod(player) {
    return player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === ROD_OF_IVANDIS_ITEM_ID;
  }

  /** Every NPC whose lines our page may speak; the text filler is scoped to these. */
  const OWN_TEXT_NPC_IDS = new Set([
    ...VELIAF_NPC_IDS,
    ...IVAN_NPC_IDS,
    ...GADDERANKS_NPC_IDS,
    ...WISKIT_NPC_IDS,
    ...JUVI_PEACEFUL_NPC_IDS,
    ...JUVI_FIGHT_NPC_IDS,
    NpcIdentifiers.AUREL,
    NpcIdentifiers.FLORIN,
    NpcIdentifiers.RAZVAN,
    NpcIdentifiers.CORNELIUS,
    NpcIdentifiers.POLMAFI_FERDYGRIS,
    NpcIdentifiers.RADIGAD_PONFIT,
    NpcIdentifiers.DREZEL,
  ]);

  /** Player-owned house location ids (native POH_HOUSE_LOCATION enum 252 order). */
  const POH_HOUSE_ATTRIBUTE = "construction:house";
  const POH_LOCATION_NAMES = new Map([
    [1, "Rimmington"],
    [2, "Taverley"],
    [3, "Pollnivneach"],
    [8, "Hosidius"],
    [4, "Rellekka"],
    [13, "Aldarin"],
    [5, "Brimhaven"],
    [6, "Yanille"],
    [9, "Prifddinas"],
  ]);

  function playerHouseLocation(player) {
    const save = player.getAttribute?.(POH_HOUSE_ATTRIBUTE);
    const id = save && typeof save === "object" ? Number(save.location) : NaN;
    return POH_LOCATION_NAMES.get(id) ?? "Rimmington";
  }

  /** Fills the wiki transcript's prose placeholders with live values. */
  function fillTranscriptText(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!OWN_TEXT_NPC_IDS.has(request.npcId)) return;
    // The crate handout with a full inventory: drop the follow-up line and
    // clear the refusal flag now that the false reassurance is gone.
    if (
      request.text === "There you go. You can put them in that." &&
      request.player.getAttribute?.(CRATE_REFUSED_ATTRIBUTE)
    ) {
      request.player.setAttribute(CRATE_REFUSED_ATTRIBUTE, 0);
      request.skip = true;
      return;
    }
    let text = request.text;
    if (text.includes("[He/She]")) {
      const male = request.player.getAppearance?.()?.isMale?.() !== false;
      text = text.replace(/\[He\/She\]/g, male ? "He" : "She");
    }
    if (text.includes("[player name]")) {
      text = text.replace(/\[player name\]/gi, String(request.player.getUsername()));
    }
    if (text.includes("[citizen name]")) {
      const name = request.definition?.getName?.() || "Citizen";
      text = text.replace(/\[citizen name\]/gi, name);
    }
    if (text.includes("[location of player-owned house]")) {
      text = text.replace(/\[location of player-owned house\]/gi, playerHouseLocation(request.player));
    }
    request.text = text;
  }

  // ---------------------------------------------------------------------------
  // Spawns
  // ---------------------------------------------------------------------------

  function spawnKey(player, key, npcId, tile) {
    // Load-test bots run every login hook; never give them owner-only quest NPCs.
    if (!player || player.isPlayerBot?.() === true) return;
    let map = spawnedByPlayer.get(player);
    if (!map) {
      map = new Map();
      spawnedByPlayer.set(player, map);
    }
    const existing = map.get(key);
    if (existing) {
      if (existing.getId?.() === npcId && existing.getLocation()?.equals?.(new Location(tile.x, tile.y, tile.z))) {
        return;
      }
      api.removeNpc(existing);
      map.delete(key);
    }
    const npc = api.spawnNpc({
      id: npcId,
      x: tile.x,
      y: tile.y,
      z: tile.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) map.set(key, npc);
  }

  function despawnKey(player, key) {
    const map = spawnedByPlayer.get(player);
    const npc = map?.get(key);
    if (!npc) return;
    api.removeNpc(npc);
    map.delete(key);
  }

  function despawnAll(player) {
    const map = spawnedByPlayer.get(player);
    if (!map) return;
    for (const npc of map.values()) api.removeNpc(npc);
    map.clear();
    spawnedByPlayer.delete(player);
  }

  /** Ensures exactly the static quest NPCs the current stage needs are present. */
  function applyStageSpawns(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    // Veliaf is met in the Hollows hideout at the start and again before the escort.
    if (stage < STAGE_STARTED || (stage >= STAGE_VELIAF_STORE && stage < STAGE_DREZEL)) {
      spawnKey(player, "veliaf_old", NpcIdentifiers.VELIAF_HURTZ_2, VELIAF_HIDEOUT_TILE);
    } else {
      despawnKey(player, "veliaf_old");
    }
    // The citizen who points at the inn, once the town opens up.
    if (stage >= STAGE_FOOD_PLACED && stage < STAGE_STORE_AGREED) {
      spawnKey(player, "razvan", RAZVAN_NPC_ID, RAZVAN_TILE);
    } else {
      despawnKey(player, "razvan");
    }
    // The bank's future teller, waiting by the booths.
    if (stage >= STAGE_CRATE_HANDED && stage < STAGE_COMPLETE) {
      spawnKey(player, "cornelius", CORNELIUS_NPC_ID, CORNELIUS_TILE);
    } else {
      despawnKey(player, "cornelius");
    }
    // The blood-tithe scene in the general store.
    if (stage >= STAGE_GADDERANKS && stage < STAGE_FIGHT) {
      spawnKey(player, "gad_peace", GADDERANKS_PEACE_ID, GADDERANKS_TILE);
      spawnKey(player, "juv_peace1", NpcIdentifiers.VAMPYRE_JUVINATE, { x: 3513, y: 3241, z: 0 });
      spawnKey(player, "juv_peace2", NpcIdentifiers.VAMPYRE_JUVINATE_2, { x: 3513, y: 3242, z: 0 });
      spawnKey(player, "wiskit", NpcIdentifiers.WISKIT, WISKIT_TILE);
    } else {
      despawnKey(player, "gad_peace");
      despawnKey(player, "juv_peace1");
      despawnKey(player, "juv_peace2");
      if (stage < STAGE_GADDERANKS || stage >= STAGE_DREZEL) despawnKey(player, "wiskit");
    }
    // The fight itself (re-spawns whatever has not died yet after a login).
    if (stage === STAGE_FIGHT) {
      const deaths = attributeNumber(player, FIGHT_ATTRIBUTE);
      spawnKey(player, "gad_fight", GADDERANKS_FIGHT_ID, GADDERANKS_TILE);
      if (deaths < 1) spawnKey(player, "juv_fight1", JUVI_FIGHT_ID_1, { x: 3512, y: 3242, z: 0 });
      if (deaths < 2) spawnKey(player, "juv_fight2", JUVI_FIGHT_ID_2, { x: 3514, y: 3242, z: 0 });
    } else {
      despawnKey(player, "gad_fight");
      despawnKey(player, "juv_fight1");
      despawnKey(player, "juv_fight2");
    }
    // Gadderanks wounded, then Veliaf arriving in the store.
    if (stage >= STAGE_WOUNDED && stage < STAGE_GADDERANKS_DEAD) {
      spawnKey(player, "gad_wounded", GADDERANKS_WOUNDED_ID, GADDERANKS_TILE);
    } else {
      despawnKey(player, "gad_wounded");
    }
    if (stage >= STAGE_GADDERANKS_DEAD && stage < STAGE_VELIAF_STORE) {
      spawnKey(player, "veliaf_store", NpcIdentifiers.VELIAF_HURTZ_2, VELIAF_STORE_TILE);
    } else {
      despawnKey(player, "veliaf_store");
    }
    // The Myreque, back in the Hollows for the escort.
    if (stage >= STAGE_VELIAF_STORE && stage < STAGE_DREZEL) {
      spawnKey(player, "polmafi", POLMAFI_NPC_ID, POLMAFI_TILE);
      spawnKey(player, "radigad", RADIGAD_NPC_ID, RADIGAD_TILE);
      spawnKey(player, "ivan", NpcIdentifiers.IVAN_STROM_3, IVAN_TILE);
    } else {
      despawnKey(player, "polmafi");
      despawnKey(player, "radigad");
      despawnKey(player, "ivan");
    }
    // The escort ambush (only after the encounter has started).
    if (stage === STAGE_ESCORT) {
      const deaths = attributeNumber(player, ENCOUNTER_ATTRIBUTE);
      if (deaths < 1) spawnKey(player, "escort1", JUVI_FIGHT_ID_1, { x: 2855, y: 4560, z: 0 });
      if (deaths < 2) spawnKey(player, "escort2", JUVI_FIGHT_ID_2, { x: 2863, y: 4568, z: 0 });
    } else {
      despawnKey(player, "escort1");
      despawnKey(player, "escort2");
    }
    // Drezel receives Ivan and stays in the temple afterwards (the canonical
    // lost-library-key recovery page is only reachable if he remains present).
    if (stage >= STAGE_DREZEL) {
      spawnKey(player, "drezel", DREZEL_NPC_ID, DREZEL_TILE);
    } else {
      despawnKey(player, "drezel");
    }
    // Veliaf at the new Burgh de Rott hideout for the rod hand-in and afterwards.
    if (stage >= STAGE_COMPLETE) {
      // Completed: make sure the Hollows hideout and store copies are gone
      // immediately; the Burgh cellar Veliaf stays for the post-quest talk.
      despawnKey(player, "veliaf_old");
      despawnKey(player, "veliaf_store");
      spawnKey(player, "veliaf_base", NpcIdentifiers.VELIAF_HURTZ_2, VELIAF_BASEMENT_TILE);
    } else if (stage >= STAGE_HIDEOUT_TALK) {
      spawnKey(player, "veliaf_base", NpcIdentifiers.VELIAF_HURTZ_2, VELIAF_BASEMENT_TILE);
    } else {
      despawnKey(player, "veliaf_base");
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime quest scenery (absent from this cache's maps)
  // ---------------------------------------------------------------------------

  function registerObject(objectId, tile, type = 10) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, tile.z), type, 0, null);
    ObjectManager.register(object, true);
    installedObjects.push(object);
    return object;
  }

  function installedAt(objectId, tile) {
    return installedObjects.some(
      (object) =>
        object.getId() === objectId &&
        object.getLocation().getX() === tile.x &&
        object.getLocation().getY() === tile.y &&
        object.getLocation().getZ() === tile.z
    );
  }

  function installQuestObjects() {
    if (objectsInstalled) return;
    objectsInstalled = true;
    registerObject(RUBBLE_ENTRANCE_ID, ENTRANCE_TRAPDOOR_TILE);
    for (let index = 0; index < RUBBLE_BASEMENT_IDS.length; index++) {
      registerObject(RUBBLE_BASEMENT_IDS[index], BASEMENT_RUBBLE_TILES[index]);
    }
    registerObject(BROKEN_ROOF_ID, ROOF_TILE);
    registerObject(DAMAGED_WALL_ID, SHOP_WALL_TILE);
    registerObject(DAMAGED_WALL_ID, BANK_WALL_TILE);
    registerObject(BROKEN_BOOTH_ID, BOOTH_TILE);
    registerObject(BROKEN_FURNACE_ID, FURNACE_TILE);
    registerObject(WOODEN_BOARDS_ID, BOARDS_TILE);
  }

  /** Replaces one of our installed objects with the repaired/next-state id. */
  function swapObject(oldId, newId, tile) {
    removeInstalled(oldId, tile);
    registerObject(newId, tile);
  }

  function removeInstalled(objectId, tile) {
    for (let index = installedObjects.length - 1; index >= 0; index--) {
      const object = installedObjects[index];
      if (
        object.getId() === objectId &&
        object.getLocation().getX() === tile.x &&
        object.getLocation().getY() === tile.y &&
        object.getLocation().getZ() === tile.z
      ) {
        ObjectManager.deregister(object, true);
        installedObjects.splice(index, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Requirements
  // ---------------------------------------------------------------------------

  const REQUIRED_QUESTS = [
    { key: "in_search_of_the_myreque", name: "In Search of the Myreque" },
    { key: "nature_spirit", name: "Nature Spirit" },
    { key: "priest_in_peril", name: "Priest in Peril" },
    { key: "the_restless_ghost", name: "The Restless Ghost" },
  ];
  const REQUIRED_SKILLS = [
    { skill: Skill.CRAFTING, level: 25, label: "Crafting" },
    { skill: Skill.MINING, level: 15, label: "Mining" },
    { skill: Skill.MAGIC, level: 7, label: "Magic" },
    { skill: Skill.AGILITY, level: 25, label: "Agility" },
  ];

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    for (const requirement of REQUIRED_QUESTS) {
      if (!questComplete(player, requirement.key)) return false;
    }
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.every((entry) => skills.getMaxLevel(entry.skill) >= entry.level);
  }

  function requirementsMessage(player) {
    for (const requirement of REQUIRED_QUESTS) {
      if (!questComplete(player, requirement.key)) {
        player.sendMessage(`You must have completed ${requirement.name} to start this quest.`);
      }
    }
    const skills = player.getSkillManager();
    for (const entry of REQUIRED_SKILLS) {
      if (skills.getMaxLevel(entry.skill) < entry.level) {
        player.sendMessage(`You need ${entry.level} ${entry.label} to start this quest.`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Journal and rewards
  // ---------------------------------------------------------------------------

  function crateProgressLine(player) {
    const axes = attributeNumber(player, CRATE_AXES_ATTRIBUTE);
    const fish = attributeNumber(player, CRATE_FISH_ATTRIBUTE);
    const tinder = attributeNumber(player, CRATE_TINDER_ATTRIBUTE);
    const fishName = attributeNumber(player, CRATE_FISH_TYPE_ATTRIBUTE) === 1 ? "snail meat" : "raw mackerel";
    return [
      `Bronze axes: ${axes}/${CRATE_AXES_NEEDED}`,
      `${fishName}: ${fish}/${CRATE_FISH_NEEDED}`,
      `Tinderboxes: ${tinder}/${CRATE_TINDER_NEEDED}`,
    ];
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Veliaf asked me to help the Myreque find a new home in</str>",
        "<str>Burgh de Rott. I cleared the inn cellar, repaired and</str>",
        "<str>stocked the general store and bank, and lit the furnace.</str>",
        "<str>We defeated Gadderanks and his juvinates, and I escorted</str>",
        "<str>Ivan to Paterdomus, where Drezel gave me the library key.</str>",
        "<str>I made the Rod of Ivandis and gave it to Veliaf.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to <col=800000>Veliaf Hurtz</col>",
        "in the <col=800000>Myreque Hideout</col> beneath the Canifis pub.",
        "",
        "I have completed In Search of the Myreque, Nature Spirit,",
        "Priest in Peril and The Restless Ghost, with 25 Crafting,",
        "15 Mining, 7 Magic and 25 Agility.",
      ];
    }
    const lines = [
      "<str>Veliaf asked me to find a new base for the Myreque in</str>",
      "<str>Burgh de Rott and to win over the townspeople.</str>",
      "",
    ];
    if (stage < STAGE_FOOD_PLACED) {
      lines.push("I should travel to <col=800000>Burgh de Rott</col> south of Mort'ton.");
      return lines;
    }
    if (stage < STAGE_TOLD_INN) {
      lines.push("The gate is barred. I need a citizen to talk to me about the town.");
      return lines;
    }
    if (stage < STAGE_CELLAR_CLEARED) {
      lines.push("I need to clear the <col=800000>rubble</col> out of the inn cellar.");
      return lines;
    }
    if (stage < STAGE_CRATE_HANDED) {
      lines.push("I am helping <col=800000>Aurel</col> fix up the general store.");
      if (stage >= STAGE_CRATE_GIVEN) {
        lines.push("The crate needs:");
        lines.push(...crateProgressLine(player));
      }
      return lines;
    }
    if (stage < STAGE_BANKER) {
      lines.push("I am repairing the <col=800000>bank</col> in Burgh de Rott.");
      return lines;
    }
    if (stage < STAGE_FURNACE_LIT) {
      lines.push("I am repairing and lighting the <col=800000>furnace</col>.");
      return lines;
    }
    if (stage < STAGE_GADDERANKS_DEAD) {
      lines.push("Gadderanks is taking a blood tithe from Burgh de Rott.");
      lines.push("I should defend the town.");
      return lines;
    }
    if (stage < STAGE_HIDEOUT_TALK) {
      lines.push("I should speak with <col=800000>Veliaf</col> and return to the hideout.");
      return lines;
    }
    if (stage < STAGE_DREZEL) {
      lines.push("I am escorting <col=800000>Ivan Strom</col> to Paterdomus.");
      return lines;
    }
    if (stage < STAGE_LIBRARY_OPEN) {
      lines.push("I should ask <col=800000>Drezel</col> about Ivandis' tomb.");
      return lines;
    }
    if (stage < STAGE_BOARDS_REMOVED) {
      lines.push("I should search the <col=800000>library</col> under Paterdomus.");
      return lines;
    }
    if (stage < STAGE_ROD_BLESSED) {
      lines.push("I am recreating the <col=800000>Rod of Ivandis</col> from the tomb.");
      return lines;
    }
    if (stage < STAGE_COMPLETE) {
      lines.push("I should give the <col=800000>Rod of Ivandis</col> to Veliaf in Burgh de Rott.");
      return lines;
    }
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    for (const reward of REWARD_SKILLS) skills.addExperiences(reward.skill, REWARD_XP);
    // Completion does not run our advance(), so sync spawns here: the hideout
    // and store copies go, the Burgh cellar Veliaf stays for the post-quest talk.
    applyStageSpawns(player);
  }

  // ---------------------------------------------------------------------------
  // Dialogue: variants and prose conditions
  // ---------------------------------------------------------------------------

  /** Which variant a Talk-to handler plays; handlers pick by stage directly. */

  function answerCondition({ player, npcId, text, stepId, pages }) {
    if (Array.isArray(pages) && !pages.some((entry) => entry?.page === PAGE || entry?.page === AUREL_PAGE || entry?.page === DREZEL_PAGE)) return null;
    const inventory = player.getInventory();
    const has = (itemId) => inventory.getAmount(itemId) > 0;
    const stage = quest.getStage(player);
    switch (stepId) {
      // Repairs.
      case "36z-of": // roof, missing items
      case "kBrHJW": // shop wall, missing items
      case "CX67v-": // bank wall, missing items
        return !hasRepairKit(player, 3, 12);
      case "QvHBD5": // roof, has items
      case "JHVR_s": // shop wall
      case "5z92aE": // bank wall
        return hasRepairKit(player, 3, 12);
      case "kpavfL": // booth, missing items
        return !hasRepairKit(player, 2, 8) || !has(SWAMP_PASTE_ITEM_ID);
      case "kwODKc": // furnace hole, missing items
        return !hasHammer(player) || !held(player, STEEL_BAR_ITEM_ID, 2);
      case "EEIDrs": // booth
        return hasRepairKit(player, 2, 8) && has(SWAMP_PASTE_ITEM_ID);
      case "h2dEwU": // furnace hole
        return hasHammer(player) && held(player, STEEL_BAR_ITEM_ID, 2);
      case "qRh9jX": // furnace fuel, missing coal
        return !has(COAL_ITEM_ID);
      case "6cW9G2": // furnace fuel, has coal
        return has(COAL_ITEM_ID);
      case "iGHWLk": // furnace light, missing tinderbox
        return !has(TINDERBOX_ITEM_ID);
      case "hnlXcN": // furnace light, has tinderbox
        return has(TINDERBOX_ITEM_ID);
      // Crate state.
      case "kiuzfV": // empty
        return crateFilledCount(player) === 0;
      case "0xNk84": // filled
        return crateComplete(player);
      case "1ERwdb": // partially filled
        return crateFilledCount(player) > 0 && !crateComplete(player);
      case "q11mmS": // shop not yet stocked
        return stage < STAGE_CRATE_HANDED;
      case "0EKc0N": // shop stocked
        return stage >= STAGE_CRATE_HANDED;
      // Aurel's talk branches.
      case "UXJgpJ": // first time after the inn
        return !hasBit(player, BIT_AUREL_MET);
      case "_npW-_": // talking again
        return hasBit(player, BIT_AUREL_MET);
      case "tg-CGu": // after roof and wall, first time
        return stage >= STAGE_WALL_FIXED && !hasBit(player, BIT_AUREL_AGAIN);
      case "otUEZ9": // after roof and wall, talking again
        return stage >= STAGE_WALL_FIXED && hasBit(player, BIT_AUREL_AGAIN);
      case "4l7-ER": // after fully helping
        return stage >= STAGE_CRATE_HANDED;
      case "I7YCBd": // before offering
        return stage < STAGE_STORE_AGREED;
      case "LaTy2V": // after offering, before fixing
        return stage >= STAGE_STORE_AGREED && stage < STAGE_WALL_FIXED;
      case "Dc8raD": // after fixing
        return stage >= STAGE_WALL_FIXED;
      case "JUDmdl": // first time offering
        return stage >= STAGE_CELLAR_CLEARED && stage < STAGE_STORE_AGREED;
      case "p6H5tu": // offering again
        return stage >= STAGE_STORE_AGREED;
      case "J1ZK_f": // what should I do, before fixing
        return stage < STAGE_WALL_FIXED;
      case "A1yJWY": // after fixing, first time asking
        return stage >= STAGE_WALL_FIXED && stage < STAGE_CRATE_GIVEN;
      case "IWXcv-": // after fixing, asking again
        return stage >= STAGE_CRATE_GIVEN;
      case "FKIrpJ": // citizen: before fixing
        return stage < STAGE_WALL_FIXED;
      case "z5DSgt": // citizen: after fixing
        return stage >= STAGE_WALL_FIXED;
      // Bank.
      case "cv08Lr": // booth before a banker
        return stage < STAGE_BANKER;
      case "Ku941Z": // citizen: before booth
        return stage < STAGE_BOOTH_FIXED;
      case "lUjsKV": // citizen: before wall
        return stage >= STAGE_BOOTH_FIXED && stage < STAGE_BANK_WALL_FIXED;
      case "XNcdpB": // citizen: after both
        return stage >= STAGE_BANK_WALL_FIXED;
      case "R_OWWb": // citizen: after booth
        return stage >= STAGE_BOOTH_FIXED && stage < STAGE_BANK_WALL_FIXED;
      case "A9Xs3G": // citizen: after both
        return stage >= STAGE_BANK_WALL_FIXED;
      // Gadderanks.
      case "c4DZLI": // first time
        return !hasBit(player, BIT_GADDERANKS_TALKED);
      case "4mjtys": // talking again
        return hasBit(player, BIT_GADDERANKS_TALKED);
      case "a-RBs3": // juvinate first time
        return !hasBit(player, BIT_JUVI_TALKED);
      case "dV-Otl": // juvinate again
        return hasBit(player, BIT_JUVI_TALKED);
      case "K_irY5": // Aurel variant of the tithe line
      case "DVPoL8":
        return npcId === NpcIdentifiers.AUREL;
      case "-zGBqj": // any other citizen
      case "Wirdep":
        return npcId !== NpcIdentifiers.AUREL;
      // Citizens' "What do you do here?" lines.
      case "Cd-uBv":
        return FLORIN_GROUP_NPC_IDS.has(npcId);
      case "YkY6P5":
        return RAZVAN_GROUP_NPC_IDS.has(npcId);
      case "QgfxfQ":
        return false;
      case "LI091z":
        return npcId === NpcIdentifiers.ELISABETA;
      case "MOCofG":
        return npcId === NpcIdentifiers.TEODOR;
      case "W7PXmc":
        return npcId === NpcIdentifiers.AUREL;
      case "DFVOiZ":
        return npcId === NpcIdentifiers.CORNELIUS;
      case "pSicFq":
        return npcId === NpcIdentifiers.GABRIELA;
      // Myreque hideout.
      case "KOQqfF": // Veliaf speaking again
        return true;
      case "PUItB3": // hideout Veliaf met
        return hasBit(player, BIT_VELIAF_HIDEOUT_MET);
      case "ozeyLw": // not informed Polmafi/Radigad
      case "M-pMre":
        return !hasBit(player, BIT_MEMBERS_INFORMED);
      case "bj6iRI": // informed
      case "OawSE5":
        return hasBit(player, BIT_MEMBERS_INFORMED);
      case "RRQbon": // Polmafi first
      case "lcbila": // Radigad first
        return !hasBit(player, BIT_MEMBERS_INFORMED);
      case "VOV-Bw": // after informing
      case "7S1TlN":
        return hasBit(player, BIT_MEMBERS_INFORMED);
      case "_MNE1A": // pet follower: not modelled, never blocks
        return false;
      // Ivan supplies.
      case "dTqNhq": // steel used on Ivan
        return true;
      case "yx_fD0": // Ivan does not have this piece yet
        return !ivanHasSteel(player);
      case "3Afh_y": // Ivan already has this piece
        return ivanHasSteel(player);
      case "s-QcHN": // food used on Ivan
        return true;
      case "h_id_c": // Ivan can carry more food
        return attributeNumber(player, IVAN_FOOD_ATTRIBUTE) < IVAN_FOOD_MAX;
      case "8w23PY": // Ivan is full
        return attributeNumber(player, IVAN_FOOD_ATTRIBUTE) >= IVAN_FOOD_MAX;
      // Escort.
      case "4TpgGc": // short route
        return true;
      case "SSTgQ7": // long route
        return false;
      case "zTSrDo": // didn't exhaust other dialogue options
        return false;
      // Drezel's named-page library-key recovery (post-quest).
      case "P91CrU": // lost temple library key
        return quest.isComplete(player) && !held(player, TEMPLE_LIBRARY_KEY_ITEM_ID);
      // Aurel's lost-Gadderhammer recovery page.
      case "HxmbYb": // not enough coins
        return !held(player, COINS_ITEM_ID, 3000);
      case "Z1JkRV": // enough coins
        return held(player, COINS_ITEM_ID, 3000);
      // Ivandis rod states.
      case "VJNcJx": // inspecting: before enchanting
      case "NqM8Y3": // Veliaf: before enchanting/blessing
        return held(player, SILVTHRILL_ROD_ITEM_ID);
      case "l6rC-6": // inspecting: before blessing
      case "ymxsId": // Veliaf: after enchanting
        return held(player, ENCHANTED_SILVTHRILL_ROD_ITEM_ID);
      case "38l0pm": // blessing: rod is enchanted
        return held(player, ENCHANTED_SILVTHRILL_ROD_ITEM_ID);
      case "gmv8V1": // blessing: rod is not enchanted
        return held(player, SILVTHRILL_ROD_ITEM_ID);
      case "_YvKq_": // carrying a rope
        return has(ROPE_ITEM_ID);
      case "uxovdc": // not carrying a rope
        return !has(ROPE_ITEM_ID);
      case "RaJqfs": // wielding the rod
        return wearingRod(player);
      case "io8V2U": // not wielding the rod
        return !wearingRod(player);
      default:
        return null;
    }
  }

  function ivanHasSteel(player) {
    return hasBit(player, BIT_IVAN_HELM) && hasBit(player, BIT_IVAN_BODY) && hasBit(player, BIT_IVAN_LEGS);
  }

  function crateFilledCount(player) {
    return (
      attributeNumber(player, CRATE_AXES_ATTRIBUTE) +
      attributeNumber(player, CRATE_FISH_ATTRIBUTE) +
      attributeNumber(player, CRATE_TINDER_ATTRIBUTE)
    );
  }

  function crateComplete(player) {
    return (
      attributeNumber(player, CRATE_AXES_ATTRIBUTE) >= CRATE_AXES_NEEDED &&
      attributeNumber(player, CRATE_FISH_ATTRIBUTE) >= CRATE_FISH_NEEDED &&
      attributeNumber(player, CRATE_TINDER_ATTRIBUTE) >= CRATE_TINDER_NEEDED
    );
  }

  function resetCrate(player) {
    player.setAttribute(CRATE_AXES_ATTRIBUTE, 0);
    player.setAttribute(CRATE_FISH_ATTRIBUTE, 0);
    player.setAttribute(CRATE_TINDER_ATTRIBUTE, 0);
  }

  // ---------------------------------------------------------------------------
  // Dialogue: chosen-condition side effects
  // ---------------------------------------------------------------------------

  function handleChosenCondition(event) {
    const { player, stepId, pages } = event;
    if (!player || !stepId) return;
    if (Array.isArray(pages) && !pages.some((entry) => entry?.page === PAGE)) return;
    switch (stepId) {
      case "QvHBD5": // roof fixed
        if (consumeRepair(player, 3, 12)) {
          swapObject(BROKEN_ROOF_ID, REPAIRED_ROOF_ID, ROOF_TILE);
          advance(player, STAGE_ROOF_FIXED);
        }
        return;
      case "JHVR_s": // shop wall fixed
        if (consumeRepair(player, 3, 12)) {
          swapObject(DAMAGED_WALL_ID, REPAIRED_WALL_ID, SHOP_WALL_TILE);
          advance(player, STAGE_WALL_FIXED);
        }
        return;
      case "EEIDrs": // booth fixed
        if (hasRepairKit(player, 2, 8) && held(player, SWAMP_PASTE_ITEM_ID)) {
          player.getInventory().deleteNumber(PLANK_ITEM_ID, 2);
          removeNails(player, 8);
          player.getInventory().deleteNumber(SWAMP_PASTE_ITEM_ID, 1);
          removeInstalled(BROKEN_BOOTH_ID, BOOTH_TILE);
          advance(player, STAGE_BOOTH_FIXED);
        }
        return;
      case "5z92aE": // bank wall fixed
        if (consumeRepair(player, 3, 12)) {
          swapObject(DAMAGED_WALL_ID, REPAIRED_WALL_ID, BANK_WALL_TILE);
          advance(player, STAGE_BANK_WALL_FIXED);
        }
        return;
      case "h2dEwU": // furnace hole fixed
        if (hasHammer(player) && held(player, STEEL_BAR_ITEM_ID, 2)) {
          player.getInventory().deleteNumber(STEEL_BAR_ITEM_ID, 2);
          swapObject(BROKEN_FURNACE_ID, REPAIRED_FURNACE_ID, FURNACE_TILE);
          advance(player, STAGE_FURNACE_FIXED);
        }
        return;
      case "6cW9G2": // furnace fuelled
        if (held(player, COAL_ITEM_ID)) {
          player.getInventory().deleteNumber(COAL_ITEM_ID, 1);
          swapObject(REPAIRED_FURNACE_ID, REPAIRED_FURNACE_FUELLED_ID, FURNACE_TILE);
          advance(player, STAGE_FURNACE_FUELLED);
        }
        return;
      case "hnlXcN": // furnace lit
        if (held(player, TINDERBOX_ITEM_ID)) {
          swapObject(REPAIRED_FURNACE_FUELLED_ID, WORKING_FURNACE_ID, FURNACE_TILE);
          lightFurnaceCutscene(player);
        }
        return;
      case "A1yJWY": { // after fixing, first time asking
        const alreadyHasCrate = held(player, CRATE_EMPTY_ITEM_ID) || held(player, CRATE_FULL_ITEM_ID);
        if (!alreadyHasCrate) {
          if (!give(player, CRATE_EMPTY_ITEM_ID, 1)) {
            // Full inventory: stay at 160 so the offer can be retried; the
            // handout message and its follow-up line are suppressed below.
            player.setAttribute(CRATE_REFUSED_ATTRIBUTE, 1);
            return;
          }
          resetCrate(player);
        }
        player.setAttribute(CRATE_REFUSED_ATTRIBUTE, 0);
        if (!player.getAttribute("quest.in_aid_of_the_myreque.fishtype.set")) {
          // The store alternates between raw mackerel and snail meat per player.
          player.setAttribute(CRATE_FISH_TYPE_ATTRIBUTE, Math.random() < 0.5 ? 0 : 1);
          player.setAttribute("quest.in_aid_of_the_myreque.fishtype.set", 1);
        }
        advance(player, STAGE_CRATE_GIVEN);
        return;
      }
      case "RRQbon": // Polmafi told first
      case "lcbila": { // Radigad told first
        setBit(player, BIT_MEMBERS_INFORMED);
        // The helper's 290 leg is talking to one of them; it also releases the
        // escort step if the Veliaf hideout conversation was skipped.
        if (quest.getStage(player) >= STAGE_VELIAF_STORE && quest.getStage(player) < STAGE_HIDEOUT_TALK) {
          advance(player, STAGE_HIDEOUT_TALK);
        }
        return;
      }
      case "c4DZLI": // Gadderanks first time
        setBit(player, BIT_GADDERANKS_TALKED);
        return;
      case "a-RBs3": // juvinate first time
        setBit(player, BIT_JUVI_TALKED);
        return;
      case "UXJgpJ": // Aurel met
        setBit(player, BIT_AUREL_MET);
        return;
      case "tg-CGu": // Aurel thanks after repairs
        setBit(player, BIT_AUREL_AGAIN);
        return;
      default:
        return;
    }
  }

  function consumeRepair(player, planks, nails) {
    if (!hasRepairKit(player, planks, nails)) return false;
    player.getInventory().deleteNumber(PLANK_ITEM_ID, planks);
    removeNails(player, nails);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Dialogue: actions and messages
  // ---------------------------------------------------------------------------

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    switch (stepId) {
      case "jbm4VZ": // Florin throws something
        return;
      case "xw81NT": // plaster fragment found
        give(player, ItemIdentifiers.PLASTER_FRAGMENT, 1);
        return;
      case "NMW9RQ": // dusty scroll found
        give(player, ItemIdentifiers.DUSTY_SCROLL, 1);
        return;
      case "3SyWCq": // one vampyre down
        player.sendMessage("Veliaf: Fear not my friend! I will come to your aid!");
        return;
      case "GHoygq": // Gadderanks passes away
        despawnKey(player, "gad_wounded");
        return;
      case "p2YbVD": // Gadderanks and the juvinates attack
        // The fight is a separate encounter: close the chatbox now so the
        // wounded/dying branch can only play after combat.
        event.handled = true;
        event.end = true;
        despawnKey(player, "gad_peace");
        despawnKey(player, "juv_peace1");
        despawnKey(player, "juv_peace2");
        player.setAttribute(FIGHT_ATTRIBUTE, 0);
        advance(player, STAGE_FIGHT);
        return;
      case "G9lEti": // Aurel gives the Gadderhammer
        if (!held(player, GADDERHAMMER_ITEM_ID)) give(player, GADDERHAMMER_ITEM_ID, 1);
        advance(player, STAGE_GADDERANKS_DEAD);
        return;
      case "6qLnJV": { // Aurel's lost-Gadderhammer recovery page: buy it back
        if (!held(player, COINS_ITEM_ID, 3000)) return;
        if (
          !held(player, GADDERHAMMER_ITEM_ID) &&
          freeSlots(player) < 1 &&
          player.getInventory().getAmount(COINS_ITEM_ID) > 3000
        ) {
          player.sendMessage("You don't have enough inventory space.");
          return;
        }
        player.getInventory().deleteNumber(COINS_ITEM_ID, 3000);
        if (!held(player, GADDERHAMMER_ITEM_ID)) give(player, GADDERHAMMER_ITEM_ID, 1);
        return;
      }
      case "OCv2XT": // Veliaf heads back to the Hollows
        advance(player, STAGE_VELIAF_STORE);
        return;
      case "rqRnfa": // Cornelius becomes the banker
        swapObject(BROKEN_BOOTH_ID, WORKING_BOOTH_ID, BOOTH_TILE);
        advance(player, STAGE_BANKER);
        return;
      case "LM3qbj": // "Aurel gives you a crate." - only when one was taken
        if (player.getAttribute(CRATE_REFUSED_ATTRIBUTE)) event.handled = true;
        return;
      case "UsJ9P-": // full crate handed to Aurel
        if (held(player, CRATE_FULL_ITEM_ID)) player.getInventory().deleteNumber(CRATE_FULL_ITEM_ID, 1);
        else if (held(player, CRATE_EMPTY_ITEM_ID)) player.getInventory().deleteNumber(CRATE_EMPTY_ITEM_ID, 1);
        advance(player, STAGE_CRATE_HANDED);
        return;
      case "fTKBGC": // Drezel gives the key (message)
      case "B_kRtc": { // "receive Temple library key" (action)
        // A full bag must not consume the key branch: stay before the key stage
        // so Drezel's conversation can be repeated for the key.
        if (!held(player, TEMPLE_LIBRARY_KEY_ITEM_ID) && !give(player, TEMPLE_LIBRARY_KEY_ITEM_ID, 1)) {
          return;
        }
        advance(player, STAGE_LIBRARY_KEY);
        return;
      }
      case "7Z6IoI": // Drezel's named-page library-key recovery
        if (!held(player, TEMPLE_LIBRARY_KEY_ITEM_ID) && quest.isComplete(player)) {
          give(player, TEMPLE_LIBRARY_KEY_ITEM_ID, 1);
        }
        return;
      case "3xpYaZ": // key in the keyhole
        openLibraryTrapdoor(player);
        return;
      case "l-COOf": // the escort route choice
        startEscort(player);
        return;
      case "ruxiLW": // the rod handed to Veliaf
        if (held(player, ROD_OF_IVANDIS_ITEM_ID)) {
          player.getInventory().deleteNumber(ROD_OF_IVANDIS_ITEM_ID, 1);
        }
        if (!quest.isComplete(player)) quest.complete(player);
        // complete() runs onReward (which syncs spawns) but call again so the
        // stage-420 removal is immediate even if the completion path changes.
        applyStageSpawns(player);
        return;
      default:
        return;
    }
  }

  function handleDialogueChoice(event) {
    const { player, option, stepId } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (String(option) === "Are there any 'out of the way' places here?" && stage >= STAGE_FOOD_PLACED && stage < STAGE_TOLD_INN) {
      advance(player, STAGE_TOLD_INN);
      return;
    }
    if (String(option) === "I'd like to help fix up the town." && stage >= STAGE_CELLAR_CLEARED && stage < STAGE_STORE_AGREED) {
      advance(player, STAGE_STORE_AGREED);
      return;
    }
    if (
      String(option) === "What should I do now?" &&
      stage >= STAGE_CRATE_GIVEN &&
      stage < STAGE_CRATE_HANDED &&
      !held(player, CRATE_EMPTY_ITEM_ID) &&
      !held(player, CRATE_FULL_ITEM_ID)
    ) {
      // QH crate tooltip: ask Aurel what to do now for another crate.
      const itemId = crateComplete(player) ? CRATE_FULL_ITEM_ID : CRATE_EMPTY_ITEM_ID;
      if (give(player, itemId, 1)) player.sendMessage("Aurel gives you another crate.");
      return;
    }
    void stepId;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !VELIAF_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0) return;
    if (!meetsRequirements(player)) {
      requirementsMessage(player);
      return;
    }
    advance(player, STAGE_STARTED);
  }

  // ---------------------------------------------------------------------------
  // Talk-to handlers (the quest's cast)
  // ---------------------------------------------------------------------------

  const IN_SEARCH_STAGE_ATTRIBUTE = "quest.in_search_of_the_myreque.stage";
  const IN_SEARCH_COMPLETE = 105;

  function inSearchActive(player) {
    const value = Number(player.getAttribute(IN_SEARCH_STAGE_ATTRIBUTE)) || 0;
    return value >= 1 && value < IN_SEARCH_COMPLETE;
  }

  /** True while A Taste of Hope needs its canonical Veliaf rod hand-over. */
  function tasteNeedsVeliafRod(player) {
    const request = { player, needsRod: false };
    api.emitCustomEvent("taste-of-hope:needs-veliaf-rod", request);
    return request.needsRod === true;
  }

  function talkVeliaf(event) {
    const { player, npcId } = event;
    if (!VELIAF_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) {
      // A Taste of Hope's rod step needs Veliaf on its own transcript selector;
      // In Aid registered earlier, so yield instead of claiming the shared NPC.
      if (tasteNeedsVeliafRod(player)) return false;
      // The page has no post-quest variant; greet with the final conversation's
      // opening line only (never the stale rod-handover or rod-update branch).
      play(player, npcId, "rod-of-ivandis-talking-to-veliaf-with-the-finalized-rod", (steps) => steps.slice(0, 1));
      return true;
    }
    if (stage === 0) {
      // While In Search of the Myreque runs, its own Veliaf conversation must win.
      if (inSearchActive(player)) return false;
      if (!meetsRequirements(player)) {
        requirementsMessage(player);
        return true;
      }
      play(player, npcId, "the-myreque-s-job-offer-veliaf-hurtz");
      return true;
    }
    if (stage < STAGE_GADDERANKS_DEAD) {
      play(player, npcId, "the-myreque-s-job-offer-veliaf-hurtz");
      return true;
    }
    if (stage < STAGE_VELIAF_STORE) {
      play(player, npcId, "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-veliaf");
      return true;
    }
    if (stage < STAGE_HIDEOUT_TALK) {
      play(player, npcId, "at-the-myreque-hideout");
      setBit(player, BIT_VELIAF_HIDEOUT_MET);
      advance(player, STAGE_HIDEOUT_TALK);
      return true;
    }
    if (stage < STAGE_DREZEL) {
      play(player, npcId, "at-the-myreque-hideout-veliaf");
      return true;
    }
    if (stage < STAGE_BOARDS_REMOVED) {
      play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-before-finding-the-tomb");
      return true;
    }
    if (stage < STAGE_MOULD) {
      play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-after-finding-the-tomb");
      return true;
    }
    if (stage < STAGE_ROD_ENCHANTED) {
      play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-after-making-a-mould");
      return true;
    }
    if (stage < STAGE_ROD_BLESSED || !held(player, ROD_OF_IVANDIS_ITEM_ID)) {
      play(player, npcId, "rod-of-ivandis-at-the-new-myreque-hideout-veliaf-after-making-a-silvthrill-rod");
      return true;
    }
    play(player, npcId, "rod-of-ivandis-talking-to-veliaf-with-the-finalized-rod");
    return true;
  }

  function talkAurel(event) {
    const { player, npcId } = event;
    if (!AUREL_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_CELLAR_CLEARED) return false;
    if (stage >= STAGE_GADDERANKS_DEAD) {
      // After the tithe the canonical Aurel page takes over. Losing the
      // Gadderhammer (including a full-bag drop) has its own cross-page variant.
      const variant = held(player, GADDERHAMMER_ITEM_ID)
        ? "standard-dialogue"
        : "if-the-player-has-lost-the-gadderhammer";
      play(player, npcId, variant, null, AUREL_PAGE);
      return true;
    }
    if (stage < STAGE_CRATE_HANDED && held(player, CRATE_FULL_ITEM_ID)) {
      play(player, npcId, "entering-burgh-de-rott-fixing-the-general-store-handing-in-store-stock");
      return true;
    }
    play(player, npcId, "entering-burgh-de-rott-fixing-the-general-store-aurel");
    return true;
  }

  function talkFlorin(event) {
    const { player, npcId } = event;
    if (!FLORIN_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED) return false;
    if (stage < STAGE_FOOD_PLACED) {
      play(player, npcId, "entering-burgh-de-rott-attempting-to-enter");
      return true;
    }
    if (stage < STAGE_TOLD_INN) {
      play(player, npcId, "entering-burgh-de-rott-depositing-food-speaking-to-florin-after-using-food-on-the-chest");
      return true;
    }
    play(player, npcId, "entering-burgh-de-rott-speaking-to-citizens");
    return true;
  }

  function talkRazvan(event) {
    const { player, npcId } = event;
    if (npcId !== RAZVAN_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_FOOD_PLACED) return false;
    if (stage >= STAGE_GADDERANKS && stage < STAGE_DREZEL) {
      play(player, npcId, "gadderanks-arrives-at-burgh-de-rott-speaking-to-citizens-after-fixing-the-furnace");
      return true;
    }
    if (stage >= STAGE_BANKER && stage < STAGE_GADDERANKS) {
      play(player, npcId, "entering-burgh-de-rott-fixing-the-furnace-speaking-to-citizens-while-fixing-the-furnace");
      return true;
    }
    play(player, npcId, "entering-burgh-de-rott-speaking-to-citizens");
    return true;
  }

  function talkCornelius(event) {
    const { player, npcId } = event;
    if (npcId !== CORNELIUS_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_BANK_WALL_FIXED || stage >= STAGE_BANKER) return false;
    play(player, npcId, "entering-burgh-de-rott-fixing-the-bank-recruiting-cornelius");
    return true;
  }

  function talkWiskit(event) {
    const { player, npcId } = event;
    if (!WISKIT_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GADDERANKS || stage >= STAGE_FIGHT) return false;
    play(player, npcId, "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-wiskit");
    setBit(player, BIT_WISKIT_TALKED);
    return true;
  }

  function talkGadderanks(event) {
    const { player, npcId } = event;
    if (!GADDERANKS_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage >= STAGE_GADDERANKS && stage < STAGE_FIGHT) {
      const ready =
        hasBit(player, BIT_GADDERANKS_TALKED) && hasBit(player, BIT_JUVI_TALKED) && hasBit(player, BIT_WISKIT_TALKED);
      if (ready) {
        play(player, npcId, "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-after-speaking-to-all-three");
      } else {
        play(player, npcId, "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-gadderanks");
      }
      return true;
    }
    if (stage >= STAGE_WOUNDED && stage < STAGE_GADDERANKS_DEAD) {
      play(
        player,
        npcId,
        "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-after-speaking-to-all-three",
        (steps) => {
          const branch = steps.find((step) => step.id === "s-bYSS");
          return branch?.steps?.length ? branch.steps : steps;
        }
      );
      return true;
    }
    return false;
  }

  function talkJuvinate(event) {
    const { player, npcId } = event;
    if (!JUVI_PEACEFUL_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_GADDERANKS || stage >= STAGE_FIGHT) return false;
    play(player, npcId, "gadderanks-arrives-at-burgh-de-rott-at-the-general-store-vampyre-juvinate");
    setBit(player, BIT_JUVI_TALKED);
    return true;
  }

  function talkPolmafi(event) {
    const { player, npcId } = event;
    if (npcId !== POLMAFI_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_VELIAF_STORE || stage >= STAGE_DREZEL) return false;
    play(player, npcId, "at-the-myreque-hideout-polmafi");
    return true;
  }

  function talkRadigad(event) {
    const { player, npcId } = event;
    if (npcId !== RADIGAD_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_VELIAF_STORE || stage >= STAGE_DREZEL) return false;
    play(player, npcId, "at-the-myreque-hideout-radigad");
    return true;
  }

  function talkIvan(event) {
    const { player, npcId } = event;
    if (!IVAN_NPC_IDS.has(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_HIDEOUT_TALK || stage >= STAGE_ESCORT) return false;
    if (!hasBit(player, BIT_MEMBERS_INFORMED)) {
      play(player, npcId, "at-the-myreque-hideout-ivan");
      return true;
    }
    play(player, npcId, "escorting-ivan-to-paterdomus-talking-to-ivan");
    return true;
  }

  function talkDrezel(event) {
    const { player, npcId } = event;
    if (npcId !== DREZEL_NPC_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_DREZEL) return false;
    if (stage >= STAGE_COMPLETE) {
      // Completed: only claim him to replace a lost library key; otherwise
      // leave the shared post-quest Drezel page to its other owners.
      if (held(player, TEMPLE_LIBRARY_KEY_ITEM_ID)) return false;
      play(player, npcId, "standard-dialogue-after-priest-in-peril", undefined, DREZEL_PAGE);
      return true;
    }
    if (stage < STAGE_LIBRARY_KEY || (!held(player, TEMPLE_LIBRARY_KEY_ITEM_ID) && stage < STAGE_LIBRARY_OPEN)) {
      // Before the key, or after losing it before the library is open: Drezel
      // can give another (QH item tooltip: "You can get another from Drezel").
      play(player, npcId, "asking-drezel-about-ivandis");
    } else {
      play(player, npcId, "asking-drezel-about-ivandis-talking-to-drezel-afterwards");
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Ivan's supplies (item-on-NPC)
  // ---------------------------------------------------------------------------

  function handleItemOnNpc(event) {
    const { player, target, itemId } = event;
    if (!player || !target) return;
    if (!IVAN_NPC_IDS.has(target.getId?.())) return;
    const stage = quest.getStage(player);
    if (stage !== STAGE_HIDEOUT_TALK) return;
    event.handled = true;
    const npcId = target.getId?.() ?? NpcIdentifiers.IVAN_STROM_3;
    if (itemId === STEEL_HELM_ITEM_ID) return giveIvanSteel(event, npcId, BIT_IVAN_HELM);
    if (itemId === STEEL_CHAIN_ITEM_ID) return giveIvanSteel(event, npcId, BIT_IVAN_BODY);
    if (itemId === STEEL_LEGS_ITEM_ID) return giveIvanSteel(event, npcId, BIT_IVAN_LEGS);
    if (itemId === SILVER_SICKLE_ITEM_ID) {
      if (!hasBit(player, BIT_IVAN_SICKLE)) {
        player.getInventory().deleteNumber(SILVER_SICKLE_ITEM_ID, 1);
        setBit(player, BIT_IVAN_SICKLE);
      }
      play(player, npcId, "escorting-ivan-to-paterdomus-giving-ivan-supplies");
      return;
    }
    if (IVAN_FOOD_ITEM_IDS.has(itemId)) {
      const room = IVAN_FOOD_MAX - attributeNumber(player, IVAN_FOOD_ATTRIBUTE);
      const amount = Math.min(player.getInventory().getAmount(itemId), Math.max(0, room));
      if (amount > 0) {
        player.getInventory().deleteNumber(itemId, amount);
        player.setAttribute(IVAN_FOOD_ATTRIBUTE, attributeNumber(player, IVAN_FOOD_ATTRIBUTE) + amount);
      }
      play(player, npcId, "escorting-ivan-to-paterdomus-giving-ivan-supplies");
      return;
    }
    // Any other armour: the transcript's "other armour" branch.
    player.sendMessage(
      "Ivan: Thanks for the kind offer of some armour, but I can only wear a steel medium helm, steel chainbody and steel platelegs."
    );
  }

  function giveIvanSteel(event, npcId, bit) {
    const { player, itemId } = event;
    if (hasBit(player, bit)) {
      play(player, npcId, "escorting-ivan-to-paterdomus-giving-ivan-supplies");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    setBit(player, bit);
    play(player, npcId, "escorting-ivan-to-paterdomus-giving-ivan-supplies");
  }

  // ---------------------------------------------------------------------------
  // Escort and fight
  // ---------------------------------------------------------------------------

  function startEscort(player) {
    player.moveTo(new Location(SWAMP_TREK_TILE.x, SWAMP_TREK_TILE.y, SWAMP_TREK_TILE.z));
    player.setAttribute(ENCOUNTER_ATTRIBUTE, 0);
    advance(player, STAGE_ESCORT);
  }

  function refreshEncounterSpawns(player) {
    if (quest.getStage(player) !== STAGE_ESCORT) return;
    const deaths = attributeNumber(player, ENCOUNTER_ATTRIBUTE);
    if (deaths < 1) spawnKey(player, "escort1", JUVI_FIGHT_ID_1, { x: 2855, y: 4560, z: 0 });
    if (deaths < 2) spawnKey(player, "escort2", JUVI_FIGHT_ID_2, { x: 2863, y: 4568, z: 0 });
  }

  function finishEscort(player) {
    despawnKey(player, "escort1");
    despawnKey(player, "escort2");
    play(player, NpcIdentifiers.IVAN_STROM_3, "escorting-ivan-to-paterdomus-after-finishing-the-encounter");
    player.moveTo(new Location(DREZEL_TILE.x, DREZEL_TILE.y, DREZEL_TILE.z));
    player.sendMessage("You make your way down to Drezel beneath the Paterdomus temple.");
    advance(player, STAGE_DREZEL);
  }

  function lightFurnaceCutscene(player) {
    play(player, GADDERANKS_PEACE_ID, "at-castle-drakan");
    advance(player, STAGE_FURNACE_LIT);
    quest.setStage(player, STAGE_GADDERANKS);
    applyStageSpawns(player);
  }

  function despawnTrackedNpc(player, npc) {
    if (!player || !npc) return;
    const map = spawnedByPlayer.get(player);
    if (map) {
      for (const [key, tracked] of map) {
        if (tracked === npc) {
          map.delete(key);
          break;
        }
      }
    }
    api.removeNpc(npc);
  }

  function handleNpcDeath(event) {
    const killer = event.killer;
    if (!killer || !killer.isPlayer?.()) return;
    const player = killer;
    const stage = quest.getStage(player);
    if (JUVI_FIGHT_NPC_IDS.has(event.npcId) && stage === STAGE_ESCORT) {
      despawnTrackedNpc(player, event.npc);
      const deaths = attributeNumber(player, ENCOUNTER_ATTRIBUTE) + 1;
      player.setAttribute(ENCOUNTER_ATTRIBUTE, deaths);
      if (deaths >= 2) finishEscort(player);
      return;
    }
    if (stage !== STAGE_FIGHT) return;
    if (JUVI_FIGHT_NPC_IDS.has(event.npcId)) {
      // Remove the one that just died by identity so the survivor is never the
      // one dropped (both are cleaned again by endGadderanksFight below).
      despawnTrackedNpc(player, event.npc);
      const deaths = attributeNumber(player, FIGHT_ATTRIBUTE) + 1;
      player.setAttribute(FIGHT_ATTRIBUTE, deaths);
      if (deaths === 1) {
        player.sendMessage("Veliaf Hurtz: Fear not my friend! I will come to your aid!");
      }
      if (deaths >= 2) endGadderanksFight(player);
      return;
    }
    if (event.npcId === GADDERANKS_FIGHT_ID) {
      despawnTrackedNpc(player, event.npc);
      endGadderanksFight(player);
    }
  }

  function endGadderanksFight(player) {
    if (quest.getStage(player) >= STAGE_WOUNDED) return;
    despawnKey(player, "juv_fight1");
    despawnKey(player, "juv_fight2");
    despawnKey(player, "gad_fight");
    advance(player, STAGE_WOUNDED);
  }

  // ---------------------------------------------------------------------------
  // Object interactions
  // ---------------------------------------------------------------------------

  function stepThrough(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.x - (dx >= 0 ? 1 : -1), location.y, current.getZ())
        : new Location(location.x, location.y - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  function mineEntranceRubble(player) {
    if (quest.getStage(player) < STAGE_TOLD_INN) {
      player.sendMessage("You should find out whether the townspeople want you here first.");
      return;
    }
    if (!hasPickaxe(player)) {
      player.sendMessage("You need a pickaxe to clear this rubble.");
      return;
    }
    player.sendMessage("You swing your pickaxe at the rubble...");
    player.sendMessage("...and successfully break it down.");
    swapObject(RUBBLE_ENTRANCE_ID, TRAPDOOR_CLOSED_ID, ENTRANCE_TRAPDOOR_TILE);
    advance(player, STAGE_ENTRANCE_MINED);
  }

  function mineBasementRubble(player, objectId, tile) {
    if (quest.getStage(player) < STAGE_TRAPDOOR_OPEN) {
      player.sendMessage("You should open the trapdoor and climb down first.");
      return;
    }
    if (!hasPickaxe(player)) {
      player.sendMessage("You need a pickaxe to clear this rubble.");
      return;
    }
    const index = RUBBLE_BASEMENT_IDS.indexOf(objectId);
    if (index < 0) return;
    const bit = [BIT_RUBBLE_1, BIT_RUBBLE_2, BIT_RUBBLE_3][index];
    if (hasBit(player, bit)) return;
    setBit(player, bit);
    player.sendMessage("You manage to mine the rubble to pieces.");
    for (const object of installedObjects.slice()) {
      if (
        object.getId() === objectId &&
        object.getLocation().getX() === tile.x &&
        object.getLocation().getY() === tile.y &&
        object.getLocation().getZ() === tile.z
      ) {
        ObjectManager.deregister(object, true);
        installedObjects.splice(installedObjects.indexOf(object), 1);
      }
    }
    const remaining =
      (hasBit(player, BIT_RUBBLE_1) ? 0 : 1) +
      (hasBit(player, BIT_RUBBLE_2) ? 0 : 1) +
      (hasBit(player, BIT_RUBBLE_3) ? 0 : 1);
    if (remaining === 1) {
      player.sendMessage(
        "You manage to mine the rubble to pieces. You should be able to move what's left out of the cellar now. Though you'll need something to carry it in."
      );
    }
    if (remaining === 0) {
      registerObject(PILE_OF_RUBBLE_ID, BASEMENT_PILE_TILE);
      player.sendMessage("You clear out the last of the rubble.");
      player.sendMessage(
        "As you clear away the last of the rubble, you notice a dusty looking wall plaque which you hadn't spotted before."
      );
    }
  }

  function scoopRubble(player) {
    if (quest.getStage(player) < STAGE_TRAPDOOR_OPEN) {
      player.sendMessage("You should open the trapdoor and climb down first.");
      return;
    }
    if (!held(player, SPADE_ITEM_ID)) {
      player.sendMessage("You need a spade to scoop up the rubble.");
      return;
    }
    if (!held(player, BUCKET_ITEM_ID) && !held(player, BUCKET_OF_RUBBLE_ITEM_ID)) {
      player.sendMessage("You need something to carry the rubble in.");
      return;
    }
    const everyBit = hasBit(player, BIT_RUBBLE_1) && hasBit(player, BIT_RUBBLE_2) && hasBit(player, BIT_RUBBLE_3);
    if (!everyBit) {
      player.sendMessage("There is still rubble to mine here.");
      return;
    }
    player.sendMessage("You use a spade to scoop the rubble into a bucket.");
    if (held(player, BUCKET_ITEM_ID)) {
      player.getInventory().deleteNumber(BUCKET_ITEM_ID, 1);
      player.getInventory().adds(BUCKET_OF_RUBBLE_ITEM_ID, 1);
    }
    advance(player, STAGE_CELLAR_CLEARED);
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (objectId === OPEN_CHEST_ID) {
      event.handled = true;
      if (stage < STAGE_FOOD_PLACED) {
        player.sendMessage("The chest contains some empty packages. It looks like they were used to hold food.");
      } else {
        player.sendMessage("The chest contains some empty packages.");
      }
      return;
    }
    if (objectId === BROKEN_WALL_INN_ID) {
      event.handled = true;
      stepThrough(player, location);
      return;
    }
    if (objectId === RUBBLE_ENTRANCE_ID) {
      event.handled = true;
      mineEntranceRubble(player);
      return;
    }
    if (objectId === TRAPDOOR_CLOSED_ID) {
      event.handled = true;
      if (stage >= STAGE_ENTRANCE_MINED) {
        swapObject(TRAPDOOR_CLOSED_ID, TRAPDOOR_OPEN_ID, ENTRANCE_TRAPDOOR_TILE);
        player.sendMessage("You open the trapdoor.");
        advance(player, STAGE_TRAPDOOR_OPEN);
      } else {
        player.sendMessage("The trapdoor is buried under rubble.");
      }
      return;
    }
    if (RUBBLE_BASEMENT_IDS.includes(objectId)) {
      event.handled = true;
      mineBasementRubble(player, objectId, location);
      return;
    }
    if (objectId === BROKEN_ROOF_ID) {
      event.handled = true;
      if (stage < STAGE_STORE_AGREED) {
        player.sendMessage("The roof looks like it's seen better days. The planks are all rotten and the nails have gone rusty.");
        return;
      }
      if (stage >= STAGE_ROOF_FIXED) {
        player.sendMessage("The roof has already been repaired.");
        return;
      }
      play(player, NpcIdentifiers.AUREL, "entering-burgh-de-rott-fixing-the-general-store-fixing-the-roof");
      return;
    }
    if (objectId === DAMAGED_WALL_ID) {
      event.handled = true;
      if (stage < STAGE_STORE_AGREED) {
        player.sendMessage("The wall has a large hole in it surrounded by rotten wood and rusty metal.");
        return;
      }
      if (location && location.x === BANK_WALL_TILE.x && location.y === BANK_WALL_TILE.y) {
        if (stage >= STAGE_BANK_WALL_FIXED) {
          player.sendMessage("The wall has already been repaired.");
          return;
        }
        play(player, CORNELIUS_NPC_ID, "entering-burgh-de-rott-fixing-the-bank-fixing-the-bank-wall");
        return;
      }
      if (stage >= STAGE_WALL_FIXED) {
        player.sendMessage("The wall has already been repaired.");
        return;
      }
      play(player, NpcIdentifiers.AUREL, "entering-burgh-de-rott-fixing-the-general-store-fixing-the-wall");
      return;
    }
    if (objectId === BROKEN_BOOTH_ID) {
      event.handled = true;
      if (stage < STAGE_CRATE_HANDED) {
        player.sendMessage("This bank booth is in an awful condition. There's a lot of broken glass and most of the wooden structure of the booth has been destroyed.");
        return;
      }
      play(player, CORNELIUS_NPC_ID, "entering-burgh-de-rott-fixing-the-bank-fixing-the-bank-booth");
      return;
    }
    if (objectId === BROKEN_FURNACE_ID) {
      event.handled = true;
      if (stage < STAGE_BANKER) {
        player.sendMessage("There's a large hole in the chimney of the furnace which is probably why it doesn't work.");
        return;
      }
      play(player, RAZVAN_NPC_ID, "entering-burgh-de-rott-fixing-the-furnace-fixing-the-hole-in-the-furnace");
      return;
    }
    if (objectId === REPAIRED_FURNACE_ID) {
      event.handled = true;
      play(player, RAZVAN_NPC_ID, "entering-burgh-de-rott-fixing-the-furnace-refuelling-the-furnace");
      return;
    }
    if (objectId === REPAIRED_FURNACE_FUELLED_ID) {
      event.handled = true;
      play(player, RAZVAN_NPC_ID, "entering-burgh-de-rott-fixing-the-furnace-lighting-the-furnace");
      return;
    }
    if (objectId === CAVE_ENTRANCE_TOMB_ID) {
      event.handled = true;
      if (stage < STAGE_BOARDS_REMOVED) {
        player.sendMessage("There's some boards blocking the cave entrance.");
        return;
      }
      player.moveTo(new Location(COFFIN_ROOM_TILE.x, COFFIN_ROOM_TILE.y, COFFIN_ROOM_TILE.z));
      player.sendMessage("You enter the cave.");
      return;
    }
    if (objectId === COFFIN_ID) {
      event.handled = true;
      player.sendMessage(
        "It's an ancient coffin with a strange rod fused to the top. The rod gives out a mixture of both mortal and divine energies and seems to be made out of a unique silver and mithril alloy."
      );
      return;
    }
    if (objectId === KEYHOLE_ID) {
      event.handled = true;
      player.sendMessage("You inspect the panel. It looks like there's some sort of keyhole in it.");
      useLibraryKey(player);
      return;
    }
    if (objectId === BOOKCASE_SEVEN_ID) {
      event.handled = true;
      if (stage < STAGE_LIBRARY_OPEN) {
        player.sendMessage("You can't reach this bookcase yet.");
        return;
      }
      player.sendMessage("You find a book called The Sleeping Seven.");
      if (!held(player, SLEEPING_SEVEN_ITEM_ID)) give(player, SLEEPING_SEVEN_ITEM_ID, 1);
      return;
    }
    if (objectId === BOOKCASE_OTHER_ID) {
      event.handled = true;
      player.sendMessage("You find a book called Histories of the Hallowland.");
      player.sendMessage("You find a book called Modern day Morytania.");
      return;
    }
    if (objectId === LIBRARY_TRAPDOOR_ID) {
      event.handled = true;
      player.moveTo(new Location(LIBRARY_TILE.x, LIBRARY_TILE.y, LIBRARY_TILE.z));
      player.sendMessage("You climb down into the library.");
    }
  }

  function openLibraryTrapdoor(player) {
    if (!installedAt(LIBRARY_TRAPDOOR_ID, LIBRARY_TRAPDOOR_TILE)) {
      registerObject(LIBRARY_TRAPDOOR_ID, LIBRARY_TRAPDOOR_TILE);
    }
    advance(player, STAGE_LIBRARY_OPEN);
  }

  function useLibraryKey(player) {
    if (!held(player, TEMPLE_LIBRARY_KEY_ITEM_ID)) return;
    player.sendMessage("You use the library key in the keyhole and you hear a click to the left of you.");
    openLibraryTrapdoor(player);
  }

  // ---------------------------------------------------------------------------
  // Item-on-object
  // ---------------------------------------------------------------------------

  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (objectId === OPEN_CHEST_ID && FOOD_ITEM_IDS.has(itemId) && stage >= STAGE_STARTED && stage < STAGE_FOOD_PLACED) {
      event.handled = true;
      player.getInventory().deleteNumber(itemId, 1);
      play(player, NpcIdentifiers.FLORIN, "entering-burgh-de-rott-depositing-food-using-food-on-the-chest");
      advance(player, STAGE_FOOD_PLACED);
      return;
    }
    if (objectId === RUBBLE_ENTRANCE_ID && PICKAXE_ITEM_IDS.has(itemId)) {
      event.handled = true;
      mineEntranceRubble(player);
      return;
    }
    if (RUBBLE_BASEMENT_IDS.includes(objectId) && PICKAXE_ITEM_IDS.has(itemId)) {
      event.handled = true;
      mineBasementRubble(player, objectId, location);
      return;
    }
    if (objectId === PILE_OF_RUBBLE_ID && itemId === SPADE_ITEM_ID) {
      event.handled = true;
      scoopRubble(player);
      return;
    }
    if (objectId === RUBBLE_PILE_ID && itemId === BUCKET_OF_RUBBLE_ITEM_ID) {
      event.handled = true;
      player.getInventory().deleteNumber(BUCKET_OF_RUBBLE_ITEM_ID, 1);
      player.getInventory().adds(BUCKET_ITEM_ID, 1);
      player.sendMessage("You empty the rubble onto the pile.");
      return;
    }
    if (objectId === BROKEN_ROOF_ID && itemId === PLANK_ITEM_ID) {
      event.handled = true;
      if (stage >= STAGE_ROOF_FIXED) return;
      if (consumeRepair(player, 3, 12)) {
        player.sendMessage("You use some wooden planks and nails to patch up the hole in the roof.");
        swapObject(BROKEN_ROOF_ID, REPAIRED_ROOF_ID, ROOF_TILE);
        advance(player, STAGE_ROOF_FIXED);
      } else {
        player.sendMessage("You do not have the required items to do that. You need a hammer, 3 basic planks and 12 nails of any kind.");
      }
      return;
    }
    if (objectId === DAMAGED_WALL_ID && itemId === PLANK_ITEM_ID) {
      event.handled = true;
      if (location && location.x === BANK_WALL_TILE.x && location.y === BANK_WALL_TILE.y) {
        if (stage >= STAGE_BANK_WALL_FIXED) return;
        if (consumeRepair(player, 3, 12)) {
          player.sendMessage("You use some wooden planks and nails to fix up the wall.");
          swapObject(DAMAGED_WALL_ID, REPAIRED_WALL_ID, BANK_WALL_TILE);
          advance(player, STAGE_BANK_WALL_FIXED);
        } else {
          player.sendMessage("You do not have the required items to do that. You need a hammer, 3 basic planks and 12 nails of any kind.");
        }
        return;
      }
      if (stage >= STAGE_WALL_FIXED) return;
      if (consumeRepair(player, 3, 12)) {
        player.sendMessage("You use some wooden planks and nails to fix up the wall.");
        swapObject(DAMAGED_WALL_ID, REPAIRED_WALL_ID, SHOP_WALL_TILE);
        advance(player, STAGE_WALL_FIXED);
      } else {
        player.sendMessage("You do not have the required items to do that. You need a hammer, 3 basic planks and 12 nails of any kind.");
      }
      return;
    }
    if (objectId === BROKEN_FURNACE_ID && itemId === STEEL_BAR_ITEM_ID) {
      event.handled = true;
      if (stage >= STAGE_FURNACE_FIXED) return;
      if (hasHammer(player) && held(player, STEEL_BAR_ITEM_ID, 2)) {
        player.getInventory().deleteNumber(STEEL_BAR_ITEM_ID, 2);
        player.sendMessage("You use some steel bars to fix the hole in the furnace chimney.");
        swapObject(BROKEN_FURNACE_ID, REPAIRED_FURNACE_ID, FURNACE_TILE);
        advance(player, STAGE_FURNACE_FIXED);
      } else {
        player.sendMessage("You do not have the required items to do that. You need a hammer and 2 steel bars.");
      }
      return;
    }
    if ((objectId === REPAIRED_FURNACE_ID || objectId === BROKEN_FURNACE_ID) && itemId === COAL_ITEM_ID) {
      event.handled = true;
      if (stage === STAGE_FURNACE_FIXED) {
        player.getInventory().deleteNumber(COAL_ITEM_ID, 1);
        player.sendMessage("You place some coal into the newly fixed furnace.");
        swapObject(REPAIRED_FURNACE_ID, REPAIRED_FURNACE_FUELLED_ID, FURNACE_TILE);
        advance(player, STAGE_FURNACE_FUELLED);
      } else {
        player.sendMessage("The furnace has not been repaired yet.");
      }
      return;
    }
    if ((objectId === REPAIRED_FURNACE_FUELLED_ID || objectId === REPAIRED_FURNACE_ID) && itemId === TINDERBOX_ITEM_ID) {
      event.handled = true;
      if (stage === STAGE_FURNACE_FUELLED) {
        player.sendMessage("You light the furnace...");
        swapObject(REPAIRED_FURNACE_FUELLED_ID, WORKING_FURNACE_ID, FURNACE_TILE);
        lightFurnaceCutscene(player);
      } else {
        player.sendMessage("The furnace needs to be repaired and refuelled first.");
      }
      return;
    }
    if (itemId === SILVER_BAR_ITEM_ID && (objectId === WORKING_FURNACE_ID || isFurnaceObject(event))) {
      const onRodStep = stage >= STAGE_MOULD && held(player, ROD_MOULD_ITEM_ID);
      if (onRodStep || objectId === WORKING_FURNACE_ID) {
        event.handled = true;
        craftSilvthrillRod(player);
        return;
      }
    }
    if (objectId === WOODEN_BOARDS_ID && HAMMER_ITEM_IDS.has(itemId)) {
      event.handled = true;
      if (stage < STAGE_BOOK_READ) {
        player.sendMessage("There's some boards blocking the cave entrance.");
        return;
      }
      if (stage >= STAGE_BOARDS_REMOVED) return;
      player.sendMessage("You manage to break up the boards using a hammer.");
      for (const object of installedObjects.slice()) {
        if (object.getId() === WOODEN_BOARDS_ID) {
          ObjectManager.deregister(object, true);
          installedObjects.splice(installedObjects.indexOf(object), 1);
        }
      }
      advance(player, STAGE_BOARDS_REMOVED);
      return;
    }
    if (objectId === COFFIN_ID && itemId === SOFT_CLAY_ITEM_ID) {
      event.handled = true;
      if (stage < STAGE_BOARDS_REMOVED) return;
      player.getInventory().deleteNumber(SOFT_CLAY_ITEM_ID, 1);
      player.sendMessage("You use some clay to create a mould of the rod.");
      if (!held(player, ROD_MOULD_ITEM_ID)) give(player, ROD_MOULD_ITEM_ID, 1);
      advance(player, STAGE_MOULD);
      return;
    }
    if (objectId === PATERDOMUS_WELL_ID && itemId === ENCHANTED_SILVTHRILL_ROD_ITEM_ID) {
      event.handled = true;
      if (!held(player, ROPE_ITEM_ID)) {
        player.sendMessage("You'd lose the rod if you just dropped it down there.");
        return;
      }
      player.getInventory().deleteNumber(ENCHANTED_SILVTHRILL_ROD_ITEM_ID, 1);
      player.getInventory().adds(ROD_OF_IVANDIS_ITEM_ID, 1);
      player.sendMessage("You lower the rod into the Salve and withdraw it shortly after. It seems to glow in a rather strange way.");
      advance(player, STAGE_ROD_BLESSED);
      return;
    }
    if (objectId === KEYHOLE_ID && itemId === TEMPLE_LIBRARY_KEY_ITEM_ID) {
      event.handled = true;
      useLibraryKey(player);
    }
  }

  /** The helper's rod step says any furnace; match the skill plugin's furnace names. */
  function isFurnaceObject(event) {
    const name = event.object?.getDefinition?.()?.getName?.();
    return typeof name === "string" && /^(Small )?Furnace$/.test(name);
  }

  function craftSilvthrillRod(player) {
    if (!held(player, ROD_MOULD_ITEM_ID)) {
      player.sendMessage("You need a rod mould first.");
      return;
    }
    if (!held(player, MITHRIL_BAR_ITEM_ID) || !held(player, SAPPHIRE_ITEM_ID)) {
      player.sendMessage("You need a mithril bar and a cut sapphire to make the rod.");
      return;
    }
    player.getInventory().deleteNumber(SILVER_BAR_ITEM_ID, 1);
    player.getInventory().deleteNumber(MITHRIL_BAR_ITEM_ID, 1);
    player.getInventory().deleteNumber(SAPPHIRE_ITEM_ID, 1);
    player.getInventory().adds(SILVTHRILL_ROD_ITEM_ID, 1);
    player.sendMessage("You use the mould, silver, mithril and sapphire to craft a Silvthrill rod.");
    advance(player, STAGE_MOULD);
  }

  // ---------------------------------------------------------------------------
  // Item-on-item, item actions and ground pickup
  // ---------------------------------------------------------------------------

  function addToCrate(player, itemId) {
    let attribute;
    let needed;
    let itemName;
    if (itemId === BRONZE_AXE_ITEM_ID) {
      attribute = CRATE_AXES_ATTRIBUTE;
      needed = CRATE_AXES_NEEDED;
      itemName = "bronze axes";
    } else if (itemId === TINDERBOX_ITEM_ID) {
      attribute = CRATE_TINDER_ATTRIBUTE;
      needed = CRATE_TINDER_NEEDED;
      itemName = "tinderboxes";
    } else if (itemId === RAW_MACKEREL_ITEM_ID || CRATE_SNAIL_ITEM_IDS.has(itemId)) {
      const wantedSnail = attributeNumber(player, CRATE_FISH_TYPE_ATTRIBUTE) === 1;
      if ((itemId === RAW_MACKEREL_ITEM_ID) === wantedSnail) {
        player.sendMessage(`The crate does not need any more ${itemName ?? "of those"}.`);
        return;
      }
      attribute = CRATE_FISH_ATTRIBUTE;
      needed = CRATE_FISH_NEEDED;
      itemName = wantedSnail ? "snail meat" : "raw mackerel";
    } else {
      return;
    }
    const have = attributeNumber(player, attribute);
    const room = Math.max(0, needed - have);
    const amount = Math.min(player.getInventory().getAmount(itemId), room);
    if (amount <= 0) {
      player.sendMessage(`You've already filled the crate with ${itemName}.`);
      return;
    }
    player.getInventory().deleteNumber(itemId, amount);
    player.setAttribute(attribute, have + amount);
    player.sendMessage(`You add ${amount} ${itemName} to the crate.`);
    if (crateComplete(player)) {
      if (held(player, CRATE_EMPTY_ITEM_ID)) player.getInventory().deleteNumber(CRATE_EMPTY_ITEM_ID, 1);
      if (!held(player, CRATE_FULL_ITEM_ID)) player.getInventory().adds(CRATE_FULL_ITEM_ID, 1);
      player.sendMessage("The crate is now packed with stock. You should return it to the store.");
    } else {
      player.sendMessage(`More still needs adding to the crate. You need to collect ${CRATE_AXES_NEEDED - attributeNumber(player, CRATE_AXES_ATTRIBUTE)} bronze axes, ${CRATE_FISH_NEEDED - attributeNumber(player, CRATE_FISH_ATTRIBUTE)} ${attributeNumber(player, CRATE_FISH_TYPE_ATTRIBUTE) === 1 ? "snail meat" : "raw mackerel"}, and ${CRATE_TINDER_NEEDED - attributeNumber(player, CRATE_TINDER_ATTRIBUTE)} tinderboxes.`);
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const ids = new Set([usedItemId, usedWithItemId]);
    if (ids.has(CRATE_EMPTY_ITEM_ID)) {
      const other = usedItemId === CRATE_EMPTY_ITEM_ID ? usedWithItemId : usedItemId;
      if (other !== CRATE_EMPTY_ITEM_ID) {
        event.handled = true;
        addToCrate(player, other);
      }
      return;
    }
  }

  function provideRodEnchantRecipe(request) {
    if (request.itemId !== SILVTHRILL_ROD_ITEM_ID || request.spellName !== "Lvl-1 Enchant") return;
    request.resultId = ENCHANTED_SILVTHRILL_ROD_ITEM_ID;
    request.message = "As you cast the enchantment on the rod, it seems to vibrate and glow.";
  }

  function finishRodEnchant(request) {
    if (request.itemId !== SILVTHRILL_ROD_ITEM_ID || request.resultId !== ENCHANTED_SILVTHRILL_ROD_ITEM_ID) return;
    if (quest.getStage(request.player) < STAGE_ROD_ENCHANTED) advance(request.player, STAGE_ROD_ENCHANTED);
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player) return;
    if (itemId === SLEEPING_SEVEN_ITEM_ID && (!option || /read/i.test(option))) {
      event.handled = true;
      player.sendMessage("You read about the Seven Priestly Warriors and the secret of Ivandis Seergaze's resting place.");
      if (quest.getStage(player) === STAGE_LIBRARY_OPEN) advance(player, STAGE_BOOK_READ);
      return;
    }
    if (
      (itemId === SILVTHRILL_ROD_ITEM_ID ||
        itemId === ENCHANTED_SILVTHRILL_ROD_ITEM_ID ||
        itemId === ROD_OF_IVANDIS_ITEM_ID) &&
      option &&
      /inspect/i.test(option)
    ) {
      event.handled = true;
      const variant = itemId === SILVTHRILL_ROD_ITEM_ID ? "rod-of-ivandis-inspecting-the-rod" : "rod-of-ivandis-inspecting-the-rod";
      play(player, NpcIdentifiers.VELIAF_HURTZ_2, variant);
    }
  }

  // ---------------------------------------------------------------------------
  // Doors and ladders
  // ---------------------------------------------------------------------------

  function claimGate(request) {
    if (request.handled || !BURGH_GATE_IDS.has(request.objectId)) return;
    const { player } = request;
    if (!player) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_FOOD_PLACED) {
      request.handled = true;
      play(player, NpcIdentifiers.FLORIN, "entering-burgh-de-rott-attempting-to-open-the-gate");
      return;
    }
    request.handled = true;
    const inside = player.getLocation().getY() < 3244;
    player.moveTo(new Location(3485, inside ? 3246 : 3242, 0));
  }

  function claimLadder(request) {
    if (request.handled || request.clickType !== 1) return;
    // The ladders:climb payload carries the clicked object, not a location field.
    const { player, object, objectId } = request;
    const location = object?.getLocation?.();
    if (!player || !location) return;
    const stage = quest.getStage(player);
    if (objectId === SHOP_LADDER_UP_ID && location.getZ() === 0) {
      request.handled = true;
      player.moveTo(new Location(3513, 3238, 2));
      return;
    }
    if (objectId === SHOP_LADDER_DOWN_ID && location.getZ() === 2) {
      request.handled = true;
      player.moveTo(new Location(3513, 3238, 0));
      return;
    }
    if (objectId === HIDEOUT_LADDER_ID && location.getZ() === 0 && stage >= STAGE_TRAPDOOR_OPEN) {
      request.handled = true;
      player.moveTo(new Location(3489, 3232, 0));
      return;
    }
    if (objectId === TRAPDOOR_OPEN_ID) {
      request.handled = true;
      player.moveTo(new Location(BASEMENT_LANDING.x, BASEMENT_LANDING.y, BASEMENT_LANDING.z));
      return;
    }
    if (objectId === LIBRARY_TRAPDOOR_ID) {
      request.handled = true;
      player.moveTo(new Location(LIBRARY_TILE.x, LIBRARY_TILE.y, LIBRARY_TILE.z));
      return;
    }
    if (objectId === LIBRARY_LADDER_ID) {
      request.handled = true;
      player.moveTo(new Location(3441, 9899, 0));
    }
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  function handleLogin({ player }) {
    installQuestObjects();
    refreshQuestList(player);
    applyStageSpawns(player);
    refreshEncounterSpawns(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    despawnAll(player);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(CRATE_AXES_ATTRIBUTE);
  api.persistAttribute(CRATE_FISH_ATTRIBUTE);
  api.persistAttribute(CRATE_FISH_TYPE_ATTRIBUTE);
  api.persistAttribute("quest.in_aid_of_the_myreque.fishtype.set");
  api.persistAttribute(CRATE_TINDER_ATTRIBUTE);
  api.persistAttribute(IVAN_FOOD_ATTRIBUTE);
  api.persistAttribute(ENCOUNTER_ATTRIBUTE);
  api.persistAttribute(FIGHT_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "in_aid_of_the_myreque",
    name: "In Aid of the Myreque",
    varbitId: VARBIT_IN_AID_OF_THE_MYREQUE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    // QH's final step key is 420; the native quest status reads varbit 1990
    // and completes at the DB threshold 430. Keep the durable stage at 420 for
    // old saves and map only the completed value to the canonical wire value.
    varbitValue(stage) {
      return stage >= STAGE_COMPLETE ? STAGE_COMPLETE_WIRE : stage;
    },
    questPoints: 2,
    xpRewards: REWARD_SKILLS.map((reward) => ({
      skillId: reward.skill.getIndex(),
      amount: REWARD_XP,
      label: reward.label,
    })),
    otherRewards: ["Access to Burgh de Rott", "The ability to make the Rod of Ivandis"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:condition", handleChosenCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", fillTranscriptText);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("door:toggle", claimGate);
  api.onCustomEvent("ladders:climb", claimLadder);
  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcInteraction("Aurel", { "Talk-to": talkAurel });
  api.onNpcInteraction("Florin", { "Talk-to": talkFlorin });
  api.onNpcInteraction("Razvan", { "Talk-to": talkRazvan });
  api.onNpcInteraction("Cornelius", { "Talk-to": talkCornelius });
  api.onNpcInteraction("Wiskit", { "Talk-to": talkWiskit });
  api.onNpcInteraction("Gadderanks", { "Talk-to": talkGadderanks });
  api.onNpcInteraction("Vampyre Juvinate", { "Talk-to": talkJuvinate });
  api.onNpcInteraction("Polmafi Ferdygris", { "Talk-to": talkPolmafi });
  api.onNpcInteraction("Radigad Ponfit", { "Talk-to": talkRadigad });
  api.onNpcInteraction("Ivan Strom", { "Talk-to": talkIvan });
  api.onNpcInteraction("Drezel", { "Talk-to": talkDrezel });
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onCustomEvent("magic:enchant-item-recipe", provideRodEnchantRecipe);
  api.onCustomEvent("magic:enchant-item-cast", finishRodEnchant);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemAction(handleItemAction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
