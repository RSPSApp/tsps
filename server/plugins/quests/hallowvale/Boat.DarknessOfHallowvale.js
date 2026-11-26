/**
 * Darkness of Hallowvale: the Boat unit (stages 0-50, and every boat trip while the quest runs), as
 * live played it (rsprox capture, revision 242, ticks 255-533 and 5405-5464; facts in
 * docs/quests/darkness-of-hallowvale/README.md):
 *
 * - Veliaf Hurtz in the Burgh de Rott hideout before the quest ("Hello again", or "So what now?"
 *   straight on from In Aid of the Myreque's scroll), after the start (10-40) and once the player is
 *   in Meiyerditch (50-89). The stage becomes 10 on the continue of "Once you're in..." (t334), with
 *   the start message, not on "Yes." (t326). A menu reached by "other options" leaves out the
 *   option just asked (t297, t304, t309). Chathead 8277; Veliaf's anim follows his line count
 *   (chatneu1-4), the player's is chatneu1, chatquiz1 for the opening menu's questions.
 * - The boat and its chute: Inspect, "Fix the ...?" Yes, the walk to the repair tile (t426-430), the
 *   hammering (sang_repair_boat and three hammer_wood sounds) and, four ticks later, the varbit, the
 *   stage, the plank and four nails, m2_build and objectbox_double 11 (t436, t463).
 * - Push: a cutscene in a copy of the boathouse (t473-496): the sang_boat NPC slides down the chute
 *   a tile a tick. 2585 = 2 and 2587 = 1; the stage stays 30.
 * - Board: the first ride is the boat map (454, its model playing myq3_boat_map_01) for 11 ticks,
 *   stage 40 as it opens (t514), and the dock's message box (t526). Later trips while the quest runs
 *   are the Morytania boats' fade trip (t5420-5434), handed to the ferries (`ferries:travel`).
 * - The dock rocks: Jump-onto (stage 50 two ticks on, t531-533), Climb-up and Climb-down.
 *
 * Words come from the transcript page by step id; the uncaptured parts are marked "Ours:".
 */
const { createQuestScenes } = require("../QuestScenes");
const { loadTranscripts, questStartMessage } = require("../QuestRuntime");

