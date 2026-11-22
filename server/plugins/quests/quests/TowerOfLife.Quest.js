/**
 * Tower of Life (members), aligned with a whole revision 242.1 run of the quest (the user's RSProx capture
 * TowerOfLife.bin; every fact and tick is in docs/quests/tower-of-life/README.md).
 *
 * The words come from the "Tower of Life" transcript page and the builders' own pages; this plugin picks the
 * variants, answers the transcript's conditions, runs the hand-outs and machine builds, and moves the stage on
 * the lines the capture moves it on. The puzzles are in toweroflife/Puzzles.TowerOfLife.js and the scenes
 * (the alchemists heading up, the creation cutscene and the scare) in toweroflife/Scenes.TowerOfLife.js.
 *
 * Stages are tol_prog's own values (varbit 3337, varp 977 bits 0-4), each set where the capture sets it:
 *   2  "Sure, why not." to Effigy's start question
 *   4  Bonafido's "Okay. Come to me kitted out like a builder..."
 *   6  Bonafido's "Cosmic! ..." after the builder's quiz
 *   8  first time through the tower door
 *  10  Effigy's alchemists go up, two ticks after "Wait! What about-" (all three machines working)
 *  11  the creation cutscene ends
 *  12  Effigy's "Good on you! I knew you would help us!"
 *  14  the Homunculus mind puzzle starts
 *  16  the Homunculus's "Easy. You run down and I watching from here..."
 *  17  the scare ends
 *  18  complete: the Homunculus in the dungeon
 * Saves from before this version (stages 2-16 on another scale) are moved onto it once, at login.
 *
 * Source: the capture above, the OSRS Wiki "Tower of Life" and its quick guide (requirements: 10 Construction,
 * hammer, saw, a regular beer; rewards: 2 Quest points, 1,000 Construction, 500 Crafting, 500 Thieving and
 * Creature Creation access). "Ours:" marks what neither source covers.
 */
const Saws = require("../../items/Saws");
const { createPuzzles } = require("../toweroflife/Puzzles.TowerOfLife");
const { createScenes } = require("../toweroflife/Scenes.TowerOfLife");

