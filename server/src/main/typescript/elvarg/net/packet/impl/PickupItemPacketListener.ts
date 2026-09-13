import { ItemDefinition } from "../../../game/definition/ItemDefinition";
import { ItemOnGroundManager, OperationType } from "../../../game/entity/impl/grounditem/ItemOnGroundManager";
import { Location } from "../../../game/model/Location";
import { Sounds } from "../../../game/Sounds";
import { Sound } from "../../../game/Sound";
import { PluginManager } from "../../../plugins/PluginManager";

export class PickupItemPacketListener {
  public static pickup(player: any, itemId: number, x: number, y: number): void {
    const position = new Location(x, y, player.getLocation().getZ());

    const item = ItemOnGroundManager.getGroundItem(player.getUsername(), itemId, position);
    if (!item) {
      return;
    }

    if (player.busy() || !player.getLastItemPickup().elapsedTime(300)) {
      return;
    }

    player
      .getMovementQueue()
      .walkToGroundItem(position, () => this.takeItem(player, itemId, position));
  }

  private static takeItem(player: any, itemId: number, position: Location) {
    const x = position.getX();
    const y = position.getY();

    if (
      Math.abs(player.getLocation().getX() - x) > 25 ||
      Math.abs(player.getLocation().getY() - y) > 25
    ) {
      player.getMovementQueue().reset();
      return;
    }

    const groundItem = ItemOnGroundManager.getGroundItem(
      player.getUsername(),
      itemId,
      position
    );
    if (!groundItem) {
      return;
    }

    const pickupEvent = {
      player,
      groundItem,
      itemId,
      location: position,
      handled: false,
    };
    if (PluginManager.emitItemPickup(pickupEvent)) {
      return;
    }

    const inventory = player.getInventory();
    if (
      !(
        inventory.getFreeSlots() > 0 ||
        (inventory.getFreeSlots() === 0 &&
          ItemDefinition.forId(itemId).isStackable() &&
          inventory.contains(itemId))
      )
    ) {
      inventory.full();
      return;
    }

    const inventoryAmount = inventory.getAmount(groundItem.getItem().getId());
    const groundAmount = groundItem.getItem().getAmount();
    let pickedUpItem = groundItem.getItem();
    let deregister = true;

    if (
      inventoryAmount + groundAmount > Number.MAX_SAFE_INTEGER ||
      inventoryAmount + groundAmount <= 0
    ) {
      const playerCanHold = Number.MAX_SAFE_INTEGER - inventoryAmount;
      if (playerCanHold <= 0) {
        player
          .getPacketSender()
          .sendMessage("You cannot hold more of that item.");
        return;
      }

      const currentAmount = groundItem.getItem().getAmount();
      groundItem.setOldAmount(currentAmount);
      groundItem.getItem().decrementAmountBy(playerCanHold);
      ItemOnGroundManager.perform(groundItem, OperationType.ALTER);
      pickedUpItem = groundItem.getItem().clone().setAmount(playerCanHold);
      deregister = false;
    }

    if (deregister) {
      ItemOnGroundManager.deregister(groundItem);
    }

    inventory.addItem(pickedUpItem);
    Sounds.sendSound(player, Sound.PICK_UP_ITEM);
    player.getLastItemPickup().reset();
  }
}
