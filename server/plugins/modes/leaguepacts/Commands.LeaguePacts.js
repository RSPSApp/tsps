/**
 * Developer commands: `::pacts` shows the character's pacts, points and resets; `::pacts point`
 * grants a pact point through the real path; `::pacts buy <node>` buys a node through the usual
 * checks; `::pacts reset` resets the tree as the panel's Yes does; `::pacts max` (and `::leagueunlock`) earns
 * points up to the spending cap, to spend in the tree.
 */
const Common = require("./Common.LeaguePacts");
const Interface = require("./Interface.LeaguePacts");
const Points = require("./Points.LeaguePacts");

function status(player) {
  const owned = Common.pacts(player);
  player.sendMessage(Common.message("status", {
    spent: owned.length, earned: Common.earned(player), left: Common.spendable(player), resets: Common.resets(player),
    nodes: owned.length ? owned.map((index) => `${index} ${Common.nodes[index].varbit.replace(/^talent_/, "")}`).join(", ") : "no pacts",
  }));
}

/** Earns pact points up to the spending cap, one at a time through the real path. Returns how many. */
function maxPoints(player) {
  let granted = 0;
  while (Common.earned(player) < Common.data.spendCap) {
    Points.grantPoint(player);
    granted += 1;
  }
  return granted;
}

function unlockAllPacts(request) {
  if (!Common.isPacts(request.player)) return;
  maxPoints(request.player);
  request.done.push(`pact points to the cap (${Common.spendable(request.player)} to spend)`);
}

function pactsCommand({ player, parts }) {
  if (!Common.isPacts(player)) {
    player.sendMessage("Only a Demonic Pacts character has pacts.");
    return true;
  }
  const what = String(parts[1] ?? "").trim().toLowerCase();
  if (what === "point") Points.grantPoint(player);
  else if (what === "buy") Interface.buy(player, Number(parts[2]));
  else if (what === "reset") Interface.reset(player);
  else if (what === "max") maxPoints(player);
  status(player);
  return true;
}

module.exports = function attach(api) {
  api.onCustomEvent("league:dev-unlock-all", unlockAllPacts);
  api.registerCommand("pacts", pactsCommand, api.core.PlayerRights.DEVELOPER,
    "Your pacts, points and resets; ::pacts point, ::pacts max, ::pacts buy <node>, ::pacts reset");
};
