/**
 * Making History's opening cutscene: the camera tour of the outpost that plays after Jorral's
 * "That's what I like to hear. Let me tell you about the outpost...", as live plays it (RSProx
 * capture 20261111T015053-5ab63b4, rev 242, ticks 30-87). Ticks below count from the continue
 * past that line (capture tick 30).
 *
 * - 0: the chat closes and the screen fades out (fade_overlay 174, script 948 [0, 255, 0, 0, 50]).
 * - 2: the cutscene starts: cutscene_status, the hidden ops, minimap_state 2, fov_clamp,
 *   draw_distance_max_override and the area-sound overrides; the side tabs close (combat, stats,
 *   journal, inventory, worn, prayer, magic, settings, emotes); the song goes silent and the
 *   "outpost cutscene" jingle (141) plays; the camera jumps north of the outpost.
 * - 4, 14, 24, 34, 48: a caption in the fade overlay; 12, 22, 32, 42, 54: the caption clears. The
 *   first caption fades the screen in ([0, 0, 0, 255, 30]), the others show at once. The camera
 *   pans at 4, 14, 24, 34 and 44.
 * - 0-57: an empty message box the player cannot continue holds the chat.
 * - 54: the screen fades out again; 57: the cutscene ends, the camera resets, the tabs come back,
 *   the screen fades in and Jorral asks "If all goes well..." (the area's song returns).
 *
 * The captions are the transcript's Narration lines (the steps between the cutscene action and
 * Jorral's next line), so the words stay the transcript's.
 */
const { createQuestScenes } = require("../QuestScenes");

const FADE_UID = (161 << 16) | 1;
const FADE_INTERFACE = 174;
const FADE_MESSAGE = (174 << 16) | 4;
const FADE_SCRIPT = 948;
const FADE_OUT = [0, 255, 0, 0, 50];
const CAPTION_FADE_IN = [0, 0, 0, 255, 30];
const CLEAR = [0, 255, 0, 255, 0];

const SILENCE_TRACK = 147;
const OUTPOST_JINGLE = 141; // "outpost cutscene"
const SCENE_VARBITS = [["fov_clamp", 1], ["draw_distance_max_override", 1]];
const SCENE_VARPS = [["option_areasounds_override", 30], ["areasounds_override", 1]];

const TOPLEVEL = 161;
const COMBAT_TAB = [76, 593];
const MAGIC_TAB = 82;
const TABS = [[77, 320], [78, 629], [79, 149], [80, 387], [81, 541], [87, 116], [88, 216]];

const FAST = { rate: 100, rate2: 100 };
const SLOW = { rate: 5, rate2: 5 };

const START_TICK = 2;
const END_TICK = 57;
/** [tick, caption index]; a caption stays until the clear tick after it. */
const CAPTIONS = [[4, 0], [14, 1], [24, 2], [34, 3], [48, 4]];
const CLEARS = [12, 22, 32, 42];
const LAST_FADE_TICK = 54;
/** [tick, camera]: a moveto ([x, y, height]) and an optional lookat. */
const CAMERA = [
  [START_TICK, { move: [2432, 3380, 1000], look: [2436, 3346, 500], rates: FAST }],
  [4, { move: [2432, 3361, 1000], rates: SLOW }],
  [14, { move: [2445, 3361, 1000], rates: SLOW }],
  [24, { move: [2445, 3330, 1000], rates: SLOW }],
  [34, { move: [2432, 3330, 1000], rates: SLOW }],
  [44, { look: [2438, 3350, 525], move: [2435, 3347, 800], rates: SLOW }],
];

