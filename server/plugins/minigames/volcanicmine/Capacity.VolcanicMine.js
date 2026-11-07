/** Pete's purchased capacity is account state; the vessel shop row represents its upgrade. */
const Common = require("./Common.VolcanicMine");

const CAPACITY_ATTRIBUTE = "volcanic-mine:larger-vessel";
const INITIAL_THROWS_ATTRIBUTE = "volcanic-mine:initial-throws";

function isCapacityPurchase(event) {
  return event.shopId === Common.data.shop && event.itemId === Common.core.ItemIdentifiers.HEAT_PROOF_VESSEL;
}

function limitCapacityPurchase(event) {
  if (!isCapacityPurchase(event)) return;
  if (event.player.getAttribute(CAPACITY_ATTRIBUTE)) {
    event.limit = 0;
    return;
  }
  event.limit = Math.min(event.limit, 1);
}

function captureCapacityDelivery(event) {
  if (isCapacityPurchase(event)) event.captureDelivery = true;
}

function purchaseCapacity(event) {
  if (!isCapacityPurchase(event) || event.player.getAttribute(CAPACITY_ATTRIBUTE)) return;
  // Leave an alternative delivery or a replaced slot alone. Only the delivered vessel unlocks it.
  if (event.deliverId !== event.itemId || event.amount !== 1 || event.deliveredSlot < 0) return;
  const inventory = event.player.getInventory();
  const item = inventory.getItems()[event.deliveredSlot];
  if (!item || item !== event.deliveredItem || item.getId() !== event.itemId || item.getAmount() !== 1) return;
  inventory.deleteAtSlot(event.deliveredSlot, 1);
  if (inventory.getItems()[event.deliveredSlot]?.getId() === event.itemId) return;
  event.player.setAttribute(CAPACITY_ATTRIBUTE, true);
  Common.api.emitCustomEvent("collection-log:obtain", {
    player: event.player, itemId: Common.core.ItemIdentifiers.LARGE_WATER_CONTAINER, amount: 1,
  });
}

function explainCapacityShop({ player, shopId }) {
  if (shopId === Common.data.shop) {
    player.sendMessage("The heat-proof vessel is a permanent 10,000-point upgrade, giving 70 throws in later games.");
  }
}

module.exports = {
  CAPACITY_ATTRIBUTE, INITIAL_THROWS_ATTRIBUTE, limitCapacityPurchase,
  captureCapacityDelivery, purchaseCapacity, explainCapacityShop,
};
