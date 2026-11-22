/**
 * Old Man Yarlo's Construction lecture ("Listen to Yarlo.", and "Tell me about more things I can do with Construction."
 * after the quest), replayed from the rsprox capture DaddysHome (rev 242.1, ticks 1583-1766; its replay at ticks 2235-2366
 * plays the same script). plugins/quests/data/daddys-home-lecture.json holds it, built from the capture's raw (untranslated)
 * coordinates:
 *
 * - `instances`: the three copies live builds (rebuild_region), each a grid of the filler chunk with the rooms at their
 *   slots: a Rimmington parlour and garden, then a furnished house, then a manor with a throne room and its monster pit.
 * - `steps`: one per continue. A step starts on the player's continue (the first on "Listen to Yarlo."): an empty box,
 *   its line `show` ticks later without "Click here to continue", the continue at `continue`; its events (actors,
 *   locs, camera, sounds, music, fades, the rebuilds) run at their tick from the step's start, whether the player has
 *   clicked on or not, as the two recorded runs show. The last step is the way out: the fade, the real map two ticks
 *   after the continue at the tile the player stood on, the controls three ticks after that.
 *
 * Interrupted (a logout, a death, a forced move out of the copy), the lecture ends without advancing the quest: the
 * Wiki says an interrupted cutscene has to be watched again.
 */
const LECTURE = require("../data/daddys-home-lecture.json");

const SCENE_NAME = "daddys-home-lecture";
/** Ticks from the real map coming back to the controls (capture ticks 1763 and 1766). */
const RELEASE_TICKS = 3;
/** The capture's own scene music: silence (147) until the Rimmington jingle, then Home Sweet Home. */
const SILENCE_TRACK = 147;
/** Cache scripts the capture runs as the lecture starts and ends (highlighting_off / highlighting_on). */
const HIGHLIGHTING_OFF_SCRIPT = 5485;
const HIGHLIGHTING_ON_SCRIPT = 5487;

