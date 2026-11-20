"use strict";

const { deployRoutineBots, managedBotCount, MAX_MANAGED_BOTS, DEFAULT_LOCATION } = require("../runtime/Deploy.PlayerBots");
const { ROSTER_MODES, deployRoster } = require("../runtime/Roster.PlayerBots");
const { matchRoutineIds } = require("../runtime/RoutineCatalog.PlayerBots");
const { listRoutineDeployments, groupRoutines, defaultRoutineId } = require("../runtime/RoutineDeployments.PlayerBots");
const { validateRoutineOverrides } = require("../runtime/DeploymentOverrides.PlayerBots");
const { readAvailablePlans, planMode, planOverrideFields, applyPlanOverrides, savePlan } = require("../runtime/DeploymentPlans.PlayerBots");
const { createPlanSetup, planSetupView, changePlanCount, changePlanRoutine, launchPlan, currentRow } = require("./PlanSetup.PlayerBots");
const { ownerSkillOverrides, prompts, parseSetupOverride, overrideValue } = require("./RoutineSetup.PlayerBots");
const { savedSetupName, nextSetupId, readRoutineSetups, saveRoutineSetup } = require("../runtime/SavedRoutineSetups.PlayerBots");
const Layout = require("./Layout.Bots.PlayerBots");

