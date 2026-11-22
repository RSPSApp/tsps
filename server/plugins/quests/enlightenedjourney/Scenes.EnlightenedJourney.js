/**
 * Enlightened Journey's three scenes as the revision 242 capture plays them (rsprox local enlightened-journey;
 * docs/quests/enlightened-journey/README.md, "Scenes"). The words are the "Enlightened Journey" transcript's; each
 * scene hangs its packets on the line it comes with, and every timer starts once the player continues that line.
 *
 * - The first experiment (zep_quest 20; capture ticks 492-540): "Wonderful! I'll take that, and we'll conduct our first
 *   experiment." continued: the screen fades out; three ticks later a copy of Entrana with the player on (2808,3355),
 *   the cutscene Auguste beside them and the side tabs closed; a tick on the player sets the balloon off (zep_set_off_balloon
 *   and its spotanim), the camera frames it, the screen fades in and the test jingle plays; three ticks after that the
 *   balloon burns (zep_test_balloon_on_fire) as the camera pans. The talk carries on seven ticks later with the cutscene
 *   Auguste's head; "We're doomed." continued fades out, three ticks later zep_quest is 40, the balloon is gone and the
 *   player is back where they stood, and the screen fades in six ticks after that.
 * - The second experiment (zep_quest 40; ticks 566-606): "Commendable. If I may have those, I will construct this
 *   experiment." continued fades out; three ticks later the copy again, with four peasants south-east; the balloon goes
 *   up, the peasants walk west under it as one shouts, it burns, and 21 ticks after the copy opened zep_quest is 60, the
 *   two papyrus and the potatoes are gone and the player shrugs: "Well, that went down like a lead balloon." Its continue
 *   ends the scene as the first.
 * - The basket (zep_quest 80, twelve willow branches on the frame; ticks 1458-1482): "Great! Let me just put it all
 *   together..." continued: two ticks later zep_quest is 90, the branches are gone and the screen fades; five ticks
 *   later the balloon stands on the platform (zep_multi_basket 2), seen from above in a cutscene on the real map; the
 *   camera climbs away, then the screen fades, and the cutscene ends three ticks later.
 */
const { createQuestScenes } = require("../QuestScenes");

const SCENE_EXIT_ATTRIBUTE = "quest.enlightened_journey.scene-exit";
const RATE = (rate) => ({ rate, rate2: rate });

/** The capture's rebuild_region: Entrana's chunks from (345, 416), ground plane; a square copy covers them. */
const ENTRANA = Object.freeze({ sourceChunk: [345, 416], size: 8 });
const ENTRANA_BOUNDS = [[2760, 2823, 3328, 3391, 0]];
/** Where the player stands to set the balloons off, and the cutscene Auguste beside them (facing south-west). */
const LAUNCH = [2808, 3355, 0];
const CUTSCENE_AUGUSTE = [2809, 3355, 0];
const SOUTH_WEST_OF_AUGUSTE = [2808, 3354];
/** The basket scene's spot on the real platform. */
const BASKET_SPOT = [2808, 3354, 0];

const NPC = Object.freeze({ AUGUSTE_CUTSCENE: 4716, PEASANT_1: 4724, PEASANT_2: 4725, PEASANT_3: 4726, PEASANT_4: 4727 });
const ANIM = Object.freeze({ SET_OFF: 5142, SHRUG: 2113 });
const GFX = Object.freeze({
  FIRST_SET_OFF: 880, FIRST_ON_FIRE: 882,
  SECOND_SET_OFF: 877, SECOND_PROJECTILE: 878, SECOND_ON_FIRE: 879,
});
const SOUND = Object.freeze({ FLOAT: 3245, BURNS: 3243, THROWN: 2708 });
const TEST_JINGLE = 116; // "balloon journey test"
const VARBIT_ZEP_MULTI_BASKET = 2867;

