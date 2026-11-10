/**
 * The Observatory Quest's closing cutscene: the professor fitting the new lens, as live plays it
 * when the player first climbs from the dungeon into the Observatory after handing over the lens
 * (RSProx capture 20261110T110141-5ab63b4, rev 242, ticks 1402-1588).
 *
 * - The climb fades the screen out a tick after the player reaches the stairs; three ticks later
 *   the player is rebuilt into a copy of the Observatory (x 2432-2463, y 3136-3183, every plane,
 *   unturned) on 2438,3163 with the cutscene professor (5367) on 2439,3161 facing south, the
 *   "observatory telescope cutscene" track (368) playing, and the cutscene varbits set.
 * - A message box names the Observatory; its continue starts a slow camera tour round the dome,
 *   then a fade to the player and professor at the ground-floor telescope for five lines. The
 *   professor scratches his head, walks round it, taps it with a hammer and goes upstairs; the
 *   player follows, he fits the lens ("Looking good."), walks round with a screwdriver and cheers.
 * - observatory_cutscene_seen (3838) is set as the last fade starts; three ticks later the player
 *   is on the real map at 2438,3163 and the screen fades back in.
 *
 * Every line's words come from the quest page's "entering-the-observatory" transcript; the
 * timeline (ticks from each segment's start: the scene's opening, then each continue) is the
 * capture's. A logout (or a server stop) inside it leaves the player at 2438,3163 with the scene
 * unseen, so the next climb plays it again.
 */
const { createQuestScenes } = require("../QuestScenes");

const PAGE = "Observatory Quest";
const VARIANT = "entering-the-observatory";

/** Live copies 4 x 6 zones from 2432,3136; QuestScenes copies a square, so 6 x 6 covers it. */
const SOURCE_CHUNK = [2432 / 8, 3136 / 8];
const SOURCE_SIZE = 6;
const BOUNDS = [[2432, 2463, 3136, 3183, 0], [2432, 2463, 3136, 3183, 1], [2432, 2463, 3136, 3183, 2]];
const EXIT = [2438, 3163, 0];
const SCENE_EXIT_ATTRIBUTE = "observatory-quest:scene-exit";
const MUSIC_TRACK = 368; // "observatory telescope cutscene" (Look to the Stars)
/** Ticks from the climb to the fade, and from the fade to the rebuild (ticks 1414, 1415, 1418). */
const FADE_DELAY = 1;
const REBUILD_DELAY = 3;
/** Set with cutscene_status on the rebuild tick and cleared on the exit tick (1418, 1584). */
const SCENE_VARBITS = [["fov_clamp", 1], ["draw_distance_max_override", 1]];
const SCENE_VARPS = [["option_areasounds_override", 30], ["areasounds_override", 1]];

const PROFESSOR_ACTOR = 5367; // observatory_professor_cutscene
const PROFESSOR_HEAD = 5366; // observatory_professor, the chathead live shows
const CHATHAP1 = 567;
const CHATNEU1 = 588;
const FAST = { rate: 100, rate2: 100 };
const SLOW = { rate: 5, rate2: 5 };
const SLOWER = { rate: 3, rate2: 3 };

const ANIM = {
  wave: 863,
  scratchHead: 6844, // professor_fixing_scope_scratch_head
  hammer: 6847, // professor_fixing_scope_hammer_time
  fitLens: 6848, // professor_fitting_lens
  screwdriver: 6845, // professor_fixing_scope_screw_driver
  cheer: 862,
  stop: -1,
};
const SOUND = { fixLens: 3801, screwdriver: 3800 }; // observatory_fix_lens (delay 10), observatory_screwdriver

/**
 * The transcript steps by position: 0 is the message box, 3-8 the first conversation, 9 and 10
 * the professor's overheads, 11-12 the trip upstairs, 13-16 the lens and the last adjustment.
 */
const STEP = { title: 0, hi: 3, hiThere: 4, finishing: 5, interrupt: 6, thanks: 7, getFinished: 8,
  hmm: 9, tap: 10, upstairs: 11, rightOh: 12, lens: 13, lookingGood: 14, adjustment: 15, paysOff: 16 };

