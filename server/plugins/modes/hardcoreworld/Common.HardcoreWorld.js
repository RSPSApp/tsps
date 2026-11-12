"use strict";

/**
 * Hardcore Worlds: what the units share. A world runs it when its plugin config says so
 * (`"HardcoreWorld:enabled": true`); every login is then the account's Hardcore character, a
 * save of its own (persistence/PlayerProfile "hardcore"), and the world tells the client it is a
 * Hardcore world (script 876's "HARDCORE WORLD", world-list flag 0x800). docs/hardcore-worlds.md.
 */
const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "hardcore-world.json"), "utf8"));
const HARDCORE_PROFILE = "hardcore";

/** 1 from the character's start until it first leaves Death's Office (hc_first_time_leaving_tutorial_island). */
const ARRIVAL_ATTRIBUTE = "hardcore-world:arrival";
/** The day the character died, counted from 27 February 2002 (hc_died_date), 0 while alive. */
const DIED_DATE_ATTRIBUTE = "hardcore-world:died-date";
/** True from a death that counts until the player picks Reset or Transfer. */
const CHOICE_PENDING_ATTRIBUTE = "hardcore-world:choice-pending";
/** The option highlighted on the death choice (hc_death_option): 0 none, 1 Reset, 2 Transfer. */
const DEATH_OPTION_ATTRIBUTE = "hardcore-world:death-option";
/** Set on the live player once it has chosen, so the logout save leaves the save alone (Reset) or the copy follows it (Transfer). */
const LEAVING_ATTRIBUTE = "hardcore-world:leaving";
const SKIP_PERSISTENCE_ATTRIBUTE = "bot-skip-persistence";

/** The resets file: name key -> { resets }. Kept apart from the saves a Reset deletes. */
const STORE_ENV = "HARDCORE_WORLD_FILE";
const DEFAULT_STORE = path.join("data", "saves", "hardcore-world.json");
/** Days from 27 February 2002, live's date counter (as ironman_hardcore_downgradedate). */
const DAY_ZERO = Date.UTC(2002, 1, 27);
const DAY_MS = 24 * 60 * 60 * 1000;

let api = null;
let enabled = false;
let store = null;
const ids = { varbits: {}, objs: {} };

/** Reads the world's config; on a Hardcore world claims its profile and world type. Returns whether it is one. */
function init(pluginApi) {
  api = pluginApi;
  enabled = api.getPluginConfig(DATA.config, false) === true;
  if (!enabled) return false;
  api.setWorldProfile(HARDCORE_PROFILE);
  api.setWorldType(DATA.worldType);
  const { CacheDefinitions } = api.core;
  for (const [key, name] of Object.entries(DATA.varbits)) ids.varbits[key] = CacheDefinitions.getVarbitId(name);
  for (const [key, name] of Object.entries(DATA.objs)) ids.objs[key] = CacheDefinitions.getObjId(name);
  ids.choiceInterface = CacheDefinitions.getInterfaceId(DATA.deathChoice.interface);
  ids.resetButton = CacheDefinitions.getComponentId(DATA.deathChoice.reset);
  ids.transferButton = CacheDefinitions.getComponentId(DATA.deathChoice.transfer);
  return true;
}

function isEnabled() {
  return enabled;
}

function core() {
  return api.core;
}

function pluginApi() {
  return api;
}

/** A character of this world (never a main one visiting through some other path). */
function isHardcore(player) {
  return enabled && player?.getProfile?.() === HARDCORE_PROFILE;
}

function setVarbit(player, key, value) {
  const id = ids.varbits[key];
  if (Number.isInteger(id)) player.getPacketSender().sendVarbit(id, value | 0);
}

/** `text` with each {key} from `values`. */
function format(text, values) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

function today(now = Date.now()) {
  return Math.floor((now - DAY_ZERO) / DAY_MS);
}

/** Runs `action` `ticks` game ticks from now, while the player is still online. */
function later(player, ticks, action) {
  const { Task, TaskManager } = core();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks | 0), player, false);
    }

    execute() {
      this.stop();
      if (player.isRegistered?.() !== false) action();
    }
  })());
}

// ---------------------------------------------------------------- the resets file

function storeFile() {
  return process.env[STORE_ENV] || path.join(process.cwd(), DEFAULT_STORE);
}

function loadStore() {
  if (store) return store;
  store = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    for (const [key, entry] of Object.entries(saved.characters ?? {})) store.set(key, entry);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[hardcore-world] could not read the resets file", error);
  }
  return store;
}

function writeStore() {
  const target = storeFile();
  const temporary = `${target}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify({ characters: Object.fromEntries(loadStore()) }, null, 2));
  fs.renameSync(temporary, target);
}

function nameKey(name) {
  return core().Accounts?.key?.(name) ?? String(name).trim().toLowerCase();
}

/** How often the character of this name has reset (hc_reset_count); it outlives every reset. */
function resetCount(name) {
  return Number(loadStore().get(nameKey(name))?.resets) || 0;
}

function recordReset(name) {
  const key = nameKey(name);
  const entry = loadStore().get(key) ?? {};
  loadStore().set(key, { ...entry, resets: (Number(entry.resets) || 0) + 1 });
  writeStore();
}

/** For tests: forget the cached file. */
function resetStoreCache() {
  store = null;
}

module.exports = {
  DATA, HARDCORE_PROFILE, ids,
  ARRIVAL_ATTRIBUTE, DIED_DATE_ATTRIBUTE, CHOICE_PENDING_ATTRIBUTE, DEATH_OPTION_ATTRIBUTE,
  LEAVING_ATTRIBUTE, SKIP_PERSISTENCE_ATTRIBUTE,
  init, isEnabled, core, api: pluginApi, isHardcore, setVarbit, format, today, later,
  resetCount, recordReset, resetStoreCache,
};
