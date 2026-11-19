"use strict";

const { prepareRoutineDeployment, spawnPreparedBot, trackNativeDeployment, checkDeploymentLimits } = require("./Deploy.PlayerBots");

const { canSpawn } = require("./Activation.PlayerBots");

const ROSTER_MODES = Object.freeze({
  "castle-wars": ["saradomin", "zamorak"],
  "soul-wars": ["blue", "red"],
});
const { nativeRoutineId, matchRoutineIds, isCodeRoutineId } = require("./RoutineCatalog.PlayerBots");

function normalizeRoster(mode, roster) {
  if (!Object.hasOwn(ROSTER_MODES, mode)) throw new Error("Choose a supported team minigame.");
  if (!roster || typeof roster !== "object" || Array.isArray(roster)) throw new Error("Supply a team roster.");
  const teams = {};
  const builtin = matchRoutineIds[mode];
  for (const name of ROSTER_MODES[mode]) {
    const { routine, count } = roster[name] ?? {};
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${name}: enter a nonnegative whole number.`);
    if (count && !nativeRoutineId(mode, routine) && !isCodeRoutineId(routine) && !(typeof routine === "string" && /^custom_[a-z0-9_]{1,48}$/.test(routine))) {
      throw new Error(`${name}: choose a saved routine or '${builtin}'.`);
    }
    teams[name] = { routine: count ? nativeRoutineId(mode, routine) ?? routine : builtin, count };
  }
  if (!Object.values(teams).some(team => team.count)) throw new Error("Choose at least one bot.");
  return teams;
}

function deployRoster({ api, runtime, brainRegistry }, mode, input) {
  if (!runtime || !brainRegistry) return { ok: false, status: 503, error: "The bot runtime is not ready." };
  let teams;
  try { teams = normalizeRoster(mode, input); }
  catch (error) { return { ok: false, status: 400, error: error.message }; }
  return deployRosterRows({ api, runtime, brainRegistry }, mode, Object.entries(teams).filter(([, row]) => row.count).map(([team, row]) => ({ team, ...row })));
}

function deployRosterRows({ api, runtime, brainRegistry }, mode, rows) {
  if (!runtime || !brainRegistry) return { ok: false, status: 503, error: "The bot runtime is not ready." };
  const teams = Object.fromEntries(ROSTER_MODES[mode].map(team => [team, { count: 0 }]));
  for (const row of rows) teams[row.team].count += row.count;
  if (!canSpawn(mode)) return { ok: false, status: 409, error: "This minigame's bot deployment is disabled." };
  const count = Object.values(teams).reduce((sum, team) => sum + team.count, 0);
  const { botActivityAllowed } = require("../behaviours/spawn/PlayerFactory.PlayerBots");
  if (!botActivityAllowed("developer") || !botActivityAllowed(mode)) return { ok: false, status: 403, error: "This world does not allow developer deployments for this minigame." };
  if (!Number.isSafeInteger(count)) return { ok: false, status: 400, error: "Invalid roster total." };
  const capacity = checkDeploymentLimits(runtime, count, api.getWorld?.());
  if (capacity) return capacity;

  const request = { teams, rows, result: null, prepare: null };
  request.prepare = location => {
    const plans = new Map();
    const spawnAt = { x: location.getX(), y: location.getY(), z: location.getZ() };
    for (const row of rows) {
      const { team, routine, count } = row;
      if (!count || nativeRoutineId(mode, routine)) continue;
      const plan = prepareRoutineDeployment({ runtime, brainRegistry, core: api.core, activityId: routine, count, overrides: { skills: row.overrides?.skills, location: spawnAt } });
      if (!plan.ok) return { ...plan, error: `${team} / ${routine}: ${plan.error}` };
      plans.set(row, plan);
    }
    return {
      ok: true,
      spawn: (row, at = location) => spawnPreparedBot({ runtime, core: api.core, plan: plans.get(row), location: at, source: mode, deferStart: true, launcherId: mode }),
      track: bot => trackNativeDeployment(runtime, bot, api.getWorld()),
    };
  };
  api.emitCustomEvent(`bots:deploy-${mode}-roster`, request);
  return request.result ?? { ok: false, status: 503, error: "That minigame is not available in this world." };
}

module.exports = { ROSTER_MODES, deployRoster, deployRosterRows, normalizeRoster };
