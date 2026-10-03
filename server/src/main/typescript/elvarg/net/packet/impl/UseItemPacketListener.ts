import { MapObjects } from "../../../game/entity/impl/object/MapObjects";
import { World } from "../../../game/World";
import { Location } from "../../../game/model/Location";
import { PluginManager } from "../../../plugins/PluginManager";

export class UseItemPacketListener {
  /** Plugins can veto any item-on-X use (e.g. members items on a free-to-play world). */
  private static canUse(player: any, ...itemIds: number[]): boolean {
    return itemIds.every((itemId) => PluginManager.emitCanUseItem(player, itemId, "use") !== false);
  }

  public static itemOnItem(player: any, usedItemSlot: number, usedWithSlot: number): void {
    if (
      usedWithSlot < 0 ||
      usedItemSlot < 0 ||
      usedItemSlot >= player.getInventory().capacity() ||
      usedWithSlot >= player.getInventory().capacity()
    ) {
      return;
    }

    const usedItem = player.getInventory().getItems()[usedItemSlot];
    const usedWithItem = player.getInventory().getItems()[usedWithSlot];
    if (!usedItem || !usedWithItem || !this.canUse(player, usedItem.getId(), usedWithItem.getId())) {
      return;
    }

    PluginManager.emitItemOnItem({
      player,
      usedItem,
      usedItemId: usedItem.getId(),
      usedItemSlot,
      usedWithItem,
      usedWithItemId: usedWithItem.getId(),
      usedWithItemSlot: usedWithSlot,
      handled: false,
    });
  }

  public static itemOnObject(
    player: any,
    interfaceType: number,
    objectId: number,
    itemId: number,
    itemSlot: number,
    objectX: number,
    objectY: number
  ): void {
    if (itemSlot < 0 || itemSlot >= player.getInventory().capacity()) {
      return;
    }

    const item = player.getInventory().getItems()[itemSlot];
    if (!item || item.getId() !== itemId || !this.canUse(player, itemId)) {
      return;
    }

    const object = MapObjects.getPrivateArea(player, objectId, new Location(objectX, objectY, player.getLocation().getZ()));
    if (!object) {
      return;
    }

    const useItem = () => {
      player.getMovementQueue().reset();
      player.getMovementQueue().walkToReset();
      player.setPositionToFace(object.getLocation());

      const handled = PluginManager.emitItemOnObject({
        player,
        object,
        objectId: object.getId(),
        item,
        itemId,
        itemSlot,
        interfaceType,
        location: {
          x: object.getLocation().getX(),
          y: object.getLocation().getY(),
          z: object.getLocation().getZ(),
        },
        handled: false,
      });

      if (!handled) {
        player.sendMessage("Nothing interesting happens.");
      }
    };

    // The same route hook as clicking the loc, so a plugin's approach tile holds for items too.
    const location = player.getLocation();
    const routeEvent = {
      player,
      object,
      objectId: object.getId(),
      clickType: 0,
      sourceLocation: { x: location.getX(), y: location.getY(), z: location.getZ() },
      destination: null as { x: number; y: number; z: number } | null,
    };
    PluginManager.emitObjectRoute(routeEvent);
    if (routeEvent.destination) {
      const { x, y, z } = routeEvent.destination;
      player.getMovementQueue().walkToTile(new Location(x, y, z), useItem);
      return;
    }
    player.getMovementQueue().walkToObject(object, { execute: useItem });
  }

  public static itemOnGroundItem(player: any, inventoryItemId: number, groundItemId: number, x: number, y: number, inventorySlot?: number): void {
    if (!player.getInventory().contains(inventoryItemId)) {
      return;
    }

    const inventoryItem = Number.isInteger(inventorySlot)
      ? player.getInventory().getItems()[inventorySlot!]
      : player.getInventory().getItems().find((it: any) => it && it.getId() === inventoryItemId);
    if (!inventoryItem || inventoryItem.getId() !== inventoryItemId || !this.canUse(player, inventoryItemId)) {
      return;
    }

    PluginManager.emitItemOnGroundItem({
      player,
      inventoryItem,
      inventoryItemId,
      groundItemId,
      location: { x, y, z: player.getLocation().getZ() },
      handled: false,
    });
  }

  public static itemOnPlayer(player: any, interfaceId: number, targetIndex: number, itemId: number, slot: number): void {
    if (slot < 0 || slot >= player.getInventory().capacity()) {
      return;
    }

    const target = World.getPlayers().get(targetIndex);
    if (!target) {
      return;
    }

    const item = player.getInventory().getItems()[slot];
    if (!item || item.getId() !== itemId || !this.canUse(player, itemId)) {
      return;
    }

    player.getMovementQueue().walkToEntity(target, () => {
      player.setPositionToFace(target.getLocation());
      PluginManager.emitItemOnPlayer({
        player,
        target,
        targetIndex,
        interfaceId,
        item,
        itemId,
        slot,
        handled: false,
      });
    });
  }

  public static itemOnNpc(player: any, interfaceId: number, targetIndex: number, itemId: number, slot: number): void {
    if (slot < 0 || slot >= player.getInventory().capacity()) {
      return;
    }
    const target = World.getNpcs().get(targetIndex);
    const item = player.getInventory().getItems()[slot];
    if (!target || !item || item.getId() !== itemId || !this.canUse(player, itemId)) {
      return;
    }
    player.getMovementQueue().walkToEntity(target, () => {
      player.setPositionToFace(target.getLocation());
      PluginManager.emitItemOnNpc({
        player,
        target,
        targetIndex,
        interfaceId,
        item,
        itemId,
        slot,
        handled: false,
      });
    });
  }

  public static spellOnObject(
    player: any,
    objectId: number,
    x: number,
    y: number,
    spellWidget: number,
    spellChild: number,
    spellItemId: number,
    spellId: number,
  ): void {
    const location = new Location(x, y, player.getLocation().getZ());
    const object = MapObjects.getPrivateArea(player, objectId, location);
    if (!object) {
      return;
    }
    player.getMovementQueue().walkToObject(object, {
      execute: () => {
        player.getMovementQueue().reset();
        player.getMovementQueue().walkToReset();
        player.setPositionToFace(object.getLocation());
        PluginManager.emitSpellOnObject({
          player,
          object,
          objectId,
          spellWidget,
          spellChild,
          spellItemId,
          spellId,
          location: {
            x: object.getLocation().getX(),
            y: object.getLocation().getY(),
            z: object.getLocation().getZ(),
          },
          handled: false,
        });
      },
    });
  }

}
