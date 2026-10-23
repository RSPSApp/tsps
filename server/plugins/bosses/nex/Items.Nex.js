/**
 * Nex's items (Wiki):
 * - "Ecumenical key shard": 50 "Combine" into an ecumenical key; a player may hold three keys.
 * - "Zaryte crossbow": an Armadyl crossbow with the nihil horn and 250 nihil shards, no skill, 6
 *   ticks; the prompt and messages are ours (no capture).
 * - "Nihil shard": a pestle and mortar grinds one into nihil dust.
 */
const Common = require("./Common.Nex");

const SHARDS_PER_KEY = 50;
const KEY_LIMIT = 3;
const CROSSBOW_SHARDS = 250;
const CROSSBOW_TICKS = 6;
const GRIND_ANIM = 364;

function keysHeld(player) {
  const id = Common.core.ItemIdentifiers.ECUMENICAL_KEY;
  let count = player.getInventory().getAmount(id);
  for (const tab of player.getBanks?.() ?? []) count += tab?.getAmount?.(id) ?? 0;
  return count;
}

function combineShards({ player }) {
  const { ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  if (inventory.getAmount(ItemIdentifiers.ECUMENICAL_KEY_SHARD) < SHARDS_PER_KEY) {
    Common.statement(player, `You need at least ${SHARDS_PER_KEY} ecumenical key shards to create a key.`);
    return true;
  }
  if (keysHeld(player) >= KEY_LIMIT) {
    Common.statement(player, `You can't hold more than ${KEY_LIMIT} ecumenical keys at a time.`);
    return true;
  }
  if (inventory.getFreeSlots() <= 0 && inventory.getAmount(ItemIdentifiers.ECUMENICAL_KEY_SHARD) > SHARDS_PER_KEY) {
    player.sendMessage("Please free up at least one inventory space to do this.");
    return true;
  }
  inventory.delete(ItemIdentifiers.ECUMENICAL_KEY_SHARD, SHARDS_PER_KEY);
  inventory.adds(ItemIdentifiers.ECUMENICAL_KEY, 1);
  player.sendMessage("You combine 50 shards to create a key.");
  return true;
}

/** The nihil horn on an Armadyl crossbow (either way round), with 250 nihil shards. */
function attachHorn({ player }) {
  const { ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  if (inventory.getAmount(ItemIdentifiers.NIHIL_SHARD) < CROSSBOW_SHARDS) {
    Common.statement(player, `You need ${CROSSBOW_SHARDS} nihil shards to attach the horn to the crossbow.`);
    return true;
  }
  Common.api.sendMultiChatboxPrompt(player, "Create a Zaryte crossbow? This cannot be undone.",
    "Yes.", () => {
      player.getPacketSender().sendInterfaceRemoval();
      Common.later(CROSSBOW_TICKS, () => {
        if (!player.isRegistered()) return;
        const has = inventory.contains(ItemIdentifiers.NIHIL_HORN) && inventory.contains(ItemIdentifiers.ARMADYL_CROSSBOW)
          && inventory.getAmount(ItemIdentifiers.NIHIL_SHARD) >= CROSSBOW_SHARDS;
        if (!has) return;
        inventory.delete(ItemIdentifiers.NIHIL_HORN, 1);
        inventory.delete(ItemIdentifiers.ARMADYL_CROSSBOW, 1);
        inventory.delete(ItemIdentifiers.NIHIL_SHARD, CROSSBOW_SHARDS);
        inventory.adds(ItemIdentifiers.ZARYTE_CROSSBOW, 1);
        player.sendMessage("You attach the nihil horn to the crossbow, binding it with the shards' power.");
      });
    },
    "No.", () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function grindShard({ player }) {
  const { ItemIdentifiers } = Common.core;
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIdentifiers.NIHIL_SHARD)) return true;
  inventory.delete(ItemIdentifiers.NIHIL_SHARD, 1);
  inventory.adds(ItemIdentifiers.NIHIL_DUST, 1);
  player.performAnimation(Common.animation(GRIND_ANIM));
  player.sendMessage("You grind the nihil shard into dust.");
  return true;
}

function attachItems(api) {
  api.onItemAction("Ecumenical key shard", { Combine: combineShards });
  api.onItemOnItem("Nihil horn", "Armadyl crossbow", attachHorn);
  api.onItemOnItem("Pestle and mortar", "Nihil shard", grindShard);
}

module.exports = { attachItems, combineShards, attachHorn, grindShard, KEY_LIMIT };
