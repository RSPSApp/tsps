"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ROSTER_MODES, deployRosterRows } = require("./Roster.PlayerBots");
const { prepareRoutineDeployment, spawnPreparedBot, trackNativeDeployment, checkDeploymentLimits } = require("./Deploy.PlayerBots");
const FILE = path.resolve(__dirname, "../../../data/saves/bot-deployment-plans.json");
const { isRoutineId, nativeRoutineId, matchRoutineIds } = require("./RoutineCatalog.PlayerBots");
const { canSpawn } = require("./Activation.PlayerBots");
const PEST_ROUTINE = matchRoutineIds["pest-control"];
const MAX_PLAN_ROWS = 12;
const TEAM_MODE = new Map(Object.entries(ROSTER_MODES).flatMap(([mode, teams]) => teams.map(team => [team, mode])));
const rowMode = row => TEAM_MODE.get(row?.team) ?? (nativeRoutineId("pest-control", row?.routine) ? "pest-control" : "world");
const planMode = plan => rowMode(plan.rows[0]);

function normalizePlan(input) {
  const { id, name, mode, rows } = input ?? {};
  if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,47}$/.test(id)) throw new Error("Use a lowercase plan ID (letters, numbers, underscores or hyphens).");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 48 || /[<>\u0000-\u001f]/.test(name)) throw new Error("Give the deployment plan a plain-text name of 1–48 characters.");
  if (mode !== undefined && mode !== "world" && !Object.hasOwn(ROSTER_MODES, mode)) throw new Error("Invalid legacy deployment type.");
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_PLAN_ROWS) throw new Error(`Include 1–${MAX_PLAN_ROWS} routine rows.`);
  let total = 0;
  const clean = rows.map((row, i) => {
    const { routine, team, count } = row ?? {};
    const chosenTeam = mode === "world" ? undefined : team;
    if (chosenTeam !== undefined && !TEAM_MODE.has(chosenTeam) || (Object.hasOwn(ROSTER_MODES, mode) && !ROSTER_MODES[mode].includes(chosenTeam))) throw new Error(`Row ${i + 1}: choose a valid team.`);
    const builtin = nativeRoutineId(TEAM_MODE.get(chosenTeam) ?? "pest-control", routine);
    if (!(isRoutineId(routine) || builtin)) throw new Error(`Row ${i + 1}: choose a routine for this team or activity.`);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Row ${i + 1}: count must be a nonnegative whole number.`);
    total += count;
    return { routine: builtin ?? routine, count, ...(chosenTeam === undefined ? {} : { team: chosenTeam }) };
  });
  if (!Number.isSafeInteger(total) || total < 1) throw new Error("Choose a valid total of at least one bot.");
  if (new Set(clean.map(rowMode)).size !== 1) throw new Error("Plan rows must all be for the same minigame or all be open-world routines.");
  if (rowMode(clean[0]) === "pest-control" && clean.length !== 1) throw new Error("Use one row for the Pest Control lander.");
  return { id, name: name.trim(), rows: clean };
}

const DEFAULTS = [
  { id: "castle-wars", name: "Castle Wars", rows: ROSTER_MODES["castle-wars"].map(team => ({ routine: matchRoutineIds["castle-wars"], team, count: 2 })) },
  { id: "soul-wars", name: "Soul Wars", rows: ROSTER_MODES["soul-wars"].map(team => ({ routine: matchRoutineIds["soul-wars"], team, count: 10 })) },
  { id: "pest-control", name: "Pest Control", rows: [{ routine: PEST_ROUTINE, count: 5 }] },
].map(normalizePlan);

function readPlanStore(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const { plans: saved, removed = [] } = Array.isArray(data) ? { plans: data } : data;
    if (!Array.isArray(saved) || saved.length > 50 || !Array.isArray(removed) || removed.length > 50 || removed.some(id => typeof id !== "string")) throw new Error("Invalid deployment plan store.");
    const plans = saved.map(normalizePlan);
    if (new Set(plans.map(plan => plan.id)).size !== plans.length) throw new Error("Deployment plan IDs must be unique.");
    return { plans, removed };
  } catch (error) {
    if (error.code === "ENOENT") return { plans: [], removed: [] };
    throw error;
  }
}

function readPlans(file = FILE, defaults = DEFAULTS) {
  const saved = readPlanStore(file);
  const plans = new Map(defaults.filter(plan => !saved.removed.includes(plan.id)).map(plan => [plan.id, plan]));
  for (const plan of saved.plans) plans.set(plan.id, plan);
  return [...plans.values()];
}

function readAvailablePlans(codePlans = []) {
  const plans = new Map(readPlans().map(plan => [plan.id, plan]));
  for (const plan of codePlans) if (!plans.has(plan.id)) plans.set(plan.id, plan);
  return [...plans.values()];
}

function savePlan(input, file = FILE, defaults = DEFAULTS) {
  if (typeof input?.id === "string" && input.id.startsWith("plugin-") && !readPlans(file, defaults).some(plan => plan.id === input.id)) throw new Error("The plugin- prefix is reserved for code deployment presets.");
  const plans = readPlans(file, defaults);
  if (input?.remove === true) {
    const index = plans.findIndex(plan => plan.id === input.id);
    if (index < 0) throw new Error("Deployment plan does not exist.");
    plans.splice(index, 1);
  } else {
    const plan = normalizePlan(input);
    const index = plans.findIndex(existing => existing.id === plan.id);
    if (index >= 0) plans[index] = plan;
    else plans.push(plan);
    if (plans.length > 50) throw new Error("At most 50 plans may be saved.");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const byId = new Map(defaults.map(plan => [plan.id, plan]));
  const store = {
    plans: plans.filter(plan => JSON.stringify(plan) !== JSON.stringify(byId.get(plan.id))),
    removed: defaults.filter(plan => !plans.some(item => plan.id === item.id)).map(plan => plan.id),
  };
  try { fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  return plans;
}

function normalizePlanOverrideFields(plan, fields = [], allowedRoutine = () => false) {
  if (!Array.isArray(fields) || (fields.length && fields.length !== plan.rows.length)) throw new Error("Provide one launchOverrides entry per plan row.");
  return plan.rows.map((row, index) => {
    const entry = fields[index] ?? {};
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some(key => !["count", "routines"].includes(key)) || (entry.count !== undefined && typeof entry.count !== "boolean")) throw new Error(`Invalid launchOverrides for row ${index + 1}.`);
    const { count = false, routines = [] } = entry;
    if (!Array.isArray(routines) || routines.length > 20 || new Set(routines).size !== routines.length) throw new Error(`Invalid routine choices for row ${index + 1}.`);
    for (const routine of routines) {
      const candidate = { ...row, routine };
      if (!allowedRoutine(routine) || rowMode(candidate) !== planMode(plan)) throw new Error(`Routine override '${routine}' is not available for row ${index + 1}.`);
      normalizePlan({ ...plan, rows: plan.rows.map((original, i) => i === index ? candidate : original) });
    }
    return { count, routines: routines.slice() };
  });
}

// Older saved plans and the shipped presets allow temporary row counts. A code
// preset supplies its own policy explicitly, even when every row is locked.
const planOverrideFields = plan => plan.launchOverrides ?? plan.rows.map(() => ({ count: true, routines: [] }));

function applyPlanOverrides(plan, overrides = []) {
  if (!Array.isArray(overrides) || (overrides.length !== 0 && overrides.length !== plan.rows.length)) throw new Error("Plan changed. Select it again before deploying.");
  const fields = planOverrideFields(plan);
  const rows = plan.rows.map((row, i) => {
    const input = overrides[i];
    if (input === undefined) return row;
    const rule = fields[i];
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "routine" && key !== "count")) throw new Error(`Row ${i + 1}: override only advertised fields.`);
    if (Object.hasOwn(input, "count") && !rule.count) throw new Error(`Row ${i + 1}: count is fixed by this plan.`);
    if (Object.hasOwn(input, "routine") && (!rule.routines.length || (input.routine !== row.routine && !rule.routines.includes(input.routine)))) throw new Error(`Row ${i + 1}: that routine override is not offered by this plan.`);
    return { ...row, ...input };
  });
  const launch = normalizePlan({ ...plan, rows });
  if (planMode(launch) !== planMode(plan)) throw new Error("Deployment overrides cannot change the plan's match context.");
  return launch;
}

function deployPlan({ api, runtime, brainRegistry }, input, fallbackLocation, rowOverrides = {}) {
  let plan;
  try { plan = normalizePlan(input); }
  catch (error) { return { ok: false, status: 400, error: error.message }; }
  const rows = plan.rows.map((row, i) => ({ ...row, overrides: rowOverrides[i] ?? {} })).filter(row => row.count > 0);
  const mode = planMode(plan);
  if (mode === "pest-control") {
    if (!runtime) return { ok: false, status: 503, error: "The bot runtime is not ready." };
    if (!canSpawn(mode)) return { ok: false, status: 409, error: "Pest Control bot deployment is disabled." };
    const { botActivityAllowed } = require("../behaviours/spawn/PlayerFactory.PlayerBots");
    if (!botActivityAllowed("developer") || !botActivityAllowed(mode)) return { ok: false, status: 403, error: "This world does not allow Pest Control bot deployments." };
    const count = rows[0].count;
    const capacity = checkDeploymentLimits(runtime, count, api.getWorld?.());
    if (capacity) return capacity;
    const request = { count, track: bot => trackNativeDeployment(runtime, bot, api.getWorld()), result: null };
    api.emitCustomEvent("bots:deploy-pest-control-plan", request);
    return request.result ?? { ok: false, status: 503, error: "Pest Control is not available in this world." };
  }
  if (mode !== "world") return deployRosterRows({ api, runtime, brainRegistry }, mode, rows);
  if (!runtime || !brainRegistry) return { ok: false, status: 503, error: "The bot runtime is not ready." };
  const capacity = checkDeploymentLimits(runtime, rows.reduce((sum, row) => sum + row.count, 0), api.getWorld?.() ?? api.core.World);
  if (capacity) return capacity;
  const prepared = [];
  for (const row of rows) {
    const item = prepareRoutineDeployment({ runtime, brainRegistry, core: api.core, activityId: row.routine, count: row.count, fallbackLocation, overrides: row.overrides });
    if (!item.ok) return { ...item, error: `${row.routine}: ${item.error}` };
    prepared.push({ plan: item, count: row.count });
  }
  const created = [];
  try {
    for (const row of prepared) {
      for (let i = 0; i < row.count; i++) created.push(spawnPreparedBot({ runtime, core: api.core, plan: row.plan }).bot);
    }
  } catch (error) {
    for (const bot of created) bot.requestLogout();
    return { ok: false, status: 409, error: `Plan rolled back: ${String(error.message ?? error).slice(0, 160)}` };
  }
  return { ok: true, spawned: created.map(bot => bot.getUsername()) };
}

module.exports = { normalizePlan, normalizePlanOverrideFields, planOverrideFields, readPlans, readAvailablePlans, savePlan, deployPlan, applyPlanOverrides, planMode, isRoutineId, PEST_ROUTINE, MAX_PLAN_ROWS };
