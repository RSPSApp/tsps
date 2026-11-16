"use strict";

/**
 * The Catacombs altar's ancient-shard teleports.
 *
 * The menu title and its four option labels are recorded (rsprox 3329: "Where do you want to go?
 * (1 shard)" and "Demons' Run|Dragons' Den|Reeking Cove|The Shallows"). The Wiki's Ancient shard
 * page gives the four destinations' tiles. Only the refusal's opening words were captured
 * ("You need at least 1 ancient shard..."), so `noShard` below is our completion of that line.
 *
 * A shard is spent when a destination is chosen; no animation was recorded for the teleport.
 */
const Common = require("./Common.Skotizo");

/** ObjectIdentifiers.ALTAR_52: cata_altar, the altar in the centre of the Catacombs. */
const ALTAR_ID = 28900;

let api = null;
let core = null;

function choose(player, tile) {
  const { ANCIENT_SHARD } = core.ItemIdentifiers;
  const inventory = player.getInventory();
  if (!inventory.contains(ANCIENT_SHARD)) {
    player.sendMessage(Common.DATA.ancientShardTeleports.noShard);
    return;
  }
  inventory.delete(ANCIENT_SHARD, 1);
  inventory.refreshItems?.();
  const { TeleportHandler, TeleportType, Location } = core;
  TeleportHandler.teleport(player, new Location(tile[0], tile[1], tile[2] ?? 0), TeleportType.NORMAL, false);
}

/** The altar's Teleport option (name-based, then filtered to the Catacombs altar). */
function teleport(event) {
  const id = event.objectId ?? event.object?.getId?.();
  if (id !== ALTAR_ID) return false;
  const { player } = event;
  const { title, destinations } = Common.DATA.ancientShardTeleports;
  const pairs = [];
  for (const { label, tile } of destinations) pairs.push(label, () => choose(player, tile));
  pairs.push("Cancel", () => {});
  api.sendMultiChatboxPrompt(player, title, ...pairs);
  return true;
}

module.exports = function attachShardTeleports(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onObjectInteraction("Altar", { Teleport: teleport });
};
