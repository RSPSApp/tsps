/**
 * Troubled Tortugans (members).
 *
 * The words come from the "Troubled Tortugans" transcript page (npc-dialogues.json),
 * plus object-interaction lines the wiki has no transcript for. Floopa's Injured
 * Tortugan (14990) exists in npc-spawns.json only at Elder Raley's home, so the
 * Remote Island one is owner-spawned; the two fight NPCs (cave Gryphon 15009 and
 * the Little Pearl Shellbane gryphon 15010) are owner-spawned too.
 *
 * Stages: the stage lives in varbit 18321 "tt" (varp 4961 bits 0-5, found with
 * `lookup-gameval.ts varbit tortug`; the stub's varp 7913 was a placeholder). The
 * cache object transforms pin the numbers used here: the Monument only offers
 * Inspect at values 22-28 (base loc 58445 -> 58446), the tracking plants and
 * rockslides at 24-28 (58449..58470), and the cave flips from Unblock to Enter at
 * 27 (58439 -> 58440/58441). The rest are this plugin's own sequential values
 * (the wiki lists no stage values and no cs2 script writes the varbit): 1 started,
 * 2 bandages made, 3 Floopa met/boards, 4 arrived at the docks, 5 Korel talked
 * (tourist), 6 Raley met, 7 repairs given, 8 repairs done, 22 tracking, 24 trail
 * found, 27 cave cleared, 28 cave Gryphon dead, 29 Little Pearl briefing, 30
 * Little Pearl reached, 31 Shellbane dead, 32 Korel talked, 33 complete.
 *
 * Repairs use the sibling varbits of varp 4961: 18327-18332 (1 = Repair option
 * visible, 2 = repaired) and 18333 for the free shield. Their values are
 * persisted in "troubled-tortugans:*" attributes and re-sent on login and on
 * player:bootstrap-complete, because the runtime only re-sends the stage.
 *
 * Rewards (OSRS Wiki): 1 Quest point, 10,000 Sailing XP and 8,000 Slayer XP
 * (the quest DB row 7106 stores 100000/80000, i.e. the usual x10), plus access
 * to the Great Conch and the ability to fight gryphons.
 *
 * Gaps/approximations:
 * - Pandemonium completion is listed as a start requirement by the wiki but is not
 *   checked by the start gate; the six skill levels are enforced unboosted.
 * - The boat journey's at-sea Floopa variants (whilst-at-sea, when-close-to-the
 *   island, near-the-gangplank) are not played: a plugin file cannot hook the
 *   Sailing boats. Arrival is detected at the Great Conch dock zone instead.
 * - The shield's cape-slot equip gate, the Shellbane gryphon's shield/weight
 *   specials and the cutscene cameras are not simulated.
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
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const woodcutting = require("../../skills/Woodcutting.plugin.js");

  // NPCs (cache ids; NpcIdentifiers comments).
  const INJURED_TORTUGAN_NPC_IDS = new Set([
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
    NpcIdentifiers.ELDER_KOREL, // 14998, docks
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

  // Items (cache ids; ItemIdentifiers comments).
  const SEAWEED_ITEM_ID = ItemIdentifiers.SEAWEED; // 401
  const PALM_LEAF_ITEM_ID = ItemIdentifiers.PALM_LEAF; // 2339
  const MAKESHIFT_BANDAGES_ITEM_ID = ItemIdentifiers.MAKESHIFT_BANDAGES; // 31392
  const TORTUGAN_SCUTE_ITEM_ID = ItemIdentifiers.TORTUGAN_SCUTE; // 31393
  const SEA_SHELL_ITEM_ID = ItemIdentifiers.SEA_SHELL; // 31395
  const LIST_OF_REPAIRS_ITEM_ID = ItemIdentifiers.LIST_OF_REPAIRS; // 31397
  const TORTUGAN_SHIELD_ITEM_ID = ItemIdentifiers.TORTUGAN_SHIELD; // 31398
  const JATOBA_LOGS_ITEM_ID = ItemIdentifiers.JATOBA_LOGS; // 32902

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
  const VARBIT_REPAIR_KRILL_STALL = 18327;
  const VARBIT_REPAIR_KRILL_WALL = 18328;
  const VARBIT_REPAIR_STROM_WALL = 18329;
  const VARBIT_REPAIR_STROM_CRATES = 18330;
  const VARBIT_REPAIR_COCO_STALL = 18331;
  const VARBIT_REPAIR_COCO_CRATES = 18332;
  const VARBIT_FREE_SHIELD = 18333;

  const STAGE_STARTED = 1;
  const STAGE_BANDAGES_MADE = 2;
  const STAGE_FLOOPA_MET = 3;
  const STAGE_ARRIVED = 4;
  const STAGE_KOREL_TALKED = 5;
  const STAGE_RALEY_MET = 6;
  const STAGE_REPAIRS_GIVEN = 7;
  const STAGE_REPAIRS_DONE = 8;
  const STAGE_TRACKING = 22;
  const STAGE_TRAIL_FOUND = 24;
  const STAGE_CAVE_OPEN = 27;
  const STAGE_GRYPHON_DEAD = 28;
  const STAGE_PEARL_BRIEFED = 29;
  const STAGE_PEARL_ARRIVED = 30;
  const STAGE_SHELLBANE_DEAD = 31;
  const STAGE_KOREL_PEARL_TALKED = 32;
  const STAGE_COMPLETE = 33;

  const TRAIL_STEPS = 5; // monument + 4 terrain finds
  const REPAIR_XP = 80; // per repair, OSRS Wiki
  const SAILING_REWARD_XP = 10000; // OSRS Wiki
  const SLAYER_REWARD_XP = 8000; // OSRS Wiki

  // Start skill requirements (all unboosted, OSRS Wiki); Pandemonium completion is separate.
  const REQUIREMENTS = [
    [Skill.SLAYER, 51],
    [Skill.CONSTRUCTION, 48],
    [Skill.SAILING, 45],
    [Skill.HUNTER, 45],
    [Skill.WOODCUTTING, 40],
    [Skill.CRAFTING, 34],
  ];

  const PAGE = "Troubled Tortugans";
  const START_HOOK = "quest:troubled-tortugans:start";
  const REPAIRS_ATTRIBUTE = "troubled-tortugans:repairs";
  const TRAIL_ATTRIBUTE = "troubled-tortugans:trail";
  const FREE_SHIELD_ATTRIBUTE = "troubled-tortugans:free-shield";

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
  const DOCKS_ZONE = { minX: 3175, maxX: 3205, minY: 2358, maxY: 2382, levels: [0] };
  const PEARL_ZONE = { minX: 3338, maxX: 3378, minY: 2183, maxY: 2223, levels: [0] };

  const ISLAND_TORTUGAN_SPAWN = { x: 2958, y: 2606, z: 0 }; // wiki start map
  const CAVE_ENTRY_TILE = { x: 3167, y: 8872, z: 0 }; // inside, beside cave exit 58442
  const CAVE_GRYPHON_SPAWN = { x: 3167, y: 8870, z: 0 };
  const CAVE_EXIT_TILE = { x: 3176, y: 2475, z: 0 }; // in front of the surface entrance
  const SHELLBANE_SPAWN = { x: 3355, y: 2203, z: 0 };

  // Ground material spawns. The cache's ground-items list predates Sailing, so
  // these are registered owner-only while the quest needs them.
  const SEAWEED_SPAWNS = [{ itemId: SEAWEED_ITEM_ID, x: 2959, y: 2601, z: 0 }];
  const MATERIAL_SPAWNS = [
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3162, y: 2414, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3160, y: 2418, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3168, y: 2418, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3172, y: 2400, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3175, y: 2422, z: 0 },
    { itemId: TORTUGAN_SCUTE_ITEM_ID, x: 3176, y: 2404, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3187, y: 2374, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3188, y: 2374, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3189, y: 2374, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3190, y: 2375, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3191, y: 2375, z: 0 },
    { itemId: SEA_SHELL_ITEM_ID, x: 3192, y: 2375, z: 0 },
  ];

  let quest;
  const trackingAnswer = new WeakMap(); // player -> "plant" | "rockslide" | "none"
  const cavePrompt = new WeakMap(); // player -> the Unblock "Enter the cave?" menu is up
  const islandTortuganByPlayer = new WeakMap();
  const caveGryphonByPlayer = new WeakMap();
  const shellbaneByPlayer = new WeakMap();

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

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIREMENTS.every(([skill, level]) => skills.getMaxLevel(skill) >= level);
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

  function selectVariant({ npcId, npc, player }) {
    if (!player) return null;
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
        if (quest.getStage(player) === STAGE_ARRIVED) quest.setStage(player, STAGE_KOREL_TALKED);
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
    const stage = quest.getStage(player);
    if (stage === STAGE_GRYPHON_DEAD
      && text === "Okay, I'll grab one of those shields and set off right away!") {
      quest.setStage(player, STAGE_PEARL_BRIEFED);
      return;
    }
    if (stage === STAGE_SHELLBANE_DEAD
      && KOREL_NPC_IDS.has(npcId)
      && text.startsWith("Very good work, human!")) {
      quest.setStage(player, STAGE_KOREL_PEARL_TALKED);
      return;
    }
    if (stage >= STAGE_KOREL_PEARL_TALKED
      && !quest.isComplete(player)
      && text.startsWith("No, no, no! Thank you")
      && (RALEY_NPC_IDS.has(npcId) || INJURED_TORTUGAN_NPC_IDS.has(npcId) || FLOOPA_NPC_IDS.has(npcId))) {
      quest.complete(player);
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
    if (stage < STAGE_STARTED || stage >= STAGE_FLOOPA_MET || quest.isComplete(player)) return false;
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
    if (stage < STAGE_STARTED || stage >= STAGE_FLOOPA_MET || quest.isComplete(player)) return;
    if (!held(player, MAKESHIFT_BANDAGES_ITEM_ID)) return;
    event.handled = true;
    player.getInventory().deleteNumber(MAKESHIFT_BANDAGES_ITEM_ID, 1);
    quest.setStage(player, STAGE_FLOOPA_MET);
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
      id: NpcIdentifiers.INJURED_TORTUGAN,
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
    if (existing?.isRegistered?.()) return;
    const npc = api.spawnNpc({
      id: SHELLBANE_NPC_ID,
      x: SHELLBANE_SPAWN.x,
      y: SHELLBANE_SPAWN.y,
      z: SHELLBANE_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) shellbaneByPlayer.set(player, npc);
  }

  function beginPearlAssault(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_PEARL_BRIEFED || quest.isComplete(player)) return;
    spawnShellbane(player);
    if (stage === STAGE_PEARL_BRIEFED) quest.setStage(player, STAGE_PEARL_ARRIVED);
  }

  function handleDocksZoneEnter({ player }) {
    if (quest.isComplete(player) || quest.getStage(player) !== STAGE_FLOOPA_MET) return;
    removeIslandTortugan(player);
    quest.setStage(player, STAGE_ARRIVED);
    startTranscript(api, player, NpcIdentifiers.ELDER_KOREL, PAGE, V_ARRIVAL);
  }

  function handlePearlZoneEnter({ player }) {
    if (quest.isComplete(player) || quest.getStage(player) !== STAGE_PEARL_BRIEFED) return;
    beginPearlAssault(player);
    startTranscript(api, player, NpcIdentifiers.ELDER_KOREL_2, PAGE, V_PEARL_ARRIVE);
  }

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (!killer || !npc) return;
    if (npcId === GRYPHON_NPC_ID && caveGryphonByPlayer.get(killer) === npc) {
      caveGryphonByPlayer.delete(killer);
      if (quest.getStage(killer) === STAGE_CAVE_OPEN) quest.setStage(killer, STAGE_GRYPHON_DEAD);
      return;
    }
    if (npcId === SHELLBANE_NPC_ID && shellbaneByPlayer.get(killer) === npc) {
      shellbaneByPlayer.delete(killer);
      if (quest.getStage(killer) === STAGE_PEARL_ARRIVED) quest.setStage(killer, STAGE_SHELLBANE_DEAD);
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
    const packet = player.getPacketSender();
    for (const repair of REPAIRS) {
      const value = (done & repair.bit) !== 0 ? 2 : repairsActive ? 1 : 0;
      packet.sendVarbit(repair.varbit, value);
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

  function handleLogin({ player }) {
    refreshQuestList(player);
    syncProgressVarbits(player);
    ensureIslandTortugan(player);
    ensureMaterialSpawns(player);
  }

  /** The login bootstrap re-sends shared varps after login; re-send ours too. */
  function handleBootstrap({ player }) {
    syncProgressVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    removeIslandTortugan(player);
    const gryphon = caveGryphonByPlayer.get(player);
    if (gryphon) api.removeNpc(gryphon);
    caveGryphonByPlayer.delete(player);
    const shellbane = shellbaneByPlayer.get(player);
    if (shellbane) api.removeNpc(shellbane);
    shellbaneByPlayer.delete(player);
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
    if (stage >= STAGE_KOREL_PEARL_TALKED) {
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
  ]);

  api.persistAttribute(REPAIRS_ATTRIBUTE);
  api.persistAttribute(TRAIL_ATTRIBUTE);
  api.persistAttribute(FREE_SHIELD_ATTRIBUTE);

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
  api.onZoneEnter(DOCKS_ZONE, handleDocksZoneEnter);
  api.onZoneEnter(PEARL_ZONE, handlePearlZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
