"use strict";

/**
 * Empties listed inventory items in one tick. Used to keep an activity loop
 * alive until a bank resolver takes over (phase 3).
 */
function createDropItemsAction(spec) {
  const itemIds = Array.isArray(spec.itemIds) ? spec.itemIds : [];
  return {
    id: "dropItems",
    update(ctx) {
      const inventory = ctx.player?.getInventory?.();
      if (!inventory) {
        return "failed";
      }
      for (const itemId of itemIds) {
        const amount = inventory.getAmount(itemId);
        if (amount > 0) {
          inventory.deleteNumber(itemId, amount);
        }
      }
      return "success";
    },
  };
}

module.exports = {
  createDropItemsAction,
};
