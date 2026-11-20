/**
 * The Alchemical Hydra: what the units share - the plugin api, plugins/bosses/data/
 * alchemical-hydra.json with its gameval names resolved to cache ids, tick timing, graphics,
 * sounds, messages and typeless damage.
 */
const fs = require("fs");
const path = require("path");

const KILLS_ATTRIBUTE = "alchemical-hydra:kills";
/** The player's fastest kill in ticks (the fight duration's personal best); 0 when none. */
const BEST_TICKS_ATTRIBUTE = "alchemical-hydra:best-ticks";

let api = null;
let core = null;
let data = null;
/** Cache ids by role: { npcs, locs, seqs, spotanims }. */
let ids = null;

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    if (key.startsWith("_")) continue;
    if (Array.isArray(name)) {
      out[key] = name.map((entry) => resolve({ entry }, lookup, kind).entry);
      continue;
    }
    const id = lookup(name);
    if (id === null || id === undefined) throw new Error(`[AlchemicalHydra] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "alchemical-hydra.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    seqs: resolve(data.names.seqs, (name) => cache.getSeqId(name), "seq"),
    spotanims: resolve(data.names.spotanims, (name) => cache.getSpotanimId(name), "spotanim"),
  };
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

/** The world's tick count: the vents keep its 8-tick clock. */
function worldTick() {
  return Number(core?.World?.getProcessCycle?.() ?? 0);
}

/** The Hydra's fighting forms, in phase order. */
function phaseForms() {
  const { serpentine, electric, flame, enraged } = ids.npcs;
  return [serpentine, electric, flame, enraged];
}

function isHydra(npc) {
  if (!npc || !ids) return false;
  const id = npc.getId?.();
  return Object.values(ids.npcs).includes(id);
}

/** Chebyshev distance from a tile to an NPC's footprint (0 inside it). */
function distanceToFootprint(location, npc) {
  const base = npc.getLocation();
  const size = Math.max(1, npc.getSize());
  const dx = Math.max(base.getX() - location.getX(), 0, location.getX() - (base.getX() + size - 1));
  const dy = Math.max(base.getY() - location.getY(), 0, location.getY() - (base.getY() + size - 1));
  return Math.max(dx, dy);
}

function tileGraphic(players, location, id, delay = 0, height = 0) {
  const { Graphic } = core;
  for (const player of players) player.getPacketSender().sendGraphic(Graphic.delayed(id, delay, height), location);
}

/** A sound from the data's "sounds" table, heard on a tile (delay in client cycles). */
function areaSound(players, key, location, delay, range) {
  const sound = data.sounds[key];
  if (!sound || !location) return;
  const at = delay ?? sound.delay ?? 0;
  for (const player of players) {
    player.getPacketSender().sendAreaSound?.(sound.id, location.getX(), location.getY(), location.getZ(), 1, at, range ?? sound.range ?? 0);
  }
}

/** A loc only this chamber's players see (the chamber is one copy a player on the shared map). */
function showLoc(players, id, location) {
  const { GameObject } = core;
  if (!GameObject) return;
  const loc = new GameObject(id, location, 10, 0, null);
  for (const player of players) player.getPacketSender().sendObject?.(loc);
}

/** A loc sequence on a tile, for this chamber's players. */
function animateLoc(players, id, location, seq) {
  const { GameObject, Animation } = core;
  if (!GameObject) return;
  const loc = new GameObject(id, location, 10, 0, null);
  for (const player of players) player.getPacketSender().sendObjectAnimation?.(loc, new Animation(seq));
}

/** Typeless damage on the player now; `poison` paints it green. */
function hurtPlayer(player, amount, poison = false) {
  const { HitDamage, HitMask } = core;
  const damage = Math.max(0, Math.floor(amount));
  const mask = damage <= 0 ? HitMask.BLUE : poison ? HitMask.GREEN : HitMask.RED;
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, mask)]);
  return damage;
}

function message(key, values = {}) {
  return data.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

/** A filterable ("spam") chat line, as live sends the vent, absorb and burn lines. */
function spam(player, text) {
  const sender = player.getPacketSender?.();
  if (sender?.sendTypedMessage && core?.ChatType?.SPAM !== undefined) sender.sendTypedMessage(core.ChatType.SPAM, text);
  else player.sendMessage(text);
}

/** Whether the player's Slayer task is hydras (the boss can only be fought on one, Wiki). */
function onTask(player, npc) {
  const request = { player, npc, onTask: false };
  api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

/** Whether the player has precise timing on (the "option_precise_timing" varbit). */
function preciseTiming(player) {
  const id = core?.CacheDefinitions?.getVarbitId?.("option_precise_timing");
  return Number.isInteger(id) && player?.getPacketSender?.()?.getVarbit?.(id) === 1;
}

/** A fight duration as shown: m:ss (whole seconds), or m:ss.cc with precise timing on. */
function formatTicks(ticks, precise = true) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  const time = `${minutes}:${String(seconds).padStart(2, "0")}`;
  return precise ? `${time}.${String(centis % 100).padStart(2, "0")}` : time;
}

module.exports = {
  init, later, toLocation, randomInt, worldTick, phaseForms, isHydra, distanceToFootprint, tileGraphic, areaSound,
  showLoc, animateLoc, hurtPlayer, message, spam, onTask, formatTicks, preciseTiming,
  KILLS_ATTRIBUTE, BEST_TICKS_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
