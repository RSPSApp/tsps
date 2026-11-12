"use strict";

const { HttpError, readJson, send } = require("./Http.WorldAdmin");
const { originAllowed } = require("./Access.WorldAdmin");
const { getActiveBotRuntime } = require("../../bots/runtime/RuntimeRegistry.PlayerBots");
const { validateSpawnSetup, applySpawnSetup } = require("../../bots/runtime/SpawnSetup.PlayerBots");
const { itemIconDataUri } = require("./ItemIcons.WorldAdmin");

const MAX_DEPLOY_COUNT = 20;
const MAX_MANAGED_BOTS = 50;
const DEFAULT_LOCATION = Object.freeze({ x: 3222, y: 3218, z: 0 });
const DEFAULT_SPAWN_SETUP = Object.freeze({ location: null, skills: Object.freeze({}), inventory: Object.freeze([]), equipment: Object.freeze([]) });
const viewersByOwner = new Map();
const USERNAME = /^[a-z0-9][a-z0-9 _-]{0,19}$/i;

function location(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isInteger) ||
      value.x < 0 || value.x > 16383 || value.y < 0 || value.y > 16383 || value.z < 0 || value.z > 3) {
    throw new HttpError(400, "Spawn location must use valid world coordinates and plane.");
  }
  return { x: value.x, y: value.y, z: value.z };
}

function snapshotItems(container) {
  return (container?.getItems?.() ?? []).flatMap((item, slot) => {
    const id = item?.getId?.() ?? 0;
    if (id <= 0) return [];
    return [{ slot, id, name: item.getDefinition?.()?.getName?.() ?? `Item ${id}`, amount: item.getAmount?.() ?? 1 }];
  });
}

function snapshotBot(entry, core, nowMs) {
  const bot = entry?.player;
  if (!bot?.isPlayerBot?.()) return null;
  const username = bot.getUsername?.() ?? "";
  const state = username ? entry.state : null;
  const brain = entry.brain;
  const frame = brain?.frames?.at?.(-1) ?? null;
  const step = frame?.action?.() ?? null;
  let action = null;
  if (step) {
    let description = null;
    try { description = step.describe?.({ player: bot, state, nowMs }) ?? null; } catch {}
    action = { id: step.id ?? null, description, index: frame.actionIndex + 1, total: frame.behaviour?.actions?.length ?? 0, state: frame.state };
  }
  const loc = bot.getLocation?.();
  const skills = bot.getSkillManager?.();
  const combat = bot.getCombat?.();
  const target = combat?.getTarget?.() ?? combat?.getAttacker?.() ?? null;
  const targetName = target?.getUsername?.() ?? target?.getDefinition?.()?.getName?.() ?? null;
  const values = core.Skill.values().map(skill => ({
    name: skill.getName(),
    level: skills?.getCurrentLevel?.(skill) ?? 1,
    max: skills?.getMaxLevel?.(skill) ?? 1,
    xp: skills?.getExperience?.(skill) ?? 0,
  }));
  return {
    username,
    displayName: bot.getDisplayName?.() ?? username,
    activityId: entry.adminDeployedActivityId ?? brain?.rootActivityId ?? state?.mode ?? null,
    managed: typeof entry.adminDeployedActivityId === "string",
    status: entry.spectating ? "watching" : !brain ? "idle" : brain.stopped ? "completed" : frame?.state ?? "running",
    watchedBy: entry.spectatorOwner ?? null,
    location: loc ? { x: loc.getX(), y: loc.getY(), z: loc.getZ() } : null,
    hitpoints: bot.getHitpoints?.() ?? skills?.getCurrentLevel?.(core.Skill.HITPOINTS) ?? 0,
    maxHitpoints: skills?.getMaxLevel?.(core.Skill.HITPOINTS) ?? 0,
    combatLevel: skills?.getCombatLevel?.() ?? 0,
    totalLevel: skills?.getTotalLevel?.() ?? 0,
    runEnergy: bot.getRunEnergy?.() ?? 0,
    mode: state?.mode ?? null,
    action,
    target: targetName,
    lastError: brain?.lastError?.message ?? null,
    skills: values,
    inventory: snapshotItems(bot.getInventory?.()),
    equipment: snapshotItems(bot.getEquipment?.()),
  };
}

function monitoredBots(runtime, core) {
  const nowMs = Date.now();
  return [...(runtime?.entriesByUsername?.values?.() ?? [])]
    .map(entry => snapshotBot(entry, core, nowMs))
    .filter(Boolean)
    .sort((a, b) => a.username.localeCompare(b.username));
}

