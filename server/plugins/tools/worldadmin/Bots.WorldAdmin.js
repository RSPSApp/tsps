"use strict";

const { createRequestHandler, HttpError, readJson, send } = require("./Http.WorldAdmin");
const { originAllowed } = require("./Access.WorldAdmin");
const { getActiveBotRuntime } = require("../../bots/runtime/RuntimeRegistry.PlayerBots");
const { trackControlSession, untrackControlSession } = require("../../bots/runtime/Control.PlayerBots");
const { deployRoutineBots, managedBotCount, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS, DEFAULT_LOCATION } = require("../../bots/runtime/Deploy.PlayerBots");
const { routineNames, matchRoutineIds } = require("../../bots/runtime/RoutineCatalog.PlayerBots");
const { listRoutineDeployments: activityList, groupRoutines } = require("../../bots/runtime/RoutineDeployments.PlayerBots");
const { validateRoutineOverrides } = require("../../bots/runtime/DeploymentOverrides.PlayerBots");
const { readAvailablePlans, deployPlan, applyPlanOverrides } = require("../../bots/runtime/DeploymentPlans.PlayerBots");
const { planFiles } = require("./PlanFiles.WorldAdmin");
const { deployRoster: deployTeamRoster } = require("../../bots/runtime/Roster.PlayerBots");
const { ACTIVATION_ATTRIBUTE } = require("../../bots/runtime/Activation.PlayerBots");
const { activationGet, activationPost } = require("./Activation.WorldAdmin");
const { itemIconDataUri } = require("./ItemIcons.WorldAdmin");
const viewersByOwner = new Map();
const USERNAME = /^[a-z0-9][a-z0-9 _-]{0,19}$/i;
const nativeRoutines = new Map(Object.entries({
  ...matchRoutineIds,
  "last-man-standing": "lms_match",
  "bounty-hunter": "bounty_hunter_match",
  "duel-arena": "duel_arena_match",
}));

function snapshotItems(container) {
  return (container?.getItems?.() ?? []).flatMap((item, slot) => {
    const id = item?.getId?.() ?? 0;
    if (id <= 0) return [];
    return [{ slot, id, name: item.getDefinition?.()?.getName?.() ?? `Item ${id}`, amount: item.getAmount?.() ?? 1 }];
  });
}

