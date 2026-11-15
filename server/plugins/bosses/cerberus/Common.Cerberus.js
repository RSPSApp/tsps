/**
 * Cerberus: what the units share - the plugin api, plugins/bosses/data/cerberus.json with its
 * gameval names resolved to cache ids, tick timing, graphics for the players in an arena and
 * typeless damage.
 */
const fs = require("fs");
const path = require("path");

const KILLS_ATTRIBUTE = "cerberus:kills";
/** The Elysian spirit shield's effect graphic, as core combat plays it. */
const ELYSIAN_GRAPHIC = 321;

let api = null;
let core = null;
let data = null;
/** Cache ids by role: { npcs, locs, seqs, spotanims }. */
let ids = null;

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    if (Array.isArray(name)) {
      out[key] = name.map((entry) => resolve({ entry }, lookup, kind).entry);
      continue;
    }
    const id = lookup(name);
    if (id === null || id === undefined) throw new Error(`[Cerberus] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cerberus.json"), "utf8"));
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

function isCerberus(npc) {
  if (!npc || !ids) return false;
  if (npc.__echoCerberus) return true;
  const id = npc.getId?.();
  return id === ids.npcs.attacking || id === ids.npcs.sitting || id === ids.npcs.resetting;
}

function isSoul(npc) {
  if (!npc || !ids) return false;
  const id = npc.getId?.();
  return id === ids.npcs.soulRanged || id === ids.npcs.soulMagic || id === ids.npcs.soulMelee;
}

/** Chebyshev distance from a tile to an NPC's footprint (0 inside it). */
function distanceToFootprint(location, npc) {
  const base = npc.getLocation();
  const size = Math.max(1, npc.getSize());
  const dx = Math.max(base.getX() - location.getX(), 0, location.getX() - (base.getX() + size - 1));
  const dy = Math.max(base.getY() - location.getY(), 0, location.getY() - (base.getY() + size - 1));
  return Math.max(dx, dy);
}

/** A map animation on a tile, for each of `players`. */
function tileGraphic(players, location, id, delay = 0) {
  const { Graphic } = core;
  for (const player of players) player.getPacketSender().sendGraphic(Graphic.delayed(id, delay), location);
}

/** The Elysian spirit shield's 25% cut, 70% of the time (CombatConstants, as for any hit). */
function elysianCut(player, damage) {
  const { CombatConstants, ItemIdentifiers, Graphic } = core;
  if (!player.getEquipment?.()?.contains?.(ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD)) return damage;
  if (Math.random() >= CombatConstants.ELYSIAN_ACTIVATION_CHANCE) return damage;
  player.performGraphic?.(new Graphic(ELYSIAN_GRAPHIC, 40));
  return Math.floor(damage * CombatConstants.ELYSIAN_DAMAGE_REDUCTION);
}

/** Typeless damage on the player now (a blue splat for none). */
function hurtPlayer(player, amount) {
  const { HitDamage, HitMask } = core;
  const damage = Math.max(0, Math.floor(amount));
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
  return damage;
}

function message(key, values = {}) {
  return data.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

/**
 * Whether the player's Slayer task lets them fight Cerberus (a hellhound or Cerberus task). Only
 * her attacking form carries the hellhound task in the cache (param 50), so she is asked about
 * as that form wherever she is sitting.
 */
function onTask(player, npc) {
  if (npc?.__echoCerberus) return true;
  const request = { player, npcId: ids.npcs.attacking, location: npc.getLocation(), onTask: false };
  api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

module.exports = {
  init, later, toLocation, randomInt, isCerberus, isSoul, distanceToFootprint, tileGraphic, hurtPlayer, elysianCut, message, onTask,
  KILLS_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
