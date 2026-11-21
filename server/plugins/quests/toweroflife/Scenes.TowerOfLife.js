/**
 * Tower of Life's scenes as the revision 242 capture plays them (TowerOfLife.bin; docs/quests/tower-of-life/README.md,
 * "Scenes"). The words are the "Tower of Life" transcript's; each scene hangs its packets on the lines they come with.
 *
 * - Off to the top (Effigy at tol_prog 8, all three machines working; tick 2645): on the player's "Wait! What about-"
 *   the chat closes as the screen fades (15 cycles); two ticks later tol_prog is 10 (the alchemists vanish), the
 *   screen fades back in and the player's "Why does nobody listen?" line plays.
 * - The creation (the ladder up to the top floor at tol_prog 10; tick 2712): the climb (828) and a fade out; five
 *   ticks later a copy of the tower with the player on (2648,3221,3), the side tabs closed and the three alchemists'
 *   still forms at their places; the camera at +1, the fade in and a pan at +6, +11 and +16, the talk at +21. The
 *   Homunculus is summoned after "It begins!", breaks the cage on "Arghhh!", and the screen fades on "Flee for your
 *   lives!"; three ticks later the player is back on (2648,3221,2), and two after that tol_prog is 11 with the tabs
 *   back, the fade in and the player's last line.
 * - The scare (Effigy at tol_prog 16; tick 3361): a cutscene on the ground floor: the tabs close and the camera
 *   frames Effigy as the talk starts; the Homunculus appears (tol_homonc_pres) with its "Boo."; after its last line
 *   the screen fades, and three ticks later tol_prog is 17, it is gone, and the tabs and camera come back.
 */
const { createQuestScenes } = require("../QuestScenes");

const SCENE_EXIT_ATTRIBUTE = "tower-of-life:scene-exit";
const RATE = (rate) => ({ rate, rate2: rate });

/** The capture's rebuild_region (zone 1602,1282): 13 x 13 chunks from chunk (325,396), every plane. */
const TOWER = Object.freeze({ sourceChunk: [325, 396], size: 13 });
const TOP_FLOOR_BOUNDS = [[2636, 2662, 3205, 3235, 3]];
const TOP_FLOOR_ARRIVAL = [2648, 3221, 3];
const TOP_FLOOR_EXIT = [2648, 3221, 2];

const NPC = Object.freeze({
  EFFIGY_STILL: 3586, // tol_npc_efergy01_still
  TRANSMUTE_STILL: 3593, // tol_npc_mage01_still
  CURRENCY_STILL: 3595, // tol_npc_mage02_still
  HOMUNCULUS: 3589, // tol_homonculus
});
const STILL_ACTORS = [
  [NPC.EFFIGY_STILL, [2652, 3217, 3], [2651, 3217]], // facing west
  [NPC.TRANSMUTE_STILL, [2647, 3215, 3], [2648, 3216]], // north-east
  [NPC.CURRENCY_STILL, [2650, 3215, 3], [2650, 3216]], // north
];
const SUMMON_TILES = [[2649, 3216], [2649, 3220], [2651, 3218], [2651, 3220], [2651, 3216], [2647, 3218], [2647, 3216], [2647, 3220]];
const BLAST_WAVES = [
  [2, [[2651, 3221], [2651, 3216], [2647, 3219]]],
  [5, [[2649, 3221], [2651, 3219], [2646, 3216]]],
  [8, [[2648, 3216], [2652, 3218], [2647, 3217]]],
  [11, [[2648, 3220], [2650, 3220], [2650, 3215]]],
  [14, [[2652, 3220], [2647, 3220]]],
];

const ANIM = Object.freeze({ CLIMB: 828, PUSH_MAGIC: 4411, SUMMON: 5833, BREAK: 5834 });
const GFX = Object.freeze({ ENERGY: 736, MAGIC: 1026 });
const SOUND = Object.freeze({ APPEAR: 3422, CRY: 3424, EXPLOSIONS: 3428, BREAK_CAGE: 3418, BOO: 3423 });
const VARBIT_CAGE_STATE = 3354; // tol_cage_state
const VARBIT_HOMONC_PRES = 3359; // tol_homonc_pres
const CREATION_VARIANT = "finished-work-going-to-the-top-of-the-tower";

