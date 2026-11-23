"use strict";

// The panel has a renderer for each of these setup fields. A code routine opts
// into the fields it can tolerate; the runtime still validates the actual kit.
const SETUP_FIELDS = Object.freeze(["location", "skills", "inventory", "equipment"]);
const UI_FIELDS = new Map([
  ["location", "location"], ["skills", "skills"],
  ["inventory", "inventory"], ["replaceInventory", "inventory"],
  ["equipment", "equipment"], ["replaceEquipment", "equipment"],
]);

function normalizeRoutineOverrideFields(fields = []) {
  if (!Array.isArray(fields) || fields.some(field => !SETUP_FIELDS.includes(field)) || new Set(fields).size !== fields.length) {
    throw new Error("deploymentOverrides must list distinct supported setup fields: location, skills, inventory, equipment.");
  }
  return fields.slice();
}

function routineOverrideFields(activity) {
  if (!activity) return [];
  return activity.deploymentOverrides ?? (activity.codeDefined ? [] : SETUP_FIELDS);
}

function validateRoutineOverrides(activity, overrides = {}) {
  const allowed = routineOverrideFields(activity);
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Supply overrides as an object.");
  for (const key of Object.keys(overrides)) {
    if (!allowed.includes(UI_FIELDS.get(key))) throw new Error(`This routine does not allow '${key}' as a deployment override.`);
  }
  if ((Object.hasOwn(overrides, "location") && !overrides.location) ||
      (Object.hasOwn(overrides, "skills") && (!overrides.skills || typeof overrides.skills !== "object" || Array.isArray(overrides.skills)))) {
    throw new Error("Supply a valid location or starting skill levels.");
  }
  for (const [key, flag] of [["inventory", "replaceInventory"], ["equipment", "replaceEquipment"]]) {
    if ((Object.hasOwn(overrides, key) || Object.hasOwn(overrides, flag)) && (overrides[flag] !== true || !Array.isArray(overrides[key]))) {
      throw new Error(`To replace ${key}, supply its replacement flag and item list.`);
    }
  }
  return overrides;
}

module.exports = { normalizeRoutineOverrideFields, routineOverrideFields, validateRoutineOverrides };
