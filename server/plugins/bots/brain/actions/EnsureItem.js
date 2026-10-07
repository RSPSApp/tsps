"use strict";

/**
 * Ensures the inventory holds an item, for activities whose inputs would come
 * from a bank withdrawal in a real economy (tinderbox, test ores/logs). Skilling
 * bots are conjured the same way equipTool provides their tool.
 */
function createEnsureItemAction(spec) {
  const itemId = spec.item;
  const amount = Math.max(1, Math.floor(Number(spec.amount ?? 1)));
  return {
    id: "ensureItem",
    update(ctx) {
      const inventory = ctx.player?.getInventory?.();
      if (!inventory || !Number.isInteger(itemId)) {
        return "failed";
      }
      const missing = amount - inventory.getAmount(itemId);
      if (missing <= 0) {
        return "success";
      }
      inventory.adds(itemId, missing);
      return inventory.getAmount(itemId) >= amount ? "success" : "failed";
    },
  };
}

module.exports = {
  createEnsureItemAction,
};
