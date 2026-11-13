"use strict";

const { deployRoutineBots, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS } = require("../runtime/Deploy.PlayerBots");
const Layout = require("./Layout.Bots.PlayerBots");

const { GROUP_ID, MAIN_MODAL_UID, COMPONENT, BUTTON_COMPONENTS, rowUids, uid } = Layout;
const sessions = new WeakMap();
const INTERFACE_DEFINITION = Layout.buildInterface();

function isOpen(player) { return player.getInterfaceId?.() === GROUP_ID; }
function currentLocation(player) {
  const location = player.getLocation?.();
  if (!location) return null;
  const x = typeof location.getX === "function" ? location.getX() : location.x;
  const y = typeof location.getY === "function" ? location.getY() : location.y;
  const z = typeof location.getZ === "function" ? location.getZ() : location.z;
  return [x, y, z].every(Number.isInteger) ? { x, y, z } : null;
}
function managedBotCount(runtime) {
  return [...(runtime?.entriesByUsername?.values?.() ?? [])]
    .filter(entry => typeof entry.adminDeployedActivityId === "string").length;
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
function eligibleActivities(brainRegistry) {
  return (brainRegistry?.activities ?? [])
    .filter(activity => activity.manual === true && activity.id?.startsWith("custom_"))
    .sort((left, right) => left.id.localeCompare(right.id));
}
function displayName(id) {
  const label = String(id).replace(/^custom_/, "").replace(/[_-]+/g, " ").trim();
  return label ? label.replace(/\b\w/g, letter => letter.toUpperCase()) : String(id);
}
function setupSummary(activity) {
  const setup = activity.spawnSetup ?? {};
  const skills = Object.keys(setup.skills ?? {}).length;
  const inventory = Array.isArray(setup.inventory) ? setup.inventory.length : 0;
  const equipment = Array.isArray(setup.equipment) ? setup.equipment.length : 0;
  const setupItems = [];
  if (skills) setupItems.push(`${skills} skill override${skills === 1 ? "" : "s"}`);
  if (inventory) setupItems.push(`${inventory} inventory slot${inventory === 1 ? "" : "s"}`);
  if (equipment) setupItems.push(`${equipment} equipment slot${equipment === 1 ? "" : "s"}`);
  return setupItems.length ? `Routine start kit: ${setupItems.join(", ")}.` : "Routine start kit: default bot setup.";
}
function routineRow(activity, id) {
  const repeat = activity.repeat === true;
  const subtitle = `${repeat ? "Repeating" : "One-shot"} routine${activity.usesAiAgent ? " · AI required" : ""}`;
  const description = `${setupSummary(activity)}${activity.usesAiAgent ? " This routine also requires an enabled AI provider." : ""}`;
  return {
    id,
    name: displayName(activity.id),
    detail: repeat ? "Repeats" : "One-shot",
    terms: `${activity.id} ${activity.usesAiAgent ? "AI agent" : ""} ${subtitle}`,
    panel: { title: displayName(activity.id), subtitle, description },
  };
}
function sendString(player, value, component) {
  player.getPacketSender().sendString(String(value ?? ""), uid(component));
}
function selectedActivity(brainRegistry, state) {
  return state?.selectedActivityId ? brainRegistry?.byId?.get(state.selectedActivityId) : null;
}
function selectedLocation(player, activity, state) {
  if (state.usePlayerLocation) return currentLocation(player);
  return activity?.spawnSetup?.location ?? currentLocation(player);
}
function showEmptyPanel(player, message = "Select a saved bot routine to see its settings and starting kit.") {
  sendString(player, "No bot routines", COMPONENT.PANEL_TITLE);
  sendString(player, "Save a routine in Host Local first", COMPONENT.PANEL_SUBTITLE);
  sendString(player, message, COMPONENT.PANEL_DESCRIPTION);
}
function updateControls({ runtime, brainRegistry }, player, state) {
  const activity = selectedActivity(brainRegistry, state);
  const location = selectedLocation(player, activity, state);
  sendString(player, state.count, COMPONENT.COUNT_VALUE);
  sendString(player, state.usePlayerLocation ? "Use routine location" : "Spawn at my current tile", COMPONENT.LOCATION_LABEL);
  sendString(player, location ? `Spawn tile: ${location.x}, ${location.y}, plane ${location.z}` : "No valid spawn tile is available.", COMPONENT.LOCATION_INFO);
  sendString(player, `Copy my levels: ${state.copyOwnerSkills ? "On" : "Off"}`, COMPONENT.COPY_LEVELS_LABEL);
  sendString(player, `${MAX_DEPLOY_COUNT}/deploy · ${managedBotCount(runtime)}/${MAX_MANAGED_BOTS} managed`, COMPONENT.SETUP_NOTE);
  if (activity) {
    sendString(player, displayName(activity.id), COMPONENT.PANEL_TITLE);
    sendString(player, `${activity.repeat === true ? "Repeating" : "One-shot"} routine${activity.usesAiAgent ? " · AI required" : ""}`, COMPONENT.PANEL_SUBTITLE);
    sendString(player, `${setupSummary(activity)}${activity.usesAiAgent ? " AI provider must be enabled before spawning." : ""}`, COMPONENT.PANEL_DESCRIPTION);
  } else showEmptyPanel(player);
}
function setFeedback(player, text) {
  sendString(player, text, COMPONENT.FEEDBACK);
}
function sendRows(player, brainRegistry, state) {
  const activities = eligibleActivities(brainRegistry);
  const rows = activities.map((activity, index) => routineRow(activity, index + 1));
  state.activityIds = activities.map(activity => activity.id);
  if (!state.selectedActivityId || !state.activityIds.includes(state.selectedActivityId)) {
    state.selectedActivityId = state.activityIds[0] ?? null;
  }
  sendString(player, JSON.stringify(rows), COMPONENT.DATA);
}
function openBots({ player, parts = [] }, deps) {
  const { runtime, brainRegistry } = deps;
  if (!runtime || !brainRegistry) {
    player.sendMessage?.("The bot runtime is not ready.");
    return true;
  }
  const state = { count: 1, usePlayerLocation: false, copyOwnerSkills: false, selectedActivityId: null, activityIds: [] };
  sessions.set(player, state);
  player.setInterfaceId(GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Bot Routines"] }],
  });
  sendRows(player, brainRegistry, state);
  const query = parts.slice(1).join(" ").slice(0, 60);
  sendString(player, query, COMPONENT.SEARCH_INPUT);
  if (!state.selectedActivityId) showEmptyPanel(player);
  updateControls(deps, player, state);
  setFeedback(player, "Choose a routine, quantity and spawn point, then deploy.");
  return true;
}
function clickRow({ player, slot, opId }, deps) {
  if (!isOpen(player)) return false;
  const state = sessions.get(player);
  if (!state) return true;
  const activityId = state.activityIds[(slot | 0) - 1];
  if (!activityId) return true;
  state.selectedActivityId = activityId;
  updateControls(deps, player, state);
  setFeedback(player, opId === 1 ? `Selected ${displayName(activityId)}.` : "Select the routine before deploying.");
  return true;
}
function clickButton({ player, buttonId }, deps) {
  if (!isOpen(player)) return false;
  const state = sessions.get(player);
  if (!state) return true;
  const countMinus = BUTTON_COMPONENTS.countMinus.map(uid);
  const countPlus = BUTTON_COMPONENTS.countPlus.map(uid);
  const location = BUTTON_COMPONENTS.location.map(uid);
  const copyLevels = BUTTON_COMPONENTS.copyLevels.map(uid);
  const spawn = BUTTON_COMPONENTS.spawn.map(uid);
  const close = BUTTON_COMPONENTS.close.map(uid);
  if (countMinus.includes(buttonId)) {
    state.count = Math.max(1, state.count - 1);
    updateControls(deps, player, state);
    setFeedback(player, `Deployment quantity: ${state.count}.`);
  } else if (countPlus.includes(buttonId)) {
    state.count = Math.min(MAX_DEPLOY_COUNT, state.count + 1);
    updateControls(deps, player, state);
    setFeedback(player, `Deployment quantity: ${state.count}.`);
  } else if (location.includes(buttonId)) {
    state.usePlayerLocation = !state.usePlayerLocation;
    updateControls(deps, player, state);
    setFeedback(player, state.usePlayerLocation ? "Bots will spawn at your current tile." : "Bots will use the routine's saved location (or your tile if none is set).");
  } else if (copyLevels.includes(buttonId)) {
    state.copyOwnerSkills = !state.copyOwnerSkills;
    updateControls(deps, player, state);
    setFeedback(player, state.copyOwnerSkills ? "Your base skill levels will merge into the routine's Start setup." : "The routine's authored Start skill levels will be used.");
  } else if (spawn.includes(buttonId)) {
    const activity = selectedActivity(deps.brainRegistry, state);
    const playerLocation = currentLocation(player);
    if (state.usePlayerLocation && !playerLocation) {
      setFeedback(player, "Your current tile is unavailable; choose the routine location or try again.");
      return true;
    }
    const overrides = state.usePlayerLocation ? { location: playerLocation } : {};
    if (state.copyOwnerSkills) {
      const skills = ownerSkillOverrides(player, deps.api.core);
      if (!skills) {
        setFeedback(player, "Your base skill levels are unavailable; turn off the skill override or try again.");
        return true;
      }
      overrides.skills = skills;
    }
    const result = deployRoutineBots({
      runtime: deps.runtime,
      brainRegistry: deps.brainRegistry,
      core: deps.api.core,
      activityId: state.selectedActivityId,
      count: state.count,
      overrides,
      fallbackLocation: playerLocation,
    });
    if (!result.ok) setFeedback(player, result.error);
    else {
      const suffix = result.failures.length ? ` ${result.failures.length} failed.` : "";
      const message = `Spawned ${result.spawned.length}/${result.requested} ${displayName(activity?.id ?? result.activityId)} bot(s).${suffix}`;
      setFeedback(player, message);
      player.sendMessage?.(message);
      updateControls(deps, player, state);
    }
  } else if (close.includes(buttonId)) {
    player.getPacketSender().sendInterfaceRemoval();
    sessions.delete(player);
  } else return false;
  return true;
}

function registerBotsInterface({ api, runtime, brainRegistry }) {
  const deps = { api, runtime, brainRegistry };
  api.registerCustomInterface(INTERFACE_DEFINITION);
  api.registerCommand("bots", command => openBots(command, deps), api.core.PlayerRights.DEVELOPER,
    "Open the bot routine deployment interface");
  api.onInterfaceActionButton(rowUids, event => clickRow(event, deps));
  api.onInterfaceActionButton(Object.values(BUTTON_COMPONENTS).flat().map(uid), event => clickButton(event, deps));
}

module.exports = {
  name: "BotRoutinesInterface",
  description: "Adds the developer-only ::bots routine deployment interface.",
  registerBotsInterface,
  _test: { GROUP_ID, COMPONENT, BUTTON_COMPONENTS, rowUids, uid, eligibleActivities, routineRow,
    setupSummary, managedBotCount, ownerSkillOverrides, currentLocation, openBots, clickRow, clickButton, sessions,
    INTERFACE_DEFINITION, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS },
};
