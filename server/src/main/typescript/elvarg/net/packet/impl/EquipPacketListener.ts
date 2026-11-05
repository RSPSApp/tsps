import { WeaponInterfaceManager } from "../../../game/content/combat/WeaponInterfaceManager";
import { Server } from "../../../Server";
import { PluginManager } from "../../../plugins/PluginManager";
import { EquipmentSounds } from "../../../game/definition/EquipmentSounds";
import { Sounds } from "../../../game/Sounds";
import { Wilderness } from "../../../game/content/wilderness/Wilderness";
import { EquipmentRequirements } from "../../../game/model/equipment/EquipmentRequirements";

const getInventoryCtor = () =>
  require("../../../game/model/container/impl/Inventory")
    .Inventory as typeof import("../../../game/model/container/impl/Inventory").Inventory;
const getEquipmentCtor = () =>
  require("../../../game/model/container/impl/Equipment")
    .Equipment as typeof import("../../../game/model/container/impl/Equipment").Equipment;
const getItemCtor = () =>
  require("../../../game/model/Item")
    .Item as typeof import("../../../game/model/Item").Item;
const getFlagEnum = () =>
  require("../../../game/model/Flag")
    .Flag as typeof import("../../../game/model/Flag").Flag;
const getBonusManager = () =>
  require("../../../game/model/equipment/BonusManager")
    .BonusManager as typeof import("../../../game/model/equipment/BonusManager").BonusManager;
const getCombatSpecial = () =>
  require("../../../game/content/combat/CombatSpecial")
    .CombatSpecial as typeof import("../../../game/content/combat/CombatSpecial").CombatSpecial;
const getAutocasting = () =>
  require("../../../game/content/combat/magic/Autocasting")
    .Autocasting as typeof import("../../../game/content/combat/magic/Autocasting").Autocasting;

export class EquipPacketListener {
  private static readonly EQUIPMENT_SLOTS = [0, 1, 2, 3, 4, 5, 7, 9, 10, 12, 13];
  public static readonly PRESERVE_INTERFACE_ON_EQUIP_ATTRIBUTE = "interface:preserve-on-equip";

  public static preservesInterfaceOnEquip(player: any): boolean {
    return player?.getAttribute?.(this.PRESERVE_INTERFACE_ON_EQUIP_ATTRIBUTE) === player?.getInterfaceId?.();
  }

  /** Whether add() merges these: a stack's id and metadata both have to match. */
  private static sameStack(a: any, b: any): boolean {
    return a.getId() === b.getId() && JSON.stringify(a.getMeta() ?? null) === JSON.stringify(b.getMeta() ?? null);
  }

  /**
   * Empties the clicked slot for a worn item: it joins a stack it matches, else takes the slot, so a
   * worn stack never sits beside its own kind. False, with nothing changed, if the stack has no room.
   */
  private static displace(inventory: any, slot: number, worn: any): boolean {
    const joinsStack = worn.getDefinition().isStackable() &&
      inventory.getItems().some((held: any) => EquipPacketListener.sameStack(held, worn));
    if (!joinsStack) {
      inventory.setItem(slot, worn);
      return true;
    }
    if (inventory.getAddableAmount(worn) < worn.getAmount()) {
      inventory.full();
      return false;
    }
    inventory.deleteAtSlot(slot, inventory.getItems()[slot].getAmount(), false);
    inventory.add(worn, false);
    return true;
  }

  public static resolveEquipmentSlot(groupId: number, childId: number): number {
    const firstChild = groupId === 387 ? 15 : groupId === 84 ? 10 : -1;
    return firstChild < 0
      ? -1
      : EquipPacketListener.EQUIPMENT_SLOTS[childId - firstChild] ?? -1;
  }

