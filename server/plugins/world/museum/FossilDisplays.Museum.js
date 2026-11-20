/**
 * The 36 fossil displays on the Varrock Museum's lowest floor (Wiki: Kudos; rsprox captures local
 * 1000338, local 1000342 and 1843; data/fossil-displays.json).
 *
 * Add to puts the display's next piece in: the player picks it up (human_pickuptable, sound 2739)
 * and the next tick the fossil leaves the pack and the display's state varbit rises by one. Each
 * click adds one piece, in a fixed order (limbs or roots, spine, ribs, pelvis, skull). Without the
 * next piece: "You're missing part of the display:  <piece>.", and nothing changes.
 *
 * The fifth piece completes it: 2 Kudos (through the Museum's AWARD_KUDOS_EVENT, with its spam
 * line and sound), the display's antique lamp in the pack, and the lamp beside "Congratulations,
 * you have completed this display!". A completed display has no Add to. The lamps are rubbed in
 * Museum.plugin.js with the museum's other lamps.
 *
 * Ours: using a fossil on a display does nothing special (no recording uses one).
 */
"use strict";

const DATA = require("../data/fossil-displays.json");

const STATES_ATTRIBUTE = "museum:fossil-displays";
const AWARD_KUDOS_EVENT = "museum:award-kudos";

let api = null;
let core = null;
let ids = null;
/** Player -> the piece being added this tick, so a second click can't add it twice. */
const adding = new WeakMap();

function gameval(lookup, kind, name) {
  const id = lookup(name);
  if (!Number.isInteger(id) || id < 0) throw new Error(`[museum] unknown ${kind} gameval ${name}`);
  return id;
}

/** Display number -> { number, varbit, size }, and every display loc id (base and states) -> display. */
function resolveIds() {
  if (ids) return ids;
  const defs = core.CacheDefinitions;
  const obj = (name) => gameval((value) => defs.getObjId(value), "obj", name);
  const byLoc = new Map();
  const displays = [];
  for (const [key, locs] of Object.entries(DATA.displays)) {
    const number = Number(key);
    const display = { number, varbit: gameval((value) => defs.getVarbitId(value), "varbit", `fossil_vm_display_${number}_state`), size: null };
    for (const name of locs) {
      const base = gameval((value) => defs.getLocId(value), "loc", name);
      const states = defs.getObject(base)?.transforms ?? [];
      display.size ??= DATA.names[defs.getObject(states[0])?.name];
      for (const id of [base, ...states]) if (id >= 0) byLoc.set(id, display);
    }
    if (!display.size) throw new Error(`[museum] fossil display ${number} has no known size`);
    displays.push(display);
  }
  const pieces = Object.fromEntries(Object.entries(DATA.pieces).map(([size, names]) => [size, names.map(obj)]));
  const lamps = Object.fromEntries(Object.entries(DATA.lamps).map(([size, name]) => [size, obj(name)]));
  ids = { displays, byLoc, pieces, lamps, anim: defs.getSeqId(DATA.anim) };
  return ids;
}

function statesOf(player) {
  const saved = player.getAttribute(STATES_ATTRIBUTE);
  return Array.isArray(saved) ? saved : [];
}

function stateOf(player, display) {
  return Number(statesOf(player)[display.number - 1]) || 0;
}

function setState(player, display, state) {
  const states = [...statesOf(player)];
  while (states.length < display.number) states.push(0);
  states[display.number - 1] = state;
  player.setAttribute(STATES_ATTRIBUTE, states);
  player.getPacketSender().sendVarbit(display.varbit, state);
}

/** The pack slot holding `itemId`, or -1. */
function slotOf(player, itemId) {
  return player.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
}

/** Add to: one piece, the next tick after the pick-up. */
function addTo(event) {
  const { player, objectId } = event;
  const display = resolveIds().byLoc.get(objectId);
  if (!display) return false;
  const state = stateOf(player, display);
  if (state >= DATA.complete || adding.has(player)) return true;
  const piece = ids.pieces[display.size][state];
  if (slotOf(player, piece) < 0) {
    player.sendMessage(DATA.messages.missing.replace("{name}", core.ItemDefinition.forId(piece).getName()));
    return true;
  }
  player.performAnimation(new core.Animation(ids.anim));
  player.getPacketSender().sendSound(DATA.sound, 255, 0);
  const pending = { display, state, piece };
  adding.set(player, pending);
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, false); }
    execute() {
      this.stop();
      if (adding.get(player) !== pending) return;
      adding.delete(player);
      if (player.isRegistered?.() === false) return;
      addPiece(player, pending);
    }
  })());
  return true;
}

function addPiece(player, { display, state, piece }) {
  if (stateOf(player, display) !== state) return;
  const slot = slotOf(player, piece);
  if (slot < 0) return;
  const inventory = player.getInventory();
  inventory.deleteAtSlot(slot, 1);
  setState(player, display, state + 1);
  if (state + 1 < DATA.complete) return;
  api.emitCustomEvent(AWARD_KUDOS_EVENT, { player, amount: DATA.kudos, source: `fossil-display:${display.number}` });
  const lamp = ids.lamps[display.size];
  inventory.forceAdd(player, new core.Item(lamp, 1));
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, lamp, DATA.messages.complete)));
  api.emitCustomEvent("persistence:save", { player, reason: "fossil-display" });
}

function login({ player }) {
  const { displays } = resolveIds();
  for (const display of displays) {
    const state = stateOf(player, display);
    if (state > 0) player.getPacketSender().sendVarbit(display.varbit, state);
  }
}

/** The fossil display lamps' rewards by item id, for the Museum's Rub. */
function lampRewards(coreApi) {
  core ??= coreApi;
  return new Map(Object.entries(DATA.lampRewards).map(([name, reward]) =>
    [gameval((value) => core.CacheDefinitions.getObjId(value), "obj", name), reward]));
}

function attachFossilDisplays(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.persistAttribute?.(STATES_ATTRIBUTE, null);
  const actions = { "Add to": addTo };
  for (const name of Object.keys(DATA.names)) pluginApi.onObjectInteraction(name, actions);
  pluginApi.onPlayerLogin(login);
}

module.exports = attachFossilDisplays;
Object.assign(module.exports, { STATES_ATTRIBUTE, DATA, lampRewards, _test: { addTo, addPiece, login, reset: () => { ids = null; } } });
