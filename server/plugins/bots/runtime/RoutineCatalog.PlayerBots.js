"use strict";

// A routine is independent of its deployment: site, manual and startup callers
// all refer to the same compiled activity ID and use the same bot brain.
const { activities } = require("../../../data/definitions/bot-activities.json");
const builtins = new Set(activities.filter(activity => !activity.ephemeral).map(activity => activity.id));
const isCustomRoutineId = id => typeof id === "string" && /^custom_[a-z0-9_]{1,48}$/.test(id);
const isCodeRoutineId = id => typeof id === "string" && /^plugin_[a-z0-9_]{1,48}$/.test(id);
const isRoutineId = id => isCustomRoutineId(id) || isCodeRoutineId(id) || builtins.has(id);
const isDeployableRoutine = activity => !!activity && !activity.resolver && !activity.ephemeral && (isCodeRoutineId(activity.id) ? activity.codeDefined === true : isCustomRoutineId(activity.id) ? activity.manual === true : builtins.has(activity.id));

function listedRoutines(registry) {
  // Roam is a building block. Legacy plans and startup schedules can still reference it.
  return (registry?.activities ?? []).filter(activity => isDeployableRoutine(activity) && activity.id !== "roam");
}

const routineNames = Object.freeze(require("../../../data/definitions/bot-routine-names.json"));
const routineName = id => Object.hasOwn(routineNames, id) ? routineNames[id] : id;
const matchRoutineIds = Object.freeze({ "castle-wars": "castle_wars_match", "soul-wars": "soul_wars_match", "pest-control": "pest_control_match" });
function nativeRoutineId(mode, id) {
  const expected = Object.hasOwn(matchRoutineIds, mode) ? matchRoutineIds[mode] : undefined;
  if (!expected) return null;
  return id === expected || (mode === "pest-control" ? id === "pest-control-novice" : id === "mixed") ? expected : null;
}
module.exports = { isRoutineId, isCodeRoutineId, isDeployableRoutine, listedRoutines, routineNames, routineName, matchRoutineIds, nativeRoutineId };
