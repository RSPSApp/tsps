import type { NpcDefinition } from "../game/definition/NpcDefinition";
import type { ObjectDefinition } from "../game/definition/ObjectDefinition";
import type { Item } from "../game/model/Item";
import type { WeaponCombatProfile } from "../game/content/combat/WeaponProfile";
import type { PlayerPersistence } from "../game/entity/impl/player/persistence/PlayerPersistence";
import type { ActiveRegionSnapshot } from "../game/ActiveRegionIndex";
import type { DefinitionSource } from "../game/definition/loader/DefinitionLoader";
import type { FriendsChatAction } from "../net/protocol/ClientProtocol";
import type { PlayerRights } from "../game/model/rights/PlayerRights";

/** A player entered a different 64x64 map square (or plane), by walking or teleporting. */
export interface PluginPlayerMapSquareChangeEvent {
  player: any;
  previous: any;
  location: any;
}

export interface PluginPlayerLoginEvent {
  player: any;
  username: string;
  /** True only when login created a player because no saved account exists. */
  isNewAccount?: boolean;
}

export interface PluginPlayerDisconnectEvent {
  player: any;
  username: string;
  source: string;
}

export interface PluginPlayerLogoutEvent {
  player: any;
  username: string;
}

export type PluginSocialPacketEvent = {
  player: any;
  handled: boolean;
  packet:
    | { type: "friends_chat_action"; action: FriendsChatAction }
    | { type: "private_message"; recipient: string; text: string }
    | { type: "chat_filter"; publicMode: number; privateMode: number; tradeMode: number }
    | { type: "chat"; text: string; messageType: "friends_chat" }
    | { type: "public_chat"; text: string };
};

export interface PluginServerLifecycleEvent {
  timestamp: number;
}

export interface PluginFriendEvent {
  player: any;
  other: any;
}

export interface PluginPlayerProcessEvent {
  player: any;
}

export interface PluginPlayerLevelUpEvent {
  player: any;
  skill: any;
  oldLevel: number;
  newLevel: number;
}

export type PluginCustomEventName = `${string}:${string}`;

export interface PluginRegionLoadedEvent {
  regionId: number;
  absX: number;
  absY: number;
}

export interface PluginActiveRegionsEvent extends ActiveRegionSnapshot {}

export interface PluginPathBlockedEvent {
  entity: any;
  isPlayer: boolean;
  username: string | null;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  basicPather: boolean;
  requestedSize: number;
  xLength: number;
  yLength: number;
  direction: number;
  blockingMask: number;
}

export interface PluginPlayerPathBlockedEvent extends PluginPathBlockedEvent {
  isPlayer: true;
  username: string;
}

export interface PluginObjectInteractionEvent {
  player: any;
  object: any;
  definition?: ObjectDefinition;
  objectId: number;
  clickType: number;
  location: { x: number; y: number; z: number };
  sourceLocation?: { x: number; y: number; z: number };
  handled: boolean;
}

export interface PluginObjectRouteEvent {
  player: any;
  object: any;
  definition?: ObjectDefinition;
  objectId: number;
  clickType: number;
  sourceLocation: { x: number; y: number; z: number };
  destination: { x: number; y: number; z: number } | null;
}

export interface PluginNpcInteractionEvent {
  player: any;
  npc: any;
  definition?: NpcDefinition;
  npcId: number;
  npcIndex: number;
  clickType: number;
  location: { x: number; y: number; z: number };
  handled: boolean;
}

export interface PluginNpcRouteEvent extends PluginNpcInteractionEvent {
  range: number;
}

/** Context handed to dialogue plugins when a Talk-to transcript is about to play. */
export interface PluginNpcDialogueContext {
  player: any;
  npc: any;
  npcId: number;
  definition?: NpcDefinition;
  /** Transcript pages registered for this NPC id, with the variant names each page offers. */
  pages: Array<{ page: string; variants: string[] }>;
}

/** A wiki prose condition the dialogue runtime needs a plugin to answer. */
export interface PluginNpcDialogueConditionEvent extends PluginNpcDialogueContext {
  /** The wiki prose, e.g. "If the player already has the necessary items:". */
  text: string;
  /** Anchor id of the condition step, when the export provides one. */
  stepId?: string;
}

export interface PluginNpcInteractionTeleportLocation {
  x: number;
  y: number;
  z?: number;
}

export type PluginNpcInteractionActionDefinition =
  | {
      shopId: number;
      teleportLocation?: never;
    }
  | {
      shopId?: never;
      teleportLocation: PluginNpcInteractionTeleportLocation;
    };

export interface PluginNpcInteractionDefinition {
  firstClick?: PluginNpcInteractionActionDefinition;
  secondClick?: PluginNpcInteractionActionDefinition;
  thirdClick?: PluginNpcInteractionActionDefinition;
  fourthClick?: PluginNpcInteractionActionDefinition;
}

export interface PluginNpcDeathEvent {
  killer: any;
  /** Every player who damaged the npc recently, the killer among them. */
  damagers?: any[];
  npc: any;
  npcId: number;
  location: { x: number; y: number; z: number };
  /**
   * Set by a handler to leave the npc in the world after it dies (an Ent's trunk): it stays
   * `ticks` ticks before it is removed, then respawns `respawnTicks` later (default: its
   * definition's respawn).
   */
  remains?: { ticks: number; respawnTicks?: number } | null;
}

/** Fired before an NPC enters its death task. Set preventDeath for phase changes. */
export interface PluginNpcBeforeDeathEvent {
  npc: any;
  preventDeath: boolean;
}

