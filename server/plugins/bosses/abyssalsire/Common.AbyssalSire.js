/**
 * The Abyssal Sire: what the units share - the plugin api, the data from
 * plugins/bosses/data/abyssal-sire.json, tick timing, sounds and graphics for the players in a
 * lair, typeless damage and the saved attributes.
 */
const fs = require("fs");
const path = require("path");

const KILLS_ATTRIBUTE = "abyssal-sire:kills";
/** The Overseer's progress (varbit 3261) and the parts he holds (varbit 3262). */
const LORE_ATTRIBUTE = "abyssal-sire:overseer-lore";
const PARTS_ATTRIBUTE = "abyssal-sire:overseer-parts";
/** The bludgeon pieces had since the last full set, for the Font's no-duplicates rule. */
const PIECES_ATTRIBUTE = "abyssal-sire:font-pieces";
/** The Overseer has handed over the first bludgeon (only once, however the dialogue ends). */
const BLUDGEON_GIVEN_ATTRIBUTE = "abyssal-sire:bludgeon-given";

const BUSY_VARBIT = 12393;

let api = null;
let core = null;
let data = null;
let sireIds = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "abyssal-sire.json"), "utf8"));
  const { npcs } = data;
  sireIds = new Set([npcs.sleeping, npcs.awake, npcs.stunned, npcs.puppet, npcs.wandering, npcs.panicking, npcs.apocalypse]);
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

/** One of `entries`, by each entry's `weight`. */
function weighted(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

function isSire(npc) {
  return Boolean(npc) && sireIds.has(npc.getId?.());
}

/** Chebyshev distance from a tile to an NPC's footprint (0 inside it). */
function distanceToFootprint(location, npc) {
  const base = npc.getLocation();
  const size = Math.max(1, npc.getSize());
  const dx = Math.max(base.getX() - location.getX(), 0, location.getX() - (base.getX() + size - 1));
  const dy = Math.max(base.getY() - location.getY(), 0, location.getY() - (base.getY() + size - 1));
  return Math.max(dx, dy);
}

/** A positioned sound for each of `players`: { id, delay?, radius? } at a tile. */
function areaSound(players, sound, location) {
  const spec = typeof sound === "number" ? { id: sound } : sound;
  for (const player of players) {
    player.getPacketSender().sendAreaSound(spec.id, location.getX(), location.getY(), location.getZ(), 1, spec.delay ?? 0, spec.radius ?? 0, 0);
  }
}

/** A map animation on a tile, for each of `players`. */
function tileGraphic(players, location, id, delay = 0) {
  const { Graphic } = core;
  for (const player of players) player.getPacketSender().sendGraphic(Graphic.delayed(id, delay), location);
}

/** Typeless damage on the player now: a red splat, or a green one for `poison`. */
function hurtPlayer(player, amount, poison = false) {
  const { HitDamage, HitMask } = core;
  const damage = Math.max(0, Math.floor(amount));
  const mask = damage <= 0 ? HitMask.BLUE : poison ? HitMask.GREEN : HitMask.RED;
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, mask)]);
  return damage;
}

/** The player busy (varbit 12393) for `ticks`, as the Sire's pulls capture it. */
function busyFor(player, ticks) {
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  later(ticks, () => player.isRegistered() && sender.sendVarbit(BUSY_VARBIT, 0));
}

function message(key, values = {}) {
  return data.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

module.exports = {
  init, later, toLocation, randomInt, weighted, isSire, distanceToFootprint, areaSound, tileGraphic, hurtPlayer, busyFor,
  message,
  KILLS_ATTRIBUTE, LORE_ATTRIBUTE, PARTS_ATTRIBUTE, PIECES_ATTRIBUTE, BLUDGEON_GIVEN_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
