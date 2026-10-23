/**
 * The Path of Glouphrie (members).
 *
 * The words come from the "The Path of Glouphrie" transcript page. This plugin supplies
 * the variant selectors for the shared gnome NPCs (King Bolren, Golrie, Gianne jnr.,
 * Longramble), the Hazelmere Talk-to interception (Eyes of Glouphrie's variant selector
 * answers for him first), the prose-condition answers, the storeroom (monoliths, chests,
 * singing bowl, strongroom gate, diary lectern), Yewnock's machine and exchanger, the
 * Incomitatus spirit tree, the warped terrorbirds and the final cutscene/rewards.
 *
 * Stages (varbit 15288 "pog", varp 3992 bits 0-8; cache script 4024 quest id 3425).
 * Values are confirmed by the RSProx 1694 capture and follow RuneLite Quest Helper
 * pinned 06da90f9 (thepathofglouphrie/ThePathOfGlouphrie.java):
 * 0 not started, 2 started/Bolren again, 4 Golrie asked, 6 storeroom entered,
 * 8/10/12 monolith puzzle, 14 Bolrie's diary read, 16 machine ready, 18 machine
 * activated (Dumpling revealed), 20 evil creature killed, 22 told to find
 * Longramble, 24 Gianne gave the coordinates, 26 Longramble found, 28 traded with
 * Longramble, 30/32/34/36 spirit tree conversations, 38 Incomitatus healed,
 * 40 tree thanked, 42 sewers entered, 44 warped depths reached, 46 terrorbirds
 * defeated, 48 final cutscene watched, 50 complete after Hazelmere's last words.
 * Sibling varbits are set alongside:
 * 15289-15290 bowl/chime, 15291-15293 diary chapters, 15294 watcher reveal,
 * 15295-15298 return flags.
 *
 * Requirements per the wiki: The Eyes of Glouphrie, Waterfall Quest and Tree Gnome
 * Village complete, 60 Strength, 56 Slayer, 56 Thieving, 47 Ranged, 45 Agility (not
 * boostable). Rewards: 2 Quest points, four magic lamps (30,000 Strength, 20,000
 * Slayer, 5,000 Thieving, 5,000 Magic XP), the Poison Waste Dungeon and Incomitatus.
 *
 * Source: https://oldschool.runescape.wiki/w/The_Path_of_Glouphrie and
 * https://oldschool.runescape.wiki/w/Transcript:The_Path_of_Glouphrie.
 *
 * Gaps/approximations:
 * - the storeroom is not instanced. The five owner monoliths use the captured RSProx
 *   1694 anchors and 2x2/1x1 sizes, persist their positions per player, push one tile
 *   away from the player, and validate room clipping/other monoliths. Each chest is
 *   gated on the captured position/order and the previous chest; Reset restores the
 *   anchors without relooting. Unlocking the strongroom removes the shared base-map
 *   gate instead of swapping it, and login/region load reconcile that earned state.
 * - the chests hand out the Quest Helper shape sets. Yewnock's machine uses the real 848
 *   interface with a persisted-per-session random first-slot target and two-slot sum,
 *   three Insert buttons, Reset and Submit; discs are used on the machine because this
 *   server has no plugin hook for the client's disc-picker sub-interface. The exchanger
 *   splits discs into equivalent pairs.
 * - Bolrie's diary uses the real 854 chapter widgets 5/9/13 in order, with each chapter's
 *   camera/variant; the machine only becomes ready after all three chapters are read.
 *   The wiki's "chapter seen" markers (unavailable steps) are skipped.
 * - the Poison Waste sewer uses the real entrance, five pipe ladders and metal-gate
 *   zone to the boss room. Three warped terrorbirds spawn in the boss chamber; warped
 *   tortoises and the full multi-chamber sewer are not populated beyond those ladders.
 * - the crystal chime is required in the inventory to damage the terrorbirds (Wiki).
 *   Recorded camera/fade tracks play for the diary vision, Dumpling reveal, spirit tree
 *   and final cutscene, and the final action teleports to Hazelmere's house. Destroyed
 *   magic lamps cannot be reclaimed from Hazelmere.
 */
