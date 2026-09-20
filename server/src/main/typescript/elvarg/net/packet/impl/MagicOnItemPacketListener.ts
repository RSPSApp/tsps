import { ItemOnGroundManager } from "../../../game/entity/impl/grounditem/ItemOnGroundManager";
import { State } from "../../../game/entity/impl/grounditem/ItemOnGround";
import { ItemDefinition } from "../../../game/definition/ItemDefinition";
import { Animation } from "../../../game/model/Animation";
import { Graphic } from "../../../game/model/Graphic";
import { GraphicHeight } from "../../../game/model/GraphicHeight";
import { Item } from "../../../game/model/Item";
import { Location } from "../../../game/model/Location";
import { MagicSpellbook } from "../../../game/model/MagicSpellbook";
import { Projectile } from "../../../game/model/Projectile";
import { Skill } from "../../../game/model/Skill";
import { Sound } from "../../../game/Sound";
import { Sounds } from "../../../game/Sounds";
import { ItemIdentifiers } from "../../../util/ItemIdentifiers";
import { World } from "../../../game/World";
import { CombatRange } from "../../../game/content/combat/CombatRange";
import { ArceuusItemSpells } from "../../../game/content/combat/magic/ArceuusItemSpells";

export class MagicOnItemPacketListener {
  private static readonly LOW_ALCH_SPELL_ID = 1162;
  private static readonly HIGH_ALCH_SPELL_ID = 1178;
  private static readonly LOW_ALCH_LEVEL = 21;
  private static readonly HIGH_ALCH_LEVEL = 55;
  private static readonly LOW_ALCH_XP = 4000;
  private static readonly HIGH_ALCH_XP = 20000;
  private static readonly LOW_ALCH_FIRE_RUNES = 3;
  private static readonly HIGH_ALCH_FIRE_RUNES = 5;
  private static readonly TELEKINETIC_GRAB_SPELL_ID = 1168;
  private static readonly TELEKINETIC_GRAB_LEVEL = 33;
  private static readonly TELEKINETIC_GRAB_XP = 3988;
  private static readonly TELEKINETIC_GRAB_RANGE = 10;
  private static readonly AIR_STAVES = new Set<number>([1381, 1397, 1405, 6562, 6563, 3053, 3054]);
  private static readonly FIRE_STAVES = new Set<number>([1387, 1393, 1401, 3053, 3054]);

  public resolveSpellId(name: string | undefined): number {
    switch (name?.trim().toLowerCase()) {
      case "low level alchemy":
        return MagicOnItemPacketListener.LOW_ALCH_SPELL_ID;
      case "high level alchemy":
        return MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID;
      case "telekinetic grab":
        return MagicOnItemPacketListener.TELEKINETIC_GRAB_SPELL_ID;
      case "basic reanimation":
        return ArceuusItemSpells.BASIC_REANIMATION;
      case "adept reanimation":
        return ArceuusItemSpells.ADEPT_REANIMATION;
      case "expert reanimation":
        return ArceuusItemSpells.EXPERT_REANIMATION;
      case "master reanimation":
        return ArceuusItemSpells.MASTER_REANIMATION;
      default:
        return -1;
    }
  }

  private hasInfiniteAirRune(player: any): boolean {
    const weapon = player?.getEquipment?.()?.getWeapon?.();
    const weaponId = weapon?.getId?.() ?? -1;
    return MagicOnItemPacketListener.AIR_STAVES.has(weaponId);
  }

  private hasInfiniteFireRune(player: any): boolean {
    const weapon = player?.getEquipment?.()?.getWeapon?.();
    const weaponId = weapon?.getId?.() ?? -1;
    return MagicOnItemPacketListener.FIRE_STAVES.has(weaponId);
  }

  private hasTelegrabRunes(player: any): boolean {
    const inventory = player.getInventory();
    if (!inventory.contains(ItemIdentifiers.LAW_RUNE)) {
      return false;
    }
    if (this.hasInfiniteAirRune(player)) {
      return true;
    }
    return inventory.contains(ItemIdentifiers.AIR_RUNE);
  }

  private consumeTelegrabRunes(player: any): void {
    const inventory = player.getInventory();
    inventory.deletes(new Item(ItemIdentifiers.LAW_RUNE, 1));
    if (!this.hasInfiniteAirRune(player)) {
      inventory.deletes(new Item(ItemIdentifiers.AIR_RUNE, 1));
    }
  }

