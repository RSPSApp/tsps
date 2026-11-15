/**
 * Zalcano: what the units share - the plugin api, plugins/bosses/data/zalcano.json with its
 * gameval names resolved to cache ids, tick timing, tiles, graphics and typeless damage.
 */
const fs = require("fs");
const path = require("path");

const SONG_OF_THE_ELVES = "song_of_the_elves";
const KILLS_ATTRIBUTE = "zalcano:kills";
/** Rhiannon's loot choice: true for "XP Focused." (varbit zalcano_loot_customization). */
const XP_FOCUS_ATTRIBUTE = "zalcano:xp-focus";

let api = null;
let core = null;
let data = null;
let ids = null;

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    if (key.startsWith("_")) continue;
    const id = lookup(name);
    if (id === null || id === undefined) throw new Error(`[Zalcano] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "zalcano.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    items: resolve(data.names.items, (name) => cache.getObjId(name), "item"),
    varps: resolve(data.names.varps, (name) => cache.getVarpId(name), "varp"),
    varbits: resolve(data.names.varbits, (name) => cache.getVarbitId(name), "varbit"),
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
const pick = (list) => list[Math.floor(Math.random() * list.length)];

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

/** Whether a tile is inside a box [minX, maxX, minY, maxY] on the ground floor. */
function inBox(location, [minX, maxX, minY, maxY]) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

const inPrison = (location) => inBox(location, data.prison.bounds);
const onFloor = (location) => inBox(location, data.prison.floor);

function tileGraphic(players, location, id, delay = 0) {
  if (id == null) return;
  const { Graphic } = core;
  for (const player of players) player.getPacketSender().sendGraphic(new Graphic(id, delay), location);
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

/** A recorded spam line (filterable). */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

/** A recorded message box. */
function box(player, text, then = null) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = core;
  const chain = new DialogueChainBuilder().add(new StatementDialogue(0, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }));
  player.getDialogueManager().startDialogues(chain);
}

function questComplete(player) {
  const request = { player, key: SONG_OF_THE_ELVES, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Removes every one of `itemId` the player carries; returns how many. */
function removeAll(player, itemId) {
  const inventory = player.getInventory();
  const count = inventory.getAmount(itemId);
  if (count > 0) inventory.deleteNumber(itemId, count);
  return count;
}

module.exports = {
  init, later, toLocation, randomInt, pick, chebyshev, distanceToNpc, inBox, inPrison, onFloor,
  tileGraphic, hurtPlayer, message, spam, box, questComplete, removeAll,
  KILLS_ATTRIBUTE, XP_FOCUS_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
