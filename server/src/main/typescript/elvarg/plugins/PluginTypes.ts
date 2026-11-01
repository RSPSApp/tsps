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
  /** True only when login created a player because no saved account exists (or no save for this profile). */
  isNewAccount?: boolean;
  /** "main", or "league" for the league character chosen at login (persistence/PlayerProfile). */
  profile?: string;
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
    | { type: "report_abuse"; name: string; ruleId: number; mute: boolean }
    | { type: "chat"; text: string; messageType: "friends_chat" }
    | { type: "public_chat"; text: string; autoChat: boolean };
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

/** XP that just landed in a skill: after rates and the experience cap; not sent when refused, XP-locked or already at the cap. */
export interface PluginExperienceGainedEvent {
  player: any;
  skill: any;
  experience: number;
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
  option?: string;
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
  /** Additional blocked approach sides, in the object's unrotated local frame. */
  blockAccessFlags?: number;
}

export interface PluginWalkRouteEvent {
  player: any;
  destination: { x: number; y: number; z: number };
  handled: boolean;
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
  /** Inventory item used when the route was requested by item-on-NPC. */
  itemId?: number;
  /** A plugin-owned interaction that ignores the normal projectile clip within `range`. */
  ignoreProjectileClip?: boolean;
}

/**
 * An NPC's combat option (Attack), before normal combat starts. A plugin that handles it (a
 * player manning a boat cannon) sets `handled` and core combat doesn't start.
 */
export interface PluginNpcAttackOptionEvent {
  player: any;
  npc: any;
  npcId: number;
  clickType: number;
  handled: boolean;
}

