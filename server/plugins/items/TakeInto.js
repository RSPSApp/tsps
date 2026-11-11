"use strict";

/**
 * Taking a whole ground stack straight into something other than the inventory (a rune pouch,
 * the worn ammo slot, Dizana's quiver), with the same checks as an ordinary pickup: the
 * Ironman guard, the take policies (`ground-items:take`) and the `ground-items:taken` report.
 * All or nothing: when `room` is short of the stack, the pickup stays an ordinary one.
 */
const busyItems = new WeakSet();
const busyPlayers = new WeakSet();

/**
 * Called from an `onGroundItemPickup` hook. `room()` is how many of the item the target can
 * take now; `store(amount)` puts them there and returns how many went in. Returns true when
 * the stack went in. Returns false when it did not: the event is then left alone for the
 * ordinary pickup, unless a guard or policy refused the take, which handles it.
 */
function takeInto(api, event, { room, store }) {
  const { player, groundItem } = event;
  const item = groundItem?.getItem?.();
  if (!item || item.getMeta() != null) return false;
  const amount = item.getAmount();
  if (!Number.isSafeInteger(amount) || amount <= 0 || room() < amount) return false;
  if (busyItems.has(groundItem) || busyPlayers.has(player)) {
    event.handled = true;
    return false;
  }
  const core = api.core;
  const itemId = item.getId(), position = groundItem.getPosition().clone(), owner = groundItem.getOwner();
  const area = groundItem.getPrivateArea(), state = groundItem.getState();
  busyItems.add(groundItem);
  busyPlayers.add(player);
  event.handled = true;
  try {
    const permission = { player, groundItem, allow: true };
    api.emitCustomEvent("ground-item:can-store", permission);
    if (!permission.allow) return false;
    const request = { player, groundItem, source: "pickup", itemId, amount, discard: 0, allow: true, error: null };
    api.emitCustomEvent("ground-items:take", request);
    if (request.allow !== true || request.error != null || request.amount !== amount || request.discard !== 0) return false;
    if (!core.World.getItems().includes(groundItem) || !core.ItemOnGroundManager.canSee(player, groundItem)
      || groundItem.getItem() !== item || item.getId() !== itemId || item.getAmount() !== amount || item.getMeta() != null
      || !groundItem.getPosition().equals(position) || groundItem.getOwner() !== owner
      || groundItem.getPrivateArea() !== area || groundItem.getState() !== state || room() < amount) return false;
    if (store(amount) !== amount) return false;
    core.ItemOnGroundManager.deregister(groundItem);
    api.emitCustomEvent("ground-items:taken", { player, groundItem, source: "pickup", itemId, amount, discarded: 0 });
    core.Sounds.sendSound(player, core.Sound.PICK_UP_ITEM);
    player.getLastItemPickup?.().reset?.();
    return true;
  } finally {
    busyItems.delete(groundItem);
    busyPlayers.delete(player);
  }
}

module.exports = { takeInto };