  public static resetWeapon(player: any, deactivateSpecialAttack: boolean) {
    if (deactivateSpecialAttack) {
      player.setSpecialActivated(false);
    }
    player.getPacketSender().sendSpecialAttackState(false);
    const autocastSpell = player.getCombat().getAutocastSpell();
    const inWilderness = Wilderness.isIn(player);
    if (autocastSpell != null && inWilderness) {
      getAutocasting().setAutocast(player, null);
    }
    WeaponInterfaceManager.assign(player);
    if (autocastSpell != null && !inWilderness && player.getEquipment().hasStaffEquipped()) {
      getAutocasting().setAutocast(player, autocastSpell);
    }
  }

  public static equipFromInventory(player: any, itemInSlot: any) {
    if (!player || !itemInSlot) {
      return;
    }
    const Inventory = getInventoryCtor();
    EquipPacketListener.equip(
      player,
      itemInSlot.getId(),
      itemInSlot.getSlot(),
      Inventory.INTERFACE_ID
    );
  }

  public static equip(
    player: any,
    id: number,
    slot: number,
    interfaceId: number
  ): void {
    if (!player || player.getHitpoints() <= 0) {
      return;
    }

    const Inventory = getInventoryCtor();
    const Equipment = getEquipmentCtor();
    const Item = getItemCtor();
    const Flag = getFlagEnum();

    if (slot < 0 || slot >= player.getInventory().capacity()) {
      return;
    }

    const inventory = player.getInventory();
    const equipment = player.getEquipment();
    const itemInSlot = inventory.getItems()[slot];
    if (!itemInSlot || itemInSlot.getId() !== id) {
      return;
    }

    // Equipping from the inventory is a hard interruption (osrs-docs: Entity
    // Interactions), so it ends any player follow that was running.
    const following = player.getFollowing?.();
    if (following) {
      player.setFollowing(null);
      if (player.getInteractingMobile?.() === following) player.setMobileInteraction(null);
      if (player.getPositionToFace?.()?.equals?.(following.getLocation())) player.setPositionToFace(null);
    }

    if (
      player.getInterfaceId() > 0 &&
      player.getInterfaceId() !== Equipment.EQUIPMENT_SCREEN_INTERFACE_ID &&
      !EquipPacketListener.preservesInterfaceOnEquip(player)
    ) {
      player.getPacketSender().sendInterfaceRemoval();
    }

    player.getSkillManager().stopSkillable();

    if (interfaceId !== Inventory.INTERFACE_ID) {
      return;
    }

    const item = itemInSlot.clone();
    const unmetRequirement = EquipmentRequirements.getUnmet(player, item.getDefinition());
    if (unmetRequirement != null) {
      player.sendMessage(EquipmentRequirements.message(unmetRequirement));
      return;
    }

    const equipmentSlot = item.getDefinition().getEquipmentType().getSlot();
    if (equipmentSlot === -1) {
      Server.getLogger().info(
        `Attempting to equip item ${item.getId()} which has no defined equipment slot.`
      );
      return;
    }

    if (PluginManager.emitCanEquip(player, equipmentSlot, item) === false) {
      return;
    }

    const currentlyEquipped = equipment.forSlot(equipmentSlot).clone();
    const stackableAndSameItem =
      EquipPacketListener.sameStack(currentlyEquipped, item) &&
      item.getDefinition().isStackable();

    if (stackableAndSameItem) {
      if (equipment.getAddableAmount(item) < item.getAmount()) {
        inventory.full();
        return;
      }
      inventory.deleteAtSlot(slot, item.getAmount(), false);
      equipment.getItems()[equipmentSlot].setAmount(currentlyEquipped.getAmount() + item.getAmount());
    } else if (
      item.getDefinition().isDoubleHanded() &&
      equipmentSlot === Equipment.WEAPON_SLOT
    ) {
      // The displaced weapon lands in the slot the two-handed weapon came from, so the shield
      // only needs a spare slot when there is a weapon to fill it. Wielding a two-hander into
      // empty hands vacates its own slot, which the stowed shield takes.
      const slotsRequired = equipment.isSlotOccupied(Equipment.SHIELD_SLOT) &&
        equipment.isSlotOccupied(Equipment.WEAPON_SLOT) ? 1 : 0;
      if (inventory.getFreeSlots() < slotsRequired) {
        inventory.full();
        return;
      }

      const shield = equipment.getItems()[Equipment.SHIELD_SLOT].clone();
      const weapon = equipment.getItems()[Equipment.WEAPON_SLOT].clone();
      if (weapon.getId() === -1) {
        inventory.setItem(slot, new Item(-1, 0));
      } else if (!EquipPacketListener.displace(inventory, slot, weapon)) {
        return;
      }
      equipment.setItem(Equipment.SHIELD_SLOT, new Item(-1, 0));
      equipment.setItem(Equipment.WEAPON_SLOT, item);

      if (shield.getId() !== -1) {
        inventory.add(shield, false);
      }
    } else if (
      equipmentSlot === Equipment.SHIELD_SLOT &&
      equipment.getItems()[Equipment.WEAPON_SLOT].getDefinition().isDoubleHanded()
    ) {
      const weapon = equipment.getItems()[Equipment.WEAPON_SLOT].clone();
      if (!EquipPacketListener.displace(inventory, slot, weapon)) return;
      equipment.setItem(Equipment.WEAPON_SLOT, new Item(-1, 0));
      equipment.setItem(Equipment.SHIELD_SLOT, item);
      EquipPacketListener.resetWeapon(player, true);
    } else {
      if (
        currentlyEquipped.getId() !== -1 &&
        currentlyEquipped.getDefinition().getEquipmentType().getSlot() ===
          equipmentSlot
      ) {
        if (!EquipPacketListener.displace(inventory, slot, currentlyEquipped)) return;
        equipment.setItem(equipmentSlot, item);
      } else {
        inventory.setItem(slot, new Item(-1, 0));
        equipment.setItem(equipmentSlot, item);
      }
    }

    if (equipmentSlot === Equipment.WEAPON_SLOT) {
      EquipPacketListener.resetWeapon(player, true);
    }

    getBonusManager().update(player);
    const equipChange = { equipped: true as const, itemId: item.getId(), slot: equipmentSlot };
    equipment.refreshItems(equipChange);
    inventory.refreshItems();
    player.getUpdateFlag().flag(Flag.APPEARANCE);
    Sounds.sendSound(player, EquipmentSounds.soundFor(item.getDefinition()));
  }

