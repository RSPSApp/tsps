/**
 * Cabin Fever's end cutscene, as live plays it (the user's RSProx capture `CabinFever`, rev 242.1,
 * a whole run; ticks below are that recording's, counted from the third hull hole, 2124):
 *
 * - 0 and 3: Bill's two lines on the deck, held (no "Click here to continue"); the player is held.
 * - 6: the screen fades out. 9: the cutscene starts (cutscene_status, minimap off, NPC/loc/obj ops
 *   hidden, fov_clamp, draw_distance_max_override, the area-sound overrides, the side tabs closed)
 *   in a copy of The Other Inn (5 x 5 chunks from 3656,2976) with the player on 3665,2980.
 * - 12: Bill (4012, fever_cutscene_teach) on 3665,2982 and Mama (4021) on 3663,2982 face each other,
 *   the player faces Bill, and the camera sits at 3664,2979 (height 290) looking at 3664,2983
 *   (height 160), rates 232/232. 16: the fade back in.
 * - 19-169: the transcript's 23 inn lines, each held and spoken overhead in parts three ticks apart.
 *   58: the camera moves to 3668,2983 (310; rates 12/1) looking at 3664,2980 (20; rates 17/1).
 *   62-65: Mama walks four tiles south and faces west (66); Bill faces the player (67).
 *   100: "Here, have this book." hands over the Book o' Piracy (fever_given_book 1763 = 1).
 * - 175: fade out. 178: back on the real map at 3665,2980, facing west, the camera reset.
 *   183: the cutscene ends (tabs back, fade in). 186: the quest completes (varp 655 = 140 at 2310).
 *
 * The words are the transcript's ("Cabin Fever", end-of-quest-cutscene); the chathead animations
 * and the overhead split are the capture's.
 */
const { createQuestScenes } = require("../QuestScenes");
const { loadTranscripts } = require("../QuestRuntime");

const PAGE = "Cabin Fever";
const VARIANT = "end-of-quest-cutscene";
const SCENE = "cabin-fever:end";
const EXIT_ATTRIBUTE = "cabin-fever:scene-exit";

const BILL_SHIP_HEAD = 4014; // fever_quest_ship_teach
const BILL_CUTSCENE = 4012; // fever_cutscene_teach
const MAMA_CUTSCENE = 4021; // fever_cutscene_mama_la_fiette

const INN = {
  sourceChunk: [3656 >> 3, 2976 >> 3],
  size: 5,
  bounds: [[3656, 3695, 2976, 3015, 0]],
  at: [3665, 2980, 0],
  exit: [3665, 2980, 0],
  bill: [3665, 2982, 0],
  mama: [3663, 2982, 0],
  mamaTo: [3663, 2978, 0],
  mamaFaces: [3662, 2978],
  camera: { move: [3664, 2979, 290], look: [3664, 2983, 160], rates: { rate: 232, rate2: 232 } },
  pan: {
    move: [3668, 2983, 310], moveRates: { rate: 12, rate2: 1 },
    look: [3664, 2980, 20], lookRates: { rate: 17, rate2: 1 },
  },
};

/**
 * One row per transcript line, in order: the tick it shows, its chathead animation and how many
 * words of the transcript's text (split on spaces, before the player's name is put in) each
 * overhead part takes. The deck's two lines have no overhead.
 */
const LINES = [
  { t: 0, anim: 567 },
  { t: 3, anim: 567 },
  { t: 19, anim: 573, say: [5, 4, 3] },
  { t: 28, anim: 611, say: [5, 4] },
  { t: 34, anim: 591, say: [5, 4, 3, 1] },
  { t: 46, anim: 611, say: [6, 3] },
  { t: 52, anim: 592, say: [6] },
  { t: 55, anim: 588, say: [4] },
  { t: 61, anim: 605, say: [5] },
  { t: 64, anim: 588, say: [2] },
  { t: 67, anim: 589, say: [7, 1] },
  { t: 73, anim: 567, say: [1] },
  { t: 76, anim: 616, say: [5, 4, 5] },
  { t: 85, anim: 615, say: [3, 4] },
  { t: 91, anim: 594, say: [4, 5, 1] },
  { t: 100, anim: 590, say: [5, 6, 1] },
  { t: 109, anim: 593, say: [7, 3] },
  { t: 115, anim: 555, say: [8, 6] },
  { t: 121, anim: 593, say: [6, 1] },
  { t: 127, anim: 590, say: [6, 6, 4] },
  { t: 136, anim: 590, say: [4, 4, 3] },
  { t: 145, anim: 568, say: [4, 4] },
  { t: 151, anim: 569, say: [6, 6, 2] },
  { t: 160, anim: 569, say: [6, 5, 3] },
  { t: 169, anim: 568, say: [7, 6] },
];
const SAY_GAP = 3;

const T = {
  fadeOut: 6, open: 9, actors: 12, fadeIn: 16, pan: 58, mamaWalks: 62, mamaFaces: 66, billFaces: 67,
  book: 100, fadeOutEnd: 175, back: 178, release: 183, complete: 186,
};

/** Set with cutscene_status for the scene and cleared with it (capture ticks 2133, 2307). */
const SCENE_VARBITS = [["fov_clamp", 1], ["draw_distance_max_override", 1]];
const SCENE_VARPS = [["option_areasounds_override", 56], ["areasounds_override", 1]];

