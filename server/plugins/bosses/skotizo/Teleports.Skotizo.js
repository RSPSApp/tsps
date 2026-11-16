"use strict";

/**
 * The Catacombs altar's ancient-shard teleports.
 *
 * The menu title and its four option labels are recorded (rsprox 3329: "Where do you want to go?
 * (1 shard)" and "Demons' Run|Dragons' Den|Reeking Cove|The Shallows"); it has four lines and closes
 * when the player walks away. The Wiki's Ancient shard page gives the four destinations' tiles. The
 * refusal is recorded in full (rsprox 3314, 227/910489) and is sent on the altar click, before any
 * menu opens: "You need at least 1 ancient shard to use the altar's teleportation powers."
 *
 * A shard is spent when a destination is chosen; no animation was recorded for the teleport.
 */
const Common = require("./Common.Skotizo");

/** ObjectIdentifiers.ALTAR_52: cata_altar, the altar in the centre of the Catacombs. */
const ALTAR_ID = 28900;
/** A teleport the player chooses: the same limit as the other item teleports. */
const WILDERNESS_LEVEL = 20;

let api = null;
let core = null;

function choose(player, tile) {
  const { ANCIENT_SHARD } = core.ItemIdentifiers;
  const inventory = player.getInventory();
  if (!inventory.contains(ANCIENT_SHARD)) {
    player.sendMessage(Common.DATA.ancientShardTeleports.noShard);
    return;
  }
  const { TeleportHandler, TeleportType, Location } = core;
  const target = new Location(tile[0], tile[1], tile[2] ?? 0);
  if (!TeleportHandler.checkReqs(player, target, WILDERNESS_LEVEL)) return;
  TeleportHandler.confirm(player, target, () => {
    // The shard can go while the prompt asks (or the menu stays open): never spend nothing.
    if (!inventory.contains(ANCIENT_SHARD)) {
      player.sendMessage(Common.DATA.ancientShardTeleports.noShard);
      return;
    }
    inventory.delete(ANCIENT_SHARD, 1);
    inventory.refreshItems?.();
    TeleportHandler.teleport(player, target, TeleportType.NORMAL, false);
  }, WILDERNESS_LEVEL, { item: ANCIENT_SHARD });
}

/** The altar's Teleport option (name-based, then filtered to the Catacombs altar). */
function teleport(event) {
  const id = event.objectId ?? event.object?.getId?.();
  if (id !== ALTAR_ID) return false;
  const { player } = event;
  const { ANCIENT_SHARD } = core.ItemIdentifiers;
  // Recorded: with no shard the click is refused at once and no menu opens.
  if (!player.getInventory().contains(ANCIENT_SHARD)) {
    player.sendMessage(Common.DATA.ancientShardTeleports.noShard);
    return true;
  }
  const { title, destinations } = Common.DATA.ancientShardTeleports;
  const pairs = [];
  for (const { label, tile } of destinations) pairs.push(label, () => choose(player, tile));
  api.sendMultiChatboxPrompt(player, title, ...pairs);
  return true;
}

module.exports = function attachShardTeleports(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  pluginApi.onObjectInteraction("Altar", { Teleport: teleport });
};
