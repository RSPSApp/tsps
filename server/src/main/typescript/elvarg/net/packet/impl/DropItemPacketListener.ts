import { Item } from "../../../game/model/Item";
import { Sound } from "../../../game/Sound";
import { Inventory } from "../../../game/model/container/impl/Inventory";
import { ItemOnGroundManager } from "../../../game/entity/impl/grounditem/ItemOnGroundManager";
import { Sounds } from "../../../game/Sounds";
import { PlayerRights } from "../../../game/model/rights/PlayerRights";
import { Wilderness } from "../../../game/content/wilderness/Wilderness";
import { PluginManager } from "../../../plugins/PluginManager";
import { PluginItemDropEvent } from "../../../plugins/PluginTypes";

const DESTROY_ITEM_INTERFACE_ID = 584;
const DESTROY_ITEM_NAME_COMPONENT =
  (DESTROY_ITEM_INTERFACE_ID << 16) | 6;
const DESTROY_ITEM_YES_COMPONENT =
  (DESTROY_ITEM_INTERFACE_ID << 16) | 1;
const DESTROY_ITEM_NO_COMPONENT =
  (DESTROY_ITEM_INTERFACE_ID << 16) | 3;
const FIRST_OPTION_FLAG = 1 << 1;

export class DropItemPacketListener {
  public static readonly DESTROY_ITEM_ATTRIBUTE = "destroy-item:pending";

  public static destroyItemInterface(player: any, item: any) {
    player.setAttribute(DropItemPacketListener.DESTROY_ITEM_ATTRIBUTE, item.getId());
    player.getPacketSender()
      .sendChatboxInterface(DESTROY_ITEM_INTERFACE_ID)
      .sendString(item.getDefinition().getName(), DESTROY_ITEM_NAME_COMPONENT)
      .sendInterfaceFlags(DESTROY_ITEM_YES_COMPONENT, FIRST_OPTION_FLAG)
      .sendInterfaceFlags(DESTROY_ITEM_NO_COMPONENT, FIRST_OPTION_FLAG);
  }

  /**
   * `confirmed`: the player already answered the drop warning for this item. Before an item lands
   * on the floor, "item:drop-warning" { player, item, itemId, slot, warned, proceed } lets a plugin
   * ask first: it sets `warned` and calls `proceed()` on the player's yes.
   */
  public static drop(player: any, id: number, interfaceId: number, itemSlot: number, confirmed = false): void {
    if (player == null || player.getHitpoints() <= 0) {
      return;
    }

    if (interfaceId != Inventory.INTERFACE_ID) {
      return;
    }

    if (player.getHitpoints() <= 0) return;

    if (itemSlot < 0 || itemSlot >= player.getInventory().capacity()) return;

    if (player.busy()) {
      player.getPacketSender().sendInterfaceRemoval();
    }

    let item = player.getInventory().getItems()[itemSlot];
    if (item == null) return;
    if (item.getId() != id || item.getAmount() <= 0) {
      return;
    }

    if (player.getRights() == PlayerRights.DEVELOPER) {
      player.sendMessage("Drop item: " + item.getId().toString() + ".");
    }

    player.getPacketSender().sendInterfaceRemoval();

    // Stop skilling..
    player.getSkillManager().stopSkillable();

    const dropEvent: PluginItemDropEvent = {
      player,
      interfaceId,
      item,
      itemId: id,
      slot: itemSlot,
      dropToGround: true,
      handled: false,
    };
    const discardedItem = item.clone();
    const pluginHandled = PluginManager.emitItemDropPolicy(dropEvent);
    if (pluginHandled) {
      const remaining = player.getInventory().getItems()[itemSlot];
      if (remaining?.getId() !== id || remaining?.getAmount() < discardedItem.getAmount()) {
        PluginManager.emitCustomEvent("item:discarded", { player, item: discardedItem });
        Sounds.sendSound(player, Sound.DROP_ITEM);
      }
      return;
    }

    if (item.isDropable()) {
      if (!confirmed && dropEvent.dropToGround !== false) {
        const warning = { player, item, itemId: id, slot: itemSlot, warned: false,
          proceed: () => {
            if (player.getInventory().getItems()[itemSlot] === item) DropItemPacketListener.drop(player, id, interfaceId, itemSlot, true);
          } };
        PluginManager.emitCustomEvent("item:drop-warning", warning);
        if (warning.warned) return;
      }
      if (dropEvent.dropToGround !== false) {
        const toFloor = item.clone();
        if (Wilderness.isIn(player)) {
          ItemOnGroundManager.registerGlobal(player, toFloor);
        } else {
          ItemOnGroundManager.registers(player, toFloor);
        }
      }

      player.getInventory().setItem(itemSlot, new Item(-1, 0)).refreshItems();
      PluginManager.emitCustomEvent("item:discarded", { player, item });
      Sounds.sendSound(player, Sound.DROP_ITEM);
    } else {
      DropItemPacketListener.destroyItemInterface(player, item);
    }
  }
}
