"use strict";

const { validateSpawnSetup, applySpawnSetup } = require("./SpawnSetup.PlayerBots");
const { isDeployableRoutine } = require("./RoutineCatalog.PlayerBots");
const { canSpawn } = require("./Activation.PlayerBots");
const { validateSetupValues } = require("./LauncherCatalog.PlayerBots");

function optionalLimit(key) {
  const raw = process.env[key]?.trim();
  if (!raw || raw === "0") return null;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive whole number or 0 (disabled).`);
  return value;
}
const MAX_DEPLOY_COUNT = optionalLimit("BOT_MAX_DEPLOY_COUNT");
const MAX_MANAGED_BOTS = optionalLimit("BOT_MAX_MANAGED_BOTS");
const nativeDeployments = new WeakMap();
const DEFAULT_LOCATION = Object.freeze({ x: 3222, y: 3218, z: 0 });
const DEFAULT_SPAWN_SETUP = Object.freeze({ location: null, skills: Object.freeze({}), inventory: Object.freeze([]), equipment: Object.freeze([]) });

function deployRegisteredBots({ runtime, launcher, count, location, context = {} }) {
  if (!runtime || typeof launcher?.deploy !== "function") return { ok: false, status: 503, error: "The activity bot launcher is not available." };
  if (!Number.isSafeInteger(count) || count < 1) return { ok: false, status: 400, error: "Enter a positive whole number of bots." };
  const limit = checkDeploymentLimits(runtime, count);
  if (limit) return limit;
  if (!location || ![location.x, location.y, location.z].every(Number.isInteger) ||
      location.x < 0 || location.x > 16383 || location.y < 0 || location.y > 16383 || location.z < 0 || location.z > 3) {
    return { ok: false, status: 400, error: "Spawn location must use valid world coordinates and plane." };
  }
  const setup = validateSetupValues(launcher.setupFields ?? [], context.setup ?? {});
  if (!setup.ok) return { ok: false, status: 400, error: setup.error };
  const before = new Set(runtime.entriesByUsername?.keys?.() ?? []);
  let result, thrown = null;
  try { result = launcher.deploy({ ...context, count, location: { x: location.x, y: location.y, z: location.z }, setup: setup.value }); }
  catch (error) { thrown = error; }
  if (result && typeof result.then === "function") return { ok: false, status: 409, error: "Activity launchers must finish deployment synchronously." };
  const newlyRegistered = [...(runtime.entriesByUsername?.entries?.() ?? [])].filter(([username]) => !before.has(username));
  if (thrown || result?.ok === false) {
    for (const [, entry] of newlyRegistered) {
      if (entry?.player?.isPlayerBot?.()) {
        entry.adminDeployedActivityId = launcher.id;
        entry.adminDeployedAt = Date.now();
        entry.adminDeployedLauncherId = launcher.id;
      }
      entry?.player?.requestLogout?.();
    }
    const message = thrown ? String(thrown?.message ?? thrown) : result.error;
    return { ok: false, status: Number.isInteger(result?.status) ? result.status : 409, error: String(message ?? "The activity launcher could not deploy bots.").slice(0, 180) };
  }
  const created = Array.isArray(result) ? result : Array.isArray(result?.spawned) ? result.spawned : [];
  const reported = new Set(created.map(candidate => typeof candidate === "string" ? candidate : candidate?.getUsername?.()).filter(Boolean));
  const spawned = [];
  const failures = Array.isArray(result?.failures) ? result.failures.slice(0, count) : [];
  for (const username of reported) {
    if (!newlyRegistered.some(([newUsername]) => newUsername === username)) failures.push("The activity launcher reported a bot that it did not register during this deployment.");
  }
  for (const [username, entry] of newlyRegistered) {
    const bot = entry?.player;
    if (!bot?.isPlayerBot?.()) {
      failures.push("The activity launcher registered an entry that is not a PlayerBot.");
      bot?.requestLogout?.();
      continue;
    }
    entry.adminDeployedActivityId = launcher.id;
    entry.adminDeployedAt = Date.now();
    entry.adminDeployedLauncherId = launcher.id;
    if (!reported.has(username)) failures.push("The activity launcher did not report a bot it registered; it was still tracked for safety.");
    if (spawned.length >= count) {
      failures.push("The activity launcher created more bots than requested; excess bots are logging out.");
      bot.requestLogout?.();
      continue;
    }
    spawned.push(username);
  }
  if (spawned.length === 0) return { ok: false, status: 409, error: failures[0] ?? "The activity launcher did not register any spawned bots." };
  return { ok: true, activityId: launcher.id, requested: count, spawned, failures };
}

function trackNativeDeployment(runtime, bot, world) {
  const record = nativeDeployments.get(runtime) ?? { bots: new Set(), world };
  record.bots.add(bot);
  nativeDeployments.set(runtime, record);
}

function managedBotCount(runtime) {
  const record = nativeDeployments.get(runtime);
  if (record) {
    const pending = new Set(record.world.getAddPlayerQueue());
    for (const bot of record.bots) if (!bot.isRegistered() && !pending.has(bot)) record.bots.delete(bot);
  }
  return (record?.bots.size ?? 0) + [...(runtime?.entriesByUsername?.values?.() ?? [])].filter(entry => typeof entry.adminDeployedActivityId === "string").length;
}

function checkDeploymentLimits(runtime, count, world) {
  if (MAX_DEPLOY_COUNT !== null && count > MAX_DEPLOY_COUNT) {
    return { ok: false, status: 400, error: `This world allows ${MAX_DEPLOY_COUNT} bots per deployment.` };
  }
  if (MAX_MANAGED_BOTS !== null) {
    const remaining = Math.max(0, MAX_MANAGED_BOTS - managedBotCount(runtime));
    if (count > remaining) return { ok: false, status: 409, error: `This world has ${remaining} managed bot slots available (limit ${MAX_MANAGED_BOTS}).` };
  }
  return checkWorldCapacity(world, count);
}

function checkWorldCapacity(world, count) {
  const players = world?.getPlayers?.();
  const slots = players?.characters?.length;
  if (!slots) return null;
  const available = Math.max(0, slots - 1 - players.sizeReturn() - world.getAddPlayerQueue().length);
  return count > available ? { ok: false, status: 409, error: `The world has ${available} player slots available.` } : null;
}

function prepareRoutineDeployment({ runtime, brainRegistry, core, activityId, count, overrides = {}, fallbackLocation = DEFAULT_LOCATION }) {
  if (!runtime || !brainRegistry) return { ok: false, status: 503, error: "The bot runtime is not ready." };
  if (typeof activityId !== "string") return { ok: false, status: 400, error: "Choose a bot routine." };
  if (!canSpawn(activityId)) return { ok: false, status: 409, error: "This routine is disabled. Enable it from Bot deployments first." };
  const activity = brainRegistry.byId?.get(activityId);
  if (!isDeployableRoutine(activity)) {
    return { ok: false, status: 404, error: "That bot routine is not available for deployment." };
  }
  if (!Number.isSafeInteger(count) || count < 1) return { ok: false, status: 400, error: "Enter a positive whole number of bots." };
  const capacityError = checkDeploymentLimits(runtime, count, core.World);
  if (capacityError) return capacityError;
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

  return { ok: true, activity, setup, spawnLocation: new core.Location(location.x, location.y, location.z) };
}

function spawnPreparedBot({ runtime, core, plan, location, source = "developer", deferStart = false, launcherId }) {
  const { activity, setup } = plan ?? {};
  const spawnLocation = location ?? plan?.spawnLocation;
  const bot = runtime.spawnPvpBot(spawnLocation, { mode: activity?.usesPvpEngine ? "pvp" : activity?.mode ?? launcherId, activity: source, activationId: activity?.id ?? launcherId });
  if (!bot) throw new Error("spawn capacity or name allocation failed");
  try {
    if (setup) applySpawnSetup(bot, setup, core);
    const entry = runtime.entriesByUsername.get(bot.getUsername());
    if (!entry) throw new Error("could not register the bot");
    entry.adminDeployedActivityId = activity?.id ?? launcherId;
    entry.adminDeployedAt = Date.now();
    if (launcherId) entry.adminDeployedLauncherId = launcherId;
    const start = activity && ((home = spawnLocation) => {
      const { startActivity } = require("../brain/BrainActivities.PlayerBots");
      if (!startActivity(bot, activity.id, { home })) return false;
      entry.behaviorPaused = false;
      return true;
    });
    if (deferStart || !start) entry.behaviorPaused = true;
    else if (!start()) throw new Error("could not start the bot routine");
    return { bot, start };
  } catch (error) {
    bot.requestLogout?.();
    throw error;
  }
}

function deployRoutineBots(options) {
  const { runtime, core, activityId, count } = options;
  const plan = prepareRoutineDeployment(options);
  if (!plan.ok) return plan;
  const spawned = [];
  const failures = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const { bot } = spawnPreparedBot({ runtime, core, plan });
      spawned.push(bot.getUsername());
    } catch (error) {
      failures.push(`Bot ${index + 1}: ${String(error?.message ?? error).slice(0, 160)}.`);
    }
  }
  if (spawned.length === 0) return { ok: false, status: 409, error: failures[0] ?? "No bots could be deployed." };
  return { ok: true, activityId, requested: count, spawned, failures };
}

module.exports = { deployRoutineBots, deployRegisteredBots, prepareRoutineDeployment, spawnPreparedBot, managedBotCount, trackNativeDeployment, checkDeploymentLimits, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS, DEFAULT_LOCATION, DEFAULT_SPAWN_SETUP };
