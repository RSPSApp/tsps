/**
 * The Keldagrim minecarts: what the units share - the plugin api, plugins/world/data/
 * keldagrim-minecarts.json with its gameval names resolved to cache ids, tick timing, the fade,
 * message boxes and the quest checks.
 */
const fs = require("fs");
const path = require("path");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

let api = null;
let core = null;
let data = null;
let ids = null;

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    const id = lookup(name);
    if (id === null || id === undefined || id < 0) throw new Error(`[KeldagrimMinecarts] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "keldagrim-minecarts.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    objs: resolve(data.names.objs, (name) => cache.getObjId(name), "obj"),
    seqs: resolve({ ridingStance: data.ridingStance }, (name) => cache.getSeqId(name), "seq"),
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

/** The screen fading to black (`out`) or back (fade_overlay, script 948, 50 cycles), as recorded. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function questStarted(player, key) {
  const request = { player, key, started: false };
  api.emitCustomEvent("quest:is-started", request);
  return request.started === true;
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function wearingCharos(player) {
  return player.getEquipment?.()?.getItems?.()[core.Equipment.RING_SLOT]?.getId?.() === ids.objs.ringOfCharosA;
}

module.exports = {
  init, later, fade, closeFade, statement, questStarted, questComplete, wearingCharos,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
