"use strict";

const configuredEvents = require("./data/events.json");
const TASK_KEY = "event-scheduler:clock";
const CHECK_INTERVAL_MS = 60_000;
const COMPLETIONS_ATTRIBUTE = "events:completions";
const COMPLETION_KEY = /^[a-z][a-z0-9-]*$/;
const MAX_STACK = 2147483647;
const granting = new WeakSet();
const definitions = new Map();
const overrides = new Map();
const active = new Set();
let clockTask = null;
let running = false;
let dispatching = false;
let reevaluate = false;
let stopRequested = false;

function utcInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error("Event dates must be explicit UTC ISO instants");
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) {
    throw new Error("Invalid event date");
  }
  return ms;
}

function readDefinitions() {
  if (!Array.isArray(configuredEvents)) throw new Error("events.json must contain an array");
  const result = new Map();
  for (const entry of configuredEvents) {
    if (!entry || typeof entry.key !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.key) || entry.key === "reset" || result.has(entry.key)) {
      throw new Error("Event keys must be unique lowercase names (reset is reserved)");
    }
    if (typeof entry.enabled !== "boolean" || !Array.isArray(entry.windows) || entry.windows.length === 0) {
      throw new Error(`Event ${entry.key} requires enabled and at least one window`);
    }
    const windows = entry.windows.map(window => {
      const start = utcInstant(window?.start);
      const end = utcInstant(window?.end);
      if (end <= start) throw new Error(`Event ${entry.key} has an empty or reversed window`);
      return { start, end };
    });
    result.set(entry.key, { enabled: entry.enabled, windows });
  }
  return result;
}

function evaluate(api) {
  if (!running) return;
  if (dispatching) { reevaluate = true; return; }
  dispatching = true;
  try {
    do {
      reevaluate = false;
      const now = Date.now();
      for (const [key, event] of definitions) {
        if (stopRequested) break;
        const next = overrides.has(key) ? overrides.get(key) :
          event.enabled && event.windows.some(window => now >= window.start && now < window.end);
        if (next === active.has(key)) continue;
        // Finish notifying every consumer before a reentrant close can publish its stop.
        if (next) active.add(key);
        else active.delete(key);
        api.emitCustomEvent("events:active", Object.freeze({ key, active: next }));
      }
    } while (reevaluate && !stopRequested);
  } finally {
    dispatching = false;
    if (stopRequested) { stopRequested = false; stop(api); }
  }
}

function start(api) {
  if (running || dispatching) return;
  let parsed;
  try {
    parsed = readDefinitions();
  } catch (error) {
    api.log(`EventScheduler: ${error.message}; scheduler not started`);
    return;
  }
  definitions.clear();
  for (const [key, value] of parsed) definitions.set(key, value);
  running = true;
  const { Task, TaskManager, GameConstants } = api.core;
  clockTask = new (class EventClock extends Task {
    constructor() {
      super(Math.max(1, Math.ceil(CHECK_INTERVAL_MS / GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE)), TASK_KEY);
    }
    execute() { evaluate(api); }
  })();
  TaskManager.submit(clockTask);
  evaluate(api);
}

function stop(api) {
  if (dispatching) { stopRequested = true; return; }
  running = false;
  if (clockTask) clockTask.stop();
  clockTask = null;
  api.core.TaskManager.cancelTasks(TASK_KEY);
  const ending = [...active];
  active.clear();
  overrides.clear();
  definitions.clear();
  reevaluate = false;
  // Content owns its temporary NPCs/objects and receives the same end notification on shutdown.
  dispatching = true;
  try {
    for (const key of ending) api.emitCustomEvent("events:active", Object.freeze({ key, active: false }));
  } finally {
    dispatching = false;
    stopRequested = false;
  }
}

function answerStatus(request) {
  if (request && typeof request === "object") request.active = running && active.has(request.key);
}

function completions(player) {
  const value = player.getAttribute(COMPLETIONS_ATTRIBUTE);
  return Array.isArray(value) ? value.filter(key => typeof key === "string") : [];
}

function completionKey(request) {
  const key = request.completion ?? request.eventKey;
  return typeof key === "string" && COMPLETION_KEY.test(key) ? key : null;
}

function answerCompleted(request) {
  if (!request?.player) return;
  const key = completionKey(request);
  request.completed = key !== null && completions(request.player).includes(key);
}

function rewardItems(api, rewards) {
  if (!Array.isArray(rewards)) return null;
  const items = [];
  for (const reward of rewards) {
    const id = reward?.itemId, amount = reward?.amount ?? 1;
    // forId answers ids past the cache with a default definition, so bound them here.
    if (!Number.isInteger(id) || id <= 0 || id >= api.core.CacheDefinitions.getCounts().items) return null;
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_STACK) return null;
    items.push(new api.core.Item(id, amount));
  }
  return items;
}

