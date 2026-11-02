/**
 * Developer commands: `::pacts` shows the character's pacts, points and resets; `::pacts point`
 * grants a pact point through the real path; `::pacts buy <node>` buys a node through the usual
 * checks; `::pacts reset` resets the tree as the panel's Yes does.
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

function pactsCommand({ player, parts }) {
  if (!Common.isPacts(player)) {
    player.sendMessage("Only a Demonic Pacts character has pacts.");
    return true;
  }
  const what = String(parts[1] ?? "").trim().toLowerCase();
  if (what === "point") Points.grantPoint(player);
  else if (what === "buy") Interface.buy(player, Number(parts[2]));
  else if (what === "reset") Interface.reset(player);
  status(player);
  return true;
}

module.exports = function attach(api) {
  api.registerCommand("pacts", pactsCommand, api.core.PlayerRights.DEVELOPER,
    "Your pacts, points and resets; ::pacts point, ::pacts buy <node>, ::pacts reset");
};