/**
 * Fired as an incoming hit resolves on an NPC, before damage is applied.
 * Handlers mutate the pending hit directly (damage, hitsplats).
 */
export interface PluginNpcHitModifyEvent {
  npc: any;
  hit: any;
}

/** Rectangular player zone for onZoneEnter/onZoneExit; omit `levels` for all planes. */
export interface PluginZone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  levels?: number[];
}

export interface PluginZoneEvent {
  player: any;
  zone: PluginZone;
}

export interface PluginNpcSpawnDefinition {
  id: number;
  x: number;
  y: number;
  z?: number;
  wanderRadius?: number;
  face?: number;
  owner?: any;
  /** Hide the NPC from everyone except `owner` (quest instances). */
  ownerOnly?: boolean;
}

export interface PluginCanAttackEvent {
  attacker: any;
  target: any;
  /** The attacking combat method, so handlers can allow/deny per style. */
  method?: any;
  allow: boolean | null;
}

export interface PluginCanTeleportEvent {
  player: any;
  wildernessLevelLimit?: number;
  /** Where the teleport lands, when the caller knows it. */
  destination?: any;
  allow: boolean | null;
}

/** Inventory item click, item-on-X use or spell-on-item; allow=false drops the packet. */
export interface PluginCanUseItemEvent {
  player: any;
  itemId: number;
  /** "action", "use", "magic", or "bonus" (worn item's stats being counted; no message expected). */
  action: string;
  /** The clicked menu option for "action" (e.g. "Drop", "Examine"). */
  option?: string;
  allow: boolean | null;
}

export interface PluginCanGainExperienceEvent {
  player: any;
  skill: any;
  experience: number;
  allow: boolean | null;
}

/** Fired per npc-spawns definition at load; allow=false skips the spawn. */
export interface PluginCanSpawnNpcEvent {
  npcId: number;
  location: any;
  allow: boolean | null;
}

/** Fired per shop stock entry at load; allow=false drops it from the shop. */
export interface PluginCanStockItemEvent {
  shopId: number;
  itemId: number;
  allow: boolean | null;
}

export interface PluginPrayerDisabledEvent {
  player: any;
  prayer: any;
  disabled: boolean | null;
  /** Shown to the player when disabled is true. */
  message?: string;
}

export interface PluginCanLogoutEvent {
  player: any;
  allow: boolean | null;
  /** Shown to the player when allow is false. */
  reason?: string;
}

export interface PluginCanEatEvent {
  player: any;
  itemId: number;
  allow: boolean | null;
}

export interface PluginFiremakingBlockedEvent {
  player: any;
  location: { x: number; y: number; z: number };
  reason: string;
  handled: boolean;
}

export interface PluginCanDrinkEvent {
  player: any;
  itemId: number;
  allow: boolean | null;
}

export interface PluginCanTradeEvent {
  player: any;
  target: any;
  allow: boolean | null;
}

/** Fires after a trade request passes basic validation (target alive/registered/in range), before the normal walk-and-request flow. Set handled=true to replace the default trade-request behavior entirely. */
export interface PluginTradeRequestEvent {
  player: any;
  target: any;
  handled: boolean;
}

/**
 * Fires once per player when a trade completes, after the offered items have
 * changed hands and before either player is saved. `received` and `given` are
 * the item stacks this player gained and handed over; mutating the player's
 * containers here (e.g. converting a bond to its untradeable form) is saved.
 */
export interface PluginTradeCompletedEvent {
  player: any;
  partner: any;
  received: any[];
  given: any[];
}

/** Fires after a player successfully starts following another player (right-click Follow). Observer only - the follow itself already happened. */
export interface PluginPlayerFollowEvent {
  player: any;
  leader: any;
}

/** Fires when a player initiates a player-vs-player attack (right-click Attack), after basic validation. Observer only. */
export interface PluginPlayerAttackEvent {
  player: any;
  target: any;
}

export interface PluginCanBankEvent {
  player: any;
  allow: boolean | null;
}

/** Called immediately before one item is deposited into a bank. */
export interface PluginCanBankItemEvent {
  player: any;
  item: any;
  allow: boolean | null;
}

export interface PluginCanShopEvent {
  player: any;
  shopId: number | null;
  allow: boolean | null;
}

export interface PluginShouldDropItemsOnDeathEvent {
  player: any;
  killer: any;
  shouldDrop: boolean | null;
}

export interface PluginShouldKeepItemOnDeathEvent {
  player: any;
  item: any;
  keep: boolean | null;
}

export interface PluginPlayerDeathItemDropEvent {
  player: any;
  killer: any;
  item: any;
  location: any;
  shouldDropItems: boolean;
  /** Whether core would create a normal floor item for this item. */
  dropEligible: boolean;
  /** Prevent the normal floor-item spawn without stopping later death-drop hooks. */
  suppressDefaultDrop: boolean;
  handled: boolean;
}

export interface PluginCanEquipEvent {
  player: any;
  slot: number;
  item: any;
  allow: boolean | null;
}

export interface PluginCanUnequipEvent {
  player: any;
  slot: number;
  item: any;
  allow: boolean | null;
}

export interface PluginPlayerDeathEvent {
  player: any;
  killer: any;
  /** Whether the player lost items (a dangerous death); false for a safe one (minigames). */
  itemsLost?: boolean;
  handled: boolean;
}

/** Fired before a player enters the death task. Set preventDeath to keep them alive (Tutorial Island). */
export interface PluginPlayerBeforeDeathEvent {
  player: any;
  preventDeath: boolean;
}