/**
 * One segment per continue. `line` entries chain chatheads (the segment after them starts on the
 * last one's continue); `say` is an overhead; `walk` corners are walked a tile a tick.
 */
const SEGMENTS = [
  [
    { tick: 2, camera: [[2458, 3158, 1925], [2443, 3161, 75], FAST] },
    { tick: 3, fade: "in", title: true },
  ],
  [
    { tick: 0, cameraMove: [[2445, 3141, 1925], SLOW] },
    { tick: 6, cameraMove: [[2432, 3144, 1925], SLOW] },
    { tick: 12, cameraMove: [[2432, 3181, 1925], SLOW] },
    { tick: 18, cameraMove: [[2448, 3178, 1800], SLOW] },
    { tick: 20, cameraLook: [[2439, 3162, 100], SLOW] },
    { tick: 26, cameraMove: [[2443, 3168, 1000], SLOW] },
    { tick: 29, fade: "out" },
    { tick: 34, camera: [[2437, 3157, 425], [2438, 3162, 75], FAST], fade: "in" },
    { tick: 37, lines: [
      { step: STEP.hi, expression: CHATNEU1 },
      { step: STEP.hiThere, expression: CHATHAP1, face: "player", anim: ANIM.wave },
      { step: STEP.finishing, expression: CHATHAP1 },
      { step: STEP.interrupt, expression: CHATHAP1 },
      { step: STEP.thanks, expression: CHATNEU1 },
      { step: STEP.getFinished, expression: CHATNEU1, face: [2441, 3161] },
    ] },
  ],
  [
    { tick: 1, anim: ANIM.scratchHead, say: STEP.hmm },
    { tick: 4, anim: ANIM.stop },
    { tick: 5, walk: [[2439, 3159, 0], [2442, 3159, 0], [2442, 3162, 0]] },
    { tick: 7, camera: [[2444, 3166, 300], [2442, 3161, 25], FAST] },
    { tick: 15, face: [2441, 3161] },
    { tick: 16, anim: ANIM.hammer, say: STEP.tap },
    { tick: 20, anim: ANIM.stop },
    { tick: 21, walk: [[2443, 3162, 0]] },
    { tick: 23, face: "player" },
    { tick: 24, lines: [
      { step: STEP.upstairs, expression: CHATHAP1 },
      { step: STEP.rightOh, expression: CHATHAP1 },
    ] },
  ],
  [
    { tick: 0, face: [2444, 3161] },
    { tick: 1, upstairs: { player: [2443, 3161, 1], professor: [2443, 3158, 1], face: [2439, 3158] },
      camera: [[2438, 3156, 525], [2441, 3159, 200], FAST] },
    { tick: 3, walk: [[2439, 3158, 1], [2439, 3163, 1]] },
    { tick: 7, camera: [[2442, 3156, 600], [2439, 3162, 25], SLOWER] },
    { tick: 14, say: STEP.lens },
    { tick: 15, anim: ANIM.fitLens, sound: [SOUND.fixLens, 10] },
    { tick: 24, lines: [{ step: STEP.lookingGood, expression: CHATHAP1 }] },
  ],
  [
    { tick: 2, camera: [[2443, 3156, 375], [2440, 3162, 25], SLOWER] },
    { tick: 3, walk: [[2439, 3165, 1], [2442, 3165, 1], [2442, 3161, 1]] },
    { tick: 6, say: STEP.adjustment },
    { tick: 15, face: [2439, 3163] },
    { tick: 16, anim: ANIM.screwdriver, sound: [SOUND.screwdriver, 0] },
    { tick: 20, say: STEP.paysOff },
    { tick: 23, anim: ANIM.cheer },
    { tick: 26, camera: [[2438, 3166, 600], [2441, 3162, 25], SLOWER] },
    { tick: 33, seen: true, fade: "out" },
    // The fade in a tick later and the release three after that are exit()'s.
    { tick: 36, exit: true },
  ],
];

