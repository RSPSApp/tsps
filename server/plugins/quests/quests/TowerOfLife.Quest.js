/**
 * Tower of Life (members).
 *
 * The words come from the "Tower of Life" transcript page; this plugin supplies the
 * variant selectors for Effigy, Bonafido, 'Black-eye', 'No fingers', 'Gummy', 'The Guns',
 * 'Transmute'/'Currency' the Alchemists and the Homunculus, the builder's-costume
 * hand-ins (hard hat quiz, beer for the shirt, plant trousers, pickpocketed boots), the
 * tower door checks, the three repair machines, the top-floor creation cutscene, the
 * Homunculus mind puzzle and the basement hand-in.
 *
 * Stages (varbit 3337 "tol_prog", varp 977 "tol" bits 0-4; the stage values are the
 * tol_prog indexes at which the tower's multi-NPCs 6154/6155/6157/6158 resolve to their
 * real Effigy/Homunculus/Transmute/Currency ids, read from the cache transform tables):
 *   2  Effigy started me on the quest (go and see Bonafido)
 *   3  Bonafido wants me to prove myself: get the builder's costume
 *   4  Bonafido's test passed; admitted to the tower (wearing the costume)
 *   6  pressure machine, pipe machine and cage all working; tell Effigy
 *   8  Effigy has gone to the top of the tower; follow her
 *  11  the creation scene watched; confront the alchemists downstairs
 *  12  back at the top: help the Homunculus make sense of its mind
 *  14  mind fixed; talk to Effigy, then meet the Homunculus in the dungeon
 *  16  complete
 * The machine progress bits (3338 tol_pres_prog / 3339 tol_pipe_prog / 3340 tol_cage_prog,
 * 3354 tol_cage_state and 3372 tol_trapdoor_open) drive the client's multi-loc scenery
 * (object parents 21943/21941/21944, cache transform tables read from the cache); the
 * server mirrors them from the persisted attributes below.
 *
 * Machine handling: the pressure/pipe/cage objects each start their wiki repair transcript
 * ("Fix"); the "If missing materials" prose condition is answered from the inventory and the
 * construct action consumes the materials. Their open-intervention actions open the real
 * cache interfaces 510 (pressure), 511 (pipe) and 509 (cage), whose button ids match the
 * Quest Helper PuzzleSolver widgets; only their controls set progress 2. 3359 tol_homonc_pres
 * shows the freed Homunculus at the tower during the scare.
 *
 * Source: OSRS Wiki "Tower of Life" and its quick guide (requirements: 10 Construction,
 * hammer, saw, a regular beer; rewards: 2 Quest points, 1,000 Construction, 500 Crafting,
 * 500 Thieving and access to Creature Creation). The satchel is a Creature Creation drop,
 * not a quest reward, so it is not granted here.
 *
 * Gaps / approximations:
 *  - The machine puzzle initial layouts are reconstructed from the Quest Helper solver; the
 *    cache does not carry the server's per-player starting varbit values.
 *  - The pressure machine's tube holes and the pipe machine's piece models come from the
 *    cache: the pressure render (clientscript 2763) draws a hole at level 2 for the first
 *    two balls and level 3 for the last two, and every pipe piece's model family is in
 *    the cache next to the ids Quest Helper checks.
 *  - The tower door is not in Doors.plugin.js's door catalog ("Tower door" is not one of its
 *    names), so opening it moves the checked player through instead of swapping door models.
 *  - The trapdoor to the dungeon opens only once the Homunculus has been freed ("The trapdoor
 *    won't budge." otherwise); its climb-down and the dungeon ladder's climb-up are routed
 *    through the Ladders plugin with explicit destinations ((3038,4376) dungeon landing).
 *    The descent is the cache's tol_prog step 17, between the scare (16) and the hand-in (18).
 *  - Searching any tower plant yields the trousers on the first try (the wiki's plants differ
 *    only by chance); the crates always give their wiki contents (21908 gives nothing, 21916 a
 *    triangle sandwich).
 *  - Every builder's costume piece is renewable: a lost piece is handed out again by its
 *    source (Black-eye, No fingers, The Guns, the plants), so a player who loses one is not
 *    locked out of the tower.
 *  - Effigy has no post-quest transcript variant, so a completed player replays the
 *    "talking-to-effigy-again" conversation; the scare-scene repeat also reuses it.
 *  - The post-quest altar activity lives in CreatureCreation.plugin.js.
 *  - The Homunculus mind puzzle asks one question per conversation (the transcript wraps the
 *    questions in a condition run the runtime resolves once), so the bar is filled over
 *    repeated talks; after the first answer the lead-in is skipped. The bar (varbit 3358)
 *    is four bits: 8 is neutral, 0 fully magical and 15 fully logical, so the mind is fixed
 *    once eight answers push it to either end.
 */
