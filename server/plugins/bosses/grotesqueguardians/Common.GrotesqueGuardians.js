/**
 * The Grotesque Guardians: what the units share - the plugin api, plugins/bosses/data/
 * grotesque-guardians.json with its gameval names resolved to cache ids, tick timing, graphics
 * and typeless damage.
 */
const fs = require("fs");
const path = require("path");

const UNLOCKED_ATTRIBUTE = "grotesque-guardians:roof-unlocked";
const KILLS_ATTRIBUTE = "grotesque-guardians:kills";
/** The fastest kill, in game ticks from the bell to Dusk's death. */
const BEST_ATTRIBUTE = "grotesque-guardians:best-ticks";

let api = null;
let core = null;
let data = null;
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
    if (id === null || id === undefined) throw new Error(`[GrotesqueGuardians] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "grotesque-guardians.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    items: resolve(data.names.items, (name) => cache.getObjId(name), "item"),
    varbits: resolve(data.names.varbits, (name) => cache.getVarbitId(name), "varbit"),
    seqs: resolve(data.names.seqs, (name) => cache.getSeqId(name), "seq"),
    spotanims: resolve(data.names.spotanims, (name) => cache.getSpotanimId(name), "spotanim"),
  };
}

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

const duskForms = () => [ids.npcs.duskPhase1, ids.npcs.duskToPhase2, ids.npcs.duskPhase2, ids.npcs.duskPhase3, ids.npcs.duskPhase4Spawn, ids.npcs.duskPhase4, ids.npcs.duskDeath];
const dawnForms = () => [ids.npcs.dawnPhase1, ids.npcs.dawnFlying, ids.npcs.dawnPhase3, ids.npcs.dawnDeath];

function isDusk(npc) {
  return Boolean(npc && ids) && duskForms().includes(npc.getId?.());
}

function isDawn(npc) {
  return Boolean(npc && ids) && dawnForms().includes(npc.getId?.());
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

function tileGraphic(players, location, id, delay = 0) {
  if (id == null) return;
  const { Graphic } = core;
  for (const player of players) player.getPacketSender().sendGraphic(Graphic.delayed(id, delay), location);
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

/** A message box (an item box with `itemId`), as the roof's mesboxes and objectboxes. */
function box(player, text, itemId = null) {
  const { DialogueChainBuilder, StatementDialogue, ItemStatementDialogue, EndDialogue } = core;
  const chain = new DialogueChainBuilder();
  chain.add(itemId == null ? new StatementDialogue(0, text) : new ItemStatementDialogue(0, itemId, text));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

/** The screen fading to black (`out`) or back, as CatacombsOfKourend.plugin.js does it. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

/** "M:SS.t" for a duration in game ticks (0.6 s each). */
function formatTicks(ticks) {
  const tenths = Math.round(ticks * 6);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

/** Gargoyles or the Guardians themselves as the player's task (the roof's requirement). */
function onTask(player, npc = { getId: () => ids.npcs.duskPhase1 }) {
  const request = { player, npc, npcId: npc.getId?.(), onTask: false };
  api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

module.exports = {
  init, later, toLocation, randomInt, duskForms, dawnForms, isDusk, isDawn, chebyshev, tileGraphic, hurtPlayer, message, onTask,
  box, fade, closeFade, formatTicks, UNLOCKED_ATTRIBUTE, KILLS_ATTRIBUTE, BEST_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