/** The peasants' recorded spawns (all facing south) and their steps, in ticks after the copy opens (capture ticks 571-588). */
const PEASANTS = [
  { id: NPC.PEASANT_4, at: [2815, 3349], steps: [[8, 2814, 3349], [9, 2813, 3349], [10, 2812, 3349], [11, 2811, 3349], [12, 2810, 3349], [13, 2809, 3349], [14, 2808, 3349], [15, 2807, 3349], [16, 2806, 3349], [17, 2805, 3349]] },
  { id: NPC.PEASANT_3, at: [2815, 3349], steps: [[3, 2815, 3350], [4, 2815, 3351], [5, 2815, 3352], [8, 2814, 3352], [9, 2813, 3351], [10, 2812, 3351], [11, 2811, 3351], [12, 2810, 3351], [13, 2809, 3351], [14, 2808, 3351], [15, 2807, 3351], [16, 2806, 3351], [17, 2805, 3351]] },
  { id: NPC.PEASANT_2, at: [2814, 3350], steps: [[4, 2815, 3350], [5, 2815, 3351], [8, 2814, 3350], [9, 2813, 3350], [10, 2812, 3350], [11, 2811, 3350], [12, 2810, 3350], [13, 2809, 3350], [14, 2808, 3350], [15, 2807, 3350], [16, 2806, 3350], [17, 2805, 3350]] },
  { id: NPC.PEASANT_1, at: [2814, 3350], steps: [[6, 2815, 3349], [7, 2815, 3348], [8, 2814, 3348], [9, 2813, 3348], [10, 2813, 3349], [11, 2812, 3350], [12, 2811, 3350], [13, 2810, 3350], [14, 2809, 3350], [15, 2808, 3350], [16, 2807, 3350], [17, 2806, 3350]] },
];
/** Peasant 1's shouts, in ticks after the copy opens (capture ticks 578, 586, 590). */
const SHOUTS = [[7, "Burn, stab, burn!"], [15, "Destroy the floating thing!"], [19, "We are peasants against science!"]];

/**
 * Ticks from a scene line's continue to the talk carrying on (capture: "Wonderful..." continued at 495, "That was
 * perfect" at 509; "Commendable..." continued at 568, "Well, that went down..." at 592).
 */
const FIRST_PAUSE = 14;
const SECOND_PAUSE = 24;
/** From the continue that opens the copy, and the last line's continue to the real map and the fade in. */
const OPEN_AFTER = 3;
const BACK_AFTER = 3;
const FIRST_FADE_IN_AFTER = 9;
const SECOND_FADE_IN_AFTER = 7;