module.exports = function createLecture(api, Scenes) {
  const {
    ActionDialogue, Animation, CacheDefinitions, DialogueChainBuilder, GameObject, Graphic, Location, StatementDialogue,
    TaskManager, CountdownTask,
  } = api.core;
  const runs = new Map();

  const varbitId = (name) => CacheDefinitions.getVarbitId(name);
  const varpId = (name) => CacheDefinitions.getVarpId(name);

  /** The copy's playable box: all of it, every plane (the player never walks; a forced move out ends it). */
  function boundsOf(instance) {
    const [width, height] = instance.size;
    return [0, 1, 2, 3].map((z) => [0, width * 8 - 1, 0, height * 8 - 1, z]);
  }

  function later(run, ticks, callback) {
    if (ticks <= 0) return callback();
    TaskManager.submit(new CountdownTask(run, ticks, () => {
      if (runs.get(run.player) === run) callback();
    }));
  }

  /**
   * Plays the lecture for `player`; `then(player)` runs a tick after the controls come back. Returns false when the
   * player is already in a scene.
   */
  function play(player, then) {
    if (runs.has(player) || Scenes.get(player)) return false;
    const home = player.getLocation().clone();
    const run = { player, home, then, step: -1, actors: new Map(), scene: null, varbits: new Map(), varps: new Map(),
      line: null, finishing: false };
    runs.set(player, run);
    player.getMovementQueue().reset().setBlockMovement(true);
    runStep(run, 0);
    return true;
  }

  function runStep(run, index) {
    const step = LECTURE.steps[index];
    if (!step || runs.get(run.player) !== run) return;
    run.step = index;
    run.line = null;
    // Each step opens on an empty box (capture: messagebox "" at the continue), its line following `show` ticks later.
    if (step.text === null || step.show > 0) Scenes.hold(run.player);
    for (const event of step.events) later(run, event[0], () => apply(run, event));
    if (step.text !== null) later(run, step.show, () => showLine(run, index, step));
  }

  /** The line without its continue, then (at `continue`) with it; the player's continue starts the next step. */
  function showLine(run, index, step) {
    const player = run.player;
    const manager = player.getDialogueManager();
    const held = new ActionDialogue(0, { execute: () => StatementDialogue.send(player, step.text, false) }, true);
    const chain = new DialogueChainBuilder()
      .add(held)
      .add(new StatementDialogue(1, step.text))
      .add(new ActionDialogue(2, { execute: () => next(run, index) }));
    run.line = { index, text: step.text, offered: false };
    manager.startDialogues(chain);
    later(run, step.continue - step.show, () => {
      if (run.line?.index !== index) return;
      run.line.offered = true;
      if (manager.getCurrent?.() === held) manager.advance();
      else offerContinue(run);
    });
  }

  /** The line again with its continue, for a chatbox something else closed meanwhile (the player has no other way on). */
  function offerContinue(run) {
    const { index, text } = run.line;
    run.player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new StatementDialogue(0, text))
      .add(new ActionDialogue(1, { execute: () => next(run, index) })));
  }

  function next(run, index) {
    if (runs.get(run.player) !== run || run.step !== index) return;
    runStep(run, index + 1);
  }

  /** The scene's per-tick check: a closed chatbox gets its line back, so a continue is always there to click. */
  function keepContinue(mobile) {
    const run = runs.get(mobile);
    if (!run?.line?.offered || run.finishing) return;
    if (!mobile.getDialogueManager().isActive?.()) offerContinue(run);
  }

  function tile(run, [x, y, z = 0]) {
    return Scenes.tileFor(run.scene, [x, y, z]);
  }

  function apply(run, [, kind, ...args]) {
    const player = run.player;
    const sender = player.getPacketSender();
    switch (kind) {
      case "rebuild": return rebuild(run, LECTURE.instances[args[0]], args[1]);
      case "return": return finish(run);
      case "fade": return Scenes.fade(player, args[0] === "out");
      case "song": return sender.sendSong(args[0]);
      case "jingle": return sender.sendJingle(args[0]);
      case "sound": return sender.sendSound(args[0], 0, args[1]);
      case "varbit": {
        const id = varbitId(args[0]);
        if (id == null) return;
        if (!run.varbits.has(id)) run.varbits.set(id, sender.getVarbit?.(id) ?? 0);
        return sender.sendVarbit(id, args[1]);
      }
      case "varp": {
        const id = varpId(args[0]);
        if (id == null) return;
        if (!run.varps.has(id)) run.varps.set(id, 0);
        return sender.sendConfig(id, args[1]);
      }
      case "cam-move": case "cam-look": {
        if (!run.scene) return;
        const [[x, y], height, rate, rate2] = args;
        const at = tile(run, [x, y, 0]);
        return kind === "cam-move"
          ? sender.sendCameraMoveTo(at.getX(), at.getY(), height, { rate, rate2 })
          : sender.sendCameraLookAt(at.getX(), at.getY(), height, { rate, rate2 });
      }
      default: return run.scene ? applyInScene(run, kind, args) : undefined;
    }
  }

  function applyInScene(run, kind, args) {
    const { player, scene } = run;
    const sender = player.getPacketSender();
    if (kind === "loc") {
      const [id, at, shape, rotation] = args;
      return Scenes.loc(scene, { id, x: at[0], y: at[1], z: at[2], type: shape, face: rotation });
    }
    if (kind === "locdel") {
      const [at, shape, rotation] = args;
      return sender.sendObjectRemoval(new GameObject(-1, tile(run, at), shape, rotation, scene.area));
    }
    if (kind === "locanim") {
      const [at, shape, rotation, animation] = args;
      return sender.sendObjectAnimation(new GameObject(-1, tile(run, at), shape, rotation, scene.area), new Animation(animation));
    }
    if (kind === "mapanim") {
      const [id, at, height, delay] = args;
      return sender.sendGraphic(Graphic.atHeight(id, height, delay), tile(run, at));
    }
    if (kind === "spawn") {
      const [slot, name, at, direction] = args;
      const id = CacheDefinitions.getNpcId(name);
      const npc = id == null ? null : Scenes.actor(scene, id, at, null, { direction });
      if (npc) run.actors.set(slot, npc);
      return;
    }
    const npc = run.actors.get(args[0]);
    if (!npc) return;
    switch (kind) {
      case "despawn":
        run.actors.delete(args[0]);
        return Scenes.removeActor(scene, npc);
      case "step": return npc.getMovementQueue().addFirstStep(tile(run, args[1]));
      case "tele": return npc.moveTo(tile(run, args[1]));
      case "face": return npc.setPositionToFace(tile(run, [...args[1], npc.getLocation().getZ()]));
      case "transform": {
        const id = CacheDefinitions.getNpcId(args[1]);
        return id == null ? undefined : npc.setNpcTransformationId(id);
      }
      case "anim": {
        const animation = new Animation(args[1]);
        // Animation's numeric second argument is a priority; the captured delay goes on the field.
        animation.delay = args[2] ?? 0;
        return npc.performAnimation(animation);
      }
      case "spotanim": return npc.performGraphic(Graphic.atHeight(args[1], args[2], args[3]));
      default: return undefined;
    }
  }

  /** The first rebuild opens the scene in its copy; later ones swap the copy, as live's second and third rebuilds do. */
  function rebuild(run, instance, at) {
    const player = run.player;
    run.actors.clear();
    if (run.scene) {
      Scenes.swap(run.scene, { layout: instance }, at);
      return;
    }
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    player.getPacketSender().sendClientScript(HIGHLIGHTING_OFF_SCRIPT);
    run.scene = Scenes.open(player, SCENE_NAME, boundsOf(instance), {
      process: keepContinue,
      // Silence until the capture's own jingle and song (the region's music comes back with the real map).
      musicTrack: SILENCE_TRACK,
      canTeleport: () => false,
      allowSummonPet: false,
    }, {
      instance: { layout: instance },
      at,
      exit: [run.home.getX(), run.home.getY(), run.home.getZ()],
    });
  }

  /** The way out: the real map at the start tile now, the controls RELEASE_TICKS later, then the caller's next line. */
  function finish(run) {
    const player = run.player;
    run.finishing = true;
    run.line = null;
    if (Scenes.get(player) === run.scene) Scenes.end(player, false, { release: false });
    player.moveTo(run.home);
    Scenes.hold(player);
    TaskManager.submit(new CountdownTask(run, RELEASE_TICKS, () => release(run)));
  }

  function release(run) {
    const player = run.player;
    if (runs.get(player) !== run) return;
    restore(run);
    runs.delete(player);
    // Scenes.fade's fade in is the last step's own event, on this tick.
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
    player.getDialogueManager().reset?.();
    player.getPacketSender().sendInterfaceRemoval();
    TaskManager.submit(new CountdownTask(player, 1, () => {
      if (player.isRegistered?.() !== false) run.then?.(player);
    }));
  }

  /** Every variable the lecture set goes back, and the tabs and highlighting come back. */
  function restore(run) {
    const player = run.player;
    const sender = player.getPacketSender();
    for (const [id, value] of run.varbits) sender.sendVarbit(id, value);
    for (const [id, value] of run.varps) sender.sendConfig(id, value);
    run.varbits.clear();
    run.varps.clear();
    if (run.scene) {
      Scenes.restoreTabs(player);
      sender.sendClientScript(HIGHLIGHTING_ON_SCRIPT);
    }
  }

  /**
   * QuestScenes' onEnd for the lecture. Its own way out (finish) carries on to release; anything else (a logout, a
   * death, a forced move out) drops the lecture where it is: the player back at the start tile, the quest unchanged.
   */
  function onEnd(player, scene, logout) {
    if (scene?.name !== SCENE_NAME) return false;
    const run = runs.get(player);
    if (!run || run.finishing) return true;
    runs.delete(player);
    TaskManager.cancelTasks(run);
    restore(run);
    Scenes.closeFade(player);
    if (!logout) {
      player.moveTo(run.home);
      player.getPacketSender().sendInterfaceRemoval();
    }
    player.getMovementQueue().setBlockMovement(false);
    return true;
  }

  /** A logout before the first rebuild (the two ticks of fade on the real map) leaves nothing behind either. */
  function onLogout({ player }) {
    const run = runs.get(player);
    if (!run) return;
    runs.delete(player);
    TaskManager.cancelTasks(run);
    player.getMovementQueue().setBlockMovement(false);
  }

  const playing = (player) => runs.has(player);

  return { play, onEnd, onLogout, playing, SCENE_NAME };
};
