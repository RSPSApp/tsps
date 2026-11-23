"use strict";

const { isRoutineId, isDeployableRoutine, nativeRoutineId, matchRoutineIds } = require("./RoutineCatalog.PlayerBots");
const { NATIVE } = require("./Activation.PlayerBots");
const builtinDefinitions = require("../../../data/definitions/bot-activities.json");
const { validateSpawnSetup } = require("./SpawnSetup.PlayerBots");
const { normalizePlan, normalizePlanOverrideFields, planMode } = require("./DeploymentPlans.PlayerBots");
const { normalizeRoutineOverrideFields } = require("./DeploymentOverrides.PlayerBots");
const CODE_DEFINITIONS_EVENT = "bots:collect-definitions";
const LIMIT = 100;
const reservedRoutineIds = new Set([
  ...[...builtinDefinitions.activities, ...(builtinDefinitions.resolvers ?? [])].map(definition => definition.id),
  ...Object.values(matchRoutineIds), ...NATIVE.keys(), "developer", "auto", "recruit", "follow", "follow_owner", "sparring", "mixed",
]);
const nameOf = value => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 48 || /[<>\u0000-\u001f]/.test(value)) throw new Error("Choose a plain-text name of 1–48 characters.");
  return value.trim();
};

/** Trusted plugin registration. The factory builds normal Brain steps; it is
 * never read from a file uploaded to the panel or passed over HTTP/MCP. */
function collectCodeDefinitions(api, world, byId, compileAction, compileCondition) {
  if (typeof api?.emitCustomEvent !== "function") return { routines: [], plans: [] };
  const suppliedRoutines = [], suppliedPlans = [];
  api.emitCustomEvent(CODE_DEFINITIONS_EVENT, Object.freeze({
    registerRoutine(definition) { if (suppliedRoutines.length < LIMIT) suppliedRoutines.push(definition); },
    registerPlan(definition) { if (suppliedPlans.length < LIMIT) suppliedPlans.push(definition); },
  }));
  const reject = (kind, definition, error) => api.log?.("bot_code_definition_failed", { kind, id: definition?.id ?? null, error: String(error?.message ?? error) });
  const definitions = new Map(byId), routines = [], plans = [];
  const builtinModes = new Set([...definitions.values()].map(activity => activity.mode));
  for (const definition of suppliedRoutines) {
    try {
      const { id, repeat = true, spawnSetup, createActions, capacity = 20 } = definition;
      if (!isRoutineId(id)) throw new Error("Routine IDs must be 1–55 lowercase letters, digits or underscores, starting with a letter.");
      if (definitions.has(id) || builtinModes.has(id) || reservedRoutineIds.has(id)) throw new Error(`Routine ID '${id}' is already used or reserved.`);
      const name = nameOf(definition.name);
      const deploymentOverrides = normalizeRoutineOverrideFields(definition.deploymentOverrides);
      if (typeof repeat !== "boolean" || !Number.isInteger(capacity) || capacity < 1 || capacity > 100 || typeof createActions !== "function") throw new Error("Specify repeat, capacity (1–100) and a createActions function.");
      const setup = spawnSetup === undefined ? null : structuredClone({ location: null, skills: {}, inventory: [], equipment: [], ...spawnSetup });
      const at = setup?.location;
      if (at != null && ![at.x, at.y, at.z].every((value, i) => Number.isInteger(value) && value >= 0 && value <= (i === 2 ? 3 : 16383))) throw new Error("Start location must use valid world coordinates and plane.");
      const setupError = setup && validateSpawnSetup(setup, world.core);
      if (setupError) throw new Error(`Start setup: ${setupError}`);
      const actions = createActions({ api, core: world.core, action: compileAction, condition: compileCondition });
      if (!Array.isArray(actions) || actions.length < 1 || actions.length > 50 || actions.some(action => !action || typeof action.update !== "function")) throw new Error("Return 1–50 synchronous Brain actions.");
      const routine = { id, name, mode: id, manual: true, codeDefined: true, capacity, repeat, oneShot: !repeat, failureCooldownMs: 15000,
        spawnSetup: setup, deploymentOverrides, actions, requires: [], setup: [], produces: [] };
      definitions.set(id, routine);
      routines.push(routine);
    } catch (error) { reject("routine", definition, error); }
  }
  const seenPlans = new Set();
  for (const definition of suppliedPlans) {
    try {
      if (typeof definition?.id !== "string" || !definition.id.startsWith("plugin-")) throw new Error("Code plan IDs must start with plugin-.");
      const plan = normalizePlan(definition);
      if (seenPlans.has(plan.id)) throw new Error("Plan IDs must be unique.");
      const mode = planMode(plan);
      const allowed = id => nativeRoutineId(mode, id) || (mode !== "pest-control" && isDeployableRoutine(definitions.get(id)));
      if (plan.rows.some(row => !allowed(row.routine))) throw new Error("Plan references an unavailable routine.");
      const launchOverrides = normalizePlanOverrideFields(plan, definition.launchOverrides, allowed);
      seenPlans.add(plan.id);
      plans.push({ ...plan, launchOverrides });
    } catch (error) { reject("plan", definition, error); }
  }
  return { routines, plans };
}
module.exports = { CODE_DEFINITIONS_EVENT, collectCodeDefinitions };