function activityList(brainRegistry) {
  return (brainRegistry?.activities ?? []).filter(activity =>
    activity.manual === true && activity.id.startsWith("custom_"))
    .map(activity => ({ id: activity.id, repeat: activity.repeat, setup: activity.spawnSetup ?? DEFAULT_SPAWN_SETUP, usesAiAgent: activity.usesAiAgent === true }));
}

function onlineViewers(api) {
  const core = api.core;
  const players = [];
  core.World.getPlayers()?.forEach(player => players.push(player));
  return players
    .filter(player => player && !player.isPlayerBot?.())
    .map(player => ({
      username: player.getUsername(),
      displayName: player.getDisplayName?.() ?? player.getUsername(),
      watching: viewersByOwner.get(player.getUsername().toLowerCase())?.botUsername ?? null,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function sendSnapshot(response, api) {
  const { runtime, brainRegistry } = getActiveBotRuntime();
  if (!runtime) throw new HttpError(503, "The bot runtime is not running.");
  const port = Number(process.env.PORT || 3000);
  const bots = monitoredBots(runtime, api.core);
  send(response, 200, {
    bots,
    activities: activityList(brainRegistry),
    viewers: onlineViewers(api),
    clientUrl: `http://localhost:${port}`,
    defaultLocation: DEFAULT_LOCATION,
    maxDeployCount: MAX_DEPLOY_COUNT,
    maxManagedCount: MAX_MANAGED_BOTS,
    managedCount: bots.filter(bot => bot.managed).length,
    aiAgentAvailable: brainRegistry?.aiAgentAvailable === true,
  });
}

function deploy(request, response, api) {
  const { runtime, brainRegistry } = getActiveBotRuntime();
  if (!runtime || !brainRegistry) throw new HttpError(503, "The bot runtime is not ready.");
  return readJson(request).then(body => {
    if (typeof body.activityId !== "string") throw new HttpError(400, "Choose a bot routine.");
    const activity = brainRegistry.byId?.get(body.activityId);
    if (!activity || activity.manual !== true || !body.activityId.startsWith("custom_")) {
      throw new HttpError(404, "That bot routine is not available for deployment.");
    }
    if (!Number.isInteger(body.count) || body.count < 1 || body.count > MAX_DEPLOY_COUNT) {
      throw new HttpError(400, `Choose between 1 and ${MAX_DEPLOY_COUNT} bots per deployment.`);
    }
    const managedCount = [...runtime.entriesByUsername.values()].filter(entry => typeof entry.adminDeployedActivityId === "string").length;
    if (managedCount + body.count > MAX_MANAGED_BOTS) throw new HttpError(409, `The panel limit is ${MAX_MANAGED_BOTS} managed bots; ${Math.max(0, MAX_MANAGED_BOTS - managedCount)} slots remain.`);
    if (activity.usesAiAgent && brainRegistry.aiAgentAvailable !== true) throw new HttpError(409, "This bot routine uses an AI Agent block; enable PlayerBots AI and configure a provider first.");
    const base = activity.spawnSetup ?? DEFAULT_SPAWN_SETUP;
    const overrides = body.overrides && typeof body.overrides === "object" ? body.overrides : {};
    const spawnAt = location(overrides.location ? overrides.location : base.location ?? body.location ?? DEFAULT_LOCATION);
    const setup = {
      location: spawnAt,
      skills: { ...(base.skills ?? {}), ...(overrides.skills && typeof overrides.skills === "object" ? overrides.skills : {}) },
      inventory: overrides.replaceInventory === true ? overrides.inventory : base.inventory,
      equipment: overrides.replaceEquipment === true ? overrides.equipment : base.equipment,
    };
    const setupError = validateSpawnSetup(setup, api.core);
    if (setupError) throw new HttpError(400, `Start setup: ${setupError}.`);
    const spawnLocation = new api.core.Location(spawnAt.x, spawnAt.y, spawnAt.z);
    const spawned = [];
    const failures = [];
    for (let index = 0; index < body.count; index += 1) {
      const bot = runtime.spawnPvpBot(spawnLocation, { mode: activity.mode });
      if (!bot) {
        failures.push(`Bot ${index + 1}: spawn capacity or name allocation failed.`);
        continue;
      }
      try {
        applySpawnSetup(bot, setup, api.core);
        const { startActivity } = require("../../bots/brain/BrainActivities.PlayerBots");
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
    if (spawned.length === 0) throw new HttpError(409, failures[0] ?? "No bots could be deployed.");
    send(response, 200, { activityId: activity.id, requested: body.count, spawned, failures });
  });
}

async function watch(request, response, api) {
  const body = await readJson(request);
  if (typeof body.bot !== "string" || !USERNAME.test(body.bot) || typeof body.viewer !== "string" || !USERNAME.test(body.viewer)) {
    throw new HttpError(400, "Choose a bot and an online game client.");
  }
  const { runtime } = getActiveBotRuntime();
  const entry = runtime?.entriesByUsername?.get(body.bot);
  const viewer = api.core.World.getPlayerByName(body.viewer);
  if (!entry?.player?.isPlayerBot?.()) throw new HttpError(404, "Bot is no longer online.");
  if (!viewer || viewer.isPlayerBot?.()) {
    throw new HttpError(403, "Log in to the game as a real player before watching a bot.");
  }
  if (viewersByOwner.has(viewer.getUsername().toLowerCase())) throw new HttpError(409, "This viewer is already watching a bot; stop watching first.");
  if (entry.manuallyControlled || entry.spectating) throw new HttpError(409, "This bot is already controlled or being watched.");
  const viewerKey = viewer.getUsername().toLowerCase();
  const clear = () => {
    entry.spectating = false;
    entry.spectatorOwner = null;
    viewersByOwner.delete(viewerKey);
  };
  entry.spectating = true;
  entry.spectatorOwner = viewer.getUsername();
  if (!api.core.controlPlayer(viewer, entry.player, clear, { readOnly: true })) {
    clear();
    throw new HttpError(409, "Could not switch the game client to this bot. Finish any active interaction and try again.");
  }
  viewersByOwner.set(viewerKey, { botUsername: entry.player.getUsername(), entry });
  send(response, 200, { watching: entry.player.getUsername(), viewer: viewer.getUsername() });
}

async function unwatch(request, response, api) {
  const body = await readJson(request);
  if (typeof body.viewer !== "string" || !USERNAME.test(body.viewer)) throw new HttpError(400, "Choose an online game client.");
  const owner = api.core.World.getPlayerByName(body.viewer);
  if (!owner || owner.isPlayerBot?.()) throw new HttpError(404, "The game client is no longer online.");
  const watching = viewersByOwner.get(owner.getUsername().toLowerCase());
  if (!watching || !api.core.releasePlayerControl(watching.entry.player)) {
    throw new HttpError(409, "That viewer is not watching a bot.");
  }
  send(response, 200, { watching: null, viewer: owner.getUsername() });
}

async function despawn(request, response, api) {
  const body = await readJson(request);
  if (typeof body.bot !== "string" || !USERNAME.test(body.bot)) throw new HttpError(400, "Choose a bot to despawn.");
  const { runtime } = getActiveBotRuntime();
  const entry = runtime?.entriesByUsername?.get(body.bot);
  if (!entry?.adminDeployedActivityId || !entry.player?.isPlayerBot?.()) {
    throw new HttpError(404, "Only bots deployed from this panel can be removed here.");
  }
  if (entry.spectatorOwner) {
    if (entry.player) api.core.releasePlayerControl(entry.player);
  }
  entry.player.requestLogout?.();
  send(response, 200, { despawned: body.bot });
}

async function botRoutes(request, response, url, api) {
  if (url.pathname === "/api/bots/item-icon") {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id < 0 || id > 2147483647) throw new HttpError(400, "Choose a valid item ID.");
    const src = itemIconDataUri(api.core, id);
    if (!src) throw new HttpError(404, "No cached inventory sprite for that item.");
    send(response, 200, { id, src });
    return true;
  }
  if (url.pathname === "/api/bots") {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    sendSnapshot(response, api);
    return true;
  }
  const actions = {
    "/api/bots/deploy": deploy,
    "/api/bots/watch": watch,
    "/api/bots/unwatch": unwatch,
    "/api/bots/despawn": despawn,
  };
  const action = actions[url.pathname];
  if (!action) return false;
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
  if (!originAllowed(request)) throw new HttpError(403, "Cross-origin request refused");
  await action(request, response, api);
  return true;
}

module.exports = { botRoutes, _test: { activityList, monitoredBots, onlineViewers, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS, DEFAULT_LOCATION } };
