"use strict";

const { HttpError, readJson, send } = require("./Http.WorldAdmin");
const { getActiveBotRuntime } = require("../../bots/runtime/RuntimeRegistry.PlayerBots");
const { isDeployableRoutine, routineName } = require("../../bots/runtime/RoutineCatalog.PlayerBots");
const { ACTIVATION_ATTRIBUTE, NATIVE, isRoutineActivationId, activation, customSchedule } = require("../../bots/runtime/Activation.PlayerBots");
const { STARTUP_ROUTINES_KEY, validateStartupRoutines } = require("../../bots/runtime/StartupRoutines.PlayerBots");
const { deployRoutineBots } = require("../../bots/runtime/Deploy.PlayerBots");

function defaults(api) {
  return validateStartupRoutines(api.getPluginConfig(STARTUP_ROUTINES_KEY, []));
}

function onlineByDeployment(api, runtime) {
  const world = api.getWorld();
  const grouped = new Map();
  const leaving = new Set(world.getRemovePlayerQueue());
  world.getPlayers()?.forEach(player => {
    if (!player?.isPlayerBot?.() || leaving.has(player)) return;
    const username = player.getUsername();
    const entry = runtime?.entriesByUsername?.get(username);
    const id = player.getAttribute(ACTIVATION_ATTRIBUTE) ?? entry?.adminDeployedActivityId;
    if (!id) return;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(username);
  });
  for (const list of grouped.values()) list.sort((a, b) => a.localeCompare(b));
  return grouped;
}

function configuredNative(api, id, siteOptions) {
  if (typeof siteOptions?.[id] === "boolean") return siteOptions[id];
  switch (id) {
    case "ai": return api.getPluginConfig("PlayerBots:ai", {})?.enabled === true;
    case "last-man-standing": return api.getPluginConfig("LastManStanding:seedBots", true) === true;
    default: return true;
  }
}

function deploymentSnapshot(api, runtime, brainRegistry, store = activation) {
  const schedule = customSchedule(defaults(api), store);
  const online = onlineByDeployment(api, runtime);
  const allowedSources = api.getPluginConfig("PlayerBots:allowedActivities", null);
  const nativeDefaults = runtime?.activationDefaults;
  const sourceAllowed = source => !Array.isArray(allowedSources) || allowedSources.includes(source);
  const deployment = (id, name, trigger, configured, count = null) => ({
    id, name, trigger, configured, count,
    enabled: configured && store.get(id)?.enabled !== false,
    blocked: store.get(id)?.enabled === false,
    online: online.get(id) ?? [],
  });
  return [
    ...[...NATIVE].map(([id, { name, trigger }]) => {
      const source = id.startsWith("wilderness-") || id === "world-sites" ? "world" : id;
      const seed = id === "castle-wars" ? api.getPluginConfig("CastleWars:seedBots", false) : id === "soul-wars" ? api.getPluginConfig("SoulWars:seedBots", false) : null;
      return deployment(id, name, seed === false ? "Manual roster" : trigger, sourceAllowed(source) && configuredNative(api, id, nativeDefaults));
    }),
    ...(brainRegistry?.activities ?? []).filter(isDeployableRoutine).map(({ id, name }) => deployment(
      id, name ?? routineName(id), schedule.has(id) ? "World startup" : "Manual deployment", sourceAllowed("developer") && schedule.has(id), schedule.get(id),
    )),
  ];
}

function stopDeployment(api, runtime, id) {
  const world = api.getWorld();
  const candidates = new Set(world.getAddPlayerQueue());
  world.getPlayers()?.forEach(player => { if (player) candidates.add(player); });
  let stopped = 0;
  for (const bot of candidates) {
    if (!bot?.isPlayerBot?.()) continue;
    const entry = runtime.entriesByUsername?.get(bot.getUsername());
    if (bot.getAttribute(ACTIVATION_ATTRIBUTE) !== id && entry?.adminDeployedActivityId !== id && entry?.adminDeployedLauncherId !== id) continue;
    bot.requestLogout();
    stopped++;
  }
  return stopped;
}

function updateDeployment(api, runtime, brainRegistry, body, store = activation, deploy = deployRoutineBots) {
  const { id, enabled, count } = body ?? {};
  if (typeof id !== "string" || typeof enabled !== "boolean") throw new HttpError(400, "Choose a deployment and an activation state.");
  const isRoutine = isRoutineActivationId(id);
  const exists = (brainRegistry?.activities ?? []).some(activity => id === activity.id && isDeployableRoutine(activity));
  if (!NATIVE.has(id) && !(isRoutine && exists)) throw new HttpError(404, "That deployment does not exist.");
  if (count !== undefined && (!isRoutine || !Number.isSafeInteger(count) || count < 1)) throw new HttpError(400, "Choose a positive whole count for a registered routine.");
  if (!enabled) {
    const previous = store.get(id);
    store.set(id, false, isRoutine ? previous?.count ?? customSchedule(defaults(api), store).get(id) : undefined);
    return { id, enabled, stopped: stopDeployment(api, runtime, id) };
  }
  if (!isRoutine) {
    store.set(id, true);
    runtime.reconcileActivation?.(id);
    return { id, enabled, notice: "Enabled for the existing trigger. Startup-only bots may need a server restart." };
  }
  const configured = customSchedule(defaults(api), store);
  const want = count ?? configured.get(id) ?? store.get(id)?.count ?? 1;
  configured.set(id, want);
  try { validateStartupRoutines([...configured].map(([routine, size]) => ({ id: routine, count: size }))); }
  catch (error) { throw new HttpError(400, error.message); }
  const allowed = api.getPluginConfig("PlayerBots:allowedActivities", null);
  if (Array.isArray(allowed) && !allowed.includes("developer")) throw new HttpError(403, "This world does not allow developer bot deployments.");
  store.set(id, true, want);
  const online = onlineByDeployment(api, runtime).get(id)?.length ?? 0;
  // Count pending registrations to avoid duplicates, but not bots deactivation already queued for logout.
  const world = api.getWorld();
  const leaving = new Set(world.getRemovePlayerQueue());
  const pending = world.getAddPlayerQueue().filter(bot => !leaving.has(bot) && !bot.isRegistered() && bot.getAttribute(ACTIVATION_ATTRIBUTE) === id).length;
  const missing = want - online - pending;
  const result = missing > 0 ? deploy({ runtime, brainRegistry, core: api.core, activityId: id, count: missing }) : null;
  return { id, enabled, count: want, spawned: result?.spawned ?? [], notice: result && !result.ok ? result.error : null };
}

function activationGet(response, api) {
  const { runtime, brainRegistry } = getActiveBotRuntime();
  if (!runtime) throw new HttpError(503, "The bot runtime is not running.");
  send(response, 200, { deployments: deploymentSnapshot(api, runtime, brainRegistry) });
}

async function activationPost(request, response, api) {
  const { runtime, brainRegistry } = getActiveBotRuntime();
  if (!runtime) throw new HttpError(503, "The bot runtime is not running.");
  send(response, 200, updateDeployment(api, runtime, brainRegistry, await readJson(request)));
}

module.exports = { activationGet, activationPost, deploymentSnapshot, updateDeployment };
