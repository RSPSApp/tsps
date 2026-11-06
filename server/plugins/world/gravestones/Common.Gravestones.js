"use strict";

/**
 * What the gravestone units share: the api, the cache ids (looked up by gameval name), and the
 * item records graves, Death's Office and the Coffer keep in player attributes.
 */

let pluginApi = null;

/** The varbits graves drive, by gameval name. */
const VARBIT_NAMES = {
  visible: "gravestone_visible",
  duration: "gravestone_duration",
  type: "gravestone_type",
  under100k: "gravestone_feethreshold_under100k",
  under1m: "gravestone_feethreshold_under1m",
  under10m: "gravestone_feethreshold_under10m",
  merged: "gravestone_has_merged",
  autoEquip: "settings_gravestone_autoequip",
  supplyPilesDisabled: "gravestone_supplypiles_disabled",
  warningDisabled: "gravestone_disable_warning",
  hintArrow: "current_hint_arrow",
};
const VARP_NAMES = { creationCoord: "gravestone_creation_death_coord" };
const COMPONENT_NAMES = {
  freeItems: "gravestone_generic:freeitems",
  payItems: "gravestone_generic:payitems",
  freeButton: "gravestone_generic:freebutton",
  payButton: "gravestone_generic:paybutton",
  close: "gravestone_generic:close",
};
/** The grave timer on each game frame's HUD. */
const HUD_COMPONENT_NAMES = [
  "toplevel:gravestone",
  "toplevel_osrs_stretch:gravestone",
  "toplevel_pre_eoc:gravestone",
];

const VARBIT = {};
const VARP = {};
const COMPONENT = {};
const HUD_COMPONENTS = [];
let INTERFACE = -1;

/** Gameval inv `gravestone`, the grave's 120 slots. */
const GRAVE_INV = 525;
const GRAVE_SLOTS = 120;
/** Gameval inv `death_permanent`, Death's Office's 120 slots. */
const OFFICE_INV = 636;
const OFFICE_SLOTS = 120;
/** gravestone_transmit_data (3478): the fee and the Coffer's balance, into varcs 399 and 400. */
const TRANSMIT_DATA_SCRIPT = 3478;

/** The game frame's floater, where the grave interface opens as an overlay. */
const FLOATER_UID = (161 << 16) | 18;
const OVERLAY = 1;
const OP1 = 1 << 1;
const OP10 = 1 << 10;
const DEPTH2 = 2 << 17;

const COINS = 995;
const MAX_STACK = 2147483647;

function bind(api) {
  pluginApi = api;
  const { CacheDefinitions } = api.core;
  for (const [key, name] of Object.entries(VARBIT_NAMES)) VARBIT[key] = CacheDefinitions.getVarbitId(name);
  for (const [key, name] of Object.entries(VARP_NAMES)) VARP[key] = CacheDefinitions.getVarpId(name);
  for (const [key, name] of Object.entries(COMPONENT_NAMES)) COMPONENT[key] = CacheDefinitions.getComponentId(name);
  HUD_COMPONENTS.length = 0;
  for (const name of HUD_COMPONENT_NAMES) {
    const id = CacheDefinitions.getComponentId(name);
    if (id != null) HUD_COMPONENTS.push(id);
  }
  INTERFACE = COMPONENT.freeItems >>> 16;
}

function api() {
  return pluginApi;
}

function core() {
  return pluginApi.core;
}

function interfaceId() {
  return INTERFACE;
}

function getVarbit(player, key) {
  return player.getPacketSender().getVarbit(VARBIT[key]);
}

function setVarbit(player, key, value) {
  player.getPacketSender().sendVarbit(VARBIT[key], value);
}

function cycle() {
  return core().World.getProcessCycle();
}

/** Runs `action` once, `ticks` ticks from now. */
function later(key, ticks, action) {
  const { Task, TaskManager } = core();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSoundEffect?.(id, 1, delay, 255);
}

function formatCoins(amount) {
  return Math.trunc(amount).toLocaleString("en-US");
}

// ---------------------------------------------------------------- item records

/** An item as graves keep it: id, amount and its meta (charges), so it survives a save. */
function record(item) {
  const meta = item.getMeta?.();
  return { id: item.getId(), amount: item.getAmount(), meta: meta == null ? null : JSON.parse(JSON.stringify(meta)) };
}

function toItem(entry, amount = entry.amount) {
  const { Item } = core();
  return new Item(entry.id, amount, entry.meta == null ? undefined : JSON.parse(JSON.stringify(entry.meta)));
}

function sameStack(a, b) {
  return a.id === b.id && JSON.stringify(a.meta ?? null) === JSON.stringify(b.meta ?? null);
}

/** The cache/store value of one item, used when no other value order is supplied. */
function value(id) {
  return Math.max(0, core().ItemDefinition.forId(id).getValue());
}

function definition(id) {
  return core().ItemDefinition.forId(id);
}

/** Food and potions, as the cache gives them: an Eat or Drink option. */
function isSupply(id) {
  const actions = core().CacheDefinitions.getItem(id)?.inventoryActions ?? [];
  return actions.some((action) => action === "Eat" || action === "Drink");
}

/**
 * Adds `adding` to `records`, stacked like a bank (meta must match), and sorted most valuable
 * first, using `worth` for the value order. A stack holds up to 2^31-1. Returns what fits in
 * `capacity` slots and what is left over: the least valuable slots past it.
 */
function stack(records, adding, capacity, worth = value) {
  const stacks = [];
  const overflow = [];
  for (const entry of [...records, ...adding]) {
    const index = stacks.findIndex((held) => sameStack(held, entry));
    if (index < 0) {
      stacks.push({ ...entry });
      continue;
    }
    const total = stacks[index].amount + entry.amount;
    stacks[index].amount = Math.min(total, MAX_STACK);
    if (total > MAX_STACK) overflow.push({ ...entry, amount: total - MAX_STACK });
  }
  stacks.sort((a, b) => worth(b.id) - worth(a.id));
  return { held: stacks.slice(0, capacity), overflow: [...overflow, ...stacks.slice(capacity)] };
}

function sendInventory(player, invId, capacity, records) {
  player.getPacketSender().sendInventory(invId, capacity, records.map(({ id, amount }) => ({ id, amount })));
}

/** Whether the player's inventory can take `entry` whole. */
function fits(player, entry) {
  return player.getInventory().getAddableAmount(toItem(entry)) >= entry.amount;
}

/** The ironman mode, through the Ironman plugin; null for a normal account. */
function ironmanMode(player) {
  const query = { player, mode: null };
  pluginApi.emitCustomEvent("ironman:mode", query);
  return query.mode && query.mode !== "none" ? query.mode : null;
}

module.exports = {
  bind, api, core, interfaceId, getVarbit, setVarbit, cycle, later, sound, formatCoins,
  record, toItem, sameStack, value, definition, isSupply, stack, sendInventory, fits, ironmanMode,
  VARBIT, VARP, COMPONENT, HUD_COMPONENTS, GRAVE_INV, GRAVE_SLOTS, OFFICE_INV, OFFICE_SLOTS,
  TRANSMIT_DATA_SCRIPT, FLOATER_UID, OVERLAY, OP1, OP10, DEPTH2, COINS, MAX_STACK,
};
