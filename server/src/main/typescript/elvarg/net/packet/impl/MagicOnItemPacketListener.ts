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
import { PluginManager } from "../../../plugins/PluginManager";
import { CombatRange } from "../../../game/content/combat/CombatRange";
import { Spell } from "../../../game/content/combat/magic/Spell";
import { ArceuusItemSpells } from "../../../game/content/combat/magic/ArceuusItemSpells";
import { Task } from "../../../game/task/Task";
import { TaskManager } from "../../../game/task/TaskManager";

export class MagicOnItemPacketListener {
  private static readonly LOW_ALCH_SPELL_ID = 1162;
  private static readonly HIGH_ALCH_SPELL_ID = 1178;
  private static readonly LOW_ALCH_LEVEL = 21;
  private static readonly HIGH_ALCH_LEVEL = 55;
  private static readonly LOW_ALCH_XP = 31;
  private static readonly HIGH_ALCH_XP = 65;
  private static readonly LOW_ALCH_FIRE_RUNES = 3;
  private static readonly HIGH_ALCH_FIRE_RUNES = 5;
  private static readonly TELEKINETIC_GRAB_SPELL_ID = 1168;
  private static readonly TELEKINETIC_GRAB_LEVEL = 33;
  private static readonly TELEKINETIC_GRAB_XP = 43;
  private static readonly TELEKINETIC_GRAB_RANGE = 10;
  private static readonly HUMAN_CASTTELEGRAB = 723;
  /** Client cycles (20ms) from the cast until the projectile lands on the item. */
  private static readonly TELEKINETIC_GRAB_LANDS_CYCLES = 80;
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

  private runeCosts(player: any, spellId: number, costs: Item[]): Item[] {
    return costs.filter(item => PluginManager.emitSpellRuneBypass(
      player, MagicSpellbook.NORMAL, spellId, item.getId()
    ) !== true && !(item.getId() === ItemIdentifiers.AIR_RUNE && this.hasInfiniteAirRune(player))
      && !(item.getId() === ItemIdentifiers.FIRE_RUNE && this.hasInfiniteFireRune(player)));
  }

  private hasRunes(player: any, costs: Item[]): boolean {
    const missing = Spell.inventoryShortfall(player, costs);
    return missing.length === 0 || PluginManager.checkSpellRuneSource(player, missing);
  }

  private consumeRunes(player: any, costs: Item[]): void {
    const missing = Spell.inventoryShortfall(player, costs);
    for (const item of costs) player.getInventory().deleteNumber(item.getId(), item.getAmount());
    if (missing.length) PluginManager.consumeSpellRuneSource(player, missing);
  }

