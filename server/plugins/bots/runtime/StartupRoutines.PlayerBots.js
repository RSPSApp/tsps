"use strict";

const { deployRoutineBots } = require("./Deploy.PlayerBots");

const { isRoutineId } = require("./RoutineCatalog.PlayerBots");
const { customSchedule } = require("./Activation.PlayerBots");

const STARTUP_ROUTINES_KEY = "PlayerBots:startupRoutines";

function validateStartupRoutines(config) {
  if (!Array.isArray(config)) throw new Error("Expected a list of startup routine deployments.");
  const ids = new Set();
  return config.map(entry => {
    const { id, count } = entry ?? {};
    if (!isRoutineId(id) || ids.has(id)) throw new Error("Each startup routine needs a unique registered routine ID.");
    if (!Number.isSafeInteger(count) || count < 1) throw new Error(`Startup routine '${id}' needs a positive whole number of bots.`);
    ids.add(id);
    return { id, count };
  });
}

function startConfiguredRoutines(api, boot) {
  let config;
  try {
    const defaults = validateStartupRoutines(api.getPluginConfig(STARTUP_ROUTINES_KEY, []));
    config = validateStartupRoutines([...customSchedule(defaults)].map(([id, count]) => ({ id, count })));
  } catch (error) {
    api.log("startup_routines_invalid", { message: error.message });
    return;
  }
  if (config.length === 0) return;
  const { botActivityAllowed } = require("../behaviours/spawn/PlayerFactory.PlayerBots");
  if (!botActivityAllowed("developer")) {
    api.log("startup_routines_skipped", { message: "This world does not allow developer bot deployments." });
    return;
  }
  for (const { id, count } of config) {
    const result = deployRoutineBots({ ...boot, core: api.core, activityId: id, count });
    api.log(result.ok ? "startup_routine_deployed" : "startup_routine_failed", {
      routine: id, requested: count, spawned: result.spawned?.length ?? 0,
      failures: result.ok ? result.failures : [result.error],
    });
  }
}

function queueStartupRoutines(api, boot) {
  // Spawn emits login hooks. Wait until every plugin's startup hook has initialized
  // its state, including plugins that register after PlayerBots.
  const task = new api.core.Task(1);
  task.execute = () => {
    task.stop();
    boot.brainRegistry.installCodeDefinitions?.();
    startConfiguredRoutines(api, boot);
  };
  api.getTaskManager().submit(task);
}

function registerStartupRoutines(api, boot) {
  api.onServerStartup(queueStartupRoutines.bind(null, api, boot));
}

module.exports = { STARTUP_ROUTINES_KEY, registerStartupRoutines, validateStartupRoutines };
