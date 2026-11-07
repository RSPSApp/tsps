import { ItemOnGroundManager } from "../../../game/entity/impl/grounditem/ItemOnGroundManager";
import { Location } from "../../../game/model/Location";

export class PickupItemPacketListener {
  public static pickup(player: any, itemId: number, x: number, y: number, stackId?: number): void {
    const requestedPosition = new Location(x, y, player.getLocation().getZ());
    const groundItem = ItemOnGroundManager.getOperableGroundItem(
      player, itemId, requestedPosition, ItemOnGroundManager.takeOperation(itemId), stackId,
    );
    if (!groundItem || groundItem.getItem().getId() !== itemId || !Location.isSameTile(groundItem.getPosition(), requestedPosition)) {
      return;
    }

    if (!ItemOnGroundManager.canOperate(player, groundItem, ItemOnGroundManager.takeOperation(itemId))) return;

    if (player.busy() || !player.getLastItemPickup().elapsedTime(300)) {
      return;
    }

    const position = groundItem.getPosition().clone();

    player
      .getMovementQueue()
      .walkToGroundItem(position, () => ItemOnGroundManager.pickup(player, groundItem));
  }

}