module.exports = function registerTowerOfLifeQuest(api) {
  const {
    Animation, DialogueChainBuilder, Equipment, Graphic, ItemIdentifiers, Location, NpcIdentifiers,
    ObjectIdentifiers, Skill, StatementDialogue, ActionDialogue, CountdownTask, TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Tower of Life";
  const START_HOOK = "quest:tower-of-life:start";
  const CONSTRUCTION_REQUIREMENT = 10;

  // NPCs: the tower spawns multi ids 6154-6158 whose tol_prog transform resolves to these.
  const EFFIGY_NPC_IDS = new Set([NpcIdentifiers.EFFIGY, NpcIdentifiers.EFFIGY_2]); // 3585/3586
  const BONAFIDO_NPC_ID = NpcIdentifiers.BONAFIDO; // 3587
  const HOMUNCULUS_MULTI_NPC_IDS = [6155, 6156]; // tol_homonculus_multi, tol_homonculus_multi2 (the tower's spawns)
  const HOMUNCULUS_NPC_IDS = new Set([NpcIdentifiers.HOMUNCULUS, NpcIdentifiers.HOMUNCULUS_2, NpcIdentifiers.HOMUNCULUS_3, ...HOMUNCULUS_MULTI_NPC_IDS]); // 3588-3590
  const TRANSMUTE_NPC_IDS = new Set([NpcIdentifiers.TRANSMUTE_THE_ALCHEMIST, NpcIdentifiers.TRANSMUTE_THE_ALCHEMIST_2]); // 3592/3593
  const CURRENCY_NPC_IDS = new Set([NpcIdentifiers.CURRENCY_THE_ALCHEMIST, NpcIdentifiers.CURRENCY_THE_ALCHEMIST_2]); // 3594/3595
  const EFFIGY_NPC_ID = NpcIdentifiers.EFFIGY;
  const BLACK_EYE_NPC_ID = NpcIdentifiers.BLACK_EYE; // 3596
  const NO_FINGERS_NPC_ID = NpcIdentifiers.NO_FINGERS; // 3597
  const GUMMY_NPC_ID = NpcIdentifiers.GUMMY; // 3598
  const GUNS_NPC_ID = NpcIdentifiers.THE_GUNS; // 3599

  // Varp 977 "tol" / 978 and their varbits.
  const VARBIT_STAGE = 3337; // tol_prog
  const VARBIT_PROGRESS = { pressure: 3338, pipe: 3339, cage: 3340 }; // tol_pres_prog / tol_pipe_prog / tol_cage_prog
  const VARBIT_EXAMINED = { pressure: 3374, pipe: 3373, cage: 3375 }; // tol_examined_*_mach
  const VARBIT_CAGE_STATE = 3354; // tol_cage_state
  const VARBIT_MIND_ALIGN = 3358; // tol_homon_align
  const VARBIT_HOMONC_PRES = 3359; // tol_homonc_pres
  const VARBIT_TRAPDOOR = 3372; // tol_trapdoor_open
  const VARBIT_NOFINGERS = 3376; // tol_nofingers_asked

  const STAGE = Object.freeze({
    STARTED: 2, OUTFIT: 4, BUILDER: 6, ENTERED: 8, UP_TOP: 10, CREATED: 11, HELPING: 12,
    MIND: 14, MIND_FIXED: 16, SCARED: 17, COMPLETE: 18,
  });

  // Objects.
  const PRESSURE_MACHINE_OBJECT_ID = ObjectIdentifiers.PRESSURE_MACHINE; // 21873
  const PIPE_MACHINE_OBJECT_IDS = new Set([21943, ObjectIdentifiers.PIPE_MACHINE]); // tol_pipe_machine_multi -> 21880/21881
  const CAGE_OBJECT_IDS = new Set([21941, ObjectIdentifiers.CAGE_17]); // tol_cage_multi -> 21870/21869
  const TRAPDOOR_OBJECT_IDS = new Set([21944, ObjectIdentifiers.TRAPDOOR_86, ObjectIdentifiers.TRAPDOOR_87]); // tol_trapdoor_multi
  const TOWER_DOOR_OBJECT_ID = ObjectIdentifiers.TOWER_DOOR; // 21814
  // tol_stairs01 (Climb-up) and tol_gapfill01 (Climb-down), by the Ladders event that moves them.
  const TOWER_STAIRS_EVENTS = new Map([[ObjectIdentifiers.STAIRS_90, "ladders:climbUp"], [ObjectIdentifiers.STAIRS_91, "ladders:climbDown"]]);
  const LADDER_OBJECT_ID = 17974; // the tower's top ladder (2647,3221,2) and the dungeon's exit
  const TOWER_DOOR_TILE = { x: 2649, y: 3225, z: 0 };
  const TRAPDOOR_TILE = { x: 2648, y: 3212, z: 0 };
  const TOP_LADDER_TILE = { x: 2647, y: 3221, z: 2 };
  const DUNGEON_LADDER_TILE = { x: 3038, y: 4375, z: 0 };
  const DUNGEON_LANDING = [3038, 4376, 0];
  const DUNGEON_EXIT = [2649, 3212, 0];
  const PLANT_OBJECT_ID = ObjectIdentifiers.PLANT_80; // 21924 tol_plant4
  const CRATE_ITEMS = new Map([
    [ObjectIdentifiers.CRATE_182, ItemIdentifiers.METAL_BAR], // tol_crate01
    [ObjectIdentifiers.CRATE_183, ItemIdentifiers.PIPE_2], // tol_crate02
    [ObjectIdentifiers.CRATE_184, ItemIdentifiers.PIPE_RING], // tol_crate03
    [ObjectIdentifiers.CRATE_185, ItemIdentifiers.RIVETS], // tol_crate04
    [ObjectIdentifiers.CRATE_186, ItemIdentifiers.VALVE_WHEEL], // tol_crate05
    [ObjectIdentifiers.CRATE_187, ItemIdentifiers.METAL_SHEET], // tol_crate06
    [ObjectIdentifiers.CRATE_188, ItemIdentifiers.COLOURED_BALL], // tol_crate07
    [ObjectIdentifiers.CRATE_189, ItemIdentifiers.BINDING_FLUID], // tol_crate08
    [ObjectIdentifiers.CRATE_190, ItemIdentifiers.TRIANGLE_SANDWICH], // tol_crate09
    [ObjectIdentifiers.CRATE_191, ItemIdentifiers.METAL_BAR], // tol_crate10
  ]);

  // Items.
  const HARD_HAT_ITEM_ID = ItemIdentifiers.HARD_HAT; // 10862
  const SHIRT_ITEM_ID = ItemIdentifiers.BUILDERS_SHIRT; // 10863
  const TROUSERS_ITEM_ID = ItemIdentifiers.BUILDERS_TROUSERS; // 10864
  const BOOTS_ITEM_ID = ItemIdentifiers.BUILDERS_BOOTS; // 10865
  const BEER_ITEM_IDS = [ItemIdentifiers.BEER, ItemIdentifiers.BEER_2]; // 1917/1918
  const BEER_TANKARD_ITEM_IDS = new Set([
    ItemIdentifiers.BEER_TANKARD, ItemIdentifiers.BEER_TANKARD_2, ItemIdentifiers.KEG_OF_BEER,
    ItemIdentifiers.KEG_OF_BEER_2, ItemIdentifiers.KEG_OF_BEER_3,
  ]);
  const HAMMER_ITEM_IDS = [ItemIdentifiers.HAMMER, ItemIdentifiers.IMCANDO_HAMMER]; // 2347/25644
  const OUTFIT_SLOTS = [
    [Equipment.HEAD_SLOT, HARD_HAT_ITEM_ID],
    [Equipment.BODY_SLOT, SHIRT_ITEM_ID],
    [Equipment.LEG_SLOT, TROUSERS_ITEM_ID],
    [Equipment.FEET_SLOT, BOOTS_ITEM_ID],
  ];

  // Animations, graphics and sounds (capture ticks in the README).
  const ANIM = Object.freeze({
    RUMMAGE: 5819, YES: 855, SEARCH_PLANT: 5216, SHRUG: 2113, PICKPOCKET: 881, FIX_MACHINE: 5846, PICK_UP: 827,
  });
  const RUMMAGE_GFX = 1025; // tol_player_rummage02, delay 20, height 20 on the crate
  const SOUND = Object.freeze({ PICK: 2581, FIX_MACHINE: 3421, TRAPDOOR_OPEN: 91 });
  const CRATE_TICKS = 8;
  const PLANT_TICKS = 5;
  const BUILD_TICKS = 4;
  const PICKPOCKET_XP = 8;
  /** Ours: the capture found the trousers on the seventh plant searched; the Wiki gives no rate. */
  const TROUSERS_CHANCE = 4;
  const BECKON_MESSAGE = "Try the beckon emote while wearing an item of builders' clothing!";

  // Condition step ids on the "Tower of Life" page.
  const MAKING_HISTORY_CONDITION_ID = "Ezpv06";
  const GUNS_NO_BEER_CONDITION_ID = "6orzAo";
  const GUNS_HAS_BEER_CONDITION_ID = "KQQFN1";
  const GUNS_AGAIN_CONDITION_ID = "8iScoh";
  const GUNS_NONREGULAR_CONDITION_ID = "2ksBt5";
  const GUNS_TANKARD_CONDITION_ID = "jst0Is";
  const GUNS_NOTED_CONDITION_ID = "wn0foC";
  const BONAFIDO_OUTFIT_CONDITION_ID = "dkneOx";
  const MISSING_CONDITION_IDS = new Set(["KdbhRY", "se_YYh", "xyWpju"]);
  const ALWAYS_FALSE_CONDITION_IDS = new Set(["cyNoPv", "uQEvOW", "of5CSL", "Pnl7gq", "MEOTsm", "f0n0HT"]);

  // Action and message step ids.
  const RECEIVE_HARD_HAT_ACTION_ID = "g0D-tI";
  const RECEIVE_SHIRT_ACTION_ID = "d8nl3j";
  const BUILD_ACTIONS = new Map([["GYrrRh", "pressure"], ["7-wU8Y", "pipe"], ["Dl3PuF", "cage"]]);
  const OPEN_ACTIONS = new Map([["VtcfG5", "pressure"], ["ZkpaiW", "pipe"], ["p7AQxw", "cage"]]);
  const MIND_START_MESSAGE_ID = "CrIrBk";
  const MIND_BAR_OPEN_ACTION_ID = "uGmjY6";
  const MIND_FIXED_ACTION_ID = "yA27Qt";
  const COMPLETE_ACTION_ID = "mwkqoc";
  const SKIPPED_ACTION_IDS = new Set(["iKytxw", "9fATGa", "cL-nGr"]);

  const MACHINES = ["pressure", "pipe", "cage"];
  const MACHINE_VARIANTS = {
    pressure: "unfinished-work-fixing-the-pressure-machine",
    pipe: "unfinished-work-fixing-the-pipe-system",
    cage: "unfinished-work-fixing-the-strange-cage",
  };
  /** [item, count, the words "You need ..." uses]: the capture's cage refusal names the first short material. */
  const MACHINE_MATERIALS = {
    pressure: [
      [ItemIdentifiers.COLOURED_BALL, 4, "4 coloured balls"],
      [ItemIdentifiers.METAL_SHEET, 3, "3 pieces of metal sheeting"],
      [ItemIdentifiers.VALVE_WHEEL, 4, "4 valve wheels"],
    ],
    pipe: [
      [ItemIdentifiers.RIVETS, 6, "6 rivets"],
      [ItemIdentifiers.PIPE_2, 4, "4 metal pipes"],
      [ItemIdentifiers.PIPE_RING, 5, "5 metal rings"],
    ],
    cage: [
      [ItemIdentifiers.METAL_BAR, 5, "5 metal bars"],
      [ItemIdentifiers.BINDING_FLUID, 4, "4 bottles of binding fluid"],
    ],
  };
  const MACHINE_UNFINISHED = 0;
  const MACHINE_BUILT = 1;
  const MACHINE_WORKING = 2;

  // Homunculus mind questions, in transcript order; an answer moves the bar +1 (logic), -1 (magic) or not at all.
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
  /** tol_homon_align: 7 when the questions start, 0 fully magical and 14 fully logical (the overlay's 15 arrows). */
  const MIND_START = 7;
  const MIND_MAGIC = 0;
  const MIND_LOGIC = 14;
  const MIND_OVERLAY_GROUP = 508; // tol_homonculus_overlay
  const OVERLAY_HUD_UID = (161 << 16) | 8; // overlay_hud (164:8 in the capture's layout)
  /** neutral_arrow_0..14's components. */
  const MIND_ARROWS = [13, 15, 17, 19, 21, 23, 25, 11, 27, 29, 31, 33, 35, 37, 39];
  const MIND_VARIANT = "finished-work-freeing-the-homunculus-returning-to-it";

  const MAKING_HISTORY_ATTRIBUTE = "quest.making_history.stage";

  // Persisted state (the stage itself is QuestRuntime's stage attribute/varbit).
  const FLAGS_ATTRIBUTE = "quest.tower_of_life.flags";
  const PRESSURE_ATTRIBUTE = "quest.tower_of_life.pressure";
  const PIPE_ATTRIBUTE = "quest.tower_of_life.pipe";
  const CAGE_ATTRIBUTE = "quest.tower_of_life.cage";
  const MIND_ALIGN_ATTRIBUTE = "quest.tower_of_life.mind-align";
  /** 1 once a save's stage is on tol_prog's scale (see migrate). */
  const STAGE_SCALE_ATTRIBUTE = "quest.tower_of_life.stage-scale";
  const MACHINE_ATTRIBUTES = { pressure: PRESSURE_ATTRIBUTE, pipe: PIPE_ATTRIBUTE, cage: CAGE_ATTRIBUTE };

  const FLAG_HAT = 1 << 0;
  const FLAG_SHIRT = 1 << 1;
  const FLAG_TROUSERS = 1 << 2;
  const FLAG_BOOTS = 1 << 3;
  const FLAG_OLD_ENTERED = 1 << 4; // pre-tol_prog saves only
  const FLAG_OLD_SCARED = 1 << 6; // pre-tol_prog saves only
  const FLAG_TRAPDOOR = 1 << 7;
  const FLAG_NOFINGERS_ASKED = 1 << 9;
  const FLAG_EXAMINED = { pressure: 1 << 10, pipe: 1 << 11, cage: 1 << 12 };

  api.persistAttribute(FLAGS_ATTRIBUTE, 0);
  api.persistAttribute(PRESSURE_ATTRIBUTE, 0);
  api.persistAttribute(PIPE_ATTRIBUTE, 0);
  api.persistAttribute(CAGE_ATTRIBUTE, 0);
  api.persistAttribute(MIND_ALIGN_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_SCALE_ATTRIBUTE, 0);

  let quest;

  // Transient context for transcript prose (never persisted).
  const gunsDrinkContext = new WeakMap();
  const pendingQuestion = new WeakMap();
  const mindTalk = new WeakMap();
  const busy = new WeakMap();
  /** The machine build waiting on its four ticks, one per player (never persisted: a logout cancels it). */
  const building = new WeakMap();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const holdsAny = (player, itemIds) => itemIds.some((itemId) => held(player, itemId));
  const readInt = (player, key) => {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value | 0 : 0;
  };
  const sendVarbit = (player, varbitId, value) => player.getPacketSender().sendVarbit(varbitId, value);
  const hasFlag = (player, flag) => (readInt(player, FLAGS_ATTRIBUTE) & flag) !== 0;
  const setFlag = (player, flag) => player.setAttribute(FLAGS_ATTRIBUTE, readInt(player, FLAGS_ATTRIBUTE) | flag);
  const clearFlag = (player, flag) => player.setAttribute(FLAGS_ATTRIBUTE, readInt(player, FLAGS_ATTRIBUTE) & ~flag);
  const stageOf = (player) => quest.getStage(player);

  function later(player, ticks, callback) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      callback();
    }));
  }

  function atTile(location, tile, radius = 0) {
    return Boolean(location) &&
      Math.abs((location.x ?? location.getX?.()) - tile.x) <= radius &&
      Math.abs((location.y ?? location.getY?.()) - tile.y) <= radius &&
      ((location.z ?? location.getZ?.() ?? 0) === tile.z);
  }

  /** Message boxes, one after the other, as live sends them with their own continue. */
  function statements(player, texts, then) {
    const chain = new DialogueChainBuilder();
    texts.forEach((text, index) => chain.add(new StatementDialogue(index, text)));
    if (then) chain.add(new ActionDialogue(texts.length, { execute: () => { player.getPacketSender().sendInterfaceRemoval(); then(); } }));
    player.getDialogueManager().startDialogues(chain);
  }

  function giveItem(player, itemId) {
    if (player.getInventory().getFreeSlots() < 1 && !held(player, itemId)) {
      player.sendMessage("You don't have enough inventory space."); // Ours: no capture with a full pack
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

  // ---------------------------------------------------------------------------
  // Machines
  // ---------------------------------------------------------------------------

  const machineProgress = (player, machine) => readInt(player, MACHINE_ATTRIBUTES[machine]);

  function setMachineProgress(player, machine, value) {
    player.setAttribute(MACHINE_ATTRIBUTES[machine], value);
    sendVarbit(player, VARBIT_PROGRESS[machine], value);
    if (machine === "cage") sendVarbit(player, VARBIT_CAGE_STATE, value >= MACHINE_WORKING && stageOf(player) < STAGE.CREATED ? 1 : 0);
  }

  const allMachinesWorking = (player) => MACHINES.every((machine) => machineProgress(player, machine) >= MACHINE_WORKING);

  /** The puzzle's last move landed: the machine works (capture ticks 1669, 2189, 2579). */
  function machineWorking(player, machine) {
    if (machineProgress(player, machine) >= MACHINE_WORKING) return;
    setMachineProgress(player, machine, MACHINE_WORKING);
    const words = machine === "cage" ? "The cage is complete!" : "The machine is working!";
    player.sendMessage(words);
    Puzzles.close(player);
    const boxes = [words];
    if (allMachinesWorking(player)) boxes.push("The tower should be in working order now! Best go and tell Effigy!");
    statements(player, boxes);
  }

  const Puzzles = createPuzzles(api, { sendVarbit, working: machineWorking });

  const hasHammer = (player) => holdsAny(player, HAMMER_ITEM_IDS);
  /** Held or wielded, Amy's saw included (items/Saws.js, the one rule for a saw). */
  const hasSaw = (player) => Saws.holdsSaw(api.core, player);

  /** The first thing missing, as the capture's "You need 5 metal bars to fix the machine." names it. */
  function missingMaterial(player, machine) {
    for (const [itemId, count, words] of MACHINE_MATERIALS[machine]) {
      if (!held(player, itemId, count)) return words;
    }
    if (!hasHammer(player)) return "a hammer"; // Ours: no capture without a hammer or saw
    if (!hasSaw(player)) return "a saw";
    return null;
  }

  function buildMachine(event, machine) {
    const { player } = event;
    event.handled = true;
    // One build at a time: a second Fix during the four-tick wait must not spend the materials again.
    if (building.has(player) || machineProgress(player, machine) !== MACHINE_UNFINISHED) {
      event.end = true;
      return;
    }
    const missing = missingMaterial(player, machine);
    if (missing) {
      statements(player, [`You need ${missing} to fix the machine.`]);
      return;
    }
    player.performAnimation(new Animation(ANIM.FIX_MACHINE));
    if (machine !== "cage") player.getPacketSender().sendSound(SOUND.FIX_MACHINE, 1, 0);
    // The materials go with the progress, four ticks after the swing (capture ticks 2428-2432).
    const build = { machine };
    building.set(player, build);
    event.wait = (resume) => later(player, BUILD_TICKS, () => {
      if (building.get(player) !== build) return;
      building.delete(player);
      if (machineProgress(player, machine) !== MACHINE_UNFINISHED) return;
      const short = missingMaterial(player, machine);
      if (short) {
        statements(player, [`You need ${short} to fix the machine.`]);
        return;
      }
      for (const [itemId, count] of MACHINE_MATERIALS[machine]) player.getInventory().deleteNumber(itemId, count);
      setMachineProgress(player, machine, MACHINE_BUILT);
      resume();
    });
  }

  function machineFor(objectId) {
    if (objectId === PRESSURE_MACHINE_OBJECT_ID) return "pressure";
    if (PIPE_MACHINE_OBJECT_IDS.has(objectId)) return "pipe";
    if (CAGE_OBJECT_IDS.has(objectId)) return "cage";
    return null;
  }

  function handleMachineFix(event) {
    const machine = machineFor(event.objectId);
    if (!machine) return false;
    event.handled = true;
    const { player } = event;
    if (stageOf(player) < STAGE.ENTERED || building.has(player)) return;
    const progress = machineProgress(player, machine);
    if (progress >= MACHINE_WORKING || stageOf(player) >= STAGE.UP_TOP) {
      player.sendMessage(machine === "cage" ? "The cage is complete!" : "The machine is working!"); // Ours: not captured
      return;
    }
    if (progress === MACHINE_BUILT) {
      // A puzzle finished just before a logout comes back working.
      if (Puzzles.finished(player, machine)) return machineWorking(player, machine);
      Puzzles.openPuzzle(player, machine);
      return;
    }
    if (!hasFlag(player, FLAG_EXAMINED[machine])) {
      setFlag(player, FLAG_EXAMINED[machine]);
      sendVarbit(player, VARBIT_EXAMINED[machine], 1);
    }
    startTranscript(api, player, BONAFIDO_NPC_ID, PAGE, MACHINE_VARIANTS[machine]);
  }

  // ---------------------------------------------------------------------------
  // The Homunculus's mind
  // ---------------------------------------------------------------------------

  const mindAlign = (player) => Math.max(MIND_MAGIC, Math.min(MIND_LOGIC, readInt(player, MIND_ALIGN_ATTRIBUTE)));
  const mindFixed = (player) => [MIND_MAGIC, MIND_LOGIC].includes(mindAlign(player));

  /** tol_homon_align and the overlay's one shown arrow: live hides all fifteen, then shows the one. */
  function sendMind(player) {
    const align = mindAlign(player);
    sendVarbit(player, VARBIT_MIND_ALIGN, align);
    const sender = player.getPacketSender();
    for (const child of MIND_ARROWS) sender.sendInterfaceDisplayState((MIND_OVERLAY_GROUP << 16) | child, true);
    sender.sendInterfaceDisplayState((MIND_OVERLAY_GROUP << 16) | MIND_ARROWS[align], false);
  }

  /** The overlay and the puzzle's camera go together: walking off (capture tick 3143) or the bar at an end (3284). */
  function closeMind(player) {
    mindTalk.delete(player);
    player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID).sendCameraReset();
  }

  /** The overlay goes when the talk does (walking off closes both, capture tick 3143). */
  function watchMind(player, talk) {
    TaskManager.submit(new CountdownTask(player, 1, () => {
      if (mindTalk.get(player) !== talk) return;
      // A question menu is a chatbox prompt, not a dialogue entry: it counts as the talk going on.
      const chatOpen = player.getDialogueManager().isActive?.() === true || !!api.core.MultiChatboxPrompt?.getPending?.(player);
      if (player.isRegistered?.() === false || !chatOpen) {
        closeMind(player);
        return;
      }
      watchMind(player, talk);
    }));
  }

  /** "You must now make sense of the Homunculus's mind...": tol_prog 14, the bar at 7 and the overlay up. */
  function startMind(event) {
    const { player } = event;
    if (stageOf(player) === STAGE.HELPING) quest.setStage(player, STAGE.MIND);
    player.setAttribute(MIND_ALIGN_ATTRIBUTE, MIND_START);
    sendVarbit(player, VARBIT_MIND_ALIGN, MIND_START);
    player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, MIND_OVERLAY_GROUP, 1);
    const sender = player.getPacketSender();
    sender.sendCameraLookAt(2648, 3221, 75, { rate: 10, rate2: 10 }).sendCameraMoveTo(2651, 3212, 550, { rate: 10, rate2: 10 });
    const talk = { answered: 0, next: 0 };
    mindTalk.set(player, talk);
    watchMind(player, talk);
    event.box = { statement: true };
  }

  function answerMind(player, index, option) {
    pendingQuestion.delete(player);
    const delta = MIND_QUESTIONS[index].answers.get(String(option ?? "").trim());
    if (delta === undefined) return;
    const talk = mindTalk.get(player);
    if (talk) talk.next = (index + 1) % MIND_QUESTIONS.length;
    if (talk && talk.answered++ === 0) {
      player.getPacketSender().sendCameraLookAt(2649, 3220, 75, { rate: 100, rate2: 100 }).sendCameraMoveTo(2647, 3213, 550, { rate: 100, rate2: 100 });
    }
    player.setAttribute(MIND_ALIGN_ATTRIBUTE, Math.max(MIND_MAGIC, Math.min(MIND_LOGIC, mindAlign(player) + delta)));
    sendMind(player);
  }

  /** The questions run on in a loop until the bar reaches an end (capture ticks 3097-3284). */
  function mindFixedAction(event) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) !== STAGE.MIND) {
      event.end = true;
      return;
    }
    if (mindFixed(player)) {
      closeMind(player);
      return;
    }
    if (!mindTalk.has(player)) {
      // The overlay went with the talk: the questions start again from the message box next time.
      event.end = true;
      return;
    }
    api.emitCustomEvent("npc-dialogue:start", {
      player, npc: event.npc, npcId: event.npcId, variant: MIND_VARIANT,
      select: (steps) => steps.slice(steps.findIndex((step) => step.id === MIND_QUESTIONS[0].id)),
    });
  }

  // ---------------------------------------------------------------------------
  // Stage moves on lines
  // ---------------------------------------------------------------------------

  function advanceOn(player, from, to) {
    if (stageOf(player) === from) quest.setStage(player, to);
  }

  /** The capture moves tol_prog with these lines, as they are shown. */
  function handleLine(request) {
    const { player } = request;
    if (Scenes.handleLine(request)) return;
    const text = String(request.text ?? "");
    const npcId = request.npcId;
    if (npcId === BONAFIDO_NPC_ID && text.startsWith("Okay. Come to me kitted out")) advanceOn(player, STAGE.STARTED, STAGE.OUTFIT);
    else if (npcId === BONAFIDO_NPC_ID && text.startsWith("Cosmic!")) advanceOn(player, STAGE.OUTFIT, STAGE.BUILDER);
    else if (EFFIGY_NPC_IDS.has(npcId) && text.startsWith("Good on you! I knew you would help us!")) advanceOn(player, STAGE.CREATED, STAGE.HELPING);
    else if (EFFIGY_NPC_IDS.has(npcId) && text.startsWith("Wait! What about-") && stageOf(player) === STAGE.ENTERED) Scenes.toTheTop(request);
    else if (HOMUNCULUS_NPC_IDS.has(npcId) && text.startsWith("Easy. You run down")) advanceOn(player, STAGE.MIND, STAGE.MIND_FIXED);
    else if (text === "Stay calm, let's do this." && stageOf(player) === STAGE.MIND) {
      // The re-talk's "jump above" goes back to the message box and the questions (capture ticks 3145-3152).
      request.after = () => api.emitCustomEvent("npc-dialogue:start", {
        player, npc: request.npc, npcId, variant: MIND_VARIANT,
        select: (steps) => steps.slice(steps.findIndex((step) => step.id === MIND_START_MESSAGE_ID)),
      });
    }
    else if (HOMUNCULUS_NPC_IDS.has(npcId) && text === "I decided to root for magic." && mindAlign(player) === MIND_LOGIC) {
      request.text = "I decided to root for logic.";
    }
  }

  /**
   * A scene ends from its last line's continue: a close (Esc) or a world click that dropped the chat would leave the
   * player in it (Misthalin Mystery's protectScene does the same).
   */
  function protectScene(event) {
    if (Scenes.isPlaying(event.player)) event.handled = true;
  }

  // ---------------------------------------------------------------------------
  // Variant selection
  // ---------------------------------------------------------------------------

  function selectVariant({ npcId, player, npc }) {
    if (EFFIGY_NPC_IDS.has(npcId)) return selectEffigy(player);
    if (npcId === BONAFIDO_NPC_ID) return selectBonafido(player);
    if (TRANSMUTE_NPC_IDS.has(npcId)) return selectAlchemist(player, "transmute");
    if (CURRENCY_NPC_IDS.has(npcId)) return selectAlchemist(player, "currency");
    if (HOMUNCULUS_NPC_IDS.has(npcId)) return selectHomunculus(player, npc);
    if (npcId === BLACK_EYE_NPC_ID) return selectBlackEye(player);
    if (npcId === NO_FINGERS_NPC_ID) return selectNoFingers(player);
    if (npcId === GUMMY_NPC_ID) return selectBuilder(player, TROUSERS_ITEM_ID, "accessing-the-tower-obtaining-builder-s-trousers");
    if (npcId === GUNS_NPC_ID) return selectBuilder(player, SHIRT_ITEM_ID, "accessing-the-tower-obtaining-builder-s-shirt");
    return null;
  }

  /** A builder's own page before and after their piece; their quest talk while it is still to get. */
  function selectBuilder(player, itemId, questVariant) {
    const stage = stageOf(player);
    if (stage < STAGE.OUTFIT) return "standard-dialogue-before-tower-of-life";
    // A lost piece is handed out again until the quest is done (the door asks for the whole outfit).
    if (stage < STAGE.COMPLETE && !hasOutfitPiece(player, itemId)) return { page: PAGE, variant: questVariant };
    return "standard-dialogue-after-tower-of-life";
  }

  function selectEffigy(player) {
    const stage = stageOf(player);
    if (stage >= STAGE.SCARED || stage === STAGE.UP_TOP) return null;
    if (stage === STAGE.MIND_FIXED) return Scenes.scare(player) ? "finished-work-freeing-the-homunculus-effigy" : null;
    if (stage >= STAGE.HELPING) return "finished-work-confronting-the-alchemists-effigy-talking-to-effigy-again";
    if (stage === STAGE.CREATED) return "finished-work-confronting-the-alchemists-effigy";
    if (stage === STAGE.ENTERED) {
      return allMachinesWorking(player)
        ? "finished-work-returning-to-the-alchemists"
        : "unfinished-work-entering-the-tower-of-life-talking-to-effigy-after-entering-the-tower";
    }
    // Ours: the capture's talks at tol_prog 2 and 4 are not in the transcript data; "Guess what!" is its 6.
    if (stage >= STAGE.STARTED) return "getting-started-the-builders-on-strike-talking-to-effigy-again";
    return "getting-started-the-builders-on-strike";
  }

  function selectBonafido(player) {
    const stage = stageOf(player);
    if (stage >= STAGE.COMPLETE) return "standard-dialogue-after-tower-of-life";
    if (stage >= STAGE.MIND_FIXED) return { page: PAGE, variant: "finished-work-freeing-the-homunculus-talking-to-bonafido-again" };
    if (stage >= STAGE.CREATED) return { page: PAGE, variant: "finished-work-talking-to-bonafido-again" };
    if (stage === STAGE.UP_TOP) return { page: PAGE, variant: "finished-work-talking-to-bonafido" };
    if (stage === STAGE.ENTERED) return { page: PAGE, variant: "unfinished-work-entering-the-tower-of-life-talking-to-bonafido-after-entering-the-tower" };
    if (stage === STAGE.BUILDER) return { page: PAGE, variant: "accessing-the-tower-talking-to-bonafido-again-with-the-full-outfit-talking-to-bonafido-again" };
    if (stage === STAGE.OUTFIT) return { page: PAGE, variant: "accessing-the-tower-talking-to-bonafido-again-with-the-full-outfit" };
    if (stage === STAGE.STARTED) return { page: PAGE, variant: "getting-started-speaking-with-bonafido-the-head-builder" };
    return "standard-dialogue-before-tower-of-life";
  }

  function selectAlchemist(player, which) {
    const stage = stageOf(player);
    const transmute = which === "transmute";
    if (stage >= STAGE.SCARED || stage === STAGE.UP_TOP) return null;
    if (stage === STAGE.MIND_FIXED) {
      return `finished-work-freeing-the-homunculus-scaring-the-alchemists-${transmute ? "transmute" : "currency"}-the-alchemist`;
    }
    if (stage >= STAGE.HELPING) {
      return `finished-work-confronting-the-alchemists-effigy-talking-to-${transmute ? "transmute" : "currency"}-the-alchemist-again`;
    }
    if (stage === STAGE.CREATED) return `finished-work-confronting-the-alchemists-${transmute ? "transmute" : "currency"}-the-alchemist`;
    if (stage === STAGE.ENTERED) {
      return `unfinished-work-entering-the-tower-of-life-talking-to-${transmute ? "transmute" : "currency"}-the-alchemist-after-entering-the-tower`;
    }
    // Ours: the capture's talks at tol_prog 2 and 4 are not in the transcript data; these are its 6.
    if (stage >= STAGE.STARTED) {
      return transmute
        ? "getting-started-the-builders-on-strike-talking-to-transmute-the-alchemist-after-starting"
        : "getting-started-the-builders-on-strike-talking-to-currency-the-alchemist";
    }
    return `getting-started-the-builders-on-strike-talking-to-${transmute ? "transmute" : "currency"}-the-alchemist-before-starting`;
  }

  function selectHomunculus(player, npc) {
    const basement = (npc?.getLocation?.()?.getY?.() ?? 0) > 4000;
    const stage = stageOf(player);
    if (basement) return stage === STAGE.SCARED ? "finished-work-finishing-off-talking-to-the-homunculus-in-the-basement" : null;
    if (stage >= STAGE.MIND_FIXED && stage < STAGE.COMPLETE) return "finished-work-freeing-the-homunculus-talking-to-the-homunculus-again";
    if (stage === STAGE.MIND) return "finished-work-freeing-the-homunculus-leaving-and-talking-to-the-homunculus-before-helping-it";
    if (stage === STAGE.HELPING) return MIND_VARIANT;
    return null;
  }

  function selectBlackEye(player) {
    const stage = stageOf(player);
    if (stage < STAGE.OUTFIT) return "standard-dialogue-before-tower-of-life";
    // A lost hard hat is handed out again until the quest is done, so the flag follows the inventory.
    if (!hasOutfitPiece(player, HARD_HAT_ITEM_ID)) clearFlag(player, FLAG_HAT);
    if (stage >= STAGE.COMPLETE || (stage > STAGE.OUTFIT && hasOutfitPiece(player, HARD_HAT_ITEM_ID))) return "standard-dialogue-after-tower-of-life";
    if (hasFlag(player, FLAG_HAT)) return { page: PAGE, variant: "accessing-the-tower-obtaining-hard-hat-talking-to-black-eye-again" };
    return { page: PAGE, variant: "accessing-the-tower-obtaining-hard-hat" };
  }

  function selectNoFingers(player) {
    const stage = stageOf(player);
    if (stage < STAGE.OUTFIT) return "standard-dialogue-before-tower-of-life";
    // Ours: the capture's "Still looking for boots?" at tol_prog 4 is not in the transcript data.
    if (stage > STAGE.OUTFIT || hasOutfitPiece(player, BOOTS_ITEM_ID)) {
      return stage >= STAGE.COMPLETE
        ? "standard-dialogue-after-tower-of-life"
        : { page: PAGE, variant: "accessing-the-tower-obtaining-builder-s-boots-talking-to-no-fingers-again" };
    }
    return { page: PAGE, variant: "accessing-the-tower-obtaining-builder-s-boots" };
  }

  // ---------------------------------------------------------------------------
  // Conditions, choices and actions
  // ---------------------------------------------------------------------------

  const hasRegularBeer = (player) => holdsAny(player, BEER_ITEM_IDS);

  function makingHistoryComplete(player) {
    const request = { player, key: "making_history", complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    if (typeof request.complete === "boolean") return request.complete;
    return readInt(player, MAKING_HISTORY_ATTRIBUTE) >= 2;
  }

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!stepId) return null;
    if (MISSING_CONDITION_IDS.has(stepId) || ALWAYS_FALSE_CONDITION_IDS.has(stepId)) return false;
    switch (stepId) {
      case MAKING_HISTORY_CONDITION_ID: return makingHistoryComplete(player);
      case GUNS_NO_BEER_CONDITION_ID: return !hasRegularBeer(player);
      case GUNS_HAS_BEER_CONDITION_ID: return hasRegularBeer(player);
      case GUNS_AGAIN_CONDITION_ID: return gunsDrinkContext.get(player) === "again";
      case GUNS_NONREGULAR_CONDITION_ID: return gunsDrinkContext.get(player) === "nonregular";
      case GUNS_TANKARD_CONDITION_ID: return gunsDrinkContext.get(player) === "tankard";
      case GUNS_NOTED_CONDITION_ID: return gunsDrinkContext.get(player) === "noted";
      case BONAFIDO_OUTFIT_CONDITION_ID: return !wearingBuilderOutfit(player);
      default: break;
    }
    const index = MIND_QUESTION_INDEX.get(stepId);
    if (index === undefined) return null;
    // The questions sit in a condition run that plays the first true one: each answer moves on to the
    // next, round and round, until the bar reaches an end.
    const talk = mindTalk.get(player);
    if (stageOf(player) !== STAGE.MIND || mindFixed(player) || !talk || index !== talk.next) return false;
    pendingQuestion.set(player, index);
    return true;
  }

  function handleChoice(event) {
    const { player, option } = event;
    const index = pendingQuestion.get(player);
    if (index !== undefined) answerMind(player, index, option);
  }

  function handleStartHook(event) {
    if (event.hook !== START_HOOK || !EFFIGY_NPC_IDS.has(event.npcId)) return;
    const { player } = event;
    if (stageOf(player) !== 0) return;
    if (player.getSkillManager().getCurrentLevel(Skill.CONSTRUCTION) < CONSTRUCTION_REQUIREMENT) {
      player.sendMessage(`You need a Construction level of ${CONSTRUCTION_REQUIREMENT} to start this quest.`);
      return;
    }
    quest.setStage(player, STAGE.STARTED);
  }

  /** Statement boxes the capture shows as message boxes (the rest of the page's messages are chat lines). */
  const BOX_MESSAGE_IDS = new Set(["mhG9nL", "HTQadB", "ofxoYE", "QPV2Jf"]);
  /**
   * Bonafido's whistle answers: a held message box with the player's emote and an area sound, moving on by itself
   * (capture ticks 925-930, 946-951, 993-996). The transcript's emote steps are played with them.
   */
  const WHISTLES = new Map([
    ["TQBFKO", { animation: 866, sound: 3437, holdTicks: 5 }], // emote_dance, tol_whistle_dance
    ["e5x7Je", { animation: 862, sound: 3438, holdTicks: 5 }], // emote_cheer, tol_whistle_runescape
    ["Wyx8j-", { animation: 5845, sound: 3426, holdTicks: 3 }], // tol_player_whistle_beckon, tol_long_wolf_whistle
  ]);
  const WHISTLE_EMOTE_ACTION_IDS = new Set(["aOahpE", "RCkXwU", "13wIR1"]);
  const WHISTLE_SOUND_RADIUS = 10;

  function whistle(event, { animation, sound, holdTicks }) {
    const { player } = event;
    const at = player.getLocation();
    player.performAnimation(new Animation(animation));
    player.getPacketSender().sendAreaSound(sound, at.getX(), at.getY(), at.getZ(), 1, 0, WHISTLE_SOUND_RADIUS);
    event.box = { statement: true, holdTicks, advance: true };
  }

  function handleTranscriptAction(event) {
    const { player, stepId } = event;
    if (!stepId) return;
    if (event.kind === "message") {
      if (stepId === MIND_START_MESSAGE_ID) return startMind(event);
      if (WHISTLES.has(stepId)) return whistle(event, WHISTLES.get(stepId));
      if (BOX_MESSAGE_IDS.has(stepId) || isMachineMessage(event)) event.box = { statement: true };
      return;
    }
    if (SKIPPED_ACTION_IDS.has(stepId) || WHISTLE_EMOTE_ACTION_IDS.has(stepId)) {
      event.handled = true;
      return;
    }
    if (stepId === RECEIVE_HARD_HAT_ACTION_ID) {
      event.handled = true;
      if (!held(player, HARD_HAT_ITEM_ID) && giveItem(player, HARD_HAT_ITEM_ID)) setFlag(player, FLAG_HAT);
      return;
    }
    if (stepId === RECEIVE_SHIRT_ACTION_ID) {
      event.handled = true;
      if (!held(player, SHIRT_ITEM_ID) && giveItem(player, SHIRT_ITEM_ID)) {
        const beer = BEER_ITEM_IDS.find((beerId) => held(player, beerId));
        if (beer !== undefined) player.getInventory().deleteNumber(beer, 1);
        setFlag(player, FLAG_SHIRT);
      }
      return;
    }
    if (stepId === MIND_BAR_OPEN_ACTION_ID) {
      event.handled = true;
      sendMind(player);
      return;
    }
    if (stepId === MIND_FIXED_ACTION_ID) return mindFixedAction(event);
    if (stepId === COMPLETE_ACTION_ID) {
      event.handled = true;
      event.end = true;
      if (stageOf(player) === STAGE.SCARED) complete(player);
      return;
    }
    const built = BUILD_ACTIONS.get(stepId);
    if (built) return buildMachine(event, built);
    const opened = OPEN_ACTIONS.get(stepId);
    if (opened) {
      event.handled = true;
      event.end = true;
      later(player, 1, () => Puzzles.openPuzzle(player, opened));
    }
  }

  /** The machine pages' messages are all message boxes in the capture (ticks 1568-1590, 1985-2003, 2207-2437). */
  function isMachineMessage(event) {
    return /^(The (machine|cage) appears unfinished|You built the|\d+ (coloured balls|rivets|metal bars)|Looks like the pipes|Some of the bars|The pressure seems)/.test(String(event.text ?? ""));
  }

  function complete(player) {
    // Live clears the puzzle and mind varbits with the completion (capture tick 3442).
    Puzzles.reset(player);
    player.setAttribute(MIND_ALIGN_ATTRIBUTE, 0);
    sendVarbit(player, VARBIT_MIND_ALIGN, 0);
    quest.complete(player);
  }

  // ---------------------------------------------------------------------------
  // Gathering the costume
  // ---------------------------------------------------------------------------

  function searchPlant(event) {
    if (event.objectId !== PLANT_OBJECT_ID) return false;
    event.handled = true;
    const { player } = event;
    if (busy.get(player)) return true;
    busy.set(player, true);
    player.sendMessage("You search the plant...");
    player.performAnimation(new Animation(ANIM.SEARCH_PLANT));
    const stage = stageOf(player);
    const wanted = stage >= STAGE.OUTFIT && stage < STAGE.COMPLETE && !hasOutfitPiece(player, TROUSERS_ITEM_ID);
    const found = wanted && Math.floor(Math.random() * TROUSERS_CHANCE) === 0;
    later(player, PLANT_TICKS, () => {
      busy.delete(player);
      if (!found) {
        player.sendMessage("Nope, nothing here.");
        player.performAnimation(new Animation(ANIM.SHRUG));
        return;
      }
      if (!giveItem(player, TROUSERS_ITEM_ID)) return;
      setFlag(player, FLAG_TROUSERS);
      player.sendMessage(BECKON_MESSAGE);
      statements(player, ["Aha! You find some trousers!"]);
    });
    return true;
  }

  function pickpocketNoFingers(event) {
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE.OUTFIT || stage >= STAGE.COMPLETE || hasOutfitPiece(player, BOOTS_ITEM_ID)) return false; // the ordinary pickpocket
    event.handled = true;
    if (busy.get(player)) return;
    busy.set(player, true);
    player.sendMessage("You attempt to pick the man's pocket.");
    later(player, 1, () => {
      busy.delete(player);
      if (!giveItem(player, BOOTS_ITEM_ID)) return;
      setFlag(player, FLAG_BOOTS);
      player.sendMessage("You pick the man's pocket...and find some boots!");
      player.sendMessage(BECKON_MESSAGE);
      player.performAnimation(new Animation(ANIM.PICKPOCKET));
      player.getPacketSender().sendSound(SOUND.PICK, 1, 0);
      player.getSkillManager().addExperiences(Skill.THIEVING, PICKPOCKET_XP);
    });
  }

  /** "But there's no way I'm giving any to you." sets tol_nofingers_asked (capture tick 679). */
  function noFingersAsked(request) {
    if (request.npcId !== NO_FINGERS_NPC_ID || !String(request.text ?? "").startsWith("But there's no way I'm giving any to you")) return;
    setFlag(request.player, FLAG_NOFINGERS_ASKED);
    sendVarbit(request.player, VARBIT_NOFINGERS, 1);
  }

  function handleItemOnNpc(event) {
    const { player, itemId, npcId } = event;
    if (npcId === NO_FINGERS_NPC_ID && itemId === BOOTS_ITEM_ID) {
      event.handled = true;
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (npcId !== GUNS_NPC_ID) return;
    event.handled = true;
    const noted = event.item?.getDefinition?.()?.isNoted?.() === true;
    const stage = stageOf(player);
    if (!noted && BEER_ITEM_IDS.includes(itemId) && stage >= STAGE.OUTFIT && stage < STAGE.COMPLETE && !hasOutfitPiece(player, SHIRT_ITEM_ID)) {
      clearFlag(player, FLAG_SHIRT);
      startTranscript(api, player, GUNS_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-shirt");
      return;
    }
    const context = noted && BEER_ITEM_IDS.includes(itemId)
      ? "noted"
      : BEER_TANKARD_ITEM_IDS.has(itemId)
        ? "tankard"
        : hasOutfitPiece(player, SHIRT_ITEM_ID) && BEER_ITEM_IDS.includes(itemId) ? "again" : "nonregular";
    gunsDrinkContext.set(player, context);
    startTranscript(api, player, GUNS_NPC_ID, PAGE, "accessing-the-tower-obtaining-builder-s-shirt-attempting-to-give-other-beverages");
    gunsDrinkContext.delete(player);
  }

  // ---------------------------------------------------------------------------
  // The tower
  // ---------------------------------------------------------------------------

  function searchCrate(event) {
    const itemId = CRATE_ITEMS.get(event.objectId);
    if (itemId === undefined) return false;
    event.handled = true;
    const { player } = event;
    if (allMachinesWorking(player) || stageOf(player) >= STAGE.UP_TOP) {
      player.sendMessage("You have no need to search the crates.");
      return true;
    }
    if (busy.get(player)) return true;
    busy.set(player, true);
    player.performAnimation(new Animation(ANIM.RUMMAGE));
    player.getPacketSender().sendGraphic(new Graphic(RUMMAGE_GFX, 20, 20), event.object?.getLocation?.() ?? event.location);
    // Ours: the Wiki says a search can come up empty; all 35 of the capture's found something.
    later(player, CRATE_TICKS, () => {
      busy.delete(player);
      if (!giveItem(player, itemId)) return;
      player.sendMessage("You found something!");
      player.performAnimation(new Animation(ANIM.YES));
    });
    return true;
  }

  /** The Doors plugin asks door:toggle first; on a pass it lets this player through and shuts. */
  function handleTowerDoorToggle(event) {
    if (event.handled || event.objectId !== TOWER_DOOR_OBJECT_ID || !atTile(event.location, TOWER_DOOR_TILE)) return;
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE.BUILDER) {
      event.handled = true;
      statements(player, ["You're going to need permission to enter this building."]);
      return;
    }
    // The tower is south of the door; the outfit is only asked for on the way in.
    const inside = player.getLocation().getY() < TOWER_DOOR_TILE.y;
    if (stage < STAGE.COMPLETE && !inside && !wearingBuilderOutfit(player)) {
      event.handled = true;
      // Ours: not captured (the Wiki asks for the whole outfit to go in); Bonafido's own reminder.
      player.sendMessage("Come back to me wearin' a hard hat, some scruffy trousers, a good top and some hard boots. Yow shud fand some around 'ere.");
      return;
    }
    if (stage === STAGE.BUILDER && !inside) {
      quest.setStage(player, STAGE.ENTERED);
      later(player, 1, () => startTranscript(api, player, EFFIGY_NPC_ID, PAGE, "unfinished-work-entering-the-tower-of-life"));
    }
  }

  function trapdoorLocked(player) {
    statements(player, ["It seems to be locked."]);
  }

  /** The Doors plugin would swing the trapdoor like a door; the quest owns its Open and Close. */
  function handleTrapdoorToggle(event) {
    if (event.handled || !TRAPDOOR_OBJECT_IDS.has(event.objectId) || !atTile(event.location, TRAPDOOR_TILE)) return;
    if (hasFlag(event.player, FLAG_TRAPDOOR)) handleTrapdoorClose(event);
    else handleTrapdoorOpen(event);
  }

  function handleTrapdoorOpen(event) {
    if (!TRAPDOOR_OBJECT_IDS.has(event.objectId) || !atTile(event.location, TRAPDOOR_TILE)) return false;
    event.handled = true;
    const { player } = event;
    if (stageOf(player) < STAGE.SCARED) return trapdoorLocked(player);
    if (hasFlag(player, FLAG_TRAPDOOR)) return true;
    player.performAnimation(new Animation(ANIM.PICK_UP));
    player.getPacketSender().sendSound(SOUND.TRAPDOOR_OPEN, 1, 40);
    later(player, 1, () => {
      setFlag(player, FLAG_TRAPDOOR);
      sendVarbit(player, VARBIT_TRAPDOOR, 1);
    });
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

  /** The tower's stairs, its top ladder, the trapdoor and the dungeon's exit ladder. */
  function handleClimbClaim(request) {
    const { player } = request;
    const location = request.object?.getLocation?.();
    if (request.objectId === LADDER_OBJECT_ID && atTile(location, DUNGEON_LADDER_TILE, 1)) {
      request.handled = true;
      api.emitCustomEvent("ladders:climbUp", { player, object: request.object, destination: new Location(...DUNGEON_EXIT) });
      return;
    }
    if (request.objectId === LADDER_OBJECT_ID && atTile(location, TOP_LADDER_TILE)) {
      const stage = stageOf(player);
      if (stage === STAGE.UP_TOP) {
        request.handled = true;
        Scenes.creation(player);
        return;
      }
      if (stage === STAGE.CREATED) {
        request.handled = true;
        statements(player, ["I should go and talk to Effigy outside first."]);
        return;
      }
    }
    const stairsEvent = TOWER_STAIRS_EVENTS.get(request.objectId);
    if (stairsEvent) {
      request.handled = true;
      api.emitCustomEvent(stairsEvent, { player, object: request.object, animate: false });
      return;
    }
    if (!TRAPDOOR_OBJECT_IDS.has(request.objectId) || !atTile(location, TRAPDOOR_TILE)) return;
    request.handled = true;
    if (stageOf(player) < STAGE.SCARED || !hasFlag(player, FLAG_TRAPDOOR)) return trapdoorLocked(player);
    if (busy.get(player)) return;
    busy.set(player, true);
    player.performAnimation(new Animation(ANIM.PICK_UP));
    later(player, 1, () => {
      busy.delete(player);
      player.moveTo(new Location(...DUNGEON_LANDING));
    });
  }

  // ---------------------------------------------------------------------------
  // Journal (the capture's pages to tol_prog 11; ours after)
  // ---------------------------------------------------------------------------

  const red = (text) => `<col=800000>${text}`;
  const blue = (text) => `<col=000080>${text}`;
  const str = (text) => `<str>${text}`;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        `I can start this quest by talking to ${red("Effigy")} ${blue("at the tower south-")}`,
        blue("east of Ardougne."),
        "",
        `I need a ${red("Construction level of 10")}${blue(" to begin.")}`,
      ];
    }
    const lines = [str("I can start this quest by talking to Effigy at the tower south-"), str("east of Ardougne.")];
    if (stage === STAGE.STARTED) {
      lines.push(`${red("Effigy ")}${blue("told me the tower has ceased construction because of")}`);
      lines.push(`${blue("the builders' strike. Hopefully, talking to")}${red(" Bonafido ")}${blue(", the head")}`);
      lines.push(blue("builder, will sort things out."));
      return lines;
    }
    lines.push(str("Effigy told me the tower has ceased construction because of"));
    lines.push(str("the builders' strike. Hopefully, talking to Bonafido, the head"));
    lines.push(str("builder, will sort things out."));
    const outfit = [
      [FLAG_HAT, HARD_HAT_ITEM_ID, "A hardhat."], [FLAG_SHIRT, SHIRT_ITEM_ID, "A shirt."],
      [FLAG_TROUSERS, TROUSERS_ITEM_ID, "Some trousers."], [FLAG_BOOTS, BOOTS_ITEM_ID, "A pair of boots."],
    ];
    if (stage === STAGE.OUTFIT) {
      lines.push(`${red("Bonafido ")}${blue("says I can go into the tower if I dress up like a")}`);
      lines.push(`${blue("builder before speaking with him again. The other ")}${red("builders")}`);
      lines.push(`${red("around the tower")}${blue(" should be able to help me find:")}`);
      lines.push("");
      const got = outfit.map(([flag, itemId]) => hasFlag(player, flag) || hasOutfitPiece(player, itemId));
      outfit.forEach(([, , words], i) => lines.push(got[i] ? str(words) : red(words)));
      const all = "I must be wearing all my outfit to enter the tower.";
      lines.push(got.every(Boolean) ? str(all) : red(all));
      return lines;
    }
    lines.push(str("Bonafido says I can go into the tower if I dress up like a"));
    lines.push(str("builder. I should be able to find some clothing around the"));
    lines.push(str("tower."));
    const kit = ["I got my kit together and passed an initiation ritual. Time to", "venture into the tower!"];
    if (stage === STAGE.BUILDER) {
      lines.push(blue(kit[0]), `${blue("venture into the ")}${red("tower")}${blue("!")}`);
    } else {
      lines.push(...kit.map(str));
    }
    lines.push(...outfit.map(([, , words]) => str(words)), str("I must be wearing all my outfit to enter the tower."));
    if (stage === STAGE.BUILDER) return lines;
    if (stage === STAGE.ENTERED) {
      lines.push(`${blue("This place is amazing! Time to fix things and then tell ")}${red("Effigy")}${blue(".")}`);
      const machineLines = [["pressure", "pressure machine", "configure the pressure machine"], ["pipe", "pipe machine", "configure the pipe machine"], ["cage", "cage", "finish the cage"]];
      for (const [machine, name, last] of machineLines) {
        const progress = machineProgress(player, machine);
        if (progress < MACHINE_BUILT) continue;
        lines.push(str(` - I need to fix the ${name}.`));
        // Ours: only the struck form of the second line is captured.
        lines.push(progress >= MACHINE_WORKING ? str(` - I need to ${last}.`) : blue(` - I need to ${last}.`));
      }
      return lines;
    }
    lines.push(str("This place is amazing! Time to fix things and tell Effigy."));
    const told = ["I told Effigy about fixing the tower and he ran inside. I should", "go look for him."];
    if (stage === STAGE.UP_TOP) return [...lines, ...told.map(blue)];
    lines.push(...told.map(str));
    if (stage === STAGE.CREATED) {
      lines.push(`${blue("I saw the creation of life! The ")}${red("alchemists")}${blue(" ran outside - best I")}`);
      lines.push(blue("go talk to them."));
      return lines;
    }
    lines.push(str("I saw the creation of life! The alchemists ran outside - best I"), str("go talk to them."));
    // Ours from here: no capture of these pages.
    if (stage >= STAGE.COMPLETE) {
      lines.push(str("I helped the Homunculus order its mind, and it scared the"), str("alchemists away. I met it in the dungeon below the tower."));
      lines.push("", "<col=ff0000>QUEST COMPLETE!");
      return lines;
    }
    if (stage <= STAGE.MIND) {
      lines.push(blue("Effigy wants me to talk to the ") + red("Homunculus") + blue(" at the top of"), blue("the tower and help it make sense of its mind."));
      return lines;
    }
    if (stage === STAGE.MIND_FIXED) {
      lines.push(blue("The Homunculus's mind is in order. I should speak to ") + red("Effigy") + blue("."));
      return lines;
    }
    lines.push(blue("The Homunculus scared the alchemists away. I should meet it in"), blue("the ") + red("dungeon") + blue(" below the tower."));
    return lines;
  }

  // ---------------------------------------------------------------------------
  // Login / state
  // ---------------------------------------------------------------------------

  /** Saves from before tol_prog's scale: their stages 2-16 and flags, moved onto it once. */
  function migrate(player) {
    if (readInt(player, STAGE_SCALE_ATTRIBUTE) === 1) return;
    player.setAttribute(STAGE_SCALE_ATTRIBUTE, 1);
    const old = stageOf(player);
    if (old <= 2) return;
    const entered = hasFlag(player, FLAG_OLD_ENTERED);
    const scared = hasFlag(player, FLAG_OLD_SCARED);
    const moved = {
      3: STAGE.OUTFIT, 4: entered ? STAGE.ENTERED : STAGE.BUILDER, 6: STAGE.ENTERED, 8: STAGE.UP_TOP,
      11: STAGE.CREATED, 12: STAGE.HELPING, 14: scared ? STAGE.SCARED : STAGE.MIND_FIXED, 16: STAGE.COMPLETE,
    }[old];
    if (moved !== undefined) player.setAttribute(`quest.tower_of_life.stage`, moved);
    player.setAttribute(MIND_ALIGN_ATTRIBUTE, moved >= STAGE.MIND_FIXED && moved < STAGE.COMPLETE ? MIND_LOGIC : 0);
  }

  /** ::quest reset (or an old save) leaves the sibling attributes behind; put them back. */
  function reconcileState(player) {
    const stage = stageOf(player);
    if (stage < STAGE.ENTERED) {
      for (const machine of MACHINES) player.setAttribute(MACHINE_ATTRIBUTES[machine], MACHINE_UNFINISHED);
      Puzzles.reset(player);
    }
    if (stage < STAGE.OUTFIT) {
      for (const flag of [FLAG_HAT, FLAG_SHIRT, FLAG_TROUSERS, FLAG_BOOTS]) clearFlag(player, flag);
    } else {
      // A builder's piece that is no longer held can be obtained again, so its flag follows the inventory.
      for (const [flag, itemId] of [[FLAG_HAT, HARD_HAT_ITEM_ID], [FLAG_SHIRT, SHIRT_ITEM_ID], [FLAG_TROUSERS, TROUSERS_ITEM_ID], [FLAG_BOOTS, BOOTS_ITEM_ID]]) {
        if (!hasOutfitPiece(player, itemId)) clearFlag(player, flag);
      }
    }
    if (stage < STAGE.MIND || stage >= STAGE.COMPLETE) player.setAttribute(MIND_ALIGN_ATTRIBUTE, 0);
    if (stage < STAGE.SCARED) clearFlag(player, FLAG_TRAPDOOR);
  }

  function restoreVarbits(player) {
    const stage = stageOf(player);
    sendVarbit(player, VARBIT_STAGE, stage);
    for (const machine of MACHINES) {
      sendVarbit(player, VARBIT_PROGRESS[machine], machineProgress(player, machine));
      sendVarbit(player, VARBIT_EXAMINED[machine], hasFlag(player, FLAG_EXAMINED[machine]) ? 1 : 0);
    }
    sendVarbit(player, VARBIT_CAGE_STATE, machineProgress(player, "cage") >= MACHINE_WORKING && stage < STAGE.CREATED ? 1 : 0);
    sendVarbit(player, VARBIT_MIND_ALIGN, mindAlign(player));
    sendVarbit(player, VARBIT_HOMONC_PRES, 0);
    sendVarbit(player, VARBIT_TRAPDOOR, hasFlag(player, FLAG_TRAPDOOR) ? 1 : 0);
    sendVarbit(player, VARBIT_NOFINGERS, hasFlag(player, FLAG_NOFINGERS_ASKED) ? 1 : 0);
    Puzzles.restore(player);
  }

  function handleLogin({ player }) {
    migrate(player);
    reconcileState(player);
    refreshQuestList(player);
    restoreVarbits(player);
  }

  function handleLogout({ player }) {
    building.delete(player);
    Scenes.logout(player);
    mindTalk.delete(player);
  }

  quest = registerQuest(api, {
    key: "tower_of_life",
    name: "Tower of Life",
    varpId: 977, // "tol"
    varbitId: VARBIT_STAGE, // 3337 tol_prog, bits 0-4
    varbitValue: (stage) => stage,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 1000, label: "Construction" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 500, label: "Crafting" },
      { skillId: Skill.THIEVING.getIndex(), amount: 500, label: "Thieving" },
    ],
    otherRewards: ["Creature Creation Access"],
    scrollItemId: () => SHIRT_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.CONSTRUCTION, 1000);
    skills.addExperiences(Skill.CRAFTING, 500);
    skills.addExperiences(Skill.THIEVING, 500);
  }

  const Scenes = createScenes(api, {
    setStage: (player, stage) => quest.setStage(player, stage),
    sendVarbit,
    startTranscript: (player, npcId, variant) => startTranscript(api, player, npcId, PAGE, variant),
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleTranscriptAction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:line", noFingersAsked);
  api.onCustomEvent("interface:close", protectScene);
  api.onCustomEvent("player:world-input", protectScene);
  api.onCustomEvent("player:died", ({ player }) => Scenes.died(player));
  api.onNpcInteraction("'No fingers'", { Pickpocket: pickpocketNoFingers });
  api.onObjectInteraction("Pressure machine", { Fix: handleMachineFix });
  api.onObjectInteraction("Pipe machine", { Fix: handleMachineFix });
  api.onObjectInteraction("Cage", { Fix: handleMachineFix });
  api.onObjectInteraction("Crate", { Search: searchCrate });
  api.onObjectInteraction("Plant", { Search: searchPlant });
  api.onCustomEvent("door:toggle", handleTowerDoorToggle);
  api.onCustomEvent("door:toggle", handleTrapdoorToggle);
  api.onObjectInteraction("Trapdoor", { Open: handleTrapdoorOpen, Close: handleTrapdoorClose });
  api.onInterfaceActionButton(Puzzles.BUTTONS, Puzzles.handleButton);
  api.onCustomEvent("interface:closed", Puzzles.handleClosed);
  api.onCustomEvent("ladders:climb", handleClimbClaim);
  api.onItemOnNpc(handleItemOnNpc);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