module.exports = function attachBoat(context) {
  const { api, state, common, requirements, STAGE, VARBIT, PAGE } = context;
  const { Location, Animation, ForceMovement, GameObject, ItemIdentifiers: I, NpcIdentifiers: N } = api.core;

  const QUEST_NAME = "Darkness of Hallowvale";

  // --- Cache ids (gamevals)
  const VELIAF = N.VELIAF_HURTZ_3; // 9489 myq5_veliaf_child, seen through 8277
  const BOAT_MULTI = 12944; // sang_boat_broken_multiloc (2585: 0 Inspect, 1 Push, 2 gone)
  const BOAT_BROKEN = 17953; // sang_boat_broken "Inspect"
  const BOAT_FIXED = 17954; // sang_boat_fixed "Push"
  const SEA_BOAT_MULTI = 12945; // sang_boat_water_multiloc (2587)
  const SEA_BOAT = 17955; // sang_boat_in_water "Board"
  const CHUTE_MULTI = 12947; // sang_boathouse_chute_broken_multiloc (2586)
  const CHUTE_BROKEN = 17956; // sang_boathouse_chute_broken "Inspect"
  const JUMP_ROCK = 17958; // sang_boat_jump_rock "Jump-onto"
  const CLIMB_UP_ROCK = 17959; // sang_boat_wall_climb_up_rock "Climb-up"
  const CLIMB_DOWN_ROCK = 17960; // sang_boat_wall_climb_down_rock "Climb-down"
  const SANG_BOAT_NPC = N.COL_00FFFF_BOAT_COL; // 3833 sang_boat
  const BOAT_MAP = 454; // myq3_boat_map
  const BOAT_MAP_MODEL = (BOAT_MAP << 16) | 3; // myq3_boat_map:myq3_boat
  const BOAT_MAP_ANIM = 4748; // myq3_boat_map_01

  const SEQ = Object.freeze({
    REPAIR: 4757, // sang_repair_boat
    PUSH: 810, // human_push
    BOARD: 832, // human_pickuptable
    JUMP: 769, // human_steppingstonejump
    CLIMB: 4727, // myq3_outcrop_wall_climb
  });
  const SOUND = Object.freeze({
    HAMMER: 2101, // hammer_wood
    BUILD: 1710, // m2_build
    PUSH: 3000, // m3_push_boat
    JUMP: 2461, // jump
    CLIMB: 2453, // climb_wall
  });
  const SONG_SILENCE = 147; // silence
  const JINGLE_BOAT_RIDE = 137; // morytania boatride
  const BUSY_VARBIT = 12393; // busy
  const MINIMAP_STATE_VARBIT = 6719; // minimap_state
  const MINIMAP_OFF = 2;

  const CHATNEU = [588, 589, 590, 591]; // chatneu1-4, by the line's count of chatbox lines
  const CHATQUIZ1 = 554;

  const HAMMER = I.HAMMER; // 2347
  const PLANK = I.PLANK; // 960
  const NAILS = [I.BRONZE_NAILS, I.IRON_NAILS, I.STEEL_NAILS, I.BLACK_NAILS, I.MITHRIL_NAILS, I.ADAMANTITE_NAILS, I.RUNE_NAILS];
  const NAILS_PER_REPAIR = 4;

  // --- Tiles
  const DOCK = [3605, 3161, 1]; // the boat's landing (t525, t5430)
  const DOCK_ROCK = [3605, 3163, 1]; // Jump-onto's landing (t531)
  const WALL_TOP = [3601, 3163, 1]; // Climb-up's landing (t535)
  const PUSH_STAND = [3524, 3180, 0]; // the push (t476) and back (t491)

  // --- Transcript variants and step ids
  const V = Object.freeze({
    START: "starting-the-quest-talking-to-veliaf-hurtz",
    AFTER_START: "starting-the-quest-talking-to-veliaf-after-starting-the-quest",
    IN_REGION: "contact-with-the-sanguinesti-region-talking-to-veliaf-after-meeting-a-vyrewatch",
    BOAT_BEFORE_START: "boat-repairs-inspecting-the-boat-before-starting-the-quest",
    BOAT: "boat-repairs-inspecting-the-boat-after-starting-the-quest",
    CHUTE_BEFORE_BOAT: "boat-repairs-inspecting-the-boat-chute",
    CHUTE: "boat-repairs-inspecting-the-boat-chute-after-fixing-the-boat",
    PUSH_BEFORE_CHUTE: "boat-repairs-pushing-the-fixed-boat-before-fixing-the-chute",
    BOARD: "contact-with-the-sanguinesti-region-boarding-the-boat",
  });
  const VELIAF_VARIANTS = new Set([V.START, V.AFTER_START, V.IN_REGION]);
  const STEP = Object.freeze({
    CONTINUING: "5iTY3c", // "If continuing from In Aid of the Myreque:"
    COMING_BACK: "Ao7Gq6", // "If coming back to Veliaf:"
    BOAT_BEFORE_START: "0ozg9T",
    BOAT_BROKEN: "ig64PW",
    BOAT_FIXED: "jt4wVQ",
    BOAT_MISSING: "7I-Je6",
    CHUTE_BEFORE_BOAT: "uf2s4X",
    CHUTE_BROKEN: "1A-9IU",
    CHUTE_FIXED: "4_E5ML",
    CHUTE_MISSING: "NvqLK5",
    PUSH_BEFORE_CHUTE: "-lvAFB",
    DOCKED: "RPm_MX",
    // Stage directions with no words on live: the push (TZQ0Xt) and the ride (3tBjzy) are played here.
  });
  const START_HOOK = "quest:darkness-of-hallowvale:start";
  /** The line whose continue starts the quest (t334); matched on the dump's own words, which live's are. */
  const STARTING_LINE = /^Once you're in, try and establish contact with the Myreque there\./;
  /** The opening menu's questions, which live asks with chatquiz1 (t295, t300, t307, t323). */
  const OPENING_QUESTIONS = new Set([
    "Is there something I can do to help out?", "What will you do here in Burgh de Rott?",
    "Why re-establish contact with the Sanguinesti region?", "Why ask Misthalin for some help?",
  ]);

  const BOAT_REPAIR = Object.freeze({
    varbit: VARBIT.BOAT_BROKEN, from: STAGE.STARTED, stage: STAGE.BOAT_FIXED, variant: V.BOAT,
    inspect: STEP.BOAT_BROKEN, done: STEP.BOAT_FIXED, missing: STEP.BOAT_MISSING,
    // Live walks the player round to the boat's east side and hammers facing west (t426-432).
    tile: [3525, 3178, 0], face: [3524, 3178],
  });
  const CHUTE_REPAIR = Object.freeze({
    varbit: VARBIT.CHUTE_BROKEN, from: STAGE.BOAT_FIXED, stage: STAGE.CHUTE_FIXED, variant: V.CHUTE,
    inspect: STEP.CHUTE_BROKEN, done: STEP.CHUTE_FIXED, missing: STEP.CHUTE_MISSING,
    // From the chute's north tile, where the click leaves the player (t449-459).
    tile: [3523, 3176, 0], face: [3523, 3175],
  });
  /** Ticks from the repair's anim to its result (t432 -> t436, t459 -> t463). */
  const REPAIR_TICKS = 4;
  /** Ours: how long the walk to the repair tile may take before the repair is dropped. */
  const REPAIR_WALK_LIMIT = 12;

  const PUSH_EXIT_ATTRIBUTE = "darkness-of-hallowvale:push-exit";
  const Scenes = createQuestScenes(api, { onEnd: pushEnded, recoveryAttribute: PUSH_EXIT_ATTRIBUTE });
  /** The push, from the tick the player faces the boat (t472). */
  const PUSH = Object.freeze({
    fadeOut: 1, cutscene: 3, open: 4, cameraAt: 5, fadeIn: 6, push: 8, slideFrom: 9, slideTiles: 10, panAt: 10,
    fadeOutAgain: 17, end: 19, control: 22,
    bounds: [[3512, 3551, 3152, 3191, 0]], sourceChunk: [3512 >> 3, 3152 >> 3], size: 5,
    boat: [3522, 3177, 0], boatLoc: [3523, 3177, 0], back: [3524, 3170],
    camera: [[3533, 3165, 850], [3524, 3174, 175], { rate: 100, rate2: 100 }],
    pan: [[3535, 3162, 750], [3522, 3172, 150], { rate: 1, rate2: 1 }],
  });
  /** The first ride, from the tick the player faces the boat (t511). */
  const RIDE = Object.freeze({ depart: 1, minimap: 2, map: 3, land: 14, docked: 15 });
  /** Ticks from the rock jump to stage 50 (t531 -> t533). */
  const JUMP_STAGE_TICKS = 2;
  /** Climb-up's glide is 150 client cycles (t535); Ours: the player waits it out. */
  const CLIMB_TICKS = 5;

  const repairing = new WeakSet();
  const pushing = new WeakSet();
  const riding = new WeakSet();
  const climbing = new WeakSet();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const stage = (player) => state.stage(player);
  const at = ([x, y, z = 0]) => new Location(x, y, z);
  const onTile = (player, [x, y, z]) => {
    const here = player.getLocation();
    return here.getX() === x && here.getY() === y && here.getZ() === z;
  };
  const busy = (player, on) => player.getPacketSender().sendVarbit(BUSY_VARBIT, on ? 1 : 0);
  const lock = (player, on) => player.getMovementQueue().reset().setBlockMovement(on);

  function variantSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  function findStep(steps, id) {
    for (const step of steps ?? []) {
      if (!step) continue;
      if (step.id === id) return step;
      const inner = findStep(step.steps, id) ?? findStep(step.options, id);
      if (inner) return inner;
    }
    return null;
  }

  /** A message step's words, from the transcript page. */
  const text = (variant, id) => String(findStep(variantSteps(variant), id)?.text ?? "");

  /** The variant's yes/no prompt ("Fix the boat?"). */
  function prompt(variant) {
    return variantSteps(variant).find((step) => step?.type === "choice")?.prompt ?? "Select an option";
  }

  const ownVariant = (pages) => (Array.isArray(pages) ? pages : [])
    .flatMap((entry) => (entry?.page === PAGE ? entry.variants ?? [] : []))
    .find((variant) => VELIAF_VARIANTS.has(variant)) ?? null;
  const ownsPage = (pages) => !Array.isArray(pages) || pages.some((entry) => entry?.page === PAGE);

  /** The option lists of Veliaf's menus in this unit's variants, to know them in "npc-dialogue:menu". */
  let veliafMenus = null;
  function menuKey(options) {
    return (options ?? []).map((option) => option?.text ?? "").join("|");
  }
  function collectMenus(steps, into) {
    for (const step of steps ?? []) {
      if (!step) continue;
      if (step.type === "choice" && Array.isArray(step.options)) into.add(menuKey(step.options));
      collectMenus(step.steps, into);
      collectMenus(step.options, into);
    }
  }
  function isVeliafMenu(options) {
    if (!veliafMenus) {
      veliafMenus = new Set();
      for (const variant of VELIAF_VARIANTS) collectMenus(variantSteps(variant), veliafMenus);
    }
    return veliafMenus.has(menuKey(options));
  }

  const nailsHeld = (player) => NAILS.reduce((sum, id) => sum + player.getInventory().getAmount(id), 0);
  const hasRepairTools = (player) => common.held(player, HAMMER) && common.held(player, PLANK) && nailsHeld(player) >= NAILS_PER_REPAIR;

  /** Takes four nails of any kind; returns the first kind taken (the box's model). */
  function takeNails(player) {
    let remaining = NAILS_PER_REPAIR;
    let first = null;
    for (const id of NAILS) {
      if (remaining <= 0) break;
      const take = Math.min(player.getInventory().getAmount(id), remaining);
      if (take <= 0) continue;
      player.getInventory().deleteNumber(id, take);
      remaining -= take;
      first ??= id;
    }
    return first;
  }

  /** Live's exactmove: the player is on the far tile this tick, the glide shown over d1/d2 cycles. */
  function slide(player, to, [startCycles, endCycles], angle, seq) {
    const from = player.getLocation().clone();
    const glide = new ForceMovement(from, new Location(to[0] - from.getX(), to[1] - from.getY()), startCycles, endCycles, angle, seq);
    player.getMovementQueue().reset();
    player.moveTo(at(to));
    player.performAnimation(new Animation(seq));
    player.setForceMovement(glide);
    common.later(player, 1, () => {
      if (player.getForceMovement() === glide) player.setForceMovement(null);
    });
  }

  // ---------------------------------------------------------------------------
  // Veliaf
  // ---------------------------------------------------------------------------

  /** Veliaf before the hideout's messages (0-89); later stages belong to the Errands, Sketches and Lab units. */
  function talkVeliaf({ player, npcId, npc }) {
    if (npcId !== VELIAF || requirements.tasteNeedsVeliafRod(player)) return false;
    const now = stage(player);
    if (now === STAGE.NOT_STARTED) {
      // In Aid of the Myreque keeps him until it is complete.
      if (!requirements.inAidComplete(player)) return false;
      return common.play(player, npcId, V.START, undefined, PAGE, npc);
    }
    if (now < STAGE.ARRIVED) return common.play(player, npcId, V.AFTER_START, undefined, PAGE, npc);
    // Ours: the variant covers the visit after the arrival until Vertida's message (90), where Errands takes over.
    if (now < STAGE.VERTIDA_MESSAGE) return common.play(player, npcId, V.IN_REGION, undefined, PAGE, npc);
    return false;
  }

  /** "So what now?" straight after In Aid of the Myreque's scroll (In Aid t4963), "Hello again..." on any later talk (t256). */
  function answerCondition({ player, stepId, pages }) {
    if (!player || !ownsPage(pages)) return null;
    if (stepId !== STEP.CONTINUING && stepId !== STEP.COMING_BACK) return null;
    if (!requirements.inAidComplete(player)) return false;
    const continuing = requirements.continuingFromInAid(player);
    return stepId === STEP.CONTINUING ? continuing : !continuing;
  }

  /**
   * "Start the Darkness of Hallowvale quest?" Yes (t326): nothing changes on live. Ours: a player short of
   * the requirements (not captured) gets the requirement lines and the chat ends there.
   */
  function startHook(hook) {
    if (hook?.hook !== START_HOOK || !hook.player) return;
    if (stage(hook.player) !== STAGE.NOT_STARTED || requirements.meetsRequirements(hook.player)) return;
    hook.end = true;
    hook.player.getPacketSender().sendInterfaceRemoval();
    requirements.requirementsMessage(hook.player);
  }

  /**
   * Stage 10 and the start message on the continue of "Once you're in..." (t334), before the vyrewatch line.
   * The requirements were checked on "Yes." (startHook); a boost that wears off in between does not undo it.
   */
  function startQuest(player) {
    if (stage(player) !== STAGE.NOT_STARTED || !requirements.inAidComplete(player)) return;
    state.advance(player, STAGE.STARTED);
    player.sendMessage(questStartMessage(player, QUEST_NAME));
  }

  /** Veliaf's lines: chathead 8277 and the chatneu anim by line count; the player's chatneu1/chatquiz1; the start. */
  function shapeLine(request) {
    const variant = ownVariant(request?.pages);
    if (!variant || !request.player) return;
    const { step, player } = request;
    if (typeof step?.player === "string") {
      request.expression = variant === V.START && OPENING_QUESTIONS.has(step.player) ? CHATQUIZ1 : CHATNEU[0];
      return;
    }
    const lines = api.core.ChatTextLayout?.wrap?.(String(request.text ?? "")).length ?? 1;
    request.expression = CHATNEU[Math.min(Math.max(lines, 1), CHATNEU.length) - 1];
    // Live heads the box with the hideout NPC itself (8277), not the id it shows as.
    const npcId = request.npc?.getId?.();
    if (Number.isInteger(npcId)) request.speakerId = npcId;
    if (variant === V.START && STARTING_LINE.test(String(step?.text ?? "")) && stage(player) === STAGE.NOT_STARTED) {
      const previous = request.after;
      request.after = () => {
        previous?.();
        startQuest(player);
      };
    }
  }

  /** The start prompt's Yes option and the menu after it (t336), from the transcript. */
  let startMenus = null;
  function startPromptMenus() {
    if (startMenus) return startMenus;
    const yes = findOption(variantSteps(V.START), (option) => option?.hook === START_HOOK);
    const after = (yes?.steps ?? []).find((step) => step?.type === "choice");
    startMenus = { prompt: yes ? menuKeyOf(findChoiceWith(variantSteps(V.START), yes)) : "", after: after ? menuKey(after.options) : "" };
    return startMenus;
  }
  function findOption(steps, test) {
    for (const step of steps ?? []) {
      for (const option of step?.options ?? []) {
        if (test(option)) return option;
        const inner = findOption(option.steps, test);
        if (inner) return inner;
      }
      const inner = findOption(step?.steps, test);
      if (inner) return inner;
    }
    return null;
  }
  function findChoiceWith(steps, option) {
    for (const step of steps ?? []) {
      if (step?.options?.includes(option)) return step;
      for (const entry of step?.options ?? []) {
        const inner = findChoiceWith(entry.steps, option);
        if (inner) return inner;
      }
      const inner = findChoiceWith(step?.steps, option);
      if (inner) return inner;
    }
    return null;
  }
  const menuKeyOf = (choice) => menuKey(choice?.options);

  /**
   * Veliaf's menus as live shows them:
   * - "Shows other options" (t297, t304, t309): the menu again without the option just asked; the one
   *   left out before comes back. Ours: the post-start menus (not captured) do the same.
   * - "How do I get into the Sanguinesti region?" from the Myreque or region questions ends on the
   *   post-start menu (t359). The dump's jump there (oywUIB, "previous2") reaches back to the start
   *   prompt, which live never shows again: that menu is swapped for the one after it.
   */
  function shapeMenu(notice) {
    if (notice?.npcId !== VELIAF || !isVeliafMenu(notice.options)) return;
    const menus = startPromptMenus();
    const shownBefore = (notice.history ?? []).some((shown) => shown?.step?.options === notice.options);
    if (shownBefore && menuKey(notice.options) === menus.prompt) {
      const after = [...(notice.history ?? [])].reverse().find((shown) => menuKey(shown?.step?.options) === menus.after);
      if (after) {
        notice.options = after.step.options;
        notice.prompt = after.step.prompt || "Select an option";
      }
      return;
    }
    if (notice.via === "other" && notice.chosen) notice.options = notice.options.filter((option) => option?.text !== notice.chosen);
  }

  // ---------------------------------------------------------------------------
  // The boat and the chute
  // ---------------------------------------------------------------------------

  /** The repair prompt after its inspect box (t413-426, t450-458). */
  function inspectForRepair(player, job) {
    common.mesbox(player, text(job.variant, job.inspect), () => common.confirm(player, prompt(job.variant), () => repair(player, job)));
  }

  /** "Yes.": the missing-items box, or the walk to the repair tile and the hammering. */
  function repair(player, job) {
    if (stage(player) < job.from || state.get(player, job.varbit) !== 0 || repairing.has(player)) return;
    if (!hasRepairTools(player)) {
      common.mesbox(player, text(job.variant, job.missing));
      return;
    }
    repairing.add(player);
    const walked = !onTile(player, job.tile);
    if (walked) player.getMovementQueue().requestWalk(at(job.tile), false);
    awaitRepairTile(player, job, walked, 0);
  }

  /** Each tick until the player stands on the repair tile: then faces the work and, with a walk, starts a tick later (t430-432). */
  function awaitRepairTile(player, job, walked, waited) {
    common.later(player, 1, () => {
      if (!onTile(player, job.tile)) {
        if (waited >= REPAIR_WALK_LIMIT) repairing.delete(player);
        else awaitRepairTile(player, job, walked, waited + 1);
        return;
      }
      player.setPositionToFace(at([...job.face, job.tile[2]]));
      if (walked) common.later(player, 1, () => hammer(player, job));
      else hammer(player, job);
    });
  }

  /** sang_repair_boat with three hammer_wood sounds (t432, t459); the result four ticks on. */
  function hammer(player, job) {
    lock(player, true);
    busy(player, true);
    common.anim(player, SEQ.REPAIR);
    for (const delay of [43, 65, 87]) common.sound(player, SOUND.HAMMER, delay);
    common.later(player, REPAIR_TICKS, () => repaired(player, job));
  }

  /** The varbit, the stage, the plank and nails, m2_build and the double box (t436, t463). */
  function repaired(player, job) {
    repairing.delete(player);
    lock(player, false);
    common.anim(player, -1);
    if (state.get(player, job.varbit) !== 0 || !hasRepairTools(player)) {
      busy(player, false);
      return;
    }
    state.set(player, job.varbit, 1);
    state.advance(player, job.stage);
    player.getInventory().deleteNumber(PLANK, 1);
    const nails = takeNails(player);
    common.sound(player, SOUND.BUILD);
    common.doubleBox(player, [PLANK, nails], text(job.variant, job.done), () => busy(player, false));
  }

  /** The boat: Inspect while broken, Push once fixed (the chute too), gone once pushed. */
  function clickBoat({ player }) {
    if (!player) return false;
    const boat = state.get(player, VARBIT.BOAT_BROKEN);
    if (boat >= 2) return false;
    if (boat === 0) {
      if (stage(player) < STAGE.STARTED) common.mesbox(player, text(V.BOAT_BEFORE_START, STEP.BOAT_BEFORE_START));
      else inspectForRepair(player, BOAT_REPAIR);
      return true;
    }
    if (state.get(player, VARBIT.CHUTE_BROKEN) !== 1) {
      common.mesbox(player, text(V.PUSH_BEFORE_CHUTE, STEP.PUSH_BEFORE_CHUTE));
      return true;
    }
    push(player);
    return true;
  }

  /** The chute: in poor condition before the boat is fixed, then its own repair. */
  function clickChute({ player }) {
    if (!player || state.get(player, VARBIT.CHUTE_BROKEN) === 1) return false;
    if (state.get(player, VARBIT.BOAT_BROKEN) === 0) common.mesbox(player, text(V.CHUTE_BEFORE_BOAT, STEP.CHUTE_BEFORE_BOAT));
    else inspectForRepair(player, CHUTE_REPAIR);
    return true;
  }

  /** A plank used on the broken boat or chute asks the same as Inspect (Ours, as before the alignment). */
  function plankOnBoat({ player, objectId }) {
    if (objectId !== BOAT_MULTI && objectId !== BOAT_BROKEN) return false;
    if (stage(player) < STAGE.STARTED || state.get(player, VARBIT.BOAT_BROKEN) !== 0) return false;
    inspectForRepair(player, BOAT_REPAIR);
    return true;
  }

  function plankOnChute({ player, objectId }) {
    if (objectId !== CHUTE_MULTI && objectId !== CHUTE_BROKEN) return false;
    if (state.get(player, VARBIT.BOAT_BROKEN) === 0 || state.get(player, VARBIT.CHUTE_BROKEN) !== 0) return false;
    inspectForRepair(player, CHUTE_REPAIR);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The push (t472-496)
  // ---------------------------------------------------------------------------

  function push(player) {
    if (pushing.has(player) || Scenes.get(player)) return;
    pushing.add(player);
    Scenes.later(player, PUSH.fadeOut, () => {
      lock(player, true);
      busy(player, true);
      Scenes.fade(player, true);
      Scenes.hold(player);
    });
    Scenes.later(player, PUSH.cutscene, () => {
      Scenes.controls(player, true, true);
      Scenes.hideTabs(player);
    });
    Scenes.later(player, PUSH.open, () => openPushScene(player));
  }

  function openPushScene(player) {
    const scene = Scenes.open(player, "darkness-of-hallowvale-push", PUSH.bounds, {}, {
      instance: { sourceChunk: PUSH.sourceChunk, size: PUSH.size }, at: PUSH_STAND, exit: PUSH_STAND,
    });
    Scenes.controls(player, true, true);
    Scenes.face(player, PUSH.boat);
    // The copy's own boat goes (loc_del t476); the sang_boat NPC takes its place, facing south.
    player.getPacketSender().sendObjectRemoval(new GameObject(BOAT_MULTI, Scenes.tileFor(scene, PUSH.boatLoc), 10, 0, null));
    const boat = Scenes.actor(scene, SANG_BOAT_NPC, PUSH.boat, [PUSH.boat[0], PUSH.boat[1] - 1]);
    const [move, look, rates] = PUSH.camera;
    Scenes.later(scene, PUSH.cameraAt - PUSH.open, () => Scenes.camera(player, move, look, rates));
    Scenes.later(scene, PUSH.fadeIn - PUSH.open, () => Scenes.fade(player, false));
    Scenes.later(scene, PUSH.push - PUSH.open, () => {
      common.anim(player, SEQ.PUSH);
      common.sound(player, SOUND.PUSH, 30);
    });
    // The boat slides a tile south each tick (t481-490): live's npc teleport with the jump flag clear,
    // which clients walk the boat over. A plain moveTo drops and re-adds it, so it blinked down the ramp.
    for (let i = 0; i < PUSH.slideTiles; i++) {
      Scenes.later(scene, PUSH.slideFrom - PUSH.open + i, () => {
        if (boat?.isRegistered?.()) boat.teleportInView(Scenes.tileFor(scene, [PUSH.boat[0], PUSH.boat[1] - 1 - i, 0]));
      });
    }
    const [panMove, panLook, panRates] = PUSH.pan;
    Scenes.later(scene, PUSH.panAt - PUSH.open, () => Scenes.camera(player, panMove, panLook, panRates));
    Scenes.later(scene, PUSH.fadeOutAgain - PUSH.open, () => {
      Scenes.fade(player, true);
      Scenes.hold(player);
    });
    Scenes.later(scene, PUSH.end - PUSH.open, () => finishPush(player));
  }

  /** The boat is in the water (t491): 2587 = 1, 2585 = 2; back on the boathouse floor, facing the sea. */
  function pushed(player) {
    pushing.delete(player);
    state.set(player, VARBIT.SEA_BOAT_VISIBLE, 1);
    state.set(player, VARBIT.BOAT_BROKEN, 2);
  }

  function finishPush(player) {
    pushed(player);
    Scenes.end(player, false);
    player.moveTo(at(PUSH_STAND));
    player.setPositionToFace(at([...PUSH.back, 0]));
    Scenes.restoreTabs(player);
    lock(player, true);
    Scenes.later(player, PUSH.control - PUSH.end, () => {
      lock(player, false);
      busy(player, false);
      player.getPacketSender().sendInterfaceRemoval();
      Scenes.fade(player, false);
    });
  }

  /** A logout inside the copy: the scene puts the player at its exit; Ours: the boat counts as pushed. */
  function pushEnded(player, scene, logout) {
    if (!logout) return;
    pushed(player);
    lock(player, false);
  }

  // ---------------------------------------------------------------------------
  // Board, the ride, the dock
  // ---------------------------------------------------------------------------

  function sinsComplete(player) {
    const request = { player, key: "sins_of_the_father", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /**
   * Board: the first ride (up to stage 40) is the boat map; later trips while the quest runs are the
   * Morytania boats' fade trip (t5420-5434). Once Sins of the Father is done the ferries own the dock.
   * Ours: after this quest, before Sins of the Father, the same trip (the Wiki's way into Meiyerditch).
   */
  function board({ player }) {
    if (!player || state.get(player, VARBIT.SEA_BOAT_VISIBLE) !== 1) return false;
    const complete = stage(player) >= STAGE.COMPLETE;
    if (complete && sinsComplete(player)) return false;
    if (riding.has(player)) return true;
    if (!complete && stage(player) < STAGE.ARRIVED) firstRide(player);
    else sail(player);
    return true;
  }

  function sail(player) {
    const request = { player, route: "morytania-meiyerditch", handled: false };
    api.emitCustomEvent("ferries:travel", request);
    // Ours: without the ferries plugin the trip is a plain move.
    if (!request.handled) player.moveTo(at(DOCK));
  }

  /** t512-526, from the tick the player faces the boat. */
  function firstRide(player) {
    riding.add(player);
    common.later(player, RIDE.depart, () => {
      lock(player, true);
      busy(player, true);
      common.anim(player, SEQ.BOARD);
      Scenes.fade(player, true);
      player.getPacketSender().sendSong(SONG_SILENCE).sendJingle(JINGLE_BOAT_RIDE);
    });
    common.later(player, RIDE.minimap, () => player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
    common.later(player, RIDE.map, () => {
      state.advance(player, STAGE.BOAT_RIDE);
      player.getPacketSender().sendInterface(BOAT_MAP);
      Scenes.hideTabs(player);
      player.getPacketSender().sendInterfaceAnimation(BOAT_MAP_MODEL, BOAT_MAP_ANIM);
    });
    common.later(player, RIDE.land, () => player.moveTo(at(DOCK)));
    common.later(player, RIDE.docked, () => docked(player));
  }

  function docked(player) {
    riding.delete(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
    Scenes.restoreTabs(player);
    sender.sendInterfaceRemoval();
    Scenes.fade(player, false);
    lock(player, false);
    common.mesbox(player, text(V.BOARD, STEP.DOCKED), () => busy(player, false));
  }

  /** Ours: a logout on the boat lands the player at the dock, the ride counted. */
  function landOnLogout({ player }) {
    if (!player || !riding.has(player)) return;
    riding.delete(player);
    state.advance(player, STAGE.BOAT_RIDE);
    player.setLocation(at(DOCK));
  }

  /**
   * Jump-onto from the boat (t531, t5460): onto the rock, human_steppingstonejump and jump; on the first
   * trip stage 50 two ticks on (t533). After the quest the ferries have the rock.
   */
  function jumpOntoRock({ player }) {
    if (!player || stage(player) >= STAGE.COMPLETE || !onTile(player, DOCK) || riding.has(player)) return false;
    busy(player, true);
    slide(player, DOCK_ROCK, [28, 40], 1024, SEQ.JUMP);
    common.sound(player, SOUND.JUMP, 10);
    common.later(player, JUMP_STAGE_TICKS, () => {
      busy(player, false);
      if (stage(player) === STAGE.BOAT_RIDE) state.advance(player, STAGE.ARRIVED);
    });
    return true;
  }

  /** Climb-up (t535, t5464): onto the wall top westward, myq3_outcrop_wall_climb and climb_wall twice. */
  function climbUpRock({ player }) {
    return climb(player, DOCK_ROCK, WALL_TOP, 512);
  }

  /** Ours (not captured): Climb-down is Climb-up backwards, as the transport table has it. */
  function climbDownRock({ player }) {
    return climb(player, WALL_TOP, DOCK_ROCK, 1536);
  }

  function climb(player, from, to, angle) {
    if (!player) return false;
    if (climbing.has(player)) return true;
    if (!onTile(player, from)) return false;
    climbing.add(player);
    lock(player, true);
    slide(player, to, [0, 150], angle, SEQ.CLIMB);
    common.sound(player, SOUND.CLIMB);
    common.sound(player, SOUND.CLIMB, 80);
    common.later(player, CLIMB_TICKS, () => {
      climbing.delete(player);
      lock(player, false);
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  api.onNpcInteraction("Veliaf Hurtz", { "Talk-to": talkVeliaf });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", startHook);
  api.onCustomEvent("npc-dialogue:line", shapeLine);
  api.onCustomEvent("npc-dialogue:menu", shapeMenu);
  api.onObjectFirstClick([BOAT_MULTI, BOAT_BROKEN, BOAT_FIXED], clickBoat);
  api.onObjectFirstClick([CHUTE_MULTI, CHUTE_BROKEN], clickChute);
  api.onObjectFirstClick([SEA_BOAT_MULTI, SEA_BOAT], board);
  api.onObjectFirstClick(JUMP_ROCK, jumpOntoRock);
  api.onObjectFirstClick(CLIMB_UP_ROCK, climbUpRock);
  api.onObjectFirstClick(CLIMB_DOWN_ROCK, climbDownRock);
  api.onItemOnObject("Plank", "Boat", plankOnBoat, { noted: false });
  api.onItemOnObject("Plank", "Boat Chute", plankOnChute, { noted: false });
  api.onPlayerLogout(landOnLogout);
};