module.exports = function registerTowerOfLifeQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Tower of Life";
  const START_HOOK = "quest:tower-of-life:start";
  const CONSTRUCTION_REQUIREMENT = 10;

  // Content ids: the tower spawns multi ids 6154-6158 whose tol_prog transform resolves to
  // these; interaction events carry the resolved id (Npc.getContentId).
  const EFFIGY_NPC_ID = NpcIdentifiers.EFFIGY; // 3585
  const EFFIGY_NPC_IDS = new Set([EFFIGY_NPC_ID, NpcIdentifiers.EFFIGY_2]); // 3585/3586
  const BONAFIDO_NPC_ID = NpcIdentifiers.BONAFIDO; // 3587
  const HOMUNCULUS_NPC_IDS = new Set([
    NpcIdentifiers.HOMUNCULUS, // 3588
    NpcIdentifiers.HOMUNCULUS_2, // 3589
    NpcIdentifiers.HOMUNCULUS_3, // 3590
  ]);
  const TRANSMUTE_NPC_IDS = new Set([
    NpcIdentifiers.TRANSMUTE_THE_ALCHEMIST, // 3592
    NpcIdentifiers.TRANSMUTE_THE_ALCHEMIST_2, // 3593
  ]);
  const CURRENCY_NPC_IDS = new Set([
    NpcIdentifiers.CURRENCY_THE_ALCHEMIST, // 3594
    NpcIdentifiers.CURRENCY_THE_ALCHEMIST_2, // 3595
  ]);
  const BLACK_EYE_NPC_ID = NpcIdentifiers.BLACK_EYE; // 3596
  const NO_FINGERS_NPC_ID = NpcIdentifiers.NO_FINGERS; // 3597
  const GUMMY_NPC_ID = NpcIdentifiers.GUMMY; // 3598
  const GUNS_NPC_ID = NpcIdentifiers.THE_GUNS; // 3599
  // Varp 977 "tol" and its varbits (all lengths read from the cache varbit definitions).
  const VARBIT_STAGE = 3337; // tol_prog bits 0-4
  const VARBIT_PRESSURE = 3338; // tol_pres_prog bits 5-6
  const VARBIT_PIPE = 3339; // tol_pipe_prog bits 7-8
  const VARBIT_CAGE = 3340; // tol_cage_prog bits 9-10
  const VARBIT_CAGE_STATE = 3354; // tol_cage_state bit 31
  const VARBIT_HOMONC_PRES = 3359; // tol_homonc_pres (varp 978)
  const VARBIT_TRAPDOOR = 3372; // tol_trapdoor_open (varp 978)
  const VARBIT_NOFINGERS = 3376; // tol_nofingers_asked (varp 978)

  const STAGE_STARTED = 2;
  const STAGE_OUTFIT = 3;
  const STAGE_ADMITTED = 4;
  const STAGE_MACHINES_FIXED = 6;
  const STAGE_TOLD_EFFIGY = 8;
  const STAGE_CREATED = 11;
  const STAGE_HOMUNCULUS = 12;
  const STAGE_FREED = 14;
  const STAGE_COMPLETE = 16;

  // Objects.
  const PRESSURE_MACHINE_OBJECT_ID = ObjectIdentifiers.PRESSURE_MACHINE; // 21873
  const PIPE_MACHINE_MULTI_OBJECT_ID = 21943; // tol_pipe_machine_multi -> 21880/21881
  const PIPE_MACHINE_BROKEN_OBJECT_ID = ObjectIdentifiers.PIPE_MACHINE; // 21880
  const CAGE_MULTI_OBJECT_ID = 21941; // tol_cage_multi -> 21870/21869
  const CAGE_BROKEN_OBJECT_ID = ObjectIdentifiers.CAGE_17; // 21870
  const TRAPDOOR_MULTI_OBJECT_ID = 21944; // tol_trapdoor_multi -> 21921/21922
  const TRAPDOOR_OBJECT_IDS = new Set([
    TRAPDOOR_MULTI_OBJECT_ID,
    ObjectIdentifiers.TRAPDOOR_86, // 21921
    ObjectIdentifiers.TRAPDOOR_87, // 21922
  ]);
  const TOWER_DOOR_OBJECT_ID = ObjectIdentifiers.TOWER_DOOR; // 21814
  const DUNGEON_LADDER_OBJECT_ID = 17974; // Ladder, dungeon exit (also the tower z2/z3 ladder)
  const TOWER_DOOR_TILE = { x: 2649, y: 3225, z: 0 };
  const TRAPDOOR_TILE = { x: 2648, y: 3212, z: 0 };
  const DUNGEON_LADDER_TILE = { x: 3038, y: 4375, z: 0 };
  const DUNGEON_LANDING = { x: 3038, y: 4376, z: 0 };
  const PLANT_OBJECT_ID = ObjectIdentifiers.PLANT_80; // 21924, the tower's plants
  const CRATE_ITEMS = new Map([
    [ObjectIdentifiers.CRATE_182, null], // tol_crate01 gives nothing
    [ObjectIdentifiers.CRATE_183, ItemIdentifiers.PIPE_2], // 21909 pipes
    [ObjectIdentifiers.CRATE_184, ItemIdentifiers.PIPE_RING], // 21910 pipe rings
    [ObjectIdentifiers.CRATE_185, ItemIdentifiers.RIVETS], // 21911 rivets
    [ObjectIdentifiers.CRATE_186, ItemIdentifiers.VALVE_WHEEL], // 21912 valve wheels
    [ObjectIdentifiers.CRATE_187, ItemIdentifiers.METAL_SHEET], // 21913 metal sheets
    [ObjectIdentifiers.CRATE_188, ItemIdentifiers.COLOURED_BALL], // 21914 coloured balls
    [ObjectIdentifiers.CRATE_189, ItemIdentifiers.BINDING_FLUID], // 21915 binding fluid
    [ObjectIdentifiers.CRATE_190, ItemIdentifiers.TRIANGLE_SANDWICH], // 21916 sandwiches
    [ObjectIdentifiers.CRATE_191, ItemIdentifiers.METAL_BAR], // 21917 metal bars
  ]);
  const TOP_FLOOR_ZONE = { minX: 2636, maxX: 2662, minY: 3208, maxY: 3232, levels: [3] };

  // Items.
  const HARD_HAT_ITEM_ID = ItemIdentifiers.HARD_HAT; // 10862
  const SHIRT_ITEM_ID = ItemIdentifiers.BUILDERS_SHIRT; // 10863
  const TROUSERS_ITEM_ID = ItemIdentifiers.BUILDERS_TROUSERS; // 10864
  const BOOTS_ITEM_ID = ItemIdentifiers.BUILDERS_BOOTS; // 10865
  const RIVETS_ITEM_ID = ItemIdentifiers.RIVETS; // 10866
  const BINDING_FLUID_ITEM_ID = ItemIdentifiers.BINDING_FLUID; // 10870
  const PIPE_ITEM_ID = ItemIdentifiers.PIPE_2; // 10871
  const PIPE_RING_ITEM_ID = ItemIdentifiers.PIPE_RING; // 10872
  const METAL_SHEET_ITEM_ID = ItemIdentifiers.METAL_SHEET; // 10873
  const COLOURED_BALL_ITEM_ID = ItemIdentifiers.COLOURED_BALL; // 10874
  const VALVE_WHEEL_ITEM_ID = ItemIdentifiers.VALVE_WHEEL; // 10875
  const METAL_BAR_ITEM_ID = ItemIdentifiers.METAL_BAR; // 10876
  const BEER_ITEM_IDS = [ItemIdentifiers.BEER, ItemIdentifiers.BEER_2]; // 1917/1918
  const BEER_TANKARD_ITEM_IDS = new Set([
    ItemIdentifiers.BEER_TANKARD, // 3803
    ItemIdentifiers.BEER_TANKARD_2, // 3804
    ItemIdentifiers.KEG_OF_BEER, // 3711
    ItemIdentifiers.KEG_OF_BEER_2, // 3801
    ItemIdentifiers.KEG_OF_BEER_3, // 3802
  ]);
  const HAMMER_ITEM_IDS = [ItemIdentifiers.HAMMER, ItemIdentifiers.IMCANDO_HAMMER]; // 2347/25644
  const SAW_ITEM_IDS = [ItemIdentifiers.SAW, ItemIdentifiers.CRYSTAL_SAW]; // 8794/9625
  const OUTFIT_SLOTS = [
    [Equipment.HEAD_SLOT, HARD_HAT_ITEM_ID],
    [Equipment.BODY_SLOT, SHIRT_ITEM_ID],
    [Equipment.LEG_SLOT, TROUSERS_ITEM_ID],
    [Equipment.FEET_SLOT, BOOTS_ITEM_ID],
  ];

  // Condition step ids on the "Tower of Life" page.
  const MAKING_HISTORY_CONDITION_ID = "Ezpv06";
  const GUNS_NO_BEER_CONDITION_ID = "6orzAo";
  const GUNS_HAS_BEER_CONDITION_ID = "KQQFN1";
  const GUNS_AGAIN_CONDITION_ID = "8iScoh";
  const GUNS_NONREGULAR_CONDITION_ID = "2ksBt5";
  const GUNS_TANKARD_CONDITION_ID = "jst0Is";
  const GUNS_NOTED_CONDITION_ID = "wn0foC";
  const PLANT_HAS_TROUSERS_CONDITION_ID = "gjuWtd";
  const PLANT_NO_TROUSERS_CONDITION_ID = "DjXS_h";
  const BONAFIDO_OUTFIT_CONDITION_ID = "dkneOx";
  const CRATE_NOTHING_CONDITION_ID = "bvw4Kt";
  const PRESSURE_MISSING_CONDITION_ID = "KdbhRY";
  const PIPE_MISSING_CONDITION_ID = "se_YYh";
  const CAGE_MISSING_CONDITION_ID = "xyWpju";
  const PRESSURE_FIXED_CONDITION_ID = "cyNoPv";
  const PIPE_FIXED_CONDITION_ID = "uQEvOW";
  const CAGE_FIXED_CONDITION_ID = "of5CSL";
  const PRESSURE_LAST_CONDITION_ID = "Pnl7gq";
  const PIPE_LAST_CONDITION_ID = "MEOTsm";
  const CAGE_LAST_CONDITION_ID = "f0n0HT";

  // Action step ids.
  const RECEIVE_HARD_HAT_ACTION_ID = "g0D-tI";
  const RECEIVE_SHIRT_ACTION_ID = "d8nl3j";
  const RECEIVE_TROUSERS_ACTION_ID = "2crh1R";
  const RECEIVE_BOOTS_ACTION_ID = "1z74yp";
  const BUILD_PRESSURE_ACTION_ID = "GYrrRh";
  const BUILD_PIPE_ACTION_ID = "7-wU8Y";
  const BUILD_CAGE_ACTION_ID = "Dl3PuF";
  const OPEN_PRESSURE_ACTION_ID = "VtcfG5";
  const OPEN_PIPE_ACTION_ID = "ZkpaiW";
  const OPEN_CAGE_ACTION_ID = "p7AQxw";
  const PRESSURE_NEED_MESSAGE_ID = "R38gDE";
  const PIPE_NEED_MESSAGE_ID = "OhfuDQ";
  const CAGE_NEED_MESSAGE_ID = "NfhI61";
  const MIND_BAR_OPEN_ACTION_ID = "uGmjY6";
  const MIND_FIXED_ACTION_ID = "yA27Qt";
  const COMPLETE_ACTION_ID = "mwkqoc";
  const SKIPPED_ACTION_IDS = new Set([
    "iKytxw", // "(When blocking the leaks) Pipe [1-4]: The leak is blocked!"
    "9fATGa", // "(Fixing any part of the cage)"
    "cL-nGr", // terminal marker after the completion action
  ]);

  // Homunculus mind questions, in transcript order; answers swing the bar +/-1 (0 = neither).
  const MIND_QUESTIONS = [
    { id: "97eltZ", answers: new Map([["Get some logs and a tinderbox.", 1], ["With the aid of 5 fire runes.", -1], ["That's impossible! No one can do that!", 0]]) },
    { id: "ZpSk5O", answers: new Map([["Not too sure, I've never seen it happen.", 0], ["With the help of the magical dragonstones!", -1], ["By ignition of gas in their belly as they exhale.", 1]]) },
    { id: "2Dr--Z", answers: new Map([["Runecraft, enchant jewellery, perform alchemy.", -1], ["Eat, sleep, nothing that exciting.", 0], ["Fletching, Crafting, Smithing.", 1]]) },
    { id: "yu4sTZ", answers: new Map([["Bury them.", 1], ["I'd like to think you wouldn't be carrying bones around.", 0], ["Turn them into bananas or peaches!", -1]]) },
    { id: "uV-kVf", answers: new Map([["I'm not really much of a traveller, sorry.", 0], ["Run, run as fast as you can.", 1], ["Depends where you are headed, but teleport spells are a safe bet.", -1]]) },
    { id: "Qy-c4H", answers: new Map([["Yes, you can make magic potions to boost your skills.", -1], ["People mix together ingredients in vials. The nutrients will help you.", 1], ["Yes, liquid-filled vials. Big deal.", 0]]) },
    { id: "tErHx-", answers: new Map([["By harnessing the power of the gods!", -1], ["Never seen one personally.", 0], ["Take some essence to an altar and use a talisman.", 1]]) },
    { id: "UzEfko", answers: new Map([["Perhaps. I've never seen it myself, though.", 0], ["Yep, you can use the Telekinetic Grab spell.", -1], ["Sure. Use your brain to tell someone to move it!", 1]]) },
    { id: "qUwTWj", answers: new Map([["Through the power of alchemy.", -1], ["It's beyond me!", 0], ["It's a simple case of combining materials.", 1]]) },
    { id: "TCOCmh", answers: new Map([["You have special powers - no surprise seeing how you were created.", -1], ["Coincidence - there is a lot of loose metal around.", 1], ["Yeah, they were cool! Nice one.", 0]]) },
    { id: "QHamRU", answers: new Map([["Try some Mining followed by Smithing.", 1], ["How about Magic and Runecrafting?", -1], ["That's up to you; depends on what you find interesting.", 0]]) },
    { id: "BGjV-n", answers: new Map([["Don't be silly! You'd get burnt!", 0], ["Can't see why not, anything is possible.", -1], ["Well the sun is not actually there, it's where it used to be!", 1]]) },
    { id: "VmKi9Z", answers: new Map([["Everything has a reason, even if you don't know what it is.", 1], ["Probably a bit of both.", 0], ["Your very existense speaks of mystical forces.", -1]]) },
    { id: "xCAmQm", answers: new Map([["Magic.", -1], ["I'm too laid back to really care, mate.", 0], ["Logic.", 1]]) },
  ];
  const MIND_QUESTION_INDEX = new Map(MIND_QUESTIONS.map((question, index) => [question.id, index]));
  /**
   * The sanity meter (tol_homonc_align, varbit 3358) is four bits: 8 is the neutral
   * middle, 0 is fully magical and 15 fully logical. The meter moves one step per
   * answer, so the magic end is eight steps below the middle and the logic end seven
   * steps above it (8 + 7 = 15). A threshold of eight therefore reaches both ends:
   * the magic answers land on 0 and the logical ones on 15.
   */
  const MIND_ALIGNMENT_THRESHOLD = 8;

  const MAKING_HISTORY_ATTRIBUTE = "quest.making_history.stage";

  const MACHINE_VARIANTS = {
    pressure: "unfinished-work-fixing-the-pressure-machine",
    pipe: "unfinished-work-fixing-the-pipe-system",
    cage: "unfinished-work-fixing-the-strange-cage",
  };
  const MACHINE_MATERIALS = {
    pressure: [
      [COLOURED_BALL_ITEM_ID, 4, "coloured balls"],
      [METAL_SHEET_ITEM_ID, 3, "metal sheets"],
      [VALVE_WHEEL_ITEM_ID, 4, "valve wheels"],
    ],
    pipe: [
      [PIPE_ITEM_ID, 4, "pipes"],
      [PIPE_RING_ITEM_ID, 5, "pipe rings"],
      [RIVETS_ITEM_ID, 6, "rivets"],
    ],
    cage: [
      [METAL_BAR_ITEM_ID, 5, "metal bars"],
      [BINDING_FLUID_ITEM_ID, 4, "binding fluids"],
    ],
  };
  const MACHINE_BY_ACTION = new Map([
    [BUILD_PRESSURE_ACTION_ID, "pressure"],
    [OPEN_PRESSURE_ACTION_ID, "pressure"],
    [PRESSURE_NEED_MESSAGE_ID, "pressure"],
    [BUILD_PIPE_ACTION_ID, "pipe"],
    [OPEN_PIPE_ACTION_ID, "pipe"],
    [PIPE_NEED_MESSAGE_ID, "pipe"],
    [BUILD_CAGE_ACTION_ID, "cage"],
    [OPEN_CAGE_ACTION_ID, "cage"],
    [CAGE_NEED_MESSAGE_ID, "cage"],
  ]);

  // Persisted state (the stage itself is QuestRuntime's stage attribute/varbit).
  const FLAGS_ATTRIBUTE = "quest.tower_of_life.flags";
  const PRESSURE_ATTRIBUTE = "quest.tower_of_life.pressure";
  const PIPE_ATTRIBUTE = "quest.tower_of_life.pipe";
  const CAGE_ATTRIBUTE = "quest.tower_of_life.cage";
  const MIND_ALIGN_ATTRIBUTE = "quest.tower_of_life.mind-align";
  const MIND_STEP_ATTRIBUTE = "quest.tower_of_life.mind-step";

  const FLAG_HAT = 1 << 0;
  const FLAG_SHIRT = 1 << 1;
  const FLAG_TROUSERS = 1 << 2;
  const FLAG_BOOTS = 1 << 3;
  const FLAG_ENTERED = 1 << 4;
  const FLAG_MIND_STARTED = 1 << 5;
  const FLAG_SCARED = 1 << 6;
  const FLAG_TRAPDOOR = 1 << 7;
  const FLAG_DUNGEON = 1 << 8;

  const MACHINE_UNFINISHED = 0;
  const MACHINE_BUILT = 1;
  const MACHINE_WORKING = 2;

  // Cache puzzle interfaces (Quest Helper PuzzleSolver widget groups).
  const PRESSURE_PUZZLE_GROUP = 510;
  const PIPE_PUZZLE_GROUP = 511;
  const CAGE_PUZZLE_GROUP = 509;
  const MIND_BAR_GROUP = 508; // TOL_HOMONCULUS_OVERLAY
  /** Gameframe HUD overlay target used by the client's overlay interfaces. */
  const OVERLAY_HUD_UID = (161 << 16) | 8;
  const VARBIT_MIND_ALIGN = 3358;
  const VARBIT_PRES_LEVELS = [3351, 3352, 3353, 3355];
  const VARBIT_PRES_PLUGGED = [3347, 3348, 3349, 3350];
  const VARBIT_PRES_LEVERS = [3356, 3357];
  const VARBIT_PIPE_ROTATION = 7981; // tol_pipe5_rot (varp 977 bits 16-17)
  const PIECE_DOES_NOT_FIT = "That piece does not fit.";
  const BAR_DOES_NOT_FIT = "That bar does not fit.";
  const PRESSURE_PUZZLE_ATTRIBUTE = "tower-of-life:pressure-puzzle";
  const PIPE_PUZZLE_ATTRIBUTE = "tower-of-life:pipe-puzzle";
  const CAGE_PUZZLE_ATTRIBUTE = "tower-of-life:cage-puzzle";
  /** Which cache interface this player currently has open (cleared on close/solve). */
  const openPuzzle = new WeakMap();
  const PUZZLE_BUTTONS = [
    ...[128, 129, 130, 131, 132, 133, 134, 135, 136, 141].map((child) => (PRESSURE_PUZZLE_GROUP << 16) | child),
    ...[9, 10, 11, 12, 13, 15, 17, 19, 21, 23].map((child) => (PIPE_PUZZLE_GROUP << 16) | child),
    ...[26, 29, 32, 41, 44, 49, 52].map((child) => (CAGE_PUZZLE_GROUP << 16) | child),
  ];

  const BONAFIDO_QUIZ_FINAL_OPTION = "Carry on, it'll fix itself";

  // Transient context for transcript prose (never persisted).
  const gunsDrinkContext = new WeakMap();
  const trousersPlant = new WeakMap();
  const crateEmpty = new WeakMap();
  const pendingQuestion = new WeakMap();

  api.persistAttribute(FLAGS_ATTRIBUTE, 0);
  api.persistAttribute(PRESSURE_ATTRIBUTE, 0);
  api.persistAttribute(PIPE_ATTRIBUTE, 0);
  api.persistAttribute(CAGE_ATTRIBUTE, 0);
  api.persistAttribute(MIND_ALIGN_ATTRIBUTE, 0);
  api.persistAttribute(MIND_STEP_ATTRIBUTE, 0);
  // Puzzle layouts survive logout and are restored from saved state on login.
  api.persistAttribute(PRESSURE_PUZZLE_ATTRIBUTE, null);
  api.persistAttribute(PIPE_PUZZLE_ATTRIBUTE, null);
  api.persistAttribute(CAGE_PUZZLE_ATTRIBUTE, null);

  let quest;

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const holdsAny = (player, itemIds) => itemIds.some((itemId) => held(player, itemId));
  const readInt = (player, key) => {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value | 0 : 0;
  };

  function sendVarbit(player, varbitId, value) {
    player.getPacketSender().sendVarbit(varbitId, value);
  }

  function hasFlag(player, flag) {
    return (readInt(player, FLAGS_ATTRIBUTE) & flag) !== 0;
  }

  function setFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, readInt(player, FLAGS_ATTRIBUTE) | flag);
  }

  function clearFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, readInt(player, FLAGS_ATTRIBUTE) & ~flag);
  }

  function hasRoomFor(player, itemId) {
    return player.getInventory().getFreeSlots() >= 1 || held(player, itemId);
  }

  function giveItem(player, itemId) {
    if (!hasRoomFor(player, itemId)) {
      player.sendMessage("You don't have enough inventory space.");
      return false;
    }
    player.getInventory().adds(itemId, 1);
    return true;
  }

  function wearingBuilderOutfit(player) {
    const equipment = player.getEquipment();
    return OUTFIT_SLOTS.every(([slot, itemId]) => equipment.get(slot)?.getId?.() === itemId);
  }

  /** A builder's piece counts as kept while it is in the inventory or worn. */
  function hasOutfitPiece(player, itemId) {
    if (held(player, itemId)) return true;
    const equipment = player.getEquipment();
    return OUTFIT_SLOTS.some(([slot, id]) => id === itemId && equipment.get(slot)?.getId?.() === itemId);
  }

  function atTile(location, tile, radius = 0) {
    return Boolean(location) &&
      Math.abs((location.x ?? location.getX?.()) - tile.x) <= radius &&
      Math.abs((location.y ?? location.getY?.()) - tile.y) <= radius &&
      ((location.z ?? location.getZ?.() ?? 0) === tile.z);
  }

  // ---------------------------------------------------------------------------
  // Quest stage helpers
  // ---------------------------------------------------------------------------

  function machineProgress(player, machine) {
    const key = machine === "pressure" ? PRESSURE_ATTRIBUTE : machine === "pipe" ? PIPE_ATTRIBUTE : CAGE_ATTRIBUTE;
    return readInt(player, key);
  }

  function setMachineProgress(player, machine, value) {
    const key = machine === "pressure" ? PRESSURE_ATTRIBUTE : machine === "pipe" ? PIPE_ATTRIBUTE : CAGE_ATTRIBUTE;
    player.setAttribute(key, value);
    if (machine === "pressure") sendVarbit(player, VARBIT_PRESSURE, value);
    if (machine === "pipe") sendVarbit(player, VARBIT_PIPE, value);
    if (machine === "cage") {
      sendVarbit(player, VARBIT_CAGE, value);
      sendVarbit(player, VARBIT_CAGE_STATE, value >= MACHINE_WORKING ? 1 : 0);
    }
  }

  function allMachinesWorking(player) {
    return ["pressure", "pipe", "cage"].every((machine) => machineProgress(player, machine) >= MACHINE_WORKING);
  }

  // ---------------------------------------------------------------------------
  // Machine puzzle interfaces (cache groups 510 / 511 / 509)
  // ---------------------------------------------------------------------------

  function readPuzzle(player, key) {
    const state = player.getAttribute(key);
    return state && typeof state === "object" ? state : null;
  }

  function sendMindAlignment(player) {
    const alignment = readInt(player, MIND_ALIGN_ATTRIBUTE);
    sendVarbit(player, VARBIT_MIND_ALIGN, Math.max(0, Math.min(15, 8 + alignment)));
  }

  function showMindBar(player) {
    if (quest.getStage(player) !== STAGE_HOMUNCULUS) return;
    sendMindAlignment(player);
    player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, MIND_BAR_GROUP, 1);
  }

  function hideMindBar(player) {
    player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
  }

  function completeMachinePuzzle(player, machine) {
    setMachineProgress(player, machine, MACHINE_WORKING);
    player.getPacketSender().sendInterfaceRemoval();
    openPuzzle.delete(player);
    player.sendMessage(machine === "cage" ? "The cage is complete!" : "The machine is working!");
    if (allMachinesWorking(player)) {
      if (quest.getStage(player) === STAGE_ADMITTED) quest.setStage(player, STAGE_MACHINES_FIXED);
      player.sendMessage("The tower should be in working order now! Best go and tell Effigy!");
    }
  }

  // Pressure machine -----------------------------------------------------------------
  // The hole of every tube is the level the cache's pressure render (clientscript 2763)
  // draws differently: balls 1 and 2 sit in their hole at level 2, balls 3 and 4 at
  // level 3. A ball plugs the hole as soon as it reaches that level, from either side -
  // Quest Helper's pressureSolver reaches ball 3's hole from below and ball 4's from
  // above, so the plug cannot depend on the direction of travel. The plug latches: the
  // ball is still raised to the top afterwards to fill the tube.
  const PRESSURE_PLUG_LEVEL = [2, 2, 3, 3];
  const PRESSURE_START_LEVEL = [4, 4, 0, 0];

  function freshPressurePuzzle() {
    return {
      levels: [...PRESSURE_START_LEVEL],
      plugged: [false, false, false, false],
      levers: [0, 0],
    };
  }

  function pressurePuzzle(player, create = false) {
    let state = readPuzzle(player, PRESSURE_PUZZLE_ATTRIBUTE);
    if (!state && create) {
      state = freshPressurePuzzle();
      player.setAttribute(PRESSURE_PUZZLE_ATTRIBUTE, state);
    }
    return state;
  }

  function sendPressurePuzzle(player, state) {
    if (!state) return;
    state.levels.forEach((level, index) => sendVarbit(player, VARBIT_PRES_LEVELS[index], level));
    state.plugged.forEach((plugged, index) => sendVarbit(player, VARBIT_PRES_PLUGGED[index], plugged ? 1 : 0));
    state.levers.forEach((lever, index) => sendVarbit(player, VARBIT_PRES_LEVERS[index], lever));
  }

  function pressureBallFilled(state, index) {
    return state.plugged[index] && state.levels[index] === 5;
  }

  function pressureUnlocked(state, index) {
    for (let earlier = 0; earlier < index; earlier++) {
      if (!pressureBallFilled(state, earlier)) return false;
    }
    if (index < 2) return state.levers[0] === (index === 1 ? 1 : 0);
    return state.levers[1] === (index === 3 ? 1 : 0);
  }

  function pressureSolved(state) {
    return [0, 1, 2, 3].every((index) => pressureBallFilled(state, index));
  }

  function pressureWheel(player, index, delta) {
    const state = pressurePuzzle(player);
    if (!state) return;
    if (!pressureUnlocked(state, index)) {
      player.sendMessage("The valve is locked.");
      return;
    }
    const next = Math.max(0, Math.min(5, state.levels[index] + delta));
    state.levels[index] = next;
    if (!state.plugged[index] && next === PRESSURE_PLUG_LEVEL[index]) {
      state.plugged[index] = true;
      player.sendMessage("The ball plugs into the hole.");
    }
    player.setAttribute(PRESSURE_PUZZLE_ATTRIBUTE, state);
    sendPressurePuzzle(player, state);
    if (pressureSolved(state)) completeMachinePuzzle(player, "pressure");
  }

  function pressureLever(player, index) {
    const state = pressurePuzzle(player);
    if (!state) return;
    state.levers[index] = state.levers[index] ? 0 : 1;
    player.setAttribute(PRESSURE_PUZZLE_ATTRIBUTE, state);
    sendPressurePuzzle(player, state);
  }

  function openPressurePuzzle(player) {
    const state = pressurePuzzle(player, true);
    sendPressurePuzzle(player, state);
    player.getPacketSender().sendInterface(PRESSURE_PUZZLE_GROUP);
    openPuzzle.set(player, "pressure");
  }

  function handlePressureButton(event) {
    if ((event.buttonId >> 16) !== PRESSURE_PUZZLE_GROUP) return;
    if (openPuzzle.get(event.player) !== "pressure") return;
    event.handled = true;
    const child = event.buttonId & 0xffff;
    const wheel = new Map([[128, [0, -1]], [129, [0, 1]], [130, [1, -1]], [131, [1, 1]],
      [132, [2, -1]], [133, [2, 1]], [134, [3, -1]], [135, [3, 1]]]);
    if (child === 136) return pressureLever(event.player, 0);
    if (child === 141) return pressureLever(event.player, 1);
    const move = wheel.get(child);
    if (move) pressureWheel(event.player, move[0], move[1]);
  }

  // Pipe machine ---------------------------------------------------------------------
  // The pipe pieces are the model components of the cache's pipe interface (group 511,
  // children 9-13). Each piece owns a family of pipe-piece models in the cache; the
  // "correct orientation" model of each family is the id Quest Helper's PuzzleSolver
  // compares the widget model against (22547/22531/22555/22562/22539). The remaining
  // three ids of a family are that piece's other rotations and are taken from the same
  // cache model family, so the client renders a real pipe piece for every rotation.
  // The starting layout follows the wiki's quick guide: every piece starts correctly
  // oriented except the big bend, which starts one rotation off (the wiki's "the largest
  // piece needs one rotation"). The targets are Quest Helper's solved coordinates.
  const PIPE_PIECES = [
    { child: 9, startX: 47, startY: 165, targetX: 159, targetY: 69, targetRotation: 0, activeVarbit: 3343, models: [22547, 22544, 22538, 22549] },
    { child: 10, startX: 35, startY: 160, targetX: 83, targetY: 80, targetRotation: 0, activeVarbit: 3341, models: [22531, 22526, 22528, 22533] },
    { child: 11, startX: 48, startY: 172, targetX: 256, targetY: 60, targetRotation: 0, activeVarbit: 3344, models: [22555, 22546, 22552, 22557] },
    { child: 12, startX: 45, startY: 171, targetX: 237, targetY: 155, targetRotation: 1, activeVarbit: 3345, models: [22554, 22562, 22560, 22564] },
    { child: 13, startX: 46, startY: 160, targetX: 126, targetY: 64, targetRotation: 0, activeVarbit: 3342, models: [22539, 22530, 22536, 22540] },
  ];
  const PIPE_PIECE_BY_CHILD = new Map(PIPE_PIECES.map((piece, index) => [piece.child, index]));

  function freshPipePuzzle() {
    return {
      pieces: PIPE_PIECES.map((piece) => ({
        x: piece.startX,
        y: piece.startY,
        rotation: 0,
        placed: false,
      })),
      active: null,
    };
  }

  function pipePuzzle(player, create = false) {
    let state = readPuzzle(player, PIPE_PUZZLE_ATTRIBUTE);
    if (!state && create) {
      state = freshPipePuzzle();
      player.setAttribute(PIPE_PUZZLE_ATTRIBUTE, state);
    }
    return state;
  }

  function sendPipePuzzle(player, state) {
    if (!state) return;
    const sender = player.getPacketSender();
    state.pieces.forEach((piece, index) => {
      const target = PIPE_PIECES[index];
      // The piece varbits mark the piece that is currently in hand (Quest Helper reads
      // them to find out which piece to rotate or move); every other piece reads 0.
      sendVarbit(player, target.activeVarbit, state.active === index && !piece.placed ? 1 : 0);
      sender.sendInterfaceRawModel((PIPE_PUZZLE_GROUP << 16) | target.child, target.models[piece.rotation]);
      sender.sendInterfacePosition((PIPE_PUZZLE_GROUP << 16) | target.child, piece.x, piece.y);
    });
    // The cache's only pipe rotation varbit (tol_pipe5_rot, varp 977 bits 16-17) mirrors
    // the rotation of the piece that is in hand.
    const held_ = state.active === null ? null : state.pieces[state.active];
    sendVarbit(player, VARBIT_PIPE_ROTATION, held_ && !held_.placed ? held_.rotation : 0);
  }

  function tryPlacePipe(player, state, index) {
    const target = PIPE_PIECES[index];
    const piece = state.pieces[index];
    if (piece.placed) return false;
    if (Math.abs(piece.x - target.targetX) > 4 || Math.abs(piece.y - target.targetY) > 4) return false;
    if (piece.rotation !== target.targetRotation) {
      player.sendMessage(PIECE_DOES_NOT_FIT);
      return false;
    }
    piece.placed = true;
    state.active = null;
    player.setAttribute(PIPE_PUZZLE_ATTRIBUTE, state);
    sendPipePuzzle(player, state);
    if (state.pieces.every((entry) => entry.placed)) completeMachinePuzzle(player, "pipe");
    return true;
  }

  function openPipePuzzle(player) {
    const state = pipePuzzle(player, true);
    sendPipePuzzle(player, state);
    player.getPacketSender().sendInterface(PIPE_PUZZLE_GROUP);
    openPuzzle.set(player, "pipe");
  }

  function handlePipeButton(event) {
    if ((event.buttonId >> 16) !== PIPE_PUZZLE_GROUP) return;
    if (openPuzzle.get(event.player) !== "pipe") return;
    const { player } = event;
    const state = pipePuzzle(player);
    if (!state) return;
    event.handled = true;
    const child = event.buttonId & 0xffff;
    const selected = PIPE_PIECE_BY_CHILD.get(child);
    if (selected !== undefined) {
      if (!state.pieces[selected].placed) {
        state.active = selected;
        player.setAttribute(PIPE_PUZZLE_ATTRIBUTE, state);
        sendPipePuzzle(player, state);
      }
      return;
    }
    if (state.active === null) return;
    const piece = state.pieces[state.active];
    if (piece.placed) return;
    if (child === 15) {
      piece.rotation = (piece.rotation + 1) % 4;
      // The cache's only pipe rotation varbit (tol_pipe5_rot, varp 977 bits 16-17).
      sendVarbit(player, VARBIT_PIPE_ROTATION, piece.rotation);
    } else if (child === 17) piece.x -= 16;
    else if (child === 19) piece.x += 16;
    else if (child === 21) piece.y -= 16;
    else if (child === 23) piece.y += 16;
    else return;
    player.setAttribute(PIPE_PUZZLE_ATTRIBUTE, state);
    if (!tryPlacePipe(player, state, state.active)) sendPipePuzzle(player, state);
  }

  // Cage puzzle ----------------------------------------------------------------------
  const CAGE_SOLUTION = [
    [{ o: "h", size: 2, model: 22469, child: 7 }, { o: "h", size: 2, model: 22472, child: 8 }, { o: "v", size: 2, model: 22475, child: 9 }],
    [{ o: "v", size: 2, model: 22480, child: 12 }, { o: "h", size: 3, model: 22483, child: 13 }, { o: "h", size: 2, model: 22486, child: 14 }],
    [{ o: "v", size: 2, model: 22491, child: 17 }, { o: "v", size: 4, model: 22494, child: 18 }, { o: "h", size: 2, model: 22497, child: 19 }],
    [{ o: "h", size: 4, model: 22502, child: 22 }, { o: "v", size: 2, model: 22505, child: 23 }, { o: "v", size: 3, model: 22508, child: 24 }],
  ];
  const CAGE_SIDE_CHILDREN = [5, 10, 15, 20];

  function freshCagePuzzle() {
    return {
      side: 0,
      bar: 0,
      orientation: "h",
      size: 1,
      solved: CAGE_SOLUTION.map((side) => side.map(() => false)),
    };
  }

  function cagePuzzle(player, create = false) {
    let state = readPuzzle(player, CAGE_PUZZLE_ATTRIBUTE);
    if (!state && create) {
      state = freshCagePuzzle();
      player.setAttribute(CAGE_PUZZLE_ATTRIBUTE, state);
    }
    return state;
  }

  function renderCagePuzzle(player, state) {
    if (!state) return;
    const sender = player.getPacketSender();
    CAGE_SIDE_CHILDREN.forEach((child, side) => {
      sender.sendInterfaceDisplayState((CAGE_PUZZLE_GROUP << 16) | child, side !== state.side);
    });
    sender.sendInterfaceDisplayState((CAGE_PUZZLE_GROUP << 16) | 38, state.orientation !== "h");
    sender.sendInterfaceDisplayState((CAGE_PUZZLE_GROUP << 16) | 40, state.orientation !== "v");
    sender.sendString(String(state.size), (CAGE_PUZZLE_GROUP << 16) | 56);
    state.solved.forEach((side, sideIndex) => side.forEach((solved, barIndex) => {
      if (!solved) return;
      const target = CAGE_SOLUTION[sideIndex][barIndex];
      sender.sendInterfaceRawModel?.((CAGE_PUZZLE_GROUP << 16) | target.child, target.model);
    }));
  }

  function cageSolved(state) {
    return state.solved.every((side) => side.every(Boolean));
  }

  function openCagePuzzle(player) {
    const state = cagePuzzle(player, true);
    renderCagePuzzle(player, state);
    player.getPacketSender().sendInterface(CAGE_PUZZLE_GROUP);
    openPuzzle.set(player, "cage");
  }

  function handleCageButton(event) {
    if ((event.buttonId >> 16) !== CAGE_PUZZLE_GROUP) return;
    if (openPuzzle.get(event.player) !== "cage") return;
    const { player } = event;
    const state = cagePuzzle(player);
    if (!state) return;
    event.handled = true;
    const child = event.buttonId & 0xffff;
    if (child === 26 || child === 29) {
      state.side = (state.side + (child === 29 ? 1 : 3)) % 4;
      const nextBar = state.solved[state.side].findIndex((solved) => !solved);
      state.bar = nextBar === -1 ? 2 : nextBar;
    } else if (child === 41) {
      state.orientation = "h";
    } else if (child === 44) {
      state.orientation = "v";
    } else if (child === 49) {
      state.size = Math.max(1, state.size - 1);
    } else if (child === 52) {
      state.size = Math.min(4, state.size + 1);
    } else if (child === 32) {
      const target = CAGE_SOLUTION[state.side][state.bar];
      if (target && !state.solved[state.side][state.bar] &&
          target.o === state.orientation && target.size === state.size) {
        state.solved[state.side][state.bar] = true;
        state.bar = Math.min(2, state.bar + 1);
      } else {
        player.sendMessage(BAR_DOES_NOT_FIT);
      }
    } else {
      return;
    }
    player.setAttribute(CAGE_PUZZLE_ATTRIBUTE, state);
    renderCagePuzzle(player, state);
    if (cageSolved(state)) completeMachinePuzzle(player, "cage");
  }

  function handlePuzzleButton(event) {
    const group = event.buttonId >> 16;
    if (group === PRESSURE_PUZZLE_GROUP) return handlePressureButton(event);
    if (group === PIPE_PUZZLE_GROUP) return handlePipeButton(event);
    if (group === CAGE_PUZZLE_GROUP) return handleCageButton(event);
  }

  function handlePuzzleClosed(event) {
    if (event.interfaceId === PRESSURE_PUZZLE_GROUP || event.interfaceId === PIPE_PUZZLE_GROUP ||
        event.interfaceId === CAGE_PUZZLE_GROUP) {
      openPuzzle.delete(event.player);
    }
  }

  function openMachinePuzzle(player, machine) {
    if (machine === "pressure") return openPressurePuzzle(player);
    if (machine === "pipe") return openPipePuzzle(player);
    return openCagePuzzle(player);
  }

  /** The transcript closure removes the main interface, so open the puzzle next tick. */
  function openMachinePuzzleDeferred(player, machine) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      openMachinePuzzle(player, machine);
      return;
    }
    TaskManager.submit(new CountdownTask(player, 1, () => {
      if (player.isRegistered?.() === false) return;
      openMachinePuzzle(player, machine);
    }));
  }

  function hasHammer(player) {
    return holdsAny(player, HAMMER_ITEM_IDS);
  }

  function hasSaw(player) {
    return holdsAny(player, SAW_ITEM_IDS);
  }

  function hasMachineMaterials(player, machine) {
    if (!hasHammer(player) || !hasSaw(player)) return false;
    return MACHINE_MATERIALS[machine].every(([itemId, count]) => held(player, itemId, count));
  }

  function consumeMachineMaterials(player, machine) {
    for (const [itemId, count] of MACHINE_MATERIALS[machine]) {
      player.getInventory().deleteNumber(itemId, count);
    }
  }

  function missingMaterialsMessage(player, machine) {
    const parts = [];
    for (const [itemId, count, label] of MACHINE_MATERIALS[machine]) {
      const missing = count - player.getInventory().getAmount(itemId);
      if (missing > 0) parts.push(`${missing} ${label}`);
    }
    if (!hasHammer(player)) parts.push("a hammer");
    if (!hasSaw(player)) parts.push("a saw");
    return `You need ${parts.join(", ")} to fix the machine.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped the alchemists finish the Tower of Life and</str>",
        "<str>watched them create a living Homunculus.</str>",
        "<str>I freed it from the alchemists and met it in the dungeon.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage <= 0) {
      return [
        "I can start this quest by talking to <col=800000>Effigy</col> at the",
        "<col=800000>Tower of Life</col>, south of East Ardougne.",
        "",
        "I need a <col=800000>Construction level of 10</col> to begin.",
      ];
    }
    const lines = [];
    if (stage >= STAGE_STARTED) {
      lines.push("<str>Effigy told me the alchemists need help finishing</str>");
      lines.push("<str>the Tower of Life; the builders have gone on strike.</str>");
    }
    if (stage === STAGE_STARTED || stage === STAGE_OUTFIT) {
      lines.push("");
      lines.push("I should speak to <col=800000>Bonafido</col>, the head builder,");
      lines.push("and convince him to get back to work.");
      if (stage >= STAGE_OUTFIT) {
        lines.push("");
        lines.push("He will let me in if I wear a builder's costume:");
        lines.push("a hard hat, a shirt, some trousers and some boots.");
        lines.push(outfitJournalLine(player, FLAG_HAT, "hard hat"));
        lines.push(outfitJournalLine(player, FLAG_SHIRT, "shirt"));
        lines.push(outfitJournalLine(player, FLAG_TROUSERS, "trousers"));
        lines.push(outfitJournalLine(player, FLAG_BOOTS, "boots"));
      }
      return lines;
    }
    if (stage < STAGE_MACHINES_FIXED) {
      lines.push("");
      lines.push("I need to repair the pressure machine, the pipe system");
      lines.push("and the strange cage. A hammer and a saw are needed, and");
      lines.push("the materials are in the crates on the ground floor.");
      lines.push("");
      lines.push(machineJournalLine(player, "pressure machine"));
      lines.push(machineJournalLine(player, "pipe system"));
      lines.push(machineJournalLine(player, "cage"));
      return lines;
    }
    if (stage < STAGE_TOLD_EFFIGY) {
      lines.push("");
      lines.push("<str>I repaired all three of the tower's machines.</str>");
      lines.push("");
      lines.push("I should tell <col=800000>Effigy</col> that the tower is finished.");
      return lines;
    }
    if (stage < STAGE_CREATED) {
      lines.push("");
      lines.push("<str>The tower is repaired and Effigy has gone to the top.</str>");
      lines.push("");
      lines.push("I should follow the alchemists to the <col=800000>top of the tower</col>.");
      return lines;
    }
    if (stage < STAGE_HOMUNCULUS) {
      lines.push("");
      lines.push("<str>The alchemists have created a living Homunculus.</str>");
      lines.push("");
      lines.push("I should confront the alchemists downstairs.");
      return lines;
    }
    if (stage < STAGE_FREED) {
      lines.push("");
      lines.push("<str>The Homunculus is confused and trapped in its cage.</str>");
      lines.push("");
      lines.push("I must help it make sense of its mind by steering its");
      lines.push("thoughts towards logic or magic.");
      return lines;
    }
    lines.push("");
    lines.push("<str>I helped the Homunculus order its mind.</str>");
    lines.push("");
    lines.push("I should speak to <col=800000>Effigy</col>, then meet the");
    lines.push("Homunculus in the <col=800000>dungeon</col> below the tower.");
    return lines;
  }

  function outfitJournalLine(player, flag, label) {
    const obtained = hasFlag(player, flag);
    return obtained
      ? `<str>I have the builder's ${label}.</str>`
      : `I still need the builder's <col=800000>${label}</col>.`;
  }

  function machineJournalLine(player, machine) {
    const label = machine === "pipe" ? "pipe system" : machine;
    return machineProgress(player, machine) >= MACHINE_WORKING
      ? `<str>I have repaired the ${label}.</str>`
      : `I still need to repair the <col=800000>${label}</col>.`;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CONSTRUCTION, 1000);
    skills.addExperiences(Skill.CRAFTING, 500);
    skills.addExperiences(Skill.THIEVING, 500);
  }

  /**
   * Durable stages are kept for save compatibility; tol_prog uses the cache progression
   * values that the NPC transforms and Quest Helper's loadSteps keys are keyed on. The
   * scare leg transmits 16, and the cache's quest DB row needs tol_prog 18 for completion.
   */
  const WIRE_STAGE = new Map([
    [0, 0],
    [STAGE_STARTED, 2],
    [STAGE_OUTFIT, 4],
    [STAGE_ADMITTED, 6],
    [STAGE_MACHINES_FIXED, 8],
    [STAGE_TOLD_EFFIGY, 10],
    [STAGE_CREATED, 11],
    [STAGE_HOMUNCULUS, 12],
    [STAGE_FREED, 14],
  ]);
  const WIRE_SCARED = 16;
  const WIRE_DUNGEON = 17;
  const WIRE_COMPLETE = 18;

  function wireStage(stage, player) {
    if (stage >= STAGE_COMPLETE) return WIRE_COMPLETE;
    if (stage === STAGE_FREED && hasFlag(player, FLAG_SCARED)) {
      // The cache's tol_prog progression has a step of its own for the basement
      // conversation (index 17), between the scare (16) and the hand-in (18).
      return hasFlag(player, FLAG_DUNGEON) ? WIRE_DUNGEON : WIRE_SCARED;
    }
    return WIRE_STAGE.get(stage) ?? stage;
  }

  // ---------------------------------------------------------------------------
  // Variant selection
  // ---------------------------------------------------------------------------

  function selectVariant({ npcId, player, npc }) {
    if (EFFIGY_NPC_IDS.has(npcId)) return selectEffigy(player);
    if (npcId === BONAFIDO_NPC_ID) return selectBonafido(player);
    if (TRANSMUTE_NPC_IDS.has(npcId)) return selectTransmute(player);
    if (CURRENCY_NPC_IDS.has(npcId)) return selectCurrency(player);
    if (HOMUNCULUS_NPC_IDS.has(npcId)) return selectHomunculus(player, npc);
    if (npcId === BLACK_EYE_NPC_ID) return selectBlackEye(player);
    if (npcId === NO_FINGERS_NPC_ID) return selectNoFingers(player);
    if (npcId === GUMMY_NPC_ID || npcId === GUNS_NPC_ID) {
      return quest.isComplete(player) ? "standard-dialogue-after-tower-of-life" : null;
    }
    return null;
  }

  function selectEffigy(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "getting-started-the-builders-on-strike-talking-to-effigy-again";
    if (stage > STAGE_HOMUNCULUS) {
      if (!hasFlag(player, FLAG_SCARED)) {
        setFlag(player, FLAG_SCARED);
        sendVarbit(player, VARBIT_HOMONC_PRES, 1);
        sendVarbit(player, VARBIT_STAGE, wireStage(stage, player));
        return "finished-work-freeing-the-homunculus-effigy";
      }
      return "finished-work-confronting-the-alchemists-effigy-talking-to-effigy-again";
    }
    if (stage === STAGE_HOMUNCULUS) return "finished-work-confronting-the-alchemists-effigy-talking-to-effigy-again";
    if (stage >= STAGE_CREATED) {
      if (stage === STAGE_CREATED) quest.setStage(player, STAGE_HOMUNCULUS);
      return "finished-work-confronting-the-alchemists-effigy";
    }
    if (stage >= STAGE_MACHINES_FIXED) {
      if (stage === STAGE_MACHINES_FIXED) quest.setStage(player, STAGE_TOLD_EFFIGY);
      return "finished-work-returning-to-the-alchemists";
    }
    if (stage >= STAGE_ADMITTED) return "unfinished-work-entering-the-tower-of-life-talking-to-effigy-after-entering-the-tower";
    if (stage >= STAGE_STARTED) return "getting-started-the-builders-on-strike-talking-to-effigy-again";
    return "getting-started-the-builders-on-strike";
  }

  function selectBonafido(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-tower-of-life";
    if (stage >= STAGE_HOMUNCULUS) return "finished-work-freeing-the-homunculus-talking-to-bonafido-again";
    if (stage >= STAGE_CREATED) return "finished-work-talking-to-bonafido-again";
    if (stage >= STAGE_MACHINES_FIXED) return "finished-work-talking-to-bonafido";
    if (stage >= STAGE_ADMITTED) return "unfinished-work-entering-the-tower-of-life-talking-to-bonafido-after-entering-the-tower";
    if (stage === STAGE_OUTFIT) return "accessing-the-tower-talking-to-bonafido-again-with-the-full-outfit";
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_OUTFIT);
      return "getting-started-speaking-with-bonafido-the-head-builder";
    }
    return null;
  }

  function selectTransmute(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage > STAGE_HOMUNCULUS) return "finished-work-freeing-the-homunculus-scaring-the-alchemists-transmute-the-alchemist";
    if (stage >= STAGE_HOMUNCULUS) return "finished-work-confronting-the-alchemists-effigy-talking-to-transmute-the-alchemist-again";
    if (stage >= STAGE_CREATED) return "finished-work-confronting-the-alchemists-transmute-the-alchemist";
    if (stage >= STAGE_ADMITTED) return "unfinished-work-entering-the-tower-of-life-talking-to-transmute-the-alchemist-after-entering-the-tower";
    if (stage >= STAGE_STARTED) return "getting-started-the-builders-on-strike-talking-to-transmute-the-alchemist-after-starting";
    return "getting-started-the-builders-on-strike-talking-to-transmute-the-alchemist-before-starting";
  }

  function selectCurrency(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage > STAGE_HOMUNCULUS) return "finished-work-freeing-the-homunculus-scaring-the-alchemists-currency-the-alchemist";
    if (stage >= STAGE_HOMUNCULUS) return "finished-work-confronting-the-alchemists-effigy-talking-to-currency-the-alchemist-again";
    if (stage >= STAGE_CREATED) return "finished-work-confronting-the-alchemists-currency-the-alchemist";
    if (stage >= STAGE_ADMITTED) return "unfinished-work-entering-the-tower-of-life-talking-to-currency-the-alchemist-after-entering-the-tower";
    if (stage >= STAGE_STARTED) return "getting-started-the-builders-on-strike-talking-to-currency-the-alchemist";
    return "getting-started-the-builders-on-strike-talking-to-currency-the-alchemist-before-starting";
  }

  function selectHomunculus(player, npc) {
    const basement = (npc?.getLocation?.()?.getY?.() ?? 0) > 4000;
    const stage = quest.getStage(player);
    if (basement) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_FREED) return "finished-work-finishing-off-talking-to-the-homunculus-in-the-basement";
      return null;
    }
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_FREED) return "finished-work-freeing-the-homunculus-talking-to-the-homunculus-again";
    if (stage === STAGE_HOMUNCULUS) return "finished-work-freeing-the-homunculus-returning-to-it";
    return null;
  }

  function selectBlackEye(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-tower-of-life";
    // A lost hard hat is handed out again, so the flag follows the inventory.
    if (!hasOutfitPiece(player, HARD_HAT_ITEM_ID)) clearFlag(player, FLAG_HAT);
    if (hasFlag(player, FLAG_HAT)) return "accessing-the-tower-obtaining-hard-hat-talking-to-black-eye-again";
    if (stage >= STAGE_OUTFIT) return { page: PAGE, variant: "accessing-the-tower-obtaining-hard-hat" };
    return null;
  }

  function selectNoFingers(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "standard-dialogue-after-tower-of-life";
    // Lost boots can be pickpocketed again, so the flag follows the inventory.
    if (!hasOutfitPiece(player, BOOTS_ITEM_ID)) clearFlag(player, FLAG_BOOTS);
    if (hasFlag(player, FLAG_BOOTS)) return "accessing-the-tower-obtaining-builder-s-boots-talking-to-no-fingers-again";
    if (stage >= STAGE_OUTFIT) {
      sendVarbit(player, VARBIT_NOFINGERS, 1);
      return { page: PAGE, variant: "accessing-the-tower-obtaining-builder-s-boots" };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Dialogue prose
  // ---------------------------------------------------------------------------

  function hasRegularBeer(player) {
    return holdsAny(player, BEER_ITEM_IDS);
  }

  function makingHistoryComplete(player) {
    const request = { player, key: "making_history", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    if (typeof request.complete === "boolean") return request.complete;
    return readInt(player, MAKING_HISTORY_ATTRIBUTE) >= 2;
  }

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!stepId) return null;
    switch (stepId) {
      case MAKING_HISTORY_CONDITION_ID:
        return makingHistoryComplete(player);
      case GUNS_NO_BEER_CONDITION_ID:
        return !hasRegularBeer(player);
      case GUNS_HAS_BEER_CONDITION_ID:
        return hasRegularBeer(player);
      case GUNS_AGAIN_CONDITION_ID:
        return gunsDrinkContext.get(player) === "again";
      case GUNS_NONREGULAR_CONDITION_ID:
        return gunsDrinkContext.get(player) === "nonregular";
      case GUNS_TANKARD_CONDITION_ID:
        return gunsDrinkContext.get(player) === "tankard";
      case GUNS_NOTED_CONDITION_ID:
        return gunsDrinkContext.get(player) === "noted";
      case PLANT_HAS_TROUSERS_CONDITION_ID:
        return trousersPlant.get(player) === true;
      case PLANT_NO_TROUSERS_CONDITION_ID:
        return trousersPlant.get(player) !== true;
      case BONAFIDO_OUTFIT_CONDITION_ID:
        return !wearingBuilderOutfit(player);
      case CRATE_NOTHING_CONDITION_ID:
        return crateEmpty.get(player) === true;
      case PRESSURE_MISSING_CONDITION_ID:
        return !hasMachineMaterials(player, "pressure");
      case PIPE_MISSING_CONDITION_ID:
        return !hasMachineMaterials(player, "pipe");
      case CAGE_MISSING_CONDITION_ID:
        return !hasMachineMaterials(player, "cage");
      case PRESSURE_FIXED_CONDITION_ID:
      case PIPE_FIXED_CONDITION_ID:
      case CAGE_FIXED_CONDITION_ID:
      case PRESSURE_LAST_CONDITION_ID:
      case PIPE_LAST_CONDITION_ID:
      case CAGE_LAST_CONDITION_ID:
        return false;
      default:
        break;
    }
    const index = MIND_QUESTION_INDEX.get(stepId);
    if (index === undefined) return null;
    const current = ((readInt(player, MIND_STEP_ATTRIBUTE) % MIND_QUESTIONS.length) + MIND_QUESTIONS.length) % MIND_QUESTIONS.length;
    if (index !== current) return false;
    pendingQuestion.set(player, index);
    return true;
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId === BONAFIDO_NPC_ID && option === BONAFIDO_QUIZ_FINAL_OPTION) {
      if (quest.getStage(player) === STAGE_OUTFIT) quest.setStage(player, STAGE_ADMITTED);
      return;
    }
    if (!HOMUNCULUS_NPC_IDS.has(npcId)) return;
    const index = pendingQuestion.get(player);
    if (index === undefined) return;
    pendingQuestion.delete(player);
    const delta = MIND_QUESTIONS[index].answers.get(String(option ?? "").trim());
    if (delta === undefined) return;
    player.setAttribute(MIND_ALIGN_ATTRIBUTE, readInt(player, MIND_ALIGN_ATTRIBUTE) + delta);
    player.setAttribute(MIND_STEP_ATTRIBUTE, readInt(player, MIND_STEP_ATTRIBUTE) + 1);
    setFlag(player, FLAG_MIND_STARTED);
    sendMindAlignment(player);
  }

  function handleStartHook(event) {
    if (event.hook !== START_HOOK || !EFFIGY_NPC_IDS.has(event.npcId)) return;
    const { player } = event;
    if (quest.getStage(player) !== 0) return;
    if (player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION) < CONSTRUCTION_REQUIREMENT) {
      player.sendMessage(`You need a Construction level of ${CONSTRUCTION_REQUIREMENT} to start this quest.`);
      return;
    }
    quest.setStage(player, STAGE_STARTED);
  }

  function handleTranscriptAction(event) {
    const { player, stepId } = event;
    if (!stepId) return;
    if (SKIPPED_ACTION_IDS.has(stepId)) {
      event.handled = true;
      return;
    }
    switch (stepId) {
      case RECEIVE_HARD_HAT_ACTION_ID:
        event.handled = true;
        if (!held(player, HARD_HAT_ITEM_ID) && giveItem(player, HARD_HAT_ITEM_ID)) setFlag(player, FLAG_HAT);
        return;
      case RECEIVE_SHIRT_ACTION_ID:
        event.handled = true;
        if (!held(player, SHIRT_ITEM_ID) && giveItem(player, SHIRT_ITEM_ID)) {
          for (const beerId of BEER_ITEM_IDS) {
            if (held(player, beerId)) {
              player.getInventory().deleteNumber(beerId, 1);
              break;
            }
          }
          setFlag(player, FLAG_SHIRT);
        }
        return;
      case RECEIVE_TROUSERS_ACTION_ID:
        event.handled = true;
        if (!held(player, TROUSERS_ITEM_ID) && giveItem(player, TROUSERS_ITEM_ID)) setFlag(player, FLAG_TROUSERS);
        return;
      case RECEIVE_BOOTS_ACTION_ID:
        event.handled = true;
        if (!held(player, BOOTS_ITEM_ID) && giveItem(player, BOOTS_ITEM_ID)) setFlag(player, FLAG_BOOTS);
        return;
      default:
        break;
    }
    if (stepId === MIND_BAR_OPEN_ACTION_ID) {
      event.handled = true;
      showMindBar(player);
      return;
    }
    if (stepId === MIND_FIXED_ACTION_ID) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_HOMUNCULUS) {
        event.end = true;
        return;
      }
      if (Math.abs(readInt(player, MIND_ALIGN_ATTRIBUTE)) >= MIND_ALIGNMENT_THRESHOLD) {
        quest.setStage(player, STAGE_FREED);
        hideMindBar(player);
      } else {
        event.end = true;
      }
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_FREED) quest.complete(player);
      return;
    }
    const machine = MACHINE_BY_ACTION.get(stepId);
    if (!machine) return;
    if (stepId === BUILD_PRESSURE_ACTION_ID || stepId === BUILD_PIPE_ACTION_ID || stepId === BUILD_CAGE_ACTION_ID) {
      event.handled = true;
      consumeMachineMaterials(player, machine);
      setMachineProgress(player, machine, MACHINE_BUILT);
      return;
    }
    if (stepId === PRESSURE_NEED_MESSAGE_ID || stepId === PIPE_NEED_MESSAGE_ID || stepId === CAGE_NEED_MESSAGE_ID) {
      event.handled = true;
      player.sendMessage(missingMaterialsMessage(player, machine));
      return;
    }
    if (stepId === OPEN_PRESSURE_ACTION_ID || stepId === OPEN_PIPE_ACTION_ID || stepId === OPEN_CAGE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      openMachinePuzzleDeferred(player, machine);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  function handleNpcInteraction(event) {
    const { npcId, player, clickType } = event;
    if (clickType === 1 && npcId === GUMMY_NPC_ID) {
      // The trousers are renewable: a lost pair can be searched for again.
      if (quest.getStage(player) >= STAGE_OUTFIT && quest.getStage(player) < STAGE_COMPLETE && !hasOutfitPiece(player, TROUSERS_ITEM_ID)) {
        clearFlag(player, FLAG_TROUSERS);
        event.handled = true;
        startTranscript(api, player, GUMMY_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-trousers");
      }
      return;
    }
    if (clickType === 1 && npcId === GUNS_NPC_ID) {
      // The shirt is renewable: The Guns pours another beer for a lost shirt.
      if (quest.getStage(player) >= STAGE_OUTFIT && quest.getStage(player) < STAGE_COMPLETE && !hasOutfitPiece(player, SHIRT_ITEM_ID)) {
        clearFlag(player, FLAG_SHIRT);
        event.handled = true;
        startTranscript(api, player, GUNS_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-shirt");
      }
      return;
    }
    if (clickType === 3 && npcId === NO_FINGERS_NPC_ID) {
      // The boots are renewable: they can be pickpocketed again.
      if (quest.getStage(player) >= STAGE_OUTFIT && quest.getStage(player) < STAGE_COMPLETE && !hasOutfitPiece(player, BOOTS_ITEM_ID)) {
        clearFlag(player, FLAG_BOOTS);
        event.handled = true;
        startTranscript(api, player, NO_FINGERS_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-boots-stealing-the-boots");
      }
      return;
    }
    if (clickType !== 1 || !HOMUNCULUS_NPC_IDS.has(npcId)) return;
    const basement = (event.npc?.getLocation?.()?.getY?.() ?? 0) > 4000;
    if (basement || quest.getStage(player) !== STAGE_HOMUNCULUS) return;
    if (!hasFlag(player, FLAG_MIND_STARTED)) return;
    // Repeat talks during the mind puzzle skip the lead-in but keep the imported
    // uGmjY6 action that opens the mind-bar overlay, then the next unanswered question.
    // The terminal MIND_FIXED action and closing lines stay in the transcript.
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npc: event.npc,
      npcId,
      variant: "finished-work-freeing-the-homunculus-returning-to-it",
      select: (steps) => {
        const first = steps.findIndex((step) => step.type === "action" && step.id === MIND_BAR_OPEN_ACTION_ID);
        if (first !== -1) return steps.slice(first);
        const fallback = steps.findIndex((step) => step.type === "condition");
        return fallback === -1 ? steps : steps.slice(fallback);
      },
    });
  }

  function handleItemOnNpc(event) {
    if (event.npcId !== GUNS_NPC_ID) return;
    const { player, itemId } = event;
    event.handled = true;
    const noted = event.item?.getDefinition?.()?.isNoted?.() === true;
    if (!noted && BEER_ITEM_IDS.includes(itemId) && quest.getStage(player) >= STAGE_OUTFIT &&
        quest.getStage(player) < STAGE_COMPLETE && !hasOutfitPiece(player, SHIRT_ITEM_ID)) {
      clearFlag(player, FLAG_SHIRT);
      startTranscript(api, player, GUNS_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-shirt");
      return;
    }
    const context = noted && BEER_ITEM_IDS.includes(itemId)
      ? "noted"
      : BEER_TANKARD_ITEM_IDS.has(itemId)
        ? "tankard"
        : hasOutfitPiece(player, SHIRT_ITEM_ID) && BEER_ITEM_IDS.includes(itemId)
          ? "again"
          : "nonregular";
    gunsDrinkContext.set(player, context);
    startTranscript(api, player, GUNS_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-shirt-attempting-to-give-other-beverages");
    gunsDrinkContext.delete(player);
  }

  function machineFor(event) {
    if (event.objectId === PRESSURE_MACHINE_OBJECT_ID) return "pressure";
    if (event.objectId === PIPE_MACHINE_MULTI_OBJECT_ID || event.objectId === PIPE_MACHINE_BROKEN_OBJECT_ID) return "pipe";
    if (event.objectId === CAGE_MULTI_OBJECT_ID || event.objectId === CAGE_BROKEN_OBJECT_ID) return "cage";
    return null;
  }

  function handleMachineFix(event) {
    const machine = machineFor(event);
    if (!machine) return false;
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_ADMITTED) return;
    if (machineProgress(player, machine) >= MACHINE_WORKING || stage >= STAGE_MACHINES_FIXED) {
      player.sendMessage(machine === "cage" ? "The cage is complete!" : "The machine is working!");
      return;
    }
    if (machineProgress(player, machine) === MACHINE_BUILT) {
      openMachinePuzzle(player, machine);
      return;
    }
    startTranscript(api, player, BONAFIDO_NPC_ID, PAGE, MACHINE_VARIANTS[machine]);
  }

  function handleCrateSearch(event) {
    const itemId = CRATE_ITEMS.get(event.objectId);
    if (itemId === undefined) return false;
    event.handled = true;
    const { player } = event;
    const empty = itemId === null;
    if (!empty && !giveItem(player, itemId)) return true;
    crateEmpty.set(player, empty);
    startTranscript(api, player, BONAFIDO_NPC_ID, PAGE, "unfinished-work-searching-the-crates-for-materials");
    crateEmpty.delete(player);
    return true;
  }

  function handlePlantSearch(event) {
    if (event.objectId !== PLANT_OBJECT_ID) return false;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) >= STAGE_OUTFIT && quest.getStage(player) < STAGE_COMPLETE && !hasOutfitPiece(player, TROUSERS_ITEM_ID)) {
      clearFlag(player, FLAG_TROUSERS);
      trousersPlant.set(player, true);
      startTranscript(api, player, BONAFIDO_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-trousers-searching-near-the-tower");
      trousersPlant.delete(player);
      return true;
    }
    player.sendMessage("Nope, nothing here.");
    return true;
  }

  /**
   * The core walks the player onto the door tile before dispatch, so the destination is
   * decided from the side of the wall the player ended on, not by mirroring the click
   * offset: a player inside the wall (y <= 3224) lands outside, a player on or beyond the
   * wall line (y >= 3225) lands inside.
   */
  function crossTowerDoor(player) {
    const inside = player.getLocation().getY() <= TOWER_DOOR_TILE.y - 1;
    player.moveTo(new Location(
      TOWER_DOOR_TILE.x,
      TOWER_DOOR_TILE.y + (inside ? 1 : -1),
      TOWER_DOOR_TILE.z
    ));
  }

  function handleTowerDoorOpen(event) {
    if (event.objectId !== TOWER_DOOR_OBJECT_ID || !atTile(event.location, TOWER_DOOR_TILE)) return false;
    event.handled = true;
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_ADMITTED) {
      player.sendMessage("Only builders are allowed in there, like. You don't look like much ov a builder to me.");
      return true;
    }
    if (stage < STAGE_COMPLETE && !wearingBuilderOutfit(player)) {
      player.sendMessage("Come back to me wearin' a hard hat, some scruffy trousers, a good top and some hard boots. Yow shud fand some around 'ere.");
      return true;
    }
    crossTowerDoor(player);
    if (stage === STAGE_ADMITTED && !hasFlag(player, FLAG_ENTERED)) {
      setFlag(player, FLAG_ENTERED);
      startTranscript(api, player, EFFIGY_NPC_ID, PAGE, "unfinished-work-entering-the-tower-of-life");
    }
    return true;
  }

  function handleTrapdoorOpen(event) {
    if (!TRAPDOOR_OBJECT_IDS.has(event.objectId) || !atTile(event.location, TRAPDOOR_TILE)) return false;
    event.handled = true;
    const { player } = event;
    if (!hasFlag(player, FLAG_TRAPDOOR)) {
      setFlag(player, FLAG_TRAPDOOR);
      sendVarbit(player, VARBIT_TRAPDOOR, 1);
    }
    return true;
  }

  function handleTrapdoorClose(event) {
    if (!TRAPDOOR_OBJECT_IDS.has(event.objectId) || !atTile(event.location, TRAPDOOR_TILE)) return false;
    event.handled = true;
    const { player } = event;
    if (hasFlag(player, FLAG_TRAPDOOR)) {
      clearFlag(player, FLAG_TRAPDOOR);
      sendVarbit(player, VARBIT_TRAPDOOR, 0);
    }
    return true;
  }

  /** The trapdoor and the dungeon ladder are outside the generic climb-link map. */
  function handleClimbClaim(request) {
    const { player } = request;
    const location = request.object?.getLocation?.();
    if (request.objectId === DUNGEON_LADDER_OBJECT_ID && atTile(location, DUNGEON_LADDER_TILE, 1)) {
      request.handled = true;
      // Leaving the dungeon: the wire goes back to the scare step.
      if (hasFlag(player, FLAG_DUNGEON)) {
        clearFlag(player, FLAG_DUNGEON);
        sendVarbit(player, VARBIT_STAGE, wireStage(quest.getStage(player), player));
      }
      api.emitCustomEvent("ladders:climbUp", {
        player,
        object: request.object,
        destination: new Location(TRAPDOOR_TILE.x, TRAPDOOR_TILE.y, TRAPDOOR_TILE.z),
      });
      return;
    }
    if (!TRAPDOOR_OBJECT_IDS.has(request.objectId) || !atTile(location, TRAPDOOR_TILE)) return;
    request.handled = true;
    if (!hasFlag(player, FLAG_SCARED)) {
      player.sendMessage("The trapdoor won't budge.");
      return;
    }
    // Descending into the dungeon is the cache's tol_prog step 17.
    if (!hasFlag(player, FLAG_DUNGEON)) {
      setFlag(player, FLAG_DUNGEON);
      sendVarbit(player, VARBIT_STAGE, wireStage(quest.getStage(player), player));
    }
    api.emitCustomEvent("ladders:climbDown", {
      player,
      object: request.object,
      destination: new Location(DUNGEON_LANDING.x, DUNGEON_LANDING.y, DUNGEON_LANDING.z),
    });
  }

  function handleTopFloorEnter({ player }) {
    if (quest.getStage(player) !== STAGE_TOLD_EFFIGY) return;
    quest.setStage(player, STAGE_CREATED);
    startTranscript(api, player, EFFIGY_NPC_ID, PAGE, "finished-work-going-to-the-top-of-the-tower");
  }

  // ---------------------------------------------------------------------------
  // Login / state
  // ---------------------------------------------------------------------------

  /** ::quest reset (or an old save) leaves the sibling attributes behind; put them back. */
  function reconcileState(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ADMITTED) {
      setMachineProgress(player, "pressure", MACHINE_UNFINISHED);
      setMachineProgress(player, "pipe", MACHINE_UNFINISHED);
      setMachineProgress(player, "cage", MACHINE_UNFINISHED);
      player.setAttribute(PRESSURE_PUZZLE_ATTRIBUTE, null);
      player.setAttribute(PIPE_PUZZLE_ATTRIBUTE, null);
      player.setAttribute(CAGE_PUZZLE_ATTRIBUTE, null);
    }
    if (stage < STAGE_OUTFIT) {
      clearFlag(player, FLAG_HAT);
      clearFlag(player, FLAG_SHIRT);
      clearFlag(player, FLAG_TROUSERS);
      clearFlag(player, FLAG_BOOTS);
    } else {
      // A builder's piece that is no longer held can be obtained again, so the flag
      // that marks it as handed out follows the inventory.
      if (!hasOutfitPiece(player, HARD_HAT_ITEM_ID)) clearFlag(player, FLAG_HAT);
      if (!hasOutfitPiece(player, SHIRT_ITEM_ID)) clearFlag(player, FLAG_SHIRT);
      if (!hasOutfitPiece(player, TROUSERS_ITEM_ID)) clearFlag(player, FLAG_TROUSERS);
      if (!hasOutfitPiece(player, BOOTS_ITEM_ID)) clearFlag(player, FLAG_BOOTS);
    }
    if (stage < STAGE_HOMUNCULUS) {
      clearFlag(player, FLAG_MIND_STARTED);
      player.setAttribute(MIND_ALIGN_ATTRIBUTE, 0);
      player.setAttribute(MIND_STEP_ATTRIBUTE, 0);
    }
    if (stage < STAGE_FREED) {
      clearFlag(player, FLAG_SCARED);
      sendVarbit(player, VARBIT_HOMONC_PRES, 0);
    }
    if (stage < STAGE_TOLD_EFFIGY) clearFlag(player, FLAG_ENTERED);
  }

  function restoreVarbits(player) {
    sendVarbit(player, VARBIT_STAGE, wireStage(quest.getStage(player), player));
    sendVarbit(player, VARBIT_PRESSURE, machineProgress(player, "pressure"));
    sendVarbit(player, VARBIT_PIPE, machineProgress(player, "pipe"));
    sendVarbit(player, VARBIT_CAGE, machineProgress(player, "cage"));
    sendVarbit(player, VARBIT_CAGE_STATE, machineProgress(player, "cage") >= MACHINE_WORKING ? 1 : 0);
    sendPressurePuzzle(player, pressurePuzzle(player, machineProgress(player, "pressure") === MACHINE_BUILT));
    sendPipePuzzle(player, pipePuzzle(player, machineProgress(player, "pipe") === MACHINE_BUILT));
    sendMindAlignment(player);
    if (machineProgress(player, "cage") === MACHINE_BUILT) renderCagePuzzle(player, cagePuzzle(player, true));
    sendVarbit(player, VARBIT_HOMONC_PRES, hasFlag(player, FLAG_SCARED) ? 1 : 0);
    sendVarbit(player, VARBIT_TRAPDOOR, hasFlag(player, FLAG_TRAPDOOR) ? 1 : 0);
  }

  function handleLogin({ player }) {
    openPuzzle.delete(player);
    reconcileState(player);
    refreshQuestList(player);
    restoreVarbits(player);
  }

  quest = registerQuest(api, {
    key: "tower_of_life",
    name: "Tower of Life",
    varpId: 977, // "tol"
    varbitId: VARBIT_STAGE, // 3337 tol_prog, bits 0-4
    varbitValue: wireStage,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 1000, label: "Construction" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 500, label: "Crafting" },
      { skillId: Skill.THIEVING.getIndex(), amount: 500, label: "Thieving" },
    ],
    otherRewards: ["Access to the Creature Creation dungeon"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleTranscriptAction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction("Pressure machine", { Fix: handleMachineFix });
  api.onObjectInteraction("Pipe machine", { Fix: handleMachineFix });
  api.onObjectInteraction("Cage", { Fix: handleMachineFix });
  api.onObjectInteraction("Crate", { Search: handleCrateSearch });
  api.onObjectInteraction("Plant", { Search: handlePlantSearch });
  api.onObjectInteraction("Tower door", { Open: handleTowerDoorOpen });
  api.onObjectInteraction("Trapdoor", { Open: handleTrapdoorOpen, Close: handleTrapdoorClose });
  api.onInterfaceActionButton(PUZZLE_BUTTONS, handlePuzzleButton);
  api.onCustomEvent("interface:closed", handlePuzzleClosed);
  api.onCustomEvent("ladders:climb", handleClimbClaim);
  api.onItemOnNpc(handleItemOnNpc);
  api.onZoneEnter(TOP_FLOOR_ZONE, handleTopFloorEnter);
  api.onPlayerLogin(handleLogin);
};
