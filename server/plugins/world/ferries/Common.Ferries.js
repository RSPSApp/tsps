/**
 * What the ferry units share: plugins/world/data/ferries.json, the one-trip-at-a-time guard,
 * quest gates, timers and the transcript helpers.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let core = null;
let data = null;
/** Players at sea or mid-fade, mapped to their trip ({ route, land }). */
const trips = new Map();

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "ferries.json"), "utf8"));
}

function route(name) {
  return data.routes[name] ?? null;
}

function travelling(player) {
  return trips.has(player);
}

function begin(player, trip) {
  trips.set(player, trip);
}

function end(player) {
  trips.delete(player);
}

/** A trip has landed: the route name, after the move (diary/content listeners). */
function arrived(player, routeName) {
  if (api) api.emitCustomEvent("ferries:arrived", { player, route: routeName });
}

function toLocation([x, y, z]) {
  return new core.Location(x, y, z ?? 0);
}

/** Runs `action` once, `ticks` from now, while the player is still logged in. */
function later(player, ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), player, false);
    }

    execute() {
      this.stop();
      if (player.isRegistered?.() !== false) action();
    }
  })());
}

function questState(player, key) {
  const complete = { player, key, complete: false };
  api.emitCustomEvent("quest:is-complete", complete);
  const started = { player, key, started: false };
  api.emitCustomEvent("quest:is-started", started);
  return { complete: complete.complete === true, started: started.started === true || complete.complete === true };
}

/** A route's gate (gates in ferries.json): whether the player may take it. */
function passes(player, gateName) {
  const gate = gateName ? data.gates[gateName] : null;
  if (!gate) return true;
  const state = questState(player, gate.quest);
  return gate.complete ? state.complete : state.started;
}

/** The NPC's base gameval (which dock's ferryman it is). */
function npcGameval(npc, npcId) {
  const id = npc?.getId?.() ?? npcId;
  return core.CacheDefinitions.getNpcNames().get(id) ?? "";
}

/** The loc's base gameval (a multiloc's own name, not the variant the player sees). */
function locGameval(objectId) {
  return core.CacheDefinitions.getLocNames().get(objectId) ?? "";
}

/** The NPC as the player sees it: the multi-NPC's variant names the transcript. */
function speaker(event) {
  return { npc: event.npc ?? null, npcId: event.definition?.getId?.() ?? event.npcId ?? event.npc?.getId?.() };
}

/** Plays a transcript variant, or with `select` only the steps it picks; false if nothing played. */
function playTranscript(player, who, options) {
  const request = { player, npc: who?.npc ?? null, npcId: who?.npcId, handled: false, ...options };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled === true;
}

/** The first condition in the steps (depth first) with this text, and its steps. */
function conditionSteps(steps, text) {
  for (const step of steps ?? []) {
    if (step?.type === "condition" && step.text === text) return step.steps ?? [];
    for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
      const found = conditionSteps(nested, text);
      if (found) return found;
    }
  }
  return null;
}

module.exports = {
  init, route, travelling, begin, end, arrived, toLocation, later, passes, npcGameval, locGameval, speaker, playTranscript,
  conditionSteps, trips,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