  public static unequip(player: any, slot: number): boolean {
    if (!player || player.getHitpoints() <= 0) return false;

    const Equipment = getEquipmentCtor();
    const Item = getItemCtor();
    const equipment = player.getEquipment();
    if (slot < 0 || slot >= equipment.capacity()) return false;

    const item = equipment.getItems()[slot];
    if (!item || item.getId() < 0) return false;
    if (PluginManager.emitCanUnequip(player, slot, item) === false) return false;

    const inventory = player.getInventory();
    const stackIntoExisting =
      item.getDefinition().isStackable() &&
      inventory.getItems().some((held: any) => EquipPacketListener.sameStack(held, item));
    const inventorySlot = inventory.getEmptySlot();
    if (stackIntoExisting
      ? inventory.getAddableAmount(item) < item.getAmount()
      : inventorySlot === -1) {
      inventory.full();
      return false;
    }

    equipment.setItem(slot, new Item(-1, 0));
    if (stackIntoExisting) inventory.add(item, false);
    else inventory.setItem(inventorySlot, item);

    getBonusManager().update(player);
    if (slot === Equipment.WEAPON_SLOT) {
      EquipPacketListener.resetWeapon(player, true);
      getCombatSpecial().updateBar(player);
    }

    equipment.refreshItems();
    inventory.refreshItems();
    player.getUpdateFlag().flag(getFlagEnum().APPEARANCE);
    // Live OSRS plays the item's own sound for removing it too.
    Sounds.sendSound(player, EquipmentSounds.soundFor(item.getDefinition()));
    return true;
  }
}
