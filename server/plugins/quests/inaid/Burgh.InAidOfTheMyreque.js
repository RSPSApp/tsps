/**
 * In Aid of the Myreque: Burgh (see ../quests/InAidOfTheMyreque.Quest.js for the unit map).
 *
 * Stages 20-109: Florin and the gate, the food chest, the inn, its cellar and the rubble, the plaque
 * and the rubble pile outside, and the citizens' and Aurel's talks before the cellar is cleared. Live's
 * capture (revision 242, ticks 267-1266) is the model:
 *
 * - Approaching at 20, Florin throws rotten food every 10 ticks (t270, t280, t290): human_throw 385,
 *   spotanim 30 on him, his overhead line, projectile 29 (start 28, end 46 + 5 per tile, angle 15,
 *   progress 32, heights 163/96), spotanim 31 on the player delayed to the landing, thrown 2708 and
 *   apple_splat 2285, a 0 hitsplat when it lands (floor(end / 30) ticks), and an open chatbox closes.
 *   Each throw raises varbit 1969 (cap 3); it falls by one every ~200 ticks (t491, t700, t901).
 * - The gate at 20 shows only the locked mesbox (t295). From 40 it opens as a pass-through gate
 *   (t445, t1970): inviswall on both gate tiles, the open leaves 12818/12819 on the tiles south,
 *   gate_open 67, the player walks one tile across, and the closed gates are back two ticks later.
 * - Florin's "Hey! Don't try to sweet talk me..." sets 30 (t309); food on the chest (t371) shows the
 *   objectbox, then the camera (t373) and his held line, reset 11 ticks later (t384), and sets 40;
 *   "Well, there's the inn..." sets 60 (any citizen's "out of the way" answer).
 * - The broken wall's Climb-over (t794): exactmove one tile, human_walk_crumbledwall 840, climb_wall
 *   2453; the first one sets 70. A pickaxe on the collapsed wall (t799-803): "You swing your pickaxe
 *   at the rubble...", four ticks, then varbit 1970 = 1, 80, "...and successfully break it down." and
 *   mine_ore 3600. The trapdoor's Open (t807): 1971 = 1, 90, trapdoor_open 91; Climb-down (t811):
 *   human_pickupfloor 827 and 100, and a tick later the plane-1 cellar instance with 15 rubble locs.
 * - A rubble (t819-838): three Mine steps three ticks apart (12812 -> 12813 -> 12814 -> 12815, mine_ore
 *   and 10 Mining each), then Remove with a spade: two human_dig 830 / digspade 1470 two ticks apart
 *   and, two ticks later, varbit 1972 + 1, the loc gone and the bucket one fill further (1925 -> 7622
 *   -> 7624 -> 7626). The first rubble mined sets 2006 and shows the long mesbox. Scoops 2 and 8 drop
 *   rubbish, 5 the plaster fragment, 10 the dusty scroll; the 15th sets 110 with the plaque camera.
 * - The plaque's Search (t1133) sets 1973 once. The rubble pile's Search (t1242-1255) hands back the
 *   plaster and scroll and asks to empty the buckets; dropping one in town is refused (t1187).
 */
