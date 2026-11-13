"use strict";

const { deployRoutineBots, deployRegisteredBots, MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS } = require("../runtime/Deploy.PlayerBots");
const { collectActivityLaunchers } = require("../runtime/LauncherCatalog.PlayerBots");
const Layout = require("./Layout.Bots.PlayerBots");

const {
  GROUP_ID, SETUP_GROUP_ID, MAIN_MODAL_UID, BROWSER_COMPONENT, SETUP_COMPONENT,
  BROWSER_BUTTONS, SETUP_BUTTONS, TAB_UIDS, rowUids, uid, setupUid,
} = Layout;
const sessions = new WeakMap();
const BROWSER_INTERFACE = Layout.buildBrowserInterface();
const SETUP_INTERFACE = Layout.buildSetupInterface();
function view(player) {
  const groupId = player.getInterfaceId?.();
  return groupId === GROUP_ID ? "browser" : groupId === SETUP_GROUP_ID ? "setup" : null;
}
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
function brief(value, max = 140) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
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
function eligibleLaunchers(api, brainRegistry) {
  const routines = eligibleActivities(brainRegistry).map(activity => ({
    key: `routine:${activity.id}`, kind: "routine", activityId: activity.id, activity,
    name: displayName(activity.id), detail: activity.repeat === true ? "Repeating routine" : "One-shot routine",
  }));
  const activities = collectActivityLaunchers(api).map(launcher => ({
    ...launcher,
    panel: {
      title: launcher.name,
      subtitle: `${launcher.detail} · activity plugin`,
      description: brief(`${launcher.description} ${launcher.setupSummary}`),
    },
  }));
  return { routines, activities };
}
function routineRow(activity, id) {
  const repeat = activity.repeat === true;
  const name = displayName(activity.id);
  const subtitle = `${repeat ? "Repeating" : "One-shot"} routine${activity.usesAiAgent ? " · AI required" : ""}`;
  const description = brief(`${setupSummary(activity)}${activity.usesAiAgent ? " This routine also requires an enabled AI provider." : ""}`);
  return {
    id, name, detail: repeat ? "Repeating" : "One-shot",
    terms: `${activity.id} ${activity.usesAiAgent ? "AI agent" : ""} ${subtitle}`,
    panel: { title: name, subtitle, description },
  };
}
function activityRow(launcher, id) {
  return {
    id, name: launcher.name, detail: launcher.detail,
    terms: `${launcher.id} ${launcher.description} ${launcher.setupSummary}`,
    panel: launcher.panel,
  };
}
function sendBrowserString(player, value, component) {
  player.getPacketSender().sendString(String(value ?? ""), uid(component));
}
function sendSetupString(player, value, component) {
  player.getPacketSender().sendString(String(value ?? ""), setupUid(component));
}
function setSetupOptionVisible(player, component, visible) {
  player.getPacketSender().sendInterfaceDisplayState?.(setupUid(component), !visible);
}
function setBrowserConfigureVisible(player, visible) {
  player.getPacketSender().sendInterfaceDisplayState?.(uid(BROWSER_COMPONENT.CONFIGURE_BUTTON), !visible);
  player.getPacketSender().sendInterfaceDisplayState?.(uid(BROWSER_COMPONENT.CONFIGURE_LABEL), !visible);
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
function showEmptyPanel(player, message = "Choose a saved routine or an activity launcher contributed by a server plugin.") {
  sendBrowserString(player, "Choose a launcher", BROWSER_COMPONENT.PANEL_TITLE);
  sendBrowserString(player, "Routine or activity", BROWSER_COMPONENT.PANEL_SUBTITLE);
  sendBrowserString(player, message, BROWSER_COMPONENT.PANEL_DESCRIPTION);
  setBrowserConfigureVisible(player, false);
}
function showSelectedPanel(player, launcher) {
  const activity = launcher.kind === "routine" ? launcher.activity : null;
  const panel = launcher.kind === "routine"
    ? routineRow(activity, 0).panel
    : launcher.panel;
  sendBrowserString(player, panel.title, BROWSER_COMPONENT.PANEL_TITLE);
  sendBrowserString(player, panel.subtitle, BROWSER_COMPONENT.PANEL_SUBTITLE);
  sendBrowserString(player, panel.description, BROWSER_COMPONENT.PANEL_DESCRIPTION);
  setBrowserConfigureVisible(player, true);
}
function updateActivitySetupControls(player, launcher, state) {
  const fields = launcher?.kind === "activity" ? launcher.setupFields ?? [] : [];
  const values = activitySetup(launcher, state);
  for (const [index, [buttonComponent, labelComponent]] of SETUP_BUTTONS.setupOptions.entries()) {
    const field = fields[index];
    setSetupOptionVisible(player, buttonComponent, !!field);
    setSetupOptionVisible(player, labelComponent, !!field);
    if (!field) {
      sendSetupString(player, "", labelComponent);
      continue;
    }
    const selected = field.choices.find(choice => choice.value === values[field.id]) ?? field.choices[0];
    sendSetupString(player, `${field.label}: ${selected.label}  >`, labelComponent);
  }
}
function updateSetupControls({ runtime }, player, state) {
  const launcher = selectedLauncher(state);
  const activity = selectedActivity(state.deps.brainRegistry, state);
  if (launcher) {
    sendSetupString(player, launcher.name ?? displayName(launcher.activityId), SETUP_COMPONENT.TITLE);
    sendSetupString(player, launcher.kind === "routine"
      ? `${activity?.repeat === true ? "Repeating" : "One-shot"} routine`
      : `${launcher.detail} · activity plugin`, SETUP_COMPONENT.SUBTITLE);
    sendSetupString(player, launcher.kind === "routine"
      ? brief(`${setupSummary(activity)}${activity?.usesAiAgent ? " AI provider must be enabled before spawning." : ""}`, 110)
      : brief(`${launcher.description} ${launcher.setupSummary}`, 110), SETUP_COMPONENT.DESCRIPTION);
  } else {
    sendSetupString(player, "Configure bot deployment", SETUP_COMPONENT.TITLE);
    sendSetupString(player, "No launcher selected", SETUP_COMPONENT.SUBTITLE);
    sendSetupString(player, "Go back and choose a routine or activity.", SETUP_COMPONENT.DESCRIPTION);
  }

  sendSetupString(player, state.count, SETUP_COMPONENT.COUNT_VALUE);
  sendSetupString(player, state.usePlayerLocation ? "Use saved location" : "Spawn at my current tile", SETUP_COMPONENT.LOCATION_LABEL);
  const location = selectedLocation(player, launcher, state);
  sendSetupString(player, location
    ? `Spawn tile: ${location.x}, ${location.y}, plane ${location.z}`
    : "No valid spawn tile is available.", SETUP_COMPONENT.LOCATION_INFO);
  sendSetupString(player, `Copy my levels: ${state.copyOwnerSkills ? "On" : "Off"}`, SETUP_COMPONENT.COPY_LEVELS_LABEL);
  sendSetupString(player, `${MAX_DEPLOY_COUNT}/deploy · ${managedBotCount(runtime)}/${MAX_MANAGED_BOTS} managed`, SETUP_COMPONENT.SETUP_NOTE);
  updateActivitySetupControls(player, launcher, state);
}
function setFeedback(player, message) {
  sendSetupString(player, message, SETUP_COMPONENT.FEEDBACK);
}
function sendRows(player, deps, state) {
  const { routines, activities } = eligibleLaunchers(deps.api, deps.brainRegistry);
  const rows = [];
  const routineIds = [];
  const activityIds = [];
  state.launchers = [];
  state.launchersByRowId = new Map();
  let nextId = 1;
  for (const launcher of routines) {
    const id = nextId++;
    rows.push(routineRow(launcher.activity, id));
    state.launchers.push(launcher);
    state.launchersByRowId.set(id, launcher.key);
    routineIds.push(id);
  }
  for (const launcher of activities) {
    const id = nextId++;
    rows.push(activityRow(launcher, id));
    state.launchers.push(launcher);
    state.launchersByRowId.set(id, launcher.key);
    activityIds.push(id);
  }
  const allIds = [
    ...(routineIds.length ? [{ header: "Saved routines" }, ...routineIds] : []),
    ...(activityIds.length ? [{ header: "Activity launchers" }, ...activityIds] : []),
  ];
  state.rows = rows;
  state.tabLayouts = [allIds, routineIds, activityIds];
  state.selectedLauncherKey = null;
  sendBrowserString(player, JSON.stringify(rows), BROWSER_COMPONENT.DATA);
  sendBrowserString(player, JSON.stringify({ active: state.activeTab, tabs: state.tabLayouts }), BROWSER_COMPONENT.LAYOUT);
}
function sendSubInterface(player, groupId, title) {
  player.setInterfaceId(groupId);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, groupId, 0, {
    postScripts: [{ scriptId: 227, args: [((groupId << 16) | 1), title] }],
  });
}
function openBrowser(player, state, query = "", keepSelection = false) {
  state.view = "browser";
  sendSubInterface(player, GROUP_ID, "Bot Routines & Activities");
  if (!keepSelection) {
    sendRows(player, state.deps, state);
    showEmptyPanel(player);
  } else {
    sendBrowserString(player, JSON.stringify(state.rows), BROWSER_COMPONENT.DATA);
    sendBrowserString(player, JSON.stringify({ active: state.activeTab, tabs: state.tabLayouts }), BROWSER_COMPONENT.LAYOUT);
    const launcher = selectedLauncher(state);
    if (launcher) showSelectedPanel(player, launcher);
    else showEmptyPanel(player);
  }
  sendBrowserString(player, query, BROWSER_COMPONENT.SEARCH_INPUT);
}
function openSetup(player, state) {
  state.view = "setup";
  sendSubInterface(player, SETUP_GROUP_ID, "Configure Bot Deployment");
  updateSetupControls(state.deps, player, state);
  setFeedback(player, "Review the setup, then spawn the bots.");
}
function openBots({ player, parts = [] }, deps) {
  const { runtime, brainRegistry } = deps;
  if (!runtime || !brainRegistry) {
    player.sendMessage?.("The bot runtime is not ready.");
    return true;
  }
  const state = {
    deps, view: "browser", activeTab: 0, count: 1, usePlayerLocation: false, copyOwnerSkills: false,
    selectedLauncherKey: null, launchers: [], launchersByRowId: new Map(), rows: [], tabLayouts: [],
    activitySetupByLauncher: new Map(),
  };
  sessions.set(player, state);
  openBrowser(player, state, parts.slice(1).join(" ").slice(0, 60));
  return true;
}
function clickTab({ player, buttonId }) {
  if (view(player) !== "browser") return false;
  const state = sessions.get(player);
  if (!state) return true;
  const index = TAB_UIDS.indexOf(buttonId);
  if (index < 0) return false;
  state.activeTab = index;
  state.selectedLauncherKey = null;
  player.getFrameUpdater?.()?.clear?.(uid(BROWSER_COMPONENT.SEARCH_INPUT));
  sendBrowserString(player, "", BROWSER_COMPONENT.SEARCH_INPUT);
  const message = index === 1
    ? "Choose one of your saved routines."
    : index === 2
      ? "Choose an activity provided by a server plugin."
      : undefined;
  showEmptyPanel(player, message);
  return true;
}
function clickRow({ player, slot, opId }) {
  if (view(player) !== "browser") return false;
  const state = sessions.get(player);
  if (!state) return true;
  const launcherKey = state.launchersByRowId.get(slot | 0);
  const launcher = state.launchers.find(item => item.key === launcherKey);
  if (!launcher) return true;
  state.selectedLauncherKey = launcherKey;
  setBrowserConfigureVisible(player, true);
  if (opId !== 1) showSelectedPanel(player, launcher);
  return true;
}
function openDeploymentSetup(player, state) {
  const launcher = selectedLauncher(state);
  if (!launcher) {
    showEmptyPanel(player, "Select a routine or activity launcher before configuring a deployment.");
    return;
  }
  state.rows = state.rows ?? [];
  openSetup(player, state);
}
function clickBrowserButton({ player, buttonId }) {
  if (view(player) !== "browser") return false;
  const state = sessions.get(player);
  if (!state) return true;
  if (BROWSER_BUTTONS.configure.map(uid).includes(buttonId)) {
    openDeploymentSetup(player, state);
  } else if (BROWSER_BUTTONS.close.map(uid).includes(buttonId)) {
    player.getPacketSender().sendInterfaceRemoval();
    sessions.delete(player);
  } else return false;
  return true;
}
function deploy({ player, state, deps }) {
  const launcher = selectedLauncher(state);
  if (!launcher) {
    setFeedback(player, "Go back and choose a routine or activity before deploying.");
    return;
  }
  const activity = selectedActivity(deps.brainRegistry, state);
  const playerLocation = currentLocation(player);
  const spawnLocation = selectedLocation(player, launcher, state);
  if (state.usePlayerLocation && !playerLocation) {
    setFeedback(player, "Your current tile is unavailable; choose the saved location or try again.");
    return;
  }
  const overrides = state.usePlayerLocation ? { location: playerLocation } : {};
  if (state.copyOwnerSkills) {
    const skills = ownerSkillOverrides(player, deps.api.core);
    if (!skills) {
      setFeedback(player, "Your base skill levels are unavailable; turn off the skill override or try again.");
      return;
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
  if (!result.ok) {
    setFeedback(player, result.error);
    return;
  }
  const suffix = result.failures?.length ? ` ${result.failures.length} failed.` : "";
  const label = launcher.kind === "routine" ? displayName(activity?.id ?? result.activityId) : launcher.name;
  const message = `Spawned ${result.spawned.length}/${result.requested} ${label} bot(s).${suffix}`;
  setFeedback(player, message);
  player.sendMessage?.(message);
  updateSetupControls(deps, player, state);
}
function buttonIndex(buttons, buttonId, groupUid) {
  return buttons.findIndex(components => components.map(groupUid).includes(buttonId));
}
function clickSetupButton({ player, buttonId }) {
  if (view(player) !== "setup") return false;
  const state = sessions.get(player);
  if (!state) return true;
  const deps = state.deps;
  if (SETUP_BUTTONS.countMinus.map(setupUid).includes(buttonId)) {
    state.count = Math.max(1, state.count - 1);
    updateSetupControls(deps, player, state);
    setFeedback(player, `Deployment quantity: ${state.count}.`);
  } else if (SETUP_BUTTONS.countPlus.map(setupUid).includes(buttonId)) {
    state.count = Math.min(MAX_DEPLOY_COUNT, state.count + 1);
    updateSetupControls(deps, player, state);
    setFeedback(player, `Deployment quantity: ${state.count}.`);
  } else if (SETUP_BUTTONS.location.map(setupUid).includes(buttonId)) {
    state.usePlayerLocation = !state.usePlayerLocation;
    updateSetupControls(deps, player, state);
    setFeedback(player, state.usePlayerLocation
      ? "Bots will spawn at your current tile."
      : "Bots will use the routine or activity spawn location (or your tile if none is set).");
  } else if (SETUP_BUTTONS.copyLevels.map(setupUid).includes(buttonId)) {
    state.copyOwnerSkills = !state.copyOwnerSkills;
    updateSetupControls(deps, player, state);
    setFeedback(player, state.copyOwnerSkills
      ? "Your base skill levels will be passed to the selected bot implementation."
      : "The selected routine or activity will use its configured skill setup.");
  } else {
    const setupOptionIndex = buttonIndex(SETUP_BUTTONS.setupOptions, buttonId, setupUid);
    if (setupOptionIndex >= 0) {
      const launcher = selectedLauncher(state);
      const field = launcher?.kind === "activity" ? launcher.setupFields?.[setupOptionIndex] : null;
      if (!field) return true;
      const values = activitySetup(launcher, state);
      const currentIndex = field.choices.findIndex(choice => choice.value === values[field.id]);
      const selected = field.choices[(currentIndex + 1) % field.choices.length];
      values[field.id] = selected.value;
      state.activitySetupByLauncher.set(launcher.key, values);
      updateSetupControls(deps, player, state);
      setFeedback(player, `${field.label}: ${selected.label}.`);
    } else if (SETUP_BUTTONS.spawn.map(setupUid).includes(buttonId)) {
      deploy({ player, state, deps });
    } else if (SETUP_BUTTONS.back.map(setupUid).includes(buttonId)) {
      openBrowser(player, state, "", true);
    } else if (SETUP_BUTTONS.close.map(setupUid).includes(buttonId)) {
      player.getPacketSender().sendInterfaceRemoval();
      sessions.delete(player);
    } else return false;
  }
  return true;
}

function registerBotsInterface({ api, runtime, brainRegistry }) {
  const deps = { api, runtime, brainRegistry };
  api.registerCustomInterface(BROWSER_INTERFACE);
  api.registerCustomInterface(SETUP_INTERFACE);
  api.registerCommand("bots", command => openBots(command, deps), api.core.PlayerRights.DEVELOPER,
    "Open the bot routine and activity deployment interface");
  api.onInterfaceActionButton(TAB_UIDS, event => clickTab(event));
  api.onInterfaceActionButton(rowUids, event => clickRow(event));
  api.onInterfaceActionButton([...BROWSER_BUTTONS.configure, ...BROWSER_BUTTONS.close].map(uid), event => clickBrowserButton(event));
  api.onInterfaceActionButton(Object.values(SETUP_BUTTONS).flat(Infinity).map(setupUid), event => clickSetupButton(event));
}

module.exports = {
  name: "BotRoutinesInterface",
  description: "Adds the developer-only ::bots routine and activity launcher interface.",
  registerBotsInterface,
  _test: {
    GROUP_ID, SETUP_GROUP_ID, BROWSER_COMPONENT, SETUP_COMPONENT, BROWSER_BUTTONS, SETUP_BUTTONS,
    TAB_UIDS, rowUids, uid, setupUid, eligibleActivities, eligibleLaunchers, routineRow, activityRow, activitySetup,
    setupSummary, managedBotCount, ownerSkillOverrides, currentLocation, openBots, clickRow,
    clickBrowserButton, clickSetupButton, sessions, BROWSER_INTERFACE, SETUP_INTERFACE,
    MAX_DEPLOY_COUNT, MAX_MANAGED_BOTS,
  },
};