/** `ctx`: { setStage(player, stage), sendVarbit(player, id, value), startTranscript(player, npcId, variant) }. */
function createScenes(api, ctx) {
  const { Animation, Graphic, Location } = api.core;
  const Scenes = createQuestScenes(api, { recoveryAttribute: SCENE_EXIT_ATTRIBUTE, onEnd: sceneEnded });
  const playing = new Map();

  function sceneEnded(player, scene, logout) {
    const state = playing.get(player);
    if (!state || (state.scene && state.scene !== scene)) return;
    if (logout) {
      playing.delete(player);
      Scenes.controls(player, false);
    }
  }

  const camera = (player, [mx, my, mh], [lx, ly, lh], rate) => Scenes.camera(player, [mx, my, mh], [lx, ly, lh], RATE(rate));
  const cameraMove = (player, [x, y, h], rate) => {
    const at = Scenes.tileFor(player, [x, y, 0]);
    player.getPacketSender().sendCameraMoveTo(at.getX(), at.getY(), h, RATE(rate));
  };
  const cameraLook = (player, [x, y, h], rate) => {
    const at = Scenes.tileFor(player, [x, y, 0]);
    player.getPacketSender().sendCameraLookAt(at.getX(), at.getY(), h, RATE(rate));
  };

  function energy(player, tiles, height) {
    for (const [x, y] of tiles) {
      const at = Scenes.tileFor(player, [x, y, 3]);
      player.getPacketSender().sendGraphic(new Graphic(GFX.ENERGY, 0, height), at);
    }
  }

  function endPlaying(player) {
    playing.delete(player);
    Scenes.controls(player, false);
    Scenes.restoreTabs(player);
    player.getPacketSender().sendCameraReset();
  }

  // ------------------------------------------------------------------ Effigy sends the alchemists up

  /** "Wait! What about-": the fade, tol_prog 10 two ticks on, then the player's last line. */
  function toTheTop(request) {
    const { player } = request;
    request.after = () => Scenes.fade(player, true, 15);
    request.pauseTicks = 2;
    Scenes.later(player, 2, () => {
      ctx.setStage(player, 10);
      Scenes.fade(player, false);
    });
  }

  // ------------------------------------------------------------------ the creation

  function isPlaying(player) {
    return playing.has(player);
  }

  /** The ladder to the top floor at tol_prog 10. */
  function creation(player) {
    if (playing.has(player)) return;
    const state = { name: "creation", scene: null, actors: {} };
    playing.set(player, state);
    Scenes.controls(player, true);
    player.performAnimation(new Animation(ANIM.CLIMB));
    Scenes.fade(player, true);
    Scenes.later(player, 5, () => {
      if (playing.get(player) !== state) return;
      state.scene = Scenes.open(player, "creation", TOP_FLOOR_BOUNDS, {}, { instance: TOWER, at: TOP_FLOOR_ARRIVAL, exit: TOP_FLOOR_EXIT });
      Scenes.controls(player, true, true);
      Scenes.hideTabs(player);
      for (const [id, tile, face] of STILL_ACTORS) state.actors[id] = Scenes.actor(state.scene, id, tile, face);
      Scenes.later(state.scene, 1, () => camera(player, [2632, 3231, 1450], [2651, 3219, 300], 100));
      Scenes.later(state.scene, 6, () => {
        Scenes.fade(player, false);
        cameraMove(player, [2663, 3231, 1450], 4);
      });
      Scenes.later(state.scene, 11, () => cameraMove(player, [2663, 3207, 1450], 4));
      Scenes.later(state.scene, 16, () => cameraMove(player, [2647, 3207, 1450], 4));
      Scenes.later(state.scene, 21, () => {
        camera(player, [2642, 3211, 1275], [2650, 3218, 25], 4);
        ctx.startTranscript(player, NPC.EFFIGY_STILL, CREATION_VARIANT);
      });
    });
  }

  function summon(player, state) {
    for (const id of [NPC.EFFIGY_STILL, NPC.TRANSMUTE_STILL, NPC.CURRENCY_STILL]) {
      state.actors[id]?.performAnimation(new Animation(ANIM.PUSH_MAGIC));
    }
    Scenes.later(state.scene, 3, () => {
      energy(player, SUMMON_TILES, 126);
      player.getPacketSender().sendSound(SOUND.APPEAR, 1, 0);
    });
    Scenes.later(state.scene, 7, () => {
      state.homunculus = Scenes.actor(state.scene, NPC.HOMUNCULUS, [2648, 3217, 3], [2648, 3216]);
      state.homunculus?.performAnimation(new Animation(ANIM.SUMMON));
      cameraMove(player, [2642, 3218, 1275], 1);
    });
  }

  function blast(player, state) {
    state.homunculus?.performGraphic(new Graphic(GFX.MAGIC, 0, 102));
    state.homunculus?.performAnimation(new Animation(ANIM.BREAK));
    player.getPacketSender().sendSound(SOUND.EXPLOSIONS, 1, 0).sendSound(SOUND.BREAK_CAGE, 1, 0);
    for (const [ticks, tiles] of BLAST_WAVES) Scenes.later(state.scene, ticks, () => energy(player, tiles, 80));
  }

  /** "Flee for your lives!": the fade, out of the copy three ticks on, tol_prog 11 and the tabs two after. */
  function flee(request, state) {
    const { player } = request;
    player.getPacketSender().sendSound(SOUND.EXPLOSIONS, 1, 0);
    request.after = () => Scenes.fade(player, true);
    request.pauseTicks = 5;
    Scenes.later(player, 3, () => {
      Scenes.end(player, false);
      Scenes.place(player, [...TOP_FLOOR_EXIT]);
      Scenes.controls(player, true, true);
    });
    Scenes.later(player, 5, () => {
      if (playing.get(player) !== state) return;
      ctx.setStage(player, 11);
      endPlaying(player);
      Scenes.fade(player, false);
    });
  }

  /** The creation's packets, on the lines they come with. */
  function creationLine(request, state) {
    const { player } = request;
    const text = String(request.text ?? "");
    if (text.startsWith("It begins!")) {
      request.after = () => summon(player, state);
      request.pauseTicks = 12;
    } else if (text === "It's alive!") {
      camera(player, [2649, 3224, 1275], [2649, 3218, 25], 1);
    } else if (text.startsWith("Nwwooo!") || text.startsWith("Where me?") || text.startsWith("Whyeee cage?")) {
      player.getPacketSender().sendSound(SOUND.CRY, 1, 0);
      if (text.startsWith("Nwwooo!")) request.actors = state.homunculus ? [state.homunculus] : request.actors;
    } else if (text.startsWith("This is terrible")) {
      cameraMove(player, [2654, 3218, 1275], 1);
    } else if (text === "Silence, creature!") {
      cameraMove(player, [2646, 3213, 1275], 1);
    } else if (text.startsWith("Stop this!")) {
      cameraMove(player, [2645, 3222, 1275], 1);
    } else if (text === "Arghhh!") {
      camera(player, [2653, 3222, 975], [2649, 3218, 150], 1);
    } else if (text === "Oh no...") {
      blast(player, state);
    } else if (text.startsWith("Get out of the tower")) {
      cameraMove(player, [2644, 3222, 975], 1);
      player.getPacketSender().sendSound(SOUND.EXPLOSIONS, 1, 0);
    } else if (text === "Run away!") {
      ctx.sendVarbit(player, VARBIT_CAGE_STATE, 0);
      player.getPacketSender().sendSound(SOUND.EXPLOSIONS, 1, 0);
    } else if (text === "Flee for your lives!") {
      flee(request, state);
    }
  }

  // ------------------------------------------------------------------ the scare

  /** Effigy at tol_prog 16: the talk plays as a cutscene on the ground floor. */
  function scare(player) {
    if (playing.has(player)) return false;
    playing.set(player, { name: "scare", scene: null });
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    camera(player, [2641, 3213, 650], [2639, 3220, 25], 100);
    return true;
  }

  function scareLine(request) {
    const { player } = request;
    const text = String(request.text ?? "");
    if (text === "Boo.") {
      ctx.sendVarbit(player, VARBIT_HOMONC_PRES, 1);
      player.getPacketSender().sendSound(SOUND.BOO, 1, 0);
    } else if (text.startsWith("Me look dungeon")) {
      request.after = () => Scenes.fade(player, true);
      request.pauseTicks = 3;
      Scenes.later(player, 3, () => {
        ctx.setStage(player, 17);
        ctx.sendVarbit(player, VARBIT_HOMONC_PRES, 0);
        endPlaying(player);
        Scenes.fade(player, false);
      });
    }
  }

  /** Lines of the scene the player is in; false when none is playing. */
  function handleLine(request) {
    const state = playing.get(request.player);
    if (!state) return false;
    if (state.name === "creation" && state.scene) creationLine(request, state);
    else if (state.name === "scare") scareLine(request);
    return true;
  }

  /** A logout mid-scene leaves no cutscene state behind (the copy's own exit handles the tile). */
  function logout(player) {
    if (!playing.has(player)) return;
    Scenes.cancel(player);
    if (Scenes.get(player)) Scenes.end(player, true);
    playing.delete(player);
  }

  return { toTheTop, creation, scare, handleLine, isPlaying, logout, Location };
}

module.exports = { createScenes, SCENE_EXIT_ATTRIBUTE, TOP_FLOOR_EXIT };
