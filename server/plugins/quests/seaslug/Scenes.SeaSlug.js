/**
 * Sea Slug's timed moments, as live plays them (RSProx capture 20261110T112750-5ab63b4, rev 242,
 * the whole quest; ticks below are that recording's):
 *
 * - The boat repair (ticks 38-61): the swamp paste goes and the screen fades out; three ticks
 *   later a cutscene in a copy of the Witchaven map (8 x 8 chunks from 2688,3264, plane 0) shows
 *   Holgart in the water (5072) mending the boat (seq 4786, sound 3026) under two overhead lines,
 *   then the boat afloat (Holgart turns into 5068); a fade back to the real map at 2720,3302.
 * - Kent's grab (ticks 196-210): the conversation closes, Kent calls "wait!" three ticks later,
 *   squashes the slug (spotanim 790, seq 4807, sound 3025) on the next tick, the two messages two
 *   ticks apart, then the slug on the floor and his last line. The player is held all through.
 * - The loose panel (ticks 334-340): one Kick plays the kick (seq 4804, sound 3024) with its first
 *   message, the second three ticks later and the third (and the stage) three after that.
 * - The crane (ticks 375-406): from the controls on its north side, a fade, then a cutscene in a
 *   copy of the platform (5 x 5 chunks from 2752,3264): Kennith (5063) climbs out to the crane, the
 *   player turns it (seq 4795, loc anim 4796, sound 3021), Kennith (as 5062) rides it down
 *   (seq 4797, crane 18326, sound 3020), and a fade back to the real platform.
 *
 * The words are the transcript's ("Sea Slug" page): each scene plays the steps it needs from it.
 */
const { createQuestScenes } = require("../QuestScenes");
const { loadTranscripts, startTranscript } = require("../QuestRuntime");

const PAGE = "Sea Slug";
const SCENE_EXIT_ATTRIBUTE = "sea-slug:scene-exit";

/** Internal markers appended to a played step list: the runner emits them as actions. */
const MARK = {
  KENT_GRAB: "sea-slug:kent-grab",
  KENT_DONE: "sea-slug:kent-done",
};

const REPAIR = {
  sourceChunk: [2688 >> 3, 3264 >> 3],
  size: 8,
  bounds: [[2688, 2751, 3264, 3327, 0]],
  at: [2716, 3300, 0],
  exit: [2720, 3302, 0],
  holgartInWater: 5072, // holgartinwater
  holgartAfloat: 5068, // holgartnolegs
  holgartFrom: [2718, 3300, 0],
  holgartTo: [2719, 3300, 0],
  repairSeq: 4786, // seaslug_boat_repair, delay 45
  repairSound: 3026, // slug_smear_paste, delay 45
  delay: 45,
  camera: { move: [2711, 3292, 500], look: [2717, 3299, 200], rates: { rate: 100, rate2: 100 } },
  // Ticks from the hand-in (capture tick 38).
  open: 3, start: 4, done: 13, fadeOut: 17, end: 20,
};

const KENT = {
  grabGraphic: 790, // seaslug_slug_squashed
  grabSeq: 4807, // seaslug_grab_n_destroy
  grabSound: 3025, // slug_scoop_slug, delay 10
  soundDelay: 10,
  slugItem: 1466, // seasluginv, on the player's tile, theirs only
  // Ticks from the conversation closing (196): "wait!" at 199.
  wait: 3,
  // Ticks from the player continuing past "wait!" (200): the grab 201, messages 203 and 205,
  // the slug and the last lines 207.
  grab: 1, slooop: 3, pulls: 5, last: 7,
  slooopStep: "zWzBmj",
  pullsStep: "YF5iid",
};

const PANEL = {
  kickSeq: 4804, // seaslug_human_kick
  kickSound: 3024, // slug_kick_panel
  steps: ["vJ1GjP", "NgGUPy", "5u-9os"],
  // The three messages, from the kick (334): 334, 337, 340.
  ticks: [0, 3, 6],
};

