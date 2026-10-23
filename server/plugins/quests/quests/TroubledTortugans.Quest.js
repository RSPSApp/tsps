/**
 * Troubled Tortugans (members).
 *
 * The words come from the "Troubled Tortugans" transcript page (npc-dialogues.json),
 * plus object-interaction lines the wiki has no transcript for. Floopa's Injured
 * Tortugan (14990) exists in npc-spawns.json only at Elder Raley's home, so the
 * Remote Island one is owner-spawned; the two fight NPCs (cave Gryphon 15009 and
 * the Little Pearl Shellbane gryphon 15010) are owner-spawned too.
 *
 * Stages: the stage lives in varbit 18321 "tt" (varp 4961 bits 0-5) and follows
 * the decoded capture 3456 exactly: 2 started, 4 bandages made, 6 bandages used,
 * 7 Floopa introduced, 8 she boards, 10 docks, 12 disembarked, 13 Elder Korel,
 * 14 sent to Raley, 16 Elder Raley met, 18 repairs given, 20 repairs done, 22
 * tracking, 24 trail found, 26 unblock the cave, 28 cave cleared/Enter available,
 * 30 fighting the cave Gryphon, 32 cave Gryphon dead, 34 Little Pearl briefing,
 * 36 reached the Little Pearl, 38 Shellbane dead, 40 Korel talked, 42 leaving the
 * Pearl, 44 complete. The cache object transforms corroborate the tracking values: the
 * Monument only offers Inspect at 22-28 (base loc 58445 -> 58446), the tracking
 * plants and rockslides at 24-28 (58449..58470), and the cave flips from Unblock
 * to Enter at 27 (58439 -> 58440/58441).
 *
 * Repairs use the sibling varbits of varp 4961: 18327-18332 (1 = Repair option
 * visible, 2 = repaired) and 18333 for the free shield. Tracking publishes
 * 18322-18326 as each trail step is found (capture 3456 sets 0 -> 1 in order
 * and clears them on completion). Their values are persisted in
 * "troubled-tortugans:*" attributes and re-sent on login and on
 * player:bootstrap-complete, because the runtime only re-sends the stage.
 *
 * Rewards (OSRS Wiki): 1 Quest point, 10,000 Sailing XP and 8,000 Slayer XP
 * (the quest DB row 7106 stores 100000/80000, i.e. the usual x10), plus access
 * to the Great Conch and the ability to fight gryphons.
 *
 * Gaps/approximations:
 * - Pandemonium completion is checked through the public quest:is-complete event;
 *   the six skill levels follow Quest Helper (Slayer/Construction/Sailing/Hunter
 *   unboosted, Woodcutting/Crafting boostable).
 * - The boat journey's at-sea Floopa variants and the boat-driven Little Pearl
 *   arrival/cutscene are played. The captured cam_moveto_cycles/
 *   cam_rotateto_coordinate legs use the closest supported arc/rotate movement,
 *   the only camera-attribution gap.
 * - The shield's cape-slot equip gate and weight are not enforced; the Shellbane
 *   specials, shield block animation/hit reduction and the cutscene are implemented.
 * - Object repair/shake/chop lines and the monument "tracks" line are not in the
 *   wiki transcript, so they are short functional messages; all dialogue text is
 *   the wiki page's.
 * - Jatoba trees are chopped through the Woodcutting plugin's axe helper (no
 *   Woodcutting XP is given for them; the tree has no shared-tree entry).
 * - Repair materials (Seaweed, 6 Tortugan scutes, 6 Sea shells) are re-registered
 *   owner-only for quest players because ground-items.json predates Sailing; the
 *   exact OSRS spawn network is not reproduced.
 */