function snapshotBot(entry, core, nowMs, brainRegistry, watchable) {
  const bot = entry?.player;
  if (!bot?.isPlayerBot?.()) return null;
  const username = bot.getUsername?.() ?? "";
  const state = username ? entry.state : null;
  const brain = entry.brain;
  const source = bot.getAttribute?.(ACTIVATION_ATTRIBUTE) ?? entry.adminDeployedActivityId;
  const routineId = brain?.rootActivityId ?? nativeRoutines.get(source) ?? entry.adminDeployedActivityId ?? state?.mode ?? null;
  const activity = brainRegistry?.byId?.get(routineId);
  const label = activity?.name ?? (Object.hasOwn(routineNames, routineId) ? routineNames[routineId] : activity?.id ?? null);
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
    routineId,
    routineName: label,
    watchable,
    managed: typeof entry.adminDeployedActivityId === "string",
    status: entry.spectating ? "watching" : !brain ? "online" : brain.stopped ? "completed" : frame?.state ?? "running",
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

function monitoredBots(runtime, core, world, brainRegistry) {
  const nowMs = Date.now();
  const bots = [];
  const leaving = new Set(world.getRemovePlayerQueue());
  world.getPlayers()?.forEach(player => {
    if (!player?.isPlayerBot?.() || leaving.has(player)) return;
    const entry = runtime?.entriesByUsername?.get(player.getUsername());
    const tracked = entry?.player === player;
    bots.push(snapshotBot(tracked ? entry : { player }, core, nowMs, brainRegistry, tracked));
  });
  return bots.sort((a, b) => a.username.localeCompare(b.username));
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
  const bots = monitoredBots(runtime, api.core, api.getWorld(), brainRegistry);
  const activities = activityList(brainRegistry);
  send(response, 200, {
    bots,
    activities,
    routineGroups: groupRoutines(activities),
    viewers: onlineViewers(api),
    clientUrl: `http://localhost:${port}`,
    defaultLocation: DEFAULT_LOCATION,
    maxDeployCount: MAX_DEPLOY_COUNT,
    maxManagedCount: MAX_MANAGED_BOTS,
    managedCount: managedBotCount(runtime),
  });
}

function deploy(request, response, api) {
  const { runtime, brainRegistry } = getActiveBotRuntime();
  return readJson(request).then(body => {
    let overrides;
    try {
      if (Object.hasOwn(body, "location")) throw new Error("Use overrides.location to set a spawn location.");
      overrides = validateRoutineOverrides(brainRegistry?.byId?.get(body.activityId), body.overrides);
    } catch (error) { throw new HttpError(400, error.message); }
    const result = deployRoutineBots({
      runtime,
      brainRegistry,
      core: api.core,
      activityId: body.activityId,
      count: body.count,
      overrides,
    });
    if (!result.ok) throw new HttpError(result.status, result.error);
    send(response, 200, { activityId: result.activityId, requested: result.requested, spawned: result.spawned, failures: result.failures });
  });
}

async function deployRoster(request, response, api) {
  const body = await readJson(request);
  const result = deployTeamRoster({ api, ...getActiveBotRuntime() }, body?.mode, body?.teams);
  if (!result.ok) throw new HttpError(result.status, result.error);
  send(response, 200, result);
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
    untrackControlSession(entry.player, viewer);
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
  trackControlSession(entry.player, viewer);
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
  if (url.pathname === "/api/bots/item-search") {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    const text = (url.searchParams.get("text") ?? "").trim();
    if (!text || text.length > 100) throw new HttpError(400, "Enter 1–100 characters to search.");
    try {
      const query = new URLSearchParams({ kind: "item", text, limit: "20" });
      const result = await fetch(`http://127.0.0.1:${Number(process.env.WEBSOCKET_PORT || 43594)}/api/cache-search?${query}`, { signal: AbortSignal.timeout(5000) });
      if (!result.ok) throw new Error("Cache search unavailable.");
      send(response, 200, await result.json());
    } catch { throw new HttpError(503, "Item search needs the game server and CacheEditorCatalog plugin running."); }
    return true;
  }
  if (url.pathname === "/api/bots") {
    if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
    sendSnapshot(response, api);
    return true;
  }
  if (url.pathname === "/api/bots/activation" && request.method === "GET") {
    activationGet(response, api);
    return true;
  }
  if (await planFiles(request, response, url, getActiveBotRuntime().brainRegistry)) return true;
  const actions = {
    "/api/bots/deploy": deploy,
    "/api/bots/plans/deploy": async (request, response) => {
      const body = await readJson(request);
      const active = getActiveBotRuntime();
      const plan = readAvailablePlans(active.brainRegistry?.deploymentPlans).find(item => item.id === body?.id);
      if (!plan) throw new HttpError(404, "That saved deployment plan does not exist.");
      let launch;
      try { launch = applyPlanOverrides(plan, body.rows); } catch (error) { throw new HttpError(400, error.message); }
      const result = deployPlan({ api, ...active }, launch);
      if (!result.ok) throw new HttpError(result.status, result.error);
      const spawnedCount = Array.isArray(result.spawned) ? result.spawned.length : Object.values(result.spawned ?? {}).flat().length;
      send(response, 200, { ...result, spawnedCount });
    },
    "/api/bots/activation": activationPost,
    "/api/bots/team-roster": deployRoster,
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

function browserBotHandler(api, token, port) {
  return createRequestHandler({ token, loopback: true, port }, {
    async dispatch(request, response, url) {
      if (await botRoutes(request, response, url, api)) return true;
      throw new HttpError(404, "Not found");
    },
  }, []);
}

module.exports = { botRoutes, browserBotHandler, _test: { activityList, monitoredBots, onlineViewers, DEFAULT_LOCATION } };
