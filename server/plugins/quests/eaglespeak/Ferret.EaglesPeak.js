/**
 * The ferret lesson at the camp-site, as the capture plays it (RSProx, rev 243, t2204-2259; real ticks). Live plays it
 * in a copy of the camp (rebuild_region); so does this:
 * - "Come with me and I'll show you." continued: the screen fades out (948 [0,255,0,0,15]); a tick on, the copy,
 *   cutscene_status, the minimap off, the side tabs shut and menus hidden, the player at 2319,3510 facing the box
 *   trap (9380, 2314,3511), Nickolaus crouched (1483) at 2319,3511, the camera over the trap and the fade back
 *   ([0,0,0,255,50]); two ticks on the camera turns to 2317,3511. The talk carries on in the copy.
 * - "Shhh, here comes something." continued: a ferret (1505) comes out at 2311,3511 with the camera on it, walks
 *   two tiles to the trap, plays hunting_ferret_approaching, goes in (9397 and hunting_boxtrap) and the trap
 *   shuts on it (9384 and chinchompa_trapped), then "Ha ha, there you go!" (t2224-2234).
 * - "Ha ha..." continued: the player walks to 2314,3510, faces the trap and dismantles it (hunting_setting_trap_small);
 *   two ticks on the stage is 35 with "You dismantle the trap.", the trap gone, the box trap and ferret given and
 *   hunting_dismantle; three ticks later the scene ends at 2314,3510 and five ticks after that "See, it's all just
 *   a matter of patience." (t2239-2255).
 * Not sent (no shared helper here yet): the capture's fov_clamp, area-sound and draw-distance overrides.
 */
