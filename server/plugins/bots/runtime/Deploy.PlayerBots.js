"use strict";

const { validateSpawnSetup, applySpawnSetup } = require("./SpawnSetup.PlayerBots");

const MAX_DEPLOY_COUNT = 20;
const MAX_MANAGED_BOTS = 50;
const DEFAULT_LOCATION = Object.freeze({ x: 3222, y: 3218, z: 0 });
const DEFAULT_SPAWN_SETUP = Object.freeze({ location: null, skills: Object.freeze({}), inventory: Object.freeze([]), equipment: Object.freeze([]) });

function deployRoutineBots({ runtime, brainRegistry, core, activityId, count, overrides = {}, fallbackLocation = DEFAULT_LOCATION }) {
  if (!runtime || !brainRegistry) return { ok: false, status: 503, error: "The bot runtime is not ready." };
  if (typeof activityId !== "string") return { ok: false, status: 400, error: "Choose a bot routine." };
  const activity = brainRegistry.byId?.get(activityId);
  if (!activity || activity.manual !== true || !activityId.startsWith("custom_")) {
    return { ok: false, status: 404, error: "That bot routine is not available for deployment." };
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_DEPLOY_COUNT) {
    return { ok: false, status: 400, error: `Choose between 1 and ${MAX_DEPLOY_COUNT} bots per deployment.` };
  }
  const entries = runtime.entriesByUsername?.values?.() ?? [];
  const managedCount = [...entries].filter(entry => typeof entry.adminDeployedActivityId === "string").length;
  if (managedCount + count > MAX_MANAGED_BOTS) {
    return { ok: false, status: 409, error: `The panel limit is ${MAX_MANAGED_BOTS} managed bots; ${Math.max(0, MAX_MANAGED_BOTS - managedCount)} slots remain.` };
  }
  if (activity.usesAiAgent && brainRegistry.aiAgentAvailable !== true) {
    return { ok: false, status: 409, error: "This bot routine uses an AI Agent block; enable PlayerBots AI and configure a provider first." };
  }

  const base = activity.spawnSetup ?? DEFAULT_SPAWN_SETUP;
  const spawnAt = overrides.location ?? base.location ?? fallbackLocation ?? DEFAULT_LOCATION;
  if (!spawnAt || ![spawnAt.x, spawnAt.y, spawnAt.z].every(Number.isInteger) ||
      spawnAt.x < 0 || spawnAt.x > 16383 || spawnAt.y < 0 || spawnAt.y > 16383 || spawnAt.z < 0 || spawnAt.z > 3) {
    return { ok: false, status: 400, error: "Spawn location must use valid world coordinates and plane." };
  }
  const location = { x: spawnAt.x, y: spawnAt.y, z: spawnAt.z };
  const setup = {
    location,
    skills: { ...(base.skills ?? {}), ...(overrides.skills && typeof overrides.skills === "object" ? overrides.skills : {}) },
    inventory: overrides.replaceInventory === true ? overrides.inventory : base.inventory,
    equipment: overrides.replaceEquipment === true ? overrides.equipment : base.equipment,
  };
  const setupError = validateSpawnSetup(setup, core);
  if (setupError) return { ok: false, status: 400, error: `Start setup: ${setupError}.` };

  const spawnLocation = new core.Location(location.x, location.y, location.z);
  const spawned = [];
  const failures = [];
  for (let index = 0; index < count; index += 1) {
    const bot = runtime.spawnPvpBot(spawnLocation, { mode: activity.mode });
    if (!bot) {
      failures.push(`Bot ${index + 1}: spawn capacity or name allocation failed.`);
      continue;
    }
    try {
      applySpawnSetup(bot, setup, core);
      const { startActivity } = require("../brain/BrainActivities.PlayerBots");
      const attached = startActivity(bot, activity.id, { home: spawnLocation });
      const entry = runtime.entriesByUsername.get(bot.getUsername());
      if (!attached || !entry) throw new Error("could not start the bot routine");
      entry.adminDeployedActivityId = activity.id;
      entry.adminDeployedAt = Date.now();
      spawned.push(bot.getUsername());
    } catch (error) {
      bot.requestLogout?.();
      failures.push(`Bot ${index + 1}: ${String(error?.message ?? error).slice(0, 160)}.`);
    }
  }
  if (spawned.length === 0) return { ok: false, status: 409, error: failures[0] ?? "No bots could be deployed." };
  return { ok: true, activityId, requested: count, spawned, failures };
}

module.exports = { deployRoutineBots, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS, DEFAULT_LOCATION, DEFAULT_SPAWN_SETUP };
