/**
 * The Bank PIN: what the units share - the plugin api, plugins/interface/data/bank-pin.json with
 * its interfaces and components resolved from the cache, the player's saved PIN state and the
 * session's unlock, and the clock pending PINs and lockouts are measured on.
 *
 * The PIN itself is never stored: only a salted SHA-256 of it.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ATTRIBUTES = {
  hash: "bank-pin:hash",
  pendingHash: "bank-pin:pending-hash",
  pendingAt: "bank-pin:pending-at",
  deleteAt: "bank-pin:delete-at",
  delay: "bank-pin:delay-days",
  stayUnlocked: "bank-pin:stay-unlocked",
  failures: "bank-pin:failures",
  lockedUntil: "bank-pin:locked-until",
  logoutAt: "bank-pin:logout-at",
  logoutHost: "bank-pin:logout-host",
};
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let api = null;
let core = null;
let data = null;
let ids = null;
/** The clock, in epoch milliseconds (tests replace it). */
let clock = () => Date.now();
/** Players who have entered their PIN this session. */
const unlocked = new WeakSet();

function componentUid(cache, iface, group, ref) {
  if (typeof ref === "number") return (group << 16) | ref;
  const uid = cache.getComponentId(`${iface}:${ref}`);
  if (uid === null || uid === undefined) throw new Error(`[BankPin] unknown component ${iface}:${ref}`);
  return uid;
}

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "bank-pin.json"), "utf8"));
  const cache = core.CacheDefinitions;
  const groups = {};
  for (const [key, name] of Object.entries(data.interfaces)) {
    groups[key] = cache.getInterfaceId(name);
    if (groups[key] === null || groups[key] === undefined) throw new Error(`[BankPin] unknown interface ${name}`);
  }
  const uids = {};
  for (const [key, refs] of Object.entries(data.components)) {
    uids[key] = {};
    for (const [name, ref] of Object.entries(refs)) uids[key][name] = componentUid(cache, data.interfaces[key], groups[key], ref);
  }
  ids = { groups, uids };
}

function setClock(fn) {
  clock = fn;
}

const now = () => clock();
const get = (player, key) => player.getAttribute?.(ATTRIBUTES[key]);
const set = (player, key, value) => player.setAttribute?.(ATTRIBUTES[key], value);

/** A salted SHA-256 of the PIN (the player's name is the salt). */
function hash(player, pin) {
  const salt = String(player.getUsername?.() ?? "").toLowerCase();
  return crypto.createHash("sha256").update(`bank-pin:${salt}:${pin}`).digest("hex");
}

/**
 * Where the player connects from, as a salted SHA-256 of the host address, so the offline window can
 * tell a login from somewhere else without saving the address itself.
 */
function hostKey(player) {
  const salt = String(player.getUsername?.() ?? "").toLowerCase();
  return crypto.createHash("sha256").update(`bank-pin-host:${salt}:${player.getHostAddress?.() ?? ""}`).digest("hex");
}

function delayDays(player) {
  const days = Number(get(player, "delay"));
  return data.delays.includes(days) ? days : data.defaultDelay;
}

/** A pending PIN or deletion whose time has come takes effect. */
function settle(player) {
  const pendingAt = Number(get(player, "pendingAt")) || 0;
  if (pendingAt && now() >= pendingAt) {
    set(player, "hash", get(player, "pendingHash"));
    set(player, "pendingHash", "");
    set(player, "pendingAt", 0);
    player.sendMessage?.(data.messages.active);
  }
  const deleteAt = Number(get(player, "deleteAt")) || 0;
  if (deleteAt && now() >= deleteAt) {
    set(player, "hash", "");
    set(player, "deleteAt", 0);
    unlocked.delete(player);
    player.sendMessage?.(data.messages.removed);
  }
}

const hasPin = (player) => Boolean(get(player, "hash"));
const pendingPin = (player) => (Number(get(player, "pendingAt")) || 0) > 0;
const pendingDelete = (player) => (Number(get(player, "deleteAt")) || 0) > 0;
const isUnlocked = (player) => unlocked.has(player);
const unlock = (player) => unlocked.add(player);
const lock = (player) => unlocked.delete(player);

function fill(text, values) {
  return text.replace(/\[(\w+)\]/g, (whole, key) => (values[key] !== undefined ? String(values[key]) : whole));
}

/** Runs `action` once, `ticks` game ticks from now; keyed to the player, so a logout cancels it. */
function later(player, ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), player, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

module.exports = {
  init, setClock, now, get, set, hash, hostKey, delayDays, settle, hasPin, pendingPin, pendingDelete, isUnlocked, unlock, lock, fill, later,
  ATTRIBUTES, MS_PER_DAY,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
  get ids() { return ids; },
};