export interface PluginPlayerOptionEvent {
  player: any;
  target: any;
  option: number;
  handled: boolean;
}

export interface PluginPlayerDealtDamageEvent {
  player: any;
  target: any;
  hit: any;
}

/**
 * Asked before an attack: `ignoreDelay` lets it happen though the attacker's attack timer hasn't
 * run out, and `keepDelay` leaves that timer as it was afterwards (a boss's larvae that may be hit
 * on cooldown, some weapons adding no delay). `newTarget` says whether the target differs from the
 * attacker's last attacked one (a fresh click rather than a repeat). With `keepDelay`, `minimumDelay` still makes the
 * next attack wait at least that many ticks.
 */
export interface PluginAttackTimingEvent {
  attacker: any;
  target: any;
  method: any;
  ignoreDelay: boolean;
  keepDelay: boolean;
  minimumDelay?: number;
  newTarget: boolean;
}

export interface PluginCombatHitRollEvent {
  attacker: any;
  target: any;
  combatType: any;
  forceAccurate: boolean;
  /** Set to make an accurate roll land on the maximum hit. */
  forceMaxHit?: boolean;
  bypassProtectionPrayer: boolean;
}

/**
 * Fired whenever combat asks how far an attacker reaches. Handlers may lower or raise
 * `distance`; it never goes below 1. `manualCast` is a player's single click-cast spell.
 */
export interface PluginCombatAttackDistanceEvent {
  attacker: any;
  target: any;
  combatType: any;
  manualCast: boolean;
  distance: number;
}

export interface PluginCombatHitResolvedEvent {
  attacker: any;
  target: any;
  hit: any;
}

export interface PluginSpellDisabledEvent {
  player: any;
  spellbook: any;
  spellId: number;
  /** The Spell being cast, when the caller has it (e.g. spell.isMembers()). */
  spell?: any;
  disabled: boolean | null;
}

export interface PluginSpellRuneBypassEvent {
  player: any;
  spellbook: any;
  spellId: number;
  runeId?: number;
  bypass: boolean | null;
}

export interface PluginNpcAggressionToleranceEvent {
  player: any;
  npc: any;
  override: boolean | null;
}

export interface PluginPlayerDefeatedEvent {
  killer: any;
  victim: any;
}

/** Applies to every item involved, including an item or ground-item target. */
export interface PluginItemUseFilter {
  /** Omit to accept both noted and unnoted items. */
  noted?: boolean;
}

export interface PluginItemOnObjectEvent {
  player: any;
  object: any;
  objectId: number;
  item: any;
  itemId: number;
  itemSlot: number;
  interfaceType: number;
  location: { x: number; y: number; z: number };
  handled: boolean;
}

export interface PluginItemOnItemEvent {
  player: any;
  usedItem: any;
  usedItemId: number;
  usedItemSlot: number;
  usedWithItem: any;
  usedWithItemId: number;
  usedWithItemSlot: number;
  handled: boolean;
}

export interface PluginItemOnPlayerEvent {
  player: any;
  target: any;
  targetIndex: number;
  interfaceId: number;
  item: any;
  itemId: number;
  slot: number;
  handled: boolean;
}

export interface PluginItemOnNpcEvent {
  player: any;
  target: any;
  /** The target NPC's content id (its varbit-resolved cache variant), for quest id sets. */
  npcId: number;
  targetIndex: number;
  item: any;
  itemId: number;
  slot: number;
  interfaceId: number;
  handled: boolean;
}

export interface PluginSpellOnObjectEvent {
  player: any;
  object: any;
  objectId: number;
  spellWidget: number;
  spellChild: number;
  spellItemId: number;
  spellId: number;
  location: { x: number; y: number; z: number };
  handled: boolean;
}

export interface PluginItemOnGroundItemEvent {
  player: any;
  inventoryItem: any;
  inventoryItemId: number;
  groundItemId: number;
  location: { x: number; y: number; z: number };
  handled: boolean;
}

export interface PluginGroundItemInteractionEvent {
  player: any;
  groundItem: any;
  groundItemId: number;
  clickType: number;
  location: { x: number; y: number; z: number };
  handled: boolean;
}

export interface PluginItemActionEvent {
  player: any;
  interfaceId: number;
  item: any;
  itemId: number;
  slot: number;
  clickType: number;
  option?: string;
  subOpId?: number;
  handled: boolean;
}

export interface PluginItemDropEvent {
  player: any;
  interfaceId: number;
  item: any;
  itemId: number;
  slot: number;
  dropToGround: boolean;
  handled: boolean;
}

/** The lowest PlayerRights that may run a command; everyone at or above it passes. */
export type PluginCommandRights = PlayerRights;

export interface PluginCommandEvent {
  player: any;
  raw: string;
  base: string;
  parts: string[];
  handled: boolean;
}

export interface PluginButtonClickEvent {
  player: any;
  buttonId: number;
  handled: boolean;
}

export interface PluginInterfaceActionClickEvent {
  player: any;
  buttonId: number;
  action: number;
  opId?: number;
  groupId?: number;
  childId?: number;
  itemId?: number;
  slot?: number;
  option?: string;
  targetWidgetId?: number;
  targetSlot?: number;
  targetItemId?: number;
  sourceWidgetId?: number;
  sourceSlot?: number;
  sourceItemId?: number;
  argsData?: Buffer;
  /** Sent by a cache script (if_triggeroplocal) rather than a click; its arguments are in argsData. */
  scriptTrigger?: boolean;
  handled: boolean;
}

