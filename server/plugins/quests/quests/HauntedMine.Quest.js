/**
 * Haunted Mine (members).
 *
 * The words come from the "Haunted Mine" transcript page; this plugin supplies the
 * variant selector for the Zealot, the start hook, the prose-condition answers, the
 * Zealot's-key pickpocket, the glowing-fungus mine-cart transport, the water valve and
 * the mischievous ghost, the water-powered lift, the Treus Dayth fight, the
 * crystal-mine key and the crystal outcrop that completes the quest.
 *
 * Stages live on varp 382 ("hauntedmine" in the cache varp dump; the quest's sibling
 * state is varp 383 "hauntedmine_bits"). The captured 1768.bin route (revision 227.1),
 * cross-checked with RuneLite Quest Helper, pins the stage values:
 *   1 started, 3 second entrance found, 5 lift down, 7 Dayth room, 8 Treus appeared,
 *   9 Treus killed, 10 crystal-mine key taken, 11 shard cut/complete. Legacy saves (old
 *   mapping 1-8) are migrated once on login under "haunted-mine:schema".
 * The lever/cart/lift sub-state is persisted in the "quest.haunted_mine.bits"
 * attribute; the cart and lift flags are also mirrored to the real cache varbits in
 * varp 383 (hauntedmine_begincart_fungus 2395, _endcart_fungus 2396,
 * _liftpowerednow 2394, _liftpoweredonce 2393).
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 22,000 Strength XP, a salve shard cut
 * from the outcrop, and the ability to make the Salve amulet (access to the crystal
 * shortcut and Tarn's Lair, noted in the reward lines).
 *
 * Source: OSRS Wiki, "Haunted Mine", "Abandoned Mine" and "Haunted Mine/Quick guide";
 * the words are the "Haunted Mine" wiki transcript page.
 *
 * Captured presentation: interface 144 cart tutorial with actors 3610 and camera tracks,
 * Treus spawn at 2788,4458 (sequence 1437) and the ghost at 2802,4516 walking to the valve.
 *
 * Gaps:
 * - "Transcript:Zealot" (the pickpocket lines and the post-quest scene where he takes
 *   the key back) is not in npc-dialogues.json, so pickpocketing gives the key with
 *   no words and a completed player replays "after-killing-treus-dayth", the closest
 *   variant in the dump.
 * - The flooded chamber is walked across normally (captured route). Cache 241 clips
 *   the one crossing tile; installFloodedChannelFix clears only that BLOCKED_TILE
 *   after each region load, leaving every other terrain flag and object unchanged.
 * - Walking the fungus out through the main-entrance stairs reuses the cart-tunnel
 *   crumble line, which mentions crawling.
 * - A few system lines have no wiki transcript and are authored: the unpowered lift,
 *   the Agility 15 / chisel / Crafting 35 requirements and the full-inventory refusals.
 * - Damp tinderboxes never dry out, and the level-4 chisel crate (4975) has no
 *   placement in this cache, so the chisel must be brought.
 */
