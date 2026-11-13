"use strict";

const { deployRoutineBots, deployRegisteredBots, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS } = require("../runtime/Deploy.PlayerBots");
const { collectActivityLaunchers } = require("../runtime/LauncherCatalog.PlayerBots");
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
function eligibleLaunchers(api, brainRegistry) {
  const routines = eligibleActivities(brainRegistry).map(activity => ({
    key: `routine:${activity.id}`, kind: "routine", activityId: activity.id, activity,
    name: displayName(activity.id), detail: activity.repeat === true ? "Repeats" : "One-shot",
    description: setupSummary(activity), setupSummary: activity.usesAiAgent ? "Requires an enabled AI provider." : "",
  }));
  const activities = collectActivityLaunchers(api);
  return [...routines, ...activities.map(launcher => ({
    ...launcher,
    panel: { title: launcher.name, subtitle: `${launcher.detail} · activity plugin`, description: `${launcher.description} ${launcher.setupSummary}`.trim() },
  }))];
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
function activitySetup(launcher, state) {
  const fields = launcher?.setupFields ?? [];
  let values = state.activitySetupByLauncher.get(launcher?.key);
  if (!values) {
    values = Object.fromEntries(fields.map(field => [field.id, field.defaultValue]));
    if (launcher) state.activitySetupByLauncher.set(launcher.key, values);
  }
  return Object.fromEntries(fields.map(field => [field.id, values[field.id] ?? field.defaultValue]));
}
function updateActivitySetupControls(player, launcher, state) {
  const sender = player.getPacketSender();
  const fields = launcher?.kind === "activity" ? launcher.setupFields ?? [] : [];
  const values = activitySetup(launcher, state);
  for (const [index, components] of BUTTON_COMPONENTS.setupOptions.entries()) {
    const field = fields[index];
    for (const component of components) sender.sendInterfaceDisplayState?.(uid(component), !field);
    if (!field) {
      sendString(player, "", components[1]);
      continue;
    }
    const selected = field.choices.find(choice => choice.value === values[field.id]) ?? field.choices[0];
    sendString(player, `${field.label}: ${selected.label} >`, components[1]);
  }
}
function selectedLauncher(state) {
  return state?.launchers?.find(launcher => launcher.key === state.selectedLauncherKey) ?? null;
}
function selectedActivity(brainRegistry, state) {
  const launcher = selectedLauncher(state);
  return launcher?.kind === "routine" ? launcher.activity ?? brainRegistry?.byId?.get(launcher.activityId) ?? null : null;
}
function selectedLocation(player, launcher, state) {
  if (state.usePlayerLocation) return currentLocation(player);
  if (launcher?.kind === "routine") return launcher.activity?.spawnSetup?.location ?? currentLocation(player);
  return launcher?.spawnLocation ?? currentLocation(player);
}
function showEmptyPanel(player, message = "Choose a saved bot routine or an activity launcher contributed by a server plugin.") {
  sendString(player, "No bot launchers", COMPONENT.PANEL_TITLE);
  sendString(player, "Save a routine or load an activity plugin", COMPONENT.PANEL_SUBTITLE);
  sendString(player, message, COMPONENT.PANEL_DESCRIPTION);
}
function updateControls({ runtime, brainRegistry }, player, state) {
  const launcher = selectedLauncher(state);
  const activity = selectedActivity(brainRegistry, state);
  const location = selectedLocation(player, launcher, state);
  updateActivitySetupControls(player, launcher, state);
  sendString(player, state.count, COMPONENT.COUNT_VALUE);
  sendString(player, state.usePlayerLocation ? "Use saved location" : "Spawn at my current tile", COMPONENT.LOCATION_LABEL);
  sendString(player, location ? `Spawn tile: ${location.x}, ${location.y}, plane ${location.z}` : "No valid spawn tile is available.", COMPONENT.LOCATION_INFO);
  sendString(player, `Copy my levels: ${state.copyOwnerSkills ? "On" : "Off"}`, COMPONENT.COPY_LEVELS_LABEL);
  sendString(player, `${MAX_DEPLOY_COUNT}/deploy · ${managedBotCount(runtime)}/${MAX_MANAGED_BOTS} managed`, COMPONENT.SETUP_NOTE);
  if (activity) {
    sendString(player, displayName(activity.id), COMPONENT.PANEL_TITLE);
    sendString(player, `${activity.repeat === true ? "Repeating" : "One-shot"} routine${activity.usesAiAgent ? " · AI required" : ""}`, COMPONENT.PANEL_SUBTITLE);
    sendString(player, `${setupSummary(activity)}${activity.usesAiAgent ? " AI provider must be enabled before spawning." : ""}`, COMPONENT.PANEL_DESCRIPTION);
  } else if (launcher?.kind === "activity") {
    sendString(player, launcher.name, COMPONENT.PANEL_TITLE);
    sendString(player, `${launcher.detail} · activity plugin`, COMPONENT.PANEL_SUBTITLE);
    sendString(player, `${launcher.description} ${launcher.setupSummary}`.trim(), COMPONENT.PANEL_DESCRIPTION);
  } else showEmptyPanel(player);
}
function setFeedback(player, text) {
  sendString(player, text, COMPONENT.FEEDBACK);
}
function sendRows(player, deps, state) {
  const launchers = eligibleLaunchers(deps.api, deps.brainRegistry);
  const rows = launchers.map((launcher, index) => launcher.kind === "routine"
    ? routineRow(launcher.activity, index + 1)
    : { id: index + 1, name: launcher.name, detail: launcher.detail, terms: `${launcher.id} ${launcher.description}`, panel: launcher.panel });
  state.launchers = launchers;
  state.launcherKeys = launchers.map(launcher => launcher.key);
  if (!state.selectedLauncherKey || !state.launcherKeys.includes(state.selectedLauncherKey)) {
    state.selectedLauncherKey = state.launcherKeys[0] ?? null;
  }
  sendString(player, JSON.stringify(rows), COMPONENT.DATA);
}
function openBots({ player, parts = [] }, deps) {
  const { runtime, brainRegistry } = deps;
  if (!runtime || !brainRegistry) {
    player.sendMessage?.("The bot runtime is not ready.");
    return true;
  }
  const state = { count: 1, usePlayerLocation: false, copyOwnerSkills: false, selectedLauncherKey: null, launcherKeys: [], launchers: [], activitySetupByLauncher: new Map() };
  sessions.set(player, state);
  player.setInterfaceId(GROUP_ID);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, GROUP_ID, 0, {
    postScripts: [{ scriptId: 227, args: [uid(COMPONENT.FRAME), "Bot Routines & Activities"] }],
  });
  sendRows(player, deps, state);
  const query = parts.slice(1).join(" ").slice(0, 60);
  sendString(player, query, COMPONENT.SEARCH_INPUT);
  if (!state.selectedLauncherKey) showEmptyPanel(player);
  updateControls(deps, player, state);
  setFeedback(player, "Choose a routine or activity bot, quantity and spawn point, then deploy.");
  return true;
}
function clickRow({ player, slot, opId }, deps) {
  if (!isOpen(player)) return false;
  const state = sessions.get(player);
  if (!state) return true;
  const launcherKey = state.launcherKeys[(slot | 0) - 1];
  const launcher = state.launchers.find(item => item.key === launcherKey);
  if (!launcher) return true;
  state.selectedLauncherKey = launcherKey;
  updateControls(deps, player, state);
  setFeedback(player, opId === 1 ? `Selected ${launcher.name ?? displayName(launcher.activityId)}.` : "Select a bot launcher before deploying.");
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
  const setupOptionIndex = BUTTON_COMPONENTS.setupOptions.findIndex(components => components.map(uid).includes(buttonId));
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
    setFeedback(player, state.usePlayerLocation ? "Bots will spawn at your current tile." : "Bots will use the saved routine or activity location (or your tile if none is set).");
  } else if (copyLevels.includes(buttonId)) {
    state.copyOwnerSkills = !state.copyOwnerSkills;
    updateControls(deps, player, state);
    setFeedback(player, state.copyOwnerSkills ? "Your base skill levels will be passed to the selected bot implementation." : "The selected routine or activity plugin will use its configured skill setup.");
  } else if (setupOptionIndex >= 0) {
    const launcher = selectedLauncher(state);
    const field = launcher?.kind === "activity" ? launcher.setupFields?.[setupOptionIndex] : null;
    if (!field) return true;
    const values = activitySetup(launcher, state);
    const currentIndex = field.choices.findIndex(choice => choice.value === values[field.id]);
    const selected = field.choices[(currentIndex + 1) % field.choices.length];
    values[field.id] = selected.value;
    state.activitySetupByLauncher.set(launcher.key, values);
    updateControls(deps, player, state);
    setFeedback(player, `${field.label}: ${selected.label}.`);
  } else if (spawn.includes(buttonId)) {
    const launcher = selectedLauncher(state);
    if (!launcher) {
      setFeedback(player, "Choose a routine or activity bot before deploying.");
      return true;
    }
    const activity = selectedActivity(deps.brainRegistry, state);
    const playerLocation = currentLocation(player);
    const spawnLocation = selectedLocation(player, launcher, state);
    if (state.usePlayerLocation && !playerLocation) {
      setFeedback(player, "Your current tile is unavailable; choose the saved location or try again.");
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
    const result = launcher.kind === "routine"
      ? deployRoutineBots({
        runtime: deps.runtime,
        brainRegistry: deps.brainRegistry,
        core: deps.api.core,
        activityId: launcher.activityId,
        count: state.count,
        overrides,
        fallbackLocation: playerLocation,
      })
      : deployRegisteredBots({
        runtime: deps.runtime,
        launcher,
        count: state.count,
        location: spawnLocation,
        context: {
          api: deps.api, runtime: deps.runtime, brainRegistry: deps.brainRegistry, core: deps.api.core,
          player, skillOverrides: overrides.skills ?? null, setup: activitySetup(launcher, state),
        },
      });
    if (!result.ok) setFeedback(player, result.error);
    else {
      const suffix = result.failures?.length ? ` ${result.failures.length} failed.` : "";
      const label = launcher.kind === "routine" ? displayName(activity?.id ?? result.activityId) : launcher.name;
      const message = `Spawned ${result.spawned.length}/${result.requested} ${label} bot(s).${suffix}`;
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
    "Open the bot routine and activity deployment interface");
  api.onInterfaceActionButton(rowUids, event => clickRow(event, deps));
  api.onInterfaceActionButton(Object.values(BUTTON_COMPONENTS).flat(Infinity).map(uid), event => clickButton(event, deps));
}

module.exports = {
  name: "BotRoutinesInterface",
  description: "Adds the developer-only ::bots routine and activity launcher interface.",
  registerBotsInterface,
  _test: { GROUP_ID, COMPONENT, BUTTON_COMPONENTS, rowUids, uid, eligibleActivities, eligibleLaunchers, routineRow, activitySetup,
    setupSummary, managedBotCount, ownerSkillOverrides, currentLocation, openBots, clickRow, clickButton, sessions,
    INTERFACE_DEFINITION, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS },
};