  private canReceiveGroundItem(player: any, itemId: number): boolean {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() > 0) {
      return true;
    }
    const definition = ItemDefinition.forId(itemId);
    return definition?.isStackable?.() && inventory.contains(itemId);
  }

  public castGroundItem(player: any, groundItemId: number, x: number, y: number, spellId: number): void {
    if (spellId !== MagicOnItemPacketListener.TELEKINETIC_GRAB_SPELL_ID) {
      return;
    }
    if (!player || player.getHitpoints?.() <= 0) {
      return;
    }
    if (!player.getClickDelay().elapsedTime(500)) {
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < MagicOnItemPacketListener.TELEKINETIC_GRAB_LEVEL) {
      player.sendMessage(
        `You need a Magic level of ${MagicOnItemPacketListener.TELEKINETIC_GRAB_LEVEL} to cast this spell.`
      );
      return;
    }
    if (!this.hasTelegrabRunes(player)) {
      player.sendMessage("You do not have the required items to cast this spell.");
      return;
    }

    const position = new Location(x, y, player.getLocation().getZ());
    if (!CombatRange.withinApproachDistance(player, position, MagicOnItemPacketListener.TELEKINETIC_GRAB_RANGE)) {
      // Out of approach distance: walk in and resolve the cast on arrival, rather
      // than rejecting the click outright.
      player.getMovementQueue().walkToTile(
        position,
        () => this.castGroundItem(player, groundItemId, x, y, spellId),
        (entity: any, destination: Location) =>
          CombatRange.withinApproachDistance(entity, destination, MagicOnItemPacketListener.TELEKINETIC_GRAB_RANGE)
      );
      return;
    }

    const groundItem = this.findVisibleGroundItem(player, groundItemId, position);
    if (!groundItem) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    if (!this.canReceiveGroundItem(player, groundItemId)) {
      player.getInventory().full();
      return;
    }

    this.consumeTelegrabRunes(player);
    player.getSkillManager().stopSkillable();

    player.setPositionToFace(position);
    player.performAnimation(new Animation(711));
    player.performGraphic(new Graphic(142, GraphicHeight.HIGH));
    new Projectile(
      player.getLocation().clone(),
      position.clone(),
      null,
      143,
      40,
      80,
      43,
      31,
      player.getPrivateArea()
    ).sendProjectile();
    Sounds.sendSound(player, Sound.TELEKINETIC_GRAB);

    ItemOnGroundManager.deregister(groundItem);
    player.getInventory().addItem(groundItem.getItem().clone());
    player.getSkillManager().addExperiences(Skill.MAGIC, MagicOnItemPacketListener.TELEKINETIC_GRAB_XP);
    player.getClickDelay().reset();
  }

  private isAlchSpell(spellId: number): boolean {
    return (
      spellId === MagicOnItemPacketListener.LOW_ALCH_SPELL_ID ||
      spellId === MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID
    );
  }

  private castAlchemy(player: any, spellId: number, item: any, itemId: number): void {
    const inventory = player.getInventory();
    const isHighAlch = spellId === MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID;
    const requiredLevel = isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_LEVEL
      : MagicOnItemPacketListener.LOW_ALCH_LEVEL;
    const fireRunesRequired = isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_FIRE_RUNES
      : MagicOnItemPacketListener.LOW_ALCH_FIRE_RUNES;
    const experience = isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_XP
      : MagicOnItemPacketListener.LOW_ALCH_XP;
    const definition = item?.getDefinition?.();

    if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < requiredLevel) {
      player.sendMessage(`You need a Magic level of ${requiredLevel} to cast this spell.`);
      return;
    }
    if (
      !item?.isTradeable?.() ||
      !item?.isSellable?.() ||
      itemId === ItemIdentifiers.COINS ||
      definition.getHighAlchValue() <= 0 ||
      definition.getLowAlchValue() <= 0
    ) {
      player.sendMessage("This spell can not be cast on this item.");
      return;
    }
    if (!inventory.contains(ItemIdentifiers.NATURE_RUNE)) {
      player.sendMessage("You do not have the required items to cast this spell.");
      return;
    }
    if (!this.hasInfiniteFireRune(player) && inventory.getAmount(ItemIdentifiers.FIRE_RUNE) < fireRunesRequired) {
      player.sendMessage("You do not have the required items to cast this spell.");
      return;
    }
    if (player.getSpellbook()?.getInterfaceId?.() !== MagicSpellbook.NORMAL.getInterfaceId()) {
      return;
    }

    inventory.deleteNumber(itemId, 1);
    inventory.deleteNumber(ItemIdentifiers.NATURE_RUNE, 1);
    if (!this.hasInfiniteFireRune(player)) {
      inventory.deleteNumber(ItemIdentifiers.FIRE_RUNE, fireRunesRequired);
    }

    player.performAnimation(new Animation(712));
    Sounds.sendSound(player, isHighAlch ? Sound.HIGH_ALCHEMY : Sound.LOW_ALCHEMY);
    if (isHighAlch) {
      inventory.adds(ItemIdentifiers.COINS, definition.getHighAlchValue());
    } else {
      inventory.adds(ItemIdentifiers.COINS, definition.getLowAlchValue());
    }
    player.performGraphic(new Graphic(112, GraphicHeight.HIGH));
    player.getSkillManager().addExperiences(Skill.MAGIC, experience);
    player.getPacketSender().sendTab(6);
  }

  private findVisibleGroundItem(player: any, groundItemId: number, position: Location): any | null {
    const exact = ItemOnGroundManager.getGroundItem(player.getUsername(), groundItemId, position);
    if (exact) {
      return exact;
    }

    for (const item of World.getItems()) {
      if (!item || item.isPendingRemoval?.()) {
        continue;
      }
      if (item.getItem?.().getId?.() !== groundItemId) {
        continue;
      }
      if (!item.getPosition?.().equals?.(position)) {
        continue;
      }
      if (item.getPrivateArea?.() !== player.getPrivateArea?.()) {
        continue;
      }
      if (item.getState?.() === State.SEEN_BY_PLAYER && item.getOwner?.() !== player.getUsername?.()) {
        continue;
      }
      return item;
    }
    return null;
  }

  public castOnItem(player: any, spellId: number, itemId: number, slot: number): boolean {
    if (ArceuusItemSpells.castOnItem(player, spellId, itemId, slot)) {
      return true;
    }
    if (
      !player ||
      slot < 0 ||
      slot >= player.getInventory().capacity() ||
      !this.isAlchSpell(spellId)
    ) {
      return false;
    }
    const item = player.getInventory().getItems()[slot];
    if (!item || item.getId() !== itemId) {
      return false;
    }
    this.castAlchemy(player, spellId, item, itemId);
    return true;
  }

}
