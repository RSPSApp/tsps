"use strict";

const fs = require("node:fs");
const path = require("node:path");
const FILE = path.resolve(__dirname, "../../../data/saves/bot-activation.json");
const ACTIVATION_ATTRIBUTE = "player-bots:activation-id";
const { isRoutineId } = require("./RoutineCatalog.PlayerBots");
const NATIVE = new Map([
  ["wilderness-regional", { name: "Wilderness roaming PK bots", trigger: "Nearby players" }],
  ["wilderness-hotspots", { name: "Wilderness hotspot PK bots", trigger: "World population" }],
  ["world-sites", { name: "Skilling site bots", trigger: "Site population" }],
  ["world", { name: "Configured world bots", trigger: "World population" }],
  ["ai", { name: "AI roster", trigger: "Configured roster" }],
  ["castle-wars", { name: "Castle Wars bots", trigger: "Lobby or manual roster" }],
  ["soul-wars", { name: "Soul Wars bots", trigger: "Lobby or manual roster" }],
  ["last-man-standing", { name: "Last Man Standing bots", trigger: "Waiting area" }],
  ["bounty-hunter", { name: "Bounty Hunter bots", trigger: "Match queue" }],
  ["pest-control", { name: "Pest Control bots", trigger: "Lander queue" }],
]);

function known(id) { return typeof id === "string" && (NATIVE.has(id) || isRoutineId(id)); }

function validateState(state) {
  if (!state || state.version !== 1 || !state.overrides || typeof state.overrides !== "object" || Array.isArray(state.overrides)) {
    throw new Error("Invalid bot activation file.");
  }
  const overrides = new Map();
  for (const [id, entry] of Object.entries(state.overrides)) {
    if (!known(id) || typeof entry?.enabled !== "boolean" || (entry.count !== undefined && (!isRoutineId(id) || !Number.isSafeInteger(entry.count) || entry.count < 1))) {
      throw new Error(`Invalid bot activation setting: ${id}.`);
    }
    overrides.set(id, { enabled: entry.enabled, ...(entry.count === undefined ? {} : { count: entry.count }) });
  }
  return overrides;
}

function createActivationStore(file) {
  let overrides;
  function settings() {
    if (!overrides) {
      try { overrides = validateState(JSON.parse(fs.readFileSync(file, "utf8"))); }
      catch (error) { if (error.code === "ENOENT") overrides = new Map(); else throw error; }
    }
    return overrides;
  }
  return {
    get: id => settings().get(id),
    entries: () => [...settings()],
    allowed: id => !known(id) || settings().get(id)?.enabled !== false,
    set(id, enabled, count) {
      const next = new Map(settings());
      next.set(id, { enabled, ...(count === undefined ? {} : { count }) });
      const serialized = { version: 1, overrides: Object.fromEntries(next) };
      validateState(serialized);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      try {
        fs.writeFileSync(temp, `${JSON.stringify(serialized, null, 2)}\n`);
        fs.renameSync(temp, file);
      } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; } }
      overrides = next;
    },
  };
}

const activation = createActivationStore(FILE);
let reported = false;
function canSpawn(id) {
  try { return activation.allowed(id); }
  catch (error) {
    if (!reported) { console.warn(`[bots] invalid activation state: ${error.message}`); reported = true; }
    // A corrupt local file must not re-enable a deliberately disabled deployment.
    return !known(id);
  }
}

function customSchedule(config, store = activation) {
  const result = new Map(config.map(({ id, count }) => [id, count]));
  for (const [id, entry] of store.entries()) {
    if (!isRoutineId(id)) continue;
    if (entry.enabled) result.set(id, entry.count ?? result.get(id) ?? 1);
    else result.delete(id);
  }
  return result;
}

module.exports = { FILE, ACTIVATION_ATTRIBUTE, NATIVE, activation, canSpawn, customSchedule, createActivationStore };