export interface PluginCombatEngine {
  getMethod(attacker: any): any;
  canReach(attacker: any, method: any, target: any): boolean;
  canAttack(attacker: any, method: any, target: any): any;
  addPendingHit(hit: any): void;
  executeHit(hit: any): void;
}

export interface PluginCombatMethodResolver {
  resolve(attacker: any): any | null;
}

export interface PluginCombatSpecialDefinition {
  id: string;
  itemIds: number[];
  drainAmount: number;
  strengthMultiplier: number;
  accuracyMultiplier: number;
  combatMethod: any;
  weaponInterface?: any;
  /** Open, plugin-owned data; core never interprets it. */
  metadata?: Record<string, unknown>;
  /** Roll overrides applied by core while this special is active. */
  traits?: Record<string, unknown>;
  /** Per-variant energy cost override, keyed by item id. */
  drainAmountByItemId?: Record<number, number>;
}

export interface PluginNpcCombatMethodProvider {
  provide(npc: any): any | null;
}
export interface PluginNpcCombatMethodProviderEntry {
  pluginName: string;
  provider: PluginNpcCombatMethodProvider;
  npcIds: Set<number>;
}
export interface PluginRegisteredNpcCombatMethodProvider {
  pluginName: string;
  provider: PluginNpcCombatMethodProvider;
  npcIds: Set<number>;
}

export interface PluginCombatDamageProvider {
  calculateMaxMeleeHit(entity: any): number;
  calculateMaxRangedHit(entity: any): number;
  calculateMagicMaxHit(entity: any): number;
  getHitDamage(attacker: any, victim: any, combatType: any): any;
  applyExtraHitRolls(
    attacker: any,
    target: any,
    combatType: any,
    damage: any,
    accurate: boolean,
    method: any
  ): void;
}

export interface PluginBonusEvent {
  player: any;
  bonuses: number[];
}

export interface PluginBonusProvider {
  apply(event: PluginBonusEvent): void;
}

export interface PluginRangedAmmoResolver {
  resolve(player: any): any | null;
}

export interface PluginRangedAmmoHandler {
  checkAmmo(player: any, amountRequired: number, silent?: boolean): boolean | null;
  /** `delayTicks`: the shot's flight time; floor drops and the count apply as it lands. */
  decrementAmmo(player: any, pos: any, amount: number, delayTicks?: number): boolean;
}

/** A container that can supply runes the inventory cannot, e.g. a rune pouch. */
export interface PluginSpellRuneSource {
  /** True when this source holds every item in `missingItems` in full. */
  check(player: any, missingItems: Item[]): boolean;
  /** Deducts `missingItems` from this source; only called after check() returned true. */
  consume(player: any, missingItems: Item[]): void;
}

/** A share of fired ammunition recovered before it lands, e.g. by an Ava's device. */
export interface PluginRangedAmmoRecovery {
  /** Percentage (0-100) recovered for this player, or null to fall through. */
  recovery(player: any): number | null;
}

export interface PluginRangedCombatModifier {
  modifyMaxHit(attacker: any, target: any, maxHit: number): number | null;
  modifyAttackRoll(attacker: any, target: any, attackRoll: number): number | null;
}

