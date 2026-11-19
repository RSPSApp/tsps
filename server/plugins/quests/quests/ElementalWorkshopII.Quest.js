/**
 * Elemental Workshop II (members), as the user's rev 242 rsprox recording ElementalWorkshop2.bin
 * plays it from the Exam Centre bookcase to the mind helmet (docs/quests/elemental-workshop-ii/
 * README.md has the facts and ticks), with the Wiki's quest transcript for the lines and the
 * branches the run doesn't take (their text comes from the dialogue dump's "Elemental Workshop
 * II" page, presented as live presents it: a message box, an item box or a chat line).
 *
 * Stage is varbit 2639 (elemental_quest_2_main) with live's values: 1 book found, 2 book read,
 * 3 note read, 4 key found, 5 hatch unlocked, 6 machine floor reached, 7 primed bar taken,
 * 8 mind door opened, 9 primed bar placed, 10 mind bar made, 11 complete (the cache's
 * completion threshold). The machines' state is the other elemental_quest_2_* varbits on varps
 * 896/897, saved as they are and replayed on login. Saves from the old stage scheme (1-12, with
 * separate attributes) are converted once on login.
 *
 * The machine floor, its gantry and the extractor room below are an instance, as live's
 * rebuild_region: the crane, the tank door and water, the press hammer, the extractor hat and the
 * mind doors are server-swapped locs there, and the jig cart (multinpc 6285 on jig_state) is the
 * player's own, riding its 56-tile loop a tile a tick.
 */
const fs = require("fs");
const path = require("path");
const { createQuestScenes } = require("../QuestScenes");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "elemental-workshop-ii.json"), "utf8"));