  private canReceiveGroundItem(player: any, item: Item): boolean {
    return ItemOnGroundManager.inventoryCapacity(player, item) > 0;
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
    const runes = this.runeCosts(player, spellId, [
      new Item(ItemIdentifiers.LAW_RUNE, 1), new Item(ItemIdentifiers.AIR_RUNE, 1)
    ]);
    if (!this.hasRunes(player, runes)) {
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
    if (!this.canReceiveGroundItem(player, groundItem.getItem())) {
      player.getInventory().full();
      return;
    }

    this.consumeRunes(player, runes);
    player.getSkillManager().stopSkillable();

    player.setPositionToFace(position);
    player.performAnimation(new Animation(MagicOnItemPacketListener.HUMAN_CASTTELEGRAB));
    player.performGraphic(new Graphic(142, GraphicHeight.HIGH));
    // OSRS has used one travel time whatever the distance since May 2024.
    new Projectile(
      player.getLocation().clone(),
      position.clone(),
      null,
      143,
      40,
      MagicOnItemPacketListener.TELEKINETIC_GRAB_LANDS_CYCLES,
      43,
      31,
      player.getPrivateArea()
    ).sendProjectile();
    player.getPacketSender().sendGlobalGraphic(
      new Graphic(144, MagicOnItemPacketListener.TELEKINETIC_GRAB_LANDS_CYCLES, GraphicHeight.LOW), position
    );
    Sounds.sendSound(player, Sound.TELEKINETIC_GRAB);
    player.getClickDelay().reset();

    // The item comes away when the projectile lands, not on the cast; the grab doesn't stall the
    // player, and anyone can still take the item first.
    const listener = this;
    TaskManager.submit(new class extends Task {
      // Not keyed to the player, so walking off or clicking doesn't cancel a grab already flying.
      constructor() { super(Math.ceil(MagicOnItemPacketListener.TELEKINETIC_GRAB_LANDS_CYCLES / 30), false); }
      execute(): void {
        this.stop();
        listener.landGroundItemGrab(player, groundItemId, position);
      }
    });
  }

  /** The telegrab projectile has landed: the item is taken if it is still there. */
  private landGroundItemGrab(player: any, groundItemId: number, position: Location): void {
    if (!player.isRegistered?.() || player.getHitpoints?.() <= 0) {
      return;
    }
    if (player.getLocation().getZ() !== position.getZ()) {
      player.sendMessage("Your telegrab fizzles as you move too far away.");
      return;
    }
    player.getSkillManager().addExperiences(Skill.MAGIC, MagicOnItemPacketListener.TELEKINETIC_GRAB_XP);
    const groundItem = this.findVisibleGroundItem(player, groundItemId, position);
    if (!groundItem) {
      player.sendMessage("Too late - it's gone!");
      return;
    }
    if (ItemOnGroundManager.transferToInventory(player, groundItem, "telegrab") <= 0) return;
    PluginManager.emitCustomEvent("magic:telekinetic-grab", { player, itemId: groundItemId, position });
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
    const policy = { player, itemId, spellId, allowed: !!item?.isTradeable?.() && !!item?.isSellable?.()
      && definition.getHighAlchValue() > 0 && definition.getLowAlchValue() > 0,
      coins: isHighAlch ? definition.getHighAlchValue() : definition.getLowAlchValue() };
    PluginManager.emitCustomEvent("magic:alchemy-policy", policy);
    if (itemId === ItemIdentifiers.COINS || !policy.allowed || !Number.isSafeInteger(policy.coins) || policy.coins < 0) {
      player.sendMessage("This spell can not be cast on this item.");
      return;
    }
    const runes = this.runeCosts(player, spellId, [
      new Item(ItemIdentifiers.NATURE_RUNE, 1), new Item(ItemIdentifiers.FIRE_RUNE, fireRunesRequired)
    ]);
    if (!this.hasRunes(player, runes)) {
      player.sendMessage("You do not have the required items to cast this spell.");
      return;
    }
    if (player.getSpellbook()?.getInterfaceId?.() !== MagicSpellbook.NORMAL.getInterfaceId()) {
      return;
    }

    inventory.deleteNumber(itemId, 1);
    this.consumeRunes(player, runes);

    player.performAnimation(new Animation(712));
    Sounds.sendSound(player, isHighAlch ? Sound.HIGH_ALCHEMY : Sound.LOW_ALCHEMY);
    if (policy.coins > 0) inventory.adds(ItemIdentifiers.COINS, policy.coins);
    PluginManager.emitCustomEvent("magic:alchemy-completed", { player, itemId, spellId });
    player.performGraphic(new Graphic(112, GraphicHeight.HIGH));
    player.getSkillManager().addExperiences(Skill.MAGIC, experience);
    player.getPacketSender().sendTab(6);
  }

  private findVisibleGroundItem(player: any, groundItemId: number, position: Location): any | null {
    const exact = ItemOnGroundManager.getGroundItem(player.getUsername(), groundItemId, position, player.getPrivateArea());
    if (exact && ItemOnGroundManager.canSee(player, exact)) {
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
      if (!ItemOnGroundManager.canSee(player, item)) continue;
      if (item.getState?.() === State.SEEN_BY_PLAYER && item.getOwner?.() !== player.getUsername?.()) {
        continue;
      }
      return item;
    }
    return null;
  }

  public castOnItem(player: any, spellId: number, itemId: number, slot: number): boolean {
    if (PluginManager.emitCanUseItem(player, itemId, "magic") === false) {
      return true;
    }
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