module.exports = function registerPathOfGlouphrieQuest(api) {
  const {
    Area,
    Boundary,
    GameObject,
    ItemIdentifiers,
    Location,
    MapObjects,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    ObjectManager,
    RegionManager,
    Skill,
    Task,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const PAGE = "The Path of Glouphrie";
  const GOLRIE_PAGE = "Golrie";
  const START_HOOK = "quest:the-path-of-glouphrie:start";

  const VARP_POG = 3992;
  const VARBIT_POG_STAGE = 15288; // "pog", varp 3992 bits 0-8
  const VARBIT_BOWL_EXAMINED = 15289;
  const VARBIT_BOWL_CHIME = 15290;
  const VARBIT_DIARY_1 = 15291;
  const VARBIT_DIARY_2 = 15292;
  const VARBIT_DIARY_3 = 15293;
  const VARBIT_WATCHER = 15294; // "pog_watcher_multivar"
  const VARBIT_GOLRIE_RETURN = 15295;
  const VARBIT_LONGRAMBLE_DONE = 15296;
  const VARBIT_LONGRAMBLE_DELIVERY = 15297;
  const VARBIT_KING_BOLREN_DONE = 15298;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_GOLRIE_TOLD = 4;
  const STAGE_STOREROOM = 6;
  const STAGE_MONOLITH_START = 8;
  const STAGE_MONOLITH_PROGRESS = 10;
  const STAGE_MONOLITH_DONE = 12;
  const STAGE_DIARY_READ = 14;
  const STAGE_CHIME_MADE = 16;
  const STAGE_MACHINE_ACTIVATED = 18;
  const STAGE_CREATURE_KILLED = 20;
  const STAGE_SENT_FOR_LONGRAMBLE = 22;
  const STAGE_HAS_COORDINATES = 24;
  const STAGE_LONGRAMBLE_MET = 26;
  const STAGE_LONGRAMBLE_TRADED = 28;
  const STAGE_TREE_SPOKEN = 30;
  const STAGE_TREE_AGAIN = 32;
  const STAGE_TREE_READY = 34;
  const STAGE_TREE_HEALED = 36;
  const STAGE_TREE_CHIMED = 38;
  const STAGE_TREE_THANKED = 40;
  const STAGE_SEWER = 42;
  const STAGE_WARPED_DEPTHS = 44;
  const STAGE_BIRDS_DEAD = 46;
  const STAGE_FINAL_CUTSCENE = 48;
  const STAGE_COMPLETE = 50;

  const STRENGTH_REQUIREMENT = 60;
  const SLAYER_REQUIREMENT = 56;
  const THIEVING_REQUIREMENT = 56;
  const RANGED_REQUIREMENT = 47;
  const AGILITY_REQUIREMENT = 45;

  const KING_BOLREN_NPC_ID = NpcIdentifiers.KING_BOLREN; // 4963
  const GOLRIE_NPC_IDS = new Set([NpcIdentifiers.GOLRIE, NpcIdentifiers.GOLRIE_2]); // 892, 4183
  const GIANNE_JNR_NPC_ID = NpcIdentifiers.GIANNE_JNR_; // 2547
  const LONGRAMBLE_NPC_ID = NpcIdentifiers.LONGRAMBLE; // 12466
  const HAZELMERE_NPC_ID = NpcIdentifiers.HAZELMERE; // 1422
  const HAZELMERE_NPC_IDS = new Set([NpcIdentifiers.HAZELMERE, NpcIdentifiers.HAZELMERE_2]); // 1422, 4647
  const KING_BOLRIE_NPC_ID = NpcIdentifiers.KING_BOLRIE; // 12471
  const CUTE_CREATURE_NPC_ID = NpcIdentifiers.CUTE_CREATURE_7; // 12476
  const EVIL_CREATURE_NPC_ID = NpcIdentifiers.EVIL_CREATURE_7; // 12477
  const BIG_MONOLITH_NPC_ID = NpcIdentifiers.COL_00FFFF_BIG_MONOLITH_COL; // 12486
  const SMALL_MONOLITH_NPC_ID = NpcIdentifiers.COL_00FFFF_SMALL_MONOLITH_COL; // 12487
  const WARPED_TERRORBIRD_NPC_IDS = [
    NpcIdentifiers.WARPED_TERRORBIRD, // 12491
    NpcIdentifiers.WARPED_TERRORBIRD_2, // 12492
    NpcIdentifiers.WARPED_TERRORBIRD_3, // 12493
  ];

  const TANGLED_TOADS_LEGS_ITEM_ID = ItemIdentifiers.TANGLED_TOADS_LEGS; // 2187
  const MINT_CAKE_ITEM_ID = ItemIdentifiers.MINT_CAKE; // 9475
  const CHEST_KEY_ITEM_ID = ItemIdentifiers.CHEST_KEY_9; // 28573
  const STRONGROOM_KEY_ITEM_ID = ItemIdentifiers.STRONGROOM_KEY; // 28574
  const CRYSTAL_CHIME_SEED_ITEM_ID = ItemIdentifiers.CRYSTAL_CHIME_SEED; // 28575
  const CRYSTAL_CHIME_ITEM_ID = ItemIdentifiers.CRYSTAL_CHIME; // 28577
  const YEWNOCKS_NOTES_ITEM_ID = ItemIdentifiers.YEWNOCKS_NOTES; // 28579
  const RED_CIRCLE_ITEM_ID = ItemIdentifiers.RED_CIRCLE; // 9597
  const RED_TRIANGLE_ITEM_ID = ItemIdentifiers.RED_TRIANGLE; // 9598
  const RED_SQUARE_ITEM_ID = ItemIdentifiers.RED_SQUARE; // 9599
  const ORANGE_SQUARE_ITEM_ID = ItemIdentifiers.ORANGE_SQUARE; // 9603
  const YELLOW_TRIANGLE_ITEM_ID = ItemIdentifiers.YELLOW_TRIANGLE; // 9606
  const GREEN_SQUARE_ITEM_ID = ItemIdentifiers.GREEN_SQUARE; // 9611
  const FIRST_DISC_ITEM_ID = RED_CIRCLE_ITEM_ID; // 9597
  const LAST_DISC_ITEM_ID = ItemIdentifiers.VIOLET_PENTAGON; // 9624
  const LAMP_ITEM_IDS = [
    ItemIdentifiers.MAGIC_LAMP_STRENGTH_, // 28587
    ItemIdentifiers.MAGIC_LAMP_SLAYER_, // 28588
    ItemIdentifiers.MAGIC_LAMP_THIEVING_, // 28589
    ItemIdentifiers.MAGIC_LAMP_MAGIC_, // 28590
  ];
  const LAMP_XP = new Map([
    [ItemIdentifiers.MAGIC_LAMP_STRENGTH_, { skill: Skill.STRENGTH, amount: 30000, label: "Strength" }],
    [ItemIdentifiers.MAGIC_LAMP_SLAYER_, { skill: Skill.SLAYER, amount: 20000, label: "Slayer" }],
    [ItemIdentifiers.MAGIC_LAMP_THIEVING_, { skill: Skill.THIEVING, amount: 5000, label: "Thieving" }],
    [ItemIdentifiers.MAGIC_LAMP_MAGIC_, { skill: Skill.MAGIC, amount: 5000, label: "Magic" }],
  ]);

  const DYING_SPIRIT_TREE_OBJECT_ID = ObjectIdentifiers.SPIRIT_TREE_24; // 49592
  const HEALTHY_SPIRIT_TREE_OBJECT_ID = ObjectIdentifiers.SPIRIT_TREE_27; // 49595
  // Map raw loc 49910 transforms on varbit 15289: 0 -> 49610 Inspect, 1 -> 49611 Sing-crystal.
  const SINGING_BOWL_PARENT_OBJECT_ID = 49910;
  const WOOD_CHEST_OBJECT_ID = ObjectIdentifiers.CHEST_230; // 49612
  const KEY_CHEST_OBJECT_ID = ObjectIdentifiers.CHEST_233; // 49615
  const SEARCH_CHEST_OBJECT_ID = ObjectIdentifiers.CHEST_235; // 49617
  const STOREROOM_TUNNEL_ENTRY_OBJECT_ID = ObjectIdentifiers.TUNNEL_59; // 49619
  const STOREROOM_TUNNEL_EXIT_OBJECT_ID = ObjectIdentifiers.TUNNEL_61; // 49623
  const STRONGROOM_GATE_OBJECT_ID = ObjectIdentifiers.GATE_283; // 49657
  const STRONGROOM_GATE_OPEN_OBJECT_ID = ObjectIdentifiers.GATE_284; // 49658
  const MACHINE_OBJECT_ID = ObjectIdentifiers.YEWNOCKS_MACHINE_2; // 49662
  const EXCHANGER_OBJECT_ID = ObjectIdentifiers.YEWNOCKS_EXCHANGER; // 49663
  const LECTERN_OBJECT_ID = ObjectIdentifiers.LECTERN_16; // 49673
  const HEAVY_DOOR_OBJECT_ID = ObjectIdentifiers.HEAVY_DOOR_10; // 49600
  const HAZELMERE_HOUSE_TILE = new Location(2678, 3086, 1);
  const SEWER_ENTRANCE_OBJECT_ID = ObjectIdentifiers.SEWER_ENTRANCE; // 49868
  const SEWER_LADDER_UP_OBJECT_ID = 49700; // pog_sewer_pipe_side_ladder
  const SEWER_LADDER_DOWN_OBJECT_ID = 49701; // pog_sewer_ladder_top
  const SEWER_LADDER_CHILD = "Climb-up";
  const SEWER_LADDER_TOP_CHILD = "Climb-down";
  const SEWER_ZONE = { minX: 1465, maxX: 1540, minY: 4215, maxY: 4300, levels: [0, 1] };
  const SEWER_EXIT_TILE = new Location(1472, 4238, 0);
  const BOSS_ROOM_TILE = new Location(1507, 4324, 1);
  const BOSS_DOOR_ZONE = { minX: 1504, maxX: 1506, minY: 4318, maxY: 4320, levels: [1] };

  const BOLREN_START_VARIANT = "the-king-s-little-dumpling-talking-to-king-bolren";
  const GOLRIE_DEVICE_CHOICE = "i need your help with a device";
  const GIANNE_LONGRAMBLE_CHOICE = "i need your help finding a certain gnome";
  const TREE_FIRST_VARIANT = "arbor-incomitata-talking-to-the-spirit-tree-after-talking-to-longramble";
  const TREE_AGAIN_VARIANT = `${TREE_FIRST_VARIANT}-talking-to-the-spirit-tree-again`;
  const TREE_CHIME_VARIANT = "arbor-incomitata-using-the-crystal-chime-on-the-spirit-tree";
  const HAZELMERE_HOUSE_VARIANT = "arbor-incomitata-talking-to-hazelmere-at-his-house-after-talking-to-the-spirit-tree";
  const HAZELMERE_LAMPS_VARIANT =
    "post-quest-talking-to-hazelmere-to-receive-unused-lamps-if-the-player-has-sufficient-inventory-space";
  const HAZELMERE_POST_VARIANT = "post-quest-talking-to-hazelmere-after-the-quest";
  const FINAL_VARIANT = "the-warped-depths";
  const DIARY_VARIANTS = [
    "yewnock-s-legacy-bolrie-s-diary-chapter-1-bad-advice",
    "yewnock-s-legacy-bolrie-s-diary-chapter-2-the-king-is-dead",
    "yewnock-s-legacy-bolrie-s-diary-chapter-3-eyes-opened",
  ];

  const CONTINUE_STEP_IDS = new Set([
    "5lkTkp", // diary chapter 1 seen marker
    "0wqCOz", // diary chapter 2 seen marker
    "UoUSjz", // diary chapter 3 seen markers
    "GcmILY",
    "QyHx26", // tree talk: never carried a chime
    "AocdR6", // post-quest lamp hand-out preamble
    "3ZrkVR", // post-quest Longramble tail
  ]);
  const COMPLETE_STEP_ID = "Lv5xyo";
  const FINAL_READY_ACTION_IDS = new Set(["05g2kM", "5N6PuB"]);
  const TREE_CHIME_ACTION_ID = "QJ5K9p";
  const TOADS_GIVE_STEP_ID = "fVX5us";
  const CAKE_RECEIVE_STEP_ID = "HDplvK";
  const LAMPS_MULTIPLE_MESSAGE_ID = "HCknfU";
  const LAMP_SINGLE_MESSAGE_ID = "dydZII";

  const CONDITION_HAS_TOADS = "f30JUB";
  const CONDITION_HAS_CHIME = "0ge934";
  const CONDITION_HAD_CHIME = "f37U6O";
  const CONDITION_NEVER_CHIME = "tsyuaC";
  const CONDITION_NO_CHIME = "vbBzqR";
  const CONDITION_HOLDING_CHIME = "SGuWuR";
  const CONDITION_MULTIPLE_LAMPS = "7wS26R";
  const CONDITION_ONE_LAMP = "801q-d";

  const BITS_ATTRIBUTE = "quest.the_path_of_glouphrie.bits";
  const LAMPS_ATTRIBUTE = "quest.the_path_of_glouphrie.lamps";
  const BIRD_ATTRIBUTE = "the-path-of-glouphrie:terrorbird";
  const MONOLITH_ATTRIBUTE = "the-path-of-glouphrie:monoliths";
  const LAMP_VARBITS = [15305, 15306, 15307, 15308]; // pog_strength/slayer/thieving/magic_lamp
  const BIT_BOWL_EXAMINED = 1 << 0;
  const BIT_CHIME = 1 << 1;
  const BIT_GATE = 1 << 2;
  const BIT_TREE_SPOKEN = 1 << 3;
  const BIT_TREE_HEALED = 1 << 4;
  const BIT_LONGRAMBLE_MET = 1 << 5;
  const BIT_LONGRAMBLE_TRADED = 1 << 6;
  const BIT_BOLREN_DONE = 1 << 7;
  const DIARY_BITS = [1 << 8, 1 << 9, 1 << 10];
  const CHEST_BITS = {
    "2791,4249": 1 << 13, // first shapes
    "2788,4262": 1 << 12, // second shapes
    "2785,4261": 1 << 24, // first key
    "2789,4258": 1 << 11, // golden chest: strongroom key + chime seed
    "2793,4253": 1 << 14, // third shapes
  };
  // Quest Helper MonolithPuzzle: each chest opens only after the recorded push positions.
  // The key/golden/third chests also require the previous chest.
  const CHEST_REQUIREMENTS = new Map([
    ["2791,4249", { progress: 1 }],
    ["2788,4262", { progress: 3 }],
    ["2785,4261", { progress: 3, chest: "2788,4262" }],
    ["2789,4258", { progress: 5, chest: "2785,4261" }],
    ["2793,4253", { chest: "2789,4258" }],
  ]);
  const BIRD_BITS = [1 << 19, 1 << 20, 1 << 21];
  const BIT_MACHINE = 1 << 22;
  const BIT_CREATURE_KILLED = 1 << 23;

  const LECTERN_INTERFACE = 854;
  const LECTERN_CHAPTER_BUTTONS = [5, 9, 13];
  const MACHINE_INTERFACE = 848;
  const MACHINE_INSERT_BUTTONS = [19, 20, 21];
  const MACHINE_RESET_BUTTON = 25;
  const MACHINE_SUBMIT_BUTTON = 26;
  const MACHINE_CLOSE_BUTTON = 27;
  const MACHINE_MODEL_SLOTS = [13, 14, 15];
  const MACHINE_SLOTS = 3;
  // Disc values handed out by the storeroom chests; every puzzle uses three distinct ones.
  const PUZZLE_VALUES = [1, 3, 4, 8, 9, 16];
  const DIARY_CAMERA_TRACKS = [
    [[[2528, 3166, 480], [2538, 3166, 300]]],
    [[[2459, 3474, 670], [2462, 3477, 170]]],
    [[[2340, 5412, 600], [2337, 5416, 20]]],
  ];
  const DUMPLING_CAMERA_TRACKS = [
    [[2390, 9819, 370], [2390, 9828, 70]],
    [[2340, 5418, 260], [2335, 5413, 160]],
  ];
  const TREE_CAMERA_TRACK = [[2339, 3101, 620], [2339, 3114, 260]];
  const FINAL_CAMERA_TRACKS = [
    [[1392, 4381, 420], [1402, 4386, 220]],
    [[1390, 4383, 700], [1392, 4383, 30]],
    [[1395, 4383, 500], [1378, 4383, 300]],
    [[1389, 4389, 300], [1395, 4389, 275]],
    [[1387, 4389, 400], [1385, 4381, 300]],
  ];
  const SHAPE_VALUES = [1, 3, 4, 5];

  const STOREROOM_LANDING = new Location(2789, 4243, 0);
  const TUNNEL_BACK_LANDING = new Location(2544, 9570, 0);
  const GATE_TILE = new Location(2782, 4255, 0);
  const SPIRIT_TREE_TILE = new Location(2339, 3111, 0);
  const LONGRAMBLE_TILE = new Location(2340, 3094, 0);
  const CUTE_CREATURE_TILE = new Location(2541, 3169, 0);
  const HEAVY_DOOR_TILE = new Location(1521, 4319, 1);
  const TERRORBIRD_TILES = [
    new Location(1508, 4322, 1),
    new Location(1512, 4324, 1),
    new Location(1516, 4326, 1),
  ];
  // RSProx 1694 (transcript ticks 2952+): five owner monoliths, four 2x2 and one 1x1.
  const MONOLITH_INITIAL = [
    { id: BIG_MONOLITH_NPC_ID, size: 2, x: 2788, y: 4245 }, // southern
    { id: BIG_MONOLITH_NPC_ID, size: 2, x: 2787, y: 4253 }, // south-west
    { id: BIG_MONOLITH_NPC_ID, size: 2, x: 2790, y: 4253 }, // south-east
    { id: BIG_MONOLITH_NPC_ID, size: 2, x: 2787, y: 4256 }, // north-west
    { id: SMALL_MONOLITH_NPC_ID, size: 1, x: 2791, y: 4257 }, // small
  ];
  // The same capture's push order/positions. The player stands on the named side, so the
  // southern and south-west monoliths move south, the north-west one east then west, the
  // small one north, and the south-east one west. Chest gates use the matching prefix.
  const MONOLITH_STEPS = [
    { index: 0, x: 2788, y: 4246 },
    { index: 1, x: 2787, y: 4254 },
    { index: 3, x: 2788, y: 4256 },
    { index: 4, x: 2791, y: 4256 },
    { index: 3, x: 2787, y: 4256 },
    { index: 2, x: 2789, y: 4253 },
  ];

  // Owner-scoped NPCs must exist as soon as their stage/area is reached, not only after a
  // relog: each zone ensures the NPCs it gates.
  const VILLAGE_ZONE = { minX: 2530, maxX: 2560, minY: 3155, maxY: 3185, levels: [0] };
  const LONGRAMBLE_ZONE = { minX: 2320, maxX: 2360, minY: 3080, maxY: 3120, levels: [0] };
  const STOREROOM_ZONE = { minX: 2770, maxX: 2805, minY: 4235, maxY: 4275, levels: [0] };
  const WARPED_DEPTHS_ZONE = { minX: 1495, maxX: 1525, minY: 4305, maxY: 4350, levels: [1] };
  const TERRORBIRD_AREA_BOUNDARY = new Boundary(
    WARPED_DEPTHS_ZONE.minX,
    WARPED_DEPTHS_ZONE.maxX,
    WARPED_DEPTHS_ZONE.minY,
    WARPED_DEPTHS_ZONE.maxY,
    1
  );

  let quest;
  let treeObject = null;
  let heavyDoorObject = null;
  let treeHealed = false;
  let gateUnlocked = false;
  let heavyDoorInstalled = false;
  const cuteByPlayer = new Map();
  const evilByPlayer = new Map();
  const monolithsByPlayer = new Map();
  const monolithSafeTiles = new WeakMap();
  const birdsByPlayer = new Map();
  const longrambleByPlayer = new Map();
  const machineProgress = new WeakMap();
  const Scenes = createQuestScenes(api);
  const MACHINE_MIGRATION_ATTRIBUTE = "the-path-of-glouphrie:migration";
  const MACHINE_MIGRATION_VERSION = 2;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  /** Inventory or bank ownership for one-off quest tools; prevents duplicate recovery. */
  function ownsAnywhere(player, itemId) {
    if (held(player, itemId)) return true;
    const banks = player.getBanks?.() ?? (player.getBank ? [player.getBank()] : []);
    return banks.some((bank) => Number(bank?.getAmount?.(itemId) ?? 0) > 0);
  }
  const isGolrie = (npcId) => GOLRIE_NPC_IDS.has(npcId);
  const isHazelmere = (npcId) => HAZELMERE_NPC_IDS.has(npcId);

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function lampCount(player) {
    return Number(player.getAttribute(LAMPS_ATTRIBUTE)) || 0;
  }

  function setLampCount(player, count) {
    player.setAttribute(LAMPS_ATTRIBUTE, count | 0);
  }

  function lampsRemaining(player) {
    return Math.max(0, LAMP_ITEM_IDS.length - lampCount(player));
  }

  function sendVarbit(player, varbitId, value) {
    player.getPacketSender().sendVarbit(varbitId, value);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsStartRequirements(player) {
    const skills = player.getSkillManager();
    return (
      questComplete(player, "the_eyes_of_glouphrie") &&
      questComplete(player, "waterfall_quest") &&
      questComplete(player, "tree_gnome_village") &&
      skills.getMaxLevel(Skill.STRENGTH) >= STRENGTH_REQUIREMENT &&
      skills.getMaxLevel(Skill.SLAYER) >= SLAYER_REQUIREMENT &&
      skills.getMaxLevel(Skill.THIEVING) >= THIEVING_REQUIREMENT &&
      skills.getMaxLevel(Skill.RANGED) >= RANGED_REQUIREMENT &&
      skills.getMaxLevel(Skill.AGILITY) >= AGILITY_REQUIREMENT
    );
  }

  function playVariant(player, npcId, variant) {
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function grantItem(player, itemId, amount = 1) {
    if (player.getInventory().getFreeSlots() < amount) {
      player.sendMessage("You need more inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function discValue(itemId) {
    if (itemId < FIRST_DISC_ITEM_ID || itemId > LAST_DISC_ITEM_ID) return 0;
    const offset = itemId - FIRST_DISC_ITEM_ID;
    return ((offset >> 2) + 1) * SHAPE_VALUES[offset & 3];
  }

  const DISC_ITEM_BY_VALUE = new Map();
  for (let itemId = FIRST_DISC_ITEM_ID; itemId <= LAST_DISC_ITEM_ID; itemId++) {
    const value = discValue(itemId);
    if (!DISC_ITEM_BY_VALUE.has(value)) DISC_ITEM_BY_VALUE.set(value, itemId);
  }
  const DISC_VALUES_DESCENDING = [...DISC_ITEM_BY_VALUE.keys()].sort((a, b) => b - a);

  function splitDisc(value) {
    for (const high of DISC_VALUES_DESCENDING) {
      if (high >= value) continue;
      const low = value - high;
      if (DISC_ITEM_BY_VALUE.has(low)) {
        return [DISC_ITEM_BY_VALUE.get(high), DISC_ITEM_BY_VALUE.get(low)];
      }
    }
    return null;
  }

  function ensureObject(objectId, location, type = 10, face = 0) {
    for (const object of ObjectManager.objectsAt(location)) {
      if (object.getId() === objectId) return object;
    }
    const object = new GameObject(objectId, location.clone(), type, face, null);
    ObjectManager.register(object, true);
    return object;
  }

  function ensureTree() {
    if (treeObject) return;
    const id = treeHealed ? HEALTHY_SPIRIT_TREE_OBJECT_ID : DYING_SPIRIT_TREE_OBJECT_ID;
    treeObject = ensureObject(id, SPIRIT_TREE_TILE, 10, 0);
  }

  function replaceTree() {
    if (treeObject) ObjectManager.deregister(treeObject, true);
    treeObject = null;
    treeHealed = true;
    treeObject = ensureObject(HEALTHY_SPIRIT_TREE_OBJECT_ID, SPIRIT_TREE_TILE, 10, 0);
  }

  function ensureHeavyDoor() {
    if (heavyDoorInstalled) return;
    heavyDoorInstalled = true;
    heavyDoorObject = ensureObject(HEAVY_DOOR_OBJECT_ID, HEAVY_DOOR_TILE, 0, 0);
  }

  function ensureQuestObjects() {
    ensureTree();
  }

  function syncVarbits(player) {
    sendVarbit(player, VARBIT_BOWL_EXAMINED, hasBit(player, BIT_BOWL_EXAMINED) ? 1 : 0);
    sendVarbit(player, VARBIT_BOWL_CHIME, hasBit(player, BIT_CHIME) ? 1 : 0);
    DIARY_BITS.forEach((bit, index) => sendVarbit(player, VARBIT_DIARY_1 + index, hasBit(player, bit) ? 1 : 0));
    sendVarbit(player, VARBIT_WATCHER, hasBit(player, BIT_MACHINE) ? 1 : 0);
    sendVarbit(player, VARBIT_GOLRIE_RETURN, hasBit(player, BIT_GATE) ? 1 : 0);
    sendVarbit(player, VARBIT_LONGRAMBLE_DONE, hasBit(player, BIT_LONGRAMBLE_MET) ? 1 : 0);
    sendVarbit(player, VARBIT_LONGRAMBLE_DELIVERY, hasBit(player, BIT_LONGRAMBLE_TRADED) ? 1 : 0);
    sendVarbit(player, VARBIT_KING_BOLREN_DONE, hasBit(player, BIT_BOLREN_DONE) ? 1 : 0);
    LAMP_VARBITS.forEach((varbitId, index) => sendVarbit(player, varbitId, lampCount(player) > index ? 1 : 0));
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>King Bolren's new pet was another of Glouphrie's spies.</str>",
        "<str>I unmasked it with Yewnock's machine, healed the spirit</str>",
        "<str>tree Incomitatus, and was rescued from the sewers beneath</str>",
        "<str>Arposandra by Hazelmere.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BIRDS_DEAD) {
      return ["The terrorbirds are dead. I should look beyond the heavy door to the east."];
    }
    if (stage >= STAGE_TREE_CHIMED) {
      return [
        "Incomitatus is healed. I should find the source of the",
        "poison in the <col=800000>Poison Waste Dungeon</col>.",
      ];
    }
    if (stage >= STAGE_LONGRAMBLE_MET) {
      return [
        "I found <col=800000>Longramble</col> by the Poison Waste. He told me of",
        "a waste outlet patrolled by a warped creature, and a sick",
        "spirit tree, <col=800000>Incomitatus</col>, needs my crystal chime.",
      ];
    }
    if (stage >= STAGE_HAS_COORDINATES) {
      return ["<col=800000>Gianne jnr.</col> gave me Longramble's coordinates; I should find him."];
    }
    if (stage >= STAGE_SENT_FOR_LONGRAMBLE) {
      return [
        "King Bolren asked me to find the explorer <col=800000>Longramble</col>.",
        "Aluft <col=800000>Gianne jnr.</col> at the Grand Tree knows where he is.",
      ];
    }
    if (stage >= STAGE_CREATURE_KILLED) {
      return ["I killed the evil creature. I should speak to <col=800000>King Bolren</col>."];
    }
    if (stage >= STAGE_MACHINE_ACTIVATED) {
      return ["<col=800000>Dumpling</col> was revealed as an evil creature. I must kill it."];
    }
    if (stage >= STAGE_DIARY_READ) {
      return ["I read Bolrie's diary. I should operate <col=800000>Yewnock's machine</col>."];
    }
    if (stage >= STAGE_CHIME_MADE) {
      return ["I made the <col=800000>crystal chime</col>. I should read Bolrie's diary on the lectern."];
    }
    if (stage >= STAGE_GOLRIE_TOLD) {
      return [
        "Golrie told me to search the storeroom past the small tunnel",
        "in the eastern chamber of the village dungeon.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "King Bolren has another of Glouphrie's spies for a pet.",
        "I need an anti-illusion device; Golrie may know of one.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>King Bolren</col>",
      "in the <col=800000>Tree Gnome Village</col>.",
      "",
      "Requirements: The Eyes of Glouphrie, Waterfall Quest, Tree",
      "Gnome Village, 60 Strength, 56 Slayer, 56 Thieving, 47",
      "Ranged, 45 Agility.",
    ];
  }

  function grantLamps(player) {
    const inventory = player.getInventory();
    let granted = lampCount(player);
    while (granted < LAMP_ITEM_IDS.length) {
      if (inventory.getFreeSlots() < 1) {
        player.sendMessage("You have no room for all the magic lamps; speak to Hazelmere to claim the rest.");
        break;
      }
      inventory.adds(LAMP_ITEM_IDS[granted], 1);
      sendVarbit(player, LAMP_VARBITS[granted], 1);
      granted += 1;
      setLampCount(player, granted);
    }
  }

  function handleLampAction(event) {
    const { player, itemId, slot } = event;
    const reward = LAMP_XP.get(itemId);
    if (!reward) return false;
    event.handled = true;
    const manager = player.getSkillManager();
    const before = manager.getExperience(reward.skill);
    manager.addExperiences(reward.skill, reward.amount);
    if (manager.getExperience(reward.skill) === before) {
      player.sendMessage("Your experience cannot be increased right now.");
      return true;
    }
    player.getInventory().deleteAtSlot(slot, 1);
    player.sendMessage(`You rub the lamp and gain ${reward.amount.toLocaleString("en-US")} ${reward.label} experience.`);
    return true;
  }

  // ==========================================================================
  // Dialogue: variant selection
  // ==========================================================================

  function bolrenVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-king-bolren-after-the-quest";
    if (stage >= STAGE_LONGRAMBLE_MET) {
      return "arbor-incomitata-talking-to-king-bolren-after-talking-to-longramble";
    }
    if (stage >= STAGE_SENT_FOR_LONGRAMBLE) {
      return "yewnock-s-legacy-talking-to-king-bolren-after-killing-the-evil-creature-talking-to-king-bolren-again";
    }
    if (stage === STAGE_CREATURE_KILLED) {
      return "yewnock-s-legacy-talking-to-king-bolren-after-killing-the-evil-creature";
    }
    if (stage === STAGE_MACHINE_ACTIVATED) {
      return "yewnock-s-legacy-talking-to-king-bolren-after-activating-yewnock-s-machine";
    }
    if (stage >= STAGE_GOLRIE_TOLD) {
      return "the-king-s-little-dumpling-talking-to-king-bolren-after-talking-to-golrie";
    }
    if (stage >= STAGE_STARTED) {
      return "the-king-s-little-dumpling-talking-to-king-bolren-talking-to-bolren-again";
    }
    return meetsStartRequirements(player) ? BOLREN_START_VARIANT : null;
  }

  function golrieVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return { page: GOLRIE_PAGE, variant: "standard-dialogue-after-the-path-of-glouphrie" };
    }
    if (stage >= STAGE_MACHINE_ACTIVATED) {
      return "yewnock-s-legacy-talking-to-golrie-after-activating-yewnock-s-machine";
    }
    if (stage >= STAGE_DIARY_READ) {
      return "yewnock-s-legacy-talking-to-golrie-after-telling-him-you-found-the-device";
    }
    if (stage >= STAGE_GOLRIE_TOLD) {
      return "the-king-s-little-dumpling-talking-to-golrie-talking-to-golrie-again";
    }
    return null;
  }

  function gianneVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_HAS_COORDINATES && stage < STAGE_COMPLETE) {
      return "yewnock-s-legacy-talking-to-gianne-jnr-again";
    }
    if (stage === STAGE_SENT_FOR_LONGRAMBLE) return "yewnock-s-legacy-talking-to-gianne-jnr";
    return null;
  }

  function longrambleVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-longramble-after-the-quest";
    if (stage >= STAGE_TREE_CHIMED) {
      return "arbor-incomitata-talking-to-longramble-after-healing-the-spirit-tree";
    }
    if (stage >= STAGE_HAS_COORDINATES && hasBit(player, BIT_LONGRAMBLE_MET)) {
      return "arbor-incomitata-talking-to-longramble-talking-to-longramble-again";
    }
    if (stage >= STAGE_HAS_COORDINATES) return "arbor-incomitata-talking-to-longramble";
    return null;
  }

  /** Which transcript variant the clicked NPC plays. Side-effect free. */
  function selectVariant({ npcId, player }) {
    if (npcId === KING_BOLREN_NPC_ID) return bolrenVariant(player);
    if (isGolrie(npcId)) return golrieVariant(player);
    if (npcId === GIANNE_JNR_NPC_ID) return gianneVariant(player);
    if (npcId === LONGRAMBLE_NPC_ID) return longrambleVariant(player);
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ player, text, stepId }) {
    switch (stepId) {
      case CONDITION_HAS_TOADS:
        return held(player, TANGLED_TOADS_LEGS_ITEM_ID);
      case CONDITION_HAS_CHIME:
        return held(player, CRYSTAL_CHIME_ITEM_ID);
      case CONDITION_HAD_CHIME:
        return !held(player, CRYSTAL_CHIME_ITEM_ID) && hasBit(player, BIT_CHIME);
      case CONDITION_NEVER_CHIME:
        return !held(player, CRYSTAL_CHIME_ITEM_ID) && !hasBit(player, BIT_CHIME);
      case CONDITION_NO_CHIME:
        return !held(player, CRYSTAL_CHIME_ITEM_ID);
      case CONDITION_HOLDING_CHIME:
        return held(player, CRYSTAL_CHIME_ITEM_ID);
      case CONDITION_MULTIPLE_LAMPS:
        return lampsRemaining(player) > 1;
      case CONDITION_ONE_LAMP:
        return lampsRemaining(player) === 1;
      default:
        break;
    }
    return null;
  }

  function finishCutscene(player) {
    Scenes.cancel(player);
    Scenes.closeFade(player);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
  }

  function playCamera(player, tracks, ticks) {
    Scenes.cancel(player);
    Scenes.controls(player, true, true);
    Scenes.camera(player, tracks[0][0], tracks[0][1]);
    tracks.slice(1).forEach((track, index) => {
      Scenes.later(player, (index + 1) * 3, () => Scenes.camera(player, track[0], track[1]));
    });
    Scenes.later(player, ticks, () => finishCutscene(player));
  }

  function playFinalCutscene(player) {
    Scenes.cancel(player);
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    Scenes.camera(player, FINAL_CAMERA_TRACKS[0][0], FINAL_CAMERA_TRACKS[0][1]);
    FINAL_CAMERA_TRACKS.slice(1).forEach((track, index) => {
      Scenes.later(player, (index + 1) * 4, () => Scenes.camera(player, track[0], track[1]));
    });
    Scenes.later(player, 4, () => Scenes.fade(player, false));
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== KING_BOLREN_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!meetsStartRequirements(player)) return;
    quest.setStage(player, STAGE_STARTED);
    ensureCuteCreature(player);
  }

  function handleChoice({ player, npcId, option }) {
    const choice = String(option ?? "").toLowerCase();
    if (isGolrie(npcId) && choice.includes(GOLRIE_DEVICE_CHOICE)) {
      if (quest.getStage(player) === STAGE_GOLRIE_TOLD) quest.setStage(player, STAGE_STOREROOM);
      ensureMonoliths(player);
      return;
    }
    if (npcId === GIANNE_JNR_NPC_ID && choice.includes(GIANNE_LONGRAMBLE_CHOICE)) {
      if (quest.getStage(player) === STAGE_SENT_FOR_LONGRAMBLE) quest.setStage(player, STAGE_HAS_COORDINATES);
      ensureLongramble(player);
    }
  }

  /** Stage transitions only the wiki's prose lines carry (no choice/action step). */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string") return;
    if (text.includes("[player name]")) {
      event.text = text.replace(/\[player name\]/gi, String(player.getUsername()));
    }
    if (npcId === KING_BOLREN_NPC_ID && text.includes("Did you have a look down in the caves?")) {
      if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_GOLRIE_TOLD);
      return;
    }
    if (npcId === LONGRAMBLE_NPC_ID && text.startsWith("Mr Longramble, I presume?")) {
      if (quest.getStage(player) === STAGE_HAS_COORDINATES) quest.setStage(player, STAGE_LONGRAMBLE_MET);
      setBit(player, BIT_LONGRAMBLE_MET);
      sendVarbit(player, VARBIT_LONGRAMBLE_DONE, 1);
      return;
    }
    if (npcId === KING_BOLREN_NPC_ID && text.startsWith("Thank you for dealing with that")) {
      if (quest.getStage(player) === STAGE_CREATURE_KILLED) quest.setStage(player, STAGE_SENT_FOR_LONGRAMBLE);
      setBit(player, BIT_BOLREN_DONE);
      sendVarbit(player, VARBIT_KING_BOLREN_DONE, 1);
      ensureLongramble(player);
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (CONTINUE_STEP_IDS.has(stepId)) {
      event.handled = true;
      return;
    }
    if (stepId === TOADS_GIVE_STEP_ID) {
      event.handled = true;
      if (!held(player, TANGLED_TOADS_LEGS_ITEM_ID)) return;
      player.getInventory().deleteNumber(TANGLED_TOADS_LEGS_ITEM_ID, 1);
      setBit(player, BIT_LONGRAMBLE_TRADED);
      if (quest.getStage(player) < STAGE_LONGRAMBLE_TRADED) quest.setStage(player, STAGE_LONGRAMBLE_TRADED);
      sendVarbit(player, VARBIT_LONGRAMBLE_DELIVERY, 1);
      return;
    }
    if (stepId === CAKE_RECEIVE_STEP_ID) {
      event.handled = true;
      if (held(player, MINT_CAKE_ITEM_ID) || !hasBit(player, BIT_LONGRAMBLE_TRADED)) return;
      grantItem(player, MINT_CAKE_ITEM_ID, 1);
      return;
    }
    if (stepId === TREE_CHIME_ACTION_ID) {
      event.handled = true;
      healTree(player);
      return;
    }
    if (stepId === LAMPS_MULTIPLE_MESSAGE_ID || stepId === LAMP_SINGLE_MESSAGE_ID) {
      // Message steps: grant before the default renderer prints the canonical text.
      grantLamps(player);
      return;
    }
    if (FINAL_READY_ACTION_IDS.has(stepId)) {
      event.handled = true;
      finishCutscene(player);
      player.moveTo(HAZELMERE_HOUSE_TILE);
      if (quest.getStage(player) < STAGE_FINAL_CUTSCENE) quest.setStage(player, STAGE_FINAL_CUTSCENE);
      return;
    }
    if (stepId === COMPLETE_STEP_ID) {
      event.handled = true;
      event.end = true;
      finishCutscene(player);
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_FINAL_CUTSCENE) quest.complete(player);
    }
  }

  // ==========================================================================
  // Hazelmere (Eyes of Glouphrie and The Grand Tree answer for him first)
  // ==========================================================================

  function talkToHazelmere(event) {
    const { player, npcId } = event;
    if (!isHazelmere(npcId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_LONGRAMBLE_MET) return false;
    if (stage >= STAGE_COMPLETE) {
      if (lampsRemaining(player) > 0 && !player.getInventory().isFull()) {
        playVariant(player, npcId, HAZELMERE_LAMPS_VARIANT);
      } else if (lampsRemaining(player) > 0) {
        player.sendMessage("You need more inventory space for Hazelmere's lamps.");
        playVariant(player, npcId, HAZELMERE_POST_VARIANT);
      } else {
        playVariant(player, npcId, HAZELMERE_POST_VARIANT);
      }
      return true;
    }
    playVariant(player, npcId, HAZELMERE_HOUSE_VARIANT);
    return true;
  }

  // ==========================================================================
  // Spirit tree, singing bowl and the storeroom
  // ==========================================================================

  function healTree(player) {
    playCamera(player, [TREE_CAMERA_TRACK], 8);
    if (!treeHealed) replaceTree();
    if (quest.getStage(player) < STAGE_TREE_CHIMED) quest.setStage(player, STAGE_TREE_CHIMED);
    setBit(player, BIT_TREE_HEALED);
    ensureBirds(player);
  }

  function handleTreeTalk(event) {
    const { player, objectId } = event;
    if (objectId === HEALTHY_SPIRIT_TREE_OBJECT_ID) {
      if (quest.getStage(player) === STAGE_TREE_CHIMED) quest.setStage(player, STAGE_TREE_THANKED);
      return false;
    }
    if (objectId !== DYING_SPIRIT_TREE_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_LONGRAMBLE_MET) {
      player.sendMessage("The tree doesn't look very well, or talkative.");
      return true;
    }
    if (stage >= STAGE_TREE_HEALED) return false;
    if (!hasBit(player, BIT_TREE_SPOKEN)) {
      setBit(player, BIT_TREE_SPOKEN);
      if (stage < STAGE_TREE_SPOKEN) quest.setStage(player, STAGE_TREE_SPOKEN);
      playVariant(player, HAZELMERE_NPC_ID, TREE_FIRST_VARIANT);
    } else if (stage < STAGE_TREE_AGAIN) {
      quest.setStage(player, STAGE_TREE_AGAIN);
      playVariant(player, HAZELMERE_NPC_ID, TREE_AGAIN_VARIANT);
    } else if (stage < STAGE_TREE_READY) {
      quest.setStage(player, STAGE_TREE_READY);
      playVariant(player, HAZELMERE_NPC_ID, TREE_AGAIN_VARIANT);
    } else if (stage < STAGE_TREE_HEALED) {
      quest.setStage(player, STAGE_TREE_HEALED);
      playVariant(player, HAZELMERE_NPC_ID, TREE_AGAIN_VARIANT);
    } else {
      playVariant(player, HAZELMERE_NPC_ID, TREE_AGAIN_VARIANT);
    }
    return true;
  }

  function useChimeOnTree(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_LONGRAMBLE_MET) {
      player.sendMessage("The tree doesn't look very well, or talkative.");
      return;
    }
    if (stage >= STAGE_TREE_CHIMED) return;
    if (stage < STAGE_TREE_HEALED) {
      player.sendMessage("The spirit tree hasn't finished speaking to you yet.");
      return;
    }
    playVariant(player, HAZELMERE_NPC_ID, TREE_CHIME_VARIANT);
  }

  function handleBowlInspect(event) {
    if (event.objectId !== SINGING_BOWL_PARENT_OBJECT_ID) return false;
    const { player } = event;
    setBit(player, BIT_BOWL_EXAMINED);
    sendVarbit(player, VARBIT_BOWL_EXAMINED, 1);
    player.sendMessage("The singing bowl hums faintly. Perhaps a crystal seed could be sung into it.");
    return true;
  }

  function makeChime(player) {
    if (!held(player, CRYSTAL_CHIME_SEED_ITEM_ID)) {
      player.sendMessage("You have nothing to sing into the bowl.");
      return;
    }
    player.getInventory().deleteNumber(CRYSTAL_CHIME_SEED_ITEM_ID, 1);
    player.getInventory().adds(CRYSTAL_CHIME_ITEM_ID, 1);
    setBit(player, BIT_CHIME);
    sendVarbit(player, VARBIT_BOWL_CHIME, 1);
    advanceToMachineReady(player);
    player.sendMessage("You sing to the crystal seed and it forms into a crystal chime.");
  }

  function handleBowlSing(event) {
    if (event.objectId !== SINGING_BOWL_PARENT_OBJECT_ID) return false;
    makeChime(event.player);
    return true;
  }

  function chestRequirementMet(player, key) {
    const requirement = CHEST_REQUIREMENTS.get(key);
    if (!requirement) return true;
    if (requirement.progress && monolithProgress(player) < requirement.progress) return false;
    if (requirement.chest && !hasBit(player, CHEST_BITS[requirement.chest])) return false;
    return true;
  }

  function placedObjectId(event) {
    // ObjectActionPacketListener passes the placed map id (e.g. 49911) plus the resolved
    // definition the client displays (e.g. 49615). Multi-locs such as the storeroom key
    // chest must be matched by that resolved definition, not by the raw id alone.
    const resolved = event.definition?.id;
    if (Number.isInteger(resolved)) return resolved;
    const definition = ObjectDefinition.forPlayer?.(event.objectId, event.player);
    return Number.isInteger(definition?.id) ? definition.id : event.objectId;
  }

  function handleChestSearch(event) {
    const { player, location } = event;
    const chestId = placedObjectId(event);
    if (
      chestId !== WOOD_CHEST_OBJECT_ID &&
      chestId !== KEY_CHEST_OBJECT_ID &&
      chestId !== SEARCH_CHEST_OBJECT_ID
    ) {
      return false;
    }
    const key = `${location.x},${location.y}`;
    const bit = CHEST_BITS[key];
    if (bit === undefined) return false;
    if (quest.getStage(player) === STAGE_NOT_STARTED) {
      player.sendMessage("The chest is empty.");
      return true;
    }
    if (hasBit(player, bit)) {
      // Golden storeroom chest: QH says the crystal chime can be replaced here after loss.
      if (key === "2789,4258" &&
          !ownsAnywhere(player, CRYSTAL_CHIME_SEED_ITEM_ID) &&
          !ownsAnywhere(player, CRYSTAL_CHIME_ITEM_ID)) {
        if (player.getInventory().getFreeSlots() < 1) {
          player.sendMessage("You need more inventory space.");
          return true;
        }
        player.getInventory().adds(CRYSTAL_CHIME_SEED_ITEM_ID, 1);
        player.sendMessage("You search the chest and find some old elven artefacts.");
        return true;
      }
      player.sendMessage("The chest is empty.");
      return true;
    }
    if (!chestRequirementMet(player, key)) {
      player.sendMessage("The monoliths block the way to the chest.");
      return true;
    }
    const loot = CHEST_LOOT.get(key);
    if (player.getInventory().getFreeSlots() < loot.length) {
      player.sendMessage("You need more inventory space.");
      return true;
    }
    for (const itemId of loot) player.getInventory().adds(itemId, 1);
    setBit(player, bit);
    player.sendMessage("You search the chest and find some old elven artefacts.");
    return true;
  }

  const CHEST_LOOT = new Map([
    ["2791,4249", [RED_CIRCLE_ITEM_ID, RED_TRIANGLE_ITEM_ID, RED_SQUARE_ITEM_ID]],
    ["2788,4262", [GREEN_SQUARE_ITEM_ID, ORANGE_SQUARE_ITEM_ID, YELLOW_TRIANGLE_ITEM_ID]],
    ["2785,4261", [CHEST_KEY_ITEM_ID, YEWNOCKS_NOTES_ITEM_ID]],
    ["2789,4258", [STRONGROOM_KEY_ITEM_ID, CRYSTAL_CHIME_SEED_ITEM_ID]],
    [
      "2793,4253",
      [ItemIdentifiers.BLUE_CIRCLE, ItemIdentifiers.BLUE_TRIANGLE, ItemIdentifiers.BLUE_SQUARE],
    ],
  ]);

  function strongroomGateObjects() {
    RegionManager.loadMapFiles(GATE_TILE.getX(), GATE_TILE.getY());
    const gateHash = MapObjects.getHash(GATE_TILE.getX(), GATE_TILE.getY(), GATE_TILE.getZ());
    return [...(MapObjects.mapObjects.get(gateHash) ?? [])].filter(
      (object) =>
        object.getId() === STRONGROOM_GATE_OBJECT_ID ||
        object.getId() === STRONGROOM_GATE_OPEN_OBJECT_ID
    );
  }

  /** Removes the shared base-map gate and its wall clipping. Safe to call repeatedly. */
  function removeStrongroomGate() {
    const objects = strongroomGateObjects();
    if (gateUnlocked && objects.length === 0) return;
    // The gate is a base-map loc, so it is not in ObjectManager.objectsAt (which only holds
    // runtime objects). Pull it out of MapObjects and deregister it: that removes its wall
    // clipping, sends the DESPAWN removal to nearby scenes, and records it in
    // World.getRemovedObjects so ObjectManager.onRegionChange re-sends the removal on scene
    // rebuilds (the same pattern DesertTreasureI uses for its ice cave).
    for (const object of objects) ObjectManager.deregister(object, true);
    MapObjects.clear(GATE_TILE, -1);
    gateUnlocked = true;
  }

  function unlockGate(player) {
    if (!held(player, STRONGROOM_KEY_ITEM_ID)) {
      player.sendMessage("The gate is locked; you need a key.");
      return;
    }
    if (monolithProgress(player) < MONOLITH_STEPS.length) {
      player.sendMessage("The way to the gate is still blocked by a monolith.");
      return;
    }
    const alreadyEarned = hasBit(player, BIT_GATE);
    if (!alreadyEarned) {
      setBit(player, BIT_GATE);
      sendVarbit(player, VARBIT_GOLRIE_RETURN, 1);
      if (quest.getStage(player) < STAGE_DIARY_READ) quest.setStage(player, STAGE_DIARY_READ);
    }
    // Reconcile the shared world to the earned state: the live map may have been rebuilt
    // since the key was used (login/region reload), which put the solid gate back.
    removeStrongroomGate();
    player.sendMessage(alreadyEarned ? "The strongroom gate is already open." : "You unlock the strongroom gate.");
  }

  function handleGateToggle(event) {
    if (event.objectId !== STRONGROOM_GATE_OBJECT_ID) return;
    const { player } = event;
    if (!held(player, STRONGROOM_KEY_ITEM_ID)) return;
    unlockGate(player);
    event.handled = true;
  }

  function advanceToMachineReady(player) {
    if (quest.getStage(player) >= STAGE_CHIME_MADE) return;
    if (hasBit(player, BIT_CHIME) && DIARY_BITS.every((bit) => hasBit(player, bit))) {
      quest.setStage(player, STAGE_CHIME_MADE);
    }
  }

  function handleLecternRead(event) {
    if (event.objectId !== LECTERN_OBJECT_ID) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_MONOLITH_DONE) {
      player.sendMessage("The lectern is blocked by the monoliths for now.");
      return true;
    }
    if (DIARY_BITS.every((bit) => hasBit(player, bit))) {
      player.sendMessage("You have already read Bolrie's diary.");
      return true;
    }
    // Quest Helper clicks Chapter 1, 2 then 3 on interface 854 (widgets 5/9/13).
    player.getPacketSender().sendInterface(LECTERN_INTERFACE);
    return true;
  }

  function handleLecternChapter(event) {
    const { player, buttonId } = event;
    if ((buttonId >> 16) !== LECTERN_INTERFACE) return;
    const chapter = LECTERN_CHAPTER_BUTTONS.indexOf(buttonId & 0xffff);
    if (chapter === -1) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_MONOLITH_DONE) {
      player.sendMessage("The lectern is blocked by the monoliths for now.");
      return;
    }
    if (chapter > 0 && !hasBit(player, DIARY_BITS[chapter - 1])) {
      player.sendMessage("Read the earlier chapters first.");
      return;
    }
    if (hasBit(player, DIARY_BITS[chapter])) {
      player.sendMessage("You have already read that chapter.");
      return;
    }
    setBit(player, DIARY_BITS[chapter]);
    sendVarbit(player, VARBIT_DIARY_1 + chapter, 1);
    if (quest.getStage(player) < STAGE_DIARY_READ) quest.setStage(player, STAGE_DIARY_READ);
    playCamera(player, DIARY_CAMERA_TRACKS[chapter], 8);
    playVariant(player, KING_BOLRIE_NPC_ID, DIARY_VARIANTS[chapter]);
    if (chapter === DIARY_BITS.length - 1) {
      advanceToMachineReady(player);
      player.getPacketSender().sendInterfaceRemoval();
    }
  }

  function handleTunnelEnter(event) {
    const { player, objectId } = event;
    if (objectId === STOREROOM_TUNNEL_ENTRY_OBJECT_ID) {
      if (quest.getStage(player) >= STAGE_STOREROOM && quest.getStage(player) < STAGE_MONOLITH_START) {
        quest.setStage(player, STAGE_MONOLITH_START);
      }
      event.player.moveTo(STOREROOM_LANDING);
      return true;
    }
    if (objectId === STOREROOM_TUNNEL_EXIT_OBJECT_ID) {
      event.player.moveTo(TUNNEL_BACK_LANDING);
      return true;
    }
    return false;
  }

  function handleSewerEnter(event) {
    if (event.objectId !== SEWER_ENTRANCE_OBJECT_ID) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_TREE_THANKED) {
      player.sendMessage("It wouldn't be wise to go wandering into strange tunnels without some idea of what's inside.");
      return true;
    }
    if (quest.getStage(player) < STAGE_SEWER) quest.setStage(player, STAGE_SEWER);
    player.moveTo(SEWER_EXIT_TILE);
    return true;
  }

  // ==========================================================================
  // Yewnock's machine
  // ==========================================================================

  function newMachinePuzzle() {
    const values = PUZZLE_VALUES.slice();
    const first = values.splice(Math.floor(Math.random() * values.length), 1)[0];
    const second = values.splice(Math.floor(Math.random() * values.length), 1)[0];
    const third = values.splice(Math.floor(Math.random() * values.length), 1)[0];
    return { target1: first, target2: second + third, slots: [null, null, null], active: 0 };
  }

  function machinePuzzle(player) {
    let puzzle = machineProgress.get(player);
    if (!puzzle) {
      puzzle = newMachinePuzzle();
      machineProgress.set(player, puzzle);
    }
    return puzzle;
  }

  function renderMachine(player) {
    const puzzle = machineProgress.get(player);
    if (!puzzle) return;
    const sender = player.getPacketSender();
    MACHINE_MODEL_SLOTS.forEach((child, index) => {
      const itemId = puzzle.slots[index];
      if (itemId === null || itemId === undefined) sender.clearItemOnInterface((MACHINE_INTERFACE << 16) | child);
      else sender.sendItemOnInterfaces((MACHINE_INTERFACE << 16) | child, itemId, 1);
    });
  }

  function openMachine(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CHIME_MADE) {
      player.sendMessage("The machine sits dormant.");
      return;
    }
    if (stage >= STAGE_MACHINE_ACTIVATED) {
      player.sendMessage("The machine is already working.");
      return;
    }
    const puzzle = machinePuzzle(player);
    renderMachine(player);
    player.getPacketSender().sendInterface(MACHINE_INTERFACE);
    player.sendMessage(
      `The machine shows ${puzzle.target1} for the first slot and ${puzzle.target2} for the other two.`
    );
  }

  function returnMachineDiscs(player) {
    const puzzle = machineProgress.get(player);
    if (!puzzle) return true;
    for (let index = 0; index < puzzle.slots.length; index++) {
      const itemId = puzzle.slots[index];
      if (itemId === null || itemId === undefined) continue;
      if (player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You need more inventory space to take the discs back.");
        return false;
      }
      player.getInventory().adds(itemId, 1);
      puzzle.slots[index] = null;
    }
    renderMachine(player);
    return true;
  }

  function resetMachine(player) {
    if (!machineProgress.has(player)) return;
    returnMachineDiscs(player);
  }

  function insertDisc(player, itemId, slot = machinePuzzle(player).active) {
    const stage = quest.getStage(player);
    if (stage < STAGE_CHIME_MADE) {
      player.sendMessage("The machine doesn't seem to be ready yet.");
      return;
    }
    if (stage >= STAGE_MACHINE_ACTIVATED) {
      player.sendMessage("The machine is already working.");
      return;
    }
    if (discValue(itemId) === 0) return;
    const puzzle = machinePuzzle(player);
    if (slot < 0 || slot >= MACHINE_SLOTS) slot = puzzle.slots.indexOf(null);
    if (slot === -1) {
      player.sendMessage("All three slots are full. Reset the machine or submit it.");
      return;
    }
    if (puzzle.slots[slot] !== null) {
      player.sendMessage("That slot already holds a disc.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    puzzle.slots[slot] = itemId;
    puzzle.active = puzzle.slots.indexOf(null);
    if (puzzle.active === -1) puzzle.active = 2;
    renderMachine(player);
    player.sendMessage("You slot the disc into the machine.");
  }

  function submitMachine(player) {
    const puzzle = machineProgress.get(player);
    if (!puzzle) return;
    if (puzzle.slots.some((itemId) => itemId === null || itemId === undefined)) {
      player.sendMessage("The machine still has empty slots.");
      return;
    }
    const values = puzzle.slots.map(discValue);
    if (values[0] !== puzzle.target1 || values[1] + values[2] !== puzzle.target2) {
      player.sendMessage("The discs clunk back out of the machine.");
      return;
    }
    machineProgress.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    activateMachine(player);
  }

  function handleMachineInterface(event) {
    const { player, buttonId } = event;
    if ((buttonId >> 16) !== MACHINE_INTERFACE) return;
    const child = buttonId & 0xffff;
    const insertIndex = MACHINE_INSERT_BUTTONS.indexOf(child);
    if (insertIndex !== -1) {
      event.handled = true;
      machinePuzzle(player).active = insertIndex;
      player.sendMessage("Select a disc to insert.");
      return;
    }
    if (child === MACHINE_RESET_BUTTON) {
      event.handled = true;
      resetMachine(player);
      return;
    }
    if (child === MACHINE_SUBMIT_BUTTON) {
      event.handled = true;
      submitMachine(player);
      return;
    }
    if (child === MACHINE_CLOSE_BUTTON) {
      event.handled = true;
      resetMachine(player);
      player.getPacketSender().sendInterfaceRemoval();
    }
  }

  function handleMachineClosed({ player, interfaceId }) {
    if (interfaceId !== MACHINE_INTERFACE) return;
    if (machineProgress.has(player)) returnMachineDiscs(player);
  }

  function handleMachineOperate(event) {
    if (event.objectId !== MACHINE_OBJECT_ID) return false;
    openMachine(event.player);
    return true;
  }

  function exchangeDisc(player, itemId) {
    const parts = splitDisc(discValue(itemId));
    if (!parts) {
      player.sendMessage("The exchanger can't break that disc down any further.");
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need a free inventory slot for the exchange.");
      return;
    }
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(parts[0], 1);
    player.getInventory().adds(parts[1], 1);
    player.sendMessage("The exchanger hums and returns two smaller discs.");
  }

  function handleExchangerUse(event) {
    if (event.objectId !== EXCHANGER_OBJECT_ID) return false;
    event.player.sendMessage("Use a crystal disc on the exchanger.");
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId === SINGING_BOWL_PARENT_OBJECT_ID) {
      if (itemId !== CRYSTAL_CHIME_SEED_ITEM_ID) return;
      event.handled = true;
      makeChime(player);
      return;
    }
    if (objectId === DYING_SPIRIT_TREE_OBJECT_ID) {
      if (itemId !== CRYSTAL_CHIME_ITEM_ID) return;
      useChimeOnTree(player);
      return;
    }
    if (objectId === STRONGROOM_GATE_OBJECT_ID) {
      if (itemId !== STRONGROOM_KEY_ITEM_ID) return;
      unlockGate(player);
      return;
    }
    if (objectId === MACHINE_OBJECT_ID) {
      if (discValue(itemId) === 0) return;
      insertDisc(player, itemId);
      return;
    }
    if (objectId === EXCHANGER_OBJECT_ID && discValue(itemId) > 0) {
      exchangeDisc(player, itemId);
    }
  }

  // ==========================================================================
  // Dumpling and the monoliths
  // ==========================================================================

  function ensureCuteCreature(player) {
    if (cuteByPlayer.has(player) || evilByPlayer.has(player)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_MACHINE_ACTIVATED) return;
    const npc = api.spawnNpc({
      id: CUTE_CREATURE_NPC_ID,
      x: CUTE_CREATURE_TILE.x,
      y: CUTE_CREATURE_TILE.y,
      z: CUTE_CREATURE_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) cuteByPlayer.set(player, npc);
  }

  function removeCuteCreature(player) {
    const npc = cuteByPlayer.get(player);
    if (!npc) return;
    cuteByPlayer.delete(player);
    api.removeNpc(npc);
  }

  function revealCreature(player) {
    removeCuteCreature(player);
    if (evilByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: EVIL_CREATURE_NPC_ID,
      x: CUTE_CREATURE_TILE.x,
      y: CUTE_CREATURE_TILE.y,
      z: CUTE_CREATURE_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) evilByPlayer.set(player, npc);
  }

  function activateMachine(player) {
    if (quest.getStage(player) < STAGE_CHIME_MADE || hasBit(player, BIT_MACHINE)) return;
    playCamera(player, DUMPLING_CAMERA_TRACKS, 12);
    quest.setStage(player, STAGE_MACHINE_ACTIVATED);
    setBit(player, BIT_MACHINE);
    sendVarbit(player, VARBIT_WATCHER, 1);
    revealCreature(player);
    player.sendMessage("The machine shudders into life and Dumpling is revealed for what it is!");
  }

  function savedMonolithPositions(player) {
    const raw = player.getAttribute(MONOLITH_ATTRIBUTE);
    if (typeof raw === "string" && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === MONOLITH_INITIAL.length) {
          return MONOLITH_INITIAL.map((spot, index) => {
            const point = parsed[index];
            return Array.isArray(point) && Number.isInteger(point[0]) && Number.isInteger(point[1])
              ? [point[0], point[1]]
              : [spot.x, spot.y];
          });
        }
      } catch (error) {
        // Fall back to the captured anchors.
      }
    }
    return MONOLITH_INITIAL.map((spot) => [spot.x, spot.y]);
  }

  function clearLegacyMonolithBits(player) {
    const legacyMask = 0b1111 << 15;
    player.setAttribute(BITS_ATTRIBUTE, bits(player) & ~legacyMask);
  }

  function persistMonoliths(player, state) {
    player.setAttribute(MONOLITH_ATTRIBUTE, JSON.stringify(state.positions));
  }

  function monolithState(player) {
    let state = monolithsByPlayer.get(player);
    if (!state) {
      state = { positions: savedMonolithPositions(player), entries: [] };
      monolithsByPlayer.set(player, state);
    }
    return state;
  }

  function monolithFootprint(definition, x, y) {
    return { minX: x, maxX: x + definition.size - 1, minY: y, maxY: y + definition.size - 1 };
  }

  function footprintContains(footprint, x, y) {
    return x >= footprint.minX && x <= footprint.maxX && y >= footprint.minY && y <= footprint.maxY;
  }

  function footprintsOverlap(left, right) {
    return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
  }

  function monolithTile(state, x, y) {
    return state.positions.some((point, index) =>
      footprintContains(monolithFootprint(MONOLITH_INITIAL[index], point[0], point[1]), x, y)
    );
  }

  function monolithDestinationBlocked(state, index, x, y, player) {
    const definition = MONOLITH_INITIAL[index];
    const destination = monolithFootprint(definition, x, y);
    if (
      destination.minX < STOREROOM_ZONE.minX ||
      destination.maxX > STOREROOM_ZONE.maxX ||
      destination.minY < STOREROOM_ZONE.minY ||
      destination.maxY > STOREROOM_ZONE.maxY
    ) {
      return true;
    }
    for (let tileX = destination.minX; tileX <= destination.maxX; tileX++) {
      for (let tileY = destination.minY; tileY <= destination.maxY; tileY++) {
        if (RegionManager.blocked(new Location(tileX, tileY, 0), null)) return true;
      }
    }
    for (let other = 0; other < MONOLITH_INITIAL.length; other++) {
      if (other === index) continue;
      const point = state.positions[other];
      const footprint = monolithFootprint(MONOLITH_INITIAL[other], point[0], point[1]);
      if (footprintsOverlap(destination, footprint)) return true;
    }
    const location = player.getLocation();
    return footprintContains(destination, location.getX(), location.getY());
  }

  function monolithPushDirection(player, index) {
    const state = monolithState(player);
    const point = state.positions[index];
    const definition = MONOLITH_INITIAL[index];
    const footprint = monolithFootprint(definition, point[0], point[1]);
    const location = player.getLocation();
    const px = location.getX();
    const py = location.getY();
    const west = px < footprint.minX ? footprint.minX - px : Infinity;
    const east = px > footprint.maxX ? px - footprint.maxX : Infinity;
    const north = py < footprint.minY ? footprint.minY - py : Infinity;
    const south = py > footprint.maxY ? py - footprint.maxY : Infinity;
    const nearest = Math.min(west, east, north, south);
    if (nearest !== 1) return null;
    // A diagonal click is pushed horizontally first, matching the captured north-west push.
    if (nearest === west) return { dx: 1, dy: 0 };
    if (nearest === east) return { dx: -1, dy: 0 };
    if (nearest === north) return { dx: 0, dy: 1 };
    return { dx: 0, dy: -1 };
  }

  function monolithProgress(player) {
    const state = monolithsByPlayer.get(player);
    const positions = state?.positions ?? savedMonolithPositions(player);
    // A repeated monolith (north-west east then west) can be past an earlier step, so
    // record the furthest step position each monolith currently matches.
    const reached = new Map();
    MONOLITH_STEPS.forEach((step, stepIndex) => {
      const current = positions[step.index];
      if (current && current[0] === step.x && current[1] === step.y) {
        reached.set(step.index, Math.max(reached.get(step.index) ?? -1, stepIndex));
      }
    });
    let progress = 0;
    for (let stepIndex = 0; stepIndex < MONOLITH_STEPS.length; stepIndex++) {
      if ((reached.get(MONOLITH_STEPS[stepIndex].index) ?? -1) < stepIndex) break;
      progress = stepIndex + 1;
    }
    return progress;
  }

  function ensureMonoliths(player) {
    clearLegacyMonolithBits(player);
    const state = monolithState(player);
    if (state.entries.length > 0) return;
    state.entries = MONOLITH_INITIAL.flatMap((spot, index) => {
      const [x, y] = state.positions[index];
      const npc = api.spawnNpc({
        id: spot.id,
        x,
        y,
        z: 0,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (!npc) return [];
      npc.setAttribute?.("the-path-of-glouphrie:monolith", index);
      return [{ index, npc }];
    });
  }

  function pushMonolith(player, entry) {
    const state = monolithState(player);
    const [x, y] = state.positions[entry.index];
    const direction = monolithPushDirection(player, entry.index);
    if (!direction) {
      player.sendMessage("Stand beside the monolith to push it.");
      return;
    }
    const nextX = x + direction.dx;
    const nextY = y + direction.dy;
    if (monolithDestinationBlocked(state, entry.index, nextX, nextY, player)) {
      player.sendMessage("The monolith won't budge.");
      return;
    }
    entry.npc.exactMove(new Location(nextX, nextY, 0));
    state.positions[entry.index] = [nextX, nextY];
    persistMonoliths(player, state);
    if (monolithProgress(player) >= MONOLITH_STEPS.length) {
      if (quest.getStage(player) < STAGE_MONOLITH_DONE) quest.setStage(player, STAGE_MONOLITH_DONE);
      player.sendMessage("The last monolith grinds aside, opening the way through the storeroom.");
    } else {
      if (quest.getStage(player) < STAGE_MONOLITH_PROGRESS) quest.setStage(player, STAGE_MONOLITH_PROGRESS);
      player.sendMessage("You push the monolith out of the way.");
    }
  }

  function resetMonoliths(player, state) {
    api.sendMultiChatboxPrompt(
      player,
      "Reset all the monoliths?",
      "Yes.",
      () => {
        state.positions = MONOLITH_INITIAL.map((spot) => [spot.x, spot.y]);
        for (const entry of state.entries) {
          const [x, y] = state.positions[entry.index];
          entry.npc.exactMove(new Location(x, y, 0));
        }
        persistMonoliths(player, state);
        clearLegacyMonolithBits(player);
        const location = player.getLocation();
        if (monolithTile(state, location.getX(), location.getY())) player.moveTo(STOREROOM_LANDING);
        player.sendMessage("The monoliths grind back into place.");
      },
      "No.",
      () => {}
    );
  }

  function handleMonolithInteraction(event) {
    const { player, npcId, clickType } = event;
    if (npcId !== BIG_MONOLITH_NPC_ID && npcId !== SMALL_MONOLITH_NPC_ID) return;
    const state = monolithState(player);
    const entry = state.entries.find((candidate) => candidate.npc === event.npc);
    if (!entry) return;
    const option = event.definition?.getActions?.()?.[clickType - 1];
    if (option === "Push") {
      event.handled = true;
      pushMonolith(player, entry);
    } else if (option === "Reset") {
      event.handled = true;
      resetMonoliths(player, state);
    }
  }

  function tileOf(location) {
    return location.getX
      ? location
      : new Location(location.x, location.y, location.z ?? 0);
  }

  function inSewer(location) {
    const tile = tileOf(location);
    return (
      tile.getX() >= SEWER_ZONE.minX &&
      tile.getX() <= SEWER_ZONE.maxX &&
      tile.getY() >= SEWER_ZONE.minY &&
      tile.getY() <= SEWER_ZONE.maxY
    );
  }

  /**
   * The captured sewer landings are the ladder's own tile on the other plane. A normal
   * walk queued by the click can apply after the moveTo and leave the player one tile
   * east (1530,4236,0), which is an isolated pocket. Cancel the walk and hold movement
   * across the landing cycle, then release it, before the scripted plane change.
   */
  function clearSewerWalkAndClimb(player, destination) {
    const movement = player.getMovementQueue();
    movement.setBlockMovement(true);
    movement.reset();
    movement.walkToReset?.();
    const start = player.getLocation().clone();
    const privateArea = player.getPrivateArea?.() ?? null;
    TaskManager.submit(
      new (class extends Task {
        constructor() {
          super(1, player, !(movement.didMovePreviousCycle?.() ?? false));
        }
        execute() {
          if (player.getLocation().equals(start) && (player.getHitpoints?.() ?? 1) > 0 && (player.getPrivateArea?.() ?? null) === privateArea) {
            player.moveTo(destination);
          }
          this.stop();
        }
        stop() {
          movement.setBlockMovement(false);
          super.stop();
        }
      })()
    );
  }

  function sewerLadderDestination(objectId, location) {
    if (objectId !== SEWER_LADDER_UP_OBJECT_ID && objectId !== SEWER_LADDER_DOWN_OBJECT_ID) return null;
    if (!inSewer(location)) return null;
    const tile = tileOf(location);
    const delta = objectId === SEWER_LADDER_UP_OBJECT_ID ? 1 : -1;
    return new Location(tile.getX(), tile.getY(), tile.getZ() + delta);
  }

  function climbSewerLadder(event) {
    const { player } = event;
    const destination = sewerLadderDestination(event.objectId, event.location);
    if (!destination) return false;
    clearSewerWalkAndClimb(player, destination);
    return true;
  }

  function descendSewerLadder(event) {
    const { player } = event;
    const destination = sewerLadderDestination(event.objectId, event.location);
    if (!destination) return false;
    clearSewerWalkAndClimb(player, destination);
    return true;
  }

  function claimSewerLadder(event) {
    const { player, object, objectId } = event;
    const location = object?.getLocation?.() ?? event.location;
    const destination = sewerLadderDestination(objectId, location);
    if (!destination) return;
    clearSewerWalkAndClimb(player, destination);
    event.handled = true;
  }

  function handleBossDoorZone({ player }) {
    if (quest.getStage(player) < STAGE_SEWER) return;
    if (player.getLocation().getZ() !== 1) return;
    player.moveTo(BOSS_ROOM_TILE);
    if (quest.getStage(player) < STAGE_BIRDS_DEAD) ensureBirds(player);
  }

  // ==========================================================================
  // Warped depths
  // ==========================================================================

  function ensureLongramble(player) {
    if (longrambleByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: LONGRAMBLE_NPC_ID,
      x: LONGRAMBLE_TILE.x,
      y: LONGRAMBLE_TILE.y,
      z: LONGRAMBLE_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) longrambleByPlayer.set(player, npc);
  }

  /** The player's own still-alive bird for `index`, tagged on spawn (adopt after a relog). */
  function findOwnedBird(player, index) {
    const world = api.getWorld?.();
    if (!world?.getNpcs) return null;
    for (const npc of world.getNpcs()) {
      if (npc?.getOwner?.() !== player) continue;
      if (!WARPED_TERRORBIRD_NPC_IDS.includes(npc.getId?.())) continue;
      if (Number(npc.getAttribute?.(BIRD_ATTRIBUTE)) === index) return npc;
    }
    return null;
  }

  function ensureBirds(player) {
    let entries = birdsByPlayer.get(player);
    if (!entries) {
      entries = [];
      birdsByPlayer.set(player, entries);
    }
    TERRORBIRD_TILES.forEach((tile, index) => {
      if (hasBit(player, BIRD_BITS[index])) return;
      if (entries.some((entry) => entry.index === index)) return;
      const adopted = findOwnedBird(player, index);
      if (adopted) {
        entries.push({ index, npc: adopted });
        return;
      }
      const npc = api.spawnNpc({
        id: WARPED_TERRORBIRD_NPC_IDS[index],
        x: tile.x,
        y: tile.y,
        z: tile.z,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) {
        npc.setAttribute?.(BIRD_ATTRIBUTE, index);
        entries.push({ index, npc });
      }
    });
  }

  function birdKillCount(player) {
    return BIRD_BITS.reduce((count, bit) => count + (hasBit(player, bit) ? 1 : 0), 0);
  }

  function handleHeavyDoorPeek(event) {
    const { player, objectId } = event;
    if (objectId !== HEAVY_DOOR_OBJECT_ID) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_BIRDS_DEAD) {
      player.sendMessage("You can hear muffled squawking beyond the heavy door.");
      return true;
    }
    if (!quest.isComplete(player)) {
      playFinalCutscene(player);
      playVariant(player, HAZELMERE_NPC_ID, FINAL_VARIANT);
    }
    return true;
  }

  function denyBirdAttack(event) {
    const { attacker, target } = event;
    if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return;
    if (!WARPED_TERRORBIRD_NPC_IDS.includes(target.getId?.())) return;
    if (target.getOwner?.() !== attacker) return;
    if (held(attacker, CRYSTAL_CHIME_ITEM_ID)) return;
    event.allow = false;
    attacker.sendMessage("You need the crystal chime to harm the warped terrorbird.");
  }

  class TerrorbirdArea extends Area {
    constructor() {
      super([TERRORBIRD_AREA_BOUNDARY]);
    }
    canAttack(attacker, target) {
      const event = { attacker, target, allow: null };
      denyBirdAttack(event);
      return event.allow;
    }
  }

  // The monoliths are owner NPCs, so their blocking must stay owner-local too. Players in
  // the storeroom are returned to their last tile outside a monolith footprint.
  class StoreroomMonolithArea extends Area {
    constructor() {
      super([
        new Boundary(
          STOREROOM_ZONE.minX,
          STOREROOM_ZONE.maxX,
          STOREROOM_ZONE.minY,
          STOREROOM_ZONE.maxY,
          0
        ),
      ]);
    }
    postEnter(mobile) {
      if (mobile?.isPlayer?.()) monolithSafeTiles.set(mobile, mobile.getLocation().clone());
    }
    postLeave(mobile) {
      monolithSafeTiles.delete(mobile);
    }
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const state = monolithsByPlayer.get(mobile);
      if (!state) return;
      const location = mobile.getLocation();
      if (monolithTile(state, location.getX(), location.getY())) {
        const safe = monolithSafeTiles.get(mobile);
        if (safe && !monolithTile(state, safe.getX(), safe.getY())) {
          mobile.getMovementQueue?.()?.reset?.();
          mobile.moveTo(safe);
        }
      } else {
        monolithSafeTiles.set(mobile, location.clone());
      }
    }
  }

  function handleNpcDeath(event) {
    const { npc, killer } = event;
    let owner = killer?.isPlayer?.() ? killer : null;
    if (!owner && npc?.getOwner?.()?.isPlayer?.()) owner = npc.getOwner();
    if (!owner) return;
    const evil = evilByPlayer.get(owner);
    if (evil === npc || (npc?.getOwner?.() === owner && npc?.getId?.() === EVIL_CREATURE_NPC_ID)) {
      evilByPlayer.delete(owner);
      if (!hasBit(owner, BIT_CREATURE_KILLED)) {
        setBit(owner, BIT_CREATURE_KILLED);
        if (quest.getStage(owner) === STAGE_MACHINE_ACTIVATED) quest.setStage(owner, STAGE_CREATURE_KILLED);
      }
      return;
    }
    if (!WARPED_TERRORBIRD_NPC_IDS.includes(npc?.getId?.())) return;
    // The death payload can be a different instance of the NPC (clones/new indices), so
    // match on the tag set at spawn (and identity) instead of the object reference alone.
    const entries = birdsByPlayer.get(owner) ?? [];
    const tag = Number(npc.getAttribute?.(BIRD_ATTRIBUTE));
    let position = entries.findIndex((entry) => entry.npc === npc);
    if (position === -1 && Number.isInteger(tag)) {
      position = entries.findIndex((entry) => entry.index === tag);
    }
    if (position !== -1) entries.splice(position, 1);
    let index = Number.isInteger(tag) && tag >= 0 && tag < BIRD_BITS.length ? tag : -1;
    if (index === -1) index = BIRD_BITS.findIndex((bit) => !hasBit(owner, bit));
    if (index === -1 || hasBit(owner, BIRD_BITS[index])) return;
    setBit(owner, BIRD_BITS[index]);
    const count = birdKillCount(owner);
    if (count >= TERRORBIRD_TILES.length) {
      const stage = quest.getStage(owner);
      if (stage >= STAGE_TREE_CHIMED && stage < STAGE_COMPLETE) quest.setStage(owner, STAGE_BIRDS_DEAD);
      ensureHeavyDoor();
      owner.sendMessage("The last terrorbird falls. The heavy door to the east is unguarded.");
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  function despawnQuestNpcs(player) {
    removeCuteCreature(player);
    const evil = evilByPlayer.get(player);
    if (evil) {
      evilByPlayer.delete(player);
      api.removeNpc(evil);
    }
    const monoliths = monolithsByPlayer.get(player);
    if (monoliths) {
      monolithsByPlayer.delete(player);
      for (const entry of monoliths.entries) api.removeNpc(entry.npc);
    }
    const birds = birdsByPlayer.get(player);
    if (birds) {
      birdsByPlayer.delete(player);
      for (const entry of birds) api.removeNpc(entry.npc);
    }
    const longramble = longrambleByPlayer.get(player);
    if (longramble) {
      longrambleByPlayer.delete(player);
      api.removeNpc(longramble);
    }
  }

  function handleVillageZone({ player }) {
    if (quest.getStage(player) < STAGE_MACHINE_ACTIVATED) ensureCuteCreature(player);
  }

  function handleLongrambleZone({ player }) {
    if (quest.getStage(player) >= STAGE_SENT_FOR_LONGRAMBLE) ensureLongramble(player);
  }

  function handleStoreroomZone({ player }) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_GOLRIE_TOLD && stage < STAGE_MACHINE_ACTIVATED && stage >= STAGE_STOREROOM) ensureMonoliths(player);
  }

  function handleWarpedDepthsZone({ player }) {
    const stage = quest.getStage(player);
    if (stage === STAGE_SEWER) quest.setStage(player, STAGE_WARPED_DEPTHS);
    if (stage < STAGE_BIRDS_DEAD) ensureBirds(player);
    if (stage >= STAGE_BIRDS_DEAD) ensureHeavyDoor();
  }

  /** Old 1..12 stages -> captured even stages; idempotent by version. */
  function migrateSave(player) {
    if ((Number(player.getAttribute(MACHINE_MIGRATION_ATTRIBUTE)) || 0) >= MACHINE_MIGRATION_VERSION) return;
    const old = quest.getStage(player);
    let next = old;
    if (old === 1) next = STAGE_STARTED;
    else if (old === 2) next = STAGE_STOREROOM;
    else if (old === 3) next = STAGE_CHIME_MADE;
    else if (old === 4) next = hasBit(player, BIT_CHIME) ? STAGE_CHIME_MADE : STAGE_DIARY_READ;
    else if (old === 5) next = STAGE_MACHINE_ACTIVATED;
    else if (old === 6) next = STAGE_CREATURE_KILLED;
    else if (old === 7) next = STAGE_SENT_FOR_LONGRAMBLE;
    else if (old === 8) next = STAGE_HAS_COORDINATES;
    else if (old === 9) next = STAGE_LONGRAMBLE_MET;
    else if (old === 10) next = STAGE_TREE_CHIMED;
    else if (old === 11) next = STAGE_BIRDS_DEAD;
    else if (old === 12) next = STAGE_COMPLETE;
    if (next !== old) quest.setStage(player, next);
    player.setAttribute(MACHINE_MIGRATION_ATTRIBUTE, MACHINE_MIGRATION_VERSION);
  }

  function handleLogin({ player }) {
    migrateSave(player);
    const stage = quest.getStage(player);
    if (hasBit(player, BIT_GATE)) removeStrongroomGate();
    if (stage >= STAGE_TREE_CHIMED) treeHealed = true;
    ensureQuestObjects();
    refreshQuestList(player);
    syncVarbits(player);
    if (stage >= STAGE_STARTED && stage < STAGE_MACHINE_ACTIVATED) ensureCuteCreature(player);
    if (stage >= STAGE_MACHINE_ACTIVATED && stage < STAGE_COMPLETE && !hasBit(player, BIT_CREATURE_KILLED)) {
      revealCreature(player);
    }
    if (stage >= STAGE_GOLRIE_TOLD && stage < STAGE_MACHINE_ACTIVATED && stage >= STAGE_STOREROOM) ensureMonoliths(player);
    if (stage >= STAGE_SENT_FOR_LONGRAMBLE) ensureLongramble(player);
    if (stage >= STAGE_TREE_CHIMED && stage < STAGE_BIRDS_DEAD) ensureBirds(player);
    if (stage >= STAGE_BIRDS_DEAD) ensureHeavyDoor();
  }

  function handleLogout({ player }) {
    finishCutscene(player);
    returnMachineDiscs(player);
    despawnQuestNpcs(player);
  }

  function handleRegionLoaded({ absX, absY }) {
    if (!gateUnlocked) return;
    if (GATE_TILE.getX() < absX || GATE_TILE.getX() >= absX + 64) return;
    if (GATE_TILE.getY() < absY || GATE_TILE.getY() >= absY + 64) return;
    removeStrongroomGate();
  }

  quest = registerQuest(api, {
    key: "the_path_of_glouphrie",
    name: "The Path of Glouphrie",
    varpId: VARP_POG,
    varbitId: VARBIT_POG_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [],
    scrollItemId: ItemIdentifiers.CRYSTAL_CHIME,
    otherRewards: [
      "Poison Waste Dungeon",
      "Access",
      "30,000 Strength XP Lamp",
      "20,000 Slayer XP Lamp",
      "5,000 Thieving XP Lamp",
      "5,000 Magic XP Lamp",
    ],
    buildJournal,
    onReward: grantLamps,
  });

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(LAMPS_ATTRIBUTE);
  api.persistAttribute(MONOLITH_ATTRIBUTE, null);
  api.persistAttribute(MACHINE_MIGRATION_ATTRIBUTE, 0);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Hazelmere", { "Talk-to": talkToHazelmere });
  api.onNpcInteraction(handleMonolithInteraction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("door:toggle", handleGateToggle);
  api.onObjectInteraction("Tunnel", { Enter: handleTunnelEnter });
  api.onObjectInteraction("Sewer entrance", { Enter: handleSewerEnter });
  api.onCustomEvent("ladders:climb", claimSewerLadder);
  api.onObjectInteraction("Ladder", {
    [SEWER_LADDER_CHILD]: climbSewerLadder,
    [SEWER_LADDER_TOP_CHILD]: descendSewerLadder,
  });
  api.onZoneEnter(BOSS_DOOR_ZONE, handleBossDoorZone);
  api.onObjectInteraction("Spirit Tree", { "Talk-to": handleTreeTalk });
  api.onObjectInteraction("Singing bowl", {
    Inspect: handleBowlInspect,
    "Sing-crystal": handleBowlSing,
  });
  api.onObjectInteraction("Chest", { Open: handleChestSearch, Search: handleChestSearch });
  api.onObjectInteraction("Lectern", { Read: handleLecternRead });
  api.onObjectInteraction("Yewnock's machine", { Operate: handleMachineOperate });
  api.onInterfaceActionButton([...MACHINE_INSERT_BUTTONS, MACHINE_RESET_BUTTON, MACHINE_SUBMIT_BUTTON, MACHINE_CLOSE_BUTTON].map((child) => (MACHINE_INTERFACE << 16) | child), handleMachineInterface);
  api.onInterfaceActionButton(LECTERN_CHAPTER_BUTTONS.map((child) => (LECTERN_INTERFACE << 16) | child), handleLecternChapter);
  api.onCustomEvent("interface:closed", handleMachineClosed);
  api.onObjectInteraction("Yewnock's exchanger", { Use: handleExchangerUse });
  api.onObjectInteraction("Heavy door", { Peek: handleHeavyDoorPeek, Open: handleHeavyDoorPeek });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemFirstAction(handleLampAction);
  api.onNpcDeath(handleNpcDeath);
  api.registerArea(new TerrorbirdArea());
  api.registerArea(new StoreroomMonolithArea());
  api.onZoneEnter(VILLAGE_ZONE, handleVillageZone);
  api.onZoneEnter(LONGRAMBLE_ZONE, handleLongrambleZone);
  api.onZoneEnter(STOREROOM_ZONE, handleStoreroomZone);
  api.onZoneEnter(WARPED_DEPTHS_ZONE, handleWarpedDepthsZone);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onRegionLoaded(handleRegionLoaded);
};
