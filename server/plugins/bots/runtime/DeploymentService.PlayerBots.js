"use strict";

const { deployRoutineBots, deployRegisteredBots, managedBotCount, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS, DEFAULT_SPAWN_SETUP } = require("./Deploy.PlayerBots");
const { listedRoutines, routineName } = require("./RoutineCatalog.PlayerBots");
const { routineOverrideFields, validateRoutineOverrides } = require("./DeploymentOverrides.PlayerBots");
const { collectActivityLaunchers } = require("./LauncherCatalog.PlayerBots");

function currentLocation(player) {
  const location = player.getLocation?.();
  if (!location) return null;
  const x = typeof location.getX === "function" ? location.getX() : location.x;
  const y = typeof location.getY === "function" ? location.getY() : location.y;
  const z = typeof location.getZ === "function" ? location.getZ() : location.z;
  return [x, y, z].every(Number.isInteger) ? { x, y, z } : null;
}
function ownerSkillOverrides(player, core) {
  const manager = player?.getSkillManager?.();
  const levels = {};
  for (const skill of core?.Skill?.values?.() ?? []) {
    const name = String(skill.getName?.() ?? "").toLowerCase().replace(/[ -]+/g, "_");
    const level = manager?.getMaxLevel?.(skill) ?? manager?.getCurrentLevel?.(skill);
    if (name && Number.isInteger(level) && level >= 1 && level <= 99) levels[name] = level;
  }
  return Object.keys(levels).length ? levels : null;
}
function brief(value, max = 140) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}
function setupSummary(setup) {
  const skills = Object.keys(setup.skills ?? {}).length;
  const inventory = Array.isArray(setup.inventory) ? setup.inventory.length : 0;
  const equipment = Array.isArray(setup.equipment) ? setup.equipment.length : 0;
  const setupItems = [];
  if (skills) setupItems.push(`${skills} skill override${skills === 1 ? "" : "s"}`);
  if (inventory) setupItems.push(`${inventory} inventory slot${inventory === 1 ? "" : "s"}`);
  if (equipment) setupItems.push(`${equipment} equipment slot${equipment === 1 ? "" : "s"}`);
  return setupItems.length ? `Routine start kit: ${setupItems.join(", ")}.` : "Routine start kit: default bot setup.";
}

function getLaunchers(api, brainRegistry) {
  const routines = listedRoutines(brainRegistry).map(activity => {
    const setup = activity.spawnSetup ?? DEFAULT_SPAWN_SETUP;
    const fields = routineOverrideFields(activity);
    return {
      key: `routine:${activity.id}`, kind: "routine", activityId: activity.id, activity,
      name: activity.name ?? routineName(activity.id), detail: activity.repeat === true ? "Repeating routine" : "One-shot routine",
      description: brief(`${setupSummary(setup)}${activity.usesAiAgent ? " This routine also requires an enabled AI provider." : ""}`),
      setupFields: [], spawnLocation: setup.location, allowLocation: fields.includes("location"), allowSkills: fields.includes("skills"),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const activities = collectActivityLaunchers(api).map(launcher => ({
    ...launcher, description: brief(`${launcher.description} ${launcher.setupSummary}`),
  }));
  return [...routines, ...activities];
}

function deployBots(deps, player, request) {
  const { api, runtime, brainRegistry } = deps;
  const launcher = getLaunchers(api, brainRegistry).find(item => item.key === request.key);
  if (!launcher) return { ok: false, error: "This launcher is no longer available. Refresh the Bots tab." };
  const playerLocation = currentLocation(player);
  if (request.usePlayerLocation && !playerLocation) return { ok: false, error: "Your current tile is unavailable; choose the saved location or try again." };
  const overrides = request.usePlayerLocation ? { location: playerLocation } : {};
  if (request.copyOwnerSkills) {
    const skills = ownerSkillOverrides(player, api.core);
    if (!skills) return { ok: false, error: "Your base skill levels are unavailable; turn off the skill override or try again." };
    overrides.skills = skills;
  }
  if (launcher.kind === "routine") {
    try { validateRoutineOverrides(launcher.activity, overrides); }
    catch (error) { return { ok: false, error: error.message }; }
  }
  const result = launcher.kind === "routine"
    ? deployRoutineBots({ runtime, brainRegistry, core: api.core, activityId: launcher.activityId,
      count: request.count, overrides, fallbackLocation: playerLocation })
    : deployRegisteredBots({ runtime, launcher, count: request.count,
      location: overrides.location ?? launcher.spawnLocation ?? playerLocation,
      context: { api, runtime, brainRegistry, core: api.core, player,
        skillOverrides: overrides.skills ?? null, setup: request.setup ?? {} } });
  if (!result.ok) return result;
  const suffix = result.failures?.length ? ` ${result.failures.length} failed.` : "";
  return { ...result, message: `Spawned ${result.spawned.length}/${result.requested} ${launcher.name} bot(s).${suffix}` };
}

function adminBots(deps, event) {
  const { api, runtime, brainRegistry } = deps;
  const actor = event.actor;
  event.handled = true;
  event.allowed = !!actor && api.core.PlayerRights.hasAdminRights(actor) &&
    api.core.PluginManager.playerHasCommandRights(actor, "admin") &&
    api.core.PluginManager.playerHasCommandRights(actor, "bots");
  if (!event.allowed) { event.error = "You do not have permission to deploy bots."; return; }
  if (!runtime || !brainRegistry) { event.error = "The bot runtime is not ready."; return; }
  event.limit = Math.min(MAX_DEPLOY_COUNT ?? 100, 100);
  event.managed = managedBotCount(runtime);
  event.capacity = MAX_MANAGED_BOTS;
  if (event.action === "catalogue") {
    event.launchers = getLaunchers(api, brainRegistry).map(launcher => ({
      key: launcher.key, kind: launcher.kind, name: launcher.name, detail: launcher.detail,
      description: launcher.description, setupFields: launcher.setupFields,
      location: launcher.spawnLocation, allowLocation: launcher.allowLocation, allowSkills: launcher.allowSkills,
    }));
  } else if (event.action === "deploy") {
    event.result = !Number.isSafeInteger(event.count) || event.count < 1 || event.count > event.limit
      ? {ok: false, error: `Choose 1-${event.limit} bots.`} : deployBots(deps, actor, event);
  }
}

function openBots(api, command) {
  const parts = command.parts ?? [];
  if (parts.length < 2) {
    const event = { player: command.player, tab: "bots", handled: false };
    api.emitCustomEvent("admin:open", event);
    if (event.handled) return true;
  }
  const browserParts = parts[1]?.toLowerCase() === "browser" ? [parts[0], ...parts.slice(2)] : parts;
  const fallback = { ...command, parts: browserParts, handled: false };
  api.emitCustomEvent("bots:open-standalone", fallback);
  if (!fallback.handled) command.player.sendMessage("Enable AdminPanel to open bot controls.");
  return true;
}

function registerBotDeployment(deps) {
  deps.api.onCustomEvent("admin:bots", adminBots.bind(null, deps));
  deps.api.registerCommand("bots", openBots.bind(null, deps.api), deps.api.core.PlayerRights.DEVELOPER, "Open the admin Bots tab or use ::bots browser for saved setups and deployment plans");
}

module.exports = { registerBotDeployment, ownerSkillOverrides };