module.exports = function attachEaglesPeakFerret(api, ep) {
  const { state, TEXT, Scenes } = ep;
  const { STAGE, ITEM, NPC } = state;
  const { Item, Location } = api.core;

  const SCENE = "eagles-peak-ferret";
  const CAMP = Object.freeze({
    instance: { sourceChunk: [2296 >> 3, 3488 >> 3], size: 13 },
    bounds: [[2296, 2399, 3488, 3591, 0]],
    at: [2319, 3510, 0],
    exit: [2314, 3510, 0],
  });
  const TRAP = Object.freeze({ EMPTY: 9380, TRAPPING: 9397, FULL: 9384, x: 2314, y: 3511 });
  const SEQ = Object.freeze({ FERRET_APPROACH: 5191, DISMANTLE: 5212 });
  const SOUND = Object.freeze({ BOX_TRAP: 2627, TRAPPED: 362, DISMANTLE: 2632 });

  const LINES = Object.freeze({
    COME_WITH_ME: "Come with me and I'll show you.",
    HERE_COMES: "Shhh, here comes something.",
    GOT_ONE: "Ha ha, there you go! One gift-wrapped ferret ready for delivery.",
  });
  /** The transcript's narration steps, played by the scene instead. */
  const NARRATION = new Set(["HkXWU8", "OjrdFa", "w-9QTz"]);
  /** Ticks each pause holds the talk: to the next line in the capture (t2204 -> 2213, 2223 -> 2234, 2238 -> 2255). */
  const PAUSE = Object.freeze({ START: 9, FERRET: 11, FINISH: 17 });

  const inScene = (player) => Scenes.get(player)?.name === SCENE;

  function sceneLoc(scene, id) {
    if (scene.trap) {
      api.core.ObjectManager.deregister(scene.trap, true);
      const at = scene.locs.indexOf(scene.trap);
      if (at >= 0) scene.locs.splice(at, 1);
    }
    scene.trap = id === null ? null : Scenes.loc(scene, { id, x: TRAP.x, y: TRAP.y, z: 0, type: 10, face: 0 });
  }

  function start(player) {
    if (state.stage(player) < STAGE.DISGUISE_GIVEN || state.stage(player) >= STAGE.FERRET_CAUGHT) return;
    Scenes.fade(player, true, 15);
    ep.later(player, 1, () => {
      const scene = Scenes.open(player, SCENE, CAMP.bounds, { canTeleport: () => false },
        { instance: CAMP.instance, at: CAMP.at, exit: CAMP.exit });
      Scenes.controls(player, true, true);
      Scenes.hideTabs(player);
      Scenes.actor(scene, NPC.NICKOLAUS_CRAWL, [2319, 3511, 0], [TRAP.x, TRAP.y]);
      Scenes.face(player, [TRAP.x, TRAP.y]);
      sceneLoc(scene, TRAP.EMPTY);
      Scenes.camera(player, [2313, 3506, 400], [TRAP.x, TRAP.y, 25], { rate: 0, rate2: 100 });
      Scenes.fade(player, false, 50);
      watch(player, scene);
      Scenes.later(scene, 2, () => {
        const look = Scenes.tileFor(scene, [2317, 3511, 0]);
        player.getPacketSender().sendCameraLookAt(look.getX(), look.getY(), 25, { rate: 1, rate2: 15 });
      });
    });
  }

  /**
   * The lesson's talk is what moves the scene on. Closed early (Escape, another interface), nothing would: the scene ends
   * there and gives the player back the camp, nothing given, and the lesson can be asked for again (Ours: the capture
   * played it through).
   */
  function watch(player, scene) {
    Scenes.later(scene, 1, () => {
      if (!inScene(player) || scene.finishing) return;
      if (!Scenes.chatOpen(player)) {
        abort(player);
        return;
      }
      watch(player, scene);
    });
  }

  function abort(player) {
    Scenes.end(player, false);
    player.moveTo(new Location(...CAMP.exit));
    Scenes.restoreTabs(player);
    Scenes.closeFade(player);
  }

  function ferretComes(player) {
    const scene = Scenes.get(player);
    if (!inScene(player)) return;
    Scenes.later(scene, 1, () => {
      scene.ferret = Scenes.actor(scene, NPC.FERRET, [2311, 3511, 0], [2312, 3511]);
      Scenes.camera(player, [2310, 3515, 425], [2312, 3513, 300], { rate: 0, rate2: 100 });
      Scenes.walk(scene.ferret, [2313, 3511, 0]);
    });
    Scenes.later(scene, 7, () => ep.animate(scene.ferret, SEQ.FERRET_APPROACH));
    Scenes.later(scene, 8, () => {
      if (scene.ferret) Scenes.removeActor(scene, scene.ferret);
      sceneLoc(scene, TRAP.TRAPPING);
      areaSound(player, scene, SOUND.BOX_TRAP);
    });
    Scenes.later(scene, 10, () => {
      sceneLoc(scene, TRAP.FULL);
      areaSound(player, scene, SOUND.TRAPPED);
    });
  }

  function areaSound(player, scene, id) {
    const at = Scenes.tileFor(scene, [TRAP.x, TRAP.y, 0]);
    player.getPacketSender().sendAreaSound(id, at.getX(), at.getY(), 0, 1, 0, 5);
  }

  function finish(player) {
    const scene = Scenes.get(player);
    if (!inScene(player)) return;
    scene.finishing = true;
    Scenes.walk(player, [2314, 3510, 0]);
    Scenes.later(scene, 6, () => {
      Scenes.face(player, [TRAP.x, TRAP.y]);
      ep.animate(player, SEQ.DISMANTLE);
    });
    Scenes.later(scene, 8, () => {
      if (state.stage(player) < STAGE.FERRET_CAUGHT) state.setStage(player, STAGE.FERRET_CAUGHT);
      player.sendMessage(TEXT.TRAP_DISMANTLED);
      sceneLoc(scene, null);
      const inventory = player.getInventory();
      inventory.forceAdd(player, new Item(ITEM.BOX_TRAP, 1));
      inventory.forceAdd(player, new Item(ITEM.FERRET, 1));
      ep.sound(player, SOUND.DISMANTLE);
    });
    Scenes.later(scene, 11, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(...CAMP.exit));
      Scenes.restoreTabs(player);
    });
    ep.later(player, 16, () => player.getPacketSender().sendCameraReset());
  }

  function handleLine(request) {
    const { player, text } = request;
    if (request.playing?.variant !== "saving-nickolaus-talking-to-nickolaus-by-the-camp") return;
    if (text === LINES.COME_WITH_ME) {
      request.after = () => start(player);
      request.pauseTicks = PAUSE.START;
      return;
    }
    if (text === LINES.HERE_COMES && inScene(player)) {
      request.after = () => ferretComes(player);
      request.pauseTicks = PAUSE.FERRET;
      return;
    }
    if (text === LINES.GOT_ONE && inScene(player)) {
      request.after = () => finish(player);
      request.pauseTicks = PAUSE.FINISH;
    }
  }

  function handleAction(event) {
    if (!NARRATION.has(event.stepId)) return;
    event.handled = true;
  }

  /** Out of the copy early (a logout, a death): the lesson is played again from its start; nothing was given yet. */
  function ended(player, scene, logout) {
    if (scene.name !== SCENE) return;
    if (!logout) Scenes.closeFade(player);
  }

  ep.sceneEnds.set(SCENE, ended);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);

  return { SCENE, CAMP };
};
