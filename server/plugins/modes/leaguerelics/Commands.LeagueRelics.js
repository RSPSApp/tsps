/**
 * Developer commands: `::relic` lists the chosen relics; `::relic <tier> <slot>` chooses one through the usual checks;
 * `::relic reset` clears every pick (Unlock.reset), so the tiers can be chosen again.
 * `::leagueunlock` (`league:dev-unlock-all`): the League Points every tier costs, through the real award path, so
 * each tier can be chosen in the interface (one relic a tier, as live).
 */
const Common = require("./Common.LeagueRelics");
const Unlock = require("./Unlock.LeagueRelics");

function relicCommand({ player, parts }) {
  const type = Common.leagueOf(player);
  if (type === null) {
    player.sendMessage(Common.message("notLeague"));
    return true;
  }
  if (String(parts[1] ?? "").toLowerCase() === "reset") {
    Unlock.reset(player);
    player.sendMessage("Your relics have been reset; every tier can be chosen again.");
    return true;
  }
  if (parts.length < 3) {
    const picks = Common.chosen(player);
    const names = Object.entries(picks).map(([tier, slot]) => `T${Number(tier) + 1} ${Common.relic(type, Number(tier), slot)?.name ?? "?"}`);
    const extra = Common.reloadedPick(player);
    if (extra) names.push(`(Reloaded) ${extra.name}`);
    player.sendMessage(Common.message("relicList", {
      league: Common.league(type).shortName, relics: names.length ? names.join(", ") : Common.message("relicNone"),
    }));
    return true;
  }
  const tier = Number(parts[1]);
  const slot = Number(parts[2]);
  if (!Number.isInteger(tier) || tier < 1 || tier > 8 || !Number.isInteger(slot) || slot < 1 || slot > 3) {
    player.sendMessage(Common.message("relicUsage"));
    return true;
  }
  Unlock.unlock(player, tier - 1, slot);
  return true;
}

function unlockAllTiers(request) {
  const { player } = request;
  const type = Common.leagueOf(player);
  const tiers = type === null ? [] : Common.catalog(type)?.tiers ?? [];
  if (!tiers.length) return;
  const needed = Math.max(...tiers.map((tier) => tier.cost | 0)) - Common.points(player);
  if (needed > 0) {
    const award = { player, id: `dev-unlock-all-${Date.now()}`, points: needed, name: "Developer unlock", awarded: false };
    Common.api.emitCustomEvent("league:award-task", award);
    if (!award.awarded) return;
  }
  request.done.push(`every relic tier (${Common.points(player)} League Points)`);
}

module.exports = function attach(api) {
  api.onCustomEvent("league:dev-unlock-all", unlockAllTiers);
  api.registerCommand("relic", relicCommand, api.core.PlayerRights.DEVELOPER, "List your relics, choose one, or reset them: ::relic [tier 1-8] [slot 1-3] | ::relic reset");
};
