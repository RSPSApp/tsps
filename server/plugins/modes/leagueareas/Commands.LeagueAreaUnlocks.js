/**
 * Developer command: `::areas` lists your areas, the next unlock and where you stand;
 * `::areas <id|name>` unlocks one through the usual checks; `::areas all` (and `::leagueunlock`) every one, past
 * the league's slots. (`::area` is AdminCommands' Area-class debug.)
 */
const Common = require("./Common.LeagueAreaUnlocks");
const Regions = require("./Regions.LeagueAreaUnlocks");
const Unlock = require("./Unlock.LeagueAreaUnlocks");

function areaCommand({ player, parts }) {
  const type = Common.leagueOf(player);
  if (type === null) {
    player.sendMessage(Common.message("notLeague"));
    return true;
  }
  const argument = parts.slice(1).join(" ").trim();
  if (!argument) {
    const at = player.getLocation();
    const here = Regions.areaAt(type, at.getX(), at.getY());
    const next = Common.nextSlot(type, player);
    player.sendMessage(Common.message(next ? "areaList" : "areaListFull", {
      league: Common.leagueInfo(type).shortName,
      areas: Common.unlocked(player).map((id) => Common.area(id).name).join(", "),
      next: next?.tasks,
      tasks: Common.tasks(player),
      here: here === null ? Common.message("openArea") : Common.area(here).name,
    }));
    return true;
  }
  if (argument.toLowerCase() === "all") {
    const added = Unlock.unlockAll(player);
    player.sendMessage(added.length ? `Unlocked: ${added.join(", ")}.` : "Every area is unlocked already.");
    return true;
  }
  const area = /^\d+$/.test(argument) ? Common.area(Number(argument)) : Common.areaByName(argument);
  if (!area) {
    player.sendMessage(Common.message("noArea", { name: argument }));
    return true;
  }
  Unlock.unlock(player, area.id);
  return true;
}

function unlockAllAreas(request) {
  const added = Unlock.unlockAll(request.player);
  if (added.length) request.done.push(`areas ${added.join(", ")}`);
}

module.exports = function attach(api) {
  api.onCustomEvent("league:dev-unlock-all", unlockAllAreas);
  api.registerCommand("areas", areaCommand, api.core.PlayerRights.DEVELOPER, "List your league areas, or unlock one: ::areas [id or name|all]");
};
