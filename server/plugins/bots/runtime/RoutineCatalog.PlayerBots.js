"use strict";

// A routine is independent of its deployment: site, manual and startup callers
// all refer to the same compiled activity ID and use the same bot brain.
const { activities, resolvers = [] } = require("../../../data/definitions/bot-activities.json");
const builtins = new Set(activities.filter(activity => !activity.ephemeral).map(activity => activity.id));
const internalIds = new Set([...resolvers, ...activities.filter(activity => activity.ephemeral)].map(activity => activity.id));
const isBuiltinRoutineId = id => builtins.has(id);
// Persisted references are checked for syntax even when their plugin is offline.
// Deployability is resolved against the live registry, never inferred from an ID prefix.
const isRoutineId = id => typeof id === "string" && /^[a-z][a-z0-9_]{0,54}$/.test(id);
const isDeployableRoutine = activity => !!activity && !activity.resolver && !activity.ephemeral && (activity.codeDefined === true || builtins.has(activity.id));

function listedRoutines(registry) {
  // Roam is a building block. Legacy plans and startup schedules can still reference it.
  return (registry?.activities ?? []).filter(activity => isDeployableRoutine(activity) && activity.id !== "roam");
}

const routineNames = Object.freeze(require("../../../data/definitions/bot-routine-names.json"));
const routineName = id => Object.hasOwn(routineNames, id) ? routineNames[id] : id;
const matchRoutineIds = Object.freeze({ "castle-wars": "castle_wars_match", "soul-wars": "soul_wars_match", "pest-control": "pest_control_match" });
const matchIds = new Set(Object.values(matchRoutineIds));
const isRoutineReference = id => isRoutineId(id) && !internalIds.has(id) && !matchIds.has(id) && id !== "mixed";
function nativeRoutineId(mode, id) {
  const expected = Object.hasOwn(matchRoutineIds, mode) ? matchRoutineIds[mode] : undefined;
  if (!expected) return null;
  return id === expected || (mode === "pest-control" ? id === "pest-control-novice" : id === "mixed") ? expected : null;
}
module.exports = { isRoutineId, isRoutineReference, isBuiltinRoutineId, isDeployableRoutine, listedRoutines, routineNames, routineName, matchRoutineIds, nativeRoutineId };