const {
  GROUP_ID, SETUP_GROUP_ID, PLAN_GROUP_ID, MAIN_MODAL_UID, BROWSER_COMPONENT, SETUP_COMPONENT, PLAN_COMPONENT,
  BROWSER_BUTTONS, SETUP_BUTTONS, PLAN_BUTTONS, PLAN_ROW_HEIGHT, planRows, TAB_UIDS, ROUTINES_TAB, rowUids, uid, setupUid, planUid,
} = Layout;
const sessions = new WeakMap();
const BROWSER_INTERFACE = Layout.buildBrowserInterface();
const SETUP_INTERFACE = Layout.buildSetupInterface();
const PLAN_INTERFACE = Layout.buildPlanInterface();
const planRowActions = planRows.flatMap((row, index) => [
  ...row.routine.map(component => [planUid(component), { index, change: changePlanRoutine }]),
  ...row.minus.map(component => [planUid(component), { index, change: state => changePlanCount(state, index, Math.max(0, currentRow(state, index).count - 1)) }]),
  ...row.plus.map(component => [planUid(component), { index, change: state => changePlanCount(state, index, Math.min(Number.MAX_SAFE_INTEGER, currentRow(state, index).count + 1)) }]),
  [planUid(row.count), { index, enterCount: true }],
]);
const planActionsByUid = new Map(planRowActions);
const brief = (value, max = 140) => value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`;

function sendBrowserString(player, value, component) {
  player.getPacketSender().sendString(String(value ?? ""), uid(component));
}
function sendSetupString(player, value, component) {
  player.getPacketSender().sendString(String(value ?? ""), setupUid(component));
}
function sendPlanString(player, value, component) {
  player.getPacketSender().sendString(String(value ?? ""), planUid(component));
}
function setBrowserActionsVisible(player, visible) {
  for (const component of [...BROWSER_BUTTONS.configure, ...BROWSER_BUTTONS.deploy]) player.getPacketSender().sendInterfaceDisplayState?.(uid(component), !visible);
}
function showBrowserPanel(player, panel) {
  sendBrowserString(player, panel?.title ?? "Choose a routine or plan", BROWSER_COMPONENT.PANEL_TITLE);
  sendBrowserString(player, panel?.subtitle ?? "Bot deployment", BROWSER_COMPONENT.PANEL_SUBTITLE);
  sendBrowserString(player, panel?.description ?? "Select a row. Choose Deploy for defaults or Configure to make changes.", BROWSER_COMPONENT.PANEL_DESCRIPTION);
  setBrowserActionsVisible(player, !!panel);
}
function setupSummary(activity) {
  const setup = activity.setup;
  const skills = Object.keys(setup.skills ?? {}).length;
  const inventory = setup.inventory?.length ?? 0;
  const equipment = setup.equipment?.length ?? 0;
  const details = [skills && `${skills} starting skill levels`, inventory && `${inventory} inventory slots`, equipment && `${equipment} equipment slots`].filter(Boolean);
  return details.length ? `Starting setup: ${details.join(", ")}.` : "Uses the routine's default starting setup.";
}
function sendRows(player, state) {
  const registry = state.deps.brainRegistry;
  const activities = listRoutineDeployments(registry);
  state.activities = new Map(activities.map(activity => [activity.id, activity]));
  state.launchersByRowId = new Map();
  const rows = [], routineRows = [], savedRows = [], planRows = [];
  function add(key, launcher, detail, terms, panel) {
    const id = rows.length + 1;
    rows.push({ id, name: launcher.name, detail, terms });
    state.launchersByRowId.set(id, { ...launcher, key, panel });
    return id;
  }
  for (const group of groupRoutines(activities)) {
    const activity = state.activities.get(defaultRoutineId(group));
    const name = group.label;
    const detail = activity.repeat ? "Repeating" : "One-shot";
    const variant = activity.deploymentOverrides.find(field => field.type === "routineChoice");
    const description = variant ? `Default: ${variant.choices.find(choice => choice.id === activity.id)?.label ?? activity.name}. Change ${variant.label.toLowerCase()} in Deployment overrides.` : setupSummary(activity);
    const id = add(`routine:${activity.id}`, { kind: "routine", name, activityId: activity.id }, detail,
      group.profiles.map(profile => `${profile.id} ${profile.label}`).join(" "), { title: name, subtitle: `${detail} routine`, description });
    routineRows.push(id);
    if (registry.byId?.get(activity.id)?.codeDefined) savedRows.push(id);
  }
  try {
    for (const saved of state.deps.storage.readRoutineSetups()) {
      const activity = state.activities.get(saved.activityId);
      if (!activity) continue;
      savedRows.push(add(`setup:${saved.id}`, { kind: "routine", name: saved.name, activityId: saved.activityId, saved }, `${saved.count} bots`, activity.name, {
        title: saved.name, subtitle: "Saved routine setup", description: `${saved.count} bots using ${activity.name}.`,
      }));
    }
  } catch (error) { player.sendMessage(`Saved routine setups could not load: ${error.message}`); }
  let plans = [];
  try { plans = state.deps.storage.readAvailablePlans(registry.deploymentPlans); }
  catch (error) { player.sendMessage(`Deployment plans could not load: ${error.message}`); }
  for (const plan of plans) {
    const detail = `${plan.rows.reduce((sum, row) => sum + row.count, 0)} bots`;
    const editable = planOverrideFields(plan).some(rule => rule.count || rule.routines.length);
    planRows.push(add(`plan:${plan.id}`, { kind: "plan", name: plan.name, plan }, detail, `${plan.id} ${planMode(plan)}`, {
      title: plan.name, subtitle: `${detail} · Deployment plan`,
      description: editable ? "Review the plan and its available launch overrides." : "Review the plan before deploying. No launch overrides.",
    }));
  }
  state.rows = rows;
  state.tabLayouts = [savedRows, routineRows, planRows];
}
function sendSubInterface(player, groupId, title) {
  player.setInterfaceId(groupId);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_UID, groupId, 0, {
    postScripts: [{ scriptId: 227, args: [((groupId << 16) | 1), title] }],
  });
}
function openBrowser(player, state, query = "") {
  sendSubInterface(player, GROUP_ID, "Bot deployments");
  sendBrowserString(player, JSON.stringify(state.rows), BROWSER_COMPONENT.DATA);
  sendBrowserString(player, JSON.stringify({ active: state.activeTab, tabs: state.tabLayouts }), BROWSER_COMPONENT.LAYOUT);
  showBrowserPanel(player, state.selected?.panel);
  sendBrowserString(player, query, BROWSER_COMPONENT.SEARCH_INPUT);
}
function routineSetupView(state) {
  const activity = state.activities.get(state.activityId);
  const fields = activity.deploymentOverrides;
  const location = state.overrides.location ?? activity.setup.location ?? DEFAULT_LOCATION;
  return {
    title: state.selected.name, subtitle: activity.repeat ? "Repeating routine" : "One-shot routine",
    description: `Spawn tile: ${location.x}, ${location.y}, plane ${location.z}.`,
    count: state.count, editableCount: true,
    overridesLabel: fields.length ? "Deployment overrides" : "No deployment overrides",
    options: fields.map(field => {
      const value = field.type === "routineChoice"
        ? field.choices.find(choice => choice.id === activity.id)?.label ?? activity.name
        : overrideValue(field.key, state.overrides);
      return { text: `${field.label}: ${value}  >` };
    }),
  };
}
function renderSetup(player, state) {
  const view = routineSetupView(state);
  sendSetupString(player, view.title, SETUP_COMPONENT.TITLE);
  sendSetupString(player, view.subtitle, SETUP_COMPONENT.SUBTITLE);
  sendSetupString(player, view.description, SETUP_COMPONENT.DESCRIPTION);
  sendSetupString(player, view.count, SETUP_COMPONENT.COUNT_VALUE);
  sendSetupString(player, view.overridesLabel, SETUP_COMPONENT.OVERRIDES_LABEL);
  sendSetupString(player, `${managedBotCount(state.deps.runtime)}${MAX_MANAGED_BOTS === null ? "" : `/${MAX_MANAGED_BOTS}`} managed bots`, SETUP_COMPONENT.SETUP_NOTE);
  const sender = player.getPacketSender();
  for (const component of [...SETUP_BUTTONS.countMinus, ...SETUP_BUTTONS.countPlus]) {
    sender.sendInterfaceDisplayState?.(setupUid(component), !view.editableCount);
  }
  for (const [index, [button, label]] of SETUP_BUTTONS.setupOptions.entries()) {
    const option = view.options[index];
    for (const component of [button, label]) sender.sendInterfaceDisplayState?.(setupUid(component), !option);
    sendSetupString(player, option?.text, label);
  }
}
function setFeedback(player, message) {
  sendSetupString(player, brief(message, 85), SETUP_COMPONENT.FEEDBACK);
}
function renderPlanSetup(player, state) {
  const view = planSetupView(state.planSetup, state.deps.brainRegistry);
  const sender = player.getPacketSender();
  const show = (components, visible) => {
    for (const component of components) sender.sendInterfaceDisplayState?.(planUid(component), !visible);
  };
  sendPlanString(player, view.title, PLAN_COMPONENT.TITLE);
  sendPlanString(player, view.summary, PLAN_COMPONENT.SUMMARY);
  sendPlanString(player, view.rows.length * PLAN_ROW_HEIGHT, PLAN_COMPONENT.CONTENT_HEIGHT);
  for (const [index, components] of planRows.entries()) {
    const row = view.rows[index];
    show([components.root], !!row);
    if (!row) continue;
    show([components.name], !row.editableRoutine);
    show(components.routine, row.editableRoutine);
    show([...components.minus, ...components.plus], row.editableCount);
    sendPlanString(player, brief(row.name, 42), components.name);
    sendPlanString(player, `${brief(row.name, 40)}  >`, components.routine[1]);
    sendPlanString(player, row.count, components.count);
  }
}
function openDeploymentSetup(player, state) {
  if (!state.selected) return;
  if (state.selected.kind === "plan") {
    state.planSetup = createPlanSetup(state.selected.plan);
    sendSubInterface(player, PLAN_GROUP_ID, "Configure Deployment Plan");
    renderPlanSetup(player, state);
    sendPlanString(player, "Click an editable count to type a value.", PLAN_COMPONENT.FEEDBACK);
    return;
  }
  state.activityId = state.selected.activityId;
  state.overrides = structuredClone(state.selected.saved?.overrides ?? {});
  state.count = state.selected.saved?.count ?? 1;
  sendSubInterface(player, SETUP_GROUP_ID, "Configure Bot Deployment");
  renderSetup(player, state);
  setFeedback(player, "Click the count to type a value, or use - and +.");
}
function openBots({ player, parts = [] }, deps) {
  const mode = parts[1]?.toLowerCase();
  if (Object.hasOwn(ROSTER_MODES, mode)) {
    const [first, second] = ROSTER_MODES[mode];
    if (parts.length !== 6 || ![parts[3], parts[5]].every(count => /^\d+$/.test(count))) {
      player.sendMessage(`Usage: ::bots ${mode} <${first} routine|${matchRoutineIds[mode]}> <count> <${second} routine|${matchRoutineIds[mode]}> <count>`);
      return true;
    }
    const result = deployRoster(deps, mode, {
      [first]: { routine: parts[2], count: Number(parts[3]) }, [second]: { routine: parts[4], count: Number(parts[5]) },
    });
    player.sendMessage(result.ok ? `Roster deployed: ${result.spawned[first].length} ${first}, ${result.spawned[second].length} ${second}.` : result.error);
    return true;
  }
  if (!deps.runtime || !deps.brainRegistry) {
    player.sendMessage("The bot runtime is not ready.");
    return true;
  }
  const state = { deps, activeTab: ROUTINES_TAB, selected: null, overridePrompt: null };
  sessions.set(player, state);
  sendRows(player, state);
  openBrowser(player, state, parts.slice(1).join(" ").slice(0, 60));
  return true;
}
function clickTab({ player, buttonId }) {
  if (player.getInterfaceId() !== GROUP_ID) return false;
  const state = sessions.get(player);
  const index = TAB_UIDS.indexOf(buttonId);
  if (!state || index < 0) return false;
  state.activeTab = index;
  state.selected = null;
  player.getFrameUpdater?.()?.clear?.(uid(BROWSER_COMPONENT.SEARCH_INPUT));
  sendBrowserString(player, "", BROWSER_COMPONENT.SEARCH_INPUT);
  showBrowserPanel(player);
  return true;
}
function clickRow({ player, slot }) {
  if (player.getInterfaceId() !== GROUP_ID) return false;
  const state = sessions.get(player);
  if (!state) return true;
  const id = slot | 0;
  if (!state.tabLayouts[state.activeTab].includes(id)) {
    showBrowserPanel(player, state.selected?.panel);
    return true;
  }
  state.selected = state.launchersByRowId.get(id);
  showBrowserPanel(player, state.selected?.panel);
  return true;
}
function close(player) {
  player.getPacketSender().sendInterfaceRemoval();
  sessions.delete(player);
}
function matchesButton(components, buttonId, toUid) {
  return components.some(component => toUid(component) === buttonId);
}
function clickBrowserButton({ player, buttonId }) {
  if (player.getInterfaceId() !== GROUP_ID) return false;
  const state = sessions.get(player);
  if (!state) return true;
  if (matchesButton(BROWSER_BUTTONS.configure, buttonId, uid)) openDeploymentSetup(player, state);
  else if (matchesButton(BROWSER_BUTTONS.deploy, buttonId, uid)) {
    const launcher = state.selected;
    if (launcher) {
      const result = launcher.kind === "plan"
        ? launchPlan(state.deps, createPlanSetup(launcher.plan))
        : launchRoutine(state, launcher.activityId, launcher.saved?.count ?? 1, launcher.saved?.overrides ?? {});
      finishDeploy(player, result, error => sendBrowserString(player, error, BROWSER_COMPONENT.PANEL_DESCRIPTION));
    } else {
      showBrowserPanel(player);
      player.sendMessage("Select a routine or deployment plan before deploying.");
    }
  } else return false;
  return true;
}
function promptSetupInput(player, state, group, label, apply, feedback) {
  const token = state.overridePrompt = {};
  player.setEnteredSyntaxAction({ execute(text) {
    if (sessions.get(player) !== state || state.overridePrompt !== token || player.getInterfaceId() !== group) return;
    state.overridePrompt = null;
    try { apply(text); }
    catch (error) { feedback(error.message); }
  } });
  player.getPacketSender().sendEnterInputPrompt(label);
}

function enteredCount(text, minimum) {
  const count = Number(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isSafeInteger(count) || count < minimum) throw new Error(`Enter a whole number of at least ${minimum}.`);
  return count;
}

function saveConfiguration(player, state, group) {
  const isPlan = group === PLAN_GROUP_ID;
  const feedback = message => isPlan ? sendPlanString(player, brief(message, 85), PLAN_COMPONENT.FEEDBACK) : setFeedback(player, message);
  promptSetupInput(player, state, group, isPlan ? "Name the deployment plan" : "Name the saved routine setup", text => {
    const name = savedSetupName(text);
    if (isPlan) {
      const { plan, overrides } = state.planSetup;
      const draft = applyPlanOverrides(plan, overrides);
      const id = nextSetupId(name, state.deps.storage.readAvailablePlans(state.deps.brainRegistry.deploymentPlans));
      state.deps.storage.savePlan({ ...draft, id, name });
    } else {
      validateRoutineOverrides(state.deps.brainRegistry.byId?.get(state.activityId), state.overrides);
      state.deps.storage.saveRoutineSetup({ name, activityId: state.activityId, count: state.count, overrides: state.overrides });
    }
    sendRows(player, state);
    feedback(`Saved ${name}.`);
  }, feedback);
}

function editOverride(player, state, field, activity) {
  if (field.type === "routineChoice") {
    const index = field.choices.findIndex(choice => choice.id === activity.id);
    const choice = field.choices[(index + 1) % field.choices.length];
    if (!choice || !state.activities.has(choice.id) || choice.id === state.activityId) return;
    state.activityId = choice.id;
    state.overrides = {};
    renderSetup(player, state);
    setFeedback(player, `${field.label}: ${choice.label}. Other overrides reset.`);
    return;
  }
  const prompt = prompts[field.key];
  if (!prompt) return;
  const token = state.overridePrompt = {};
  player.setEnteredSyntaxAction({ execute(text) {
    if (sessions.get(player) !== state || state.overridePrompt !== token || player.getInterfaceId() !== SETUP_GROUP_ID || state.activityId !== activity.id) return;
    state.overridePrompt = null;
    try {
      state.overrides = parseSetupOverride(field.key, text, activity, state.overrides, player, state.deps.api.core);
      setFeedback(player, `${field.label}: ${overrideValue(field.key, state.overrides)}.`);
    } catch (error) { setFeedback(player, error.message); }
    renderSetup(player, state);
  } });
  player.getPacketSender().sendEnterInputPrompt(prompt);
}
function launchRoutine(state, activityId, count, overrides) {
  const { runtime, brainRegistry, api } = state.deps;
  let validated;
  try { validated = validateRoutineOverrides(brainRegistry.byId?.get(activityId), overrides); }
  catch (error) { return { ok: false, error: error.message }; }
  const result = deployRoutineBots({ runtime, brainRegistry, core: api.core, activityId, count, overrides: validated });
  if (!result.ok) return result;
  const name = state.activities.get(activityId).name;
  const suffix = result.failures?.length ? ` ${result.failures.length} failed.` : "";
  const tile = validated.location ?? state.activities.get(activityId).setup.location ?? DEFAULT_LOCATION;
  return { ok: true, message: `Spawned ${result.spawned.length}/${result.requested} ${name} bot(s) at ${tile.x}, ${tile.y}, plane ${tile.z}.${suffix}` };
}
function finishDeploy(player, result, showError) {
  if (!result.ok) {
    showError(result.error);
    player.sendMessage(result.error);
    return;
  }
  close(player);
  player.sendMessage(result.message);
}
function clickSetupButton({ player, buttonId }) {
  if (player.getInterfaceId() !== SETUP_GROUP_ID) return false;
  const state = sessions.get(player);
  if (!state) return true;
  state.overridePrompt = null;
  const buttons = SETUP_BUTTONS;
  const is = key => matchesButton(buttons[key], buttonId, setupUid);
  const row = buttons.setupOptions.findIndex(components => matchesButton(components, buttonId, setupUid));
  if (is("back")) { openBrowser(player, state); return true; }
  if (is("save")) saveConfiguration(player, state, SETUP_GROUP_ID);
  else if (is("setCount")) {
    promptSetupInput(player, state, SETUP_GROUP_ID, "How many bots?", text => {
      state.count = enteredCount(text, 1);
      renderSetup(player, state);
      setFeedback(player, "");
    }, error => setFeedback(player, error));
  } else if (row >= 0) {
    const activity = state.activities.get(state.activityId);
    const field = activity.deploymentOverrides[row];
    if (field) editOverride(player, state, field, activity);
  } else if (is("spawn")) {
    finishDeploy(player, launchRoutine(state, state.activityId, state.count, state.overrides), error => setFeedback(player, error));
  } else if (is("countMinus") || is("countPlus")) {
    state.count = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, state.count + (is("countPlus") ? 1 : -1)));
    renderSetup(player, state);
  } else return false;
  return true;
}

function clickPlanButton({ player, buttonId }) {
  if (player.getInterfaceId() !== PLAN_GROUP_ID) return false;
  const state = sessions.get(player);
  if (!state?.planSetup) return true;
  state.overridePrompt = null;
  const is = key => matchesButton(PLAN_BUTTONS[key], buttonId, planUid);
  if (is("back")) openBrowser(player, state);
  else if (is("save")) saveConfiguration(player, state, PLAN_GROUP_ID);
  else if (is("deploy")) {
    finishDeploy(player, launchPlan(state.deps, state.planSetup), error => sendPlanString(player, brief(error, 85), PLAN_COMPONENT.FEEDBACK));
  } else {
    const action = planActionsByUid.get(buttonId);
    if (!action) return false;
    if (action.enterCount) {
      if (!state.planSetup.rules[action.index]?.count) return true;
      promptSetupInput(player, state, PLAN_GROUP_ID, "How many bots in this row?", text => {
        changePlanCount(state.planSetup, action.index, enteredCount(text, 0));
        renderPlanSetup(player, state);
        sendPlanString(player, "", PLAN_COMPONENT.FEEDBACK);
      }, error => sendPlanString(player, brief(error, 85), PLAN_COMPONENT.FEEDBACK));
      return true;
    }
    action.change(state.planSetup, action.index);
    renderPlanSetup(player, state);
    sendPlanString(player, "", PLAN_COMPONENT.FEEDBACK);
  }
  return true;
}

function registerBotsInterface({ api, runtime, brainRegistry, storage = { readAvailablePlans, readRoutineSetups, savePlan, saveRoutineSetup } }) {
  const deps = { api, runtime, brainRegistry, storage };
  api.registerCustomInterface(BROWSER_INTERFACE);
  api.registerCustomInterface(SETUP_INTERFACE);
  api.registerCustomInterface(PLAN_INTERFACE);
  api.registerCommand("bots", command => openBots(command, deps), api.core.PlayerRights.DEVELOPER,
    "Open bot deployment, or deploy a castle-wars or soul-wars team roster");
  api.onInterfaceActionButton(TAB_UIDS, clickTab);
  api.onInterfaceActionButton(rowUids, clickRow);
  api.onInterfaceActionButton(Object.values(BROWSER_BUTTONS).flat().map(uid), clickBrowserButton);
  api.onInterfaceActionButton(Object.values(SETUP_BUTTONS).flat(Infinity).map(setupUid), clickSetupButton);
  api.onInterfaceActionButton([...Object.values(PLAN_BUTTONS).flat().map(planUid), ...planActionsByUid.keys()], clickPlanButton);
}

module.exports = {
  name: "BotRoutinesInterface",
  description: "Adds the developer-only ::bots routine and deployment plan interface.",
  registerBotsInterface,
  _test: { sessions, ownerSkillOverrides },
};
