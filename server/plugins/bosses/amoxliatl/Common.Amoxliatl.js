/**
 * Amoxliatl: what the units share - the plugin api, the data from plugins/bosses/data/amoxliatl.json,
 * tick timing, the captured fade, sounds and the saved attributes.
 */
const fs = require("fs");
const path = require("path");

const KILLS_ATTRIBUTE = "amoxliatl:kills";
const BEST_TICKS_ATTRIBUTE = "amoxliatl:best-ticks";
/** Set while the player is in her chamber, so a login there puts them outside the door. */
const INSIDE_ATTRIBUTE = "amoxliatl:inside";

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
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "amoxliatl.json"), "utf8"));
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

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/**
 * The captured fade between the ruins and her chamber, the same both ways: out (busy, the HP
 * HUD emptied, the minimap a tick later),`move` 2 ticks in, back in at 4 (minimap on, not busy), the overlay
 * closed at 6. `arrive` runs as the fade comes back.
 */
function travel(player, move, arrive) {
  const { moveTicks, inTicks, closeTicks } = data.fade;
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  fade(player, true);
  // As captured, the HP HUD is emptied with the fade out, both ways.
  api.emitCustomEvent("boss-hud:reset", { player });
  later(1, () => player.isRegistered() && sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  later(moveTicks, () => player.isRegistered() && move());
  later(inTicks, () => {
    if (!player.isRegistered()) return;
    sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
    sender.sendVarbit(BUSY_VARBIT, 0);
    fade(player, false);
    arrive?.();
  });
  later(closeTicks, () => player.isRegistered() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
}

/** A positioned sound the player hears: { id, delay?, radius?, attenuation? } at a tile. */
function areaSound(player, sound, location) {
  player.getPacketSender().sendAreaSound(
    sound.id, location.getX(), location.getY(), location.getZ(), 1, sound.delay ?? 0, sound.radius ?? 0, sound.attenuation ?? 0
  );
}

/** A map animation on a tile, `delay` client cycles in. */
function tileGraphic(player, location, id, delay = 0) {
  const { Graphic } = core;
  player.getPacketSender().sendGraphic(Graphic.delayed(id, delay), location);
}

/** A fight's length as the game prints it: m:ss.cc. */
function formatTicks(ticks) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

module.exports = {
  init, later, toLocation, randomInt, travel, areaSound, tileGraphic, formatTicks,
  KILLS_ATTRIBUTE, BEST_TICKS_ATTRIBUTE, INSIDE_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
