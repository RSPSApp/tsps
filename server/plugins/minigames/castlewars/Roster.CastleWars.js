"use strict";

const routines = new WeakMap();
const { nativeRoutineId } = require("../../bots/runtime/RoutineCatalog.PlayerBots");

function planRosterOrder(counts, teams, chooseTeam) {
  const pending = { ...counts };
  const remaining = Object.fromEntries(Object.entries(teams).map(([team, group]) => [team, group.count]));
  const order = [];
  while (Object.values(remaining).some(Boolean)) {
    const team = Object.keys(remaining).find(teamId => remaining[teamId] > 0 && chooseTeam(pending, teamId) === teamId);
    if (!team) return null;
    order.push(team);
    remaining[team]--;
    pending[team]++;
  }
  return order;
}

function rosterCounts(api, game, waiting) {
  const counts = game.queueCounts();
  const world = api.getWorld();
  const leaving = world.getRemovePlayerQueue();
  // A second request in the same tick must count bots still waiting for registration.
  for (const player of world.getAddPlayerQueue()) {
    const team = game.getTeamId(player);
    if (player.getAttribute(game.BOT_KEY) === true && Object.hasOwn(counts, team) && !waiting.has(player) && !leaving.includes(player)) counts[team]++;
  }
  return counts;
}

function deployRoster(api, game, options, request) {
  const fail = (error, status = 409) => { request.result = { ok: false, status, error }; };
  if (!game.waitingAreas || game.practice === true || ![game.PHASE.IDLE, game.PHASE.STARTING].includes(game.getPhase())) return fail("Wait for the current Castle Wars match to end.");
  const waiting = new Set(Object.values(game.waitingAreas).flatMap(area => area.getPlayers()));
  const leaving = api.getWorld().getRemovePlayerQueue();
  if (![...waiting].some(player => !player.isPlayerBot() && !leaving.includes(player))) return fail("Join a Castle Wars team portal before deploying the roster.");
  const order = planRosterOrder(rosterCounts(api, game, waiting), request.teams, options.chooseTeam);
  if (!order) return fail("That roster would exceed normal team balance. Add bots to the smaller team or reduce the larger team count.");
  const prepared = request.prepare(game.data.LOBBY_TELEPORT);
  if (!prepared.ok) { request.result = prepared; return; }
  const rows = request.rows ?? Object.entries(request.teams).map(([team, row]) => ({ team, ...row }));
  const remaining = new Map(rows.map(row => [row, row.count]));
  const created = [];
  const spawned = Object.fromEntries(Object.values(game.data.TEAM).map(team => [team, []]));
  try {
    for (const team of order) {
      const row = rows.find(row => row.team === team && remaining.get(row) > 0);
      remaining.set(row, remaining.get(row) - 1);
      const builtin = !!nativeRoutineId("castle-wars", row.routine);
      const { bot, start } = builtin ? { bot: options.createBuiltin(spawned[team].length) } : prepared.spawn(row);
      if (!bot) throw new Error(`${team}: spawn capacity or name allocation failed`);
      created.push(bot);
      if (builtin) prepared.track(bot);
      else {
        const refusal = options.loadoutRefusal(bot);
        if (refusal) throw new Error(`${team}: ${refusal}`);
        bot.setAttribute(game.BOT_KEY, true);
        routines.set(bot, { start });
      }
      options.admit(bot, team);
      spawned[team].push(bot.getUsername());
    }
  } catch (error) {
    for (const bot of created) bot.requestLogout();
    return fail(`Roster could not be deployed: ${String(error.message ?? error).slice(0, 180)}`);
  }
  request.result = { ok: true, spawned };
}

function startRosterRoutine(game, { player }) {
  const routine = routines.get(player);
  if (!routine || routine.started) return;
  const team = game.getTeamId(player);
  if (!team) return;
  routine.started = true;
  if (!routine.start(game.getTeamData(team).startRoom)) player.requestLogout();
}

function hasRosterRoutine(player) { return routines.has(player); }

function attachRoster(api, game, options) {
  game.hasRosterRoutine = hasRosterRoutine;
  api.onCustomEvent?.("bots:deploy-castle-wars-roster", deployRoster.bind(null, api, game, options));
  api.onCustomEvent?.("castlewars:started-player", startRosterRoutine.bind(null, game));
}

module.exports = { attachRoster, planRosterOrder };
