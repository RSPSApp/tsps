"use strict";

const { applyPlanOverrides, deployPlan, planOverrideFields } = require("../runtime/DeploymentPlans.PlayerBots");
const { routineName } = require("../runtime/RoutineCatalog.PlayerBots");

const teamNames = { saradomin: "Saradomin", zamorak: "Zamorak", blue: "Blue", red: "Red" };

function createPlanSetup(plan) {
  return { plan, rules: planOverrideFields(plan), overrides: plan.rows.map(() => ({})) };
}
const currentRow = (state, index) => ({ ...state.plan.rows[index], ...state.overrides[index] });
const totalCount = state => state.plan.rows.reduce((total, row, index) => total + (state.overrides[index].count ?? row.count), 0);

function planSetupView(state, registry) {
  const name = id => registry.byId?.get(id)?.name ?? routineName(id);
  return {
    title: state.plan.name,
    summary: `${totalCount(state)} bots across ${state.plan.rows.length} rows`,
    rows: state.plan.rows.map((_, index) => {
      const row = currentRow(state, index);
      const rule = state.rules[index];
      return {
        name: `${index + 1}. ${row.team ? `${teamNames[row.team] ?? row.team}: ` : ""}${name(row.routine)}`,
        count: row.count, editableCount: rule.count, editableRoutine: rule.routines.length > 0,
      };
    }),
  };
}

function changePlanCount(state, index, count) {
  if (!state.rules[index]?.count) return;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Enter a nonnegative whole number.");
  if (count === state.plan.rows[index].count) delete state.overrides[index].count;
  else state.overrides[index].count = count;
}

function changePlanRoutine(state, index) {
  const routines = state.rules[index]?.routines;
  if (!routines?.length) return;
  const initial = state.plan.rows[index].routine;
  const choices = [...new Set([initial, ...routines])];
  const current = choices.indexOf(currentRow(state, index).routine);
  const next = choices[(current + 1) % choices.length];
  if (next === initial) delete state.overrides[index].routine;
  else state.overrides[index].routine = next;
}

function launchPlan(deps, state) {
  let plan;
  try { plan = applyPlanOverrides(state.plan, state.overrides); }
  catch (error) { return { ok: false, error: error.message }; }
  const result = deployPlan(deps, plan);
  if (!result.ok) return result;
  const count = Array.isArray(result.spawned) ? result.spawned.length : Object.values(result.spawned).flat().length;
  return { ok: true, message: `Deployed ${count} bots from ${plan.name}.` };
}

module.exports = { createPlanSetup, planSetupView, changePlanCount, changePlanRoutine, launchPlan, currentRow };
