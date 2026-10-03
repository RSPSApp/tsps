import { ItemOnGroundManager } from "../../../game/entity/impl/grounditem/ItemOnGroundManager";
import { Location } from "../../../game/model/Location";
import { PluginManager } from "../../../plugins/PluginManager";

export class SecondGroundItemOptionPacketListener {
  public static interact(player: any, itemId: number, x: number, y: number, clickType: number): void {
    if (!player || player.getHitpoints() <= 0) {
      return;
    }
    const position = new Location(x, y, player.getLocation().getZ());

    player.getSkillManager().stopSkillable();

    if (!player.getLastItemPickup().elapsedTime(300)) return;
    if (player.busy()) return;

    if (
      Math.abs(player.getLocation().getX() - x) > 25 ||
      Math.abs(player.getLocation().getY() - y) > 25
    ) {
      player.getMovementQueue().reset();
      return;
    }

    player.getMovementQueue().walkToGroundItem(position, () => {
      const groundItem = ItemOnGroundManager.getGroundItem(
        player.getUsername(),
        itemId,
        position,
        player.getPrivateArea(),
      );
      if (!groundItem) {
        return;
      }

      player.setPositionToFace(position);

      const handled = PluginManager.emitGroundItemInteraction({
        player,
        groundItem,
        groundItemId: itemId,
        clickType,
        location: {
          x: position.getX(),
          y: position.getY(),
          z: position.getZ(),
        },
        handled: false,
      });

      if (!handled) {
        player.sendMessage("Nothing interesting happens.");
      }
    });
  }
}