const CRANE = {
  sourceChunk: [2752 >> 3, 3264 >> 3],
  size: 5,
  bounds: [[2752, 2791, 3264, 3303, 1]],
  stand: [2772, 3291, 1],
  crane: { id: 18327, x: 2770, y: 3287, z: 1, type: 10, face: 2 },
  craneLowered: { id: 18326, x: 2770, y: 3287, z: 1, type: 10, face: 2 }, // seaslug_crane2
  kennith: 5063, // kennith_platform
  kennithRiding: 5062, // kennith_cutscene
  kennithFrom: [2767, 3289, 1],
  kennithStep: [2768, 3289, 1],
  kennithOnCrane: [2770, 3289, 1],
  turnRightSeq: 4795, // seaslug_controls_right
  craneRightAnim: 4796, // seaslug_crane_right
  turnSound: 3021, // slug_crane_turn, delay 10
  turnLeftSeq: 4797, // seaslug_controls_left
  lowerSound: 3020, // slug_crane_turn_and_lower, delay 10
  soundDelay: 10,
  scrambleStep: "utnJSh",
  belowStep: "PGBTE0",
  // Ticks from the fade (378).
  open: 3, actors: 5, step: 6, turn: 8, ride: 13, lower: 14, fadeOut: 21, end: 24, below: 25,
};