module.exports = function createCabinFeverScenes(api, { onBook, onFinished } = {}) {
  const { ActionDialogue, DialogueChainBuilder, NpcDialogue, PlayerDialogue } = api.core;
  const { formatPlayerText } = require("../../npcs/NpcDialogues.plugin.js");
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: EXIT_ATTRIBUTE });
  /** Players between the third hole and the quest's completion. */
  const playing = new WeakSet();

  function lines() {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[VARIANT];
    if (!Array.isArray(steps)) throw new Error(`${PAGE}: no "${VARIANT}" transcript`);
    const spoken = steps.filter((step) => step.type === "line" || typeof step.player === "string");
    if (spoken.length !== LINES.length) {
      throw new Error(`${PAGE}: "${VARIANT}" has ${spoken.length} lines, the capture ${LINES.length}`);
    }
    return spoken.map((step, index) => ({
      ...LINES[index],
      player: typeof step.player === "string",
      speaker: step.speaker,
      text: step.player ?? step.text,
    }));
  }

  function headOf(line, index) {
    if (index < 2) return BILL_SHIP_HEAD;
    return line.speaker === "Mama" ? MAMA_CUTSCENE : BILL_CUTSCENE;
  }

  /** A held chathead line: nothing to click, the next one replaces it. */
  function showLine(player, line, index) {
    const text = formatPlayerText(line.text, player);
    const entry = line.player
      ? new PlayerDialogue(0, text, line.anim)
      : new NpcDialogue(0, headOf(line, index), text, line.speaker, line.anim);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => entry.sendHeld(player) }, true)
    ));
  }

  /** The line's overhead parts, as the capture splits them. */
  function sayParts(text, words) {
    const all = String(text).split(" ");
    let start = 0;
    return words.map((count) => {
      const part = all.slice(start, start + count).join(" ");
      start += count;
      return part;
    });
  }

  function sendSceneVars(player, on) {
    const sender = player.getPacketSender();
    const cache = api.core.CacheDefinitions;
    for (const [name, value] of SCENE_VARBITS) sender.sendVarbit(cache.getVarbitId(name), on ? value : 0);
    for (const [name, value] of SCENE_VARPS) sender.sendConfig(cache.getVarpId(name), on ? value : 0);
  }

  /** Plays the scene from the third hull hole; false while it already plays. */
  function playEnd(player) {
    if (playing.has(player)) return false;
    const all = lines();
    playing.add(player);
    // Held on the deck (busy from the shot, 2123); the minimap and the cutscene wait for the inn.
    player.getMovementQueue().reset().setBlockMovement(true);
    showLine(player, all[0], 0);
    Scenes.later(player, all[1].t, () => showLine(player, all[1], 1));
    Scenes.later(player, T.fadeOut, () => Scenes.fade(player, true));
    Scenes.later(player, T.open, () => openInn(player, all));
    return true;
  }

  function openInn(player, all) {
    player.getPacketSender().sendInterfaceRemoval();
    const scene = Scenes.open(player, SCENE, INN.bounds, {}, {
      instance: { sourceChunk: INN.sourceChunk, size: INN.size }, at: INN.at, exit: INN.exit,
    });
    Scenes.controls(player, true, true);
    sendSceneVars(player, true);
    Scenes.hideTabs(player);
    const at = (t, action) => Scenes.later(scene, t - T.open, action);
    const cast = {};
    at(T.actors, () => {
      cast.bill = Scenes.actor(scene, BILL_CUTSCENE, INN.bill, INN.mama);
      cast.mama = Scenes.actor(scene, MAMA_CUTSCENE, INN.mama, INN.bill);
      Scenes.face(player, INN.bill);
      Scenes.camera(player, INN.camera.move, INN.camera.look, INN.camera.rates);
    });
    at(T.fadeIn, () => Scenes.fade(player, false));
    all.forEach((line, index) => {
      if (index < 2) return;
      at(line.t, () => showLine(player, line, index));
      sayParts(line.text, line.say).forEach((part, n) => at(line.t + n * SAY_GAP, () => {
        const speaker = line.player ? player : line.speaker === "Mama" ? cast.mama : cast.bill;
        speaker?.forceChat?.(formatPlayerText(part, player));
      }));
    });
    at(T.pan, () => Scenes.camera(player, INN.pan.move, INN.pan.look, INN.pan.moveRates, INN.pan.lookRates));
    at(T.mamaWalks, () => Scenes.walk(cast.mama, INN.mamaTo));
    at(T.mamaFaces, () => cast.mama && Scenes.face(cast.mama, INN.mamaFaces));
    at(T.billFaces, () => cast.bill && Scenes.face(cast.bill, INN.at));
    at(T.book, () => onBook?.(player));
    at(T.fadeOutEnd, () => Scenes.fade(player, true));
    at(T.back, () => leaveInn(player));
  }

  function leaveInn(player) {
    player.getPacketSender().sendInterfaceRemoval();
    Scenes.end(player, false);
    Scenes.face(player, [INN.at[0] - 1, INN.at[1]]);
    // Live keeps the player in the cutscene five more ticks behind the fade (2302-2307).
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.later(player, T.release - T.back, () => {
      player.getMovementQueue().reset().setBlockMovement(false);
      sendSceneVars(player, false);
      Scenes.restoreTabs(player);
      Scenes.fade(player, false);
    });
    Scenes.later(player, T.complete - T.back, () => finish(player));
  }

  function finish(player) {
    playing.delete(player);
    onFinished?.(player);
  }

  /** A logout in the inn finishes the quest: the player comes back at the inn (the scene's exit). */
  function sceneEnded(player, scene, logout) {
    if (scene?.name !== SCENE || !logout) return;
    sendSceneVars(player, false);
    finish(player);
  }

  /** A logout before the inn opens (or before the completion lands) leaves nothing pending. */
  function interrupted({ player }) {
    if (!player || Scenes.get(player)) return;
    playing.delete(player);
  }

  api.onPlayerLogout(interrupted);

  return { playEnd, isPlaying: (player) => playing.has(player), LINES, T };
};