module.exports = function attachBurgh(context) {
  const { api, state, common, STAGE, VARBIT, PAGE } = context;
  const core = api.core;
  const { ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O, Location, Skill } = core;
  const { loadTranscripts } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  // ---------------------------------------------------------------------------
  // Ids (cache gamevals in comments)
  // ---------------------------------------------------------------------------

  const FLORIN = N.FLORIN; // 4454 burgh_vilager_8
  const AUREL = N.AUREL; // 4445 burgh_general_store_owner

  const FOOD_CHEST = O.OPEN_CHEST_21; // 12736 burgh_quest_food_chest_open
  const BROKEN_WALL = O.BROKEN_WALL_7; // 12737 burgh_inn_climb_over
  const COLLAPSED_WALL = 12738; // burgh_inn_colapsed_wall_multiloc (varbit 1970), nameless base
  const TRAPDOOR = 12743; // burgh_inn_trapdoor_multiloc (varbit 1971), nameless base
  const RUBBLE_PILE = O.RUBBLE_PILE; // 12749 burgh_outside_rubble_pile
  const PLAQUE = O.PLAQUE_11; // 12750 burgh_inn_wall_plaque
  const CELLAR_LADDER = O.LADDER_163; // 12779 burgh_inn_basement_ladderup
  /** burgh_rubble_a_1..4: Mine, Mine, Mine, Remove. */
  const RUBBLE_STEPS = [O.RUBBLE_8, O.RUBBLE_9, O.RUBBLE_10, O.RUBBLE_11]; // 12812-12815
  const GATE_LEFT = O.GATE_113; // 12816 burgh_fencegate_l
  const GATE_RIGHT = O.GATE_114; // 12817 burgh_fencegate_r
  const GATE_LEFT_OPEN = O.GATE_115; // 12818 burgh_openfencegate_l
  const GATE_RIGHT_OPEN = 12819; // burgh_openfencegate_r, nameless in the cache
  const INVISWALL = 38848; // inviswall, nameless in the cache

  const BUCKET = I.BUCKET; // 1925 bucket_empty
  /** burgh_rubble_bucket_1..3: one, two and three loads. */
  const RUBBLE_BUCKETS = [I.BUCKET_OF_RUBBLE, I.BUCKET_OF_RUBBLE_3, I.BUCKET_OF_RUBBLE_5]; // 7622, 7624, 7626
  const FILLS = [BUCKET, ...RUBBLE_BUCKETS];
  const SPADE = I.SPADE; // 952
  const POT = I.POT; // 1931
  const PLASTER = I.PLASTER_FRAGMENT; // 7628 burgh_plaster_inscription_ivandis
  const SCROLL = I.DUSTY_SCROLL; // 7629 burgh_efaritay_info_scroll
  const STEEL_NAILS = I.STEEL_NAILS; // 1539 nails
  const BROKEN_GLASS = I.BROKEN_GLASS_2; // 1469 broken_glass
  const ROCK = I.ROCK; // 968
  /** The rubbish left on the floor (t856, t975: owner-only, 200 ticks), in live's order. */
  const RUBBISH_FLOOR = [[I.BRONZE_NAILS, 10], [I.IRON_NAILS, 5], [ROCK, 1], [I.BLACK_NAILS, 2], [I.MITHRIL_NAILS, 1]];
  const RUBBISH_DESPAWN_TICKS = 200;

  // Sequences, spotanims and sounds (as captured)
  const HUMAN_THROW = 385;
  const TOMATO_LAUNCH = 30; // rotten_tomato_launch
  const ROTTEN_SPLASH = 31; // rotten_splash
  const TOMATO_TRAVEL = 29; // rotten_tomato_travel
  const THROWN = 2708;
  const APPLE_SPLAT = 2285;
  const GATE_OPEN = 67;
  const CRUMBLED_WALL_WALK = 840; // human_walk_crumbledwall
  const CLIMB_WALL = 2453;
  const MINE_ORE = 3600;
  const TRAPDOOR_OPEN = 91;
  const PICKUP_FLOOR = 827; // human_pickupfloor
  const REACH_FOR_LADDER = 828; // human_reachforladder
  const HUMAN_DIG = 830;
  const DIG_SPADE = 1470;
  const POUR = 2283; // farming_pour_water
  /** chathap2 and chatsad2, the heads live used for Florin's chest line and Aurel's refusal. */
  const CHAT_HAPPY = 568;
  const CHAT_SAD = 611;

  const PELT = Object.freeze({ cap: 3, range: 10, every: 10, decay: 200, start: 28, base: 46, perTile: 5, angle: 15,
    progress: 32, startHeight: 163, endHeight: 96, height: 96 });
  /** Burgh de Rott's map square (64 x 64), where Florin can see the road in. */
  const BURGH_SQUARE = Object.freeze({ x: 54, y: 50 });
  const MINE_STEP_TICKS = 3; // t819 -> 822 -> 825 -> 828
  const SCOOP_TICKS = [2, 4]; // t834 dig, t836 dig, t838 the load
  /** update_stat_v2 mining +10 on each step (t822, t825, t828; the Wiki gives no value). */
  const RUBBLE_MINING_XP = 10;
  const WALL_BREAK_TICKS = 4; // t799 -> t803
  const CLIMB_TICKS = 2; // busy t794-796, exactmove delay2 60
  const CHEST_LINE_TICKS = 11; // t373 -> t384

  const GATE_TILES = Object.freeze({ y: 3244, closed: [[GATE_LEFT, 3485, 3244, 0, 3], [GATE_RIGHT, 3484, 3244, 0, 3]],
    opened: [[INVISWALL, 3484, 3244, 0, 3], [GATE_LEFT_OPEN, 3485, 3243, 0, 2], [INVISWALL, 3485, 3244, 0, 3],
      [GATE_RIGHT_OPEN, 3485, 3242, 0, 2]] });
  const GATE_OPEN_TICKS = 2;
  /** MovementQueue.IGNORE_CLIPPING_FLAG: the opener's step goes over the inviswall. */
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
  const TRAPDOOR_TILE = Object.freeze({ x: 3490, y: 3232, z: 0 });
  /** Live's cellar copy: source 3488-3503 x 9616-9639 on plane 1 (t812), entered at 3491,9632,1. */
  const CELLAR = Object.freeze({ sourceChunk: [3488 >> 3, 9616 >> 3], size: 3, bounds: [[3488, 3511, 9616, 9639, 1]],
    at: [3491, 9632, 1], exit: [3491, 3232, 0] });
  /** Ours: past 110 the trapdoor goes to the plane-0 cellar, where live landed at 430 (t4930). */
  const CLEARED_CELLAR = Object.freeze({ x: 3490, y: 9631, z: 0 });
  /** The 15 rubble locs (12812, shape 10, plane 1) live added at t812, with their rotations. */
  const RUBBLE_TILES = Object.freeze([
    [3495, 9624, 2], [3494, 9628, 1], [3494, 9626, 2], [3494, 9624, 0], [3494, 9625, 2], [3494, 9627, 3],
    [3497, 9626, 3], [3497, 9624, 1], [3496, 9624, 1], [3498, 9626, 0], [3497, 9627, 3], [3498, 9625, 3],
    [3498, 9627, 2], [3498, 9628, 0], [3498, 9623, 1],
  ]);
  const RUBBISH_AT = new Set([2, 8]); // t856, t975
  const PLASTER_AT = 5; // t921
  const SCROLL_AT = 10; // t1013
  const CELLAR_EXIT_ATTRIBUTE = "in-aid-of-the-myreque:cellar-exit";

  const VARIANT = Object.freeze({
    gate: "entering-burgh-de-rott-attempting-to-open-the-gate",
    enter: "entering-burgh-de-rott-attempting-to-enter",
    chestSearch: "entering-burgh-de-rott-depositing-food-searching-the-chest",
    chestFood: "entering-burgh-de-rott-depositing-food-using-food-on-the-chest",
    afterFood: "entering-burgh-de-rott-depositing-food-speaking-to-florin-after-using-food-on-the-chest",
    citizens: "entering-burgh-de-rott-speaking-to-citizens",
    child: "entering-burgh-de-rott-speaking-to-citizens-child-citizen",
    marius: "entering-burgh-de-rott-speaking-to-citizens-marius",
    clearing: "entering-burgh-de-rott-speaking-to-citizens-while-clearing-the-inn",
    entrance: "entering-burgh-de-rott-cleaning-the-inn-clearing-the-entrance-to-the-basement",
    basement: "entering-burgh-de-rott-cleaning-the-inn-clearing-the-basement",
    rubble: "entering-burgh-de-rott-cleaning-the-inn-getting-rid-of-the-rubble",
  });

  /** Lines live sent that the transcript page does not hold (capture ticks in the docs). */
  const LIVE_TEXT = Object.freeze({
    swing: "You swing your pick at the rock.", // t819, a spam message
    plaque: "You read the wall plaque:<br>'<col=000080>Blessings on Efaritay, our icyene queen from far off lands and her<br>"
      + "<col=000080>loving children of Hallowed name.<col=000000>'", // t1133
    plasterBack: "You find a piece of plaster with some interesting inscriptions on it, but you don't have enough space to keep"
      + " it. You throw it back onto the rubble pile.", // t1242
    scrollBack: "You find a scroll with some interesting writing on it, but you don't have enough space to keep it. You throw"
      + " it back onto the rubble pile.", // t1249
    emptyPrompt: "Empty your rubble onto the pile?", // t1251
    emptied: "You empty your rubble onto the pile.", // t1255
    nothing: "Nothing interesting happens.", // t373, as live sent it after the chest's box
  });
  /** Ours: no capture or Wiki line for these refusals. */
  const OUR_TEXT = Object.freeze({
    noPickaxe: "You need a pickaxe to clear this rubble.",
    noLevel: "You do not have a pickaxe which you have the Mining level to use.",
    noSpade: "You need a spade to scoop up the rubble.",
    noBucket: "You need something to carry the rubble in.",
    buried: "The trapdoor is buried under rubble.",
  });

  /** Everyone who answers with the citizens' pages before the cellar is cleared (the Wiki's lists). */
  const CITIZENS = [
    "Vasile", "Razvan", "Luminata", "Elisabeta", "Teodor", "Gabriela", "Cornelius", "Luscion", "Sergiu", "Sorin",
    "Ileana", "Radu", "Valeria", "Grigore", "Emilia", "Simona", "Calin", "Nicoleta", "Mihail",
  ];
  const CHILDREN = ["Catalina", "Ivan", "Victor", "Helena"];

  const Scenes = createQuestScenes(api, { recoveryAttribute: CELLAR_EXIT_ATTRIBUTE });

  // ---------------------------------------------------------------------------
  // Transcript words
  // ---------------------------------------------------------------------------

  function variantSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  /** The first step (depth first) of `steps` that passes `test`. */
  function findStep(steps, test) {
    if (!steps || typeof steps !== "object") return null;
    if (!Array.isArray(steps) && test(steps)) return steps;
    for (const value of Array.isArray(steps) ? steps : Object.values(steps)) {
      if (!value || typeof value !== "object") continue;
      const found = findStep(value, test);
      if (found) return found;
    }
    return null;
  }

  const textCache = new Map();
  /** A transcript step's text by its id (message steps) or by a test on the step (lines). */
  function words(variant, key) {
    const cacheKey = `${variant}#${typeof key === "string" ? key : key.toString()}`;
    if (!textCache.has(cacheKey)) {
      const test = typeof key === "string" ? (step) => step.id === key : key;
      const step = findStep(variantSteps(variant), test);
      textCache.set(cacheKey, typeof step?.text === "string" ? step.text : String(step?.player ?? ""));
    }
    return textCache.get(cacheKey);
  }

  const lineStarting = (start) => (step) => typeof step.text === "string" && step.type === "line" && step.text.startsWith(start);
  const TEXT = {
    locked: () => words(VARIANT.gate, "rIdIca"),
    overhead: () => words(VARIANT.gate, (step) => step.type === "line" && step.presentation === "overhead"),
    sweetTalk: () => words(VARIANT.enter, lineStarting("Hey! Don't try to sweet talk me.")),
    inn: () => words(VARIANT.citizens, lineStarting("Well, there's the inn.")),
    chestSearch: () => words(VARIANT.chestSearch, "o-ZQU1"),
    placed: () => words(VARIANT.chestFood, "t8c_30"),
    blimey: () => words(VARIANT.chestFood, lineStarting("Blimey")),
    noStock: () => words(VARIANT.citizens, (step) => step.type === "line" && step.speaker === "Aurel"
      && typeof step.text === "string" && step.text.includes("cannot open a store")),
    swingWall: () => words(VARIANT.entrance, "7dGySL"),
    brokeWall: () => words(VARIANT.entrance, "4mYTLo"),
    mined: () => words(VARIANT.basement, "FfK9Xz"),
    minedFirst: () => words(VARIANT.basement, "FB48Vh"),
    scoopPot: () => words(VARIANT.basement, "fGcoJY"),
    scoopSpade: () => words(VARIANT.basement, "i-5aAw"),
    rubbish: () => words(VARIANT.basement, "k3MuUJ"),
    plasterKept: () => words(VARIANT.basement, "xw81NT"),
    plasterFull: () => words(VARIANT.basement, "8fvSLr"),
    scrollKept: () => words(VARIANT.basement, "NMW9RQ"),
    scrollFull: () => words(VARIANT.basement, "bCQy9U"),
    cleared: () => words(VARIANT.basement, "WHIxIw"),
    plaqueSeen: () => words(VARIANT.basement, "F1dHNo"),
    dropCellar: () => words(VARIANT.rubble, "xM4kXM"),
    dropTown: () => words(VARIANT.rubble, "rucOKN"),
  };

  const stage = (player) => state.stage(player);
  const inRange = (player, from, until) => { const s = stage(player); return s >= from && s < until; };
  const ownsPage = (pages) => !Array.isArray(pages) || pages.some((entry) => entry?.page === PAGE);
  const dialogueOpen = (player) => !!player.getDialogueManager().getCurrent?.() || !!core.MultiChatboxPrompt?.getPending?.(player);
  const tileOf = (location) => location?.getX ? { x: location.getX(), y: location.getY(), z: location.getZ() } : location;
  const npcIdOf = (event) => event.npc?.getCurrentDefinition?.(event.player)?.getId?.() ?? event.definition?.getId?.() ?? event.npcId;

  function optionOf(event) {
    if (typeof event.option === "string" && event.option) return event.option;
    const definition = event.definition ?? core.ObjectDefinition.forPlayer(event.objectId, event.player);
    return definition?.getInteractions?.()?.[(event.clickType | 0) - 1] ?? "";
  }

  // ---------------------------------------------------------------------------
  // Florin's food pelting (varbit 1969)
  // ---------------------------------------------------------------------------

  const watchers = new WeakMap();
  const decays = new WeakMap();

  const inBurgh = (location) => location.getZ() === 0 && (location.getX() >> 6) === BURGH_SQUARE.x && (location.getY() >> 6) === BURGH_SQUARE.y;
  /** Ours: live threw at 20; the Wiki keeps Florin hostile until the food is in the chest, so 30 too. */
  const hostile = (player) => inRange(player, STAGE.STARTED, STAGE.FOOD_PLACED);

  function florinNear(player) {
    const here = player.getLocation();
    return core.World.getNpcsNear(here, PELT.range).find((npc) => npc.getId() === FLORIN) ?? null;
  }

  /** Watches a hostile player in Burgh's square each tick; a throw every 10 ticks while Florin is in range. */
  function watchPelting(player) {
    if (watchers.has(player) || !hostile(player) || !inBurgh(player.getLocation())) return;
    const watch = { wait: 0 };
    watchers.set(player, watch);
    const task = new core.Task(1, watch);
    task.execute = () => {
      if (player.isRegistered?.() === false || !hostile(player) || !inBurgh(player.getLocation())) {
        task.stop();
        watchers.delete(player);
        return;
      }
      if (watch.wait > 0) { watch.wait--; return; }
      if (state.get(player, VARBIT.FOOD_PELT) >= PELT.cap) return;
      const florin = florinNear(player);
      if (!florin) return;
      throwFood(player, florin);
    };
    core.TaskManager.submit(task);
  }

  /** One throw (t270): Florin's side, the projectile, the splash and sounds, the 0 hit when it lands. */
  function throwFood(player, florin) {
    // Any throw (the watcher's or the locked gate's) starts the next 10-tick wait (t270, t280, t290).
    const watch = watchers.get(player);
    if (watch) watch.wait = PELT.every - 1;
    const from = florin.getLocation(), to = player.getLocation().clone();
    const distance = Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
    const end = PELT.base + PELT.perTile * distance;
    florin.setPositionToFace(to);
    common.anim(florin, HUMAN_THROW);
    common.gfx(florin, TOMATO_LAUNCH, PELT.height);
    florin.forceChat?.(TEXT.overhead());
    new core.Projectile(from, to, player, TOMATO_TRAVEL, PELT.start, end, PELT.startHeight, PELT.endHeight, null)
      .withAngle(PELT.angle).withProgress(PELT.progress).withSource(florin).sendProjectile();
    common.gfx(player, ROTTEN_SPLASH, PELT.height, end);
    common.sound(player, THROWN);
    common.sound(player, APPLE_SPLAT, end);
    // trigger_ondialogabort + if_closesub (t280, t290)
    if (dialogueOpen(player)) player.getPacketSender().sendInterfaceRemoval();
    state.set(player, VARBIT.FOOD_PELT, Math.min(PELT.cap, state.get(player, VARBIT.FOOD_PELT) + 1));
    scheduleDecay(player);
    common.later(player, Math.max(1, Math.floor(end / 30)), (p) =>
      p.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(0, core.HitMask.BLUE)]));
  }

  /** 1969 falls by one ~200 ticks after the last throw, then every ~200 (t491, t700, t901). */
  function scheduleDecay(player) {
    const token = {};
    decays.set(player, token);
    const step = () => {
      if (decays.get(player) !== token || player.isRegistered?.() === false) return;
      const value = state.get(player, VARBIT.FOOD_PELT);
      if (value <= 0) return;
      state.set(player, VARBIT.FOOD_PELT, value - 1);
      if (value - 1 > 0) core.TaskManager.submit(new core.CountdownTask(token, PELT.decay, step));
      else decays.delete(player);
      if (hostile(player)) watchPelting(player);
    };
    core.TaskManager.submit(new core.CountdownTask(token, PELT.decay, step));
  }

  function onMapSquare({ player, location }) {
    if (player && location && inBurgh(location)) watchPelting(player);
  }

  function onLogin({ player }) {
    if (!player) return;
    if (state.get(player, VARBIT.FOOD_PELT) > 0) scheduleDecay(player);
    watchPelting(player);
  }

  // ---------------------------------------------------------------------------
  // The gate (12816/12817)
  // ---------------------------------------------------------------------------

  let gateOpen = false;
  const GATE_KEY = { gate: "in-aid-of-the-myreque:burgh-gate" };

  function wallLoc([id, x, y, z, face]) {
    return new core.GameObject(id, new Location(x, y, z), 0, face, null);
  }

  function swapLocs(remove, add) {
    for (const leaf of remove) core.ObjectManager.deregister(wallLoc(leaf), true);
    for (const leaf of add) core.ObjectManager.register(wallLoc(leaf), true);
  }

  /** Players stepping across the gate: whether they had the clipping flag before (restored on arrival). */
  const steppingThrough = new WeakMap();

  function endStep(player) {
    if (!steppingThrough.has(player)) return;
    if (!steppingThrough.get(player)) player.removeFlag?.(IGNORE_CLIPPING_FLAG);
    steppingThrough.delete(player);
  }

  /**
   * The opener's one step across, over the inviswall. As Doors' walkOverGate, collision comes back as
   * soon as the step is done (or stops), not on a timer, so no other walk is made without it.
   */
  function stepThroughGate(player, x) {
    endStep(player);
    const here = player.getLocation();
    const destination = new Location(x, here.getY() >= GATE_TILES.y ? GATE_TILES.y - 1 : GATE_TILES.y, 0);
    steppingThrough.set(player, player.hasFlag?.(IGNORE_CLIPPING_FLAG) === true);
    player.setFlag?.(IGNORE_CLIPPING_FLAG, true);
    const queue = player.getMovementQueue();
    queue.reset();
    queue.addSteps(destination);
    let ticks = GATE_OPEN_TICKS + 1;
    const task = new core.Task(1, false);
    task.execute = () => {
      const now = player.getLocation();
      const across = now.getX() === destination.getX() && now.getY() === destination.getY();
      if (across || --ticks <= 0 || (queue.size?.() ?? 0) === 0 || player.isRegistered?.() === false) {
        task.stop();
        endStep(player);
      }
    };
    core.TaskManager.submit(task);
  }

  function openGate(player, x) {
    if (!gateOpen) {
      gateOpen = true;
      swapLocs(GATE_TILES.closed, GATE_TILES.opened);
      common.sound(player, GATE_OPEN);
      core.TaskManager.submit(new core.CountdownTask(GATE_KEY, GATE_OPEN_TICKS, () => {
        swapLocs(GATE_TILES.opened, GATE_TILES.closed);
        gateOpen = false;
      }));
    }
    stepThroughGate(player, x);
  }

  /** Locked until the food is in the chest (t295); a throw follows if Florin still has some. */
  function lockedGate(player) {
    common.mesbox(player, TEXT.locked(), (p) => {
      if (!hostile(p) || state.get(p, VARBIT.FOOD_PELT) >= PELT.cap) return;
      const florin = florinNear(p);
      if (florin) throwFood(p, florin);
    });
  }

  function useGate(player, location) {
    if (stage(player) < STAGE.FOOD_PLACED) lockedGate(player);
    else openGate(player, location.x);
  }

  // ---------------------------------------------------------------------------
  // Talks
  // ---------------------------------------------------------------------------

  function citizenVariant(player) {
    return stage(player) < STAGE.WALL_CLIMBED ? VARIANT.citizens : VARIANT.clearing;
  }

  function talkFlorin(event) {
    const { player } = event;
    if (!inRange(player, STAGE.STARTED, STAGE.CELLAR_CLEARED)) return false;
    const s = stage(player);
    if (s >= STAGE.FOOD_PLACED && s < STAGE.TOLD_INN) {
      common.play(player, FLORIN, VARIANT.afterFood, afterFoodSteps, PAGE, event.npc);
      return true;
    }
    common.play(player, FLORIN, s < STAGE.FOOD_PLACED ? VARIANT.enter : citizenVariant(player), null, PAGE, event.npc);
    return true;
  }

  /**
   * After the food (t389-391): Florin's line, then the citizens' own menu. The page's "(jump below)"
   * would land on the gate talk's menu; live showed the citizens' five options.
   */
  function afterFoodSteps(raw) {
    const menu = variantSteps(VARIANT.citizens).find((step) => step?.type === "choice");
    return [...raw.filter((step) => step?.type !== "jump"), ...(menu ? [menu] : [])];
  }

  function talkCitizen(event) {
    const { player } = event;
    if (!inRange(player, STAGE.STARTED, STAGE.CELLAR_CLEARED)) return false;
    common.play(player, npcIdOf(event), citizenVariant(player), null, PAGE, event.npc);
    return true;
  }

  function talkChild(event) {
    if (!inRange(event.player, STAGE.STARTED, STAGE.CELLAR_CLEARED)) return false;
    common.play(event.player, npcIdOf(event), VARIANT.child, null, PAGE, event.npc);
    return true;
  }

  function talkMarius(event) {
    if (!inRange(event.player, STAGE.STARTED, STAGE.CELLAR_CLEARED)) return false;
    common.message(event.player, words(VARIANT.marius, "87MqJi"));
    return true;
  }

  function talkAurel(event) {
    if (!inRange(event.player, STAGE.STARTED, STAGE.CELLAR_CLEARED)) return false;
    common.play(event.player, AUREL, citizenVariant(event.player), null, PAGE, event.npc);
    return true;
  }

  /** Aurel's Trade before he has stock (t772 at 60): his refusal, with chatsad2. */
  function tradeAurel(event) {
    if (stage(event.player) >= STAGE.CELLAR_CLEARED) return false;
    common.chain(event.player, [{ npc: AUREL, text: TEXT.noStock(), expression: CHAT_SAD }]);
    return true;
  }

  /** 30 with "Hey! Don't try to sweet talk me..." (t309); 60 with "Well, there's the inn..." (t431). */
  function onLine(request) {
    const { player, text } = request;
    if (!player || typeof text !== "string" || !ownsPage(request.pages)) return;
    if (stage(player) === STAGE.STARTED && text === TEXT.sweetTalk()) {
      request.before = () => state.advance(player, STAGE.FLORIN_TALKED);
    } else if (stage(player) === STAGE.FOOD_PLACED && text === TEXT.inn()) {
      request.before = () => state.advance(player, STAGE.TOLD_INN);
    }
  }

  // ---------------------------------------------------------------------------
  // The food chest (12736)
  // ---------------------------------------------------------------------------

  function isFood(itemId) {
    const definition = core.CacheDefinitions.getItem(itemId);
    return !!definition && !core.ItemDefinition.forId(itemId)?.isNoted?.() && (definition.inventoryActions ?? []).includes("Eat");
  }

  function searchChest(event) {
    if (event.objectId !== FOOD_CHEST) return false;
    common.message(event.player, TEXT.chestSearch());
    return true;
  }

  /** Florin's chest line, held without a continue while the camera looks at him (t373-384). */
  function florinThanks(player) {
    const male = player.getAppearance?.()?.isMale?.() !== false;
    const text = TEXT.blimey().replace(/\[He\/She\]/g, male ? "He" : "She");
    common.message(player, LIVE_TEXT.nothing);
    common.camera(player, [3487, 3250, 500], [3483, 3242, 100]);
    const line = new core.ActionDialogue(0, {
      execute: () => new core.NpcDialogue(0, FLORIN, text, "Florin", CHAT_HAPPY).sendHeld(player),
    }, true);
    player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(line));
    common.later(player, CHEST_LINE_TICKS, (p) => {
      common.cameraReset(p);
      if (p.getDialogueManager().getCurrent?.() === line) p.getPacketSender().sendInterfaceRemoval();
    });
  }

  function foodOnChest(event) {
    const { player, itemId } = event;
    if (stage(player) !== STAGE.FLORIN_TALKED || !isFood(itemId)) return false;
    const inventory = player.getInventory();
    const slot = Number.isInteger(event.itemSlot) && inventory.getItems()[event.itemSlot]?.getId() === itemId
      ? event.itemSlot : inventory.getItems().findIndex((item) => item?.getId() === itemId);
    if (slot < 0) return false;
    inventory.deleteAtSlot(slot, 1);
    state.advance(player, STAGE.FOOD_PLACED);
    common.itemBox(player, itemId, TEXT.placed(), florinThanks);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The inn: broken wall, collapsed wall, trapdoor
  // ---------------------------------------------------------------------------

  /** Climb-over (t794, t1155): one tile across the wall's north edge, either way; the first sets 70. */
  function climbWall(event) {
    if (event.objectId !== BROKEN_WALL) return false;
    const { player } = event;
    const here = player.getLocation();
    const wall = tileOf(event.location);
    const north = here.getY() <= wall.y;
    const from = new Location(wall.x, north ? wall.y : wall.y + 1, wall.z);
    if (Math.abs(here.getX() - from.getX()) > 1 || Math.abs(here.getY() - from.getY()) > 1) return true;
    if (!here.equals(from)) player.moveTo(from.clone());
    core.TaskManager.submit(new core.ForceMovementTask(player, CLIMB_TICKS,
      new core.ForceMovement(from.clone(), new Location(0, north ? 1 : -1, 0), 0, 30 * CLIMB_TICKS, north ? 0 : 2, CRUMBLED_WALL_WALK)));
    common.sound(player, CLIMB_WALL);
    if (stage(player) === STAGE.TOLD_INN) state.advance(player, STAGE.WALL_CLIMBED);
    return true;
  }

  function pickaxeFor(player) {
    const request = { player, pickaxe: null };
    api.emitCustomEvent("mining:best-pickaxe", request);
    return request.pickaxe;
  }

  function carriesPickaxe(player) {
    const items = [...player.getInventory().getItems(), ...player.getEquipment().getItems()];
    return items.some((item) => {
      if (!item || item.getId() <= 0) return false;
      const request = { itemId: item.getId(), pickaxe: null };
      api.emitCustomEvent("mining:pickaxe", request);
      return request.pickaxe != null;
    });
  }

  function noPickaxe(player) {
    common.message(player, carriesPickaxe(player) ? OUR_TEXT.noLevel : OUR_TEXT.noPickaxe);
  }

  /** A pickaxe on the collapsed wall (t798-803). */
  function breakWall(player) {
    if (state.get(player, VARBIT.INN_WALL) !== 0 || stage(player) < STAGE.WALL_CLIMBED) return false;
    const pickaxe = pickaxeFor(player);
    if (!pickaxe) {
      noPickaxe(player);
      return true;
    }
    const token = beginAction(player);
    const start = player.getLocation().clone();
    common.message(player, TEXT.swingWall());
    player.performAnimation(pickaxe.animation);
    common.later(player, WALL_BREAK_TICKS, (p) => {
      if (!stillActing(p, token, start)) return;
      state.set(p, VARBIT.INN_WALL, 1);
      state.advance(p, STAGE.RUBBLE_MINED);
      common.message(p, TEXT.brokeWall());
      p.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION ?? new core.Animation(-1));
      common.sound(p, MINE_ORE);
    });
    return true;
  }

  const atTrapdoor = (location) => {
    const tile = tileOf(location);
    return tile?.x === TRAPDOOR_TILE.x && tile?.y === TRAPDOOR_TILE.y && tile?.z === TRAPDOOR_TILE.z;
  };

  /** Open (t807), Close (Ours: not captured) and Climb-down (t811-812) on multiloc 12743. */
  function useTrapdoor(player, option) {
    if (option === "Open") {
      if (state.get(player, VARBIT.INN_WALL) === 0) {
        common.message(player, OUR_TEXT.buried);
        return;
      }
      state.set(player, VARBIT.INN_TRAPDOOR, 1);
      state.advance(player, STAGE.TRAPDOOR_OPEN);
      common.sound(player, TRAPDOOR_OPEN);
      return;
    }
    if (option === "Close") {
      state.set(player, VARBIT.INN_TRAPDOOR, 0);
      return;
    }
    if (option !== "Climb-down") return;
    common.anim(player, PICKUP_FLOOR);
    if (stage(player) >= STAGE.CELLAR_CLEARED) {
      common.later(player, 1, (p) => p.moveTo(new Location(CLEARED_CELLAR.x, CLEARED_CELLAR.y, CLEARED_CELLAR.z)));
      return;
    }
    state.advance(player, STAGE.CELLAR_ENTERED);
    common.later(player, 1, enterCellar);
  }

  function trapdoorObject(event) {
    if (event.objectId !== TRAPDOOR || !atTrapdoor(event.location ?? event.object?.getLocation?.())) return false;
    useTrapdoor(event.player, optionOf(event));
    return true;
  }

  // ---------------------------------------------------------------------------
  // The cellar (a plane-1 copy) and its rubble
  // ---------------------------------------------------------------------------

  const actions = new WeakMap();
  function beginAction(player) {
    const token = {};
    actions.set(player, token);
    return token;
  }
  function stillActing(player, token, start) {
    return actions.get(player) === token && player.isRegistered?.() !== false && player.getLocation().equals(start);
  }

  /** The cellar's rubble: what is left is derived from 1972 (Ours: the first removed are the first listed). */
  function enterCellar(player) {
    const scene = Scenes.open(player, "in-aid-of-the-myreque-cellar", CELLAR.bounds,
      { canTeleport: () => null, npcAggression: () => null, multi: true },
      { instance: { sourceChunk: CELLAR.sourceChunk, size: CELLAR.size }, at: CELLAR.at, exit: CELLAR.exit });
    scene.rubble = [];
    const removed = Math.min(RUBBLE_TILES.length, state.get(player, VARBIT.INN_RUBBLE));
    for (const [x, y, face] of RUBBLE_TILES.slice(removed)) {
      const entry = { x, y, face, step: 0, object: null };
      entry.object = Scenes.loc(scene, { id: RUBBLE_STEPS[0], x, y, z: 1, type: 10, face });
      scene.rubble.push(entry);
    }
    return scene;
  }

  function rubbleOf(player, object) {
    const scene = Scenes.get(player);
    const entry = scene?.rubble?.find((candidate) => candidate.object === object
      || (object && candidate.object?.getLocation?.().equals?.(object.getLocation?.())));
    return entry ? { scene, entry } : null;
  }

  function setRubbleStep(scene, entry, step) {
    if (entry.object) {
      core.ObjectManager.deregister(entry.object, true);
      const at = scene.locs.indexOf(entry.object);
      if (at >= 0) scene.locs.splice(at, 1);
      entry.object = null;
    }
    entry.step = step;
    if (step < RUBBLE_STEPS.length) {
      entry.object = Scenes.loc(scene, { id: RUBBLE_STEPS[step], x: entry.x, y: entry.y, z: 1, type: 10, face: entry.face });
    }
  }

  /** Mine (t819-828): three steps three ticks apart, each with mine_ore and 10 Mining. */
  function mineRubble(player, found) {
    const { scene, entry } = found;
    if (entry.step >= RUBBLE_STEPS.length - 1) return removeRubble(player, found);
    const pickaxe = pickaxeFor(player);
    if (!pickaxe) {
      noPickaxe(player);
      return true;
    }
    const token = beginAction(player);
    const start = player.getLocation().clone();
    common.message(player, LIVE_TEXT.swing);
    player.performAnimation(pickaxe.animation);
    // Live swings again the tick before each step (t819 swing, t821 / t824 / t827 swings, steps t822 / t825 / t828).
    const swingThenStep = (p) => {
      common.later(p, MINE_STEP_TICKS - 1, (q) => {
        if (stillActing(q, token, start) && Scenes.get(q) === scene && entry.object) q.performAnimation(pickaxe.animation);
      });
      common.later(p, MINE_STEP_TICKS, next);
    };
    const next = (p) => {
      if (!stillActing(p, token, start) || Scenes.get(p) !== scene || !entry.object) return;
      setRubbleStep(scene, entry, entry.step + 1);
      common.sound(p, MINE_ORE);
      p.getSkillManager().addExperiences(Skill.MINING, RUBBLE_MINING_XP);
      if (entry.step < RUBBLE_STEPS.length - 1) {
        swingThenStep(p);
        return;
      }
      p.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION ?? new core.Animation(-1));
      if (state.get(p, VARBIT.RUBBLE_MESSAGE) === 0) {
        state.set(p, VARBIT.RUBBLE_MESSAGE, 1);
        common.mesbox(p, TEXT.minedFirst());
      } else {
        common.message(p, TEXT.mined());
      }
    };
    swingThenStep(player);
    return true;
  }

  /** The bucket the next load goes in: the fullest one that still has room, then an empty one. */
  const bucketFor = (player) => [RUBBLE_BUCKETS[1], RUBBLE_BUCKETS[0], BUCKET].find((id) => common.held(player, id)) ?? null;

  /** Remove (t834-838): two digs two ticks apart, then the load. */
  function removeRubble(player, found) {
    const { scene, entry } = found;
    const tool = common.held(player, SPADE) ? SPADE : common.held(player, POT) ? POT : null;
    if (!tool) {
      common.message(player, OUR_TEXT.noSpade);
      return true;
    }
    if (!bucketFor(player)) {
      common.message(player, OUR_TEXT.noBucket);
      return true;
    }
    const token = beginAction(player);
    const start = player.getLocation().clone();
    common.message(player, tool === SPADE ? TEXT.scoopSpade() : TEXT.scoopPot());
    common.anim(player, HUMAN_DIG);
    common.sound(player, DIG_SPADE);
    common.later(player, SCOOP_TICKS[0], (p) => {
      if (!stillActing(p, token, start) || Scenes.get(p) !== scene) return;
      common.anim(p, HUMAN_DIG);
      common.sound(p, DIG_SPADE);
      common.later(p, SCOOP_TICKS[1] - SCOOP_TICKS[0], (q) => {
        if (!stillActing(q, token, start) || Scenes.get(q) !== scene || !entry.object) return;
        const bucket = bucketFor(q);
        if (!bucket) return;
        common.replaceInSlot(q, bucket, FILLS[FILLS.indexOf(bucket) + 1]);
        setRubbleStep(scene, entry, RUBBLE_STEPS.length);
        scene.rubble.splice(scene.rubble.indexOf(entry), 1);
        const count = Math.min(RUBBLE_TILES.length, state.get(q, VARBIT.INN_RUBBLE) + 1);
        state.set(q, VARBIT.INN_RUBBLE, count);
        scooped(q, count);
      });
    });
    return true;
  }

  function addOrDrop(player, itemId, amount) {
    const inventory = player.getInventory();
    const stackable = core.ItemDefinition.forId(itemId)?.isStackable?.() === true;
    if ((stackable && inventory.getAmount(itemId) > 0) || common.freeSlots(player) > 0) {
      inventory.add(new core.Item(itemId, amount));
      return;
    }
    dropOwnerOnly(player, itemId, amount);
  }

  function dropOwnerOnly(player, itemId, amount) {
    core.ItemOnGroundManager.registerLocation(player, new core.Item(itemId, amount), player.getLocation().clone(),
      player.getPrivateArea?.() ?? null, { goesGlobal: false, despawnDelay: RUBBISH_DESPAWN_TICKS });
  }

  /** What a scoop turns up (t856, t921, t975, t1013) and the last one (t1105). */
  function scooped(player, count) {
    if (RUBBISH_AT.has(count)) {
      for (const [itemId, amount] of RUBBISH_FLOOR) dropOwnerOnly(player, itemId, amount);
      addOrDrop(player, STEEL_NAILS, 3);
      addOrDrop(player, BROKEN_GLASS, 1);
      common.doubleBox(player, [I.BRONZE_NAILS, ROCK], TEXT.rubbish());
      return;
    }
    if (count === PLASTER_AT || count === SCROLL_AT) {
      const itemId = count === PLASTER_AT ? PLASTER : SCROLL;
      const room = common.freeSlots(player) > 0;
      if (room) player.getInventory().add(new core.Item(itemId, 1));
      const text = itemId === PLASTER ? (room ? TEXT.plasterKept() : TEXT.plasterFull()) : (room ? TEXT.scrollKept() : TEXT.scrollFull());
      common.itemBox(player, itemId, text);
      return;
    }
    if (count >= RUBBLE_TILES.length) cellarCleared(player);
  }

  /** The last load (t1105-1119): 110, two mesboxes, the second held 7 ticks while the camera finds the plaque. */
  function cellarCleared(player) {
    state.advance(player, STAGE.CELLAR_CLEARED);
    common.mesbox(player, TEXT.cleared(), (p) => {
      const text = TEXT.plaqueSeen();
      const held = new core.ActionDialogue(0, { execute: () => core.StatementDialogue.send(p, text, false) }, true);
      p.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(held));
      Scenes.camera(p, [3494, 9628, 400], [3494, 9633, 100], { rate: 100, rate2: 100 });
      common.later(p, 2, (q) => Scenes.camera(q, [3494, 9631, 300], [3494, 9633, 100], { rate: 3, rate2: 3 }));
      common.later(p, 7, (q) => {
        if (q.getDialogueManager().getCurrent?.() !== held) {
          common.cameraReset(q);
          return;
        }
        common.mesbox(q, text, common.cameraReset);
      });
    });
  }

  function rubbleObject(event) {
    if (!RUBBLE_STEPS.includes(event.objectId)) return false;
    const found = rubbleOf(event.player, event.object);
    if (!found) return false;
    return event.objectId === RUBBLE_STEPS[RUBBLE_STEPS.length - 1] ? removeRubble(event.player, found) : mineRubble(event.player, found);
  }

  /** The cellar ladder (t1142-1149): human_reachforladder, and a tick later back up by the trapdoor. */
  function climbCellarLadder(player) {
    common.anim(player, REACH_FOR_LADDER);
    common.later(player, 1, (p) => {
      if (Scenes.get(p)) Scenes.end(p, false);
      p.moveTo(new Location(CELLAR.exit[0], CELLAR.exit[1], CELLAR.exit[2]));
    });
  }

  function cellarLadderAt(player, object) {
    if (Scenes.get(player)) return true;
    const at = object?.getLocation?.();
    return at?.getX() === 3490 && at?.getY() === 9632 && at?.getZ() === 0;
  }

  /** The plaque (t1133, t1139): live's text; the first read sets 1973. */
  function searchPlaque(event) {
    if (event.objectId !== PLAQUE) return false;
    if (state.get(event.player, VARBIT.PLAQUE_READ) === 0) state.set(event.player, VARBIT.PLAQUE_READ, 1);
    common.mesbox(event.player, LIVE_TEXT.plaque);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The rubble outside (12749) and the buckets
  // ---------------------------------------------------------------------------

  const carriesRubble = (player) => RUBBLE_BUCKETS.some((id) => common.held(player, id));

  function emptyBuckets(player) {
    const inventory = player.getInventory();
    const items = inventory.getItems();
    let emptied = false;
    for (let slot = 0; slot < items.length; slot++) {
      if (items[slot] && RUBBLE_BUCKETS.includes(items[slot].getId())) {
        inventory.set(slot, new core.Item(BUCKET, 1));
        emptied = true;
      }
    }
    if (!emptied) return;
    inventory.refreshItems();
    common.anim(player, POUR);
    common.message(player, LIVE_TEXT.emptied);
  }

  function askToEmpty(player) {
    common.menu(player, LIVE_TEXT.emptyPrompt, [
      ["Yes.", emptyBuckets],
      ["No.", (p) => p.getPacketSender().sendInterfaceRemoval()],
    ]);
  }

  /**
   * Search (t1242-1255, t1266): the plaster fragment and the dusty scroll a scoop threw in come back,
   * each with its box (the pile's own words when there is no room), then "Empty your rubble onto the
   * pile?" while buckets of rubble are carried. Ours: only finds already made in the cellar come back.
   */
  function searchPile(event) {
    if (event.objectId !== RUBBLE_PILE) return false;
    const { player } = event;
    const found = state.get(player, VARBIT.INN_RUBBLE);
    const finds = [
      [PLASTER, PLASTER_AT, TEXT.plasterKept(), LIVE_TEXT.plasterBack],
      [SCROLL, SCROLL_AT, TEXT.scrollKept(), LIVE_TEXT.scrollBack],
    ].filter(([itemId, at]) => found >= at && !common.held(player, itemId));
    const next = (p, index) => {
      if (index >= finds.length) {
        if (carriesRubble(p)) askToEmpty(p);
        return;
      }
      const [itemId, , kept, back] = finds[index];
      const room = common.freeSlots(p) > 0;
      if (room) p.getInventory().add(new core.Item(itemId, 1));
      common.itemBox(p, itemId, room ? kept : back, (q) => next(q, index + 1));
    };
    next(player, 0);
    return true;
  }

  /** The Wiki: the buckets are used on the pile to empty them (Ours: as the menu's Yes). */
  function bucketOnPile(event) {
    if (event.objectId !== RUBBLE_PILE || !RUBBLE_BUCKETS.includes(event.itemId)) return false;
    emptyBuckets(event.player);
    return true;
  }

  /** Drop or Empty anywhere else (t1187): refused with the bucket's objectbox. */
  function refuseDump(player, itemId, verb) {
    const text = Scenes.get(player) ? TEXT.dropCellar().replace("[drop/empty]", verb) : TEXT.dropTown();
    common.itemBox(player, itemId, text);
  }

  function dropBucket(event) {
    if (!RUBBLE_BUCKETS.includes(event.itemId)) return;
    event.handled = true;
    event.dropToGround = false;
    refuseDump(event.player, event.itemId, "drop");
  }

  function emptyBucket(event) {
    refuseDump(event.player, event.itemId, "empty");
    return true;
  }

  // ---------------------------------------------------------------------------
  // Hook routing
  // ---------------------------------------------------------------------------

  /** Doors asks first for the gates and the trapdoor (both are in its names). */
  function claimDoor(request) {
    if (request.handled || !request.player) return;
    if (request.objectId === GATE_LEFT || request.objectId === GATE_RIGHT) {
      const tile = tileOf(request.location ?? request.object?.getLocation?.());
      if (tile?.y !== GATE_TILES.y || tile?.z !== 0) return;
      request.handled = true;
      useGate(request.player, tile);
      return;
    }
    if (trapdoorObject(request)) request.handled = true;
  }

  /** Ladders asks first for the trapdoor's Climb-down and the cellar ladder. */
  function claimLadder(request) {
    if (request.handled || !request.player) return;
    if (request.objectId === TRAPDOOR && atTrapdoor(request.object?.getLocation?.())) {
      request.handled = true;
      useTrapdoor(request.player, optionOf(request));
      return;
    }
    if (request.objectId === CELLAR_LADDER && cellarLadderAt(request.player, request.object)) {
      request.handled = true;
      climbCellarLadder(request.player);
    }
  }

  function trapdoorHook(event) {
    return trapdoorObject(event);
  }

  function ladderHook(event) {
    if (event.objectId !== CELLAR_LADDER || !cellarLadderAt(event.player, event.object)) return false;
    climbCellarLadder(event.player);
    return true;
  }

  function gateHook(event) {
    const tile = tileOf(event.location);
    if ((event.objectId !== GATE_LEFT && event.objectId !== GATE_RIGHT) || tile?.y !== GATE_TILES.y) return false;
    useGate(event.player, tile);
    return true;
  }

  function onItemOnObject(event) {
    if (event.handled || !event.player) return;
    let handled = false;
    if (event.objectId === FOOD_CHEST) handled = foodOnChest(event);
    else if (event.objectId === COLLAPSED_WALL) handled = carriesPickaxeId(event.itemId) && breakWall(event.player);
    else if (event.objectId === RUBBLE_PILE) handled = bucketOnPile(event);
    else if (RUBBLE_STEPS.includes(event.objectId)) handled = rubbleTool(event);
    if (handled) event.handled = true;
  }

  function carriesPickaxeId(itemId) {
    const request = { itemId, pickaxe: null };
    api.emitCustomEvent("mining:pickaxe", request);
    return request.pickaxe != null;
  }

  /** A pickaxe on unmined rubble mines it; a spade or pot on mined rubble removes it. */
  function rubbleTool(event) {
    const found = rubbleOf(event.player, event.object);
    if (!found) return false;
    const removing = event.objectId === RUBBLE_STEPS[RUBBLE_STEPS.length - 1];
    if (removing ? (event.itemId !== SPADE && event.itemId !== POT) : !carriesPickaxeId(event.itemId)) return false;
    return removing ? removeRubble(event.player, found) : mineRubble(event.player, found);
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.onCustomEvent("door:toggle", claimDoor);
  api.onCustomEvent("ladders:climb", claimLadder);
  api.onCustomEvent("npc-dialogue:line", onLine);
  api.onPlayerMapSquareChange(onMapSquare);
  api.onPlayerLogin(onLogin);
  api.onObjectInteraction("Gate", { Open: gateHook });
  api.onObjectInteraction("Trapdoor", { Open: trapdoorHook, Close: trapdoorHook, "Climb-down": trapdoorHook });
  api.onObjectInteraction("Ladder", { "Climb-up": ladderHook });
  api.onObjectInteraction("Open chest", { Search: searchChest });
  api.onObjectInteraction("Broken wall", { "Climb-over": climbWall });
  api.onObjectInteraction("Rubble", { Mine: rubbleObject, Remove: rubbleObject });
  api.onObjectInteraction("Plaque", { Search: searchPlaque });
  api.onObjectInteraction("Rubble Pile", { Search: searchPile });
  api.onItemOnObject(onItemOnObject);
  api.onItemDropPolicy(dropBucket);
  api.onItemAction("Bucket of rubble", { Empty: emptyBucket });
  api.onNpcInteraction("Florin", { "Talk-to": talkFlorin });
  api.onNpcInteraction("Aurel", { "Talk-to": talkAurel, Trade: tradeAurel });
  api.onNpcsInteraction(CITIZENS, { "Talk-to": talkCitizen });
  api.onNpcsInteraction(CHILDREN, { "Talk-to": talkChild });
  api.onNpcInteraction("Marius", { "Talk-to": talkMarius });
};
