/**
 * The eagle transport system: what the units share - plugins/world/data/eagle-transport.json with
 * its gameval names resolved to cache ids, Eagles' Peak's completion, the travel (a fade, then the
 * move) and message boxes.
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

function resolve(names, lookup, kind) {
  const out = {};
  for (const [key, name] of Object.entries(names)) {
    if (key.startsWith("_")) continue;
    const id = lookup(name);
    if (id === null || id === undefined) throw new Error(`[EagleTransport] unknown ${kind} ${name}`);
    out[key] = id;
  }
  return out;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "eagle-transport.json"), "utf8"));
  const cache = core.CacheDefinitions;
  ids = {
    npcs: resolve(data.names.npcs, (name) => cache.getNpcId(name), "npc"),
    locs: resolve(data.names.locs, (name) => cache.getLocId(name), "loc"),
    objs: resolve(data.names.objs, (name) => cache.getObjId(name), "obj"),
    varbits: resolve(data.names.varbits, (name) => cache.getVarbitId(name), "varbit"),
    seqs: resolve(data.names.seqs, (name) => cache.getSeqId(name), "seq"),
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

function questComplete(player) {
  return QuestRuntime.getRegisteredQuests().find((quest) => quest.name === data.quest)?.isComplete(player) ?? false;
}

function inBox(location, [minX, maxX, minY, maxY, z]) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === (z ?? 0) && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/** The screen fading to black (`out`) or back, as CatacombsOfKourend.plugin.js does it. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/**
 * Takes the player to `tile`: the screen fades out, the move `ticks` later, then it fades back.
 * The player can't walk off meanwhile. False if they're already travelling.
 */
function travel(player, tile, ticks, onArrival = null) {
  const movement = player.getMovementQueue?.();
  if (player.__eagleTravelling) return false;
  player.__eagleTravelling = true;
  movement?.setBlockMovement?.(true);
  movement?.reset?.();
  fade(player, true);
  later(ticks, () => {
    player.__eagleTravelling = false;
    // Dying on the way leaves the player to the death (it blocks movement itself).
    if (player.isRegistered?.() === false || player.isDyingReturn?.() === true || player.getHitpoints?.() <= 0) return;
    movement?.setBlockMovement?.(false);
    player.moveTo(toLocation(tile));
    fade(player, false);
    onArrival?.();
    later(2, () => player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  });
  return true;
}

/** A message box, as the transcript's {{tbox}} lines are. */
function box(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core;
  const chain = new DialogueChainBuilder();
  chain.add(new StatementDialogue(0, text));
  chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

function message(key, values = {}) {
  return data.messages[key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

module.exports = {
  init, later, toLocation, questComplete, inBox, fade, travel, box, message,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
