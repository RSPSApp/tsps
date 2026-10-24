/**
 * The Lovakengj Minecart Network: what the units share - plugins/world/data/lovakengj-minecarts.json
 * with its conductor gameval names resolved to cache ids, each conductor's "already there" line in
 * the transcripts, The Forsaken Tower's completion and the travel fade.
 */
const fs = require("fs");
const path = require("path");
const QuestRuntime = require("../../quests/QuestRuntime");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

let api = null;
let core = null;
let data = null;
let ids = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "lovakengj-minecarts.json"), "utf8"));
  const cache = core.CacheDefinitions;
  const dialogues = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "data", "definitions", "npc-dialogues.json"), "utf8"));
  ids = { conductors: new Map(), menu: cache.getInterfaceId("menu"), minecart: cache.getLocId("lovakengj_minecart") };
  for (const station of data.stations) {
    const id = cache.getNpcId(station.conductor);
    if (!Number.isInteger(id)) throw new Error(`[LovakengjMinecarts] unknown npc ${station.conductor}`);
    station.npcId = id;
    ids.conductors.set(id, station);
    const variants = Object.keys(dialogues[station.name]?.variants ?? {});
    station.alreadyThere = variants.find((variant) => /attempting-to-travel-to-.*-while-already-there/.test(variant)) ?? null;
  }
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

function freeRides(player) {
  return QuestRuntime.getRegisteredQuests().find((quest) => quest.name === data.quest)?.isComplete(player) ?? false;
}

/** The station whose cart is nearest the player, if they are at one. */
function stationAt(location) {
  let best = null;
  for (const station of data.stations) {
    const [x, y] = station.cart;
    if (location.getZ() !== 0) continue;
    const distance = Math.max(Math.abs(location.getX() - x), Math.abs(location.getY() - y));
    if (distance <= data.nearTiles && (!best || distance < best.distance)) best = { station, distance };
  }
  return best?.station ?? null;
}

/** The screen fading to black (`out`) or back, as CatacombsOfKourend.plugin.js does it. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

module.exports = {
  init, later, toLocation, freeRides, stationAt, fade, closeFade,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
