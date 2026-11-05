/**
 * Developer commands. `::league [player]` shows a character's league and points.
 * `::leaguetask <id> [points] [name]` completes a catalog task by its id (LeagueTasks answers
 * `league:complete-task`), or awards an ad-hoc task with the points given, through the real award
 * path (LeaguePoints). `::leagueunlock` gives a character everything a test needs at once: the
 * points for every relic tier, every area, and pact points to the spending cap (each league unit
 * answers `league:dev-unlock-all` { player, done } with its part).
 */
const Common = require("./Common.LeagueMode");

function target(player, name) {
  if (!name) return player;
  const found = Common.core.World.getPlayerByName(name);
  if (!found) player.sendMessage(`No player called ${name} is online.`);
  return found;
}

function leagueCommand({ player, parts }) {
  const who = target(player, parts.slice(1).join(" ").trim());
  if (!who) return true;
  const type = Common.leagueOf(who);
  if (type === null) {
    player.sendMessage(Common.message("notLeague", { name: who.getDisplayName() }));
    return true;
  }
  const query = { player: who, points: 0, tasks: 0 };
  Common.api.emitCustomEvent("league:points", query);
  player.sendMessage(Common.message("status", {
    name: who.getDisplayName(), league: Common.league(type).name, points: query.points, tasks: query.tasks,
  }));
  return true;
}

function leagueTaskCommand({ player, parts }) {
  const id = String(parts[1] ?? "").trim();
  if (!id) {
    player.sendMessage(Common.message("taskUsage"));
    return true;
  }
  if (Common.leagueOf(player) === null) {
    player.sendMessage(Common.message("notLeague", { name: player.getDisplayName() }));
    return true;
  }
  const catalogTask = { player, id, found: false, completed: false };
  Common.api.emitCustomEvent("league:complete-task", catalogTask);
  if (catalogTask.found) {
    player.sendMessage(Common.message(catalogTask.completed ? "taskCompleted" : "taskRepeat", { id, name: player.getDisplayName() }));
    return true;
  }
  const points = Number(parts[2]);
  if (!Number.isInteger(points) || points < 0) {
    player.sendMessage(Common.message("taskUsage"));
    return true;
  }
  const name = parts.slice(3).join(" ").trim() || id;
  const award = { player, id, points, name, awarded: false };
  Common.api.emitCustomEvent("league:award-task", award);
  player.sendMessage(Common.message(award.awarded ? "taskAwarded" : "taskRepeat", { id, points, name: player.getDisplayName() }));
  return true;
}

/** Every relic tier's points, every area and the pact points, from the units that own them. */
function leagueUnlockCommand({ player }) {
  if (Common.leagueOf(player) === null) {
    player.sendMessage(Common.message("notLeague", { name: player.getDisplayName() }));
    return true;
  }
  const request = { player, done: [] };
  Common.api.emitCustomEvent("league:dev-unlock-all", request);
  player.sendMessage(request.done.length ? `Unlocked: ${request.done.join("; ")}.` : "Nothing to unlock.");
  return true;
}

module.exports = function attach(api) {
  const { PlayerRights } = api.core;
  api.registerCommand("league", leagueCommand, PlayerRights.DEVELOPER, "Show a character's league and League Points: ::league [player]");
  api.registerCommand("leagueunlock", leagueUnlockCommand, PlayerRights.DEVELOPER, "Unlock every relic tier, area and pact point for testing: ::leagueunlock");
  api.registerCommand("leaguetask", leagueTaskCommand, PlayerRights.DEVELOPER, "Complete a league task by id, or award an ad-hoc one: ::leaguetask <id> [points] [name]");
};
