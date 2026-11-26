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
 *
 * The Mythical max cape (24855) carries the same "Teleport", inventory option 3 and worn option
 * 451 in the cache, and the Wiki gives it the mythical cape's teleport; no capture of it exists,
 * so it shares this one.
 */

const MYTHS_GUILD = [2458, 2850, 0];
/** The Wilderness level above which a teleport is refused (the default for item teleports). */
const WILDERNESS_LEVEL = 20;

let core;

function teleport({ player }) {
  const { Location, TeleportHandler, TeleportType } = core;
  const target = new Location(...MYTHS_GUILD);
  if (!TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return true;
  TeleportHandler.confirm(player, target, () => TeleportHandler.teleport(player, target, TeleportType.NORMAL, false), WILDERNESS_LEVEL);
  return true;
}

function describeTeleports({ list }) {
  list.push({ path: ["Items", "Mythical cape"], key: "myths-guild", name: "Myths' Guild", tile: [...MYTHS_GUILD] });
}

module.exports = {
  name: "MythicalCape",
  description: "Lets the mythical cape teleport the player to the Myths' Guild from the inventory or worn, with no charges, as does the Mythical max cape.",
  members: true,
  register(api) {
    core = api.core;
    for (const name of ["Mythical cape", "Mythical max cape"]) api.onItemAction(name, { Teleport: teleport });
    api.onCustomEvent("adminpanel:teleport-destinations", describeTeleports);
  },
  _test: { teleport, MYTHS_GUILD },
};