/** A world entity (static ship or boat) menu option, such as Board or Attack. */
export interface PluginWorldEntityInteractionEvent {
  player: any;
  entityIndex: number;
  clickType: number;
  handled: boolean;
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

/** A hit about to land on a player; handlers may change `hit` (e.g. setTotalDamage) as for NPCs. */
export interface PluginPlayerHitModifyEvent {
  player: any;
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
  /**
   * A key only one live NPC may hold (a shared or instanced boss): while one holding it is
   * in the world, queued to join it or dying, spawning another returns null.
   */
  unique?: string;
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
  /**
   * Multiplies the gain after the world's rate (1 leaves it alone); a hook that sets a rate
   * multiplies what it finds, so several stack. A league profile's rate lives here.
   */
  multiplier: number;
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
  /** Show the message in a messagebox rather than the chatbox. */
  messageBox?: boolean;
}

export interface PluginSpecialAttackDisabledEvent {
  player: any;
  disabled: boolean | null;
  /** Shown to the player when disabled is true. */
  message?: string;
  /** Show the message in a messagebox rather than the chatbox. */
  messageBox?: boolean;
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
  /** Who asks: "open" (Bank.open), "deposit-box", or undefined for any other check. */
  source?: string;
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
  /** Whether the item is one the death keeps (protected), rather than one it loses. */
  kept: boolean;
  location: any;
  shouldDropItems: boolean;
  /** Whether core would create a normal floor item for this item. */
  dropEligible: boolean;
  /** Prevent the normal floor-item spawn without stopping later death-drop hooks. */
  suppressDefaultDrop: boolean;
  handled: boolean;
}

/**
 * Everything a death is about to lose, once, after the per-item `onPlayerDeathItemDrop` hooks
 * (also when that is nothing).
 * A plugin takes items by removing them from `items` (headed for the floor) or `untradeables`
 * (otherwise kept); whatever is left falls to the floor or is kept, as without the hook.
 */
export interface PluginPlayerDeathDropsEvent {
  player: any;
  killer: any;
  location: any;
  items: any[];
  untradeables: any[];
  /** Item ids per slot before the death emptied them (-1 for an empty slot). */
  layout: { inventory: number[]; equipment: number[] };
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
  /** Set false when the plugin says "Oh dear, you are dead!" itself (at the moment it chooses). */
  announce?: boolean;
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

/**
 * Raised once per attack to say how much the swing's animation holds the attacker
 * (Wiki: Animation stall). Core measures its length from the cache's seq config and starts it
 * `partial`: the client withholds the actor's steps while it plays, but the server keeps
 * walking the true tile, so they rubber-band once it ends. A plugin promotes a swing to `full`
 * (movement, input and incoming hits held) for content the seq config cannot express.
 */
export interface PluginAnimationStallEvent {
  player: any;
  /** The seq id the character just started playing; core has already measured it. */
  animationId: number;
  /** Ticks the client keeps it playing (cache frame lengths / 30), capped by core at 5. */
  ticks: number;
  kind: "none" | "partial" | "full";
  /** Stack incoming hits until the stall releases (false for a teleport, Wiki: Animation stall). */
  holdsHits: boolean;
}

/**
 * Asked for the ticks until an attacker's next attack, after the weapon's or spell's own speed
 * (and a special's) is known; handlers may change `speed` (a relic's magic speed). Never below 1.
 */
export interface PluginAttackSpeedEvent {
  attacker: any;
  target: any;
  combatType: any;
  speed: number;
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

/**
 * Fired once per hitsplat, after its accuracy and damage are rolled and before the damage is
 * capped to the target's hitpoints. Handlers may change `damage` (a HitDamage) and `accurate`,
 * which the hit then keeps (an effect that ignores the accuracy roll sets it).
 */
export interface PluginCombatHitDamageEvent {
  attacker: any;
  target: any;
  combatType: any;
  /** The PendingHit being rolled; its delay is the hit's flight time in ticks. */
  hit: any;
  damage: any;
  accurate: boolean;
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
  /**
   * Item on object only: run after every other handler, and only when none handled the use. For an
   * object's own refusal in place of "Nothing interesting happens." ("You can't cook that.").
   */
  fallback?: boolean;
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
  /**
   * The definition this player sees (the transform-resolved form, as NPC options get).
   * Match names on this: `target.getDefinition()` is the spawned parent, nameless for many
   * revision 241 NPCs such as the second Lumbridge banker.
   */
  definition?: any;
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

/** A combat spell aimed at a non-attackable NPC for a scripted interaction. */
export interface PluginSpellOnNpcEvent {
  player: any;
  npc: any;
  npcId: number;
  npcIndex: number;
  spell: any;
  spellId: number;
  location: { x: number; y: number; z: number };
  /** Consume validated runes/cooldown and play the accepted cast once. */
  consumeRunes: () => boolean;
  handled: boolean;
}

/** A spell cast from the spellbook on nothing: utility spells, self-casts, teleports. */
export interface PluginSpellCastEvent {
  player: any;
  /** Spellbook name of the cast spell, e.g. "Superglass Make". */
  spellName: string;
  spellWidget: number;
  spellItemId: number;
  /** The spellbook option clicked, from 1 ("Cast"); e.g. 2 is Varrock Teleport's "Grand Exchange". */
  opId?: number;
  handled: boolean;
}

export interface PluginSpellOnItemEvent {
  player: any;
  /** Spellbook name of the cast spell, e.g. "Lvl-1 Enchant"; undefined if the cache has none. */
  spellName: string | undefined;
  spellWidget: number;
  spellItemId: number;
  /** The inventory item the spell was cast on. */
  itemId: number;
  slot: number;
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
  /** Roll overrides that depend on the attacker at the swing; replaces `traits` there. */
  traitsFor?: (player: any) => Record<string, unknown> | undefined;
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
  /** Attributes registered hook/area timings to this label while retaining plugin ownership. */
  withProfileLabel(label: string): PluginApi;
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
   * only for `owner`, for instanced/quest spawns; `unique` keeps a boss single. The NPC
   * remembers the plugin that spawned it. Returns the NPC or null.
   */
  spawnNpc(definition: PluginNpcSpawnDefinition): any;
  removeNpc(npc: any): void;
  onPlayerLevelUp(handler: (event: PluginPlayerLevelUpEvent) => void): void;
  /** After XP lands in a skill (onCanGainExperience is the check before it). */
  onExperienceGained(handler: (event: PluginExperienceGainedEvent) => void): void;
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
  /**
   * How far from the player's boat (in tiles) these main-world locs can be used from its deck,
   * instead of the usual reach; clicks from further away get no answer (a Barracuda Trial's
   * outcrops, thrown at from 18 tiles off).
   */
  setDeckReach(objectIds: number[], tiles: number): void;
  /**
   * Main-world locs (by name, or by id) a player on a boat deck can use, within the deck's usual
   * reach (a dock's gangplank, a buoy, a charting spot). Any other land loc clicked from a deck:
   * "I can't do that from here!"; one too far off: "I can't reach that!", and the helm is kept.
   */
  setUsableFromDeck(namesOrIds: Array<string | number>): void;
  onWalkRoute(handler: (event: PluginWalkRouteEvent) => void): void;
  onObjectInteraction(handler: (event: PluginObjectInteractionEvent) => void): void;
  /** Exact, case-sensitive object name and option matching. Return false to fall through. */
  onObjectInteraction(
    objectName: string,
    actions: Record<string, (event: PluginObjectInteractionEvent) => void | boolean>
  ): void;
  /** Conditional interaction ownership before normal object handlers. Leave unclaimed events untouched. */
  onBeforeObjectInteraction(handler: (event: PluginObjectInteractionEvent) => void): void;
  onNpcInteraction(handler: (event: PluginNpcInteractionEvent) => void): void;
  /** Conditional interaction ownership before normal NPC handlers. Leave unclaimed events untouched. */
  onBeforeNpcInteraction(handler: (event: PluginNpcInteractionEvent) => void): void;
  /** An NPC's combat option, before normal combat starts; set `handled` to take it over. */
  onNpcAttackOption(handler: (event: PluginNpcAttackOptionEvent) => void): void;
  /** World entity (static ship/boat) options, by op number (1-6). */
  onWorldEntityInteraction(handler: (event: PluginWorldEntityInteractionEvent) => void): void;
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
  onPlayerHitModify(handler: (event: PluginPlayerHitModifyEvent) => void): void;
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
  onPlayerDeathDrops(handler: (event: PluginPlayerDeathDropsEvent) => void): void;
  onCanEquip(handler: (event: PluginCanEquipEvent) => void): void;
  onCanUseItem(handler: (event: PluginCanUseItemEvent) => void): void;
  onCanGainExperience(handler: (event: PluginCanGainExperienceEvent) => void): void;
  onCanSpawnNpc(handler: (event: PluginCanSpawnNpcEvent) => void): void;
  onCanStockItem(handler: (event: PluginCanStockItemEvent) => void): void;
  onPrayerDisabled(handler: (event: PluginPrayerDisabledEvent) => void): void;
  /** Refuse turning the special attack bar on (a duel or minigame rule); set `disabled` and a `message`. */
  onSpecialAttackDisabled(handler: (event: PluginSpecialAttackDisabledEvent) => void): void;
  onCanUnequip(handler: (event: PluginCanUnequipEvent) => void): void;
  onPlayerDeath(handler: (event: PluginPlayerDeathEvent) => void): void;
  onPlayerBeforeDeath(handler: (event: PluginPlayerBeforeDeathEvent) => void): void;
  onPlayerOption(handler: (event: PluginPlayerOptionEvent) => void): void;
  onPlayerDealtDamage(
    handler: (event: PluginPlayerDealtDamageEvent) => void
  ): void;
  onCombatHitRoll(handler: (event: PluginCombatHitRollEvent) => void): void;
  onCombatHitDamage(handler: (event: PluginCombatHitDamageEvent) => void): void;
  /** Lets an attack ignore the attack timer, or leave it untouched (see PluginAttackTimingEvent). */
  onAttackTiming(handler: (event: PluginAttackTimingEvent) => void): void;
  /** Says how much a swing's animation holds the attacker, if at all (see PluginAnimationStallEvent). */
  onAnimationStall(handler: (event: PluginAnimationStallEvent) => void): void;
  /** Lets a plugin change the ticks until the next attack (see PluginAttackSpeedEvent). */
  onAttackSpeed(handler: (event: PluginAttackSpeedEvent) => void): void;
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
  onSpellOnNpc(handler: (event: PluginSpellOnNpcEvent) => void): void;
  onSpellOnItem(handler: (event: PluginSpellOnItemEvent) => void): void;
  /** A spellbook spell cast on nothing, before the core spellbooks handle it. Set `handled` to own it. */
  onSpellCast(handler: (event: PluginSpellCastEvent) => void): void;
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
    options?: { name?: string; aliases?: string[]; unit?: string }
  ): void;
  /**
   * Save and restore this player attribute; values must be JSON-compatible.
   * With a default, a value equal to it isn't saved, and a save without the key loads it.
   */
  persistAttribute(key: string, defaultValue?: unknown): void;
  setPlayerPersistence(persistence: PlayerPersistence): void;
  setExperienceRate(rate: number): void;
  /**
   * Names the character profile every login on this world gets ("main" by default): a game mode
   * with characters of its own (Leagues) calls it from its plugin config at startup.
   */
  setWorldProfile(profile: "main" | "league"): void;
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
  emitCanBank(player: any, source?: string): boolean | null;
  emitCanBankItem(player: any, item: any): boolean | null;
  emitShouldKeepItemOnDeath(player: any, item: any): boolean | null;
  emitFiremakingBlocked(event: PluginFiremakingBlockedEvent): boolean;
  emitObjectInteraction(event: PluginObjectInteractionEvent): boolean;
  /** Runs the NPC option handlers as a click would (a bot fishing a spot). */
  emitNpcInteraction(event: PluginNpcInteractionEvent): boolean;
  emitWorldEntityInteraction(event: PluginWorldEntityInteractionEvent): boolean;
  emitNpcAttackOption(event: PluginNpcAttackOptionEvent): boolean;
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
  /**
   * Adds to the melee Strength prayer percentage (100 without a prayer, 123 with Piety), for
   * boosts the Wiki says stack additively with the prayers, like the Soulreaper axe's soul stacks.
   */
  registerMeleeStrengthPercentModifier(
    modifier: (entity: any, percent: number) => number
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
  /** Run energy spent per movement step; return 0 to skip the drain. */
  registerRunEnergyDrainModifier(
    modifier: (entity: any, amount: number) => number
  ): void;
  /** Ticks between special-attack restores; a rate-doubling effect halves this. */
  registerSpecialEnergyRestoreModifier(
    modifier: (entity: any, delayTicks: number) => number
  ): void;
  /** Special attack energy a special costs, checked and drained; return the cost. */
  registerSpecialEnergyCostModifier(
    modifier: (entity: any, cost: number) => number
  ): void;
  registerIncomingDamageModifier(
    modifier: (entity: any, hitDamage: any) => void
  ): void;
  /** Reduces an NPC/environmental Prayer drain; return the points actually drained. */
  registerPrayerDrainModifier(
    modifier: (entity: any, amount: number, context: any) => number
  ): void;
  /** Scales the drain effect a player's active prayers add each tick; return the new effect. */
  registerPrayerDrainRateModifier(
    modifier: (entity: any, drainEffect: number) => number
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
   * Makes an NPC menu option start a fight as "Attack" does, for every NPC that has it (the
   * Nightmare's totems' "Charge"): clicking it attacks, and spells can be cast on them.
   */
  registerNpcCombatOption(option: string): void;
  /**
   * Registers a combat method provider for one or more NPC IDs.
   * @param npcIds identifiers to bring under this method
   * @param methodCtor constructor for the combat method to instantiate; with `singleton: false`
   *   it is built for each attack and given the attacking NPC
   * @param options optional overrides (default to a singleton instance)
   */
  registerNpcCombatMethodProvider(
    npcIds: number | number[],
    methodCtor: new (npc?: any) => any,
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
  BonusManager: any;
  WeaponInterfaces: any;
  Barrows: any;
  applyPrayerDrainModifiers(entity: any, amount: number, context?: any): number;
  CombatEquipment: any;
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
  PrayerData: any;
  ItemActionPacketListener: any;
  /** Run shared item alchemy; plugins authorize opaque alternate payment sources via magic:alchemy-payment. */
  castAlchemy: (player: any, spellId: number | string, itemId: number, slot: number, source?: unknown) => boolean;
  ChatType: any;
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
  Inventory: any;
  PlayerStatus: any;
  Task: any;
  CountdownTask: any;
  ForceMovement: any;
  ForceMovementTask: any;
  TimedObjectReplacementTask: any;
  TaskManager: any;
  NPCRespawnTask: any;
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
  encodePluginMessage: typeof import("../net/protocol/ClientProtocol").encodePluginMessage;
  MOBILE_CLIENT_ATTRIBUTE: typeof import("../net/protocol/ClientProtocol").MOBILE_CLIENT_ATTRIBUTE;
  XPDROPS_ENABLED_ATTRIBUTE: typeof import("../net/protocol/ClientProtocol").XPDROPS_ENABLED_ATTRIBUTE;
  encodeGameframeBootstrap: typeof import("../net/protocol/ClientProtocol").encodeGameframeBootstrap;
  resolveGameframeRoot: typeof import("../net/protocol/ClientProtocol").resolveGameframeRoot;
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
  BoatManager: any;
  Sailing: any;
  BOAT_VIEW_DISTANCE: number;
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
  /** The death task; `getItemsToKeep(player)` is what a death would let the player keep. */
  PlayerDeathTask: any;
  /** Which items poison, and how strongly. */
  CombatPoisonData: any;
  CombatPoisonEffect: any;
  CacheDefinitions: any;
  encodeContentData: typeof import("../net/protocol/ClientProtocol").encodeContentData;
  CacheMaps: any;
  MapRegionReplacementManager: any;
  readTemplateRegion: typeof import("../game/collision/TemplateRegionData").readTemplateRegion;
  Wilderness: any;
  PathFinder: any;
  RsmodRouteFinding: any;
  NpcDefinition: any;
  NpcSpawnDefinition: any;
  ObjectDefinition: any;
  MagicSpellbook: any;
  ItemAliases: any;
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
  ShopDefinition: any;
  MultiChatboxPrompt: any;
  /** Public chat as a client sends it (filter, mute, broadcast): bots speak through it too. */
  ChatPacketListener: any;
  TradeState: any;
  dispatchClientMessages: (player: any, messages: any[]) => boolean;
  connectHeadlessClient: (username: string, password: string) => Promise<{ player?: any; error?: string }>;
  CachePipeline: typeof import("../game/cache/CachePipeline").CachePipeline;
  CacheIndexDat2: typeof import("../game/cache/codec/rs/cache/CacheIndex").CacheIndexDat2;
  encodeRebuildRegion: typeof import("../net/protocol/ClientProtocol").encodeRebuildRegion;
  encodeLocAddChange: typeof import("../net/protocol/ClientProtocol").encodeLocAddChange;
  encodeLocDel: typeof import("../net/protocol/ClientProtocol").encodeLocDel;
  getTemplateRegion: typeof import("../game/collision/TemplateRegionData").getTemplateRegion;
  templateChunkKey: typeof import("../game/collision/TemplateRegionData").templateChunkKey;
  rotateChunkLoc: typeof import("../game/model/areas/impl/TemplatedInstanceArea").rotateChunkLoc;
  rotateChunkTile: typeof import("../game/model/areas/impl/TemplatedInstanceArea").rotateChunkTile;
  PrivateChatStatus: typeof import("../game/model/PlayerRelations").PrivateChatStatus;
  SpellTeleports: typeof import("../game/content/combat/magic/SpellTeleports").SpellTeleports;
  LunarSpells: typeof import("../game/content/combat/magic/LunarSpells").LunarSpells;
  EffectSpells: typeof import("../game/content/combat/magic/EffectSpells").EffectSpells;
  ArceuusSpells: typeof import("../game/content/combat/magic/ArceuusSpells").ArceuusSpells;
  ArceuusOfferings: typeof import("../game/content/combat/magic/ArceuusOfferings");
}

export interface PluginModule {
  name: string;
  dependsOn?: string[];
  /** Members content: not loaded when world.json sets membersWorld false. */
  members?: boolean;
  /** False keeps the plugin off unless world.json `plugins` turns it on. */
  enabled?: boolean;
  register(api: PluginApi): void;
}
