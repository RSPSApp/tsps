/**
 * The Mad Angel: what the units share - the plugin api, the data from
 * data/definitions/mad-angel.json, tick timing, the captured fade, and the saved attributes.
 */
const fs = require("fs");
const path = require("path");

const KILLS_ATTRIBUTE = "mad-angel:kills";
const BEST_TICKS_ATTRIBUTE = "mad-angel:best-ticks";
/** Set while the player is in the cathedral's instance, so a login there puts them outside. */
const INSIDE_ATTRIBUTE = "mad-angel:inside";

const BUSY_VARBIT = 12393;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "mad-angel.json"), "utf8"));
}

/** Runs `action` `ticks` ticks from now (at least one). */
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

function minimap(player, off) {
  const sender = player.getPacketSender();
  sender.sendVarbit(MINIMAP_STATE_VARBIT, off ? MINIMAP_OFF : 0);
}

/**
 * The captured fade between the cathedral and its instance: out (the minimap goes a tick later),
 * the move `moveTicks` later, back in `inTicks` after the fade-out, the overlay closed
 * `closeTicks` after it. `move` places the player; `arrive` runs as the fade comes back.
 */
function travel(player, { moveTicks, inTicks, closeTicks }, move, arrive) {
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  fade(player, true);
  later(1, () => player.isRegistered() && minimap(player, true));
  later(moveTicks, () => player.isRegistered() && move());
  later(inTicks, () => {
    if (!player.isRegistered()) return;
    minimap(player, false);
    fade(player, false);
    arrive?.();
  });
  later(closeTicks, () => {
    if (!player.isRegistered()) return;
    sender.sendVarbit(BUSY_VARBIT, 0);
    sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  });
}

/** A fight's length as the game prints it: m:ss.cc. */
function formatTicks(ticks) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

module.exports = {
  init, later, toLocation, travel, formatTicks,
  KILLS_ATTRIBUTE, BEST_TICKS_ATTRIBUTE, INSIDE_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