// Plans every reward on a copy of the inventory with the container's own stack rules
// (getAddableAmount/add), as Christmas Din-Dins' reward plan does. Items the event
// consumes (`take`) leave the copy first, so their slots are free for the rewards.
// Returns the planned items, "missing" when a taken item is not held, or null when a
// reward won't fit.
function plan(api, player, items, take = []) {
  const copy = new api.core.Inventory(player).setItems(player.getInventory().getCopiedItems());
  for (const item of take) {
    if (copy.getAmount(item.getId()) < item.getAmount()) return "missing";
    // The copy is bound to the player: never refresh it, or the client sees uncommitted items.
    copy.deleted(item.getId(), item.getAmount(), false);
  }
  for (const item of items) {
    if (copy.getAddableAmount(item) !== item.getAmount()) return null;
    // The copy is bound to the player: never refresh it, or the client sees uncommitted items.
    copy.add(item, false);
  }
  return copy.getItems();
}

function grantReward(api, request) {
  if (!request || typeof request !== "object") return;
  request.granted = false;
  if (request.player && granting.has(request.player)) {
    // A listener of the unlock below must not grant again against a stale plan.
    request.reason = "busy";
    return;
  }
  if (request.player) granting.add(request.player);
  try {
    grantOnce(api, request);
  } finally {
    if (request.player) granting.delete(request.player);
  }
}

function grantOnce(api, request) {
  const {player} = request, key = completionKey(request);
  const items = rewardItems(api, request.rewards ?? []);
  const take = rewardItems(api, request.take ?? []);
  const unlock = request.unlock ?? [];
  if (!player || typeof request.eventKey !== "string" || key === null || !items || !take || !Array.isArray(unlock)) {
    request.reason = "invalid";
    return;
  }
  if (!(running && active.has(request.eventKey))) {
    request.reason = "inactive";
    return;
  }
  if (completions(player).includes(key)) {
    request.reason = "already-complete";
    return;
  }
  const planned = plan(api, player, items, take);
  if (planned === "missing") {
    request.reason = "missing-items";
    return;
  }
  if (!planned) {
    request.reason = "no-space";
    return;
  }
  if (unlock.length) {
    const unlocking = {player, items: unlock, accepted: false};
    api.emitCustomEvent("holiday-rewards:unlock", unlocking);
    if (!unlocking.accepted) {
      request.reason = "unlock-refused";
      return;
    }
  }
  player.getInventory().setItems(planned);
  player.getInventory().refreshItems();
  player.setAttribute(COMPLETIONS_ATTRIBUTE, [...completions(player), key]);
  request.granted = true;
  request.reason = null;
}

// Records a completion without granting anything: content imports claims its own saves
// already show (before this helper existed) and settles rewards handed out another way.
// Idempotent, and independent of the event window.
function recordCompletion(request) {
  if (!request?.player) return;
  const key = completionKey(request);
  request.recorded = key !== null;
  if (key === null || completions(request.player).includes(key)) return;
  request.player.setAttribute(COMPLETIONS_ATTRIBUTE, [...completions(request.player), key]);
}

function forceEvent(api, { player, parts }) {
  if (!running) {
    player.sendMessage("The event scheduler is not running.");
    return;
  }
  const key = parts[1];
  const mode = parts[2] ?? "on";
  if (key === "reset" && parts.length === 2) {
    overrides.clear();
    evaluate(api);
    player.sendMessage("Event test overrides cleared; configured windows restored.");
    return;
  }
  if (!key || parts.length > 3 || !["on", "off", "auto"].includes(mode)) {
    player.sendMessage("Usage: ::forceevent <key> [on|off|auto], or ::forceevent reset");
    return;
  }
  if (!definitions.has(key)) {
    player.sendMessage(`Unknown event key: ${key}.`);
    return;
  }
  if (mode === "auto") overrides.delete(key);
  else overrides.set(key, mode === "on");
  evaluate(api);
  player.sendMessage(`Event ${key} test override: ${mode}.`);
}

module.exports = {
  name: "EventScheduler",
  register(api) {
    api.onServerStartup(start.bind(null, api));
    api.onServerShutdown(stop.bind(null, api));
    api.persistAttribute(COMPLETIONS_ATTRIBUTE, []);
    api.onCustomEvent("events:status", answerStatus);
    api.onCustomEvent("events:completed", answerCompleted);
    api.onCustomEvent("events:record-completion", recordCompletion);
    api.onCustomEvent("events:grant-reward", grantReward.bind(null, api));
    api.registerCommand("forceevent", forceEvent.bind(null, api), api.core.PlayerRights.OWNER,
      "Override a configured holiday window for testing; reset restores the calendar");
  },
};