/** `ctx`: { setStage(player, stage), stages, onFirstDone(player), onSecondDone(player), onBasketBuilt(player) }. */
function createScenes(api, ctx) {
  const { Animation, Graphic, Location } = api.core;
  const Scenes = createQuestScenes(api, { recoveryAttribute: SCENE_EXIT_ATTRIBUTE, onEnd: sceneEnded });
  /** player -> { name, scene, back } while one of the scenes plays. */
  const playing = new Map();

  function sceneEnded(player, scene, logout) {
    const state = playing.get(player);
    if (!state || (state.scene && state.scene !== scene)) return;
    if (logout) finish(player, state);
  }

  function finish(player, state) {
    if (playing.get(player) !== state) return;
    playing.delete(player);
    Scenes.controls(player, false);
    Scenes.restoreTabs(player);
    player.getPacketSender().sendCameraReset();
  }

  const camera = (player, move, look, moveRate, lookRate = moveRate) =>
    Scenes.camera(player, move, look, RATE(moveRate), RATE(lookRate));

  /** A projectile between two source tiles, heights as the capture prints them (map_projanim_v2 is four times the packet's). */
  function projectile(player, id, from, to, { end, slope, startPos, startHeight, endHeight }) {
    const source = Scenes.tileFor(player, [from[0], from[1], 0]);
    const target = Scenes.tileFor(player, [to[0], to[1], 0]);
    player.getPacketSender().sendProjectile(source, target, 0, end, id, startHeight / 4, endHeight / 4, null, 0, slope, startPos);
  }

  function isPlaying(player) {
    return playing.has(player);
  }

  /** The copy of Entrana a test balloon goes up in: the player on the launch spot, the cutscene Auguste beside them. */
  function openCopy(player, state) {
    const at = player.getLocation();
    const exit = [at.getX(), at.getY(), at.getZ()];
    state.scene = Scenes.open(player, state.name, ENTRANA_BOUNDS, {}, { instance: ENTRANA, at: LAUNCH, exit });
    state.back = exit;
    Scenes.controls(player, true, true);
    Scenes.hideTabs(player);
    Scenes.actor(state.scene, NPC.AUGUSTE_CUTSCENE, CUTSCENE_AUGUSTE, SOUTH_WEST_OF_AUGUSTE);
  }

  /** The balloon goes up: the throw, its spotanim five cycles on, the camera, the fade in and the test jingle. */
  function setOff(player, graphic) {
    player.performAnimation(new Animation(ANIM.SET_OFF));
    player.performGraphic(Graphic.delayed(graphic, 5, 0));
    const sender = player.getPacketSender();
    sender.sendJingle(TEST_JINGLE);
    sender.sendSoundEffect(SOUND.FLOAT, 1, 5, 0);
  }

  /** A test's last line continued: fade out, the real map `BACK_AFTER` ticks later (`done` then), the fade in after. */
  function closeTest(player, state, fadeInAfter, done) {
    Scenes.fade(player, true);
    Scenes.later(player, BACK_AFTER, () => {
      if (playing.get(player) !== state) return;
      done(player);
      if (state.scene) Scenes.end(player, false, { release: false });
      if (state.back) player.moveTo(new Location(...state.back));
      finish(player, state);
      // The fade in closes its overlay three ticks on, as live does.
      Scenes.later(player, fadeInAfter - BACK_AFTER, () => Scenes.fade(player, false));
    });
  }

  // ------------------------------------------------------------------ the first experiment

  /** "Wonderful! I'll take that..." (zep_quest 20, holding the plain origami balloon). */
  function firstExperiment(request) {
    const { player } = request;
    request.pauseTicks = FIRST_PAUSE;
    request.after = () => {
      if (playing.has(player)) return;
      const state = { name: "first experiment", scene: null, back: null };
      playing.set(player, state);
      Scenes.controls(player, true);
      Scenes.fade(player, true);
      Scenes.later(player, OPEN_AFTER, () => {
        if (playing.get(player) !== state) return;
        openCopy(player, state);
        Scenes.later(state.scene, 1, () => {
          setOff(player, GFX.FIRST_SET_OFF);
          camera(player, [2810, 3358, 400], [2809, 3355, 300], 90);
          Scenes.fade(player, false);
        });
        Scenes.later(state.scene, 4, () => {
          projectile(player, GFX.FIRST_ON_FIRE, [2808, 3355], [2808, 3349], { end: 245, slope: 0, startPos: 98, startHeight: 0, endHeight: 200 });
          camera(player, [2815, 3350, 525], [2795, 3355, 350], 5, 10);
          player.getPacketSender().sendSoundEffect(SOUND.BURNS, 1, 245, 0);
        });
      });
    };
  }

  /** "We're doomed." */
  function firstExperimentEnds(request) {
    const { player } = request;
    const state = playing.get(player);
    if (!state || state.name !== "first experiment") return;
    request.after = () => closeTest(player, state, FIRST_FADE_IN_AFTER, ctx.onFirstDone);
  }

  // ------------------------------------------------------------------ the second experiment

  /** "Commendable. If I may have those, I will construct this experiment." */
  function secondExperiment(request) {
    const { player } = request;
    request.pauseTicks = SECOND_PAUSE;
    request.after = () => {
      if (playing.has(player)) return;
      const state = { name: "second experiment", scene: null, back: null };
      playing.set(player, state);
      Scenes.controls(player, true);
      Scenes.fade(player, true);
      Scenes.later(player, OPEN_AFTER, () => {
        if (playing.get(player) !== state) return;
        openCopy(player, state);
        const { scene } = state;
        const peasants = PEASANTS.map(({ id, at }) => Scenes.actor(scene, id, [at[0], at[1], 0], [at[0], at[1] - 1]));
        PEASANTS.forEach(({ steps }, index) => {
          for (const [tick, x, y] of steps) Scenes.later(scene, tick, () => Scenes.walk(peasants[index], [x, y, 0]));
        });
        const shouter = peasants[PEASANTS.findIndex(({ id }) => id === NPC.PEASANT_1)];
        for (const [tick, words] of SHOUTS) Scenes.later(scene, tick, () => shouter?.forceChat(words));
        Scenes.later(scene, 2, () => {
          camera(player, [2810, 3358, 400], [2809, 3355, 300], 90);
          Scenes.fade(player, false);
        });
        Scenes.later(scene, 4, () => setOff(player, GFX.SECOND_SET_OFF));
        Scenes.later(scene, 7, () => {
          projectile(player, GFX.SECOND_PROJECTILE, [2808, 3355], [2808, 3349], { end: 245, slope: 0, startPos: 45, startHeight: 190, endHeight: 200 });
          camera(player, [2815, 3350, 525], [2795, 3355, 350], 5, 10);
          player.getPacketSender().sendSoundEffect(SOUND.THROWN, 1, 245, 0);
        });
        Scenes.later(scene, 15, () => {
          player.getPacketSender().sendGraphic(Graphic.atHeight(GFX.SECOND_ON_FIRE, 145), Scenes.tileFor(player, [2808, 3349, 0]));
          player.getPacketSender().sendSoundEffect(SOUND.BURNS, 1, 0, 0);
        });
        Scenes.later(scene, 19, () => camera(player, [2808, 3351, 500], [2809, 3361, 150], 90));
      });
    };
  }

  /** "Well, that went down like a lead balloon.": shown as zep_quest goes to 60 and the player shrugs. */
  function secondExperimentEnds(request) {
    const { player } = request;
    const state = playing.get(player);
    if (!state || state.name !== "second experiment") return;
    request.before = () => {
      if (playing.get(player) !== state) return;
      ctx.onSecondDone(player);
      player.performAnimation(new Animation(ANIM.SHRUG));
    };
    request.after = () => closeTest(player, state, SECOND_FADE_IN_AFTER, () => {});
  }

  // ------------------------------------------------------------------ the basket

  /** "Great! Let me just put it all together..." (zep_quest 80, twelve willow branches on the frame). */
  function basket(request) {
    const { player } = request;
    request.after = () => {
      if (playing.has(player)) return;
      const state = { name: "basket", scene: null, back: null };
      playing.set(player, state);
      Scenes.controls(player, true);
      Scenes.later(player, 2, () => {
        if (playing.get(player) !== state) return;
        if (!ctx.onBasketBuilt(player)) return finish(player, state);
        Scenes.fade(player, true);
      });
      Scenes.later(player, 7, () => {
        if (playing.get(player) !== state) return;
        player.getPacketSender().sendVarbit(VARBIT_ZEP_MULTI_BASKET, 2);
        Scenes.controls(player, true, true);
        Scenes.hideTabs(player);
        player.moveTo(new Location(...BASKET_SPOT));
        camera(player, [2801, 3352, 1050], [2809, 3357, 200], 90);
        Scenes.fade(player, false);
      });
      Scenes.later(player, 10, () => {
        if (playing.get(player) !== state) return;
        player.getPacketSender().sendJingle(TEST_JINGLE);
        camera(player, [2791, 3348, 1950], [2809, 3357, 400], 5, 10);
      });
      Scenes.later(player, 16, () => {
        if (playing.get(player) !== state) return;
        Scenes.fade(player, true);
      });
      Scenes.later(player, 19, () => {
        if (playing.get(player) !== state) return;
        finish(player, state);
        Scenes.fade(player, false);
      });
    };
  }

  /**
   * Escape (or any close) while a scene plays keeps its conversation: the scene's way back hangs on its last line, so a
   * dropped chat would leave the player held in the copy. Ours: no recording presses Escape in these scenes.
   */
  function keepChat(event) {
    if (playing.has(event.player)) event.handled = true;
  }
  api.onCustomEvent("interface:close", keepChat);

  /** A logout while the basket scene plays on the real map: its stage was already saved, the controls come back. */
  function logout(player) {
    const state = playing.get(player);
    if (state && !state.scene) finish(player, state);
  }

  return { isPlaying, firstExperiment, firstExperimentEnds, secondExperiment, secondExperimentEnds, basket, logout, Scenes };
}

module.exports = { createScenes, NPC };
