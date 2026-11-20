"use strict";

const { nativeRoutineId } = require("../../bots/runtime/RoutineCatalog.PlayerBots");

const Common = require("./Common.SoulWars");
const Match = require("./Match.SoulWars");
const Lobby = require("./Lobby.SoulWars");
const assignments = new WeakMap();

function teamOf(player) { return assignments.get(player)?.team; }
function usesRoutine(player) { return !!assignments.get(player)?.start; }

function canBalance(counts, unassigned) {
  return Math.abs(counts.blue - counts.red) <= unassigned + 1;
}

function fit(players) {
  const groups = { blue: [], red: [] };
  for (const player of players) {
    const team = teamOf(player);
    if (team) groups[team].push(player);
  }
  const free = players.length - groups.blue.length - groups.red.length;
  const removed = new Set();
  // A human can leave during the countdown. Preserve the remaining team's choices
  // and remove excess roster bots instead of silently changing their assigned side.
  while (!canBalance({ blue: groups.blue.length, red: groups.red.length }, free)) {
    const player = (groups.blue.length > groups.red.length ? groups.blue : groups.red).pop();
    removed.add(player);
    player.requestLogout();
  }
  return players.filter(player => !removed.has(player));
}

function attachRoster(api, { spawnBuiltin, spot, markCustom }) {
  api.onCustomEvent("bots:deploy-soul-wars-roster", request => {
    const fail = error => { request.result = { ok: false, status: 409, error }; };
    if (Match.current) return fail("Wait for the current Soul Wars match to end.");
    const world = api.getWorld();
    const leaving = new Set(world.getRemovePlayerQueue());
    const queued = Lobby.waitingPlayers().filter(player => !leaving.has(player));
    if (!queued.some(player => !player.isPlayerBot())) return fail("Join the Soul Wars waiting area before deploying the roster.");
    const waiting = new Set([...queued, ...world.getAddPlayerQueue().filter(player => teamOf(player) && !leaving.has(player))]);
    const counts = { blue: request.teams.blue.count, red: request.teams.red.count };
    let unassigned = 0;
    for (const player of waiting) {
      const team = teamOf(player);
      if (team) counts[team]++;
      else unassigned++;
    }
    if (!canBalance(counts, unassigned)) return fail("That roster would make it impossible to balance the Soul Wars teams.");
    const [bx, by] = Common.data.lobby.barrier;
    const prepared = request.prepare(new Common.core.Location(bx - 1, by, 0));
    if (!prepared.ok) { request.result = prepared; return; }
    const created = [];
    const spawned = { blue: [], red: [] };
    try {
      for (const row of request.rows) {
        const { team, count, routine } = row;
        for (let i = 0; i < count; i++) {
          const at = spot();
          const builtin = !!nativeRoutineId("soul-wars", routine);
          const { bot, start } = builtin ? { bot: spawnBuiltin(at) } : prepared.spawn(row, at);
          if (!bot) throw new Error(`${team}: spawn capacity or name allocation failed`);
          created.push(bot);
          if (builtin) prepared.track(bot);
          else {
            markCustom(bot);
            const refusal = Lobby.restrictedItems(bot);
            if (refusal) throw new Error(`${team}: ${refusal}`);
          }
          assignments.set(bot, { team, start });
          spawned[team].push(bot.getUsername());
        }
      }
    } catch (error) {
      for (const player of created) player.requestLogout();
      return fail(`Roster could not be deployed: ${String(error.message ?? error).slice(0, 180)}`);
    }
    request.result = { ok: true, spawned };
  });
  Lobby.bots.fit = fit;
  Lobby.bots.team = teamOf;
  Lobby.bots.filterWaiting = players => {
    if (!players.some(player => teamOf(player))) return players;
    const leaving = new Set(api.getWorld().getRemovePlayerQueue());
    const hasHuman = players.some(player => !player.isPlayerBot() && !leaving.has(player));
    return players.filter(player => {
      if (!teamOf(player)) return true;
      if (leaving.has(player)) return false;
      if (hasHuman) return true;
      player.requestLogout();
      return false;
    });
  };
  Match.onStart(game => {
    for (const player of game.players()) {
      const start = assignments.get(player)?.start;
      if (start && !start(player.getLocation().clone())) player.requestLogout();
    }
  });
  Match.onEnd(game => {
    for (const player of game.players()) if (teamOf(player)) player.requestLogout();
  });
}

module.exports = { attachRoster, teamOf, usesRoutine, canBalance, fit };