module.exports = function createMakingHistoryCutscene(api, { onEnd }) {
  const Scenes = createQuestScenes(api);
  const playing = new Map();

  /** Live re-opens the overlay with its caption each time, then runs the fade (script 948). */
  function sendFade(player, args, text = "") {
    const sender = player.getPacketSender();
    sender.mountSubInterface(FADE_UID, FADE_INTERFACE, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
    sender.sendString(text, FADE_MESSAGE);
  }

  function sendSceneVars(player, on) {
    const sender = player.getPacketSender();
    const cache = api.core.CacheDefinitions;
    for (const [name, value] of SCENE_VARBITS) sender.sendVarbit(cache.getVarbitId(name), on ? value : 0);
    for (const [name, value] of SCENE_VARPS) sender.sendConfig(cache.getVarpId(name), on ? value : 0);
  }

  function hideTabs(player) {
    const sender = player.getPacketSender();
    for (const slot of [COMBAT_TAB[0], MAGIC_TAB, ...TABS.map(([tab]) => tab)]) sender.closeSubInterface((TOPLEVEL << 16) | slot);
  }

  /** Each tab goes back with its login setup, so its ops work again (see Scenes.ValeTotems). */
  function restoreTabs(player) {
    const sender = player.getPacketSender();
    const spellbook = player.getSpellbook().getInterfaceId();
    sender.sendTabInterface(0, COMBAT_TAB[1]).sendGameframeTabSetup(COMBAT_TAB[1]);
    sender.sendTabInterface(6, spellbook).sendGameframeTabSetup(spellbook);
    for (const [slot, group] of TABS) sender.sendTabInterface(slot, group).sendGameframeTabSetup(group);
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
  }

  function camera(player, { move, look, rates }) {
    const sender = player.getPacketSender();
    if (move) sender.sendCameraMoveTo(move[0], move[1], move[2], rates);
    if (look) sender.sendCameraLookAt(look[0], look[1], look[2], rates);
  }

  function areaSong(player) {
    const at = player.getLocation();
    const track = api.core.Music?.areaTrackAt?.(at.getX(), at.getY(), at.getZ());
    if (Number.isInteger(track)) player.getPacketSender().sendSong(track);
  }

  function live(player, state) {
    return playing.get(player) === state && player.isRegistered?.() !== false;
  }

  function at(player, state, tick, action) {
    if (tick === 0) {
      action();
      return;
    }
    Scenes.later(player, tick, () => {
      if (live(player, state)) action();
    });
  }

  /** Plays the scene with these captions; `onEnd(player)` carries the conversation on. */
  function play(player, captions) {
    if (playing.has(player)) return false;
    const state = {};
    playing.set(player, state);
    player.getMovementQueue().reset().setBlockMovement(true);
    // An empty message box the player cannot continue holds the chat through the scene (tick 30).
    Scenes.hold(player);
    at(player, state, 0, () => sendFade(player, FADE_OUT));
    at(player, state, START_TICK, () => {
      Scenes.controls(player, true, true);
      sendSceneVars(player, true);
      hideTabs(player);
      player.getPacketSender().sendSong(SILENCE_TRACK).sendJingle(OUTPOST_JINGLE, 0);
    });
    for (const [tick, view] of CAMERA) at(player, state, tick, () => camera(player, view));
    CAPTIONS.forEach(([tick, index], order) => at(player, state, tick, () =>
      sendFade(player, order === 0 ? CAPTION_FADE_IN : CLEAR, String(captions[index] ?? ""))));
    for (const tick of CLEARS) at(player, state, tick, () => sendFade(player, CLEAR));
    at(player, state, LAST_FADE_TICK, () => sendFade(player, FADE_OUT));
    at(player, state, END_TICK, () => finish(player, false));
    return true;
  }

  function finish(player, logout) {
    if (!playing.has(player)) return;
    playing.delete(player);
    Scenes.cancel(player);
    if (logout) return;
    sendSceneVars(player, false);
    Scenes.controls(player, false);
    player.getPacketSender().sendCameraReset();
    restoreTabs(player);
    // Ours: the overlay closes 3 ticks after this fade in; live keeps it until the talk ends (tick 98).
    Scenes.fade(player, false);
    areaSong(player);
    onEnd?.(player);
  }

  function active(player) {
    return playing.has(player);
  }

  return { play, active, end: finish };
};
