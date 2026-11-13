"use strict";

const ACTIVITY_LAUNCHER_EVENT = "bots:collect-launchers";
const MAX_ACTIVITY_LAUNCHERS = 50;
const MAX_ACTIVITY_SETUP_FIELDS = 3;
const LAUNCHER_ID = /^[a-z][a-z0-9._-]{0,47}$/;
const SETUP_VALUE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function text(value, max, label, optional = false) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new TypeError(`${label} must be a string of 1–${max} characters.`);
  }
  return value.trim();
}

function normalizeSpawnLocation(location) {
  if (location === undefined || location === null) return null;
  if (!location || typeof location !== "object" ||
      ![location.x, location.y, location.z].every(Number.isInteger) ||
      location.x < 0 || location.x > 16383 || location.y < 0 || location.y > 16383 || location.z < 0 || location.z > 3) {
    throw new TypeError("Launcher spawnLocation must contain valid world x, y and plane coordinates.");
  }
  return Object.freeze({ x: location.x, y: location.y, z: location.z });
}

function normalizeSetupFields(fields) {
  if (fields === undefined) return Object.freeze([]);
  if (!Array.isArray(fields) || fields.length > MAX_ACTIVITY_SETUP_FIELDS) {
    throw new TypeError(`Launcher setupFields must be an array with at most ${MAX_ACTIVITY_SETUP_FIELDS} entries.`);
  }
  const ids = new Set();
  return Object.freeze(fields.map(field => {
    if (!field || typeof field !== "object" || Array.isArray(field)) throw new TypeError("Launcher setup fields must be objects.");
    const id = text(field.id, 32, "Setup field id");
    if (!SETUP_VALUE_ID.test(id) || ids.has(id)) throw new TypeError("Setup field ids must be unique lowercase identifiers.");
    ids.add(id);
    if (!Array.isArray(field.choices) || field.choices.length < 2 || field.choices.length > 8) {
      throw new TypeError("Each setup field needs between 2 and 8 choices.");
    }
    const choiceIds = new Set();
    const choices = Object.freeze(field.choices.map(choice => {
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) throw new TypeError("Setup choices must be objects.");
      const value = text(choice.value, 32, "Setup choice value");
      if (!SETUP_VALUE_ID.test(value) || choiceIds.has(value)) throw new TypeError("Setup choice values must be unique lowercase identifiers.");
      choiceIds.add(value);
      return Object.freeze({ value, label: text(choice.label, 32, "Setup choice label") });
    }));
    const defaultValue = field.defaultValue ?? choices[0].value;
    if (!choiceIds.has(defaultValue)) throw new TypeError(`Setup field '${id}' defaultValue must match one of its choices.`);
    return Object.freeze({ id, label: text(field.label, 24, "Setup field label"), choices, defaultValue });
  }));
}

function validateSetupValues(fields, values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return { ok: false, error: "Activity setup must be an object." };
  const allowed = new Set(fields.map(field => field.id));
  if (Object.keys(values).some(key => !allowed.has(key))) return { ok: false, error: "Activity setup contains an unknown field." };
  const result = {};
  for (const field of fields) {
    const value = values[field.id] ?? field.defaultValue;
    if (!field.choices.some(choice => choice.value === value)) return { ok: false, error: `Invalid value for activity setup '${field.label}'.` };
    result[field.id] = value;
  }
  return { ok: true, value: result };
}

function normalizeLauncher(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new TypeError("Launcher definition must be an object.");
  const id = text(definition.id, 48, "Launcher id");
  if (!LAUNCHER_ID.test(id) || id.startsWith("custom_")) throw new TypeError("Launcher id must be a lowercase plugin id, not a custom routine id.");
  if (typeof definition.deploy !== "function") throw new TypeError("Launcher needs a deploy function.");
  return Object.freeze({
    kind: "activity",
    id,
    key: `activity:${id}`,
    name: text(definition.name, 48, "Launcher name"),
    detail: text(definition.detail ?? "Activity", 24, "Launcher detail"),
    description: text(definition.description, 180, "Launcher description"),
    setupSummary: text(definition.setupSummary ?? "Activity defaults are applied by its plugin.", 160, "Launcher setup summary"),
    setupFields: normalizeSetupFields(definition.setupFields),
    spawnLocation: normalizeSpawnLocation(definition.spawnLocation),
    deploy: definition.deploy,
  });
}

/**
 * Collect synchronous contributions from activity/minigame plugins. Implementations are
 * trusted server plugins, never user-imported routine JSON. The event is re-emitted when the
 * launcher is opened so registration order cannot hide providers loaded later.
 */
function collectActivityLaunchers(api) {
  if (typeof api?.emitCustomEvent !== "function") return [];
  const definitions = [];
  api.emitCustomEvent(ACTIVITY_LAUNCHER_EVENT, {
    register(definition) {
      if (definitions.length < MAX_ACTIVITY_LAUNCHERS) definitions.push(definition);
    },
  });
  const launchers = [];
  const seen = new Set();
  for (const definition of definitions) {
    try {
      const launcher = normalizeLauncher(definition);
      if (seen.has(launcher.id)) continue;
      seen.add(launcher.id);
      launchers.push(launcher);
    } catch (error) {
      api.log?.("bot_activity_launcher_rejected", { id: definition?.id ?? null, error: error.message });
    }
  }
  return launchers.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

module.exports = { ACTIVITY_LAUNCHER_EVENT, MAX_ACTIVITY_LAUNCHERS, MAX_ACTIVITY_SETUP_FIELDS, normalizeLauncher, normalizeSpawnLocation, normalizeSetupFields, validateSetupValues, collectActivityLaunchers };
