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
   * `confirmed`: true once the player answered every drop warning for this item, or the names of
   * the warnings answered so far. Before an item lands on the floor, "item:drop-warning"
   * { player, item, itemId, slot, answered, warned, proceed } lets a plugin ask first: unless its
   * warning is in `answered` or another plugin already `warned`, it sets `warned` and calls
   * `proceed(name)` on the player's yes, which drops again so the next warning can ask.
   */
  public static drop(player: any, id: number, interfaceId: number, itemSlot: number, confirmed: boolean | readonly string[] = false): void {
    if (player == null || player.getHitpoints() <= 0) {
      return;
    }
    // As the gear-swap refusal (NetworkBuilder.inventoryAction): nothing drops mid-teleport. A teleport tablet is used
    // up at the absorb (docs/teleport-tablets.md), so dropping it in the windup teleported and kept the tablet.
    if (player.isTeleportingReturn?.()) return;

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
      if (confirmed !== true && dropEvent.dropToGround !== false) {
        const answered: readonly string[] = Array.isArray(confirmed) ? confirmed : [];
        const warning = { player, item, itemId: id, slot: itemSlot, answered, warned: false,
          proceed: (name?: string) => {
            if (player.getInventory().getItems()[itemSlot] !== item) return;
            DropItemPacketListener.drop(player, id, interfaceId, itemSlot, name ? [...answered, name] : true);
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