export interface PluginApi {
  onPlayerLogin(handler: (event: PluginPlayerLoginEvent) => void): void;
  /** Fires per map square crossed, not per tile: content spread over the map (patches, bird
   * houses) syncs here instead of checking every player every tick. */
  onPlayerMapSquareChange(handler: (event: PluginPlayerMapSquareChangeEvent) => void): void;
  onPlayerDisconnect(handler: (event: PluginPlayerDisconnectEvent) => void): void;
  onPlayerLogout(handler: (event: PluginPlayerLogoutEvent) => void): void;
  onSocialPacket(handler: (event: PluginSocialPacketEvent) => void): void;
  onServerStartup(handler: (event: PluginServerLifecycleEvent) => void): void;
  onServerShutdown(handler: (event: PluginServerLifecycleEvent) => void): void;
  onFriendAdd(handler: (event: PluginFriendEvent) => void): void;
  onFriendRemove(handler: (event: PluginFriendEvent) => void): void;
  onPlayerProcess(handler: (event: PluginPlayerProcessEvent) => void): void;
  /** Fires when a player enters a rectangular zone (levels omitted = all planes). */
  onZoneEnter(zone: PluginZone, handler: (event: PluginZoneEvent) => void): void;
  /** Fires when a player leaves a rectangular zone. */
  onZoneExit(zone: PluginZone, handler: (event: PluginZoneEvent) => void): void;
  /**
   * Spawns an NPC from a plugin. `ownerOnly` keeps it visible (and aggressive)
   * only for `owner`, for instanced/quest spawns. Returns the NPC or null.
   */
  spawnNpc(definition: PluginNpcSpawnDefinition): any;
  removeNpc(npc: any): void;
  onPlayerLevelUp(handler: (event: PluginPlayerLevelUpEvent) => void): void;
  /** Subscribes to an exact namespaced plugin event, such as `mining:success`. */
  onCustomEvent(
    eventName: PluginCustomEventName,
    handler: (payload: any) => void
  ): void;
  onRegionLoaded(handler: (event: PluginRegionLoadedEvent) => void): void;
  onActiveRegionsUpdated(handler: (event: PluginActiveRegionsEvent) => void): void;
  onPathBlocked(handler: (event: PluginPathBlockedEvent) => void): void;
  onPlayerPathBlocked(handler: (event: PluginPlayerPathBlockedEvent) => void): void;
  onObjectRoute(handler: (event: PluginObjectRouteEvent) => void): void;
  onObjectInteraction(handler: (event: PluginObjectInteractionEvent) => void): void;
  /** Exact, case-sensitive object name and option matching. Return false to fall through. */
  onObjectInteraction(
    objectName: string,
    actions: Record<string, (event: PluginObjectInteractionEvent) => void | boolean>
  ): void;
  onNpcInteraction(handler: (event: PluginNpcInteractionEvent) => void): void;
  /** Set a non-combat NPC option's approach range before movement starts. */
  onNpcRoute(handler: (event: PluginNpcRouteEvent) => void): void;
  /** Exact, case-sensitive NPC name and option matching. Return false to fall through. */
  onNpcInteraction(
    npcName: string,
    actions: Record<string, (event: PluginNpcInteractionEvent) => void | boolean>
  ): void;
  /**
   * Exact, case-sensitive option matching for a group of NPC names sharing one handler,
   * e.g. `onNpcsInteraction(["Niles", "Miles", "Giles"], { "Talk-to": talk })`.
   * Return false to fall through.
   */
  onNpcsInteraction(
    npcNames: string[],
    actions: Record<string, (event: PluginNpcInteractionEvent) => void | boolean>
  ): void;
  /** Exact, case-sensitive option matching for any NPC name. Return false to fall through. */
  onAnyNpcInteraction(
    actions: Record<string, (event: PluginNpcInteractionEvent) => void | boolean>
  ): void;
  /**
   * Pick which transcript variant a Talk-to should play, e.g. by quest stage.
   * Return a variant name (or `{ page, variant }`); null/undefined falls through.
   */
  onNpcDialogueVariant(
    handler: (event: PluginNpcDialogueContext) => string | { page?: string; variant: string } | null | undefined
  ): void;
  /**
   * Answer a wiki prose condition step. Return true/false to choose the branch,
   * or null/undefined to fall through (the runtime then defaults to the first branch).
   */
  onNpcDialogueCondition(
    handler: (event: PluginNpcDialogueConditionEvent) => boolean | null | undefined
  ): void;
  registerNpcInteraction(
    npcIds: number | number[],
    definition: PluginNpcInteractionDefinition
  ): void;
  onNpcDeath(handler: (event: PluginNpcDeathEvent) => void): void;
  onNpcBeforeDeath(handler: (event: PluginNpcBeforeDeathEvent) => void): void;
  onNpcHitModify(handler: (event: PluginNpcHitModifyEvent) => void): void;
  onCanAttack(handler: (event: PluginCanAttackEvent) => void): void;
  onCanTeleport(handler: (event: PluginCanTeleportEvent) => void): void;
  onCanLogout(handler: (event: PluginCanLogoutEvent) => void): void;
  onCanEat(handler: (event: PluginCanEatEvent) => void): void;
  onFiremakingBlocked(
    handler: (event: PluginFiremakingBlockedEvent) => void
  ): void;
  onCanDrink(handler: (event: PluginCanDrinkEvent) => void): void;
  onCanTrade(handler: (event: PluginCanTradeEvent) => void): void;
  onTradeRequest(handler: (event: PluginTradeRequestEvent) => void): void;
  onTradeCompleted(handler: (event: PluginTradeCompletedEvent) => void): void;
  onPlayerFollow(handler: (event: PluginPlayerFollowEvent) => void): void;
  onPlayerAttack(handler: (event: PluginPlayerAttackEvent) => void): void;
  onCanBank(handler: (event: PluginCanBankEvent) => void): void;
  onCanBankItem(handler: (event: PluginCanBankItemEvent) => void): void;
  onCanShop(handler: (event: PluginCanShopEvent) => void): void;
  onShouldDropItemsOnDeath(
    handler: (event: PluginShouldDropItemsOnDeathEvent) => void
  ): void;
  onShouldKeepItemOnDeath(
    handler: (event: PluginShouldKeepItemOnDeathEvent) => void
  ): void;
  onPlayerDeathItemDrop(
    handler: (event: PluginPlayerDeathItemDropEvent) => void
  ): void;
  onCanEquip(handler: (event: PluginCanEquipEvent) => void): void;
  onCanUseItem(handler: (event: PluginCanUseItemEvent) => void): void;
  onCanGainExperience(handler: (event: PluginCanGainExperienceEvent) => void): void;
  onCanSpawnNpc(handler: (event: PluginCanSpawnNpcEvent) => void): void;
  onCanStockItem(handler: (event: PluginCanStockItemEvent) => void): void;
  onPrayerDisabled(handler: (event: PluginPrayerDisabledEvent) => void): void;
  onCanUnequip(handler: (event: PluginCanUnequipEvent) => void): void;
  onPlayerDeath(handler: (event: PluginPlayerDeathEvent) => void): void;
  onPlayerBeforeDeath(handler: (event: PluginPlayerBeforeDeathEvent) => void): void;
  onPlayerOption(handler: (event: PluginPlayerOptionEvent) => void): void;
  onPlayerDealtDamage(
    handler: (event: PluginPlayerDealtDamageEvent) => void
  ): void;
  onCombatHitRoll(handler: (event: PluginCombatHitRollEvent) => void): void;
  /** Lets an attack ignore the attack timer, or leave it untouched (see PluginAttackTimingEvent). */
  onAttackTiming(handler: (event: PluginAttackTimingEvent) => void): void;
  onCombatHitResolved(handler: (event: PluginCombatHitResolvedEvent) => void): void;
  onCombatAttackDistance(handler: (event: PluginCombatAttackDistanceEvent) => void): void;
  onSpellDisabled(handler: (event: PluginSpellDisabledEvent) => void): void;
  onSpellRuneBypass(handler: (event: PluginSpellRuneBypassEvent) => void): void;
  onNpcAggressionTolerance(
    handler: (event: PluginNpcAggressionToleranceEvent) => void
  ): void;
  onPlayerDefeated(handler: (event: PluginPlayerDefeatedEvent) => void): void;
  onNpcClick(
    npcIds: number | number[],
    clickType: number,
    handler: (event: PluginNpcInteractionEvent) => void | boolean
  ): void;
  onNpcFirstClick(
    npcIds: number | number[],
    handler: (event: PluginNpcInteractionEvent) => void | boolean
  ): void;
  onNpcSecondClick(
    npcIds: number | number[],
    handler: (event: PluginNpcInteractionEvent) => void | boolean
  ): void;
  onNpcThirdClick(
    npcIds: number | number[],
    handler: (event: PluginNpcInteractionEvent) => void | boolean
  ): void;
  onNpcFourthClick(
    npcIds: number | number[],
    handler: (event: PluginNpcInteractionEvent) => void | boolean
  ): void;
  onGroundItemClick(
    itemIds: number | number[],
    clickType: number,
    handler: (event: PluginGroundItemInteractionEvent) => void | boolean
  ): void;
  onGroundItemPickup(handler: (event: PluginGroundItemInteractionEvent) => void | boolean): void;
  onGroundItemSecondClick(
    itemIds: number | number[],
    handler: (event: PluginGroundItemInteractionEvent) => void | boolean
  ): void;
  onItemOnObject(handler: (event: PluginItemOnObjectEvent) => void, filter?: PluginItemUseFilter): void;
  /** Matches exact item and object names. Return false to fall through. */
  onItemOnObject(itemName: string, objectName: string, handler: (event: PluginItemOnObjectEvent) => void | boolean, filter?: PluginItemUseFilter): void;
  onItemOnItem(handler: (event: PluginItemOnItemEvent) => void, filter?: PluginItemUseFilter): void;
  /** Matches exact item names in either order; event items retain their original order. */
  onItemOnItem(
    itemName: string,
    otherItemName: string,
    handler: (event: PluginItemOnItemEvent) => void | boolean,
    filter?: PluginItemUseFilter
  ): void;
  onItemOnPlayer(handler: (event: PluginItemOnPlayerEvent) => void, filter?: PluginItemUseFilter): void;
  onItemOnNpc(handler: (event: PluginItemOnNpcEvent) => void, filter?: PluginItemUseFilter): void;
  onItemOnGroundItem(handler: (event: PluginItemOnGroundItemEvent) => void, filter?: PluginItemUseFilter): void;
  onSpellOnObject(handler: (event: PluginSpellOnObjectEvent) => void): void;
  onItemAction(handler: (event: PluginItemActionEvent) => void): void;
  /** Exact item name and inventory option matching. Return false to fall through. */
  onItemAction(itemName: string, actions: Record<string, (event: PluginItemActionEvent) => void | boolean>): void;
  onItemDropPolicy(handler: (event: PluginItemDropEvent) => void): void;
  onItemFirstAction(
    handler: (event: PluginItemActionEvent) => void | boolean
  ): void;
  onButtonClick(handler: (event: PluginButtonClickEvent) => void): void;
  sendMultiChatboxPrompt(
    player: any,
    title: string,
    ...optionCallbackPairs: Array<
      string | ((player: any, optionIndex: number, optionText: string) => void)
    >
  ): boolean;
  /**
   * Reads an entry from world.json `pluginConfig` by key, e.g.
   * `getPluginConfig("TutorialIsland:allowSkip", true)`. Returns `defaultValue`
   * when the key is not set.
   */
  getPluginConfig<T = unknown>(key: string, defaultValue?: T): T;
  onButton(
    buttonIds: number | number[],
    handler: (event: PluginButtonClickEvent) => void | boolean
  ): void;
  onInterfaceActionClick(
    handler: (event: PluginInterfaceActionClickEvent) => void
  ): void;
  onInterfaceActionButton(
    buttonIds: number | number[],
    handler: (event: PluginInterfaceActionClickEvent) => void | boolean
  ): void;
  onCommand(handler: (event: PluginCommandEvent) => void): void;
  /**
   * Registers a command handler. `minimumRights` is the lowest rank that may run it -
   * the core denies everyone below before the handler is called, so handlers never
   * check rights themselves. Omitted means any player may run it.
   * `description` is shown and searched in the Commands interface.
   */
  registerCommand(
    command: string,
    handler: (event: PluginCommandEvent) => void | boolean,
    minimumRights?: PluginCommandRights,
    description?: string
  ): void;
  /** Registered commands this player can run, including world/plugin rank overrides. */
  getRegisteredCommands(player: any): Array<{ command: string; description: string }>;
  /**
   * Overrides the rank a command requires, whoever registered it. `PlayerRights.NONE`
   * opens the command to every player - e.g. a spawn-mode plugin granting ::items.
   */
  setCommandRights(command: string, minimumRights: PluginCommandRights): void;
  /**
   * Serves a read-only JSON resource at /api/<name> on the game port, for interface data
   * that is request/response shaped (searches, lists, lookups) rather than a game event.
   * Public and cache-derived only - anything player-specific belongs on the game socket.
   * `segments` holds any path after the resource name, e.g. ["30002"] for /api/foo/30002.
   */
  registerContentEndpoint(
    name: string,
    handler: (query: URLSearchParams, segments: string[]) => unknown
  ): void;
  /**
   * Defines an interface that does not exist in the cache. The definition is served at
   * /api/interfaces/<groupId>; the client fetches it the first time the interface is
   * opened, so opening one only needs the usual sub-interface packet.
   */
  registerCustomInterface(definition: {
    groupId: number;
    widgets: unknown[];
    [key: string]: unknown;
  }): void;
  onObjectClick(
    objectIds: number | number[],
    clickType: number,
    handler: (event: PluginObjectInteractionEvent) => void | boolean
  ): void;
  onObjectFirstClick(
    objectIds: number | number[],
    handler: (event: PluginObjectInteractionEvent) => void | boolean
  ): void;
  onObjectSecondClick(
    objectIds: number | number[],
    handler: (event: PluginObjectInteractionEvent) => void | boolean
  ): void;
  onObjectThirdClick(
    objectIds: number | number[],
    handler: (event: PluginObjectInteractionEvent) => void | boolean
  ): void;
  onObjectFourthClick(
    objectIds: number | number[],
    handler: (event: PluginObjectInteractionEvent) => void | boolean
  ): void;
  onObjectFifthClick(
    objectIds: number | number[],
    handler: (event: PluginObjectInteractionEvent) => void | boolean
  ): void;
  replaceMapRegion(
    regionId: number,
    source: string | [string, string]
  ): void;
  registerDefinitionSource(
    definitionType: string,
    source: DefinitionSource
  ): void;
  registerShopCurrency(
    name: string,
    handler: { amount(player: any): number; add(player: any, amount: number): void; remove(player: any, amount: number): void; name: string }
  ): void;
  /** Register an inventory item as a shop currency, keyed by its item name and optional aliases. */
  registerItemShopCurrency(
    itemId: number,
    options?: { name?: string; aliases?: string[] }
  ): void;
  /** Save and restore this player attribute; values must be JSON-compatible. */
  persistAttribute(key: string): void;
  setPlayerPersistence(persistence: PlayerPersistence): void;
  setExperienceRate(rate: number): void;
  getActiveRegionSnapshot(): PluginActiveRegionsEvent;
  log(message: string, extra?: Record<string, unknown>): void;
  /**
   * Core singleton accessors. These exist so plugins don't reach into
   * `src/main/typescript/elvarg/...` with relative requires. They return the
   * same static classes those requires would have, so this is a coupling
   * fix, not a capability change - see PluginApi doc comment for the
   * narrower-API follow-up.
   */
  /** Shared core classes/helpers so content plugins avoid core relative requires. */
  core: PluginCoreApi;
  getWorld(): any;
  getTaskManager(): any;
  getRegionManager(): any;
  getCombatFactory(): any;
  getAreaManager(): any;
  /** Adds an Area to AreaManager; its methods are timed and reported under this plugin. */
  registerArea(area: any): void;
  getPrayerHandler(): any;
  getBonusManager(): any;
  getItemOnGroundManager(): any;
  getObjectManager(): any;
  getServerPerf(): any;
  getSkillManager(): any;
  getPlayerPunishment(): any;
  /**
   * Cross-plugin hook queries: lets one plugin ask whether any other plugin's
   * registered hook (onCanEat, onObjectInteraction, etc.) would veto/handle an
   * action, without reaching into PluginManager directly.
   */
  emitCanEat(player: any, itemId: number): boolean | null;
  emitCanDrink(player: any, itemId: number): boolean | null;
  emitCanBank(player: any): boolean | null;
  emitCanBankItem(player: any, item: any): boolean | null;
  emitShouldKeepItemOnDeath(player: any, item: any): boolean | null;
  emitFiremakingBlocked(event: PluginFiremakingBlockedEvent): boolean;
  emitObjectInteraction(event: PluginObjectInteractionEvent): boolean;
  /** Runs the NPC option handlers as a click would (a bot fishing a spot). */
  emitNpcInteraction(event: PluginNpcInteractionEvent): boolean;
  /** Runs the item-on-object handlers as a use would (a bot cooking on a range). */
  emitItemOnObject(event: PluginItemOnObjectEvent): boolean;
  emitPlayerLogin(event: PluginPlayerLoginEvent): void;
  /** Dispatches synchronously; payloads are not queued or retained by the manager. */
  emitCustomEvent(
    eventName: PluginCustomEventName,
    payload: any
  ): void;
  getPluginPerformanceSnapshot(limit?: number): any[];
  resetPluginPerformanceStats(): void;
  setPluginPerformanceProfilingEnabled(enabled: boolean): void;
  isPluginPerformanceProfilingEnabled(): boolean;
  /** Adjusts effective levels after prayers/stance, before equipment bonuses and special multipliers. */
  registerCombatEffectiveLevelModifier(
    modifier: (entity: any, level: number, context: import("../game/content/combat/EquipmentEffects").CombatEffectiveLevelContext) => number
  ): void;
  registerMeleeHitModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerRangedHitModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerMagicHitModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  /**
   * Adds to the magic damage bonus, in tenths of a percent, before it scales the
   * spell's base max hit - for effects the Wiki counts as magic damage %, like the
   * salve amulet (i)'s 15% against the undead.
   */
  registerMagicDamageBonusModifier(
    modifier: (entity: any, permille: number) => number
  ): void;
  /**
   * Accuracy modifiers scale the finished attack roll - effective level times
   * (bonus + 64) - where the Wiki applies gear bonuses such as the salve amulet.
   */
  registerMeleeAttackAccuracyModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerMeleeDefenseModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerRangedDefenseModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerRangedAttackAccuracyModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerMagicAttackAccuracyModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerMagicDefenseModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerRunEnergyRestoreModifier(
    modifier: (entity: any, delayMs: number) => number
  ): void;
  registerIncomingDamageModifier(
    modifier: (entity: any, hitDamage: any) => void
  ): void;
  setCombatEngine(engine: PluginCombatEngine): void;
  setCombatDamageProvider(provider: PluginCombatDamageProvider): void;
  registerBonusProvider(provider: PluginBonusProvider): void;
  registerRangedAmmoResolver(resolver: PluginRangedAmmoResolver): void;
  registerRangedAmmoHandler(handler: PluginRangedAmmoHandler): void;
  registerRangedAmmoRecovery(recovery: PluginRangedAmmoRecovery): void;
  registerSpellRuneSource(source: PluginSpellRuneSource): void;
  registerRangedCombatModifier(modifier: PluginRangedCombatModifier): void;
  registerWeaponProfile(profile: WeaponCombatProfile): void;
  /**
   * Registers a weapon special attack. `id` is a stable plugin-chosen key (used by
   * core for the granite maul queued-attack path and by cross-plugin lookups).
   */
  registerCombatSpecial(definition: PluginCombatSpecialDefinition): void;
  registerCombatMethodResolver(resolver: PluginCombatMethodResolver): void;
  /**
   * Registers a combat method provider for one or more NPC IDs.
   * @param npcIds identifiers to bring under this method
   * @param methodCtor constructor for the combat method to instantiate
   * @param options optional overrides (default to a singleton instance)
   */
  registerNpcCombatMethodProvider(
    npcIds: number | number[],
    methodCtor: new () => any,
    options?: { singleton?: boolean }
  ): void;
}