module.exports = function createSeaSlugScenes(api, { onRepaired, onKentDone, onPanelOpened, onCraneDone } = {}) {
  const { Animation, GameObject, Graphic, Item, Location } = api.core;
  const Scenes = createQuestScenes(api, { recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  /** Players the quest holds still between conversations (Kent's grab, the kick). */
  const held = new Map();

  function steps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  /** A step anywhere in a variant, conditions included, by its id. */
  function stepById(variant, id) {
    const find = (list) => {
      for (const step of list ?? []) {
        if (step?.id === id) return step;
        const nested = find(step?.steps) ?? find(step?.options?.flatMap?.((option) => option?.steps ?? []));
        if (nested) return nested;
      }
      return null;
    };
    return find(steps(variant));
  }

  function play(player, npcId, variant, list, npc = null) {
    if (!list.length) return false;
    return startTranscript(api, player, npcId, PAGE, variant, () => list, npc);
  }

  function message(player, variant, id) {
    const text = stepById(variant, id)?.text;
    if (text) player.sendMessage(text);
  }

  function hold(player, on) {
    const movement = player.getMovementQueue?.();
    if (on) {
      movement?.reset?.();
      held.set(player, true);
    } else {
      held.delete(player);
    }
    movement?.setBlockMovement?.(on);
  }

  function sound(player, id, delay = 0) {
    player.getPacketSender().sendSound(id, 1, delay);
  }

  function inScene(player, name) {
    return Scenes.get(player)?.name === name;
  }

  // ==========================================================================
  // The boat repair
  // ==========================================================================

  /** Live fades out with the hand-in message; the cutscene opens three ticks later. */
  function boatRepair(player) {
    if (Scenes.get(player)) return;
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, REPAIR.open, () => openRepair(player));
  }

  function openRepair(player) {
    const scene = Scenes.open(player, "boat-repair", REPAIR.bounds, {}, {
      instance: { sourceChunk: REPAIR.sourceChunk, size: REPAIR.size }, at: REPAIR.at, exit: REPAIR.exit,
    });
    Scenes.controls(player, true, true);
    const [x, y] = REPAIR.holgartFrom;
    const holgart = Scenes.actor(scene, REPAIR.holgartInWater, REPAIR.holgartFrom, [x, y - 1]);
    const at = REPAIR.start - REPAIR.open;
    Scenes.later(scene, at, () => {
      holgart?.moveTo(sceneTile(scene, REPAIR.holgartTo));
      holgart?.performAnimation(new Animation(REPAIR.repairSeq, REPAIR.delay));
      overhead(holgart, "talking-to-holgart", 0);
      const { move, look, rates } = REPAIR.camera;
      Scenes.camera(player, move, look, rates);
      Scenes.fade(player, false);
      sound(player, REPAIR.repairSound, REPAIR.delay);
    });
    Scenes.later(scene, REPAIR.done - REPAIR.open, () => {
      overhead(holgart, "talking-to-holgart", 1);
      holgart?.setNpcTransformationId?.(REPAIR.holgartAfloat);
    });
    Scenes.later(scene, REPAIR.fadeOut - REPAIR.open, () => Scenes.fade(player, true));
    Scenes.later(scene, REPAIR.end - REPAIR.open, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(...REPAIR.exit));
      Scenes.later(player, 1, () => Scenes.fade(player, false));
      onRepaired?.(player);
    });
  }

  /** The transcript's overhead lines after the hand-in, in order. */
  function overhead(npc, variant, index) {
    const list = stepById(variant, "u-qtrY")?.steps ?? [];
    const line = list.filter((step) => step?.presentation === "overhead")[index];
    if (npc && line?.text) npc.forceChat(line.text);
  }

  function sceneTile(scene, [x, y, z = 0]) {
    return scene.area?.sourceTile ? scene.area.sourceTile(x, y, z) : new Location(x, y, z);
  }

  // ==========================================================================
  // Kent pulls the slug off
  // ==========================================================================

  function kentGrab(player, npc, npcId, variant) {
    hold(player, true);
    const wait = steps(variant).find((step) => step?.type === "line" && /\bwait!$/.test(step.text ?? ""));
    if (!wait) {
      hold(player, false);
      return;
    }
    Scenes.later(player, KENT.wait, () => {
      if (!held.has(player)) return;
      player.setPositionToFace?.(npc?.getLocation?.());
      play(player, npcId, variant, [wait, { type: "action", id: MARK.KENT_GRAB }], npc);
    });
  }

  function kentSquash(player, npc, { npcId, variant }) {
    Scenes.later(player, KENT.grab, () => {
      npc?.performGraphic?.(new Graphic(KENT.grabGraphic));
      npc?.performAnimation?.(new Animation(KENT.grabSeq));
      sound(player, KENT.grabSound, KENT.soundDelay);
    });
    Scenes.later(player, KENT.slooop, () => message(player, variant, KENT.slooopStep));
    Scenes.later(player, KENT.pulls, () => message(player, variant, KENT.pullsStep));
    Scenes.later(player, KENT.last, () => {
      dropSlug(player);
      const list = steps(variant);
      const from = list.findIndex((step) => step?.id === KENT.pullsStep);
      const rest = from < 0 ? [] : list.slice(from + 1);
      if (!play(player, npcId, variant, [...rest, { type: "action", id: MARK.KENT_DONE }], npc)) {
        kentFinished(player);
      }
    });
  }

  function kentFinished(player) {
    hold(player, false);
    onKentDone?.(player);
  }

  /** The squashed slug, on the player's tile for them only (obj_add_specific ownership=self). */
  function dropSlug(player) {
    const manager = api.getItemOnGroundManager?.() ?? api.core.ItemOnGroundManager;
    manager?.registerLocation?.(player, new Item(KENT.slugItem, 1), player.getLocation().clone());
  }

  /** The two internal markers the grab plays through the transcript runner. */
  function marker(event) {
    if (event.stepId === MARK.KENT_GRAB) {
      event.handled = true;
      event.end = true;
      const kent = kentScene.get(event.player);
      if (kent) kentSquash(event.player, event.npc ?? kent.npc, kent);
      return true;
    }
    if (event.stepId === MARK.KENT_DONE) {
      event.handled = true;
      event.end = true;
      kentScene.delete(event.player);
      kentFinished(event.player);
      return true;
    }
    return false;
  }
  const kentScene = new Map();

  /** From the closing "Kent notices a sea slug in your torso." action of his first talk. */
  function startKent(player, npc, npcId, variant) {
    kentScene.set(player, { npc, npcId, variant });
    kentGrab(player, npc, npcId, variant);
  }

  // ==========================================================================
  // The loose panel
  // ==========================================================================

  function kickPanel(player) {
    if (held.has(player)) return;
    hold(player, true);
    player.performAnimation(new Animation(PANEL.kickSeq));
    sound(player, PANEL.kickSound);
    PANEL.steps.forEach((id, index) => {
      const fire = () => {
        message(player, "freeing-kennith", id);
        if (index === PANEL.steps.length - 1) {
          hold(player, false);
          onPanelOpened?.(player);
        }
      };
      if (PANEL.ticks[index] === 0) fire();
      else Scenes.later(player, PANEL.ticks[index], fire);
    });
  }

  // ==========================================================================
  // The crane
  // ==========================================================================

  /** Live turns to the crane, steps onto its controls the next tick and fades the tick after. */
  function crane(player) {
    if (Scenes.get(player) || held.has(player)) return;
    hold(player, true);
    const movement = player.getMovementQueue();
    movement.setBlockMovement(false);
    movement.addSteps?.(new Location(...CRANE.stand));
    Scenes.later(player, 2, () => {
      if (!held.has(player)) return;
      held.delete(player);
      Scenes.fade(player, true);
      Scenes.controls(player, true);
      Scenes.later(player, CRANE.open, () => openCrane(player));
    });
  }

  function openCrane(player) {
    const scene = Scenes.open(player, "crane", CRANE.bounds, {}, {
      instance: { sourceChunk: CRANE.sourceChunk, size: CRANE.size }, at: CRANE.stand, exit: CRANE.stand,
    });
    Scenes.controls(player, true, true);
    box(player, stepById("freeing-kennith-using-the-crane", CRANE.scrambleStep)?.text, false);
    const at = (tick) => tick - CRANE.open;
    let kennith = null;
    Scenes.later(scene, at(CRANE.actors), () => {
      const [x, y, z] = CRANE.kennithFrom;
      kennith = Scenes.actor(scene, CRANE.kennith, CRANE.kennithFrom, [x, y - 1, z]);
      Scenes.camera(player, [2772, 3297, 900], [2768, 3288, 100], { rate: 100, rate2: 100 });
      Scenes.fade(player, false);
    });
    Scenes.later(scene, at(CRANE.step), () => {
      kennith?.moveTo(sceneTile(scene, CRANE.kennithStep));
      Scenes.camera(player, [2768, 3297, 900], [2770, 3289, 100], { rate: 3, rate2: 3 });
    });
    Scenes.later(scene, at(CRANE.turn), () => {
      player.performAnimation(new Animation(CRANE.turnRightSeq));
      const { id, x, y, z, type, face } = CRANE.crane;
      const object = new GameObject(id, sceneTile(scene, [x, y, z]), type, face, scene.area);
      player.getPacketSender().sendObjectAnimation(object, new Animation(CRANE.craneRightAnim));
      sound(player, CRANE.turnSound, CRANE.soundDelay);
      Scenes.camera(player, [2765, 3288, 900], [2770, 3289, 100], { rate: 3, rate2: 3 });
    });
    Scenes.later(scene, at(CRANE.ride), () => {
      kennith?.moveTo(sceneTile(scene, CRANE.kennithOnCrane));
      kennith?.setNpcTransformationId?.(CRANE.kennithRiding);
    });
    Scenes.later(scene, at(CRANE.lower), () => {
      player.performAnimation(new Animation(CRANE.turnLeftSeq));
      if (kennith) Scenes.removeActor(scene, kennith);
      Scenes.loc(scene, CRANE.craneLowered);
      sound(player, CRANE.lowerSound, CRANE.soundDelay);
    });
    Scenes.later(scene, at(CRANE.fadeOut), () => {
      onCraneDone?.(player);
      Scenes.fade(player, true);
    });
    Scenes.later(scene, at(CRANE.end), () => {
      player.getPacketSender().sendInterfaceRemoval();
      Scenes.end(player, false);
      player.moveTo(new Location(...CRANE.stand));
      Scenes.later(player, CRANE.below - CRANE.end, () => {
        Scenes.fade(player, false);
        box(player, stepById("freeing-kennith-using-the-crane", CRANE.belowStep)?.text, true);
      });
    });
  }

  /** A message box: `next` false is the held box live shows during the scene (no continue). */
  function box(player, text, next) {
    if (!text) return;
    api.core.StatementDialogue.send(player, text, next);
  }

  function interrupted({ player }) {
    held.delete(player);
    kentScene.delete(player);
  }

  return { boatRepair, startKent, marker, kickPanel, crane, interrupted, isHeld: (player) => held.has(player), inScene, MARK, CRANE, PANEL };
};
