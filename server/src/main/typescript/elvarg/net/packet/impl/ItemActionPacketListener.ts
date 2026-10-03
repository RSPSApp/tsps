import { CacheDefinitions } from "../../../game/cache/CacheDefinitions";
import { PluginManager } from "../../../plugins/PluginManager";

const getInventoryCtor = () =>
  require("../../../game/model/container/impl/Inventory")
    .Inventory as typeof import("../../../game/model/container/impl/Inventory").Inventory;
const getEquipmentCtor = () =>
  require("../../../game/model/container/impl/Equipment")
    .Equipment as typeof import("../../../game/model/container/impl/Equipment").Equipment;
const getEquipPacketListener = () =>
  require("./EquipPacketListener")
    .EquipPacketListener as typeof import("./EquipPacketListener").EquipPacketListener;

export class ItemActionPacketListener {
  /** Cache script 7779 uses enum 4303: inventory actions 1..5 occupy widget ops 2,3,4,6,7. */
  public static resolveInventoryWidgetAction(itemId: number, widgetOp: number): { optionIndex: number; option: string } | null {
    const definition = CacheDefinitions.getItem(itemId);
    if (widgetOp === 10) return { optionIndex: 10, option: "Examine" };
    // Op 1 is the cache's shift-click/tap-to-drop override; op 5 is item targeting (Use).
    const index = widgetOp === 1 ? definition.getShiftClickIndex() : [2, 3, 4, 6, 7].indexOf(widgetOp);
    const option = definition.inventoryActions[index];
    return option ? { optionIndex: index + 1, option } : null;
  }

  public static handleAction(player: any, interfaceId: number, itemId: number, slot: number, clickType: number, option?: string): boolean {
    if (PluginManager.emitCanUseItem(player, itemId, "action", option) === false) return true;
    if (clickType === 1) return this.handleFirstAction(player, interfaceId, itemId, slot, option);
    const item = this.itemContainer(player, interfaceId)?.getItems?.()[slot];
    if (!item || item.getId() !== itemId) return false;
    return PluginManager.emitItemAction({ player, interfaceId, item, itemId, slot, clickType, option, handled: false });
  }

  private static itemContainer(player: any, interfaceId: number): any {
    if (interfaceId === getEquipmentCtor().INVENTORY_INTERFACE_ID) {
      return player?.getEquipment?.();
    }
    return player?.getInventory?.();
  }

  /**
   * Handles inventory first-click semantics once interface/id/slot are decoded.
   */
  public static handleFirstAction(
    player: any,
    interfaceId: number,
    itemId: number,
    slot: number,
    option?: string
  ): boolean {
    if (!player) {
      return false;
    }
    const container = this.itemContainer(player, interfaceId);
    if (!container || slot < 0 || slot >= container.capacity()) {
      return false;
    }
    if (container.getItems()[slot]?.getId() != itemId) {
      return false;
    }

    if (player.isTeleportingReturn() || player.getHitpoints() <= 0) {
      return false;
    }

    const currentItem = container.getItems()[slot];
    if (!currentItem || currentItem.getId() !== itemId) {
      return false;
    }

    const pluginHandled = PluginManager.emitItemAction({
      player,
      interfaceId,
      item: currentItem,
      itemId,
      slot,
      clickType: 1,
      option,
      handled: false,
    });
    if (pluginHandled) {
      return true;
    }

    // Left-click inventory action for wieldables should behave like clicking "Wield/Wear".
    const Inventory = getInventoryCtor();
    if (interfaceId === Inventory.INTERFACE_ID) {
      const item = player.getInventory().getItems()[slot];
      const equipSlot = item
        ?.getDefinition?.()
        ?.getEquipmentType?.()
        ?.getSlot?.();
      if (Number.isInteger(equipSlot) && equipSlot >= 0) {
        getEquipPacketListener().equip(player, itemId, slot, interfaceId);
        return true;
      }
    }

    // Non-equipment item actions interrupt the current modal. Equipping has its own
    // interface guard so the equipment-stats screen can remain open like OSRS.
    player.getPacketSender().sendInterfaceRemoval();

    switch (itemId) {
      case 9520:
        player.sendMessage("You cannot use this in the Wilderness!");
        break;

      case 2542:
      case 2543:
      case 2544:
        if (player.busy()) {
          player.sendMessage("You cannot do that right now.");
          return true;
        }
        if (
          (itemId == 2542 && player.getAttribute("prayer:preserve-unlocked") === true) ||
          (itemId == 2543 && player.getAttribute("prayer:rigour-unlocked") === true) ||
          (itemId == 2544 && player.getAttribute("prayer:augury-unlocked") === true)
        ) {
          player.sendMessage("You have already unlocked that prayer.");
          return true;
        }

        break;
      case 2545:
        if (player.busy()) {
          player.sendMessage("You cannot do that right now.");
          return true;
        }
        if (player.getAttribute("bounty-hunter:target-teleport-unlocked") === true) {
          player.sendMessage("You have already unlocked that teleport.");
          return true;
        }
        break;
      case 12873:
      case 12875:
      case 12879:
      case 12881:
      case 12883:
      case 12877:
    }
    return false;
  }
}
