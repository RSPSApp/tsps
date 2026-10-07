/**
 * Wyrmscraig: what the units share - the plugin api, the data from
 * data/definitions/wyrmscraig.json, tick timing and the captured fade between places.
 */
const fs = require("fs");
const path = require("path");

const BUSY_VARBIT = 12393;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
/** As captured: the move lands 2 ticks after the fade-out, the fade-in a tick later, closed 2 after. */
const FADE_MOVE_TICKS = 2;
const FADE_CLOSE_TICKS = 2;

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "wyrmscraig.json"), "utf8"));
}

/** Runs `action` `ticks` ticks from now. */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/** Fades out, moves the player to `to` facing `face`, and fades back in, as captured. */
function travel(player, to, face) {
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  fade(player, true);
  later(FADE_MOVE_TICKS, () => {
    if (!player.isRegistered()) return;
    player.moveTo(toLocation(to));
    if (face) player.setPositionToFace(new core.Location(face[0], face[1], to[2] ?? 0));
    later(1, () => {
      if (!player.isRegistered()) return;
      player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
      fade(player, false);
      sender.sendVarbit(BUSY_VARBIT, 0);
      later(FADE_CLOSE_TICKS, () => player.isRegistered() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
    });
  });
}

module.exports = {
  init, later, travel, toLocation,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
