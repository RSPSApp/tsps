/**
 * The Shellbane gryphon: what the units share - the plugin api, plugins/bosses/data/
 * shellbane-gryphon.json with its gameval names resolved to cache ids, tick timing, tiles,
 * graphics, typeless damage and equipped weight.
 */
const fs = require("fs");
const path = require("path");

const KILLS_ATTRIBUTE = "shellbane-gryphon:kills";

let api = null;
let core = null;
let data = null;
let ids = null;

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    if (key.startsWith("_")) continue;
    const id = lookup(name);
    if (id === null || id === undefined) throw new Error(`[ShellbaneGryphon] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "shellbane-gryphon.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    items: resolve(data.names.items, (name) => cache.getObjId(name), "item"),
    varps: resolve(data.names.varps, (name) => cache.getVarpId(name), "varp"),
    seqs: resolve(data.names.seqs, (name) => cache.getSeqId(name), "seq"),
    spotanims: resolve(data.names.spotanims, (name) => cache.getSpotanimId(name), "spotanim"),
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

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

/** Chebyshev distance from a tile to an NPC's footprint (0 inside it). */
function distanceToNpc(location, npc) {
  const base = npc.getLocation();
  const size = Math.max(1, npc.getSize?.() ?? 1);
  const dx = Math.max(base.getX() - location.getX(), 0, location.getX() - (base.getX() + size - 1));
  const dy = Math.max(base.getY() - location.getY(), 0, location.getY() - (base.getY() + size - 1));
  return Math.max(dx, dy);
}

function inBox(location, [minX, maxX, minY, maxY]) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

function tileGraphic(player, location, id, delay = 0) {
  if (id == null) return;
  player.getPacketSender().sendGraphic(core.Graphic.delayed(id, delay), location);
}

function hurtPlayer(player, amount) {
  const { HitDamage, HitMask } = core;
  const damage = Math.max(0, Math.floor(amount));
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
  return damage;
}

function message(key, values = {}) {
  return data.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

/** Kilograms worn: only equipped items count (Wiki: the knockback's 40 kg). */
function wornWeight(player) {
  const items = player.getEquipment?.()?.getItems?.() ?? [];
  let grams = 0;
  for (const item of items) {
    const id = item?.getId?.() ?? -1;
    if (id < 0) continue;
    grams += Number(core.ItemDefinition.forId(id)?.getWeight?.()) || 0;
  }
  // Item weights are kept in grams.
  return grams / 1000;
}

function wearingShield(player) {
  const { Equipment } = core;
  return player.getEquipment?.()?.get?.(Equipment.CAPE_SLOT)?.getId?.() === ids.items.shield;
}

function questComplete(player) {
  const request = { player, key: data.quest, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** A gryphon or Shellbane task: asked about the boss itself. */
function onTask(player) {
  const request = { player, npcId: ids.npcs.boss, location: toLocation(data.cave.boss), onTask: false };
  api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

/** The trails of the elite clues held whose step is this gryphon (Wiki: Clue scroll (elite) - Their bane awaits). */
function clueStepTokens(player) {
  const request = { player, npcId: ids.npcs.boss, holds: false, tokens: [] };
  api.emitCustomEvent("treasure-trails:holds-kill-step", request);
  return request.holds === true ? request.tokens.filter((token) => typeof token === "string" && token) : [];
}

function holdsClueStep(player) {
  const request = { player, npcId: ids.npcs.boss, holds: false };
  api.emitCustomEvent("treasure-trails:holds-kill-step", request);
  return request.holds === true;
}

module.exports = {
  holdsClueStep, clueStepTokens,
  init, later, toLocation, randomInt, chebyshev, distanceToNpc, inBox, tileGraphic, hurtPlayer, message,
  wornWeight, wearingShield, questComplete, onTask, KILLS_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
