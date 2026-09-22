import type { NpcDefinition } from "../game/definition/NpcDefinition";
import type { ObjectDefinition } from "../game/definition/ObjectDefinition";
import type { WeaponCombatProfile } from "../game/content/combat/WeaponProfile";
import type { PlayerPersistence } from "../game/entity/impl/player/persistence/PlayerPersistence";
import type { ActiveRegionSnapshot } from "../game/ActiveRegionIndex";
import type { DefinitionSource } from "../game/definition/loader/DefinitionLoader";
import type { FriendsChatAction } from "../net/protocol/ClientProtocol";
import type { PlayerRights } from "../game/model/rights/PlayerRights";

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
    | { type: "chat"; text: string; messageType: "friends_chat" };
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
  npc: any;
  npcId: number;
  location: { x: number; y: number; z: number };
}

export interface PluginCanAttackEvent {
  attacker: any;
  target: any;
  allow: boolean | null;
}

export interface PluginCanTeleportEvent {
  player: any;
  wildernessLevelLimit?: number;
  allow: boolean | null;
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
  handled: boolean;
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

export interface PluginCombatHitRollEvent {
  attacker: any;
  target: any;
  combatType: any;
  forceAccurate: boolean;
  bypassProtectionPrayer: boolean;
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
  decrementAmmo(player: any, pos: any, amount: number): boolean;
}

export interface PluginRangedCombatModifier {
  modifyMaxHit(attacker: any, target: any, maxHit: number): number | null;
  modifyAttackRoll(attacker: any, target: any, attackRoll: number): number | null;
}

export interface PluginApi {
  onPlayerLogin(handler: (event: PluginPlayerLoginEvent) => void): void;
  onPlayerDisconnect(handler: (event: PluginPlayerDisconnectEvent) => void): void;
  onPlayerLogout(handler: (event: PluginPlayerLogoutEvent) => void): void;
  onSocialPacket(handler: (event: PluginSocialPacketEvent) => void): void;
  onServerStartup(handler: (event: PluginServerLifecycleEvent) => void): void;
  onServerShutdown(handler: (event: PluginServerLifecycleEvent) => void): void;
  onFriendAdd(handler: (event: PluginFriendEvent) => void): void;
  onFriendRemove(handler: (event: PluginFriendEvent) => void): void;
  onPlayerProcess(handler: (event: PluginPlayerProcessEvent) => void): void;
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
  /** Exact, case-sensitive NPC name and option matching. Return false to fall through. */
  onNpcInteraction(
    npcName: string,
    actions: Record<string, (event: PluginNpcInteractionEvent) => void | boolean>
  ): void;
  /** Exact, case-sensitive option matching for any NPC name. Return false to fall through. */
  onAnyNpcInteraction(
    actions: Record<string, (event: PluginNpcInteractionEvent) => void | boolean>
  ): void;
  registerNpcInteraction(
    npcIds: number | number[],
    definition: PluginNpcInteractionDefinition
  ): void;
  onNpcDeath(handler: (event: PluginNpcDeathEvent) => void): void;
  onCanAttack(handler: (event: PluginCanAttackEvent) => void): void;
  onCanTeleport(handler: (event: PluginCanTeleportEvent) => void): void;
  onCanEat(handler: (event: PluginCanEatEvent) => void): void;
  onFiremakingBlocked(
    handler: (event: PluginFiremakingBlockedEvent) => void
  ): void;
  onCanDrink(handler: (event: PluginCanDrinkEvent) => void): void;
  onCanTrade(handler: (event: PluginCanTradeEvent) => void): void;
  onTradeRequest(handler: (event: PluginTradeRequestEvent) => void): void;
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
  onCanUnequip(handler: (event: PluginCanUnequipEvent) => void): void;
  onPlayerDeath(handler: (event: PluginPlayerDeathEvent) => void): void;
  onPlayerOption(handler: (event: PluginPlayerOptionEvent) => void): void;
  onPlayerDealtDamage(
    handler: (event: PluginPlayerDealtDamageEvent) => void
  ): void;
  onCombatHitRoll(handler: (event: PluginCombatHitRollEvent) => void): void;
  onCombatHitResolved(handler: (event: PluginCombatHitResolvedEvent) => void): void;
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
   */
  registerCommand(
    command: string,
    handler: (event: PluginCommandEvent) => void | boolean,
    minimumRights?: PluginCommandRights
  ): void;
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
  getWorld(): any;
  getTaskManager(): any;
  getRegionManager(): any;
  getCombatFactory(): any;
  getAreaManager(): any;
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
  registerMeleeHitModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerRangedHitModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
  registerMagicHitModifier(
    modifier: (entity: any, baseHit: number) => number
  ): void;
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
  setCombatEngine(engine: PluginCombatEngine): void;
  setCombatDamageProvider(provider: PluginCombatDamageProvider): void;
  registerBonusProvider(provider: PluginBonusProvider): void;
  registerRangedAmmoResolver(resolver: PluginRangedAmmoResolver): void;
  registerRangedAmmoHandler(handler: PluginRangedAmmoHandler): void;
  registerRangedCombatModifier(modifier: PluginRangedCombatModifier): void;
  registerWeaponProfile(profile: WeaponCombatProfile): void;
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

export interface PluginModule {
  name: string;
  dependsOn?: string[];
  register(api: PluginApi): void;
}
