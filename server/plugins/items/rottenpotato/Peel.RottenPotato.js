"use strict";

/**
 * Rotten potato > Peel (Wiki: Rotten potato): Bank menu, AMEs for all!, Teleport to RARE! and Spawn RARE!.
 *
 *   Bank menu          the Wiki names it only; it opens the bank.
 *   AMEs for all!      "Subjects all nearby players to the chosen anti-macro event": every player in view.
 *   Teleport to RARE!  "teleports the user to a dropped rare item on the server": onto its tile, or
 *                      beside it when it lies on a table.
 *   Spawn RARE!        "manually spawn a rare item near the user", seen by everyone, on floor or a table
 *                      they can reach (Rares.RottenPotato.js). The Peel menu opens again after it, so
 *                      several rares are a click each.
 */
const Common = require("./Common.RottenPotato");
const Slice = require("./Slice.RottenPotato");
const Rares = require("./Rares.RottenPotato");

const TITLE = "Peel";
const AMES_TITLE = "AMEs for all!";

function peel({ player }) {
  if (!Common.permitted(player)) return;
  peelMenu(player);
}

function peelMenu(player) {
  Common.menu(player, TITLE, [
    ["Bank menu", openBank],
    ["AMEs for all!", chooseForAll],
    ["Teleport to RARE!", teleportToRare],
    ["Spawn RARE!", spawnRare],
  ]);
}

function openBank(player) {
  player.getBank(player.getCurrentBankTab()).open();
}

function chooseForAll(player) {
  Common.chooseRandomEvent(player, AMES_TITLE, startForAll);
}

/** The chosen event on every player who can see the potato's user, the user included; none for others in a duel. */
function startForAll(player, index, name) {
  const { World } = Common.getCore();
  const origin = player.getLocation();
  const area = player.getPrivateArea?.();
  let started = 0;
  let nearby = 0;
  World.forEachNetworkPlayer((other) => {
    if (other.getPrivateArea?.() !== area || !origin.isViewableFrom(other.getLocation())) return;
    nearby++;
    if (Common.startRandomEvent(other, index, other === player) === "started") started++;
  });
  if (!nearby) {
    player.sendMessage(Slice.RESULT_MESSAGES.unavailable(name));
    return;
  }
  player.sendMessage(`${name} has been summoned for ${started} of ${nearby} nearby player${nearby === 1 ? "" : "s"}.`);
}

function teleportToRare(player) {
  const rare = Rares.groundRare();
  if (!rare) {
    player.sendMessage("There are no rares on the ground.");
    return;
  }
  player.moveTo(Rares.standingTile(rare));
}

function spawnRare(player) {
  Rares.spawnRare(player);
  peelMenu(player);
}

module.exports = function attach(api) {
  api.onItemAction(Common.POTATO_NAME, { Peel: peel });
};