module.exports = function registerElementalWorkshopIIQuest(api) {
  const {
    Animation, Bank, CacheDefinitions, CountdownTask, CreationMenu, DialogueChainBuilder, ForceMovement,
    GameObject, Graphic, Item, ItemStatementDialogue, Location, MapObjects, NpcIdentifiers, ObjectManager,
    OptionDialogue, PlayerDialogue, Skill, StatementDialogue, Task, TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, openBook, bookPagesFromSpreads, questStartMessage, loadTranscripts } = require("../QuestRuntime");
  const { holdsHammer } = require("../../items/Hammers");
  const I = api.core.ItemIdentifiers;
  const O = api.core.ObjectIdentifiers;

  const KEY = "elemental_workshop_ii";
  const PAGE = "Elemental Workshop II";

  // ==========================================================================
  // Stages and varbits
  // ==========================================================================

  const STAGE = {
    STARTED: 1, BOOK_READ: 2, NOTE_READ: 3, KEY_FOUND: 4, HATCH_UNLOCKED: 5, MACHINE_FLOOR: 6,
    PRIMED_BAR: 7, MIND_DOOR: 8, BAR_PLACED: 9, MIND_BAR: 10, COMPLETE: 11,
  };
  const VARBIT = {
    MAIN: 2639, HIDE_KEY: 2640, HATCH: 2641, JIG_POS: 2642, JIG_STATE: 2643, FIRE_STATE: 2644, FIRE_POS: 2645,
    PIPE_1: 2646, PIPE_2: 2647, PIPE_3: 2648, WATER_STATE: 2650, VALVE_1: 2651, VALVE_2: 2652,
    WATER_DOOR: 2653, WATER_LEVEL: 2654, COG_1: 2655, COG_2: 2656, COG_3: 2657, AIR_STATE: 2659,
    FAN_STATE: 2660, MIND_JIG: 2662, EARTH_FIXED: 2663,
  };
  /** The machine varbits saved and replayed (stage 2639 is QuestRuntime's). */
  const MACHINE_VARBITS = Object.values(VARBIT).filter((id) => id !== VARBIT.MAIN);
  const VARP_896 = 896;
  const VARP_897 = 897;
  const MACHINE_ATTRIBUTE = { [VARP_896]: "quest.elemental_workshop_ii.varp896", [VARP_897]: "quest.elemental_workshop_ii.varp897" };
  /** 2: live's stages and the varbit save; 0 with a stage set is the old scheme. */
  const SCHEME_ATTRIBUTE = "quest.elemental_workshop_ii.scheme";
  const SCHEME = 2;
  const CRATES_ATTRIBUTE = "quest.elemental_workshop_ii.crates";
  const SCENE_EXIT_ATTRIBUTE = "elemental-workshop-ii:scene-exit";

  // jig_state: what the cart holds (its multinpc); 6 is the bar carried into the tank.
  const JIG = { EMPTY: 0, BAR: 1, HOT: 2, FLAT_HOT: 3, FLAT: 4, DRY: 5, IN_TANK: 6 };
  // fire_pos and fire_state: where the crane is and what its claw holds.
  const CRANE_POS = { TRACK_UP: 0, TRACK_DOWN: 1, LAVA_UP: 2, LAVA_DOWN: 3 };
  const CLAW = { BROKEN: 0, EMPTY: 1, COOL: 2, HOT: 3 };
  // water_door: closed/open, rack retracted/extended, and what the rack holds.
  const DOOR = {
    CLOSED: 0, OPEN: 1, EXTENDED: 2, CLOSED_HOT: 3, OPEN_HOT: 4, EXTENDED_HOT: 5,
    CLOSED_COLD: 6, OPEN_COLD: 7, EXTENDED_COLD: 8,
  };
  const CART_STOP = { CRANE: 0, PRESS: 1, TANK: 2, TUNNEL: 3 };

  // ==========================================================================
  // Ids (cache)
  // ==========================================================================

  const BOOKCASE = O.BOOKCASE_66; // 17382 elemental_workshop_2_bookcase, Exam Centre
  const BOILER_IDS = new Set([18593, O.MACHINERY_4]); // boiler multiloc, 18594 its Search form (hide_key 1)
  const HATCH_IDS = new Set([3413, O.HATCH, O.HATCH_2]); // elem2_stairs_door, 18595 Open / 18596 Climb-down
  const WORKBENCH = O.WORKBENCH_5; // 3402
  const SCHEMATIC_CRATE = O.SCHEMATIC_CRATE; // 18711
  const CRATE_IDS = [18612, 18613, 18614, 18615, 18616, 18617, 18618, 18619]; // elemental_workshop_2_box_1..8
  const CRATE_INDEX = new Map(CRATE_IDS.map((id, index) => [id, index]));
  const CART_LEVER = 18620; // elem2_lever_3way
  const ROTATE_LEVER = 18621; // elem2_fire_lever_1
  const RAISE_LEVER = 18622; // elem2_fire_lever_2
  const PRESS_LEVER = 18640; // elem2_earth_lever_1
  const JUNCTION_BOX = 18641; // elem2_press_junction_box
  const VALVE_1 = 18646; // elem2_valve_1, the inlet (west)
  const VALVE_2 = 18647; // elem2_valve_2, the drain (east)
  const DOOR_LEVER = 18648; // elem2_water_lever
  const CORKSCREW = 18649; // elem2_corkscrew
  const FAN_LEVER = 18663; // elem2_air_lever
  const PIPING_IDS = new Set([3414, 18650]); // elemental_piping_blue_broken_multi / _broken
  const PINS = new Map([
    [18722, VARBIT.COG_1], [18665, VARBIT.COG_1], // high pin: the small cog's
    [3429, VARBIT.COG_2], [18664, VARBIT.COG_2], // low pin: the medium cog's
    [18721, VARBIT.COG_3], [18666, VARBIT.COG_3], // left pin: the large cog's
  ]);
  /** The cog locs a placed cog shows as (Take): low/left/high x small/medium/large, with and without spin. */
  const COG_LOCS = new Map();
  for (const [base, varbit] of [[18667, VARBIT.COG_2], [18670, VARBIT.COG_3], [18673, VARBIT.COG_1], [18676, VARBIT.COG_2], [18679, VARBIT.COG_3], [18682, VARBIT.COG_1]]) {
    for (let size = 0; size < 3; size++) COG_LOCS.set(base + size, varbit);
  }
  const COG_ITEMS = [null, I.SMALL_COG, I.MEDIUM_COG, I.LARGE_COG]; // cog varbit value -> item
  const CORRECT_COG = { [VARBIT.COG_1]: 1, [VARBIT.COG_2]: 2, [VARBIT.COG_3]: 3 };
  const EXTRACTOR_HAT = 18690;
  const EXTRACTOR_GUN_IDS = new Set([18725, 18693, 18694, 18695]); // elem_extractor_gun and its forms
  const MIND_DOOR = 18698; // elem2_door_mind
  const MIND_DOOR_L = 18700; // elem2_door_mindl
  const MIND_DOOR_OPEN = 18699;
  const MIND_DOOR_L_OPEN = 18701;
  const STAIRS_UP = 18598; // elem2_stairs1, machine floor -> workshop
  const STAIRWELL = 18597; // elem2_stairs_door_open_no_hatch, machine floor -> extractor room
  const STAIRS_UP_BASEMENT = 18599; // elem2_stairs2
  const GANTRY_UP = 18610; // elem_gantry_stairs
  const GANTRY_DOWN = 18611; // elem_gantry_stairs_top
  const CART_NPC = 6285; // elem2_cart_npc, multinpc 5221-5226 on jig_state
  const CART_NPC_IDS = new Set([CART_NPC, 5221, 5222, 5223, 5224, 5225, 5226]);

  const BEATEN_BOOK = I.BEATEN_BOOK; // 9717
  const NOTE = I.SCROLL_3; // 9721 elemental_workshop_2_note
  const HATCH_KEY = I.KEY_11; // 9722
  const CRANE_SCHEMATIC = I.CRANE_SCHEMATIC; // 9718
  const LEVER_SCHEMATIC = I.LEVER_SCHEMATIC; // 9719
  const CRANE_CLAW = I.CRANE_CLAW; // 9720 elem_broken_finger
  const PIPE = I.PIPE; // 9723
  const PRIMED_BAR = I.PRIMED_BAR; // 9727
  const MIND_BAR = I.PRIMED_MIND_BAR; // 9728
  const ELEMENTAL_METAL = I.ELEMENTAL_METAL; // 2893
  const CRATE_ITEMS = [I.SMALL_COG, I.MEDIUM_COG, I.LARGE_COG, PIPE];

  // ==========================================================================
  // Tiles (source coordinates; the instance translates them)
  // ==========================================================================

  const INSTANCE = { sourceChunk: [240, 640], size: 8 }; // 1920-1983, 5120-5183, every plane (rebuild_region at tick 213)
  const BOUNDS = [[1920, 1983, 5120, 5183, 0], [1920, 1983, 5120, 5183, 2], [1920, 1983, 5120, 5183, 3]];
  const HATCH_TOP = [2719, 9892, 0];
  const FLOOR_LANDING = [1955, 5155, 2];
  const WORKSHOP_LANDING = [2720, 9892, 0];
  const BASEMENT_LANDING = [1947, 5159, 0];
  const BASEMENT_UP_LANDING = [1950, 5158, 2];
  const CRANE_TILE = [1952, 5143, 2];
  const TANK_DOOR_TILE = [1953, 5162, 2];
  const TANK_TILE = [1951, 5164, 2];
  const HAMMER_TILE = [1946, 5155, 2];
  const COG_TILES = [[1959, 5157, 2, 10], [1959, 5157, 2, 4], [1959, 5156, 2, 10]];
  const HAT_TILE = [1962, 5150, 0];
  const GUN_TILE = [1962, 5148, 0];
  const MIND_DOORS = [[MIND_DOOR, 1952, 5150, MIND_DOOR_OPEN, 1951, 5150, 1], [MIND_DOOR_L, 1952, 5149, MIND_DOOR_L_OPEN, 1951, 5149, 3]];
  /** The cart's loop, a tile a tick (ticks 801-1004): crane -> press -> tank -> wind tunnel -> crane. */
  const CART_PATH = (() => {
    const tiles = [];
    for (let x = 1954; x >= 1947; x--) tiles.push([x, 5147]);
    for (let y = 5148; y <= 5161; y++) tiles.push([1946, y]);
    for (let x = 1947; x <= 1960; x++) tiles.push([x, 5162]);
    for (let y = 5161; y >= 5148; y--) tiles.push([1961, y]);
    for (let x = 1960; x >= 1955; x--) tiles.push([x, 5147]);
    return tiles;
  })();
  /** The stops on it: crane 1954,5147; press 1946,5155 (15 steps); tank 1953,5162 (13); tunnel 1961,5155 (14); back (14). */
  const STOP_INDEX = [0, 15, 28, 42];

  // ==========================================================================
  // Animations and sounds (capture)
  // ==========================================================================

  const ANIM = {
    lever: 4909, // human_elem2_lever_3way_right
    leverLoc: 4904, // elem2_lever_3way_right
    corkscrew: 4905, corkscrewLoc: 4912,
    workbench: 896, // human_cooking
    reachForLadder: 828,
    chair: 4884, gun: 4897,
    craneLower: 4887, craneRaise: 4888, craneRotate: 4892, lavaLower: 4889, lavaRaise: 4890,
    doorOpening: 4875, doorClosing: 4876, rackOut: 4877, rackIn: 4878,
    tankFill: 4902, tankEmpty: 4903, pressHammer: 4908,
    cogsReverse: 4906, cogs: 4896, cogsStop: 4907,
  };
  const SOUND = {
    lever: 2400, manhole: 75, placePipe: 3179, placeCog: 3178, cartLoop: 3167, craneLower: 3169, craneTurn: 3170,
    press: 3180, doorOpen: 71, doorClose: 70, valve: 3185, waterFlow: 3183, coolBar: 3168, screw: 3182, rack: 3184,
    placeBar: 3177, mindControl: 3176, zap: 3173, anvil: 2721,
  };
  const CHAIR_SPOTANIM = 807;
  const PRIME_TIME = 202; // music track

  const CRAFT_TICKS = 4; // Wiki: crane claw, mind shield, mind helmet, elemental shield and helmet: 4 ticks
  const XP = { shield: 20, claw: 20, helmet: 20, mindShield: 30, mindHelmet: 30 };
  const MIND_SMITHING_LEVEL = 30;
  const MAGIC_DRAIN = 20; // Wiki: each bar lowers Magic by 20

  const MESSAGE = {
    bookParts: "The book has two parts: an introduction and an instruction section.", // Wiki; the capture has a semicolon
    bookIntro: "You flip the book open to the introduction and start reading.",
    oldBook: "You find an old-looking book.",
    bookmark: "You find a slip of paper that has been used for a bookmark. You put it in your pack to study later.",
    nothing: "You find nothing.",
    lockedHatch: "You're unable to open the locked hatch.",
    wrongHatchItem: "You try to stuff the object into the keyhole. It doesn't fit.", // Wiki, Transcript:Elemental Workshop I
    climbDown: "You climb down the stairs.",
    climbUp: "You climb up the stairs.",
    noRoom: "You don't have enough space in your inventory.", // Ours: the Wiki leaves the full-inventory lines out
    // Ours: the start's requirements have no recorded refusal.
    needEw1: "You must have completed Elemental Workshop I before you can start this quest.",
    needSkills: "You need a Magic level of 20 and a Smithing level of 30 to start this quest.",
    bookcaseNothing: "You search the bookcase but find nothing of interest.", // Ours
    extractorMagic: "You need a Magic level of 20 to use the extractor.", // Ours
    mindLevel: `You need a Smithing level of ${MIND_SMITHING_LEVEL} to work this metal.`, // Ours
    metalLevel: "You need a Smithing level of 20 to work this metal.", // Ours
    mindShieldMade: "Following the instructions in the book, you make a mind shield.", // capture tick 1471
    shieldMade: "Following the instructions in the book, you make an elemental shield.", // Elemental Workshop I
    reach: "I can't reach that!",
  };

  // ==========================================================================
  // State
  // ==========================================================================

  let quest;
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  /** Per player while on the machine floor: the cart and what is moving. */
  const floors = new WeakMap();
  /** Per player: a junction-box inlet clicked, waiting for its other end (0 none, 1-6). */
  const junctionPick = new WeakMap();
  /** Per player: workbench crafting in progress. */
  const crafting = new WeakMap();
  /** Per player: the last tick a climb ran, so a click both Ladders and this plugin see climbs once. */
  const lastClimb = new WeakMap();

  const stage = (player) => quest.getStage(player);
  const has = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const sound = (player, id, delay = 0) => player.getPacketSender().sendSound(id, 1, delay);
  const animate = (mob, id) => mob.performAnimation(new Animation(id));

  function varbitDef(id) {
    return CacheDefinitions.getVarbit(id);
  }

  function machineValue(player, id) {
    const { baseVar, startBit, endBit } = varbitDef(id);
    const stored = Number(player.getAttribute(MACHINE_ATTRIBUTE[baseVar])) || 0;
    return (stored >>> startBit) & ((1 << (endBit - startBit + 1)) - 1);
  }

  function setMachine(player, id, value) {
    const { baseVar, startBit, endBit } = varbitDef(id);
    const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
    const stored = Number(player.getAttribute(MACHINE_ATTRIBUTE[baseVar])) || 0;
    player.setAttribute(MACHINE_ATTRIBUTE[baseVar], ((stored & ~mask) | ((value << startBit) & mask)) >>> 0);
    player.getPacketSender().sendVarbit(id, value | 0);
  }

  function syncMachine(player) {
    for (const id of MACHINE_VARBITS) player.getPacketSender().sendVarbit(id, machineValue(player, id));
  }

  function setStageAtLeast(player, value) {
    if (stage(player) < value) quest.setStage(player, value);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  // ==========================================================================
  // Presentation: the Wiki transcript's lines from the dialogue dump, shown as live shows them
  // ==========================================================================

  function line(variant, index = 0) {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[variant];
    const flat = [];
    const walk = (list) => {
      for (const step of list ?? []) {
        if (step?.type === "message" && step.text) flat.push(step.text);
        if (step?.player) flat.push(step.player);
        if (Array.isArray(step?.steps)) walk(step.steps);
        if (Array.isArray(step?.options)) for (const option of step.options) walk(option.steps);
      }
    };
    walk(steps);
    return flat[index] ?? "";
  }

  function messageBox(player, text, then) {
    const chain = new DialogueChainBuilder().add(new StatementDialogue(0, text));
    if (then) chain.add(new (api.core.ActionDialogue)(1, { execute: () => { player.getPacketSender().sendInterfaceRemoval(); then(); } }));
    player.getDialogueManager().startDialogues(chain);
  }

  function itemBox(player, itemId, text, then) {
    const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
    if (then) chain.add(new (api.core.ActionDialogue)(1, { execute: () => { player.getPacketSender().sendInterfaceRemoval(); then(); } }));
    player.getDialogueManager().startDialogues(chain);
  }

  function playerLine(player, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0, text)));
  }

  function menu(player, title, options, choose) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        choose(Number(option));
      },
    }, ...options).setTitle(title)));
  }

  // ==========================================================================
  // The machine floor instance
  // ==========================================================================

  function scene(player) {
    return Scenes.get(player);
  }

  function tile(player, [x, y, z]) {
    return Scenes.tileFor(player, [x, y, z]);
  }

  function locAt(player, at, ids, type = 10) {
    const sc = scene(player);
    if (!sc) return null;
    const where = tile(player, at);
    return MapObjects.getObjectsAt(where, sc.area).find((o) => o.getType() === type && (!ids || ids.has(o.getId()))) ?? null;
  }

  /** Puts `id` at a source tile for the player's instance, replacing what stands there (loc_add_change). */
  function setLoc(player, at, ids, id, type = 10, face = null) {
    const sc = scene(player);
    if (!sc) return null;
    const where = tile(player, at);
    const current = locAt(player, at, ids, type);
    if (current?.getId() === id) return current;
    const next = new GameObject(id, where, type, face ?? current?.getFace() ?? 0, sc.area);
    if (current) ObjectManager.replaceInPlace(current, next);
    else { sc.area.add?.(next); ObjectManager.register(next, true); }
    return next;
  }

  function removeLoc(player, at, ids, type = 10) {
    const current = locAt(player, at, ids, type);
    if (current) ObjectManager.deregister(current, true);
  }

  function locAnim(player, at, ids, anim, type = 10) {
    const object = locAt(player, at, ids, type);
    if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(anim));
  }

  const CRANE_IDS = new Set(Array.from({ length: 16 }, (_, i) => 18623 + i));
  const DOOR_IDS = new Set(Array.from({ length: 9 }, (_, i) => 18651 + i));
  const TANK_IDS = new Set([18660, 18661]);
  const HAMMER_IDS = new Set([18644]);
  const HAT_IDS = new Set([EXTRACTOR_HAT]);
  const LEVER_IDS = new Set([CART_LEVER, ROTATE_LEVER, RAISE_LEVER, PRESS_LEVER, DOOR_LEVER, FAN_LEVER]);

  /** elem2_crane_{track,lava}_{up,down}_{empty,cool_bar,hot_bar,broken}: 18623 + content*4 + position, broken 18635 + position. */
  function craneLoc(position, claw) {
    return claw === CLAW.BROKEN ? 18635 + position : 18623 + (claw - 1) * 4 + position;
  }

  function showCrane(player) {
    setLoc(player, CRANE_TILE, CRANE_IDS, craneLoc(machineValue(player, VARBIT.FIRE_POS), machineValue(player, VARBIT.FIRE_STATE)));
  }

  /** elemental_waterdoor_{closed_retracted,open_retracted,open_extended} x {none,hotbar,coldbar}. */
  const DOOR_LOCS = [18651, 18652, 18653, 18654, 18655, 18656, 18657, 18658, 18659];

  function showDoor(player) {
    setLoc(player, TANK_DOOR_TILE, DOOR_IDS, DOOR_LOCS[machineValue(player, VARBIT.WATER_DOOR)]);
  }

  /** The tank: running water while the inlet is open with the drain open, full with the drain shut. */
  function showTank(player) {
    const inlet = machineValue(player, VARBIT.VALVE_1);
    const drain = machineValue(player, VARBIT.VALVE_2);
    if (!inlet) removeLoc(player, TANK_TILE, TANK_IDS);
    else setLoc(player, TANK_TILE, TANK_IDS, drain ? 18660 : 18661, 10, 0);
  }

  function cartTile(position) {
    return CART_PATH[STOP_INDEX[position]];
  }

  /** On the way in (tick 213): the crane and the tank door as saved, and the player's own cart. */
  function enterFloor(player) {
    const sc = Scenes.open(player, "elemental-workshop-ii", BOUNDS, { canTeleport: () => null, npcAggression: () => null, musicTrack: PRIME_TIME }, {
      instance: INSTANCE, at: FLOOR_LANDING, exit: HATCH_TOP,
    });
    showCrane(player);
    showDoor(player);
    showTank(player);
    const position = machineValue(player, VARBIT.JIG_POS);
    const [x, y] = cartTile(position);
    const next = CART_PATH[(STOP_INDEX[position] + 1) % CART_PATH.length];
    const cart = Scenes.actor(sc, CART_NPC, [x, y, 2], [next[0], next[1]]);
    floors.set(player, { cart, cartMoving: false, craneBusy: false, pressBusy: false, doorBusy: false, valveBusy: false, extractor: false });
    return sc;
  }

  function sceneEnded(player) {
    floors.delete(player);
    junctionPick.delete(player);
  }

  function floor(player) {
    return floors.get(player) ?? null;
  }

  function later(player, ticks, action) {
    const sc = scene(player);
    if (sc) Scenes.later(sc, ticks, action);
    else TaskManager.submit(new CountdownTask(player, ticks, () => { if (player.isRegistered?.() !== false) action(); }));
  }

  /**
   * Each [delay, action] runs `delay` ticks from now. Every delay counts from this tick: a task
   * submitted from inside another one starts a tick late, so nested waits would drift.
   */
  function steps(player, list) {
    for (const [delay, action] of list) {
      if (delay === 0) action();
      else later(player, delay, action);
    }
  }

  /** `tick(n)` every tick from the next one (n = 1, 2 ...) until it returns false; dies with the scene or player. */
  function everyTick(player, tick) {
    const key = scene(player) ?? player;
    let n = 0;
    const task = new (class extends Task {
      constructor() { super(1, key, false); }
      execute() {
        if (player.isRegistered?.() === false || tick(++n) === false) this.stop();
      }
    })();
    TaskManager.submit(task);
    return task;
  }

  /** A lever pull: the player's pull, the lever's own swing and its click (every lever, e.g. tick 498). */
  function pullLever(player, object) {
    animate(player, ANIM.lever);
    if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(ANIM.leverLoc));
    sound(player, SOUND.lever, 10);
  }

  // ==========================================================================
  // Starting off: the bookcase, the book and the note
  // ==========================================================================

  function searchBookcase(player) {
    if (stage(player) >= STAGE.STARTED) {
      if (has(player, BEATEN_BOOK) || quest.isComplete(player)) {
        player.sendMessage(MESSAGE.bookcaseNothing);
        return;
      }
      // Ours: a lost book comes back from the same shelf.
      if (!roomFor(player, 1)) return;
      player.getInventory().adds(BEATEN_BOOK, 1);
      itemBox(player, BEATEN_BOOK, MESSAGE.oldBook);
      return;
    }
    if (!questComplete(player, "elemental_workshop_i")) {
      player.sendMessage(MESSAGE.needEw1);
      return;
    }
    const skills = player.getSkillManager();
    if (skills.getCurrentLevel(Skill.MAGIC) < 20 || skills.getCurrentLevel(Skill.SMITHING) < 30) {
      player.sendMessage(MESSAGE.needSkills);
      return;
    }
    menu(player, "Start the Elemental Workshop II quest?", ["Yes.", "No."], (option) => {
      if (option !== 1 || stage(player) >= STAGE.STARTED || !roomFor(player, 1)) return;
      player.getInventory().adds(BEATEN_BOOK, 1);
      player.setAttribute(SCHEME_ATTRIBUTE, SCHEME);
      quest.setStage(player, STAGE.STARTED);
      player.sendMessage(questStartMessage(player, quest.name));
      itemBox(player, BEATEN_BOOK, MESSAGE.oldBook);
    });
  }

  function roomFor(player, slots) {
    if (player.getInventory().getFreeSlots() >= slots) return true;
    player.sendMessage(MESSAGE.noRoom);
    return false;
  }

  const BOOK_PAGES = bookPagesFromSpreads(DATA.bookSpreads);

  /** The first read (ticks 71-74): the parts line, the bookmark in an item box, then the book. */
  function readBook(player) {
    player.sendMessage(MESSAGE.bookParts);
    const needsNote = stage(player) < STAGE.COMPLETE && !Bank.owns(player, NOTE);
    if (stage(player) === STAGE.STARTED) quest.setStage(player, STAGE.BOOK_READ);
    if (needsNote && player.getInventory().getFreeSlots() > 0) {
      player.getInventory().adds(NOTE, 1);
      itemBox(player, NOTE, MESSAGE.bookmark, () => openHelmBook(player));
      return;
    }
    openHelmBook(player);
  }

  function openHelmBook(player) {
    player.sendMessage(MESSAGE.bookIntro);
    openBook(player, DATA.bookTitle, BOOK_PAGES);
  }

  /** messagescroll_handwriting (222), lines 1-11 (tick 85); the first read reveals the key. */
  function readNote(player) {
    const packet = player.getPacketSender();
    DATA.note.forEach((text, index) => packet.sendString(text, (222 << 16) | (index + 1)));
    packet.sendInterfaceScript(2524, [-1, -1]);
    packet.sendInterface(222);
    if (stage(player) === STAGE.BOOK_READ) {
      setMachine(player, VARBIT.HIDE_KEY, 1);
      quest.setStage(player, STAGE.NOTE_READ);
    }
  }

  function readCraneSchematic(player) {
    messageBox(player, line("into-the-workshop-reading-the-crane-schematic"));
  }

  /** elem2_maintenance_scroll (466), as tick 1340 opens it. */
  function readLeverSchematic(player) {
    player.getPacketSender().sendInterfaceScript(2524, [-1, -1]);
    player.getPacketSender().sendInterface(466);
  }

  // ==========================================================================
  // The key and the hatch
  // ==========================================================================

  function searchBoiler(player) {
    if (stage(player) < STAGE.NOTE_READ) return;
    // Ours: a lost key turns up again until the hatch is open.
    const keyThere = stage(player) === STAGE.NOTE_READ || (stage(player) < STAGE.HATCH_UNLOCKED && !Bank.owns(player, HATCH_KEY));
    if (!keyThere) {
      player.sendMessage(MESSAGE.nothing);
      return;
    }
    if (!roomFor(player, 1)) return;
    player.getInventory().adds(HATCH_KEY, 1);
    setStageAtLeast(player, STAGE.KEY_FOUND);
    itemBox(player, HATCH_KEY, line("into-the-workshop-searching-machinery-for-the-key"));
  }

  function openHatch(player) {
    if (machineValue(player, VARBIT.HATCH)) {
      climbDownHatch(player);
      return;
    }
    if (!has(player, HATCH_KEY)) {
      messageBox(player, MESSAGE.lockedHatch);
      return;
    }
    unlockHatch(player);
  }

  /** Ticks 200-207: the key is used up, the hatch varbit and stage 5, the manhole's sound. */
  function unlockHatch(player) {
    player.getInventory().deleteNumber(HATCH_KEY, 1);
    setMachine(player, VARBIT.HATCH, 1);
    setStageAtLeast(player, STAGE.HATCH_UNLOCKED);
    sound(player, SOUND.manhole);
    itemBox(player, HATCH_KEY, line("into-the-workshop-unlocking-the-hatch"));
  }

  function climbOnce(player) {
    const now = api.core.World.getProcessCycle?.() ?? Date.now();
    if (lastClimb.get(player) === now) return false;
    lastClimb.set(player, now);
    return true;
  }

  /** Tick 213: stage 6 the first time, the instance; the line a tick later. */
  function climbDownHatch(player) {
    if (!climbOnce(player)) return;
    setStageAtLeast(player, STAGE.MACHINE_FLOOR);
    enterFloor(player);
    later(player, 1, () => player.sendMessage(MESSAGE.climbDown));
  }

  function climbUpToWorkshop(player) {
    if (!climbOnce(player)) return;
    player.sendMessage(MESSAGE.climbUp);
    Scenes.end(player, false);
    player.moveTo(new Location(...WORKSHOP_LANDING));
  }

  function climbToBasement(player) {
    if (!climbOnce(player)) return;
    player.sendMessage(MESSAGE.climbDown);
    Scenes.place(player, BASEMENT_LANDING);
  }

  function climbFromBasement(player) {
    if (!climbOnce(player)) return;
    player.sendMessage(MESSAGE.climbUp);
    Scenes.place(player, BASEMENT_UP_LANDING);
  }

  /** The gantry stairs (ticks 511-517): the reach, and two ticks later over the stairs, a plane up or down. */
  function climbGantry(player, object, up) {
    if (!climbOnce(player)) return;
    const at = object.getLocation();
    const side = object.getFace() === 2 ? 1 : -1; // rotation 0 lands west going up, rotation 2 east
    const dx = up ? side : -side;
    animate(player, ANIM.reachForLadder);
    later(player, 2, () => player.moveTo(new Location(at.getX() + dx, at.getY(), at.getZ() + (up ? 1 : -1))));
  }

  function claimClimb(request) {
    const { player, objectId, object } = request;
    if (HATCH_IDS.has(objectId) && machineValue(player, VARBIT.HATCH)) climbDownHatch(player);
    else if (objectId === STAIRS_UP && scene(player)) climbUpToWorkshop(player);
    else if (objectId === STAIRWELL && scene(player)) climbToBasement(player);
    else if (objectId === STAIRS_UP_BASEMENT && scene(player)) climbFromBasement(player);
    else if ((objectId === GANTRY_UP || objectId === GANTRY_DOWN) && scene(player) && object) climbGantry(player, object, objectId === GANTRY_UP);
    else return;
    request.handled = true;
  }

  // ==========================================================================
  // Schematics and crates
  // ==========================================================================

  function searchSchematics(player) {
    menu(player, "There are two schematics here...", ["Crane schematic", "Lever schematic"], (option) => {
      const itemId = option === 1 ? CRANE_SCHEMATIC : option === 2 ? LEVER_SCHEMATIC : null;
      if (!itemId || !roomFor(player, 1)) return;
      player.getInventory().adds(itemId, 1);
      itemBox(player, itemId, line("into-the-workshop-schematic-crate"));
    });
  }

  /** Each player's four items sit in four of the eight crates, rolled once (Wiki: random per player). */
  function crateMap(player) {
    let packed = Number(player.getAttribute(CRATES_ATTRIBUTE)) || 0;
    if (packed === 0) {
      const order = CRATE_IDS.map((_, index) => index);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      packed = order[0] | (order[1] << 3) | (order[2] << 6) | (order[3] << 9) | (1 << 12);
      player.setAttribute(CRATES_ATTRIBUTE, packed);
    }
    return [packed & 7, (packed >> 3) & 7, (packed >> 6) & 7, (packed >> 9) & 7];
  }

  /** Whether the item a crate holds is still needed: not carried and not yet used (Wiki: lost items return). */
  function crateItemNeeded(player, slot) {
    const itemId = CRATE_ITEMS[slot];
    if (has(player, itemId)) return false;
    if (itemId === PIPE) return machineValue(player, VARBIT.WATER_STATE) === 0;
    const placed = [VARBIT.COG_1, VARBIT.COG_2, VARBIT.COG_3].some((id) => COG_ITEMS[machineValue(player, id)] === itemId);
    return !placed;
  }

  const CRATE_LINES = [1, 2, 3, 4]; // the variant's lines: 0 empty, 1 small, 2 medium, 3 big, 4 pipe

  function searchCrate(player, objectId) {
    const index = CRATE_INDEX.get(objectId);
    const slot = crateMap(player).indexOf(index);
    if (slot < 0 || quest.isComplete(player) || !crateItemNeeded(player, slot)) {
      player.sendMessage(line("into-the-workshop-searching-crates", 0));
      return;
    }
    if (!roomFor(player, 1)) return;
    player.getInventory().adds(CRATE_ITEMS[slot], 1);
    player.sendMessage(line("into-the-workshop-searching-crates", CRATE_LINES[slot]));
  }

  // ==========================================================================
  // The crane
  // ==========================================================================

  /**
   * The raise/lower lever (ticks 498-502, 737-744, 755-761, 763-769, 778-794): the claw moves a tick
   * after the pull and the crane shows its new pose three ticks after that. Raising off the track
   * takes the cart's cold bar or leaves the hot bar on the cart, the new load showing at once;
   * resting in the lava heats a cool bar.
   */
  function raiseOrLower(player, object) {
    const fl = floor(player);
    if (!fl || fl.craneBusy) return;
    fl.craneBusy = true;
    pullLever(player, object);
    const position = machineValue(player, VARBIT.FIRE_POS);
    const done = () => { showCrane(player); fl.craneBusy = false; };
    const moveTo = (next, anim) => { setMachine(player, VARBIT.FIRE_POS, next); locAnim(player, CRANE_TILE, CRANE_IDS, anim); sound(player, SOUND.craneLower); };
    if (position === CRANE_POS.TRACK_UP) {
      steps(player, [[1, () => moveTo(CRANE_POS.TRACK_DOWN, ANIM.craneLower)], [4, done]]);
    } else if (position === CRANE_POS.TRACK_DOWN) {
      steps(player, [
        [1, () => {
          setMachine(player, VARBIT.FIRE_POS, CRANE_POS.TRACK_UP);
          const atCrane = machineValue(player, VARBIT.JIG_POS) === CART_STOP.CRANE && !fl.cartMoving;
          const claw = machineValue(player, VARBIT.FIRE_STATE);
          const jig = machineValue(player, VARBIT.JIG_STATE);
          if (atCrane && claw === CLAW.EMPTY && jig === JIG.BAR) {
            setMachine(player, VARBIT.JIG_STATE, JIG.EMPTY);
            setMachine(player, VARBIT.FIRE_STATE, CLAW.COOL);
            setLoc(player, CRANE_TILE, CRANE_IDS, craneLoc(CRANE_POS.TRACK_DOWN, CLAW.COOL));
          } else if (atCrane && claw === CLAW.HOT && jig === JIG.EMPTY) {
            setMachine(player, VARBIT.JIG_STATE, JIG.HOT);
            setMachine(player, VARBIT.FIRE_STATE, CLAW.EMPTY);
            setLoc(player, CRANE_TILE, CRANE_IDS, craneLoc(CRANE_POS.TRACK_DOWN, CLAW.EMPTY));
          }
        }],
        [2, () => { locAnim(player, CRANE_TILE, CRANE_IDS, ANIM.craneRaise); sound(player, SOUND.craneLower); }],
        [5, done],
      ]);
    } else if (position === CRANE_POS.LAVA_UP) {
      steps(player, [[1, () => moveTo(CRANE_POS.LAVA_DOWN, ANIM.lavaLower)], [4, () => {
        if (machineValue(player, VARBIT.FIRE_STATE) === CLAW.COOL) setMachine(player, VARBIT.FIRE_STATE, CLAW.HOT);
        done();
      }]]);
    } else {
      steps(player, [[1, () => moveTo(CRANE_POS.LAVA_UP, ANIM.lavaRaise)], [4, done]]);
    }
  }

  /** The rotate lever (ticks 748-754, 771-776): over the track <-> over the lava, the arm raised. */
  function rotate(player, object) {
    const fl = floor(player);
    if (!fl || fl.craneBusy) return;
    const position = machineValue(player, VARBIT.FIRE_POS);
    if (position === CRANE_POS.TRACK_DOWN || position === CRANE_POS.LAVA_DOWN) {
      messageBox(player, line("into-the-workshop-rotating-the-claw-while-the-arm-is-down"));
      return;
    }
    fl.craneBusy = true;
    pullLever(player, object);
    steps(player, [
      [1, () => {
        setMachine(player, VARBIT.FIRE_POS, position === CRANE_POS.TRACK_UP ? CRANE_POS.LAVA_UP : CRANE_POS.TRACK_UP);
        locAnim(player, CRANE_TILE, CRANE_IDS, ANIM.craneRotate);
        sound(player, SOUND.craneTurn);
      }],
      [4, () => { showCrane(player); fl.craneBusy = false; }],
    ]);
  }

  /** Tick 505: the claw on the lowered crane. */
  function repairClaw(player) {
    if (machineValue(player, VARBIT.FIRE_STATE) !== CLAW.BROKEN || machineValue(player, VARBIT.FIRE_POS) !== CRANE_POS.TRACK_DOWN) {
      player.sendMessage(MESSAGE.reach);
      return;
    }
    player.getInventory().deleteNumber(CRANE_CLAW, 1);
    setMachine(player, VARBIT.FIRE_STATE, CLAW.EMPTY);
    showCrane(player);
    sound(player, SOUND.placePipe);
    itemBox(player, CRANE_CLAW, line("into-the-workshop-repairing-the-claw"));
  }

  // ==========================================================================
  // The jig cart
  // ==========================================================================

  /** Ours: the Wiki says the cart won't leave the tank with the door open, nor (by its steps) the tunnel with the fan on. */
  function cartHeld(player) {
    const position = machineValue(player, VARBIT.JIG_POS);
    if (position === CART_STOP.TANK && (machineValue(player, VARBIT.WATER_DOOR) % 3 !== 0 || machineValue(player, VARBIT.JIG_STATE) === JIG.IN_TANK)) return true;
    if (position === CART_STOP.TUNNEL && machineValue(player, VARBIT.AIR_STATE)) return true;
    return position === CART_STOP.CRANE && machineValue(player, VARBIT.FIRE_POS) === CRANE_POS.TRACK_DOWN;
  }

  /** Ticks 798-815: the pull, then the next stop's jig_pos, the cart's rumble and its first step, a tile a tick. */
  function pullCartLever(player, object) {
    const fl = floor(player);
    if (!fl || fl.cartMoving) return;
    pullLever(player, object);
    if (cartHeld(player)) return;
    fl.cartMoving = true;
    const from = machineValue(player, VARBIT.JIG_POS);
    const to = (from + 1) % 4;
    const start = STOP_INDEX[from];
    const end = STOP_INDEX[to] === 0 ? CART_PATH.length : STOP_INDEX[to];
    everyTick(player, (n) => {
      if (n === 1) {
        setMachine(player, VARBIT.JIG_POS, to);
        sound(player, SOUND.cartLoop);
      }
      const [x, y] = CART_PATH[(start + n) % CART_PATH.length];
      if (fl.cart?.isRegistered?.()) fl.cart.moveTo(tile(player, [x, y, 2]));
      if (start + n < end) return true;
      fl.cartMoving = false;
      return false;
    });
  }

  function placeBarOnCart(player) {
    if (machineValue(player, VARBIT.JIG_STATE) !== JIG.EMPTY || floor(player)?.cartMoving) return;
    player.getInventory().deleteNumber(ELEMENTAL_METAL, 1);
    setMachine(player, VARBIT.JIG_STATE, JIG.BAR);
  }

  /** Tick 1008: the dry flat bar comes off as the primed bar; stage 7 the first time. */
  function takeFromCart(player) {
    const jig = machineValue(player, VARBIT.JIG_STATE);
    if (floor(player)?.cartMoving) return;
    if (jig === JIG.DRY) {
      if (!roomFor(player, 1)) return;
      setMachine(player, VARBIT.JIG_STATE, JIG.EMPTY);
      player.getInventory().adds(PRIMED_BAR, 1);
      setStageAtLeast(player, STAGE.PRIMED_BAR);
      itemBox(player, PRIMED_BAR, line("into-the-workshop-taking-the-primed-bar"));
    } else if (jig === JIG.BAR) {
      // Ours: an unheated bar comes back as it went on.
      if (!roomFor(player, 1)) return;
      setMachine(player, VARBIT.JIG_STATE, JIG.EMPTY);
      player.getInventory().adds(ELEMENTAL_METAL, 1);
    }
  }

  // ==========================================================================
  // The press and the junction box
  // ==========================================================================

  /** Pair index of two inlets in the order a, b, c, 1, 2, 3 (a-b 1 ... 2-3 15): the pipe varbits' values. */
  const INLET_NAMES = ["a", "b", "c", "1", "2", "3"];
  const INLET_COMPONENTS = { 41: 1, 42: 2, 37: 3, 38: 4, 39: 5, 40: 6 }; // inletam, inletbm, inletcm, inlet1m-3m
  const PIPE_VARBITS = [VARBIT.PIPE_1, VARBIT.PIPE_2, VARBIT.PIPE_3];
  /** Live's working connections: a-3, b-c and 1-2 (capture ticks 526-535; the Wiki's only working layout). */
  const SOLVED = new Set([5, 6, 13]);

  function pairIndex(a, b) {
    const [low, high] = a < b ? [a, b] : [b, a];
    let index = 0;
    for (let i = 1; i <= 6; i++) for (let j = i + 1; j <= 6; j++) { index++; if (i === low && j === high) return index; }
    return 0;
  }

  function pairInlets(index) {
    let n = 0;
    for (let i = 1; i <= 6; i++) for (let j = i + 1; j <= 6; j++) if (++n === index) return [i, j];
    return null;
  }

  function connectionComponent(index) {
    const [a, b] = pairInlets(index);
    const uid = CacheDefinitions.getComponentId(`elem_magicpress_pipes:connection${INLET_NAMES[a - 1]}_${INLET_NAMES[b - 1]}_l`);
    return uid ?? null;
  }

  function pipes(player) {
    return PIPE_VARBITS.map((id) => machineValue(player, id)).filter(Boolean);
  }

  function pipesSolved(player) {
    const set = pipes(player);
    return set.length === 3 && set.every((p) => SOLVED.has(p));
  }

  /** Tick 523: if2 counts the pipes still to fit, then the junction box (262). */
  function openJunctionBox(player) {
    let fitted = pipes(player);
    if (fitted.length === 3 && !pipesSolved(player)) {
      // Ours: a wrong full set comes apart when the box is opened again, so it can be redone.
      for (const id of PIPE_VARBITS) setMachine(player, id, 0);
      fitted = [];
    }
    const packet = player.getPacketSender();
    for (let index = 1; index <= 15; index++) {
      const uid = connectionComponent(index);
      if (uid !== null) packet.sendInterfaceDisplayState(uid, !fitted.includes(index));
    }
    junctionPick.set(player, 0);
    packet.sendConfig(261, 0);
    packet.sendConfig(262, 3 - fitted.length);
    packet.sendInterfaceScript(2524, [2299666, 200]);
    packet.sendInterface(262);
  }

  /** Ticks 526-536: an inlet, then its other end; the third pipe closes the box with the player's line. */
  function clickJunction(event) {
    const { player, buttonId } = event;
    if ((buttonId >>> 16) !== 262) return;
    const inlet = INLET_COMPONENTS[buttonId & 0xffff];
    if (!inlet) return;
    event.handled = true;
    const fitted = pipes(player);
    const used = new Set(fitted.flatMap((index) => pairInlets(index)));
    if (fitted.length >= 3 || used.has(inlet)) return;
    const packet = player.getPacketSender();
    const first = junctionPick.get(player) ?? 0;
    if (!first || first === inlet) {
      junctionPick.set(player, first === inlet ? 0 : inlet);
      packet.sendConfig(261, first === inlet ? 0 : inlet);
      return;
    }
    const index = pairIndex(first, inlet);
    setMachine(player, PIPE_VARBITS[fitted.length], index);
    junctionPick.set(player, 0);
    packet.sendConfig(261, 0);
    packet.sendConfig(262, 2 - fitted.length);
    sound(player, SOUND.placePipe);
    const uid = connectionComponent(index);
    if (uid !== null) packet.sendInterfaceDisplayState(uid, false);
    if (fitted.length + 1 === 3) {
      packet.sendInterfaceRemoval();
      playerLine(player, line("into-the-workshop-connecting-the-junction-box-pipes"));
    }
  }

  /**
   * The press lever (ticks 819-826, 1089-1095, 1099-1103): a tick after the pull the hammer comes
   * down over the jig, a tick later the box and the hammer's blow, two ticks on it is gone.
   */
  function pullPress(player, object) {
    const fl = floor(player);
    if (!fl || fl.pressBusy) return;
    pullLever(player, object);
    const reply = (variant) => later(player, 1, () => messageBox(player, line(variant)));
    if (pipes(player).length < 3) return reply("into-the-workshop-puling-the-press-lever-while-it-is-broken");
    if (!pipesSolved(player)) return reply("into-the-workshop-pulling-the-press-lever-with-the-junction-pipes-not-correctly-connected");
    if (machineValue(player, VARBIT.JIG_POS) !== CART_STOP.PRESS) return reply("into-the-workshop-pulling-the-press-lever-at-the-wrong-time");
    fl.pressBusy = true;
    steps(player, [
      [1, () => setLoc(player, HAMMER_TILE, HAMMER_IDS, 18644, 10, 0)],
      [2, () => {
        const jig = machineValue(player, VARBIT.JIG_STATE);
        let text;
        if (jig === JIG.HOT) {
          setMachine(player, VARBIT.EARTH_FIXED, 1);
          setMachine(player, VARBIT.JIG_STATE, JIG.FLAT_HOT);
          text = line("into-the-workshop-flattening-an-elemental-bar-after-heating-it");
        } else if (jig === JIG.FLAT_HOT || jig === JIG.FLAT || jig === JIG.DRY) {
          // Capture tick 1101; not in the Wiki's transcript.
          text = "You pull the lever and the press responds. The hardy comes down, hitting the elemental bar, but the bar has already been flattened.";
        } else {
          // Ours for a cold bar: the Wiki's no-bar line.
          text = line("into-the-workshop-pulling-the-press-lever-without-a-bar-in-position");
        }
        locAnim(player, HAMMER_TILE, HAMMER_IDS, ANIM.pressHammer);
        sound(player, SOUND.press);
        messageBox(player, text);
      }],
      [4, () => { removeLoc(player, HAMMER_TILE, HAMMER_IDS); fl.pressBusy = false; }],
    ]);
  }

  // ==========================================================================
  // The water tank
  // ==========================================================================

  function setDoor(player, value) {
    setMachine(player, VARBIT.WATER_DOOR, value);
    showDoor(player);
  }

  /** The door lever (ticks 850-854 open, 870-875 close): the door moves a tick after the pull, done two later. */
  function pullDoorLever(player, object) {
    const fl = floor(player);
    if (!fl || fl.doorBusy) return;
    if (machineValue(player, VARBIT.WATER_LEVEL)) {
      messageBox(player, line("into-the-workshop-pulling-the-lever-while-the-tank-is-full"));
      return;
    }
    const door = machineValue(player, VARBIT.WATER_DOOR);
    if (door % 3 === 2) return; // Ours: the rack is out; it has to come in first.
    fl.doorBusy = true;
    pullLever(player, object);
    const opening = door % 3 === 0;
    steps(player, [
      [1, () => {
        locAnim(player, TANK_DOOR_TILE, DOOR_IDS, opening ? ANIM.doorOpening : ANIM.doorClosing);
        sound(player, opening ? SOUND.doorOpen : SOUND.doorClose);
        if (!opening) sound(player, SOUND.valve, 5);
      }],
      [3, () => { setDoor(player, door + (opening ? 1 : -1)); fl.doorBusy = false; }],
    ]);
  }

  /**
   * The corkscrew (ticks 858-868, 920-931): out, the rack reaches the cart two ticks later; in, it
   * swaps the bar between the cart and the rack at once and is back three ticks later.
   */
  function turnCorkscrew(player, object) {
    const fl = floor(player);
    if (!fl || fl.doorBusy) return;
    const door = machineValue(player, VARBIT.WATER_DOOR);
    if (door % 3 === 0) {
      messageBox(player, line("into-the-workshop-turning-the-corkscrew-while-the-door-is-closer"));
      return;
    }
    fl.doorBusy = true;
    animate(player, ANIM.corkscrew);
    if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(ANIM.corkscrewLoc));
    sound(player, SOUND.screw, 10);
    if (door % 3 === 1) {
      locAnim(player, TANK_DOOR_TILE, DOOR_IDS, ANIM.rackOut);
      sound(player, SOUND.rack, 50);
      steps(player, [[2, () => { setDoor(player, door + 1); fl.doorBusy = false; }]]);
      return;
    }
    const atTank = machineValue(player, VARBIT.JIG_POS) === CART_STOP.TANK && !fl.cartMoving;
    const jig = machineValue(player, VARBIT.JIG_STATE);
    let extended = door;
    if (atTank && door === DOOR.EXTENDED && jig === JIG.FLAT_HOT) {
      setMachine(player, VARBIT.JIG_STATE, JIG.IN_TANK);
      extended = DOOR.EXTENDED_HOT;
    } else if (atTank && door === DOOR.EXTENDED_COLD && jig === JIG.IN_TANK) {
      setMachine(player, VARBIT.JIG_STATE, JIG.FLAT);
      extended = DOOR.EXTENDED;
    } else if (atTank && door === DOOR.EXTENDED_HOT && jig === JIG.IN_TANK) {
      setMachine(player, VARBIT.JIG_STATE, JIG.FLAT_HOT); // Ours: a hot bar goes back as it came
      extended = DOOR.EXTENDED;
    }
    setDoor(player, extended);
    steps(player, [
      [1, () => { locAnim(player, TANK_DOOR_TILE, DOOR_IDS, ANIM.rackIn); sound(player, SOUND.rack, 10); }],
      [3, () => { setDoor(player, extended - 1); fl.doorBusy = false; }],
    ]);
  }

  /** The tank fills with the inlet open and the drain shut; a hot bar shut in it cools (tick 885). */
  function tankFilled(player) {
    showTank(player);
    if (machineValue(player, VARBIT.WATER_DOOR) === DOOR.CLOSED_HOT) {
      setDoor(player, DOOR.CLOSED_COLD);
      sound(player, SOUND.coolBar);
    }
  }

  function startFilling(player) {
    locAnim(player, TANK_TILE, TANK_IDS, ANIM.tankFill);
    sound(player, SOUND.waterFlow);
  }

  /** Valves (ticks 878-910, 1164-1179): open/close lines, the tank's water and the cooling. */
  function turnValve(player, inlet) {
    const fl = floor(player);
    if (!fl || fl.valveBusy) return;
    const varbit = inlet ? VARBIT.VALVE_1 : VARBIT.VALVE_2;
    const opening = machineValue(player, varbit) === 0;
    if (opening && machineValue(player, VARBIT.WATER_STATE) === 0) {
      messageBox(player, line("into-the-workshop-turning-the-water-valve-before-repairing-the-pipe"));
      return;
    }
    const openLine = line("into-the-workshop-opening-the-water-valve");
    const closeLine = line("into-the-workshop-closing-the-water-valve");
    setMachine(player, varbit, opening ? 1 : 0);
    sound(player, SOUND.valve);
    const drain = machineValue(player, VARBIT.VALVE_2);
    const flowing = machineValue(player, VARBIT.VALVE_1);
    const busyUntil = (delay, text) => { fl.valveBusy = true; steps(player, [[delay, () => { messageBox(player, text); fl.valveBusy = false; }]]); };
    if (inlet) {
      setMachine(player, VARBIT.WATER_LEVEL, opening ? 1 : 0);
      if (!opening || drain) {
        showTank(player);
        messageBox(player, opening ? openLine : closeLine);
        return;
      }
      setLoc(player, TANK_TILE, TANK_IDS, 18660, 10, 0);
      steps(player, [[1, () => startFilling(player)], [4, () => tankFilled(player)]]);
      busyUntil(4, openLine);
      return;
    }
    if (opening) {
      if (flowing) locAnim(player, TANK_TILE, TANK_IDS, ANIM.tankEmpty);
      sound(player, SOUND.waterFlow);
      steps(player, [[3, () => showTank(player)]]);
      busyUntil(3, openLine);
      return;
    }
    if (!flowing) {
      messageBox(player, closeLine);
      return;
    }
    startFilling(player);
    steps(player, [[3, () => tankFilled(player)]]);
    busyUntil(3, closeLine);
  }

  // ==========================================================================
  // The wind tunnel
  // ==========================================================================

  const COG_LINES = { [I.SMALL_COG]: "small", [I.MEDIUM_COG]: "medium", [I.LARGE_COG]: "large" };

  function placeCog(player, pinVarbit, itemId) {
    if (machineValue(player, VARBIT.AIR_STATE)) {
      messageBox(player, line("into-the-workshop-trying-to-remove-a-cog-while-the-fan-is-on"));
      return;
    }
    if (machineValue(player, pinVarbit)) return;
    player.getInventory().deleteNumber(itemId, 1);
    setMachine(player, pinVarbit, COG_ITEMS.indexOf(itemId));
    sound(player, SOUND.placeCog);
    itemBox(player, itemId, line(`into-the-workshop-placing-cogs-on-the-shafts-${COG_LINES[itemId]}`));
  }

  function takeCog(player, pinVarbit) {
    if (machineValue(player, VARBIT.AIR_STATE)) {
      messageBox(player, line("into-the-workshop-trying-to-remove-a-cog-while-the-fan-is-on"));
      return;
    }
    const value = machineValue(player, pinVarbit);
    if (!value || !roomFor(player, 1)) return;
    setMachine(player, pinVarbit, 0);
    player.getInventory().adds(COG_ITEMS[value], 1);
  }

  function cogsCorrect(player) {
    return [VARBIT.COG_1, VARBIT.COG_2, VARBIT.COG_3].every((id) => machineValue(player, id) === CORRECT_COG[id]);
  }

  /** The fan lever (ticks 965-982): on, it blows (drying the bar at the tunnel) or sucks; off, it stops. */
  function pullFanLever(player, object) {
    pullLever(player, object);
    later(player, 1, () => {
      const cogs = COG_TILES.map(([x, y, z, type]) => ({ at: [x, y, z], type }));
      const animateCogs = (anims) => cogs.forEach((cog, i) => {
        const object = MapObjects.getObjectsAt(tile(player, cog.at), scene(player)?.area).find((o) => o.getType() === cog.type);
        if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(anims[i]));
      });
      if (machineValue(player, VARBIT.AIR_STATE)) {
        setMachine(player, VARBIT.AIR_STATE, 0);
        setMachine(player, VARBIT.FAN_STATE, 0);
        animateCogs([ANIM.cogsStop, ANIM.cogsStop, ANIM.cogsStop]);
        messageBox(player, line("into-the-workshop-turning-off-the-fan"));
        return;
      }
      const blowing = cogsCorrect(player);
      setMachine(player, VARBIT.AIR_STATE, 1);
      setMachine(player, VARBIT.FAN_STATE, blowing ? 1 : 2);
      animateCogs([ANIM.cogsReverse, ANIM.cogs, ANIM.cogs]);
      if (blowing && machineValue(player, VARBIT.JIG_POS) === CART_STOP.TUNNEL && !floor(player)?.cartMoving
        && machineValue(player, VARBIT.JIG_STATE) === JIG.FLAT) {
        setMachine(player, VARBIT.JIG_STATE, JIG.DRY);
      }
      const first = blowing ? line("into-the-workshop-turning-on-the-fan")
        : line("into-the-workshop-trying-to-turn-on-the-fan-with-the-cogs-placed-incorrectly", 0);
      messageBox(player, first, () => messageBox(player, line("into-the-workshop-trying-to-turn-on-the-fan-with-the-cogs-placed-incorrectly", 1)));
    });
  }

  function repairPiping(player) {
    if (machineValue(player, VARBIT.WATER_STATE)) return;
    player.getInventory().deleteNumber(PIPE, 1);
    setMachine(player, VARBIT.WATER_STATE, 1);
    sound(player, SOUND.placePipe);
    itemBox(player, PIPE, line("into-the-workshop-repairing-piping"));
  }

  // ==========================================================================
  // The extractor room
  // ==========================================================================

  /** Tick 1356: both leaves swing open; stage 8 the first time. */
  function openMindDoors(player) {
    for (const [closed, x, y, open, ox, oy, face] of MIND_DOORS) {
      removeLoc(player, [x, y, 0], new Set([closed]), 0);
      setLoc(player, [ox, oy, 0], new Set([open]), open, 0, face);
    }
    sound(player, SOUND.doorOpen);
    setStageAtLeast(player, STAGE.MIND_DOOR);
  }

  /** Ours: Close puts both leaves back as they stood. */
  function closeMindDoors(player) {
    for (const [closed, x, y, open, ox, oy] of MIND_DOORS) {
      removeLoc(player, [ox, oy, 0], new Set([open]), 0);
      setLoc(player, [x, y, 0], new Set([closed]), closed, 0, 0);
    }
    sound(player, SOUND.doorClose);
  }

  /** Doors.plugin owns "Mind Door"; it asks door:toggle first. */
  function mindDoorToggle(request) {
    const { player, objectId } = request;
    if (!scene(player)) return;
    if (objectId === MIND_DOOR || objectId === MIND_DOOR_L) openMindDoors(player);
    else if (objectId === MIND_DOOR_OPEN || objectId === MIND_DOOR_L_OPEN) closeMindDoors(player);
    else return;
    request.handled = true;
  }

  function placePrimedBar(player) {
    if (machineValue(player, VARBIT.MIND_JIG) !== 0) return;
    player.getInventory().deleteNumber(PRIMED_BAR, 1);
    setMachine(player, VARBIT.MIND_JIG, 1);
    setStageAtLeast(player, STAGE.BAR_PLACED);
    sound(player, SOUND.placeBar);
    itemBox(player, PRIMED_BAR, line("into-the-workshop-placing-the-primed-bar"));
  }

  /**
   * The extractor hat (ticks 1369-1381): the camera, the player slides onto the chair, the gun
   * fires, four ticks later the bar is charged and Magic drops by 20, and the player slides off.
   */
  function operateHat(player) {
    const fl = floor(player);
    if (!fl || fl.extractor || machineValue(player, VARBIT.MIND_JIG) !== 1) return;
    if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < MAGIC_DRAIN) {
      player.sendMessage(MESSAGE.extractorMagic);
      return;
    }
    fl.extractor = true;
    const seat = tile(player, HAT_TILE);
    const beside = player.getLocation().clone();
    const toSeat = new Location(seat.getX() - beside.getX(), seat.getY() - beside.getY());
    const toBeside = new Location(beside.getX() - seat.getX(), beside.getY() - seat.getY());
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.camera(player, [1957, 5143, 500], [1959, 5146, 300], { rate: 100, rate2: 100 });
    steps(player, [
      // Tick 1371: on the chair in the same tick as the slide onto it.
      [1, () => {
        player.moveTo(seat);
        player.setForceMovement(new ForceMovement(beside, toSeat, 0, 20, 1, ANIM.chair));
        animate(player, ANIM.chair);
        sound(player, SOUND.mindControl);
      }],
      [2, () => {
        player.setForceMovement(null);
        player.performGraphic(new Graphic(CHAIR_SPOTANIM));
        removeLoc(player, HAT_TILE, HAT_IDS);
      }],
      [3, () => { locAnim(player, GUN_TILE, EXTRACTOR_GUN_IDS, ANIM.gun); sound(player, SOUND.zap); }],
      [7, () => {
        setMachine(player, VARBIT.MIND_JIG, 2);
        setStageAtLeast(player, STAGE.MIND_BAR);
        const magic = player.getSkillManager().getCurrentLevel(Skill.MAGIC);
        player.getSkillManager().setCurrentLevel(Skill.MAGIC, Math.max(0, magic - MAGIC_DRAIN), true);
      }],
      [8, () => setLoc(player, HAT_TILE, HAT_IDS, EXTRACTOR_HAT, 10, 1)],
      // Tick 1379: back off in the same tick as the slide.
      [9, () => { player.moveTo(beside); player.setForceMovement(new ForceMovement(seat, toBeside, 0, 30, 1, -1)); }],
      [10, () => player.setForceMovement(null)],
      [11, () => {
        player.sendMessage(line("into-the-workshop-making-the-mind-bar"));
        player.getPacketSender().sendCameraReset();
        player.getMovementQueue().setBlockMovement(false);
        fl.extractor = false;
      }],
    ]);
  }

  function takeFromGun(player) {
    const charge = machineValue(player, VARBIT.MIND_JIG);
    if (charge === 0 || floor(player)?.extractor) return;
    if (!roomFor(player, 1)) return;
    setMachine(player, VARBIT.MIND_JIG, 0);
    if (charge === 2) {
      player.getInventory().adds(MIND_BAR, 1);
      itemBox(player, MIND_BAR, line("into-the-workshop-taking-the-mind-bar"));
    } else {
      player.getInventory().adds(PRIMED_BAR, 1); // Ours: an uncharged bar comes back
    }
  }

  // ==========================================================================
  // The workbench (Elemental Workshop I's shield too)
  // ==========================================================================

  /**
   * What the bench offers (ticks 451-473, 1448-1471; Wiki recipes): a shield with a book from
   * Elemental Workshop I, the claw with the crane schematic while the crane still needs it, an
   * elemental helmet with the beaten book after this quest, and from a primed mind bar a mind
   * helmet (beaten book) or, after the quest or without the beaten book, a mind shield (slashed book).
   * One choice is made at once; more open skillmulti ("What would you like to smith?").
   */
  function recipes(player) {
    const list = [];
    const done = quest.isComplete(player);
    const shieldBook = has(player, I.SLASHED_BOOK) || has(player, I.BATTERED_BOOK);
    if (has(player, ELEMENTAL_METAL)) {
      if (shieldBook) list.push({ product: I.ELEMENTAL_SHIELD, bar: ELEMENTAL_METAL, level: 20, xp: XP.shield, kind: "shield" });
      if (has(player, CRANE_SCHEMATIC) && stage(player) >= STAGE.MACHINE_FLOOR && machineValue(player, VARBIT.FIRE_STATE) === CLAW.BROKEN) {
        list.push({ product: CRANE_CLAW, bar: ELEMENTAL_METAL, level: 20, xp: XP.claw, kind: "claw" });
      }
      if (done && has(player, BEATEN_BOOK)) list.push({ product: I.ELEMENTAL_HELMET, bar: ELEMENTAL_METAL, level: 20, xp: XP.helmet, kind: "helmet" });
    }
    if (has(player, MIND_BAR)) {
      if (done && has(player, I.SLASHED_BOOK)) { // Wiki (Mind shield): needs the quest done; the capture offers it only then (1464)
        list.push({ product: I.MIND_SHIELD, bar: MIND_BAR, level: MIND_SMITHING_LEVEL, xp: XP.mindShield, kind: "mindShield" });
      }
      if (has(player, BEATEN_BOOK)) list.push({ product: I.MIND_HELMET, bar: MIND_BAR, level: MIND_SMITHING_LEVEL, xp: XP.mindHelmet, kind: "mindHelmet" });
    }
    return list;
  }

  function useWorkbench(player, preferredSlot = -1) {
    if (crafting.get(player)) return;
    if (!has(player, ELEMENTAL_METAL) && !has(player, MIND_BAR)) {
      messageBox(player, line("into-the-workshop-crafting-the-mind-helm-using-the-workbench-without-elemental-metal"));
      return;
    }
    if (!holdsHammer(api.core, player)) {
      messageBox(player, line("into-the-workshop-crafting-the-mind-helm-using-the-workbench-without-a-hammer"));
      return;
    }
    const list = recipes(player);
    if (list.length === 0) {
      messageBox(player, line("into-the-workshop-crafting-the-mind-helm-using-the-workbench-without-the-beaten-book"));
      return;
    }
    if (list.length === 1) {
      startCrafting(player, list[0], 1, preferredSlot);
      return;
    }
    const byProduct = new Map(list.map((recipe) => [recipe.product, recipe]));
    const most = Math.max(...list.map((recipe) => player.getInventory().getAmount(recipe.bar)));
    const creation = new CreationMenu("What would you like to smith?", list.map((recipe) => recipe.product), {
      execute: (itemId, amount) => {
        const recipe = byProduct.get(itemId);
        if (recipe) startCrafting(player, recipe, Math.max(1, amount | 0), -1);
      },
    }, { labels: list.map((recipe) => CacheDefinitions.getItem(recipe.product)?.name ?? ""), maxAmount: most, mode: 25 });
    player.getPacketSender().sendCreationMenu(creation);
  }

  function craftLevelOk(player, recipe) {
    if (player.getSkillManager().getCurrentLevel(Skill.SMITHING) >= recipe.level) return true;
    player.sendMessage(recipe.level > 20 ? MESSAGE.mindLevel : MESSAGE.metalLevel);
    return false;
  }

  /** Each item: the hammering at once, the bar taken and the product given four ticks later (Wiki), then the next. */
  function startCrafting(player, recipe, amount, preferredSlot) {
    if (!craftLevelOk(player, recipe)) return;
    const start = player.getLocation().clone();
    const inventory = player.getInventory();
    const job = { left: amount };
    const teleports = player.getTeleportSerial?.() ?? 0;
    /** A plain bar (a preset copy is never worked), in the hinted slot or the first one. */
    const plain = (index) => {
      const item = inventory.getItems()[index];
      return item?.getId?.() === recipe.bar && item.getAmount() === 1 && item.getMeta?.() == null;
    };
    const slotFor = (hint) => (plain(hint) ? hint : inventory.getItems().findIndex((_, index) => plain(index)));
    /** Still at the bench, not moved away or teleported, with the hammer, the book and the level. */
    const stillThere = () => crafting.get(player) === job && player.getLocation().equals(start)
      && (player.getTeleportSerial?.() ?? 0) === teleports && player.getHitpoints() > 0 && holdsHammer(api.core, player)
      && player.getSkillManager().getCurrentLevel(Skill.SMITHING) >= recipe.level
      && recipes(player).some((r) => r.product === recipe.product);
    let slot = slotFor(preferredSlot);
    if (slot < 0) return;
    crafting.set(player, job);
    const hammer = () => { animate(player, ANIM.workbench); sound(player, SOUND.anvil); };
    hammer();
    everyTick(player, (n) => {
      if (!stillThere()) { if (crafting.get(player) === job) crafting.delete(player); return false; }
      if (n % CRAFT_TICKS !== 0) return true;
      if (!plain(slot)) { crafting.delete(player); return false; }
      // Live takes the bar and gives the product to the first free slot (ticks 1446-1454: slot 8, the bar in 9).
      inventory.deleteAtSlot(slot, 1);
      inventory.adds(recipe.product, 1);
      player.getSkillManager().addExperiences(Skill.SMITHING, recipe.xp);
      crafted(player, recipe);
      job.left--;
      slot = job.left > 0 && stillThere() ? slotFor(-1) : -1;
      if (slot < 0) { crafting.delete(player); return false; }
      hammer();
      return true;
    });
  }

  function crafted(player, recipe) {
    if (recipe.kind === "shield") {
      player.sendMessage(MESSAGE.shieldMade);
      api.emitCustomEvent("elemental-workshop-i:shield-made", { player });
    } else if (recipe.kind === "claw") {
      player.sendMessage(line("into-the-workshop-making-an-elemental-claw"));
    } else if (recipe.kind === "mindShield") {
      player.sendMessage(MESSAGE.mindShieldMade);
    } else if (recipe.kind === "mindHelmet") {
      player.sendMessage(line("into-the-workshop-crafting-the-mind-helm-using-the-workbench-with-the-proper-items"));
      api.emitCustomEvent("diary:task", { player, diary: "kandarin", task: "create-a-mind-helmet" });
      if (!quest.isComplete(player)) {
        // The note goes as the quest completes (tick 1454).
        while (has(player, NOTE)) player.getInventory().deleteNumber(NOTE, 1);
        quest.complete(player);
      }
    }
  }

  function cancelCrafting({ player }) {
    crafting.delete(player);
  }

  // ==========================================================================
  // Old saves
  // ==========================================================================

  /** Converts the old 1-12 stage scheme and its attributes to live's stages and the varbit save. */
  function migrate(player) {
    if (Number(player.getAttribute(SCHEME_ATTRIBUTE)) === SCHEME) return;
    player.setAttribute(SCHEME_ATTRIBUTE, SCHEME);
    const old = stage(player);
    if (old === 0) return;
    const flags = Number(player.getAttribute("quest.elemental_workshop_ii.flags")) || 0;
    const jig = Number(player.getAttribute("quest.elemental_workshop_ii.jig")) || 0;
    const water = Number(player.getAttribute("quest.elemental_workshop_ii.water")) || 0;
    const air = Number(player.getAttribute("quest.elemental_workshop_ii.air")) || 0;
    const pipeBits = Number(player.getAttribute("quest.elemental_workshop_ii.pipes")) || 0;
    const mind = Number(player.getAttribute("quest.elemental_workshop_ii.mind")) || 0;
    const stageMap = [0, 1, 2, 3, 4, 5, 6, 6, 6, 6, 7, 10, 11];
    quest.setStage(player, stageMap[Math.min(old, 12)]);
    const set = (id, value) => setMachine(player, id, value);
    set(VARBIT.HIDE_KEY, old >= 3 || (flags & 1) ? 1 : 0);
    set(VARBIT.HATCH, (flags & 2) || old >= 5 ? 1 : 0);
    set(VARBIT.WATER_STATE, flags & 4 ? 1 : 0);
    set(VARBIT.EARTH_FIXED, flags & 8 ? 1 : 0);
    set(VARBIT.JIG_POS, jig & 3);
    set(VARBIT.JIG_STATE, (jig >> 2) & 7);
    set(VARBIT.FIRE_POS, (jig >> 5) & 3);
    set(VARBIT.FIRE_STATE, (jig >> 7) & 3);
    set(VARBIT.WATER_DOOR, water & 15);
    set(VARBIT.WATER_LEVEL, (water >> 4) & 1);
    set(VARBIT.VALVE_1, (water >> 5) & 1);
    set(VARBIT.VALVE_2, (water >> 6) & 1);
    set(VARBIT.COG_1, air & 3);
    set(VARBIT.COG_2, (air >> 2) & 3);
    set(VARBIT.COG_3, (air >> 4) & 3);
    set(VARBIT.AIR_STATE, (air >> 6) & 1);
    set(VARBIT.FAN_STATE, (air >> 7) & 3);
    set(VARBIT.PIPE_1, pipeBits & 15);
    set(VARBIT.PIPE_2, (pipeBits >> 4) & 15);
    set(VARBIT.PIPE_3, (pipeBits >> 8) & 15);
    set(VARBIT.MIND_JIG, mind & 3);
    for (const key of ["flags", "jig", "water", "air", "pipes", "mind"]) player.setAttribute(`quest.elemental_workshop_ii.${key}`, null);
  }

  // ==========================================================================
  // Journal (captured at stages 3 and 7, ticks 95 and 1019; the rest is ours)
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const value = questHandle.getStage(player);
    if (value >= STAGE.COMPLETE) {
      return ["<str>I made a mind helmet from a primed mind bar.", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (value === 0) {
      return [
        "I can start this quest by searching the bookcases in the Exam Centre's",
        "library.",
        "",
        "Minimum requirements: 20 Magic, 30 Smithing and Elemental Workshop I.",
      ];
    }
    if (value === STAGE.STARTED) return ["I have found a book at the Dig Site; I should read it."]; // Ours
    const lines = [
      "<str>I have found a book at the Dig Site.",
      "<str>The book tells of a way to make elemental items even more",
      "<str>powerful than before.",
    ];
    if (value === STAGE.BOOK_READ) return [...lines, "I should read the note I found with the book."]; // Ours
    if (value === STAGE.NOTE_READ) {
      return [...lines, "The note found with the book has a <col=800000>strange code</col> written on it;", "I wonder what it means."];
    }
    lines.push("<str>The note found with the book has a strange code written on it.");
    const strike = (text, done) => (done ? `<str>${text}` : text);
    lines.push(strike("By following the code on the note I was able to find a key.", value >= STAGE.HATCH_UNLOCKED));
    if (value < STAGE.HATCH_UNLOCKED) return lines;
    lines.push(strike("The key I've found opens the large hatch in the elemental", value >= STAGE.MACHINE_FLOOR), strike("workshop.", value >= STAGE.MACHINE_FLOOR));
    if (value < STAGE.MACHINE_FLOOR) return lines;
    const primed = value >= STAGE.PRIMED_BAR;
    lines.push(strike("Climbing down through the hatch I found a new area in the", primed), strike("workshop; there are 4 machines on this level to fix:", primed));
    if (machineValue(player, VARBIT.FIRE_STATE) !== CLAW.BROKEN || primed) {
      lines.push(strike("The crane - now the claw has been replaced the crane looks", primed), strike("like it's in good working order.", primed));
    }
    if (pipesSolved(player) || primed) {
      lines.push(strike("The press - the pipes have now been fitted and it should work", primed), strike("as long as it's powered.", primed));
    }
    if (machineValue(player, VARBIT.WATER_STATE) || primed) lines.push(strike("The tank - this should work fine now I have replaced the pipe.", primed));
    if (cogsCorrect(player) || primed) {
      lines.push(strike("A wind tunnel - I have fitted all the cogs on to the pins. The", primed), strike("wind tunnel should now work as long as it's powered.", primed));
    }
    lines.push(strike("Once I have fixed all the equipment I'll need to work out how to", primed), strike("use it.", primed));
    if (!primed) return lines;
    lines.push(
      "<str>I have found a track-mounted jig on which I was able to clamp", "<str>an elemental bar.",
      "<str>I was able to operate the crane and dip the elemental bar into", "<str>the lava. The bar is now very hot.",
      "<str>I used the press to flatten the hot elemental bar.",
      "<str>The water tank was used to cool the elemental bar down.",
      "<str>The wind tunnel proved a great way to dry off the wet bar.",
    );
    lines.push(strike("I have primed a bar of elemental ore, I wonder what to do with", value >= STAGE.BAR_PLACED), strike("it.", value >= STAGE.BAR_PLACED));
    // Ours from here: no capture of the journal below the machine floor.
    if (value >= STAGE.BAR_PLACED) lines.push(strike("I have put the primed bar under the extractor gun.", value >= STAGE.MIND_BAR));
    if (value >= STAGE.MIND_BAR) lines.push("I should smith the primed mind bar into a helmet at a workbench.");
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 7500);
    player.getSkillManager().addExperiences(Skill.SMITHING, 7500);
  }

  // ==========================================================================
  // Event routing
  // ==========================================================================

  function objectOption(event) {
    return String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  }

  function handleObjectInteraction(event) {
    const { player, objectId, object } = event;
    const option = objectOption(event);
    const take = () => { event.handled = true; };
    if (objectId === BOOKCASE && option === "search") return take(), searchBookcase(player);
    if (BOILER_IDS.has(objectId) && option === "search") return take(), searchBoiler(player);
    if (HATCH_IDS.has(objectId) && (option === "open" || option === "climb-down")) return take(), openHatch(player);
    if (objectId === WORKBENCH && option === "smith") return take(), useWorkbench(player);
    if (!scene(player)) return;
    if (objectId === SCHEMATIC_CRATE && option === "take-from") return take(), searchSchematics(player);
    if (CRATE_INDEX.has(objectId) && option === "search") return take(), searchCrate(player, objectId);
    if (objectId === RAISE_LEVER && option === "pull") return take(), raiseOrLower(player, object);
    if (objectId === ROTATE_LEVER && option === "pull") return take(), rotate(player, object);
    if (objectId === CART_LEVER && option === "pull") return take(), pullCartLever(player, object);
    if (objectId === PRESS_LEVER && option === "pull") return take(), pullPress(player, object);
    if (objectId === JUNCTION_BOX && option === "open") return take(), openJunctionBox(player);
    if (objectId === DOOR_LEVER && option === "pull") return take(), pullDoorLever(player, object);
    if (objectId === CORKSCREW && option === "turn") return take(), turnCorkscrew(player, object);
    if ((objectId === VALVE_1 || objectId === VALVE_2) && option === "turn") return take(), turnValve(player, objectId === VALVE_1);
    if (objectId === FAN_LEVER && option === "pull") return take(), pullFanLever(player, object);
    if (COG_LOCS.has(objectId) && option === "take") return take(), takeCog(player, COG_LOCS.get(objectId));
    if ((objectId === MIND_DOOR || objectId === MIND_DOOR_L) && option === "open") return take(), openMindDoors(player);
    if (objectId === EXTRACTOR_HAT && option === "operate") return take(), operateHat(player);
    if (EXTRACTOR_GUN_IDS.has(objectId) && option === "take-from") return take(), takeFromGun(player);
    if (objectId === STAIRS_UP && option === "climb-up") return take(), climbUpToWorkshop(player);
    if (objectId === STAIRWELL && option === "climb-down") return take(), climbToBasement(player);
    if (objectId === STAIRS_UP_BASEMENT && option === "climb-up") return take(), climbFromBasement(player);
    if ((objectId === GANTRY_UP || objectId === GANTRY_DOWN) && option.startsWith("climb")) return take(), climbGantry(player, object, objectId === GANTRY_UP);
  }

  function handleItemOnObject(event) {
    const { player, objectId, itemId, itemSlot } = event;
    if (HATCH_IDS.has(objectId) && !machineValue(player, VARBIT.HATCH)) {
      event.handled = true;
      if (itemId === HATCH_KEY) unlockHatch(player);
      else messageBox(player, MESSAGE.wrongHatchItem);
      return;
    }
    if (objectId === WORKBENCH && (itemId === ELEMENTAL_METAL || itemId === MIND_BAR || itemId === CRANE_SCHEMATIC)) {
      event.handled = true;
      useWorkbench(player, itemId === CRANE_SCHEMATIC ? -1 : itemSlot);
      return;
    }
    if (!scene(player)) return;
    if (CRANE_IDS.has(objectId)) {
      event.handled = true;
      if (itemId === CRANE_CLAW) repairClaw(player);
      else player.sendMessage(MESSAGE.reach);
      return;
    }
    if (PIPING_IDS.has(objectId) && itemId === PIPE) return void (event.handled = true, repairPiping(player));
    if (PINS.has(objectId) && COG_LINES[itemId]) return void (event.handled = true, placeCog(player, PINS.get(objectId), itemId));
    if (EXTRACTOR_GUN_IDS.has(objectId) && itemId === PRIMED_BAR) return void (event.handled = true, placePrimedBar(player));
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!CART_NPC_IDS.has(npcId) || itemId !== ELEMENTAL_METAL || !scene(player)) return;
    event.handled = true;
    placeBarOnCart(player);
  }

  function handleNpcInteraction(event) {
    if (!CART_NPC_IDS.has(event.npcId) || !scene(event.player)) return;
    event.handled = true;
    takeFromCart(event.player);
  }

  function handleItemAction(event) {
    if (String(event.option ?? "").toLowerCase() !== "read") return;
    const { player, itemId } = event;
    const action = { [BEATEN_BOOK]: readBook, [NOTE]: readNote, [CRANE_SCHEMATIC]: readCraneSchematic, [LEVER_SCHEMATIC]: readLeverSchematic }[itemId];
    if (!action) return;
    event.handled = true;
    action(player);
  }

  /** The cart's route assist: the pins and the crane sit in blocking scenery (no walkable tile of their own). */
  function routeAdjacentObjectUse(event) {
    if (!PINS.has(event.objectId) && !CRANE_IDS.has(event.objectId) && !PIPING_IDS.has(event.objectId)) return;
    const at = event.player.getLocation();
    const object = event.object?.getLocation?.();
    const size = Math.max(event.object?.getDefinition?.()?.getSizeX?.() ?? 1, event.object?.getDefinition?.()?.getSizeY?.() ?? 1);
    if (!object) return;
    const reach = Math.max(object.getX() - at.getX(), at.getX() - (object.getX() + size - 1), object.getY() - at.getY(), at.getY() - (object.getY() + size - 1), 0);
    if (reach > 2) return;
    event.destination = { x: at.getX(), y: at.getY(), z: at.getZ() };
  }

  function handleLogin({ player }) {
    migrate(player);
    syncMachine(player);
    refreshQuestList(player);
  }

  for (const attribute of Object.values(MACHINE_ATTRIBUTE)) api.persistAttribute(attribute, 0);
  api.persistAttribute(SCHEME_ATTRIBUTE, 0);
  api.persistAttribute(CRATES_ATTRIBUTE, 0);
  for (const key of ["flags", "jig", "water", "air", "pipes", "mind"]) api.persistAttribute(`quest.elemental_workshop_ii.${key}`);

  quest = registerQuest(api, {
    key: KEY,
    name: PAGE,
    varbitId: VARBIT.MAIN,
    startedValue: STAGE.STARTED,
    completionValue: STAGE.COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 7500, label: "Crafting" },
      { skillId: Skill.SMITHING.getIndex(), amount: 7500, label: "Smithing" },
    ],
    scrollItemId: I.MIND_HELMET,
    otherRewards: ["Ability to make Mind", "Equipment"],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("ladders:climb", claimClimb);
  api.onCustomEvent("door:toggle", mindDoorToggle);
  api.onObjectRoute(routeAdjacentObjectUse);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnNpc(handleItemOnNpc);
  api.onNpcInteraction(handleNpcInteraction);
  api.onItemAction(handleItemAction);
  api.onInterfaceActionClick(clickJunction);
  api.onCustomEvent("interface:opened", cancelCrafting);
  api.onCustomEvent("player:interaction-cleared", cancelCrafting);
  api.onPlayerDisconnect(cancelCrafting);
  api.onPlayerLogout(cancelCrafting);
  api.onPlayerLogin(handleLogin);

  return { _test: { STAGE, VARBIT, machineValue, setMachine, CART_PATH, STOP_INDEX, pairIndex, craneLoc, recipes, migrate } };
};
