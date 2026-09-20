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
  public static destroyItemInterface(player: any, item: any) {
    player.setDestroyItem(item.getId());
    player.getPacketSender()
      .sendChatboxInterface(DESTROY_ITEM_INTERFACE_ID)
      .sendString(item.getDefinition().getName(), DESTROY_ITEM_NAME_COMPONENT)
      .sendInterfaceFlags(DESTROY_ITEM_YES_COMPONENT, FIRST_OPTION_FLAG)
      .sendInterfaceFlags(DESTROY_ITEM_NO_COMPONENT, FIRST_OPTION_FLAG);
  }

  public static drop(player: any, id: number, interfaceId: number, itemSlot: number): void {
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
    const pluginHandled = PluginManager.emitItemDropPolicy(dropEvent);
    if (pluginHandled) {
      Sounds.sendSound(player, Sound.DROP_ITEM);
      return;
    }

    if (item.isDropable()) {
      if (dropEvent.dropToGround !== false) {
        const toFloor = item.clone();
        if (Wilderness.isIn(player)) {
          ItemOnGroundManager.registerGlobal(player, toFloor);
        } else {
          ItemOnGroundManager.registers(player, toFloor);
        }
      }

      player.getInventory().setItem(itemSlot, new Item(-1, 0)).refreshItems();
      Sounds.sendSound(player, Sound.DROP_ITEM);
    } else {
      DropItemPacketListener.destroyItemInterface(player, item);
    }
  }
}