module.exports = function createObservatoryCutscene(api, { onSeen }) {
  const { Animation, ActionDialogue, DialogueChainBuilder, Location, NpcDialogue, PlayerDialogue, StatementDialogue, loadTranscripts } = {
    ...api.core,
    loadTranscripts: require("../QuestRuntime").loadTranscripts,
  };
  // A server stop inside the copy saves the player there; the exit is kept and restored at login.
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  /** player -> { professor, segment }, while the scene plays. */
  const playing = new Map();

  function steps() {
    const variant = loadTranscripts(api)?.[PAGE]?.variants?.[VARIANT];
    if (!Array.isArray(variant)) throw new Error(`Observatory Quest: no "${VARIANT}" transcript`);
    return variant;
  }

  /** A transcript step's words, with the player's name for "[player name]". */
  function text(player, index) {
    const step = steps()[index];
    const words = step?.player ?? step?.text;
    if (typeof words !== "string") throw new Error(`Observatory Quest: transcript step ${index} has no line`);
    return words.replace(/\[player name\]/gi, player.getDisplayName());
  }

  function isPlayerStep(index) {
    return typeof steps()[index]?.player === "string";
  }

  function active(player) {
    return playing.has(player);
  }

  function sendSceneVars(player, on) {
    const sender = player.getPacketSender();
    const cache = api.core.CacheDefinitions;
    for (const [name, value] of SCENE_VARBITS) sender.sendVarbit(cache.getVarbitId(name), on ? value : 0);
    for (const [name, value] of SCENE_VARPS) sender.sendConfig(cache.getVarpId(name), on ? value : 0);
  }

  /** The climb: fade out, then the scene in the Observatory's copy. */
  function start(player) {
    if (playing.has(player) || Scenes.get(player)) return false;
    const state = { professor: null, segment: 0 };
    playing.set(player, state);
    // Held from the climb; cutscene_status and the minimap follow on the rebuild tick.
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.later(player, FADE_DELAY, () => {
      if (playing.get(player) !== state) return;
      Scenes.hold(player);
      Scenes.fade(player, true);
    });
    Scenes.later(player, FADE_DELAY + REBUILD_DELAY, () => {
      if (playing.get(player) !== state) return;
      if (player.isRegistered?.() === false) {
        playing.delete(player);
        return;
      }
      const scene = Scenes.open(player, "observatory", BOUNDS, { musicTrack: MUSIC_TRACK }, {
        instance: { sourceChunk: SOURCE_CHUNK, size: SOURCE_SIZE }, at: EXIT, exit: EXIT,
      });
      Scenes.controls(player, true, true);
      sendSceneVars(player, true);
      Scenes.face(player, [2439, 3161]);
      state.professor = Scenes.actor(scene, PROFESSOR_ACTOR, [2439, 3161, 0], [2439, 3160]);
      runSegment(player, state, scene);
    });
    return true;
  }

  function runSegment(player, state, scene) {
    for (const event of SEGMENTS[state.segment]) {
      if (event.tick === 0) run(player, state, event);
      else Scenes.later(scene, event.tick, () => run(player, state, event));
    }
  }

  function next(player, state) {
    const scene = Scenes.get(player);
    if (playing.get(player) !== state || !scene) return;
    state.segment += 1;
    if (state.segment < SEGMENTS.length) runSegment(player, state, scene);
  }

  /** The professor's face target: a source tile, or the player where they stand. */
  function faceTarget(player, target) {
    return target === "player" ? player.getLocation() : target;
  }

  function sourceTile(player, [x, y, z]) {
    return Scenes.get(player)?.area?.sourceTile?.(x, y, z) ?? new Location(x, y, z);
  }

  function walk(player, state, corners) {
    const npc = state.professor;
    if (!npc) return;
    npc.getMovementQueue().reset();
    for (const corner of corners) Scenes.walk(npc, corner);
    // The movement coordinator walks an NPC off its home straight back: home is the walk's end.
    npc.setSpawnPosition?.(sourceTile(player, corners.at(-1)));
  }

  function run(player, state, event) {
    if (playing.get(player) !== state) return;
    const npc = state.professor;
    const sender = player.getPacketSender();
    if (event.fade) Scenes.fade(player, event.fade === "out");
    if (event.closeFade) Scenes.closeFade(player);
    if (event.camera) {
      const [move, look, rates] = event.camera;
      Scenes.camera(player, move, look, rates);
    }
    if (event.cameraMove) {
      const [[x, y, height], rates] = event.cameraMove;
      const at = sourceTile(player, [x, y, 0]);
      sender.sendCameraMoveTo(at.getX(), at.getY(), height, rates);
    }
    if (event.cameraLook) {
      const [[x, y, height], rates] = event.cameraLook;
      const at = sourceTile(player, [x, y, 0]);
      sender.sendCameraLookAt(at.getX(), at.getY(), height, rates);
    }
    if (event.upstairs) {
      Scenes.place(player, event.upstairs.player);
      if (npc) {
        Scenes.place(npc, event.upstairs.professor);
        npc.setSpawnPosition?.(sourceTile(player, event.upstairs.professor));
        Scenes.face(npc, event.upstairs.face);
      }
    }
    if (event.walk) walk(player, state, event.walk);
    if (event.face && npc) Scenes.face(npc, faceTarget(player, event.face));
    if (event.anim !== undefined && npc) npc.performAnimation(new Animation(event.anim));
    if (event.say !== undefined && npc) npc.forceChat(text(player, event.say));
    if (event.sound) sender.sendSound(event.sound[0], 1, event.sound[1]);
    if (event.title) title(player, state);
    if (event.lines) lines(player, state, event.lines);
    if (event.seen) onSeen?.(player);
    if (event.exit) exit(player, state);
  }

  /** The opening message box; the camera tour starts on its continue. */
  function title(player, state) {
    // Live's box (tick 1421) colours the first line and breaks after it; the words are the transcript's.
    const words = text(player, STEP.title);
    const [, name, rest] = /^(~[^~]*~)\s*(.*)$/.exec(words) ?? [null, null, words];
    const chain = new DialogueChainBuilder();
    chain.add(new StatementDialogue(0, name ? `<col=800000>${name}</col><br>${rest}` : words));
    chain.add(new ActionDialogue(1, { execute: () => next(player, state) }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** Chatheads the player continues; the next segment starts on the last one's continue. */
  function lines(player, state, entries) {
    const chain = new DialogueChainBuilder();
    let index = 0;
    for (const entry of entries) {
      if (entry.face || entry.anim !== undefined) {
        chain.add(new ActionDialogue(index++, { execute: () => {
          const npc = state.professor;
          if (npc && entry.face) Scenes.face(npc, faceTarget(player, entry.face));
          if (npc && entry.anim !== undefined) npc.performAnimation(new Animation(entry.anim));
          player.getDialogueManager().advance();
        } }));
      }
      const words = text(player, entry.step);
      chain.add(isPlayerStep(entry.step)
        ? new PlayerDialogue(index++, words, entry.expression)
        : new NpcDialogue(index++, PROFESSOR_HEAD, words, undefined, entry.expression));
    }
    chain.add(new ActionDialogue(index, { execute: () => {
      player.getPacketSender().sendInterfaceRemoval();
      next(player, state);
    } }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** Back on the real map, still faded out; the last events fade in and let go. */
  function exit(player, state) {
    state.exiting = true;
    Scenes.end(player, false);
    player.moveTo(new Location(...EXIT));
    Scenes.controls(player, true, true);
    Scenes.later(player, 1, () => Scenes.fade(player, false));
    Scenes.later(player, 4, () => {
      if (playing.get(player) !== state) return;
      playing.delete(player);
      Scenes.closeFade(player);
      Scenes.controls(player, false);
    });
  }

  function sceneEnded(player, scene, logout) {
    sendSceneVars(player, false);
    const state = playing.get(player);
    if (!state || state.exiting) return;
    // Left early (a logout or a teleport out): the scene is unseen and plays on the next climb.
    playing.delete(player);
    Scenes.cancel(player);
    if (!logout) {
      Scenes.closeFade(player);
      player.getDialogueManager().reset?.();
      player.getPacketSender().sendInterfaceRemoval();
    }
  }

  return { start, active };
};

/** For tests: the transcript the timeline reads and the steps it reads by position. */
module.exports.PAGE = PAGE;
module.exports.VARIANT = VARIANT;
module.exports.STEP = STEP;
