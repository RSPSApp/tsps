/**
 * TzHaar-Ket-Rak's Challenges: what the units share - the plugin api, plugins/minigames/data/
 * tzhaar-ket-rak.json with its gameval names resolved to cache ids, tick timing, tiles, the
 * completion counts and the player's TzHaar name (Wiki: TzHaar, castes).
 */
const fs = require("fs");
const path = require("path");
const Names = require("../../areas/moruirek/Names.MorUiRek");

/** Completions of challenge n (1-6) are kept here and mirrored to its varp. */
const completionsAttribute = (challenge) => `tzhaar-ket-rak:challenge-${challenge}-completions`;
/** The Pets plugin reads this for the JalRek-Jad metamorphosis (Pets.plugin.js, JALREK_JAD). */
const PET_UNLOCK_ATTRIBUTE = "tzhaar-ket-rak:challenge-6";
const MET_ATTRIBUTE = "tzhaar-ket-rak:met";
const BEST_TIMES_ATTRIBUTE = "tzhaar-ket-rak:best-ticks";
/** The challenge last completed, kept until a failure: "It Wasn't a Fluke" (5th then 6th). */
const LAST_COMPLETED_ATTRIBUTE = "tzhaar-ket-rak:last-completed";
const SIX = 6;

let api = null;
let core = null;
let data = null;
let ids = null;

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    if (key.startsWith("_")) continue;
    const id = lookup(name);
    if (id === null || id === undefined) throw new Error(`[TzHaarKetRak] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "tzhaar-ket-rak.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    varbits: resolve(data.names.varbits, (name) => cache.getVarbitId(name), "varbit"),
    varps: resolve(data.names.varps, (name) => cache.getVarpId(name), "varp"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    objs: resolve(data.names.objs, (name) => cache.getObjId(name), "obj"),
    menu: cache.getInterfaceId("menu"),
  };
}

/** Runs `action` once, `ticks` game ticks from now. */
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

const cycle = () => core.World.getProcessCycle();

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

/** The screen fading to black (`out`) or back (rsprox: fade_overlay script 948, 50 cycles). */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

/** "M:SS.t" for a duration in game ticks (0.6 s each), as the challenge lines print it. */
function formatTicks(ticks) {
  const tenths = Math.max(0, Math.round(ticks * 6));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

function message(key, values = {}) {
  return data.messages[key].replace(/{(\w+)}/g, (_, name) => String(values[name] ?? ""));
}
const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function inBox(location, [minX, maxX, minY, maxY]) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function completions(player, challenge) {
  return Number(player.getAttribute?.(completionsAttribute(challenge))) || 0;
}

function completedAllSix(player) {
  for (let challenge = 1; challenge <= SIX; challenge++) if (completions(player, challenge) === 0) return false;
  return true;
}

/** TzKal-Zuk defeated at least once (the Inferno's own completion count). */
function defeatedZuk(player) {
  return (Number(player.getAttribute?.("inferno:completions")) || 0) > 0;
}

/**
 * The caste a TzHaar calls the player by (Wiki TzHaar): the skill pair with the highest total,
 * ties going Mej, Ket, Xil, Hur.
 */
function caste(player) {
  return Names.caste(player, core.Skill);
}

/** Xo once into the inner city, Kal once TzKal-Zuk is beaten (Wiki TzHaar, honorifics). */
function honorific(player) {
  return defeatedZuk(player) ? "Kal" : "Xo";
}

module.exports = {
  init, later, cycle, toLocation, fade, closeFade, formatTicks, message, NUMBER_WORDS, randomInt, inBox, completions, completedAllSix, defeatedZuk, caste, honorific,
  completionsAttribute, PET_UNLOCK_ATTRIBUTE, MET_ATTRIBUTE, BEST_TIMES_ATTRIBUTE, LAST_COMPLETED_ATTRIBUTE, SIX,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
