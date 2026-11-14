"use strict";

/**
 * Karuulm Slayer Dungeon's Mysterious pipe (88 Agility, no XP; Wiki: Mysterious pipe), from rsprox
 * captures 1521, 2952 and 4001 (rev 224-237, all west to east). Ticks from the player's arrival on
 * 1316,10213, south of the pipe at 1316,10214:
 *   +1 faces the pipe;
 *   +2 reach animation 833 (delay 10), BUSY on, the screen fades out (948, 0 to 255 over 50 cycles)
 *      and the first message box opens without "Click here to continue";
 *   +3 the minimap goes off (6719 = 2) and the second box replaces it, also without a continue;
 *   +5 the player is on 1346,10232 facing north as before, the minimap back on;
 *   +6 the screen fades in and the last box opens with "Click here to continue".
 * Continuing closes the box and the fade overlay and clears BUSY on the same tick (4001 +8, 2952 +9).
 * Ours: the east end (1346,10231, the player on 1346,10232) back west mirrors it, landing on
 * 1316,10213; it was not recorded. Walking away from the last box clears the same things.
 */
const ENDS = [
  { pipe: [1316, 10214], stand: [1316, 10213, 0], facing: "north" },
  { pipe: [1346, 10231], stand: [1346, 10232, 0], facing: "south" },
];
const MESSAGES = [
  "You start the mediocre lengthed journey of clambering into the pipe...",
  "You push your body down further into the pipe...",
  "You see light from above, and start to climb upwards and out of the pipe system.",
];
const REACH_ANIMATION = 833; // human_reachforladdertop
const BUSY_VARBIT = 12393;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MESSAGE_BOX = 229;
/** Set while the last message box is up: its close ends the crossing. */
const CLIMBING_OUT_ATTRIBUTE = "agility:karuulm-pipe-out";

let core = null;

function init(api) {
  core = api.core;
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/** The last box's close, by its continue or by walking away: the overlay goes and BUSY clears. */
function climbedOut(player) {
  if (player.getAttribute(CLIMBING_OUT_ATTRIBUTE) !== true) return;
  player.setAttribute(CLIMBING_OUT_ATTRIBUTE, null);
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

/** "interface:closed": the message box closing after the climb out. */
function boxClosed({ player, interfaceId }) {
  if (interfaceId === MESSAGE_BOX) climbedOut(player);
}

function lastBox(player) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.setAttribute(CLIMBING_OUT_ATTRIBUTE, true);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, MESSAGES[2])));
}

function endOf(obj) {
  return ENDS.find(({ pipe }) => pipe[0] === obj.x && pipe[1] === obj.y) ?? ENDS[0];
}

/** The pipe's script (agility-shortcuts.json "karuulmPipe"): tick 0 here is capture tick +1. */
function karuulmPipe() {
  return {
    route: ({ obj }) => endOf(obj).stand,
    steps: ({ obj }) => {
      const from = endOf(obj);
      const to = ENDS.find((end) => end !== from);
      return [
        { face: from.pipe },
        { wait: 1 },
        { anim: REACH_ANIMATION, delay: 10 },
        { varbit: [BUSY_VARBIT, 1] },
        { run: ({ player }) => { fade(player, true); core.StatementDialogue.send(player, MESSAGES[0], false); } },
        { wait: 1 },
        { varbit: [MINIMAP_STATE_VARBIT, MINIMAP_OFF] },
        { run: ({ player }) => core.StatementDialogue.send(player, MESSAGES[1], false) },
        { wait: 2 },
        { varbit: [MINIMAP_STATE_VARBIT, 0] },
        { tele: to.stand },
        { faceDir: from.facing },
        { wait: 1 },
        { run: ({ player }) => { fade(player, false); lastBox(player); } },
      ];
    },
  };
}

module.exports = { init, boxClosed, karuulmPipe, CLIMBING_OUT_ATTRIBUTE, MESSAGES };