module.exports = function registerHauntedMineQuest(api) {
  const {
    Animation,
    CountdownTask,
    ObjectDefinition,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    Sound,
    Sounds,
    ObjectManager,
    RegionManager,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);

  const ZEALOT_NPC_ID = NpcIdentifiers.ZEALOT; // 3611
  const TREUS_DAYTH_NPC_ID = NpcIdentifiers.TREUS_DAYTH; // 3616
  const INNOCENT_LOOKING_KEY_NPC_ID = NpcIdentifiers.INNOCENT_LOOKING_KEY; // 3619
  const MISCHIEVOUS_GHOST_NPC_ID = NpcIdentifiers.MISCHIEVOUS_GHOST; // 3627
  const MINE_CART_NPC_ID = 3610; // the capture's moving mine-cart actor

  const ZEALOTS_KEY_ITEM_ID = ItemIdentifiers.ZEALOTS_KEY; // 4078
  const GLOWING_FUNGUS_ITEM_ID = ItemIdentifiers.GLOWING_FUNGUS; // 4075
  const CRYSTAL_MINE_KEY_ITEM_ID = ItemIdentifiers.CRYSTAL_MINE_KEY; // 4077
  const SALVE_SHARD_ITEM_ID = ItemIdentifiers.SALVE_SHARD; // 4082
  const SALVE_AMULET_ITEM_ID = ItemIdentifiers.SALVE_AMULET; // 4081
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const DAMP_TINDERBOX_ITEM_ID = ItemIdentifiers.DAMP_TINDERBOX; // 4073

  const CART_TUNNEL_OBJECT_IDS = new Set([
    ObjectIdentifiers.CART_TUNNEL, // 4913
    ObjectIdentifiers.CART_TUNNEL_2, // 4914
    ObjectIdentifiers.CART_TUNNEL_3, // 4915
    ObjectIdentifiers.CART_TUNNEL_4, // 4920
    ObjectIdentifiers.CART_TUNNEL_5, // 4921
    ObjectIdentifiers.CART_TUNNEL_6, // 4922
    ObjectIdentifiers.CART_TUNNEL_10, // 29332
    ObjectIdentifiers.CART_TUNNEL_11, // 29333
  ]);
  // Ways out of the mine into the daylight: the cart tunnels and the main stairs.
  const MINE_EXIT_OBJECT_IDS = new Set([
    ObjectIdentifiers.CART_TUNNEL_4, // 4920
    ObjectIdentifiers.CART_TUNNEL_5, // 4921
    ObjectIdentifiers.CART_TUNNEL_6, // 4922
    ObjectIdentifiers.CART_TUNNEL_11, // 29333
    ObjectIdentifiers.STAIRS_28, // 4923
  ]);
  const CRYSTAL_SHORTCUT_EXIT_OBJECT_ID = ObjectIdentifiers.CART_TUNNEL_11; // 29333
  // Ways into the mine: the three cart tunnels and the main entrance stairs.
  const MINE_ENTRANCE_IDS = new Set([
    ObjectIdentifiers.CART_TUNNEL, // 4913
    ObjectIdentifiers.CART_TUNNEL_2, // 4914
    ObjectIdentifiers.CART_TUNNEL_3, // 4915
    ObjectIdentifiers.STAIRS_27, // 4919
  ]);
  const CLIMB_OVER_CART_OBJECT_ID = ObjectIdentifiers.MINE_CART_3; // 4918
  const GLOWING_FUNGUS_OBJECT_IDS = new Set([
    ObjectIdentifiers.GLOWING_FUNGUS_4, // 4932
    ObjectIdentifiers.GLOWING_FUNGUS_5, // 4933
  ]);
  const CRYSTAL_OUTCROP_OBJECT_IDS = new Set([
    ObjectIdentifiers.CRYSTAL_OUTCROP, // 4926
    ObjectIdentifiers.CRYSTAL_OUTCROP_2, // 4927
    ObjectIdentifiers.CRYSTAL_OUTCROP_3, // 4928
  ]);
  const WATER_VALVE_OBJECT_ID = ObjectIdentifiers.WATER_VALVE; // 4924
  const FLOODED_LIFT_OBJECT_ID = ObjectIdentifiers.LIFT_4; // 4942, floors the flooded chamber up to the lift room
  const DAYTH_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRS_29; // 4971, flooded chamber down to Treus Dayth
  const LIFT_DOWN_OBJECT_IDS = new Set([
    ObjectIdentifiers.LIFT, // 4937
    ObjectIdentifiers.LIFT_2, // 4938
    ObjectIdentifiers.LIFT_3, // 4940
  ]);
  const SEARCHABLE_MINE_CART_OBJECT_ID = ObjectIdentifiers.MINE_CART_6; // 4974
  const POINTS_SETTINGS_OBJECT_ID = ObjectIdentifiers.POINTS_SETTINGS; // 4949
  const LEVER_OBJECT_IDS = new Set([
    ObjectIdentifiers.LEVER_26, // 4950
    ObjectIdentifiers.LEVER_27, // 4951
    ObjectIdentifiers.LEVER_28, // 4952
    ObjectIdentifiers.LEVER_29, // 4953
    ObjectIdentifiers.LEVER_30, // 4954
    ObjectIdentifiers.LEVER_31, // 4955
    ObjectIdentifiers.LEVER_32, // 4956
    ObjectIdentifiers.LEVER_33, // 4957
    ObjectIdentifiers.LEVER_35, // 4959
    ObjectIdentifiers.LEVER_36, // 4960
    ObjectIdentifiers.LEVER_37, // 4961
  ]);
  const BOSS_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_137; // 4962
  const LARGE_DOOR_OBJECT_IDS = new Set([
    ObjectIdentifiers.LARGE_DOOR_38, // 4963
    ObjectIdentifiers.LARGE_DOOR_39, // 4964
  ]);

  // The two searchable level-4 carts: the central start cart by the fungus pool and the
  // northern cart by Ladder 10 that the fungus is sent to.
  const CART_START_TILE = { x: 2778, y: 4506 };
  const CART_END_TILE = { x: 2774, y: 4537 };
  const LIFT_ROOM_TILE = { x: 2807, y: 4492 };
  const LEVEL_6_LIGHT_LEVEL = 0;
  const FLOODED_CHANNEL_TILE = { x: 2725, y: 4453 };
  const FLOODED_CHANNEL_REGION = 10821;

  // Captured cart tutorial (interface 144) and its cart actors/cameras.
  const CART_CAMERA_START = [[2777, 4511, 400], [2778, 4506, 100]];
  const CART_CAMERA_SLOW = [[2777, 4514, 400], [2778, 4509, 100]];
  const CART_CAMERA_END = [[2776, 4539, 400], [2779, 4535, 100]];
  const CART_CAMERA_END_SLOW = [[2776, 4539, 400], [2776, 4535, 100]];
  const CART_ONE_START = { x: 2778, y: 4507 };
  const CART_TWO_START = { x: 2779, y: 4535 };
  const TREUS_CAMERA = [[2788, 4454, 400], [2788, 4458, 80]];
  const TREUS_CAMERA_CLOSE = [[2788, 4454, 400], [2788, 4455, 80]];
  const TREUS_CAMERA_WIDE = [[2782, 4455, 800], [2788, 4455, 80]];
  const TREUS_TILE = { x: 2788, y: 4458 };
  const GHOST_START = { x: 2802, y: 4516 };
  const GHOST_VALVE = { x: 2807, y: 4496 };
  const GHOST_PATH = (() => {
    // Captured 93377-93575: 15 tiles north, then 5 diagonal steps to the valve.
    const path = [];
    const diagonalStartY = GHOST_VALVE.y + 5;
    for (let y = GHOST_START.y - 1; y >= diagonalStartY; y--) path.push({ x: GHOST_START.x, y });
    for (let step = 1; step <= 5; step++) path.push({ x: GHOST_START.x + step, y: diagonalStartY - step });
    return path;
  })();


  const AGILITY_CART_REQUIREMENT = 15;
  const CRAFTING_SHARD_REQUIREMENT = 35;
  /** Captured timing: ghost appears 20 ticks after the valve, reaches it 21 ticks later. */
  const GHOST_CLOSE_TICKS = 21;
  /** Ticks the three lift messages occupy before the tinderbox line joins them. */
  const LIFT_MESSAGE_TICKS = 4;
  /** Ticks between opening the valve and the captured ghost appearing. */
  const GHOST_APPEAR_TICKS = 20;

  const VARP_HAUNTED_MINE = 382; // "hauntedmine"
  const VARBIT_LIFT_POWERED_ONCE = 2393; // hauntedmine_liftpoweredonce (varp 383 bits 9)
  const VARBIT_LIFT_POWERED_NOW = 2394; // hauntedmine_liftpowerednow (varp 383 bits 10)
  const VARBIT_BEGINCART_FUNGUS = 2395; // hauntedmine_begincart_fungus (varp 383 bits 11)
  const VARBIT_ENDCART_FUNGUS = 2396; // hauntedmine_endcart_fungus (varp 383 bits 12)
  const VARBIT_HEARD_ABOUT_KEY = 2397; // hauntedmine_heardaboutkey (varp 383 bit 21)

  // Captured 1768.bin: start 1, mine entered 3, lift down 5, Dayth room 7,
  // key attempt 8, Dayth killed 9, crystal key taken 10, crystal cut/complete 11.
  const STAGE_STARTED = 1;
  const STAGE_SECOND_ENTRANCE = 3;
  const STAGE_LIFT_DOWN = 5;
  const STAGE_TREUS_ROOM = 7;
  const STAGE_TREUS_ENCOUNTERED = 8;
  const STAGE_TREUS_DEAD = 9;
  const STAGE_KEY_TAKEN = 10;
  const STAGE_COMPLETE = 11;

  const BITS_ATTRIBUTE = "quest.haunted_mine.bits";
  const BIT_FUNGUS_IN_CART_START = 1 << 0;
  const BIT_FUNGUS_IN_CART_END = 1 << 1;
  const BIT_VALVE_KEY_USED = 1 << 2;
  const BIT_VALVE_OPEN = 1 << 3;
  const BIT_LIFT_POWERED_ONCE = 1 << 4;
  const BIT_REACHED_DEPTHS = 1 << 5;
  const BIT_GHOST_SEEN = 1 << 6;
  const BIT_PUZZLE_STARTED = 1 << 7;
  const BIT_CART_TUTORIAL_DONE = 1 << 8;

  const SCHEMA_ATTRIBUTE = "haunted-mine:schema";
  const SCHEMA_VERSION = 1;
  const LEVERS_ATTRIBUTE = "haunted-mine:levers";

  // Interface 144 is the points/track panel. Component 155 is its Start button.
  const POINTS_SETTINGS_GROUP = 144;
  const POINTS_SETTINGS_TARGET_UID = (164 << 16) | 16;
  const POINTS_SETTINGS_START_BUTTON = (POINTS_SETTINGS_GROUP << 16) | 155;

  // Levers A-H each toggle the captured cache varbit for that junction. The physical A and B
  // levers are crossed in the cache: object A drives varbit HAUNTEDMINE_LEVER_B (2385) and
  // object B drives HAUNTEDMINE_LEVER_A (2386), as Quest Helper's leverA/leverB conditions do.
  const LEVER_VARBIT_BY_OBJECT = new Map([
    [ObjectIdentifiers.LEVER_26, 2385], // A (varbit B)
    [ObjectIdentifiers.LEVER_27, 2386], // B (varbit A)
    [ObjectIdentifiers.LEVER_28, 2387], // C
    [ObjectIdentifiers.LEVER_29, 2388], // D
    [ObjectIdentifiers.LEVER_30, 2389], // E
    [ObjectIdentifiers.LEVER_31, 2390], // I
    [ObjectIdentifiers.LEVER_32, 2391], // J
    [ObjectIdentifiers.LEVER_33, 2392], // K
  ]);
  // Quest Helper's lever route: A, B, E and I on; C, D, J and K off.
  /*
   * Haunted Mine's levels are separate z0 map areas, so ClimbLinks cannot pair them.
   * These are the captured 1768 landings for the cart/fungus/valve ladders.
   */
  const HAUNTED_LADDER_LINKS = new Map([
    ['3422,9625', { down: { x: 2783, y: 4569 } }],
    ['2782,4569', { up: { x: 3421, y: 9625 } }],
    ['2798,4567', { down: { x: 2734, y: 4504 } }],
    ['2734,4503', { up: { x: 2798, y: 4568 } }],
    ['2725,4486', { down: { x: 2789, y: 4487 } }],
    ['2789,4486', { up: { x: 2725, y: 4487 } }],
    ['3413,9633', { down: { x: 2772, y: 4577 } }],
    ['2797,4599', { down: { x: 2733, y: 4534 } }],
    ['2733,4535', { up: { x: 2798, y: 4599 } }],
    ['2710,4540', { down: { x: 2774, y: 4539 } }],
    ['2774,4540', { up: { x: 2710, y: 4539 } }],
    ['2732,4529', { down: { x: 2796, y: 4528 } }],
  ]);

  // Captured stair transitions missing from LocTeleports (4971 Walk-down).
  const HAUNTED_STAIR_LINKS = new Map([
    ['4971:2746,4436', { down: { x: 2811, y: 4454 } }],
    ['4971:2692,4436', { down: { x: 2758, y: 4454 } }],
    ['4973:2812,4452', { up: { x: 2750, y: 4437 } }],
  ]);

  const LEVER_SOLUTION = new Map([
    [2386, 1], [2385, 1], [2387, 0], [2388, 0],
    [2389, 1], [2390, 1], [2391, 0], [2392, 0],
  ]);

  const PAGE = "Haunted Mine";
  const START_HOOK = "quest:haunted-mine:start";

  // Zealot variants.
  const V_START = "starting-out";
  const V_TALK_AGAIN = "starting-out-talking-to-the-zealot-again";
  const V_SECOND_ENTRANCE = "starting-out-talking-to-the-zealot-after-finding-the-second-entrance";
  const V_MET_TREUS = "starting-out-talking-to-the-zealot-after-encountering-treus-dayth";
  const V_KILLED_TREUS = "starting-out-talking-to-the-zealot-after-killing-treus-dayth";
  // Inside-the-mine action variants.
  const V_FUNGUS_PICK = "inside-the-mine-picking-the-glowing-fungus";
  const V_FUNGUS_DROP = "inside-the-mine-dropping-the-glowing-fungus";
  const V_FUNGUS_EXIT = "inside-the-mine-exiting-the-mine-via-the-cart-tunnel-with-the-glowing-fungus";
  const V_FUNGUS_TELEPORT = "inside-the-mine-teleporting-out-with-the-glowing-fungus";
  const V_LEVER = "inside-the-mine-pulling-track-levers";
  const V_CART_MOVED = "inside-the-mine-after-moving-the-cart-with-glowing-fungus-to-the-correct-position";
  const V_LARGE_DOOR = "inside-the-mine-attempting-to-open-the-large-door";
  const V_RETRIEVE = "inside-the-mine-retrieving-the-glowing-fungus";
  const V_PLACE_BACK = "inside-the-mine-retrieving-the-glowing-fungus-attempting-to-place-the-fungus-back-in-the-minecart";
  const V_VALVE = "inside-the-mine-turning-the-water-valve";
  const V_GHOST_WINS = "inside-the-mine-mischievous-ghost-appearing-losing-the-race-to-the-ghost";
  const V_LIFT = "inside-the-mine-taking-the-lift";
  const V_LIFT_TINDERBOX = "inside-the-mine-taking-the-lift-if-the-player-has-a-tinderbox-in-their-inventory";
  const V_LIFT_NO_FUNGUS = "inside-the-mine-taking-the-lift-going-down-to-the-sixth-level-without-the-fungus";
  const V_TAKE_KEY = "inside-the-mine-attempting-to-take-the-innocent-looking-key";
  const V_KEY_WHILE_TREUS = "inside-the-mine-attempting-to-take-the-innocent-looking-key-trying-to-take-the-key-while-treus-dayth-is-present";
  const V_TREUS_KILLED = "inside-the-mine-upon-killing-treus-dayth";
  const V_TAKE_CRYSTAL_KEY = "inside-the-mine-taking-the-crystal-mine-key";
  const V_KEY_AGAIN = "inside-the-mine-taking-the-crystal-mine-key-trying-to-take-the-key-again";
  const V_LEAVE_BEFORE_SHARD = "inside-the-mine-taking-the-crystal-mine-key-trying-to-leave-through-the-cart-tunnel-before-cutting-a-shard";
  const V_CUT = "inside-the-mine-chiseling-a-crystal-outcrop";

  // Condition step ids on the "Haunted Mine" page.
  const C_BEFORE_SIXTH_LEVEL = "ZMc1L2";
  const C_AFTER_SIXTH_LEVEL = "qfcjFk";
  const C_AFTER_VALVE = "1XvLbS";
  const C_VALVE_LOCKED = "9rwlRu";
  const C_VALVE_UNLOCKED = "u2Bebu";
  const C_VALVE_CLOSED = "Pqa1M3";
  const C_NO_LIGHT = "6VVRI1";
  const C_HAS_LIGHT = "cq3L1v";
  const MY_CONDITION_IDS = new Set([
    C_BEFORE_SIXTH_LEVEL,
    C_AFTER_SIXTH_LEVEL,
    C_AFTER_VALVE,
    C_VALVE_LOCKED,
    C_VALVE_UNLOCKED,
    C_VALVE_CLOSED,
    C_NO_LIGHT,
    C_HAS_LIGHT,
  ]);

  // Action/message step ids on the "Haunted Mine" page.
  const A_RECEIVE_FUNGUS = "Rx786B"; // receive glowing fungus
  const A_KEY_FLOATS = "gGSELk";
  const A_TREUS_APPEARS = "jQG-HE";
  const A_VALVE_OPENED = "TbCdkn"; // "You open the valve. Water begins to flow..."
  const A_COMPLETE = "mFurEC"; // "Congratulations! Quest complete!"

  let quest;

  /** Live owner-only spawns/timers per player, never persisted. */
  const liveTreus = new WeakMap();
  const liveGhost = new WeakMap();
  const ghostTimer = new WeakMap();
  const liveCarts = new WeakMap();

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function clearBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) & ~bit);
  }

  function levers(player) {
    return Number(player.getAttribute(LEVERS_ATTRIBUTE)) || 0;
  }

  function leverOn(player, varbitId) {
    return (levers(player) & (1 << (varbitId - 2385))) !== 0;
  }

  function toggleLever(player, varbitId) {
    const bit = 1 << (varbitId - 2385);
    player.setAttribute(LEVERS_ATTRIBUTE, levers(player) ^ bit);
    player.getPacketSender().sendVarbit(varbitId, leverOn(player, varbitId) ? 1 : 0);
  }

  function leversSolved(player) {
    for (const [varbitId, value] of LEVER_SOLUTION) {
      if ((leverOn(player, varbitId) ? 1 : 0) !== value) return false;
    }
    return true;
  }

  /** Old saves used 1-8 with different meanings; map them before any reward can run. */
  const LEGACY_STAGE = new Map([[1, 1], [2, 1], [3, 3], [4, 3], [5, 8], [6, 9], [7, 10], [8, 11]]);

  function migrateSave(player) {
    if ((Number(player.getAttribute(SCHEMA_ATTRIBUTE)) || 0) >= SCHEMA_VERSION) return;
    const stage = quest.getStage(player);
    const migrated = LEGACY_STAGE.get(stage);
    if (migrated !== undefined && migrated !== stage) quest.setStage(player, migrated);
    player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
  }

  function markNewSave(player) {
    player.setAttribute(SCHEMA_ATTRIBUTE, SCHEMA_VERSION);
  }

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const hasFungus = (player) => held(player, GLOWING_FUNGUS_ITEM_ID);
  const hasCrystalKey = (player) => held(player, CRYSTAL_MINE_KEY_ITEM_ID);
  const hasPortableLight = (player) => held(player, TINDERBOX_ITEM_ID);

  function liftPowered(player) {
    return hasBit(player, BIT_VALVE_OPEN) || hasBit(player, BIT_LIFT_POWERED_ONCE);
  }

  function atTile(location, tile) {
    return location?.getX?.() === tile.x && location?.getY?.() === tile.y;
  }

  /** Adds one item, dropping it on the player's tile when there is no space. */
  function giveItem(player, itemId) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() > 0) {
      inventory.adds(itemId, 1);
      return;
    }
    const location = player.getLocation();
    api
      .getItemOnGroundManager()
      .registerLocation(
        player,
        new Item(itemId, 1),
        new Location(location.getX(), location.getY(), location.getZ())
      );
    player.sendMessage("You don't have enough inventory space, so it drops to the ground.");
  }

  /** Mirrors the persisted sub-state to the cache's hauntedmine_bits varbits. */
  function sendStateVarps(player) {
    const packet = player.getPacketSender();
    packet.sendVarbit(VARBIT_LIFT_POWERED_ONCE, hasBit(player, BIT_LIFT_POWERED_ONCE) ? 1 : 0);
    packet.sendVarbit(VARBIT_LIFT_POWERED_NOW, hasBit(player, BIT_VALVE_OPEN) ? 1 : 0);
    packet.sendVarbit(VARBIT_BEGINCART_FUNGUS, hasBit(player, BIT_FUNGUS_IN_CART_START) ? 1 : 0);
    packet.sendVarbit(VARBIT_ENDCART_FUNGUS, hasBit(player, BIT_FUNGUS_IN_CART_END) ? 1 : 0);
    packet.sendVarbit(VARBIT_HEARD_ABOUT_KEY, quest.getStage(player) >= STAGE_STARTED ? 1 : 0);
    for (const varbitId of LEVER_SOLUTION.keys()) {
      packet.sendVarbit(varbitId, leverOn(player, varbitId) ? 1 : 0);
    }
  }

  // ==========================================================================
  // Zealot dialogue
  // ==========================================================================

  /** Which transcript variant the Zealot plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    if (npcId !== ZEALOT_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_STARTED) sendStateVarps(player);
    if (stage >= STAGE_TREUS_DEAD) return V_KILLED_TREUS; // no post-quest variant in the dump
    if (stage >= STAGE_TREUS_ENCOUNTERED) return V_MET_TREUS;
    if (stage >= STAGE_SECOND_ENTRANCE) return V_SECOND_ENTRANCE;
    if (stage >= STAGE_STARTED) return V_TALK_AGAIN;
    return V_START;
  }

  /** Answers the page's gameplay conditions; other pages get null. */
  function answerCondition({ player, stepId }) {
    if (!MY_CONDITION_IDS.has(stepId)) return null;
    if (stepId === C_BEFORE_SIXTH_LEVEL) return !hasBit(player, BIT_REACHED_DEPTHS);
    if (stepId === C_AFTER_SIXTH_LEVEL) return hasBit(player, BIT_REACHED_DEPTHS);
    if (stepId === C_AFTER_VALVE) {
      return hasBit(player, BIT_VALVE_KEY_USED) && !hasBit(player, BIT_REACHED_DEPTHS);
    }
    if (stepId === C_VALVE_LOCKED) return !hasBit(player, BIT_VALVE_KEY_USED);
    if (stepId === C_VALVE_UNLOCKED) return hasBit(player, BIT_VALVE_KEY_USED);
    if (stepId === C_VALVE_CLOSED) return false;
    if (stepId === C_NO_LIGHT) return !hasPortableLight(player);
    if (stepId === C_HAS_LIGHT) return hasPortableLight(player);
    return null;
  }

  /** "Yes." starts the quest. */
  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== ZEALOT_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === 0) {
      quest.setStage(player, STAGE_STARTED);
      markNewSave(player);
      sendStateVarps(player);
    }
  }

  // ==========================================================================
  // Treus Dayth and the mischievous ghost
  // ==========================================================================

  function spawnTreus(player) {
    const existing = liveTreus.get(player);
    if (existing) return;
    const treus = api.spawnNpc({
      id: TREUS_DAYTH_NPC_ID,
      x: TREUS_TILE.x,
      y: TREUS_TILE.y,
      z: LEVEL_6_LIGHT_LEVEL,
      wanderRadius: 6,
      owner: player,
      ownerOnly: true,
    });
    if (!treus) return;
    liveTreus.set(player, treus);
    treus.performAnimation?.(new Animation(1437));
    Scenes.camera(player, TREUS_CAMERA[0], TREUS_CAMERA[1], { rate: 0, rate2: 100 });
    Scenes.later(player, 2, () => Scenes.camera(player, TREUS_CAMERA_CLOSE[0], TREUS_CAMERA_CLOSE[1], { rate: 1, rate2: 50 }));
    Scenes.later(player, 4, () => Scenes.camera(player, TREUS_CAMERA_WIDE[0], TREUS_CAMERA_WIDE[1], { rate: 1, rate2: 50 }));
    Scenes.later(player, 10, () => player.getPacketSender().sendCameraReset());
  }

  function removeTreus(player) {
    const treus = liveTreus.get(player);
    if (treus) api.removeNpc(treus);
    liveTreus.delete(player);
    player.getPacketSender().sendCameraReset();
  }

  function stopGhost(player) {
    const timer = ghostTimer.get(player);
    if (timer) {
      timer.stop();
      ghostTimer.delete(player);
    }
    Scenes.cancel(player);
    const ghost = liveGhost.get(player);
    if (ghost) api.removeNpc(ghost);
    liveGhost.delete(player);
  }

  function spawnGhost(player) {
    const ghost = api.spawnNpc({
      id: MISCHIEVOUS_GHOST_NPC_ID,
      x: GHOST_START.x,
      y: GHOST_START.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (!ghost) return;
    liveGhost.set(player, ghost);
    ghost.forceChat?.("Ooooo Wooooo Woo");
    ghost.performAnimation?.(new Animation(5478));
    GHOST_PATH.forEach((tile, index) => {
      Scenes.later(player, index + 1, () => {
        if (liveGhost.get(player) !== ghost) return;
        ghost.moveTo(new Location(tile.x, tile.y, 0));
        if (index % 4 === 3) ghost.performAnimation?.(new Animation(index % 8 === 3 ? 5794 : 5795));
      });
    });
  }

  /** Starts the valve race: the ghost appears and shuts the water off shortly after. */
  function scheduleGhost(player) {
    stopGhost(player);
    if (!CountdownTask || !TaskManager) return;
    spawnGhost(player);
    if (!hasBit(player, BIT_GHOST_SEEN)) setBit(player, BIT_GHOST_SEEN);
    const timer = new CountdownTask(player, GHOST_CLOSE_TICKS, () => closeValve(player));
    ghostTimer.set(player, timer);
    TaskManager.submit(timer);
  }

  /** Waits for the valve's own messages to finish before the ghost's line takes over. */
  function scheduleGhostSoon(player) {
    if (CountdownTask && TaskManager) {
      TaskManager.submit(new CountdownTask(player, GHOST_APPEAR_TICKS, () => scheduleGhost(player)));
      return;
    }
    scheduleGhost(player);
  }

  function closeValve(player) {
    ghostTimer.delete(player);
    const ghost = liveGhost.get(player);
    if (ghost) api.removeNpc(ghost);
    liveGhost.delete(player);
    if (player.isRegistered?.() === false || hasBit(player, BIT_REACHED_DEPTHS)) return;
    clearBit(player, BIT_VALVE_OPEN);
    sendStateVarps(player);
    startTranscript(api, player, MISCHIEVOUS_GHOST_NPC_ID, PAGE, V_GHOST_WINS);
  }

  function handleNpcDeath(event) {
    if (event.npcId !== TREUS_DAYTH_NPC_ID) return;
    const killer = event.killer?.isPlayer?.() ? event.killer : null;
    if (!killer || liveTreus.get(killer) !== event.npc) return;
    liveTreus.delete(killer);
    if (quest.getStage(killer) < STAGE_TREUS_DEAD) {
      quest.setStage(killer, STAGE_TREUS_DEAD);
    }
    startTranscript(api, killer, TREUS_DAYTH_NPC_ID, PAGE, V_TREUS_KILLED);
  }

  // ==========================================================================
  // NPC interactions
  // ==========================================================================

  /** Steals the Zealot's key once the quest has been started. */
  function pickpocketZealot(event) {
    const { player, npcId } = event;
    if (npcId !== ZEALOT_NPC_ID) return false;
    if (!quest.isStarted(player) || quest.isComplete(player)) return false;
    if (hasBit(player, BIT_VALVE_KEY_USED) || held(player, ZEALOTS_KEY_ITEM_ID)) return false;
    giveItem(player, ZEALOTS_KEY_ITEM_ID);
    player.getPacketSender().sendVarbit(VARBIT_HEARD_ABOUT_KEY, 1);
  }

  /** Take on the innocent-looking key: first take wakes Treus; later takes claim it. */
  function takeInnocentKey(event) {
    const { player, npcId } = event;
    if (npcId !== INNOCENT_LOOKING_KEY_NPC_ID) return false;
    if (hasCrystalKey(player) || quest.isComplete(player)) {
      startTranscript(api, player, INNOCENT_LOOKING_KEY_NPC_ID, PAGE, V_KEY_AGAIN);
      return;
    }
    if (liveTreus.has(player)) {
      startTranscript(api, player, INNOCENT_LOOKING_KEY_NPC_ID, PAGE, V_KEY_WHILE_TREUS);
      return;
    }
    if (quest.getStage(player) >= STAGE_TREUS_DEAD) {
      giveItem(player, CRYSTAL_MINE_KEY_ITEM_ID);
      if (quest.getStage(player) < STAGE_KEY_TAKEN) quest.setStage(player, STAGE_KEY_TAKEN);
      startTranscript(api, player, INNOCENT_LOOKING_KEY_NPC_ID, PAGE, V_TAKE_CRYSTAL_KEY);
      return;
    }
    startTranscript(api, player, INNOCENT_LOOKING_KEY_NPC_ID, PAGE, V_TAKE_KEY);
  }

  // ==========================================================================
  // Transcript action/message steps
  // ==========================================================================

  function handleDialogueAction(event) {
    const { player, stepId } = event;
    // Message steps carry the wiki's stage directions; side effects only, the
    // NpcDialogues runtime still prints the line.
    if (event.kind === "message") {
      if (stepId === A_VALVE_OPENED) {
        setBit(player, BIT_VALVE_OPEN);
        sendStateVarps(player);
        if (!hasBit(player, BIT_REACHED_DEPTHS)) scheduleGhostSoon(player);
      }
      return;
    }
    if (stepId === A_RECEIVE_FUNGUS) {
      event.handled = true;
      clearBit(player, BIT_FUNGUS_IN_CART_START);
      clearBit(player, BIT_FUNGUS_IN_CART_END);
      sendStateVarps(player);
      giveItem(player, GLOWING_FUNGUS_ITEM_ID);
      return;
    }
    if (stepId === A_KEY_FLOATS) {
      event.handled = true;
      player.sendMessage(String(event.text ?? ""));
      return;
    }
    if (stepId === A_TREUS_APPEARS) {
      event.handled = true;
      player.sendMessage(String(event.text ?? ""));
      spawnTreus(player);
      if (quest.getStage(player) < STAGE_TREUS_ENCOUNTERED) {
        quest.setStage(player, STAGE_TREUS_ENCOUNTERED);
      }
      return;
    }
    if (stepId === A_COMPLETE) {
      event.handled = true;
      if (!quest.isComplete(player) && quest.getStage(player) < STAGE_KEY_TAKEN) return;
      if (player.getInventory().getFreeSlots() < 1) {
        player.sendMessage("You don't have enough inventory space to cut a shard.");
        return;
      }
      // The outcrop stays cuttable after the quest; only completion is once-only.
      player.getInventory().adds(SALVE_SHARD_ITEM_ID, 1);
      if (!quest.isComplete(player)) quest.complete(player);
    }
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  /** Mirrors the player to the tile past a blocking object (the mine cart). */
  function stepPast(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.getX();
    const dy = current.getY() - location.getY();
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.getX() - (dx >= 0 ? 1 : -1), location.getY(), current.getZ())
        : new Location(location.getX(), location.getY() - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  function climbOverCart(event) {
    const { player, location } = event;
    event.handled = true;
    if (player.getSkillManager().getCurrentLevel(Skill.AGILITY) < AGILITY_CART_REQUIREMENT) {
      player.sendMessage("You need an Agility level of 15 to climb over this cart.");
      return;
    }
    stepPast(player, location);
  }

  function pickFungus(event) {
    const { player } = event;
    event.handled = true;
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space to pick the fungus.");
      return;
    }
    player.getInventory().adds(GLOWING_FUNGUS_ITEM_ID, 1);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_FUNGUS_PICK);
  }

  function cutCrystal(event) {
    const { player } = event;
    if (!quest.isComplete(player) &&
        (!quest.isStarted(player) || quest.getStage(player) < STAGE_KEY_TAKEN)) {
      event.handled = true;
      return;
    }
    event.handled = true;
    if (!held(player, CHISEL_ITEM_ID)) {
      player.sendMessage("You need a chisel to cut a shard from the crystal.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < CRAFTING_SHARD_REQUIREMENT) {
      player.sendMessage("You need a Crafting level of 35 to cut a shard from the crystal.");
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space to cut a shard.");
      return;
    }
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_CUT);
  }

  function pullLever(event) {
    const { player, objectId } = event;
    const varbitId = LEVER_VARBIT_BY_OBJECT.get(objectId);
    if (varbitId === undefined) return;
    if (!quest.isStarted(player) || quest.isComplete(player) || quest.getStage(player) >= STAGE_LIFT_DOWN) return;
    event.handled = true;
    toggleLever(player, varbitId);
    player.sendMessage("You pull the lever. The old points creak into place.");
    tryMoveCart(player);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_LEVER);
  }

  /** Opens the cache's points-settings panel (interface 144). */
  function checkPointsSettings(event) {
    const { player } = event;
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    event.handled = true;
    player.getPacketSender().sendSubInterface(POINTS_SETTINGS_TARGET_UID, POINTS_SETTINGS_GROUP, 1);
  }

  function startPointsPuzzle(event) {
    const { player } = event;
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    setBit(player, BIT_PUZZLE_STARTED);
    if (!hasBit(player, BIT_CART_TUTORIAL_DONE)) {
      startCartTutorial(player);
      return;
    }
    player.getPacketSender().closeInterface(POINTS_SETTINGS_GROUP);
    player.sendMessage("You start the track: pull the levers until the points line up.");
    tryMoveCart(player);
  }

  function spawnCart(player, tile) {
    const cart = api.spawnNpc({
      id: MINE_CART_NPC_ID,
      x: tile.x,
      y: tile.y,
      z: 0,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (cart) {
      const carts = liveCarts.get(player) ?? [];
      carts.push(cart);
      liveCarts.set(player, carts);
    }
    return cart;
  }

  function removeCarts(player) {
    for (const cart of liveCarts.get(player) ?? []) {
      if (cart?.isRegistered?.()) api.removeNpc(cart);
    }
    liveCarts.delete(player);
  }

  /**
   * The captured interface-144 tutorial: two cart actors move along the junctions while
   * the camera frames each end of the track.
   */
  function startCartTutorial(player) {
    setBit(player, BIT_CART_TUTORIAL_DONE);
    Scenes.camera(player, CART_CAMERA_START[0], CART_CAMERA_START[1], { rate: 0, rate2: 100 });
    const first = spawnCart(player, CART_ONE_START);
    if (first?.getMovementQueue) {
      for (let y = CART_ONE_START.y + 1; y <= CART_ONE_START.y + 3; y++) {
        first.getMovementQueue().addFirstStep(new Location(CART_ONE_START.x, y, 0));
      }
    }
    Scenes.later(player, 2, () => Scenes.camera(player, CART_CAMERA_SLOW[0], CART_CAMERA_SLOW[1], { rate: 1, rate2: 10 }));
    Scenes.later(player, 5, () => {
      if (first?.isRegistered?.()) api.removeNpc(first);
      Scenes.camera(player, CART_CAMERA_END[0], CART_CAMERA_END[1], { rate: 0, rate2: 100 });
      const second = spawnCart(player, CART_TWO_START);
      if (second?.getMovementQueue) {
        for (let x = CART_TWO_START.x - 1; x >= CART_TWO_START.x - 3; x--) {
          second.getMovementQueue().addFirstStep(new Location(x, CART_TWO_START.y, 0));
        }
      }
      Scenes.later(player, 1, () => Scenes.camera(player, CART_CAMERA_END_SLOW[0], CART_CAMERA_END_SLOW[1], { rate: 1, rate2: 10 }));
    });
    Scenes.later(player, 9, () => {
      removeCarts(player);
      player.getPacketSender().sendCameraReset().closeInterface(POINTS_SETTINGS_GROUP);
      startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_CART_MOVED);
      tryMoveCart(player);
    });
  }

  /** Sends a loaded cart across once the panel is started and the levers match. */
  function tryMoveCart(player) {
    if (!hasBit(player, BIT_PUZZLE_STARTED)) return false;
    if (!hasBit(player, BIT_FUNGUS_IN_CART_START) || hasBit(player, BIT_FUNGUS_IN_CART_END)) return false;
    if (!leversSolved(player)) return false;
    clearBit(player, BIT_FUNGUS_IN_CART_START);
    setBit(player, BIT_FUNGUS_IN_CART_END);
    sendStateVarps(player);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_CART_MOVED);
    return true;
  }

  /** Search the cart holding the fungus, take it back out. */
  function searchCart(event) {
    const { player, object } = event;
    const atEnd = atTile(object?.getLocation?.(), CART_END_TILE);
    const laden = atEnd ? hasBit(player, BIT_FUNGUS_IN_CART_END) : hasBit(player, BIT_FUNGUS_IN_CART_START);
    if (!laden) return;
    event.handled = true;
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_RETRIEVE);
  }

  /** A key unlocks the valve; a bare turn only works once the key has been used. */
  function turnValve(event) {
    event.handled = true;
    startTranscript(api, event.player, ZEALOT_NPC_ID, PAGE, V_VALVE);
  }

  function useKeyOnValve(event) {
    const { player } = event;
    event.handled = true;
    if (hasBit(player, BIT_VALVE_KEY_USED)) return;
    player.getInventory().deleteNumber(ZEALOTS_KEY_ITEM_ID, 1);
    setBit(player, BIT_VALVE_KEY_USED);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_VALVE);
  }

  /** Takes the water-powered lift down to the flooded level. */
  function takeLiftDown(event) {
    const { player } = event;
    event.handled = true;
    if (!liftPowered(player)) {
      player.sendMessage("The lift doesn't seem to be working. Water must need to flow through the mechanism.");
      return;
    }
    if (!hasFungus(player)) {
      startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_LIFT_NO_FUNGUS);
      return;
    }
    stopGhost(player);
    setBit(player, BIT_REACHED_DEPTHS);
    setBit(player, BIT_LIFT_POWERED_ONCE);
    clearBit(player, BIT_VALVE_OPEN);
    sendStateVarps(player);
    if (quest.getStage(player) < STAGE_LIFT_DOWN) quest.setStage(player, STAGE_LIFT_DOWN);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_LIFT);
    if (held(player, TINDERBOX_ITEM_ID)) {
      player.getInventory().deleteNumber(TINDERBOX_ITEM_ID, 1);
      player.getInventory().adds(DAMP_TINDERBOX_ITEM_ID, 1);
      if (CountdownTask && TaskManager) {
        TaskManager.submit(
          new CountdownTask(player, LIFT_MESSAGE_TICKS, () =>
            startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_LIFT_TINDERBOX)
          )
        );
      }
    }
    // LocTeleports owns the movement; leave the event unhandled so it travels.
    event.handled = false;
  }

  /**
   * Cart tunnels and the main entrance: mark the second entrance found on the way in,
   * crumble a carried fungus in the daylight (or refuse to leave before cutting a
   * shard), then let LocTeleports move the player.
   */
  function handleCartTunnel(event) {
    const { player, objectId } = event;
    if (
      !CART_TUNNEL_OBJECT_IDS.has(objectId) &&
      !MINE_ENTRANCE_IDS.has(objectId) &&
      !MINE_EXIT_OBJECT_IDS.has(objectId)
    ) {
      return;
    }
    const stage = quest.getStage(player);
    if (MINE_ENTRANCE_IDS.has(objectId) && stage >= STAGE_STARTED && stage < STAGE_SECOND_ENTRANCE) {
      quest.setStage(player, STAGE_SECOND_ENTRANCE);
    }
    if (!MINE_EXIT_OBJECT_IDS.has(objectId)) return;
    if (
      objectId === CRYSTAL_SHORTCUT_EXIT_OBJECT_ID &&
      quest.getStage(player) >= STAGE_KEY_TAKEN &&
      !quest.isComplete(player)
    ) {
      event.handled = true;
      startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_LEAVE_BEFORE_SHARD);
      return;
    }
    if (!hasFungus(player)) return;
    player.getInventory().deleteNumber(GLOWING_FUNGUS_ITEM_ID, 1);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_FUNGUS_EXIT);
  }

  /** Claims Haunted's same-plane ladders before ClimbLinks guesses. */
  function claimHauntedLadder(event) {
    const object = event?.object;
    const location = object?.getLocation?.();
    if (!location) return;
    const actions = ObjectDefinition.forId(event.objectId)?.getInteractions?.() ?? [];
    const down = actions.some((action) => /down/i.test(action || ""));
    const stair = HAUNTED_STAIR_LINKS.get(`${event.objectId}:${location.getX()},${location.getY()}`);
    const link = stair ?? HAUNTED_LADDER_LINKS.get(`${location.getX()},${location.getY()}`);
    if (!link) return;
    const destination = down ? link.down : link.up;
    if (!destination) return;
    event.handled = true;
    api.emitCustomEvent(down ? "ladders:climbDown" : "ladders:climbUp", {
      player: event.player,
      object,
      destination: new Location(destination.x, destination.y, 0),
    });
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === CLIMB_OVER_CART_OBJECT_ID) {
      climbOverCart(event);
      return;
    }
    if (GLOWING_FUNGUS_OBJECT_IDS.has(objectId)) {
      pickFungus(event);
      return;
    }
    if (CRYSTAL_OUTCROP_OBJECT_IDS.has(objectId)) {
      cutCrystal(event);
      return;
    }
    if (objectId === WATER_VALVE_OBJECT_ID) {
      turnValve(event);
      return;
    }
    if (objectId === DAYTH_STAIRS_OBJECT_ID) {
      if (
        quest.isStarted(player) &&
        !quest.isComplete(player) &&
        hasBit(player, BIT_REACHED_DEPTHS) &&
        quest.getStage(player) >= STAGE_LIFT_DOWN &&
        quest.getStage(player) < STAGE_TREUS_ROOM
      ) {
        quest.setStage(player, STAGE_TREUS_ROOM);
      }
      return; // LocTeleports owns the descent.
    }
    if (objectId === FLOODED_LIFT_OBJECT_ID) {
      event.handled = true;
      player.moveTo(new Location(LIFT_ROOM_TILE.x, LIFT_ROOM_TILE.y, 0));
      return;
    }
    if (LIFT_DOWN_OBJECT_IDS.has(objectId)) {
      takeLiftDown(event);
      return;
    }
    if (objectId === SEARCHABLE_MINE_CART_OBJECT_ID) {
      searchCart(event);
      return;
    }
    if (objectId === POINTS_SETTINGS_OBJECT_ID) {
      checkPointsSettings(event);
      return;
    }
    if (LEVER_OBJECT_IDS.has(objectId)) {
      pullLever(event);
      return;
    }
    handleCartTunnel(event);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId, object } = event;
    if (itemId === ZEALOTS_KEY_ITEM_ID && objectId === WATER_VALVE_OBJECT_ID) {
      useKeyOnValve(event);
      return;
    }
    if (itemId !== GLOWING_FUNGUS_ITEM_ID || objectId !== SEARCHABLE_MINE_CART_OBJECT_ID) return;
    event.handled = true;
    if (atTile(object?.getLocation?.(), CART_END_TILE) || hasBit(player, BIT_FUNGUS_IN_CART_END)) {
      startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_PLACE_BACK);
      return;
    }
    if (hasBit(player, BIT_FUNGUS_IN_CART_START)) return;
    player.getInventory().deleteNumber(GLOWING_FUNGUS_ITEM_ID, 1);
    setBit(player, BIT_FUNGUS_IN_CART_START);
    sendStateVarps(player);
    tryMoveCart(player);
  }

  /**
   * Quest state on shared doors: the crystal-mine key unlocks the large doors, and the
   * boss room's east door has no open/close variant in the cache so it is swung out of
   * the way here. Runs before the generic Doors plugin, which reads `handled`.
   */
  function handleDoorToggle(request) {
    if (request.handled) return;
    const { player, objectId, object } = request;
    if (LARGE_DOOR_OBJECT_IDS.has(objectId)) {
      if (hasCrystalKey(player)) return; // let Doors open the leaf normally
      request.handled = true;
      startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_LARGE_DOOR);
      return;
    }
    if (objectId !== BOSS_DOOR_OBJECT_ID || !object) return;
    request.handled = true;
    ObjectManager.deregister(object, true);
    Sounds.sendSound(player, Sound.DOOR_OPEN);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  /** A dropped glowing fungus crumbles instead of hitting the floor. */
  function dropFungus(event) {
    const { player } = event;
    player.getInventory().deleteNumber(GLOWING_FUNGUS_ITEM_ID, 1);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_FUNGUS_DROP);
  }

  /** Teleporting out of the mine with the fungus crumbles it in the sunlight. */
  function crumbleOnTeleport(event) {
    const { player, destination } = event;
    if (!destination || !hasFungus(player)) return;
    const x = destination.getX?.() ?? destination.x;
    const y = destination.getY?.() ?? destination.y;
    if (!Number.isInteger(x) || !Number.isInteger(y) || isInsideMine(x, y)) return;
    player.getInventory().deleteNumber(GLOWING_FUNGUS_ITEM_ID, 1);
    startTranscript(api, player, ZEALOT_NPC_ID, PAGE, V_FUNGUS_TELEPORT);
  }

  function isInsideMine(x, y) {
    return (
      (x >= 2600 && x <= 3020 && y >= 4300 && y <= 4720) ||
      (x >= 3300 && x <= 3520 && y >= 9500 && y <= 9750) ||
      (x >= 3340 && x <= 3560 && y >= 3140 && y <= 3310)
    );
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  function handleLogin({ player }) {
    migrateSave(player);
    refreshQuestList(player);
    sendStateVarps(player);
  }

  function handleLogout({ player }) {
    Scenes.cancel(player);
    removeCarts(player);
    stopGhost(player);
    removeTreus(player);
    player.getPacketSender().sendCameraReset().closeSubInterface?.((161 << 16) | 1);
  }

  // ==========================================================================
  // Journal / rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I spoke to a Saradominist Zealot outside the abandoned Mort Ridge mines.</str>",
        "<str>I stole his key and made my way through the haunted mine.</str>",
        "<str>I used a glowing fungus to light the deepest level and defeated</str>",
        "<str>Treus Dayth, the ghost bound to guard the Salve crystals.</str>",
        "<str>I cut a shard from the crystal outcrop and completed the quest.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STARTED) {
      const lines = [
        "<str>I spoke to the Zealot outside the Abandoned Mine and agreed to help</str>",
        "<str>him reach the Salve crystals deep in the haunted mine.</str>",
        "",
      ];
      if (stage < STAGE_SECOND_ENTRANCE) {
        lines.push("I should pickpocket the <col=800000>Zealot</col> for his key, then");
        lines.push("find the second entrance into the mine.");
      } else if (stage < STAGE_LIFT_DOWN) {
        lines.push("I should send a <col=800000>glowing fungus</col> across the mine cart track");
        lines.push("to light the deepest level.");
      } else if (stage < STAGE_TREUS_ROOM) {
        lines.push("I should take the <col=800000>lift</col> down into the flooded mine.");
      } else if (stage < STAGE_TREUS_DEAD) {
        lines.push("I should defeat <col=800000>Treus Dayth</col> and take the key he guards.");
      } else if (stage < STAGE_KEY_TAKEN) {
        lines.push("I should take the <col=800000>crystal-mine key</col> from the crate.");
      } else {
        lines.push("I should cut a shard from a <col=800000>crystal outcrop</col> with a chisel.");
      }
      return lines;
    }
    return [
      "I can start this quest by talking to the <col=800000>Zealot</col> outside",
      "the <col=800000>Abandoned Mine</col>, south of the Mort Myre swamp.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.STRENGTH, 22000);
  }

  /** Capture 1768 crosses 2725,4453 after the lift; cache 241 clips that one tile. */
  function installFloodedChannelFix({ regionId } = {}) {
    if (regionId !== FLOODED_CHANNEL_REGION) return;
    RegionManager.removeClipping(
      FLOODED_CHANNEL_TILE.x,
      FLOODED_CHANNEL_TILE.y,
      0,
      RegionManager.BLOCKED_TILE,
      null
    );
  }

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(LEVERS_ATTRIBUTE, 0);
  api.persistAttribute(SCHEMA_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "haunted_mine",
    name: "Haunted Mine",
    varpId: VARP_HAUNTED_MINE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.STRENGTH.getIndex(), amount: 22000, label: "Strength" }],
    scrollItemId: SALVE_AMULET_ITEM_ID,
    otherRewards: [
      "Ability to make the Salve amulet",
      "Access to the crystal outcrop shortcut",
      "Access to Tarn's Lair",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onRegionLoaded(installFloodedChannelFix);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("ladders:climb", claimHauntedLadder);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onInterfaceActionButton(POINTS_SETTINGS_START_BUTTON, startPointsPuzzle);
  api.onItemAction("Glowing fungus", { Drop: dropFungus });
  api.onNpcInteraction("Zealot", { Pickpocket: pickpocketZealot });
  api.onNpcInteraction("Innocent-looking key", { Take: takeInnocentKey });
  api.onNpcDeath(handleNpcDeath);
  api.onCanTeleport(crumbleOnTeleport);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