/**
 * Core classes and static helpers exposed to plugins as a shared singleton
 * (`api.core`), so content plugins never need `src/main/typescript/elvarg` paths.
 * Typed as `any` on purpose: this is a deliberately thin, evolving surface.
 */
export interface PluginCoreApi {
  MeleeCombatMethod: any;
  RangedCombatMethod: any;
  MagicCombatMethod: any;
  CombatMethod: any;
  CombatSpecial: any;
  CombatFactory: any;
  CanAttackResponse: any;
  CombatType: any;
  SkullType: any;
  CombatConstants: any;
  DamageFormulas: any;
  AccuracyFormulasDpsCalc: any;
  PendingHit: any;
  HitDamage: any;
  HitMask: any;
  RangedWeapon: any;
  Ammunition: any;
  WeaponProfiles: any;
  FightStyle: any;
  WeaponInterfaceManager: any;
  PrayerHandler: any;
  DuelRule: any;
  RegionManager: any;
  Animation: any;
  Graphic: any;
  GraphicHeight: any;
  Priority: any;
  Projectile: any;
  Skill: any;
  Item: any;
  Flag: any;
  Direction: any;
  Equipment: any;
  Bank: any;
  Task: any;
  CountdownTask: any;
  ForceMovement: any;
  ForceMovementTask: any;
  TaskManager: any;
  ItemIdentifiers: any;
  ItemIds: any;
  NpcIdentifiers: any;
  ObjectIdentifiers: any;
  ShopIdentifiers: any;
  Misc: any;
  TimerKey: any;
  Sound: any;
  Sounds: any;
  Location: any;
  Mobile: any;
  encodeFinePosition: typeof import("../net/protocol/ClientProtocol").encodeFinePosition;
  Boundary: any;
  PolygonalBoundary: any;
  Area: any;
  ServerPerf: any;
  /** The ::pluginperf data: per-plugin hook and area timings, collected only while enabled. */
  PluginPerf: {
    snapshot(limit?: number): any[];
    reset(): void;
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;
  };
  World: any;
  GameObject: any;
  PrivateArea: any;
  TemplatedInstanceArea: any;
  ObjectManager: any;
  OperationType: any;
  LocModelType: any;
  MapObjects: any;
  ItemOnGroundManager: any;
  ItemDefinition: any;
  EquipPacketListener: any;
  CacheDefinitions: any;
  PathFinder: any;
  RsmodRouteFinding: any;
  NpcDefinition: any;
  ObjectDefinition: any;
  MagicSpellbook: any;
  Spell: any;
  CombatNormalSpell: any;
  CombatSpells: any;
  Autocasting: any;
  NPC: any;
  GameConstants: any;
  Music: any;
  WorldDefinition: any;
  TeleportHandler: any;
  TeleportType: any;
  DialogueChainBuilder: any;
  NpcDialogue: any;
  PlayerDialogue: any;
  OptionDialogue: any;
  StatementDialogue: any;
  ItemStatementDialogue: any;
  DoubleItemStatementDialogue: any;
  ActionDialogue: any;
  EndDialogue: any;
  CreationMenu: any;
  PlayerRights: any;
  Server: any;
  PluginManager: any;
  ShopManager: any;
  MultiChatboxPrompt: any;
  dispatchClientMessages: (player: any, messages: any[]) => boolean;
  connectHeadlessClient: (username: string, password: string) => Promise<{ player?: any; error?: string }>;
}

export interface PluginModule {
  name: string;
  dependsOn?: string[];
  /** Members content: not loaded when world.json sets membersWorld false. */
  members?: boolean;
  register(api: PluginApi): void;
}