module.exports = function registerTroubledTortugansQuest(api) {
  const {
    Animation,
    Equipment,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const woodcutting = require("../../skills/Woodcutting.plugin.js");

  // NPCs (cache ids; NpcIdentifiers comments). The island spawn uses the base
  // 14986, whose cache transform publishes 14990/14991/14992 by stage.
  const ISLAND_TORTUGAN_RAW_NPC_ID = 14986; // tt_floopa_injured, multinpc 14990
  const ELDER_KOREL_DOCKS_RAW_NPC_ID = 14995; // tt_korel_conch_docks, multinpc 14998
  const INJURED_TORTUGAN_NPC_IDS = new Set([
    ISLAND_TORTUGAN_RAW_NPC_ID,
    NpcIdentifiers.INJURED_TORTUGAN, // 14990, island and Floopa at Elder Raley's
    NpcIdentifiers.INJURED_TORTUGAN_2, // 14991
  ]);
  const FLOOPA_NPC_IDS = new Set([
    NpcIdentifiers.FLOOPA, // 14992
    NpcIdentifiers.FLOOPA_2, // 14993
    NpcIdentifiers.FLOOPA_3, // 14994
    NpcIdentifiers.FLOOPA_4, // 15012
  ]);
  const KOREL_NPC_IDS = new Set([
    ELDER_KOREL_DOCKS_RAW_NPC_ID, // 14995, docks base spawn
    NpcIdentifiers.ELDER_KOREL, // 14998, docks content id
    NpcIdentifiers.ELDER_KOREL_2, // 14999, Little Pearl
    NpcIdentifiers.ELDER_KOREL_3, // 15000
  ]);
  const RALEY_NPC_IDS = new Set([NpcIdentifiers.ELDER_RALEY]); // 15002
  const BLUNN_NPC_IDS = new Set([
    NpcIdentifiers.ELDER_BLUNN, // 14837
    NpcIdentifiers.ELDER_BLUNN_2, // 14838, trade variant
  ]);
  const KRILL_NPC_IDS = new Set([NpcIdentifiers.ELDER_KRILL, NpcIdentifiers.ELDER_KRILL_2]); // 14834/14835
  const STROM_NPC_IDS = new Set([NpcIdentifiers.ELDER_STROM, NpcIdentifiers.ELDER_STROM_2]); // 14831/14832
  const COCO_NPC_IDS = new Set([NpcIdentifiers.ELDER_COCO, NpcIdentifiers.ELDER_COCO_2]); // 14828/14829
  const MAG_NPC_IDS = new Set([NpcIdentifiers.MAG, NpcIdentifiers.MAG_2]); // 14840/14841
  const REGGLE_NPC_IDS = new Set([NpcIdentifiers.ELDER_REGGLE, NpcIdentifiers.ELDER_REGGLE_2]); // 14843/14844
  const GRYPHON_NPC_ID = NpcIdentifiers.GRYPHON_3; // 15009, quest cave Gryphon
  const SHELLBANE_NPC_ID = NpcIdentifiers.SHELLBANE_GRYPHON_2; // 15010, Little Pearl boss
  const BOAT_FLOOPA_NPC_ID = 14987; // tt_floopa_boat, on the player's deck at sea
  const DOCK_FLOOPA_NPC_ID = 14988; // tt_floopa_conch_docks, Great Conch arrival
  const PEARL_SAILOR_NPC_ID = NpcIdentifiers.SAILOR_12; // 15001, captured cutscene sailor
  const PEARL_KOREL_NPC_ID = NpcIdentifiers.ELDER_KOREL_2; // 14999
  const PEARL_KOREL_DONE_NPC_ID = NpcIdentifiers.ELDER_KOREL_3; // 15000, Talk-to after Shellbane
  const PEARL_HUBBER_NPC_ID = NpcIdentifiers.ELDER_HUBBER_2; // 15004
  const PEARL_ROOT_NPC_ID = NpcIdentifiers.ELDER_ROOT_2; // 15007

  // Items (cache ids; ItemIdentifiers comments).
  const SEAWEED_ITEM_ID = ItemIdentifiers.SEAWEED; // 401
  const PALM_LEAF_ITEM_ID = ItemIdentifiers.PALM_LEAF; // 2339
  const MAKESHIFT_BANDAGES_ITEM_ID = ItemIdentifiers.MAKESHIFT_BANDAGES; // 31392
  const TORTUGAN_SCUTE_ITEM_ID = ItemIdentifiers.TORTUGAN_SCUTE; // 31393
  const SEA_SHELL_ITEM_ID = ItemIdentifiers.SEA_SHELL; // 31395
  const LIST_OF_REPAIRS_ITEM_ID = ItemIdentifiers.LIST_OF_REPAIRS; // 31397
  const TORTUGAN_SHIELD_ITEM_ID = ItemIdentifiers.TORTUGAN_SHIELD; // 31398
  const JATOBA_LOGS_ITEM_ID = ItemIdentifiers.JATOBA_LOGS; // 32902
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const SAW_ITEM_ID = ItemIdentifiers.SAW; // 8794

  // Quest objects. The repaired walls/stalls/crates and the tracking scenery are
  // cache multi-locs whose placed ids have no cache names (null), so the base
  // placement ids are constants here: base -> resolved by the quest varbits.
  const KRILL_STALL_OBJECT_ID = 58420; // varbit 18327 -> 58428/58429 (Repair)/57943
  const COCO_STALL_OBJECT_ID = 58421; // varbit 18331 -> 58426/58427 (Repair)/57947
  const STROM_CRATE_OBJECT_ID = 58422; // varbit 18330 -> 58430/58431 (Repair)/58432
  const COCO_CRATE_OBJECT_ID = 58423; // varbit 18332 -> 58433/58434 (Repair)/58435
  const KRILL_WALL_OBJECT_ID = 58424; // varbit 18328 -> 58436/58437 (Repair)/58438
  const STROM_WALL_OBJECT_ID = 58425; // varbit 18329 -> 58436/58437 (Repair)/58438
  const CAVE_ENTRANCE_OBJECT_ID = 58439; // varbit 18321 -> 58440 Unblock/58441 Enter
  const CAVE_EXIT_OBJECT_ID = 58442; // "Cave exit", Exit
  const MONUMENT_OBJECT_ID = 58445; // 58446 Inspect at stages 22-28
  const TRACK_PLANT_OBJECT_IDS = new Set([58449, 58452, 58455, 58458, 58461, 58464]);
  const TRACK_ROCKSLIDE_OBJECT_IDS = new Set([58467, 58470]);
  const TRACK_OBJECT_IDS = new Set([...TRACK_PLANT_OBJECT_IDS, ...TRACK_ROCKSLIDE_OBJECT_IDS]);
  const PALM_OBJECT_IDS = new Set([58415, 58416, 58417]); // islands palms, Shake
  const JATOBA_TREE_OBJECT_IDS = new Set([58555]);

  // Varbits ("tt" family, varp 4961).
  const VARP_TROUBLED_TORTUGANS = 4961; // "tt" stage and repair bits
  const VARBIT_STAGE = 18321; // "tt", bits 0-5
  const VARBIT_TRAIL = [18322, 18323, 18324, 18325, 18326]; // hunting trail 1-5, bits 6-15
  const VARBIT_REPAIR_KRILL_STALL = 18327;
  const VARBIT_REPAIR_KRILL_WALL = 18328;
  const VARBIT_REPAIR_STROM_WALL = 18329;
  const VARBIT_REPAIR_STROM_CRATES = 18330;
  const VARBIT_REPAIR_COCO_STALL = 18331;
  const VARBIT_REPAIR_COCO_CRATES = 18332;
  const VARBIT_FREE_SHIELD = 18333;

  // RuneLite Quest Helper's pinned stage map for varbit 18321 (values 2..42).
  const STAGE_STARTED = 2;
  const STAGE_BANDAGES_MADE = 4;
  const STAGE_BANDAGES_USED = 6;
  const STAGE_FLOOPA_MET = 7;
  const STAGE_SAILING = 8;
  const STAGE_ARRIVED = 10;
  const STAGE_DISEMBARKED = 12;
  const STAGE_KOREL_TALKED = 13;
  const STAGE_KOREL_SENT = 14;
  const STAGE_RALEY_MET = 16;
  const STAGE_REPAIRS_GIVEN = 18;
  const STAGE_REPAIRS_DONE = 20;
  const STAGE_TRACKING = 22;
  const STAGE_TRAIL_FOUND = 24;
  const STAGE_UNBLOCK_CAVE = 26;
  const STAGE_CAVE_OPEN = 28; // cave cleared, Enter available
  const STAGE_GRYPHON_FIGHT = 30;
  const STAGE_GRYPHON_DEAD = 32;
  const STAGE_PEARL_BRIEFED = 34;
  const STAGE_PEARL_ARRIVED = 36;
  const STAGE_SHELLBANE_DEAD = 38;
  const STAGE_KOREL_PEARL_TALKED = 40;
  const STAGE_LEAVING_PEARL = 42;
  const STAGE_COMPLETE = 44; // capture 3456: 42 -> 44 on the final line

  const TRAIL_STEPS = 5; // monument + 4 terrain finds
  const REPAIR_XP = 80; // per repair, OSRS Wiki
  const SAILING_REWARD_XP = 10000; // OSRS Wiki
  const SLAYER_REWARD_XP = 8000; // OSRS Wiki

  // Quest Helper's skill requirements [skill, level, boostable].
  const REQUIREMENTS = [
    [Skill.SLAYER, 51, false],
    [Skill.CONSTRUCTION, 48, false],
    [Skill.SAILING, 45, false],
    [Skill.HUNTER, 45, false],
    [Skill.WOODCUTTING, 40, true],
    [Skill.CRAFTING, 34, true],
  ];

  const PAGE = "Troubled Tortugans";
  const START_HOOK = "quest:troubled-tortugans:start";
  const REPAIRS_ATTRIBUTE = "troubled-tortugans:repairs";
  const TRAIL_ATTRIBUTE = "troubled-tortugans:trail";
  const FREE_SHIELD_ATTRIBUTE = "troubled-tortugans:free-shield";
  const STAGE_VERSION_ATTRIBUTE = "troubled-tortugans:stage-v2";

  // Variant slugs (transcript page).
  const V_START = "part-1-talking-to-injured-tortugan";
  const V_ISLAND_AGAIN = "part-1-talking-to-injured-tortugan-talking-to-injured-tortugan-again";
  const V_BANDAGES = "part-1-talking-to-injured-tortugan-with-the-makeshift-bandages";
  const V_BOAT = "part-1-talking-to-injured-tortugan-with-the-makeshift-bandages-talking-to-floopa-again";
  const V_ARRIVAL = "part-1-arrival-at-the-great-conch";
  const V_ARRIVAL_AGAIN = "part-1-arrival-at-the-great-conch-talking-to-korel-again";
  const V_RALEY_MEET = "part-2-talking-to-floopa-or-elder-raley";
  const V_RALEY_REPAIRS = "part-2-talking-to-floopa-or-elder-raley-talking-to-elder-raley-again";
  const V_RALEY_TRACK = "part-2-talking-to-floopa-or-elder-raley-2";
  const V_RALEY_TRACK_AGAIN = "part-2-talking-to-floopa-or-elder-raley-talking-to-elder-raley-again-2";
  const V_FLOOPA_AGAIN = "part-2-talking-to-floopa-or-elder-raley-talking-to-floopa-again";
  const V_FLOOPA_REST = "part-2-talking-to-floopa-or-elder-raley-talking-to-floopa-again-2";
  const V_KOREL_TOURIST = "part-2-talking-to-floopa-or-elder-raley-talking-to-elder-korel";
  const V_PEARL_BRIEF = "part-3-talking-to-elder-korel-elder-raley-or-floopa";
  const V_PEARL_HURRY_FLOOPA = "part-3-talking-to-elder-korel-elder-raley-or-floopa-talking-to-floopa-again";
  const V_KOREL_PEARL = "part-3-talking-to-elder-korel";
  const V_KOREL_PEARL_AGAIN = "part-3-talking-to-elder-korel-talking-to-elder-korel-again";
  const V_FINAL = "part-3-talking-to-floopa-or-elder-raley";
  const V_TERRAIN = "part-3-tracking-the-gryphon-inspecting-terrain";
  const V_CAVE = "part-3-tracking-the-gryphon-entering-the-cave";
  const V_EAST_CAVE = "part-1-arrival-at-the-great-conch-attempting-to-enter-the-east-gryphon-caves";
  const V_BLUNN_SHIELD = "part-3-talking-to-elder-blunn";
  const V_BLUNN_RETRY = "part-3-talking-to-elder-blunn-talking-to-elder-blunn-after-failing-to-take-the-shield";
  const V_BLUNN_BUSY = "part-1-arrival-at-the-great-conch-talking-to-elder-blunn";
  const V_KRILL_BUSY = "part-1-arrival-at-the-great-conch-talking-to-elder-krill";
  const V_KRILL_WELCOME = "part-2-talking-to-floopa-or-elder-raley-talking-to-elder-krill";
  const V_KRILL_THANKS = "part-2-finishing-repairs-talking-to-elder-krill";
  const V_STROM_BUSY = "part-1-arrival-at-the-great-conch-talking-to-elder-strom";
  const V_STROM_WELCOME = "part-2-talking-to-floopa-or-elder-raley-talking-to-elder-strom";
  const V_STROM_THANKS = "part-2-finishing-repairs-talking-to-elder-strom";
  const V_COCO_BUSY = "part-1-arrival-at-the-great-conch-talking-to-elder-coco";
  const V_COCO_WELCOME = "part-2-talking-to-floopa-or-elder-raley-talking-to-elder-coco";
  const V_COCO_THANKS = "part-2-finishing-repairs-talking-to-elder-coco";
  const V_PEARL_ARRIVE = "part-3-upon-arriving-at-the-little-pearl";
  const V_FLOOPA_AT_SEA = "part-1-talking-to-injured-tortugan-with-the-makeshift-bandages-talking-to-floopa-whilst-at-sea";
  const V_FLOOPA_CLOSE = "part-1-talking-to-injured-tortugan-with-the-makeshift-bandages-talking-to-floopa-when-close-to-the-island";
  const V_FLOOPA_GANGPLANK = "part-1-talking-to-injured-tortugan-with-the-makeshift-bandages-talking-to-floopa-near-the-gangplank";

  // Condition step ids on the page (research pack).
  const COND_START_REQUIREMENTS = "I3ziiG";
  const COND_LIST_INVENTORY_FULL = "-XPhbk";
  const COND_HAS_LIST = "jh9OIt";
  const COND_NO_LIST = "O3HP_w";
  const COND_PLANT_TRACKS = "2DTdAY";
  const COND_ROCKSLIDE_TRACKS = "gC7t1D";
  const COND_NO_TRACKS = "0keXDh";
  const COND_HAS_AXE = "Qmm2Q9";
  const COND_NO_AXE = "0nQvSc";
  const COND_SHIELD_ROOM = "nU5GwF";
  const COND_SHIELD_NO_ROOM = "5n9wu4";

  // Action/message step ids whose side effects this plugin performs.
  const ACTION_FLOOPA_HEADS_HOME = "bRB9K_"; // "Floopa heads over to Elder Raley's home."
  const ACTION_LIST_GIVEN = "8dFZ4e"; // "Elder Raley gives you the list of repairs..."
  const ACTION_LIST_REPLACED = "mhOS7H"; // "...gives you a list of repairs..."
  const ACTION_SHIELD_GIVEN = "D0cMlA"; // "Elder Blunn gives you a tortugan shield."
  const ACTION_SHIELD_GIVEN_AGAIN = "CE8o3_"; // same, after a failed hand-out
  const ACTION_CAVE_CLEARED = "_IAdC-"; // "You use your axe to clear a path..."
  const ACTION_PEARL_CUTSCENE = "vF0eLx"; // "A cutscene begins..."

  // Repair table: placement id, its varbit, its persisted bit, materials.
  const REPAIRS = [
    { objectId: KRILL_STALL_OBJECT_ID, varbit: VARBIT_REPAIR_KRILL_STALL, bit: 1 << 0, label: "the fish stall", scutes: 1, shells: 1, logs: 2 },
    { objectId: KRILL_WALL_OBJECT_ID, varbit: VARBIT_REPAIR_KRILL_WALL, bit: 1 << 1, label: "the wall", scutes: 2, shells: 0, logs: 2 },
    { objectId: STROM_WALL_OBJECT_ID, varbit: VARBIT_REPAIR_STROM_WALL, bit: 1 << 2, label: "the wall", scutes: 2, shells: 0, logs: 2 },
    { objectId: STROM_CRATE_OBJECT_ID, varbit: VARBIT_REPAIR_STROM_CRATES, bit: 1 << 3, label: "the crate", scutes: 0, shells: 2, logs: 1 },
    { objectId: COCO_STALL_OBJECT_ID, varbit: VARBIT_REPAIR_COCO_STALL, bit: 1 << 4, label: "the stall", scutes: 1, shells: 1, logs: 2 },
    { objectId: COCO_CRATE_OBJECT_ID, varbit: VARBIT_REPAIR_COCO_CRATES, bit: 1 << 5, label: "the crate", scutes: 0, shells: 2, logs: 1 },
  ];
  const REPAIR_BY_OBJECT = new Map(REPAIRS.map((repair) => [repair.objectId, repair]));

  // Quest areas.
  const ISLAND_ZONE = { minX: 2946, maxX: 2975, minY: 2588, maxY: 2625, levels: [0] };
  const PEARL_ZONE = { minX: 3338, maxX: 3378, minY: 2183, maxY: 2223, levels: [0] };

  const ISLAND_TORTUGAN_SPAWN = { x: 2962, y: 2605, z: 0 }; // capture 3456
  const CONCH_DOCKS = { x: 3185, y: 2371, z: 0 };
  const LITTLE_PEARL_MOORING = { x: 3354, y: 2216, z: 0 };
  const PEARL_APPROACH_DISTANCE = 20;
  const DOCK_FLOOPA_SPAWN = { x: 3186, y: 2370, z: 0 }; // capture 3456
  const PEARL_KOREL_SPAWN = { x: 3352, y: 2211, z: 0 };
  const PEARL_HUBBER_SPAWN = { x: 3359, y: 2213, z: 0 };
  const PEARL_ROOT_SPAWN = { x: 3361, y: 2208, z: 0 };
  const CAVE_ENTRY_TILE = { x: 3168, y: 8874, z: 0 }; // capture 3456 landing inside
  const CAVE_GRYPHON_SPAWN = { x: 3178, y: 8873, z: 0 }; // capture 3456
  const CAVE_EXIT_TILE = { x: 3175, y: 2478, z: 0 }; // capture 3456 surface landing
  const SHELLBANE_SPAWN = { x: 3356, y: 2208, z: 0 }; // capture 3456 island fallback

  // Ground material spawns. The cache's ground-items list predates Sailing, so
  // these are registered owner-only while the quest needs them. Capture 3456
  // shows the island seaweed at (2962,2600) and these six scute/shell pickups.
  const SEAWEED_SPAWNS = [{ itemId: SEAWEED_ITEM_ID, x: 2962, y: 2600, z: 0 }];
  const MATERIAL_SPAWNS = [
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3110, y: 2430, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3118, y: 2419, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3119, y: 2443, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3102, y: 2415, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3115, y: 2407, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3131, y: 2398, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3161, y: 2389, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3168, y: 2388, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3179, y: 2384, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3190, y: 2379, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3191, y: 2383, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3197, y: 2376, z: 0 },
  ];

  const Scenes = createQuestScenes(api);
  const VARBIT_BOARDED_BOAT = 19136;
  const AT_SEA_NPC_DISTANCE = 60; // close-to-the-island
  const GANGPLANK_DISTANCE = 14; // near-the-gangplank
  const FINE_UNITS_PER_TILE = 128;
  const SHELLBANE_SPECIAL_TICKS = 8;
  const SHELLBANE_SPECIAL_DAMAGE = { whirlwind: 6, ranged: 6, spit: 4 };
  const SHELLBANE_SHIELD_DAMAGE = { whirlwind: 2, ranged: 2, spit: 1 };
  const SHELLBANE_ANIM = { whirlwind: 12555, ranged: 12554, spit: 12553 };
  const SHIELD_BLOCK_ANIMATION = 1156;
  const TORTUGAN_STAFF_ANIMATION = 12596;

  let quest;
  const trackingAnswer = new WeakMap(); // player -> "plant" | "rockslide" | "none"
  const cavePrompt = new WeakMap(); // player -> the Unblock "Enter the cave?" menu is up
  const islandTortuganByPlayer = new WeakMap();
  const caveGryphonByPlayer = new WeakMap();
  const shellbaneByPlayer = new WeakMap();
  const boatFloopaByPlayer = new WeakMap();
  const dockFloopaByPlayer = new WeakMap();
  const pearlActorsByPlayer = new WeakMap();
  const pearlFightKeys = new WeakMap(); // player -> task key while Shellbane fights
  const pearlCutscenes = new WeakSet();
  const pearlCameraKeys = new WeakMap();
  const pearlApproachKeys = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const freeSlots = (player) => player.getInventory().getFreeSlots();

  function inZone(zone, location) {
    return Boolean(
      location
      && location.getX() >= zone.minX
      && location.getX() <= zone.maxX
      && location.getY() >= zone.minY
      && location.getY() <= zone.maxY
      && zone.levels.includes(location.getZ?.() ?? 0)
    );
  }

  /** True when the player is on their own boat (capture 3456 spawns Floopa on the deck). */
  function aboard(player) {
    const sender = player.getPacketSender?.();
    if (sender?.getVarbit?.(VARBIT_BOARDED_BOAT) === 1) return true;
    const state = player.getSailing?.();
    const boat = state?.boats?.find?.((entry) => entry.slot === state.activeBoatSlot);
    return boat?.location?.kind === "at_sea";
  }

  /** The boat's world tile at sea, or the player's tile on foot. */
  function worldTile(player) {
    const state = player.getSailing?.();
    const boat = state?.boats?.find?.((entry) => entry.slot === state.activeBoatSlot);
    if (aboard(player) && boat?.location?.kind === "at_sea") {
      return { x: Math.floor(boat.location.fineX / FINE_UNITS_PER_TILE), y: Math.floor(boat.location.fineY / FINE_UNITS_PER_TILE) };
    }
    const location = player.getLocation();
    return { x: location.getX(), y: location.getY() };
  }

  function distanceFrom(tile, target) {
    return Math.max(Math.abs(tile.x - target.x), Math.abs(tile.y - target.y));
  }

  function nearConch(player) {
    return distanceFrom(worldTile(player), CONCH_DOCKS) <= 40;
  }

  /** `sailing:left` carries the boat instance; its root tile survives deck disposal. */
  function boatEventTile(boat) {
    const tile = boat?.worldTile?.();
    if (tile) return { x: tile.x, y: tile.y };
    if (Number.isFinite(boat?.fineX) && Number.isFinite(boat?.fineY)) {
      return { x: Math.floor(boat.fineX / FINE_UNITS_PER_TILE), y: Math.floor(boat.fineY / FINE_UNITS_PER_TILE) };
    }
    return null;
  }

  function later(key, ticks, callback) {
    Scenes.later(key, ticks, callback);
  }

  function camera(player, move, look, motion = Scenes.CAMERA_RATES) {
    Scenes.camera(player, move, look, motion);
  }

  function endPearlCutscene(player) {
    pearlCutscenes.delete(player);
    const key = pearlCameraKeys.get(player);
    if (key) api.core.TaskManager.cancelTasks?.(key);
    pearlCameraKeys.delete(player);
    Scenes.closeFade(player);
    player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
    Scenes.controls(player, false, true);
  }

  function hasTortuganShield(player) {
    const equipment = player.getEquipment?.();
    // Item 31398 is worn on the back/cape slot (cache wearPos 1).
    return equipment?.get?.(Equipment.CAPE_SLOT)?.getId?.() === TORTUGAN_SHIELD_ITEM_ID;
  }

  function damagePlayer(player, amount) {
    const hit = api.core.HitDamage && new api.core.HitDamage(amount, api.core.HitMask.RED);
    const queue = player.getCombat?.().getHitQueue?.();
    if (hit && queue?.addPendingDamage) queue.addPendingDamage([hit]);
  }

  function hasQuestCompleted(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIREMENTS.every(([skill, level, boostable]) =>
      (boostable ? skills.getCurrentLevel(skill) : skills.getMaxLevel(skill)) >= level)
      && hasQuestCompleted(player, "pandemonium");
  }

  function hasAxe(player) {
    return Boolean(woodcutting.findBestUsableAxe(player));
  }

  function repairsDone(player) {
    return Number(player.getAttribute(REPAIRS_ATTRIBUTE)) || 0;
  }

  function trailProgress(player) {
    return Number(player.getAttribute(TRAIL_ATTRIBUTE)) || 0;
  }

  function freeShieldGiven(player) {
    return player.getAttribute(FREE_SHIELD_ATTRIBUTE) === true;
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function conchFloopaVariant(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return null;
    if (stage < STAGE_FLOOPA_MET || stage === STAGE_ARRIVED) return null; // still on the island/seas
    if (stage < STAGE_REPAIRS_GIVEN) return V_FLOOPA_AGAIN;
    if (stage <= STAGE_CAVE_OPEN) return V_FLOOPA_REST;
    if (stage === STAGE_GRYPHON_DEAD) return V_PEARL_BRIEF;
    if (stage <= STAGE_SHELLBANE_DEAD) return V_PEARL_HURRY_FLOOPA;
    return V_FINAL;
  }

  function islandTortuganVariant(player, npc) {
    if (npc && typeof npc.getLocation === "function" && !inZone(ISLAND_ZONE, npc.getLocation())) {
      return conchFloopaVariant(player);
    }
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return null;
    if (stage === 0) return V_START;
    if (stage < STAGE_FLOOPA_MET) return V_ISLAND_AGAIN;
    return V_BOAT;
  }

  function raleyVariant(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return null;
    if (stage < STAGE_KOREL_TALKED) return null;
    if (stage < STAGE_REPAIRS_GIVEN) return V_RALEY_MEET;
    if (stage === STAGE_REPAIRS_GIVEN) return V_RALEY_REPAIRS;
    if (stage < STAGE_TRACKING) return V_RALEY_TRACK;
    if (stage <= STAGE_CAVE_OPEN) return V_RALEY_TRACK_AGAIN;
    if (stage === STAGE_GRYPHON_DEAD) return V_PEARL_BRIEF;
    if (stage < STAGE_KOREL_PEARL_TALKED) return V_PEARL_BRIEF;
    if (stage < STAGE_COMPLETE) return V_FINAL;
    return null;
  }

  function korelVariant(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player)) return null;
    if (stage === 0) return null;
    if (stage <= STAGE_ARRIVED) return V_ARRIVAL;
    if (stage < STAGE_REPAIRS_GIVEN) return V_ARRIVAL_AGAIN;
    if (stage < STAGE_PEARL_BRIEFED) return V_KOREL_TOURIST;
    if (stage === STAGE_PEARL_BRIEFED) return V_PEARL_BRIEF;
    if (stage === STAGE_SHELLBANE_DEAD) return V_KOREL_PEARL;
    if (stage === STAGE_KOREL_PEARL_TALKED) return V_KOREL_PEARL_AGAIN;
    return null;
  }

  function blunnVariant(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player) || stage === 0) return null;
    if (stage < STAGE_PEARL_BRIEFED) return V_BLUNN_BUSY;
    if (held(player, TORTUGAN_SHIELD_ITEM_ID)) return null;
    return freeShieldGiven(player) ? V_BLUNN_RETRY : V_BLUNN_SHIELD;
  }

  function workerVariant(player, busyVariant, welcomeVariant, thanksVariant) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player) || stage < STAGE_KOREL_TALKED) return null;
    if (stage < STAGE_RALEY_MET) return busyVariant;
    if (stage < STAGE_REPAIRS_DONE) return welcomeVariant;
    return thanksVariant;
  }

  function seaFloopaVariant(player) {
    const distance = distanceFrom(worldTile(player), CONCH_DOCKS);
    if (distance <= GANGPLANK_DISTANCE) return V_FLOOPA_GANGPLANK;
    if (distance <= AT_SEA_NPC_DISTANCE) return V_FLOOPA_CLOSE;
    return V_FLOOPA_AT_SEA;
  }

  function selectVariant({ npcId, npc, player }) {
    if (!player) return null;
    if (npcId === BOAT_FLOOPA_NPC_ID) return { page: PAGE, variant: seaFloopaVariant(player) };
    if (npcId === DOCK_FLOOPA_NPC_ID) {
      if (quest.getStage(player) === STAGE_DISEMBARKED) return { page: PAGE, variant: V_ARRIVAL };
      const variant = conchFloopaVariant(player);
      return variant ? { page: PAGE, variant } : null;
    }
    if (INJURED_TORTUGAN_NPC_IDS.has(npcId)) return islandTortuganVariant(player, npc);
    if (FLOOPA_NPC_IDS.has(npcId)) return conchFloopaVariant(player);
    if (RALEY_NPC_IDS.has(npcId)) return raleyVariant(player);
    if (KOREL_NPC_IDS.has(npcId)) return korelVariant(player);
    if (BLUNN_NPC_IDS.has(npcId)) return blunnVariant(player);
    if (KRILL_NPC_IDS.has(npcId)) return workerVariant(player, V_KRILL_BUSY, V_KRILL_WELCOME, V_KRILL_THANKS);
    if (STROM_NPC_IDS.has(npcId)) return workerVariant(player, V_STROM_BUSY, V_STROM_WELCOME, V_STROM_THANKS);
    if (COCO_NPC_IDS.has(npcId)) return workerVariant(player, V_COCO_BUSY, V_COCO_WELCOME, V_COCO_THANKS);
    if (MAG_NPC_IDS.has(npcId) || REGGLE_NPC_IDS.has(npcId)) {
      const stage = quest.getStage(player);
      if (quest.isComplete(player) || stage < STAGE_KOREL_TALKED || stage >= STAGE_REPAIRS_DONE) return null;
      return MAG_NPC_IDS.has(npcId)
        ? "part-1-arrival-at-the-great-conch-talking-to-mag"
        : "part-1-arrival-at-the-great-conch-talking-to-elder-reggle";
    }
    return null;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition({ stepId, npcId, player }) {
    if (!player || !TRANSCRIPT_NPC_IDS.has(npcId)) return null;
    switch (stepId) {
      case COND_START_REQUIREMENTS:
        return !meetsRequirements(player);
      case COND_LIST_INVENTORY_FULL:
        return freeSlots(player) < 1;
      case COND_HAS_LIST:
        return held(player, LIST_OF_REPAIRS_ITEM_ID);
      case COND_NO_LIST:
        return !held(player, LIST_OF_REPAIRS_ITEM_ID);
      case COND_PLANT_TRACKS:
        return trackingAnswer.get(player) === "plant";
      case COND_ROCKSLIDE_TRACKS:
        return trackingAnswer.get(player) === "rockslide";
      case COND_NO_TRACKS:
        return trackingAnswer.get(player) === "none";
      case COND_HAS_AXE:
        return hasAxe(player);
      case COND_NO_AXE:
        return !hasAxe(player);
      case COND_SHIELD_ROOM:
        return freeSlots(player) >= 1;
      case COND_SHIELD_NO_ROOM:
        return freeSlots(player) < 1;
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== START_HOOK || !INJURED_TORTUGAN_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === 0) {
      quest.setStage(player, STAGE_STARTED);
      ensureMaterialSpawns(player);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!stepId || !TRANSCRIPT_NPC_IDS.has(npcId)) return;
    switch (stepId) {
      case ACTION_FLOOPA_HEADS_HOME:
        removeDockFloopa(player);
        if (quest.getStage(player) === STAGE_DISEMBARKED) quest.setStage(player, STAGE_KOREL_TALKED);
        return;
      case ACTION_LIST_GIVEN:
      case ACTION_LIST_REPLACED:
        if (!held(player, LIST_OF_REPAIRS_ITEM_ID) && freeSlots(player) >= 1) {
          player.getInventory().adds(LIST_OF_REPAIRS_ITEM_ID, 1);
        }
        if (quest.getStage(player) < STAGE_REPAIRS_GIVEN) quest.setStage(player, STAGE_REPAIRS_GIVEN);
        enableRepairs(player);
        ensureMaterialSpawns(player);
        return;
      case ACTION_SHIELD_GIVEN:
      case ACTION_SHIELD_GIVEN_AGAIN:
        giveShield(player);
        return;
      case ACTION_CAVE_CLEARED:
        if (quest.getStage(player) < STAGE_CAVE_OPEN) quest.setStage(player, STAGE_CAVE_OPEN);
        return;
      case ACTION_PEARL_CUTSCENE:
        beginPearlAssault(player);
        return;
      default:
    }
  }

  /** Raley's "I'd better get to it." and the cave's "Enter the cave?". */
  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (cavePrompt.get(player) && (option === "Yes." || option === "No.")) {
      cavePrompt.delete(player);
      if (option === "Yes.") {
        spawnCaveGryphon(player);
        player.moveTo(new Location(CAVE_ENTRY_TILE.x, CAVE_ENTRY_TILE.y, CAVE_ENTRY_TILE.z));
      }
      return;
    }
    if (option === "I'd better get to it." && RALEY_NPC_IDS.has(npcId)
      && quest.getStage(player) === STAGE_REPAIRS_DONE) {
      quest.setStage(player, STAGE_TRACKING);
    }
  }

  /** Stage/flag transitions that ride on transcript lines. */
  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string" || !TRANSCRIPT_NPC_IDS.has(npcId)) return;
    // Meeting Raley moves the guide from Korel's arrival to the repairs intro.
    if (RALEY_NPC_IDS.has(npcId)) {
      const before = quest.getStage(player);
      if (before >= STAGE_KOREL_SENT && before < STAGE_RALEY_MET) quest.setStage(player, STAGE_RALEY_MET);
    }
    let stage = quest.getStage(player);
    // The bandage conversation and the boat hand-off are two recorded steps.
    if (stage === STAGE_BANDAGES_USED && text.startsWith("Don't mention it.")) {
      quest.setStage(player, STAGE_FLOOPA_MET);
      return;
    }
    if (stage === STAGE_FLOOPA_MET && text.startsWith("The Great Conch, to the south east.")) {
      quest.setStage(player, STAGE_SAILING);
      return;
    }
    if (KOREL_NPC_IDS.has(npcId) && stage === STAGE_DISEMBARKED) {
      quest.setStage(player, STAGE_KOREL_TALKED);
      stage = STAGE_KOREL_TALKED;
    }
    if ((KOREL_NPC_IDS.has(npcId) || npcId === DOCK_FLOOPA_NPC_ID) && stage === STAGE_KOREL_TALKED
      && text.startsWith("Very well. I will see that it is done.")) {
      quest.setStage(player, STAGE_KOREL_SENT);
      return;
    }
    if (stage === STAGE_REPAIRS_DONE && text.startsWith("Will do. I'm sure I'll have it dealt with in no time!")) {
      quest.setStage(player, STAGE_TRACKING);
      return;
    }
    if (text.startsWith("Alright. I'll head back right away.") && stage === STAGE_KOREL_PEARL_TALKED) {
      quest.setStage(player, STAGE_LEAVING_PEARL);
      return;
    }
    if (stage === STAGE_GRYPHON_DEAD && text === "I will meet you there, human.") {
      quest.setStage(player, STAGE_PEARL_BRIEFED);
      return;
    }
    if (stage === STAGE_SHELLBANE_DEAD
      && KOREL_NPC_IDS.has(npcId)
      && text.startsWith("Very good work, human!")) {
      quest.setStage(player, STAGE_KOREL_PEARL_TALKED);
      return;
    }
    if (stage >= STAGE_LEAVING_PEARL
      && !quest.isComplete(player)
      && text.startsWith("No, no, no! Thank you")
      && (RALEY_NPC_IDS.has(npcId) || INJURED_TORTUGAN_NPC_IDS.has(npcId) || FLOOPA_NPC_IDS.has(npcId))) {
      quest.complete(player);
      syncProgressVarbits(player); // the capture clears the trail flags on completion
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function shakePalm(event) {
    if (!PALM_OBJECT_IDS.has(event.objectId)) return false;
    const { player } = event;
    if (quest.isComplete(player)) return false;
    if (held(player, PALM_LEAF_ITEM_ID)) {
      player.sendMessage("You already have a palm leaf.");
      return true;
    }
    player.getInventory().adds(PALM_LEAF_ITEM_ID, 1);
    player.sendMessage("You shake the tree and a palm leaf falls into your hands.");
    return true;
  }

  function makeBandages(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_BANDAGES_USED || quest.isComplete(player)) return false;
    if (!held(player, SEAWEED_ITEM_ID) || !held(player, PALM_LEAF_ITEM_ID)) return false;
    if (held(player, MAKESHIFT_BANDAGES_ITEM_ID)) return false;
    player.getInventory().deleteNumber(SEAWEED_ITEM_ID, 1);
    player.getInventory().deleteNumber(PALM_LEAF_ITEM_ID, 1);
    player.getInventory().adds(MAKESHIFT_BANDAGES_ITEM_ID, 1);
    player.sendMessage("You make some makeshift bandages.");
    if (stage < STAGE_BANDAGES_MADE) quest.setStage(player, STAGE_BANDAGES_MADE);
    return true;
  }

  function handBandagesToTortugan(event) {
    const { player, npcId, itemId } = event;
    if (!INJURED_TORTUGAN_NPC_IDS.has(npcId) || itemId !== MAKESHIFT_BANDAGES_ITEM_ID) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_BANDAGES_USED || quest.isComplete(player)) return;
    if (!held(player, MAKESHIFT_BANDAGES_ITEM_ID)) return;
    event.handled = true;
    player.getInventory().deleteNumber(MAKESHIFT_BANDAGES_ITEM_ID, 1);
    quest.setStage(player, STAGE_BANDAGES_USED);
    startTranscript(api, player, npcId, PAGE, V_BANDAGES);
  }

  function chopJatoba(event) {
    if (!JATOBA_TREE_OBJECT_IDS.has(event.objectId)) return false;
    const { player } = event;
    if (quest.isComplete(player)) return false;
    const axe = woodcutting.findBestUsableAxe(player);
    if (!axe) {
      player.sendMessage("You need an axe to chop down this tree.");
      return true;
    }
    player.performAnimation(new Animation(axe.animationId));
    player.getInventory().adds(JATOBA_LOGS_ITEM_ID, 1);
    player.sendMessage("You get some jatoba logs.");
    return true;
  }

  // ==========================================================================
  // Repairs
  // ==========================================================================

  function hasTools(player) {
    return held(player, HAMMER_ITEM_ID) && held(player, SAW_ITEM_ID);
  }

  function hasMaterials(player, repair) {
    return (!repair.scutes || held(player, TORTUGAN_SCUTE_ITEM_ID, repair.scutes))
      && (!repair.shells || held(player, SEA_SHELL_ITEM_ID, repair.shells))
      && (!repair.logs || held(player, JATOBA_LOGS_ITEM_ID, repair.logs));
  }

  function consumeMaterials(player, repair) {
    if (repair.scutes) player.getInventory().deleteNumber(TORTUGAN_SCUTE_ITEM_ID, repair.scutes);
    if (repair.shells) player.getInventory().deleteNumber(SEA_SHELL_ITEM_ID, repair.shells);
    if (repair.logs) player.getInventory().deleteNumber(JATOBA_LOGS_ITEM_ID, repair.logs);
  }

  /** Repair option on a broken stall/crate/wall (the placement id picks the repair). */
  function repairObject(event) {
    const repair = REPAIR_BY_OBJECT.get(event.objectId);
    if (!repair) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_REPAIRS_GIVEN || stage >= STAGE_REPAIRS_DONE || quest.isComplete(player)) {
      return false;
    }
    if ((repairsDone(player) & repair.bit) !== 0) return true;
    if (!hasTools(player)) {
      player.sendMessage("You need a hammer and a saw to repair this.");
      return true;
    }
    if (!hasMaterials(player, repair)) {
      player.sendMessage("You don't have the materials needed for this repair.");
      return true;
    }
    consumeMaterials(player, repair);
    player.setAttribute(REPAIRS_ATTRIBUTE, repairsDone(player) | repair.bit);
    player.getPacketSender().sendVarbit(repair.varbit, 2);
    player.getSkillManager().addExperiences(Skill.CONSTRUCTION, REPAIR_XP);
    player.sendMessage(`You repair ${repair.label}.`);
    if (REPAIRS.every((entry) => (repairsDone(player) & entry.bit) !== 0)) {
      quest.setStage(player, STAGE_REPAIRS_DONE);
    }
    return true;
  }

  function enableRepairs(player) {
    const done = repairsDone(player);
    for (const repair of REPAIRS) {
      if ((done & repair.bit) !== 0) continue;
      player.getPacketSender().sendVarbit(repair.varbit, 1);
    }
  }

  // ==========================================================================
  // Tracking and the cave
  // ==========================================================================

  function inspectMonument(event) {
    if (event.objectId !== MONUMENT_OBJECT_ID) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_TRACKING || stage > STAGE_GRYPHON_DEAD || quest.isComplete(player)) return false;
    if (trailProgress(player) === 0 && stage < STAGE_TRAIL_FOUND) {
      player.setAttribute(TRAIL_ATTRIBUTE, 1);
      quest.setStage(player, STAGE_TRAIL_FOUND);
      syncProgressVarbits(player);
      player.sendMessage("You notice a set of tracks leading west from the monument.");
      return true;
    }
    player.sendMessage("You can't see any more tracks here.");
    return true;
  }

  function inspectTerrain(event) {
    if (!TRACK_OBJECT_IDS.has(event.objectId)) return false;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_TRAIL_FOUND || stage > STAGE_GRYPHON_DEAD || quest.isComplete(player)) return false;
    const kind = TRACK_PLANT_OBJECT_IDS.has(event.objectId) ? "plant" : "rockslide";
    const trail = trailProgress(player);
    if (trail >= 1 && trail < TRAIL_STEPS) {
      player.setAttribute(TRAIL_ATTRIBUTE, trail + 1);
      trackingAnswer.set(player, kind);
      if (trail + 1 >= TRAIL_STEPS) quest.setStage(player, STAGE_UNBLOCK_CAVE);
      syncProgressVarbits(player);
    } else {
      trackingAnswer.set(player, "none");
    }
    startTranscript(api, player, NpcIdentifiers.ELDER_KOREL, PAGE, V_TERRAIN);
    return true;
  }

  function unblockCave(event) {
    if (event.objectId !== CAVE_ENTRANCE_OBJECT_ID) return false;
    const { player } = event;
    if (quest.isComplete(player)) return false;
    const stage = quest.getStage(player);
    if (stage >= STAGE_CAVE_OPEN) return false; // the object shows Enter now
    if (stage < STAGE_TRAIL_FOUND || trailProgress(player) < TRAIL_STEPS) {
      startTranscript(api, player, NpcIdentifiers.ELDER_KOREL, PAGE, V_EAST_CAVE);
      return true;
    }
    if (!hasAxe(player)) {
      player.sendMessage("You need an axe to clear the path.");
      return true;
    }
    cavePrompt.set(player, true);
    startTranscript(api, player, NpcIdentifiers.ELDER_KOREL, PAGE, V_CAVE);
    return true;
  }

  function enterCave(event) {
    if (event.objectId !== CAVE_ENTRANCE_OBJECT_ID) return false;
    const { player } = event;
    if (quest.getStage(player) < STAGE_CAVE_OPEN) return false;
    spawnCaveGryphon(player);
    player.moveTo(new Location(CAVE_ENTRY_TILE.x, CAVE_ENTRY_TILE.y, CAVE_ENTRY_TILE.z));
    return true;
  }

  function exitCave(event) {
    if (event.objectId !== CAVE_EXIT_OBJECT_ID) return false;
    event.player.moveTo(new Location(CAVE_EXIT_TILE.x, CAVE_EXIT_TILE.y, CAVE_EXIT_TILE.z));
    return true;
  }

  // ==========================================================================
  // Spawns, zones and the Pearl
  // ==========================================================================

  function ensureIslandTortugan(player) {
    if (quest.isComplete(player) || quest.getStage(player) >= STAGE_ARRIVED) return;
    const existing = islandTortuganByPlayer.get(player);
    if (existing?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: ISLAND_TORTUGAN_RAW_NPC_ID,
      x: ISLAND_TORTUGAN_SPAWN.x,
      y: ISLAND_TORTUGAN_SPAWN.y,
      z: ISLAND_TORTUGAN_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) islandTortuganByPlayer.set(player, npc);
  }

  function removeIslandTortugan(player) {
    const npc = islandTortuganByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    islandTortuganByPlayer.delete(player);
  }

  function spawnCaveGryphon(player) {
    // Entering the cleared cave is Quest Helper's stage 30 (the fight).
    if (quest.getStage(player) >= STAGE_CAVE_OPEN && quest.getStage(player) < STAGE_GRYPHON_FIGHT) {
      quest.setStage(player, STAGE_GRYPHON_FIGHT);
    }
    const existing = caveGryphonByPlayer.get(player);
    if (existing?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: GRYPHON_NPC_ID,
      x: CAVE_GRYPHON_SPAWN.x,
      y: CAVE_GRYPHON_SPAWN.y,
      z: CAVE_GRYPHON_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) caveGryphonByPlayer.set(player, npc);
  }

  function spawnShellbane(player) {
    const existing = shellbaneByPlayer.get(player);
    if (existing?.isRegistered?.()) return existing;
    // Capture 3456 fights the Shellbane from the moored boat's deck, not from
    // the island tile, so it spawns next to the player aboard.
    const onboard = aboard(player);
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: SHELLBANE_NPC_ID,
      x: onboard ? location.getX() + 1 : SHELLBANE_SPAWN.x,
      y: onboard ? location.getY() : SHELLBANE_SPAWN.y,
      z: onboard ? location.getZ() : SHELLBANE_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) {
      // Owner NPCs on a boat deck only sync/attack when they join its private deck.
      if (onboard) addToPlayerArea(player, npc);
      shellbaneByPlayer.set(player, npc);
    }
    return npc;
  }

  /** Owner NPCs spawned on a boat deck must join the deck private area to sync. */
  function addToPlayerArea(player, npc) {
    const area = player.getPrivateArea?.();
    if (npc && area?.add) area.add(npc);
  }

  function detachFromArea(npc) {
    npc?.getPrivateArea?.()?.detach?.(npc);
  }

  function spawnBoatFloopa(player) {
    const existing = boatFloopaByPlayer.get(player);
    if (existing?.isRegistered?.()) return;
    const location = player.getLocation();
    const npc = api.spawnNpc({
      id: BOAT_FLOOPA_NPC_ID,
      x: location.getX(), y: location.getY(), z: location.getZ(),
      wanderRadius: 2, owner: player, ownerOnly: true,
    });
    if (npc) {
      addToPlayerArea(player, npc);
      boatFloopaByPlayer.set(player, npc);
    }
  }

  function removeBoatFloopa(player) {
    const npc = boatFloopaByPlayer.get(player);
    if (npc) { detachFromArea(npc); api.removeNpc(npc); }
    boatFloopaByPlayer.delete(player);
  }

  function spawnDockFloopa(player) {
    const existing = dockFloopaByPlayer.get(player);
    if (existing?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: DOCK_FLOOPA_NPC_ID,
      x: DOCK_FLOOPA_SPAWN.x, y: DOCK_FLOOPA_SPAWN.y, z: DOCK_FLOOPA_SPAWN.z,
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    if (npc) dockFloopaByPlayer.set(player, npc);
  }

  function removeDockFloopa(player) {
    const npc = dockFloopaByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    dockFloopaByPlayer.delete(player);
  }

  /** Phase 1's two recorded boat steps: board (8->10) and disembark at the Conch (10->12). */
  function handleBoarded({ player }) {
    if (quest.isComplete(player)) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_SAILING && stage < STAGE_DISEMBARKED) {
      removeIslandTortugan(player);
      if (stage === STAGE_SAILING) quest.setStage(player, STAGE_ARRIVED);
      spawnBoatFloopa(player);
      return;
    }
    // Phase 3: the approach is watched from the actual boat until it moors at
    // the Little Pearl, matching capture 3456 (no land-zone trigger).
    if (stage === STAGE_PEARL_BRIEFED) startPearlApproachWatch(player);
  }

  function handleLeft({ player, boat, reason }) {
    if (!player || reason !== "disembark" || quest.isComplete(player)) return;
    removeBoatFloopa(player);
    const stage = quest.getStage(player);
    const tile = boatEventTile(boat) ?? worldTile(player);
    if (stage === STAGE_ARRIVED && distanceFrom(tile, CONCH_DOCKS) <= 40) {
      quest.setStage(player, STAGE_DISEMBARKED);
      spawnDockFloopa(player);
      return;
    }
    // Landing at the Little Pearl before the approach watcher fired still uses
    // the real disembark event, then plays the same cutscene ashore.
    if (stage === STAGE_PEARL_BRIEFED &&
      distanceFrom(tile, LITTLE_PEARL_MOORING) <= PEARL_APPROACH_DISTANCE) {
      stopPearlApproachWatch(player);
      startPearlCutscene(player);
      return;
    }
    // Leaving the deck mid-fight: keep the earned hitpoints and continue the
    // same fight on the island instead of stranding the boss on the boat.
    if (stage === STAGE_PEARL_ARRIVED &&
      distanceFrom(tile, LITTLE_PEARL_MOORING) <= 40) {
      const boss = shellbaneByPlayer.get(player);
      if (boss?.isRegistered?.()) {
        const hitpoints = boss.getHitpoints?.();
        detachFromArea(boss);
        api.removeNpc(boss);
        shellbaneByPlayer.delete(player);
        const moved = spawnShellbane(player);
        if (moved && Number.isFinite(hitpoints)) moved.setHitpoints?.(hitpoints);
        scheduleShellbaneSpecials(player);
      }
    }
  }

  /** Capture 3456: Korel turns into his Talk-to combat_done form after Shellbane. */
  function transformPearlKorel(player) {
    const korel = pearlActorsByPlayer.get(player)?.korel;
    if (korel?.isRegistered?.()) korel.setNpcTransformationId?.(PEARL_KOREL_DONE_NPC_ID);
  }

  function spawnPearlActors(player) {
    const existing = pearlActorsByPlayer.get(player) ?? {};
    const place = (key, id, tile) => {
      if (existing[key]?.isRegistered?.()) return existing[key];
      return api.spawnNpc({ id, x: tile.x, y: tile.y, z: tile.z, wanderRadius: 0, owner: player, ownerOnly: true });
    };
    const actors = {
      korel: place("korel", PEARL_KOREL_NPC_ID, PEARL_KOREL_SPAWN),
      hubber: place("hubber", PEARL_HUBBER_NPC_ID, PEARL_HUBBER_SPAWN),
      root: place("root", PEARL_ROOT_NPC_ID, PEARL_ROOT_SPAWN),
    };
    pearlActorsByPlayer.set(player, actors);
    return actors;
  }

  function clearPearlActors(player) {
    const actors = pearlActorsByPlayer.get(player);
    if (!actors) return;
    for (const npc of Object.values(actors)) {
      if (!npc) continue;
      detachFromArea(npc);
      api.removeNpc(npc);
    }
    pearlActorsByPlayer.delete(player);
  }

  /** The boat's world tile at sea, so the check works while aboard the deck instance. */
  function nearPearl(player) {
    const tile = worldTile(player);
    return Math.max(Math.abs(tile.x - LITTLE_PEARL_MOORING.x),
      Math.abs(tile.y - LITTLE_PEARL_MOORING.y)) <= 40;
  }

  function nearPearlMooring(player) {
    const tile = worldTile(player);
    return Math.max(Math.abs(tile.x - LITTLE_PEARL_MOORING.x),
      Math.abs(tile.y - LITTLE_PEARL_MOORING.y)) <= PEARL_APPROACH_DISTANCE;
  }

  function shellbaneFightActive(player, boss = shellbaneByPlayer.get(player)) {
    return Boolean(boss?.isRegistered?.()) && quest.getStage(player) === STAGE_PEARL_ARRIVED
      && !quest.isComplete(player) && nearPearl(player) && (player.getHitpoints?.() ?? 1) > 0;
  }

  function shieldDamage(kind, shielded) {
    return shielded ? SHELLBANE_SHIELD_DAMAGE[kind] : SHELLBANE_SPECIAL_DAMAGE[kind];
  }

  function applyBossHit(player, kind, shielded) {
    if (shielded) player.performAnimation(new Animation(SHIELD_BLOCK_ANIMATION));
    damagePlayer(player, shieldDamage(kind, shielded));
  }

  function shellbaneSpecial(player, boss, kind) {
    if (!shellbaneFightActive(player, boss)) return;
    boss.performAnimation(new Animation(SHELLBANE_ANIM[kind]));
    const shielded = hasTortuganShield(player);
    const at = player.getLocation().clone();
    if (kind === "whirlwind") player.sendMessage("The gryphon aggressively flaps its wings...");
    const key = {};
    later(key, kind === "spit" ? 3 : 2, () => {
      if (!shellbaneFightActive(player, boss)) return;
      if (kind === "spit") {
        const now = player.getLocation();
        if (now.getX() === at.getX() && now.getY() === at.getY()) applyBossHit(player, kind, shielded);
        else player.sendMessage("You move clear of the gryphon's spit.");
        return;
      }
      if (kind === "whirlwind") {
        const bossTile = boss.getLocation();
        const distance = Math.max(Math.abs(player.getLocation().getX() - bossTile.getX()),
          Math.abs(player.getLocation().getY() - bossTile.getY()));
        if (distance <= 2) applyBossHit(player, kind, shielded);
        else player.sendMessage("You stand clear of the gryphon's whirlwind.");
        return;
      }
      applyBossHit(player, kind, shielded);
    });
  }

  function scheduleShellbaneSpecials(player) {
    if (pearlFightKeys.has(player)) return;
    const key = {};
    pearlFightKeys.set(player, key);
    const tick = () => {
      if (pearlFightKeys.get(player) !== key) return;
      const boss = shellbaneByPlayer.get(player);
      if (!shellbaneFightActive(player, boss)) {
        pearlFightKeys.delete(player);
        return;
      }
      const actors = pearlActorsByPlayer.get(player) ?? {};
      for (const npc of [actors.korel, actors.hubber, actors.root]) {
        npc?.performAnimation?.(new Animation(TORTUGAN_STAFF_ANIMATION));
      }
      const kinds = ["whirlwind", "ranged", "spit"];
      shellbaneSpecial(player, boss, kinds[Math.floor(Math.random() * kinds.length)]);
      later(key, SHELLBANE_SPECIAL_TICKS, tick);
    };
    later(key, SHELLBANE_SPECIAL_TICKS, tick);
  }

  function stopPearlFight(player) {
    const key = pearlFightKeys.get(player);
    if (key) api.core.TaskManager.cancelTasks?.(key);
    pearlFightKeys.delete(player);
    endPearlCutscene(player);
    clearPearlActors(player);
  }

  function beginPearlAssault(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_PEARL_BRIEFED || quest.isComplete(player)) return;
    if (stage === STAGE_PEARL_BRIEFED) quest.setStage(player, STAGE_PEARL_ARRIVED);
    spawnShellbane(player);
    spawnPearlActors(player);
    scheduleShellbaneSpecials(player);
    if (!pearlCameraKeys.has(player)) {
      const key = {};
      pearlCameraKeys.set(player, key);
      Scenes.fade(player, false);
      playPearlCamera(player, key);
    }
  }

  /**
   * Capture 3456 ticks 2421-2451 (30 ticks): a two-leg flight from the first
   * shot at (3336,2207), across the Pearl, to (3372,2223), then a reset.
   * The client encoders for cam_moveto_cycles/cam_rotateto_coordinate are not
   * exposed by this server, so the two legs use the closest available arc and
   * rotation packets with the captured heights/cycles/easing.
   */
  function playPearlCamera(player, key) {
    const sender = player.getPacketSender();
    camera(player, [3336, 2207, 1024], [3336, 2192, 1023], Scenes.CAMERA_RATES);
    // Discord capture: five zeroed cam_shake packets open the scene.
    for (let axis = 0; axis < 5; axis++) sender.sendCameraShake(axis, 0, 0, 0);
    later(key, 6, () => {
      if (pearlCameraKeys.get(player) !== key) return;
      sender.sendCameraMoveArc(3355, 2210, 3336, 2197, 1024, 300, "ease_out_sine", true);
      sender.sendCameraRotateBy(0, 0, 300, "ease_out_sine");
    });
    later(key, 16, () => {
      if (pearlCameraKeys.get(player) !== key) return;
      camera(player, [3372, 2223, 1536], [3367, 2223, 1023], Scenes.CAMERA_RATES);
    });
    later(key, 21, () => {
      if (pearlCameraKeys.get(player) !== key) return;
      sender.sendCameraMoveArc(3355, 2210, 3367, 2223, 1536, 150, "ease_out_sine", true);
    });
    later(key, 30, () => {
      if (pearlCameraKeys.get(player) !== key) return;
      pearlCameraKeys.delete(player);
      endPearlCutscene(player);
    });
  }

  function stopPearlApproachWatch(player) {
    const key = pearlApproachKeys.get(player);
    if (key) api.core.TaskManager.cancelTasks?.(key);
    pearlApproachKeys.delete(player);
  }

  /** Polls the real boat position until it reaches the Little Pearl mooring. */
  function startPearlApproachWatch(player) {
    if (pearlApproachKeys.has(player) || quest.getStage(player) !== STAGE_PEARL_BRIEFED || !aboard(player)) return;
    const key = {};
    pearlApproachKeys.set(player, key);
    const tick = () => {
      if (pearlApproachKeys.get(player) !== key) return;
      if (quest.getStage(player) !== STAGE_PEARL_BRIEFED || !aboard(player)) {
        pearlApproachKeys.delete(player);
        return;
      }
      if (nearPearlMooring(player)) {
        stopPearlApproachWatch(player);
        startPearlCutscene(player);
        return;
      }
      later(key, 2, tick);
    };
    later(key, 2, tick);
  }

  /** Captured vF0eLx: fade, a cutscene sailor, then the Pearl assault. */
  function startPearlCutscene(player) {
    stopPearlApproachWatch(player);
    if (pearlCutscenes.has(player)) return;
    pearlCutscenes.add(player);
    quest.setStage(player, STAGE_PEARL_ARRIVED);
    Scenes.controls(player, true, true);
    Scenes.fade(player, true);
    const location = player.getLocation();
    const sailor = api.spawnNpc({
      id: PEARL_SAILOR_NPC_ID, x: location.getX(), y: location.getY(), z: location.getZ(),
      wanderRadius: 0, owner: player, ownerOnly: true,
    });
    addToPlayerArea(player, sailor);
    const actors = pearlActorsByPlayer.get(player) ?? {};
    actors.sailor = sailor;
    pearlActorsByPlayer.set(player, actors);
    const key = {};
    later(key, 3, () => {
      if (!pearlCutscenes.has(player)) return;
      startTranscript(api, player, PEARL_SAILOR_NPC_ID, PAGE, V_PEARL_ARRIVE);
      // The transcript's vF0eLx action begins the assault; this is the recovery
      // path if that action is not reached (closed chatbox, missing page).
      later(key, 1, () => {
        if (pearlCutscenes.has(player) && !shellbaneByPlayer.get(player)?.isRegistered?.()) {
          beginPearlAssault(player);
        }
      });
    });
  }

  function handlePearlZoneEnter({ player }) {
    if (quest.isComplete(player)) return;
    if (quest.getStage(player) === STAGE_SHELLBANE_DEAD && nearPearl(player)) {
      spawnPearlActors(player);
      transformPearlKorel(player);
      return;
    }
    // Recovery only: the mandatory arrival is the boat approach. A player on
    // the island after a relog can still resume the boss onto the land tiles.
    if (quest.getStage(player) === STAGE_PEARL_ARRIVED && !aboard(player) && nearPearl(player)) {
      if (!shellbaneByPlayer.get(player)?.isRegistered?.()) beginPearlAssault(player);
      else scheduleShellbaneSpecials(player);
    }
  }

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (!killer || !npc) return;
    if (npcId === GRYPHON_NPC_ID && caveGryphonByPlayer.get(killer) === npc) {
      caveGryphonByPlayer.delete(killer);
      if (quest.getStage(killer) === STAGE_GRYPHON_FIGHT) quest.setStage(killer, STAGE_GRYPHON_DEAD);
      return;
    }
    if (npcId === SHELLBANE_NPC_ID && shellbaneByPlayer.get(killer) === npc) {
      stopPearlApproachWatch(killer);
      detachFromArea(npc);
      shellbaneByPlayer.delete(killer);
      const key = pearlFightKeys.get(killer);
      if (key) api.core.TaskManager.cancelTasks?.(key);
      pearlFightKeys.delete(killer);
      endPearlCutscene(killer);
      if (quest.getStage(killer) === STAGE_PEARL_ARRIVED) quest.setStage(killer, STAGE_SHELLBANE_DEAD);
      transformPearlKorel(killer);
    }
  }

  // ==========================================================================
  // Progress varbits and login lifecycle
  // ==========================================================================

  function giveShield(player) {
    if (held(player, TORTUGAN_SHIELD_ITEM_ID) || freeSlots(player) < 1) return;
    player.getInventory().adds(TORTUGAN_SHIELD_ITEM_ID, 1);
    player.setAttribute(FREE_SHIELD_ATTRIBUTE, true);
    syncProgressVarbits(player);
  }

  function syncProgressVarbits(player) {
    const stage = quest.getStage(player);
    const done = repairsDone(player);
    const repairsActive = stage >= STAGE_REPAIRS_GIVEN;
    const trail = quest.isComplete(player) ? 0 : trailProgress(player);
    const packet = player.getPacketSender();
    for (const repair of REPAIRS) {
      const value = (done & repair.bit) !== 0 ? 2 : repairsActive ? 1 : 0;
      packet.sendVarbit(repair.varbit, value);
    }
    // The capture sets each trail varbit to 1 as its step is inspected and
    // clears them all when the quest completes.
    for (let step = 0; step < VARBIT_TRAIL.length; step++) {
      packet.sendVarbit(VARBIT_TRAIL[step], trail > step ? 1 : 0);
    }
    packet.sendVarbit(VARBIT_FREE_SHIELD, freeShieldGiven(player) ? 1 : 0);
  }

  function registerGroundSpawns(player, spawns) {
    const manager = api.getItemOnGroundManager?.();
    if (!manager?.registerLocation || !manager?.getGroundItem) return;
    const privateArea = player.getPrivateArea?.();
    for (const spawn of spawns) {
      const location = new Location(spawn.x, spawn.y, spawn.z);
      if (manager.getGroundItem(player.getUsername(), spawn.itemId, location, privateArea)) continue;
      manager.registerLocation(player, new Item(spawn.itemId, 1), location);
    }
  }

  function ensureMaterialSpawns(player) {
    if (quest.isComplete(player)) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED && stage < STAGE_FLOOPA_MET) {
      registerGroundSpawns(player, SEAWEED_SPAWNS);
    }
    if (stage >= STAGE_REPAIRS_GIVEN && stage < STAGE_REPAIRS_DONE) {
      registerGroundSpawns(player, MATERIAL_SPAWNS);
    }
  }

  /** One-time move from the old 1-33 ladder to the captured 2-44 ladder. */
  function migrateStage(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === true) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, true);
    const legacy = quest.getStage(player);
    if (legacy === 0) return;
    const mapped = new Map([[1, 2], [2, 4], [3, 6], [4, 12], [5, 13], [6, 16], [7, 18],
      [8, 20], [22, 22], [24, 24], [27, 28], [28, 32], [29, 34], [30, 36], [31, 38],
      [32, 40], [33, 44]]).get(legacy);
    if (mapped !== undefined) quest.setStage(player, mapped); // no second reward on legacy completion
  }

  function handleLogin({ player }) {
    migrateStage(player);
    refreshQuestList(player);
    syncProgressVarbits(player);
    ensureIslandTortugan(player);
    ensureMaterialSpawns(player);
    player.getPacketSender().sendVarbit(542, 0);
    const stage = quest.getStage(player);
    if (stage === STAGE_ARRIVED) {
      if (aboard(player)) spawnBoatFloopa(player);
      else if (nearConch(player)) {
        quest.setStage(player, STAGE_DISEMBARKED);
        spawnDockFloopa(player);
      }
    } else if (stage === STAGE_DISEMBARKED) {
      spawnDockFloopa(player);
    } else if (stage === STAGE_PEARL_ARRIVED && nearPearl(player)) {
      beginPearlAssault(player);
    } else if (stage === STAGE_SHELLBANE_DEAD && nearPearl(player)) {
      spawnPearlActors(player);
      transformPearlKorel(player);
    } else if (stage === STAGE_PEARL_BRIEFED && aboard(player)) {
      if (nearPearlMooring(player)) startPearlCutscene(player);
      else startPearlApproachWatch(player);
    }
  }

  /** The login bootstrap re-sends shared varps after login; re-send ours too. */
  function handleBootstrap({ player }) {
    syncProgressVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    removeIslandTortugan(player);
    removeBoatFloopa(player);
    removeDockFloopa(player);
    stopPearlApproachWatch(player);
    const gryphon = caveGryphonByPlayer.get(player);
    if (gryphon) api.removeNpc(gryphon);
    caveGryphonByPlayer.delete(player);
    const shellbane = shellbaneByPlayer.get(player);
    if (shellbane) { detachFromArea(shellbane); api.removeNpc(shellbane); }
    shellbaneByPlayer.delete(player);
    stopPearlFight(player);
    player.getPacketSender().sendVarbit(542, 0);
    trackingAnswer.delete(player);
    cavePrompt.delete(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped Floopa get home and repaid the village's kindness by</str>",
        "<str>repairing the gryphon damage and killing the gryphon in its lair.</str>",
        "<str>I helped Elder Korel defend the Little Pearl and told him about</str>",
        "<str>the strange ship with red sails.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_LEAVING_PEARL) {
      return [
        "<str>I killed the Shellbane gryphon and told Elder Korel about the</str>",
        "<str>strange ship with red sails.</str>",
        "",
        "I should return to <col=800000>Elder Raley</col> and <col=800000>Floopa</col> on the Great Conch.",
      ];
    }
    if (stage >= STAGE_SHELLBANE_DEAD) {
      return [
        "<str>I helped kill the gryphon on the Little Pearl.</str>",
        "",
        "I should talk to <col=800000>Elder Korel</col> about the strange ship.",
      ];
    }
    if (stage >= STAGE_PEARL_ARRIVED) {
      return [
        "<str>I reached the Little Pearl and saw a strange ship with red sails</str>",
        "<str>sailing away.</str>",
        "",
        "I should help deal with the <col=800000>gryphon</col>.",
      ];
    }
    if (stage >= STAGE_PEARL_BRIEFED) {
      return [
        "<str>Another gryphon is attacking the Little Pearl, where the tortugans</str>",
        "<str>lay their eggs.</str>",
        "",
        "I should get a <col=800000>shield</col> from <col=800000>Elder Blunn</col> in the market",
        "and sail to the <col=800000>Little Pearl</col> south east of the Conch.",
      ];
    }
    if (stage >= STAGE_GRYPHON_DEAD) {
      return [
        "<str>I dealt with the Gryphon in its lair.</str>",
        "",
        "I should return to <col=800000>Elder Raley</col> and let him know.",
      ];
    }
    if (stage >= STAGE_CAVE_OPEN) {
      return [
        "<str>I cleared the growth blocking the cave entrance.</str>",
        "",
        "I should head inside and deal with the <col=800000>Gryphon</col>.",
      ];
    }
    if (stage >= STAGE_UNBLOCK_CAVE) {
      return [
        "<str>I followed the gryphon's tracks to a blocked cave entrance.</str>",
        "",
        "I should clear the growth with an <col=800000>axe</col>.",
      ];
    }
    if (stage >= STAGE_TRAIL_FOUND) {
      return [
        "<str>I found the gryphon's tracks in the middle of town.</str>",
        "",
        "I should follow the trail to its lair.",
      ];
    }
    if (stage >= STAGE_TRACKING) {
      return [
        "<str>I offered to track down the gryphon.</str>",
        "",
        "I should pick up its trail somewhere in the middle of town.",
      ];
    }
    if (stage >= STAGE_REPAIRS_DONE) {
      return [
        "<str>I helped Raley by repairing the damage around town.</str>",
        "",
        "I should see if <col=800000>Elder Raley</col> needs help with anything else.",
      ];
    }
    if (stage >= STAGE_REPAIRS_GIVEN) {
      return [
        "<str>Raley gave me a list of repairs detailing the work to do.</str>",
        "",
        "I need <col=800000>jatoba logs</col>, <col=800000>sea shells</col> and",
        "<col=800000>tortugan scutes</col> to repair the damaged spots around town.",
      ];
    }
    if (stage >= STAGE_KOREL_TALKED) {
      return [
        "<str>I took Floopa to the Great Conch, where Elder Korel met us.</str>",
        "<str>He sent her to Elder Raley and allowed me to stay as a tourist.</str>",
        "",
        "I should check on <col=800000>Floopa</col> at <col=800000>Elder Raley's</col> home in",
        "the south east of the Summer Shore.",
      ];
    }
    if (stage >= STAGE_FLOOPA_MET) {
      return [
        "<str>I patched up the injured tortugan, who introduced herself as</str>",
        "<str>Floopa, and she agreed to let me take her home.</str>",
        "",
        "I should use my <col=800000>Boat</col> to take Floopa to the Great Conch,",
        "south east of the Remote Island.",
      ];
    }
    if (stage >= STAGE_BANDAGES_MADE) {
      return [
        "<str>I gathered seaweed and a palm leaf and made makeshift bandages.</str>",
        "",
        "I should see how the <col=800000>Injured Tortugan</col> is doing.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>I encountered an Injured Tortugan on a Remote Island in the</str>",
        "<str>Unquiet Ocean.</str>",
        "",
        "Despite her reluctance, I convinced her to let me help. She asked",
        "for <col=800000>bandages</col> made from <col=800000>seaweed</col> and a",
        "<col=800000>palm leaf</col>.",
      ];
    }
    return [
      "I can start this quest by talking to an <col=800000>Injured Tortugan</col> on a",
      "<col=800000>Remote Island</col> in the Unquiet Ocean.",
      "",
      "I need completion of <col=800000>Pandemonium</col> and level 51 Slayer,",
      "48 Construction, 45 Sailing, 45 Hunter, 40 Woodcutting and",
      "34 Crafting.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.SAILING, SAILING_REWARD_XP);
    skills.addExperiences(Skill.SLAYER, SLAYER_REWARD_XP);
  }

  const TRANSCRIPT_NPC_IDS = new Set([
    ...INJURED_TORTUGAN_NPC_IDS,
    ...FLOOPA_NPC_IDS,
    ...KOREL_NPC_IDS,
    ...RALEY_NPC_IDS,
    ...BLUNN_NPC_IDS,
    ...KRILL_NPC_IDS,
    ...STROM_NPC_IDS,
    ...COCO_NPC_IDS,
    ...MAG_NPC_IDS,
    ...REGGLE_NPC_IDS,
    BOAT_FLOOPA_NPC_ID,
    DOCK_FLOOPA_NPC_ID,
    PEARL_SAILOR_NPC_ID,
  ]);

  api.persistAttribute(REPAIRS_ATTRIBUTE);
  api.persistAttribute(TRAIL_ATTRIBUTE);
  api.persistAttribute(FREE_SHIELD_ATTRIBUTE);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "troubled_tortugans",
    name: "Troubled Tortugans",
    varpId: VARP_TROUBLED_TORTUGANS,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.SAILING.getIndex(), amount: SAILING_REWARD_XP, label: "Sailing" },
      { skillId: Skill.SLAYER.getIndex(), amount: SLAYER_REWARD_XP, label: "Slayer" },
    ],
    otherRewards: ["Access to the Great Conch", "Ability to fight gryphons"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onItemOnItem("Seaweed", "Palm leaf", makeBandages, { noted: false });
  api.onItemOnNpc(handBandagesToTortugan, { noted: false });
  api.onObjectInteraction("Palm", { Shake: shakePalm });
  api.onObjectInteraction("Jatoba tree", { "Chop down": chopJatoba });
  api.onObjectInteraction("Broken fish stall", { Repair: repairObject });
  api.onObjectInteraction("Broken crafting stall", { Repair: repairObject });
  api.onObjectInteraction("Broken crate", { Repair: repairObject });
  api.onObjectInteraction("Broken coconut crate", { Repair: repairObject });
  api.onObjectInteraction("Damaged wall", { Repair: repairObject });
  api.onObjectInteraction("Monument", { Inspect: inspectMonument });
  api.onObjectInteraction("Plant", { Inspect: inspectTerrain });
  api.onObjectInteraction("Rockslide", { Inspect: inspectTerrain });
  api.onObjectInteraction("Cave entrance", { Unblock: unblockCave, Enter: enterCave });
  api.onObjectInteraction("Cave exit", { Exit: exitCave });
  api.onNpcDeath(handleNpcDeath);
  api.onZoneEnter(PEARL_ZONE, handlePearlZoneEnter);
  api.onCustomEvent("sailing:boarded", handleBoarded);
  api.onCustomEvent("sailing:left", handleLeft);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
