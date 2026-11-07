"use strict";

/**
 * Mythical cape (https://oldschool.runescape.wiki/w/Mythical_cape): "Teleport" in the inventory and
 * worn takes the player to the Myths' Guild, with no charges or limit. The cache gives item
 * 22114 inventory option 3 and worn option 451 the text "Teleport".
 *
 * Live capture (rsprox 1437, rev 224): the inventory click plays the standard teleport cast
 * (human_castteleport, teleport_casting graphic) and lands on (2458, 2850, 0) three ticks later;
 * the cape stays in the inventory and no message is sent. This is the tile the mounted cape in the
 * player-owned house uses too (Mounted.Construction.js).
 */

const MYTHS_GUILD = [2458, 2850, 0];
/** The Wilderness level above which a teleport is refused (the default for item teleports). */
const WILDERNESS_LEVEL = 20;

let core;

function teleport({ player }) {
  const { Location, TeleportHandler, TeleportType } = core;
  const target = new Location(...MYTHS_GUILD);
  if (!TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return true;
  TeleportHandler.teleport(player, target, TeleportType.NORMAL, false);
  return true;
}

module.exports = {
  name: "MythicalCape",
  members: true,
  register(api) {
    core = api.core;
    api.onItemAction("Mythical cape", { Teleport: teleport });
  },
  _test: { teleport, MYTHS_GUILD },
};
