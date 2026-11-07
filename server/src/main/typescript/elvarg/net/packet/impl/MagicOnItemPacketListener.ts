import { ItemOnGroundManager } from "../../../game/entity/impl/grounditem/ItemOnGroundManager";
import { CrossFloor } from "../../../game/CrossFloor";
import { State } from "../../../game/entity/impl/grounditem/ItemOnGround";
import { ItemDefinition } from "../../../game/definition/ItemDefinition";
import { Animation } from "../../../game/model/Animation";
import { Graphic } from "../../../game/model/Graphic";
import { GraphicHeight } from "../../../game/model/GraphicHeight";
import { Item } from "../../../game/model/Item";
import { MAX_STACK_AMOUNT } from "../../../game/model/container/StackType";
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
import { EffectSpells } from "../../../game/content/combat/magic/EffectSpells";
import { DialogueChainBuilder } from "../../../game/model/dialogues/builders/DialogueChainBuilder";
import { ItemStatementDialogue } from "../../../game/model/dialogues/entries/impl/ItemStatementDialogue";
import { OptionDialogue } from "../../../game/model/dialogues/entries/impl/OptionDialogue";
import { DialogueOption } from "../../../game/model/dialogues/DialogueOption";
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
  /** Wiki (High/Low Level Alchemy): a cast every 5 ticks, Low Level Alchemy every 3. */
  private static readonly HIGH_ALCH_CAST_TICKS = 5;
  private static readonly LOW_ALCH_CAST_TICKS = 3;
  /** human_castlowlvlalchemy / lowlvlalchemy_casting (rsprox 1098), the high-level pair (rsprox 3215). */
  private static readonly LOW_ALCH_ANIMATION = 712;
  private static readonly LOW_ALCH_GRAPHIC = 112;
  private static readonly HIGH_ALCH_ANIMATION = 713;
  private static readonly HIGH_ALCH_GRAPHIC = 113;
  /** The process cycle from which the next alchemy may be cast. */
  private static readonly ALCH_NEXT_CAST_ATTRIBUTE = "magic:alchemy-next-cast";
  /** An alchemy clicked during the last one's cast, cast as soon as it ends. */
  private static readonly ALCH_QUEUED_ATTRIBUTE = "magic:alchemy-queued";
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

    const groundItem = this.findVisibleGroundItem(player, groundItemId, x, y);
    if (!groundItem) {
      player.sendMessage("Nothing interesting happens.");
      return;
    }
    const position = groundItem.getPosition().clone();
    if (!this.withinTelegrabRange(player, position)) {
      // Out of approach distance: walk in and resolve the cast on arrival, rather
      // than rejecting the click outright.
      const approachTile = new Location(x, y, player.getLocation().getZ());
      player.getMovementQueue().walkToTile(
        approachTile,
        () => this.castGroundItem(player, groundItemId, x, y, spellId),
        (entity: any) => {
          const target = this.findVisibleGroundItem(entity, groundItemId, x, y);
          return !!target && this.withinTelegrabRange(entity, target.getPosition());
        }
      );
      return;
    }

    if (!this.canGrabGroundItem(player, groundItem)) return;
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
    const casterFloor = player.getLocation().getZ();
    TaskManager.submit(new class extends Task {
      // Not keyed to the player, so walking off or clicking doesn't cancel a grab already flying.
      constructor() { super(Math.ceil(MagicOnItemPacketListener.TELEKINETIC_GRAB_LANDS_CYCLES / 30), false); }
      execute(): void {
        this.stop();
        listener.landGroundItemGrab(player, groundItemId, position, casterFloor);
      }
    });
  }

  /** Generic permission query shared by cast and arrival checks. */
  private canGrabGroundItem(player: any, groundItem: any): boolean {
    const request = { player, groundItem, allow: true };
    PluginManager.emitCustomEvent("magic:can-telekinetic-grab", request);
    return request.allow !== false;
  }

  private withinTelegrabRange(player: any, position: Location): boolean {
    if (player.getLocation().getZ() === position.getZ()) {
      return CombatRange.withinApproachDistance(
        player, position, MagicOnItemPacketListener.TELEKINETIC_GRAB_RANGE,
      );
    }
    return CrossFloor.visible(
      player.getLocation(), position, MagicOnItemPacketListener.TELEKINETIC_GRAB_RANGE,
    );
  }

  /** The telegrab projectile has landed: the item is taken if it is still there. */
  private landGroundItemGrab(player: any, groundItemId: number, position: Location, casterFloor = position.getZ()): void {
    if (!player.isRegistered?.() || player.getHitpoints?.() <= 0) {
      return;
    }
    if (casterFloor === position.getZ()
      ? player.getLocation().getZ() !== casterFloor
      : !this.withinTelegrabRange(player, position)) {
      player.sendMessage("Your telegrab fizzles as you move too far away.");
      return;
    }
    player.getSkillManager().addExperiences(Skill.MAGIC, MagicOnItemPacketListener.TELEKINETIC_GRAB_XP);
    const groundItem = this.findVisibleGroundItem(
      player, groundItemId, position.getX(), position.getY(), position.getZ(),
    );
    if (!groundItem) {
      player.sendMessage("Too late - it's gone!");
      return;
    }
    if (!this.canGrabGroundItem(player, groundItem)) return;
    if (ItemOnGroundManager.transferToInventory(player, groundItem, "telegrab") <= 0) return;
    PluginManager.emitCustomEvent("magic:telekinetic-grab", { player, itemId: groundItemId, position });
  }

  private isAlchSpell(spellId: number): boolean {
    return (
      spellId === MagicOnItemPacketListener.LOW_ALCH_SPELL_ID ||
      spellId === MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID
    );
  }

  /**
   * One alchemy cast on the item in `slot`. A cast clicked before the last one has finished
   * waits for it (Wiki: "If you cast a second alchemy spell before your last one finishes, it's
   * now queued up"); a later click replaces the waiting one. An untradeable item asks first, as
   * live does (rsprox 3215): "That item cannot be traded." beside it, then Proceed/Cancel.
   */
  private castAlchemy(player: any, spellId: number, slot: number, itemId: number, confirmed = false, source?: unknown): void {
    const inventory = player.getInventory();
    const clickedItem = inventory.getItems()[slot];
    if (!clickedItem || clickedItem.getId() !== itemId) {
      return;
    }
    // Alchemy takes the first equivalent copy in inventory order. Keep custom-state and
    // preset items separate, using the same ID/metadata matching as inventory stacking.
    const meta = JSON.stringify(clickedItem.getMeta?.() ?? null);
    const alchemySlot = inventory.getItems().findIndex((held: Item) => held?.getId() === itemId
      && JSON.stringify(held.getMeta?.() ?? null) === meta);
    const item = inventory.getItems()[alchemySlot];
    const isHighAlch = spellId === MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID;
    const spell = isHighAlch ? EffectSpells.HIGH_ALCHEMY : EffectSpells.LOW_ALCHEMY;
    const requiredLevel = isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_LEVEL
      : MagicOnItemPacketListener.LOW_ALCH_LEVEL;
    const fireRunesRequired = isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_FIRE_RUNES
      : MagicOnItemPacketListener.LOW_ALCH_FIRE_RUNES;
    const experience = isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_XP
      : MagicOnItemPacketListener.LOW_ALCH_XP;
    const definition = item.getDefinition?.();

    // Untradeable items alch too, after a warning (rsprox 3215: Iban's staff for 12 coins); only
    // the server's own untradeable flag (PvP preset items) keeps an item out. A plugin that turns
    // the cast into something else clears `confirm`, `keepItem` and `recast`.
    const policy = { player, itemId, spellId, high: isHighAlch, allowed: !item.isUntradeable?.()
      && definition.getHighAlchValue() > 0 && definition.getLowAlchValue() > 0,
      coins: isHighAlch ? definition.getHighAlchValue() : definition.getLowAlchValue(),
      castTicks: isHighAlch ? MagicOnItemPacketListener.HIGH_ALCH_CAST_TICKS : MagicOnItemPacketListener.LOW_ALCH_CAST_TICKS,
      confirm: !definition.isTradeable?.(),
      // Content may lower the level, waive the runes, keep the item or cast again on what is left (a league relic).
      requiredLevel, freeRunes: false, keepItem: false, recast: false };
    PluginManager.emitCustomEvent("magic:alchemy-policy", policy);
    // Content may cast faster ("skills:action-interval", a league relic's 2-tick pace), from the pace the policy settled on.
    const pace = { player, skill: Skill.MAGIC, kind: "alchemy", ticks: policy.castTicks };
    PluginManager.emitCustomEvent("skills:action-interval", pace);
    policy.castTicks = Math.max(1, pace.ticks | 0);
    if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < policy.requiredLevel) {
      player.sendMessage(`You need a Magic level of ${policy.requiredLevel} to cast this spell.`);
      return;
    }
    // Zone rules (Pest Control) ride the same hook as every other spell.
    if (PluginManager.emitSpellDisabled(player, MagicSpellbook.NORMAL, spellId, spell) === true) {
      return;
    }
    if (itemId === ItemIdentifiers.COINS || !policy.allowed || !Number.isSafeInteger(policy.coins) || policy.coins < 0) {
      player.sendMessage("This spell can not be cast on this item.");
      return;
    }
    const runes = policy.freeRunes === true ? [] : this.runeCosts(player, spellId, [
      new Item(ItemIdentifiers.NATURE_RUNE, 1), new Item(ItemIdentifiers.FIRE_RUNE, fireRunesRequired)
    ]);
    // Content can fund a cast through a validated alternative source. Resolve again
    // after a confirmation/queue; no payment is committed until the item is converted.
    const payment = { player, item, itemId, slot: alchemySlot, spellId, source, high: isHighAlch, coins: policy.coins,
      hasRunes: this.hasRunes(player, runes), allowed: source === undefined,
      free: false, experience, allowAnySpellbook: false, keepTab: false,
      validate: undefined as (() => boolean) | undefined,
      commit: undefined as (() => void) | undefined };
    PluginManager.emitCustomEvent("magic:alchemy-payment", payment);
    if (!payment.allowed || payment.validate?.() === false) return;
    if (!payment.free && !payment.hasRunes) {
      player.sendMessage("You do not have the required items to cast this spell.");
      return;
    }
    if (!payment.allowAnySpellbook && player.getSpellbook()?.getInterfaceId?.() !== MagicSpellbook.NORMAL.getInterfaceId()) {
      return;
    }
    // An existing matching coin stack cannot overflow, even when other slots are free.
    // A new stack may instead use a slot released by the item or spent runes.
    if (policy.coins > 0) {
      const coins = new Item(ItemIdentifiers.COINS, policy.coins);
      const matchingCoins = inventory.getItems().some((held: any) => held?.getId?.() === ItemIdentifiers.COINS
        && JSON.stringify(held.getMeta?.() ?? null) === JSON.stringify(coins.getMeta() ?? null));
      const fitsNow = inventory.getAddableAmount(coins) === policy.coins;
      const freesItemSlot = policy.keepItem !== true && (item.getAmount?.() ?? 1) === 1;
      const freesRuneSlot = !payment.free && runes.some(rune => {
        const held = inventory.getAmount?.(rune.getId()) ?? 0;
        return held > 0 && held <= rune.getAmount();
      });
      if (!fitsNow && (matchingCoins || policy.coins > MAX_STACK_AMOUNT || !(freesItemSlot || freesRuneSlot))) {
        player.sendMessage("You don't have enough inventory space.");
        return;
      }
    }
    if (!confirmed && policy.confirm) {
      this.confirmUntradeableAlchemy(player, spellId, slot, itemId, definition.getName(), clickedItem, source);
      return;
    }
    const now = World.getProcessCycle();
    const nextCast = Number(player.getAttribute(MagicOnItemPacketListener.ALCH_NEXT_CAST_ATTRIBUTE) ?? 0);
    if (now < nextCast) {
      this.queueAlchemy(player, { spellId, slot, itemId, item: clickedItem, source }, nextCast - now);
      return;
    }

    if (inventory.getItems()[slot] !== clickedItem || inventory.getItems()[alchemySlot] !== item
      || payment.validate?.() === false) return;
    if (policy.keepItem !== true) inventory.deleteAtSlot(alchemySlot, 1);
    if (!payment.free) this.consumeRunes(player, runes);
    player.setAttribute(MagicOnItemPacketListener.ALCH_NEXT_CAST_ATTRIBUTE, now + policy.castTicks);
    // "magic:item-spell-cast" { player, spell }: an alchemy cast on an item (a league's "Cast Low
    // Level Alchemy"); combat casts report "magic:cast-committed" instead.
    PluginManager.emitCustomEvent("magic:item-spell-cast", { player, spell });

    player.performAnimation(new Animation(isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_ANIMATION
      : MagicOnItemPacketListener.LOW_ALCH_ANIMATION));
    Sounds.sendSound(player, isHighAlch ? Sound.HIGH_ALCHEMY : Sound.LOW_ALCHEMY);
    if (policy.coins > 0) inventory.adds(ItemIdentifiers.COINS, policy.coins);
    payment.commit?.();
    // `coins`: what the cast paid (a league's "Convert an item into at least 500 coins").
    PluginManager.emitCustomEvent("magic:alchemy-completed", { player, itemId, spellId, coins: policy.coins });
    player.performGraphic(new Graphic(isHighAlch
      ? MagicOnItemPacketListener.HIGH_ALCH_GRAPHIC
      : MagicOnItemPacketListener.LOW_ALCH_GRAPHIC, GraphicHeight.HIGH));
    if (payment.experience > 0) player.getSkillManager().addExperiences(Skill.MAGIC, payment.experience);
    if (!payment.keepTab) player.getPacketSender().sendTab(6);
    // Cast again on what is left in the slot, once this cast ends (a league relic's automatic alchemy).
    if (policy.recast === true && inventory.getItems()[slot]?.getId() === itemId) {
      this.queueAlchemy(player, { spellId, slot, itemId, item: inventory.getItems()[slot], source }, policy.castTicks);
    }
  }

  /** The waiting cast is cast once the current one ends; only one waits at a time. */
  private queueAlchemy(player: any, cast: { spellId: number; slot: number; itemId: number; item: any; source?: unknown }, ticks: number): void {
    const waiting = player.getAttribute(MagicOnItemPacketListener.ALCH_QUEUED_ATTRIBUTE);
    player.setAttribute(MagicOnItemPacketListener.ALCH_QUEUED_ATTRIBUTE, cast);
    if (waiting) {
      return;
    }
    const listener = this;
    TaskManager.submit(new class extends Task {
      constructor() { super(ticks, false); }
      execute(): void {
        this.stop();
        const queued = player.getAttribute(MagicOnItemPacketListener.ALCH_QUEUED_ATTRIBUTE);
        player.setAttribute(MagicOnItemPacketListener.ALCH_QUEUED_ATTRIBUTE, null);
        if (!queued || !player.isRegistered?.() || player.getHitpoints?.() <= 0) {
          return;
        }
        if (player.getInventory().getItems()[queued.slot] !== queued.item) return;
        listener.castAlchemy(player, queued.spellId, queued.slot, queued.itemId, true, queued.source);
      }
    });
  }

  private confirmUntradeableAlchemy(player: any, spellId: number, slot: number, itemId: number, itemName: string, item: any, source?: unknown): void {
    const spellName = spellId === MagicOnItemPacketListener.HIGH_ALCH_SPELL_ID ? "High Level Alchemy" : "Low Level Alchemy";
    const warning = `That item cannot be traded.<br>Really cast ${spellName} on it?`;
    player.sendMessage(warning.replace("<br>", " "));
    const chain = new DialogueChainBuilder()
      .add(new ItemStatementDialogue(0, itemId, warning))
      .add(new OptionDialogue(1, {
        executeOption: (option: DialogueOption) => {
          player.getPacketSender().sendInterfaceRemoval();
          if ((option as number) === 1 && player.getInventory().getItems()[slot] === item)
            this.castAlchemy(player, spellId, slot, itemId, true, source);
        },
      }, `Proceed to cast ${spellName} on it.`, "Cancel the alchemy spell.").setTitle(itemName));
    player.getDialogueManager().startDialogues(chain);
  }

  private findVisibleGroundItem(player: any, groundItemId: number, x: number, y: number, z?: number): any | null {
    const candidates = World.getItems().filter((item) => {
      if (!item || item.isPendingRemoval?.()) {
        return false;
      }
      if (item.getItem?.().getId?.() !== groundItemId) {
        return false;
      }
      const position = item.getPosition?.();
      if (position?.getX?.() !== x || position?.getY?.() !== y) {
        return false;
      }
      if (z !== undefined && position.getZ?.() !== z) {
        return false;
      }
      if (item.getPrivateArea?.() !== player.getPrivateArea?.()) {
        return false;
      }
      if (!CrossFloor.visible(player.getLocation(), position, 64)) return false;
      if (item.getState?.() === State.SEEN_BY_PLAYER && item.getOwner?.() !== player.getUsername?.()) {
        return false;
      }
      return ItemOnGroundManager.canSee(player, item);
    });
    candidates.sort((a, b) => b.getPosition().getZ() - a.getPosition().getZ());
    return candidates[0] ?? null;
  }

  public castOnItem(player: any, spellId: number, itemId: number, slot: number, source?: unknown): boolean {
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
    this.castAlchemy(player, spellId, slot, itemId, false, source);
    return true;
  }

}
