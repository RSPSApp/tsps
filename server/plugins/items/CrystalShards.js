"use strict";

/**
 * Crystal shards used on charged crystal equipment (https://oldschool.runescape.wiki/w/Crystal_shard):
 * each adds 100 charges, up to 20,000. Shared by the crystal armour and the crystal weapons.
 *
 * The game asks how many to add. The prompt's maximum is the shards that reach 20,000, rounded up,
 * so the last shard's charges past 20,000 are lost. The shards go, with no chat message.
 */

const MAX_CHARGES = 20000;
const CHARGES_PER_SHARD = 100;
const SHARD_NAME = "Crystal shard";

/** Shards that take `charges` to the cap: the last one may overshoot. */
function shardRoom(charges) {
  return Math.max(0, Math.ceil((MAX_CHARGES - charges) / CHARGES_PER_SHARD));
}

/** The charges after adding `shards` to `charges`, capped. */
function chargesWith(charges, shards) {
  return Math.min(MAX_CHARGES, charges + shards * CHARGES_PER_SHARD);
}

/**
 * Asks how many shards to add to `item`, then calls `add(count)` with the count the player can pay
 * for and the item still has room for (at least 1), once the item is still in the inventory.
 * `chargesOf`: reads the item's charges; `shardId`: the shard stack's id.
 */
function promptShards(player, item, chargesOf, shardId, add) {
  const inventory = player.getInventory();
  player.setEnteredAmountAction({
    execute: (amount) => {
      const wanted = Math.floor(Number(amount) || 0);
      const count = Math.min(wanted, shardRoom(chargesOf(item)), inventory.getAmount(shardId));
      if (count < 1 || !inventory.getItems().includes(item)) return;
      inventory.deleteNumber(shardId, count);
      add(count);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`How many shards do you wish to add? (0 - ${shardRoom(chargesOf(item))})`);
}

module.exports = { MAX_CHARGES, CHARGES_PER_SHARD, SHARD_NAME, shardRoom, chargesWith, promptShards };
