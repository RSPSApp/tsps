"use strict";

/**
 * Bale of flax (a Vale offerings loot), unpacked into flax.
 *
 * RSProx capture 20261109T224258-5ab63b4 (rev 242), ticks 848-914: Unpack takes one bale from
 * the stack and fills 25 empty slots with unnoted flax, with "You unpack a bale of flax." and no
 * sound or animation. With fewer than 25 empty slots: "You need at least 25 empty spaces to
 * unpack the flax.".
 */
const Shared = require("./Shared.ValeTotems");

const FLAX_PER_BALE = 25;
const MESSAGE = {
  UNPACKED: "You unpack a bale of flax.",
  NO_SPACE: `You need at least ${FLAX_PER_BALE} empty spaces to unpack the flax.`,
};

function unpack({ player, itemId }) {
  const inventory = player.getInventory();
  if (!inventory.contains(itemId)) return true;
  if (inventory.getFreeSlots() < FLAX_PER_BALE) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return true;
  }
  inventory.delete(itemId, 1);
  inventory.adds(Shared.obj("flax"), FLAX_PER_BALE);
  inventory.refreshItems();
  player.sendMessage(MESSAGE.UNPACKED);
  return true;
}

function attach(api) {
  api.onItemAction("Bale of flax", { Unpack: unpack });
}

module.exports = { attach, FLAX_PER_BALE };
