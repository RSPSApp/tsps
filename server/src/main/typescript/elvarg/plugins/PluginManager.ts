import { CacheDefinitions } from "../game/cache/CacheDefinitions";
import { ItemDefinition } from "../game/definition/ItemDefinition";
import { PlayerSave } from "../game/entity/impl/player/persistence/PlayerSave";
import { ContentApi } from "../net/http/ContentApi";
import { CustomInterfaceRegistry } from "../game/interfaces/CustomInterfaceRegistry";
import * as fs from "fs";
import * as path from "path";
import { GameConstants } from "../game/GameConstants";
import { isMembersWorld } from "../game/definition/WorldDefinition";
import { PlayerRights } from "../game/model/rights/PlayerRights";
import { MapRegionReplacementManager } from "../game/collision/MapRegionReplacementManager";
import { DefinitionLoader } from "../game/definition/loader/DefinitionLoader";
import { ShopManager } from "../game/model/container/shop/ShopManager";
import { WeaponProfiles } from "../game/content/combat/WeaponProfile";
import { CombatSpecial } from "../game/content/combat/CombatSpecial";
import { NpcInteractionDefinitionLoader } from "../game/definition/loader/impl/NpcInteractionDefinitionLoader";
import { NpcInteractionManager } from "../game/entity/impl/npc/NpcInteractionManager";
import { MultiChatboxPrompt } from "../game/model/menu/MultiChatboxPrompt";
import {
  PluginApi,
  PluginCanAttackEvent,
  PluginCanDrinkEvent,
  PluginCanEatEvent,
  PluginCanEquipEvent,
  PluginCanUseItemEvent,
  PluginCanGainExperienceEvent,
  PluginCanSpawnNpcEvent,
  PluginCanStockItemEvent,
  PluginPrayerDisabledEvent,
  PluginFiremakingBlockedEvent,
  PluginCanTeleportEvent,
  PluginCanLogoutEvent,
  PluginGroundItemInteractionEvent,
  PluginItemActionEvent,
  PluginModule,
  PluginItemOnGroundItemEvent,
  PluginItemOnItemEvent,
  PluginItemUseFilter,
  PluginItemOnNpcEvent,
  PluginItemOnPlayerEvent,
  PluginItemOnObjectEvent,
  PluginSpellOnObjectEvent,
  PluginNpcDeathEvent,
  PluginNpcBeforeDeathEvent,
  PluginNpcHitModifyEvent,
  PluginNpcAggressionToleranceEvent,
  PluginNpcInteractionEvent,
  PluginNpcInteractionDefinition,
  PluginNpcDialogueContext,
  PluginNpcDialogueConditionEvent,
  PluginZone,
  PluginZoneEvent,
  PluginNpcSpawnDefinition,
  PluginObjectRouteEvent,
  PluginNpcRouteEvent,
  PluginObjectInteractionEvent,
  PluginPlayerDefeatedEvent,
  PluginPathBlockedEvent,
  PluginPlayerProcessEvent,
  PluginPlayerLevelUpEvent,
  PluginCustomEventName,
  PluginPlayerPathBlockedEvent,
  PluginCommandEvent,
  PluginCommandRights,
  PluginActiveRegionsEvent,
  PluginPlayerDisconnectEvent,
  PluginPlayerLoginEvent,
  PluginPlayerMapSquareChangeEvent,
  PluginServerLifecycleEvent,
  PluginFriendEvent,
  PluginRegionLoadedEvent,
  PluginSpellDisabledEvent,
  PluginSpellRuneBypassEvent,
  PluginCanTradeEvent,
  PluginTradeRequestEvent,
  PluginTradeCompletedEvent,
  PluginPlayerFollowEvent,
  PluginPlayerAttackEvent,
  PluginCanBankEvent,
  PluginCanBankItemEvent,
  PluginCanShopEvent,
  PluginShouldDropItemsOnDeathEvent,
  PluginShouldKeepItemOnDeathEvent,
  PluginPlayerDeathItemDropEvent,
  PluginPlayerDeathEvent,
  PluginPlayerOptionEvent,
  PluginPlayerDealtDamageEvent,
  PluginCombatHitRollEvent,
  PluginAttackTimingEvent,
  PluginCombatHitResolvedEvent,
  PluginCombatAttackDistanceEvent,
  PluginCanUnequipEvent,
  PluginCombatDamageProvider,
  PluginCombatEngine,
  PluginCombatMethodResolver,
  PluginCombatSpecialDefinition,
  PluginCoreApi,
  PluginItemDropEvent,
  PluginButtonClickEvent,
  PluginInterfaceActionClickEvent,
  PluginBonusEvent,
  PluginBonusProvider,
  PluginRangedAmmoHandler,
  PluginRangedAmmoResolver,
  PluginRangedAmmoRecovery,
  PluginRangedCombatModifier,
  PluginSpellRuneSource,
  PluginNpcCombatMethodProvider,
  PluginNpcCombatMethodProviderEntry,
  PluginPlayerLogoutEvent,
  PluginSocialPacketEvent,
} from "./PluginTypes";

type PluginHook<T> = {
  pluginName: string;
  handler: (event: T) => void;
};

function normalizePluginName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pluginNameFromFile(pluginPath: string): string {
  return path.basename(pluginPath).replace(/\.plugin\.js$/i, "");
}

function isPluginCustomEventName(value: unknown): value is PluginCustomEventName {
  return typeof value === "string" && /^[^:\s]+:[^:\s]+$/.test(value);
}

type PluginLoadCandidate = {
  pluginPath: string;
  plugin: PluginModule;
  pluginName: string;
  dependsOn: string[];
};

type PluginPerfEventStat = {
  calls: number;
  errors: number;
  totalNs: bigint;
  maxNs: bigint;
  recentDurationsNs: bigint[];
};

type PluginPerfStat = {
  calls: number;
  errors: number;
  totalNs: bigint;
  maxNs: bigint;
  events: Map<string, PluginPerfEventStat>;
};

type ObjectInteractionHook = PluginHook<PluginObjectInteractionEvent> & { order: number };

/** PlayerRights names world.json "commands:permissions" accepts, mapped to their rights ids. */
const COMMAND_PERMISSION_RIGHTS: Record<string, number> = {
  NONE: PlayerRights.NONE.getId(),
  MODERATOR: PlayerRights.MODERATOR.getId(),
  ADMINISTRATOR: PlayerRights.ADMINISTRATOR.getId(),
  OWNER: PlayerRights.OWNER.getId(),
  DEVELOPER: PlayerRights.DEVELOPER.getId(),
};

export class PluginManager {
  private static readonly PERF_EVENT_SAMPLE_LIMIT = 128;
  private static readonly MAX_PLUGIN_DEPTH = 2;
  private static initialized = false;
  private static loadedPlugins: string[] = [];
  private static lastPersistenceOverride: string | null = null;
  private static loginHooks: PluginHook<PluginPlayerLoginEvent>[] = [];
  private static mapSquareChangeHooks: PluginHook<PluginPlayerMapSquareChangeEvent>[] = [];
  private static disconnectHooks: PluginHook<PluginPlayerDisconnectEvent>[] = [];
  private static logoutHooks: PluginHook<PluginPlayerLogoutEvent>[] = [];
  private static socialPacketHooks: PluginHook<PluginSocialPacketEvent>[] = [];
  private static serverStartupHooks: PluginHook<PluginServerLifecycleEvent>[] = [];
  private static serverShutdownHooks: PluginHook<PluginServerLifecycleEvent>[] = [];
  private static friendAddHooks: PluginHook<PluginFriendEvent>[] = [];
  private static friendRemoveHooks: PluginHook<PluginFriendEvent>[] = [];
  private static playerProcessHooks: PluginHook<PluginPlayerProcessEvent>[] = [];
  private static playerLevelUpHooks: PluginHook<PluginPlayerLevelUpEvent>[] = [];
  private static customEventHooks = new Map<
    PluginCustomEventName,
    PluginHook<any>[]
  >();
  private static regionLoadedHooks: PluginHook<PluginRegionLoadedEvent>[] = [];
  private static activeRegionsHooks: PluginHook<PluginActiveRegionsEvent>[] = [];
  private static pathBlockedHooks: PluginHook<PluginPathBlockedEvent>[] = [];
  private static objectRouteHooks: PluginHook<PluginObjectRouteEvent>[] = [];
  private static npcRouteHooks: PluginHook<PluginNpcRouteEvent>[] = [];
  private static objectInteractionHooks: ObjectInteractionHook[] = [];
  private static objectHooksById = new Map<string, ObjectInteractionHook[]>();
  private static objectHooksByName = new Map<string, ObjectInteractionHook[]>();
  private static nextObjectHookOrder = 0;
  private static npcInteractionHooks: PluginHook<PluginNpcInteractionEvent>[] = [];
  /**
   * `onAnyNpcInteraction` hooks. Kept apart from the id/name hooks so a generic
   * transcript handler (e.g. NpcDialogues) never outruns a specific plugin that
   * owns that NPC, regardless of plugin load order.
   */
  private static npcAnyInteractionHooks: PluginHook<PluginNpcInteractionEvent>[] = [];
  private static npcDialogueVariantHooks: Array<{
    pluginName: string;
    handler: (event: PluginNpcDialogueContext) => string | { page?: string; variant: string } | null | undefined;
  }> = [];
  private static npcDialogueConditionHooks: Array<{
    pluginName: string;
    handler: (event: PluginNpcDialogueConditionEvent) => boolean | null | undefined;
  }> = [];
  private static npcDeathHooks: PluginHook<PluginNpcDeathEvent>[] = [];
  private static npcBeforeDeathHooks: PluginHook<PluginNpcBeforeDeathEvent>[] = [];
  private static npcHitModifyHooks: PluginHook<PluginNpcHitModifyEvent>[] = [];
  private static zoneHooks: Array<{
    pluginName: string;
    zone: PluginZone;
    onEnter?: (event: PluginZoneEvent) => void;
    onExit?: (event: PluginZoneEvent) => void;
  }> = [];
  private static activeZonesByPlayer = new WeakMap<any, Set<number>>();
  private static canAttackHooks: PluginHook<PluginCanAttackEvent>[] = [];
  private static canTeleportHooks: PluginHook<PluginCanTeleportEvent>[] = [];
  private static canLogoutHooks: PluginHook<PluginCanLogoutEvent>[] = [];
  private static canEatHooks: PluginHook<PluginCanEatEvent>[] = [];
  private static firemakingBlockedHooks: PluginHook<PluginFiremakingBlockedEvent>[] = [];
  private static canDrinkHooks: PluginHook<PluginCanDrinkEvent>[] = [];
  private static canTradeHooks: PluginHook<PluginCanTradeEvent>[] = [];
  private static tradeRequestHooks: PluginHook<PluginTradeRequestEvent>[] = [];
  private static tradeCompletedHooks: PluginHook<PluginTradeCompletedEvent>[] = [];
  private static playerFollowHooks: PluginHook<PluginPlayerFollowEvent>[] = [];
  private static playerAttackHooks: PluginHook<PluginPlayerAttackEvent>[] = [];
  private static canBankHooks: PluginHook<PluginCanBankEvent>[] = [];
  private static canBankItemHooks: PluginHook<PluginCanBankItemEvent>[] = [];
  private static canShopHooks: PluginHook<PluginCanShopEvent>[] = [];
  private static shouldDropItemsOnDeathHooks: PluginHook<PluginShouldDropItemsOnDeathEvent>[] = [];
  private static shouldKeepItemOnDeathHooks: PluginHook<PluginShouldKeepItemOnDeathEvent>[] = [];
  private static playerDeathItemDropHooks: PluginHook<PluginPlayerDeathItemDropEvent>[] = [];
  private static canEquipHooks: PluginHook<PluginCanEquipEvent>[] = [];
  private static canUseItemHooks: PluginHook<PluginCanUseItemEvent>[] = [];
  private static canGainExperienceHooks: PluginHook<PluginCanGainExperienceEvent>[] = [];
  private static canSpawnNpcHooks: PluginHook<PluginCanSpawnNpcEvent>[] = [];
  private static canStockItemHooks: PluginHook<PluginCanStockItemEvent>[] = [];
  private static prayerDisabledHooks: PluginHook<PluginPrayerDisabledEvent>[] = [];
  private static canUnequipHooks: PluginHook<PluginCanUnequipEvent>[] = [];
  private static playerDeathHooks: PluginHook<PluginPlayerDeathEvent>[] = [];
  private static playerOptionHooks: PluginHook<PluginPlayerOptionEvent>[] = [];
  private static playerDealtDamageHooks: PluginHook<PluginPlayerDealtDamageEvent>[] = [];
  private static combatHitRollHooks: PluginHook<PluginCombatHitRollEvent>[] = [];
  private static attackTimingHooks: PluginHook<PluginAttackTimingEvent>[] = [];
  private static combatHitResolvedHooks: PluginHook<PluginCombatHitResolvedEvent>[] = [];
  private static combatAttackDistanceHooks: PluginHook<PluginCombatAttackDistanceEvent>[] = [];
  private static spellDisabledHooks: PluginHook<PluginSpellDisabledEvent>[] = [];
  private static spellRuneBypassHooks: PluginHook<PluginSpellRuneBypassEvent>[] = [];
  private static npcAggressionToleranceHooks: PluginHook<PluginNpcAggressionToleranceEvent>[] = [];
  private static playerDefeatedHooks: PluginHook<PluginPlayerDefeatedEvent>[] = [];
  private static itemOnObjectHooks: PluginHook<PluginItemOnObjectEvent>[] = [];
  private static itemOnItemHooks: PluginHook<PluginItemOnItemEvent>[] = [];
  private static itemOnNpcHooks: PluginHook<PluginItemOnNpcEvent>[] = [];
  private static itemOnPlayerHooks: PluginHook<PluginItemOnPlayerEvent>[] = [];
  private static itemOnGroundItemHooks: PluginHook<PluginItemOnGroundItemEvent>[] =
    [];
  private static spellOnObjectHooks: PluginHook<PluginSpellOnObjectEvent>[] = [];
  private static groundItemInteractionHooks: PluginHook<PluginGroundItemInteractionEvent>[] =
    [];
  private static groundItemPickupHooks: PluginHook<PluginGroundItemInteractionEvent>[] = [];
  private static itemActionHooks: PluginHook<PluginItemActionEvent>[] = [];
  private static itemDropHooks: PluginHook<PluginItemDropEvent>[] = [];
  private static buttonClickHooks: PluginHook<PluginButtonClickEvent>[] = [];
  private static interfaceActionClickHooks: PluginHook<PluginInterfaceActionClickEvent>[] =
    [];
  private static commandHooks: PluginHook<PluginCommandEvent>[] = [];
  private static commandHandlersByBase = new Map<
    string,
    (PluginHook<PluginCommandEvent> & { description: string })[]
  >();
  /** Lowest rights id each command was registered with. Null means anyone may run it. */
  private static commandRights = new Map<string, number | null>();
  /** Lowest rights id a plugin has overridden a command to, taking priority over registration. */
  private static commandRightsOverrides = new Map<string, number | null>();
  private static commandPermissionsCache: Map<string, number> | null = null;
  private static combatEngine: PluginCombatEngine | null = null;
  private static combatEngineOwner: string | null = null;
  private static combatDamageProvider: PluginCombatDamageProvider | null = null;
  private static combatDamageProviderOwner: string | null = null;
  private static bonusProviders: Array<{ pluginName: string; provider: PluginBonusProvider }> = [];
  private static rangedAmmoResolvers: Array<{ pluginName: string; resolver: PluginRangedAmmoResolver }> = [];
  private static rangedAmmoHandlers: Array<{ pluginName: string; handler: PluginRangedAmmoHandler }> = [];
  private static rangedAmmoRecoveries: Array<{ pluginName: string; recovery: PluginRangedAmmoRecovery }> = [];
  private static spellRuneSources: Array<{ pluginName: string; source: PluginSpellRuneSource }> = [];
  private static rangedCombatModifiers: Array<{ pluginName: string; modifier: PluginRangedCombatModifier }> = [];
  private static combatMethodResolvers: PluginCombatMethodResolver[] = [];
  private static npcCombatMethodProviders: PluginNpcCombatMethodProviderEntry[] = [];
  private static pluginPerfEnabled = false;
  private static pluginPerfStats = new Map<string, PluginPerfStat>();
  private static pluginCoreApi: PluginCoreApi | null = null;
  private static pluginConfigCache: Record<string, unknown> | null = null;

  private static executeHook<T>(
    hook: PluginHook<T>,
    event: T,
    errorLabel: string,
    profileEventName: string
  ): void {
    if (!PluginManager.pluginPerfEnabled) {
      try {
        hook.handler(event);
      } catch (err) {
        console.error(`[plugins] ${errorLabel} hook failed (${hook.pluginName})`, err);
      }
      return;
    }

    const start = process.hrtime.bigint();
    let failed = false;
    try {
      hook.handler(event);
    } catch (err) {
      failed = true;
      console.error(`[plugins] ${errorLabel} hook failed (${hook.pluginName})`, err);
    } finally {
      PluginManager.recordHookTiming(
        hook.pluginName,
        profileEventName,
        process.hrtime.bigint() - start,
        failed
      );
    }
  }

  /**
   * Runs one Area method the way hooks run: timed under pluginperf against the plugin that
   * registered the area, and a throw is logged instead of escaping into the actor's tick
   * (which logs a player out). Fixed args rather than a closure: this sits on per-pair paths.
   */
  public static callArea(area: any, method: string, a?: any, b?: any, c?: any): any {
    if (!PluginManager.pluginPerfEnabled) {
      try {
        return area[method](a, b, c);
      } catch (err) {
        console.error(`[plugins] area ${method} failed (${area.pluginName ?? area.getName()})`, err);
        return null;
      }
    }

    const start = process.hrtime.bigint();
    let failed = false;
    try {
      return area[method](a, b, c);
    } catch (err) {
      failed = true;
      console.error(`[plugins] area ${method} failed (${area.pluginName ?? area.getName()})`, err);
      return null;
    } finally {
      PluginManager.recordHookTiming(
        area.pluginName ?? area.getName(),
        `area:${method}`,
        process.hrtime.bigint() - start,
        failed
      );
    }
  }

  private static recordHookTiming(
    pluginName: string,
    eventName: string,
    durationNs: bigint,
    failed: boolean
  ): void {
    let pluginStat = PluginManager.pluginPerfStats.get(pluginName);
    if (!pluginStat) {
      pluginStat = {
        calls: 0,
        errors: 0,
        totalNs: 0n,
        maxNs: 0n,
        events: new Map<string, PluginPerfEventStat>(),
      };
      PluginManager.pluginPerfStats.set(pluginName, pluginStat);
    }

    pluginStat.calls++;
    pluginStat.totalNs += durationNs;
    if (durationNs > pluginStat.maxNs) {
      pluginStat.maxNs = durationNs;
    }
    if (failed) {
      pluginStat.errors++;
    }

    let eventStat = pluginStat.events.get(eventName);
    if (!eventStat) {
      eventStat = {
        calls: 0,
        errors: 0,
        totalNs: 0n,
        maxNs: 0n,
        recentDurationsNs: [],
      };
      pluginStat.events.set(eventName, eventStat);
    }
    eventStat.calls++;
    eventStat.totalNs += durationNs;
    if (durationNs > eventStat.maxNs) {
      eventStat.maxNs = durationNs;
    }
    if (failed) {
      eventStat.errors++;
    }
    PluginManager.pushPerfDurationSample(eventStat.recentDurationsNs, durationNs);
  }

  private static pushPerfDurationSample(samples: bigint[], durationNs: bigint): void {
    if (!Array.isArray(samples)) {
      return;
    }
    if (samples.length >= PluginManager.PERF_EVENT_SAMPLE_LIMIT) {
      samples.shift();
    }
    samples.push(durationNs);
  }

  private static computePercentileNs(samples: bigint[], percentile: number): bigint {
    if (!Array.isArray(samples) || samples.length === 0) {
      return 0n;
    }
    const normalized = Number.isFinite(percentile)
      ? Math.min(1, Math.max(0, percentile))
      : 0.95;
    const sorted = [...samples].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const rank = Math.ceil(normalized * sorted.length) - 1;
    const index = Math.min(sorted.length - 1, Math.max(0, rank));
    return sorted[index] ?? 0n;
  }

  public static setPluginPerformanceProfilingEnabled(enabled: boolean): void {
    PluginManager.pluginPerfEnabled = enabled === true;
  }

  public static isPluginPerformanceProfilingEnabled(): boolean {
    return PluginManager.pluginPerfEnabled;
  }

  public static resetPluginPerformanceStats(): void {
    PluginManager.pluginPerfStats.clear();
  }

  public static getPluginPerformanceSnapshot(limit = 10): Array<{
    pluginName: string;
    calls: number;
    errors: number;
    totalMs: number;
    avgMs: number;
    maxMs: number;
    topEventName: string;
    topEventCalls: number;
    topEventTotalMs: number;
    topEventAvgMs: number;
    topEventP95Ms: number;
  }> {
    const rows: Array<{
      pluginName: string;
      calls: number;
      errors: number;
      totalMs: number;
      avgMs: number;
      maxMs: number;
      topEventName: string;
      topEventCalls: number;
      topEventTotalMs: number;
      topEventAvgMs: number;
      topEventP95Ms: number;
    }> = [];

    for (const [pluginName, stat] of PluginManager.pluginPerfStats.entries()) {
      let topEventName = "n/a";
      let topEventStat: PluginPerfEventStat | null = null;
      let topEventTotalNs = 0n;
      let topEventCalls = 0;
      for (const [eventName, eventStat] of stat.events.entries()) {
        if (eventStat.totalNs > topEventTotalNs) {
          topEventName = eventName;
          topEventStat = eventStat;
          topEventTotalNs = eventStat.totalNs;
          topEventCalls = eventStat.calls;
        }
      }

      const totalMs = Number(stat.totalNs) / 1_000_000;
      rows.push({
        pluginName,
        calls: stat.calls,
        errors: stat.errors,
        totalMs,
        avgMs: stat.calls > 0 ? totalMs / stat.calls : 0,
        maxMs: Number(stat.maxNs) / 1_000_000,
        topEventName,
        topEventCalls,
        topEventTotalMs: Number(topEventTotalNs) / 1_000_000,
        topEventAvgMs:
          topEventCalls > 0
            ? Number(topEventTotalNs) / 1_000_000 / topEventCalls
            : 0,
        topEventP95Ms:
          topEventStat && topEventStat.recentDurationsNs.length > 0
            ? Number(
                PluginManager.computePercentileNs(
                  topEventStat.recentDurationsNs,
                  0.95
                )
              ) / 1_000_000
            : 0,
      });
    }

    rows.sort((a, b) => b.totalMs - a.totalMs);
    return rows.slice(0, Math.max(1, limit));
  }

  public static loadFromDirectory(
    pluginDirectory = path.join(process.cwd(), "plugins")
  ): void {
    if (PluginManager.initialized) {
      return;
    }
    PluginManager.initialized = true;

    if (
      !fs.existsSync(pluginDirectory) ||
      !fs.statSync(pluginDirectory).isDirectory()
    ) {
      console.info(
        `[plugins] directory not found at ${pluginDirectory}; continuing without plugins`
      );
      return;
    }

    const pluginFiles = PluginManager.discoverPluginFiles(
      pluginDirectory,
      PluginManager.MAX_PLUGIN_DEPTH
    );

    if (pluginFiles.length === 0) {
      console.info(
        `[plugins] no plugin files found in ${pluginDirectory} (max depth ${PluginManager.MAX_PLUGIN_DEPTH})`
      );
      return;
    }

    const disablePlayerBots =
      process.argv.includes("--disablePlayerBots") ||
      process.env.DISABLE_PLAYER_BOTS === "1";

    let disabledCount = 0;
    const filteredPluginFiles = pluginFiles.filter((pluginPath) => {
      if (
        disablePlayerBots &&
        pluginPath.includes(path.sep + "bots" + path.sep) &&
        pluginPath.endsWith("PlayerBots.plugin.js")
      ) {
        disabledCount++;
        return false;
      }
      return true;
    });

    // The exported name is only known after evaluation; filter by filename first.
    const disabledPluginNames = PluginManager.loadDisabledPluginNames();
    const enabledPluginFiles = filteredPluginFiles.filter((pluginPath) => {
      const fileName = pluginNameFromFile(pluginPath);
      if (!disabledPluginNames.has(normalizePluginName(fileName))) {
        return true;
      }
      disabledCount++;
      return false;
    });
    const candidates = PluginManager.collectPluginLoadCandidates(
      enabledPluginFiles
    );
    const membersWorld = isMembersWorld();
    let membersOnlyCount = 0;
    PluginManager.loadPluginCandidatesWithDependencies(
      candidates.filter((candidate) => {
        // Keep exported-name configuration working when it differs from the filename.
        if (disabledPluginNames.has(normalizePluginName(candidate.pluginName))) {
          disabledCount++;
          return false;
        }
        // Members content stays unloaded on a free-to-play world.
        if (!membersWorld && candidate.plugin.members === true) {
          membersOnlyCount++;
          return false;
        }
        return true;
      })
    );

    if (PluginManager.lastPersistenceOverride) {
      console.info(PluginManager.lastPersistenceOverride);
    }
    console.info(
      `[plugins] active=${PluginManager.loadedPlugins.length} disabled=${disabledCount}` +
        (membersOnlyCount > 0 ? ` members-only=${membersOnlyCount}` : "")
    );
    if (enabledPluginFiles.length > 0 && PluginManager.loadedPlugins.length === 0) {
      console.warn(`[plugins] no valid plugins loaded from ${pluginDirectory}`);
    }
  }

  public static emitPlayerLogin(event: PluginPlayerLoginEvent): void {
    if (PluginManager.loginHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.loginHooks) {
      PluginManager.executeHook(hook, event, "login", "player_login");
    }

    // Do not flood login with non-visible replacement regions.
    // Visible replacements are sent during map-region packets.
  }

  public static emitPlayerMapSquareChange(event: PluginPlayerMapSquareChangeEvent): void {
    for (const hook of PluginManager.mapSquareChangeHooks) {
      PluginManager.executeHook(hook, event, "map_square_change", "player_map_square_change");
    }
  }

  public static emitPlayerDisconnect(event: PluginPlayerDisconnectEvent): void {
    if (PluginManager.disconnectHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.disconnectHooks) {
      PluginManager.executeHook(hook, event, "disconnect", "player_disconnect");
    }
  }

  public static emitPlayerLogout(event: PluginPlayerLogoutEvent): void {
    if (PluginManager.logoutHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.logoutHooks) {
      PluginManager.executeHook(hook, event, "logout", "player_logout");
    }
  }

  public static emitSocialPacket(event: PluginSocialPacketEvent): boolean {
    if (!event?.player || event.handled) return false;
    for (const hook of PluginManager.socialPacketHooks) {
      if (event.handled) break;
      PluginManager.executeHook(hook, event, "social_packet", "social_packet");
    }
    return event.handled;
  }

  public static emitServerStartup(event: PluginServerLifecycleEvent): void {
    if (PluginManager.serverStartupHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.serverStartupHooks) {
      PluginManager.executeHook(hook, event, "server_startup", "server_startup");
    }
  }

  public static emitServerShutdown(event: PluginServerLifecycleEvent): void {
    if (PluginManager.serverShutdownHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.serverShutdownHooks) {
      PluginManager.executeHook(hook, event, "server_shutdown", "server_shutdown");
    }
  }

  public static emitFriendAdd(event: PluginFriendEvent): void {
    if (PluginManager.friendAddHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.friendAddHooks) {
      PluginManager.executeHook(hook, event, "friend_add", "friend_add");
    }
  }

  public static emitFriendRemove(event: PluginFriendEvent): void {
    if (PluginManager.friendRemoveHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.friendRemoveHooks) {
      PluginManager.executeHook(hook, event, "friend_remove", "friend_remove");
    }
  }

  public static emitPlayerProcess(event: PluginPlayerProcessEvent): void {
    PluginManager.updatePlayerZones(event?.player);
    if (PluginManager.playerProcessHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.playerProcessHooks) {
      PluginManager.executeHook(hook, event, "player_process", "player_process");
    }
  }

  /** Drives onZoneEnter/onZoneExit for a player from their current location. */
  public static updatePlayerZones(player: any): void {
    if (!player || PluginManager.zoneHooks.length === 0) {
      return;
    }
    const location = player.getLocation?.();
    if (!location) {
      return;
    }
    let active = PluginManager.activeZonesByPlayer.get(player);
    if (!active) {
      active = new Set<number>();
      PluginManager.activeZonesByPlayer.set(player, active);
    }
    for (let index = 0; index < PluginManager.zoneHooks.length; index++) {
      const hook = PluginManager.zoneHooks[index];
      const inside = PluginManager.isInsideZone(hook.zone, location);
      if (inside === active.has(index)) {
        continue;
      }
      if (inside) {
        active.add(index);
        if (hook.onEnter) {
          try {
            hook.onEnter({ player, zone: hook.zone });
          } catch (error) {
            console.warn(`[plugins] zone enter hook threw (${hook.pluginName})`, error);
          }
        }
      } else {
        active.delete(index);
        if (hook.onExit) {
          try {
            hook.onExit({ player, zone: hook.zone });
          } catch (error) {
            console.warn(`[plugins] zone exit hook threw (${hook.pluginName})`, error);
          }
        }
      }
    }
  }

  private static isInsideZone(zone: PluginZone, location: any): boolean {
    if (!zone) {
      return false;
    }
    const x = location.getX?.() ?? location.x ?? 0;
    const y = location.getY?.() ?? location.y ?? 0;
    const z = location.getZ?.() ?? location.z ?? 0;
    if (!(x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY)) {
      return false;
    }
    return !zone.levels || zone.levels.includes(z);
  }

  /** Spawns a plugin NPC (optionally owner-only) and returns it, or null. */
  public static spawnNpc(definition: PluginNpcSpawnDefinition): any {
    const id = Math.trunc(Number(definition?.id));
    if (!Number.isFinite(id) || id < 0) {
      return null;
    }
    const { NPC } = require("../game/entity/impl/npc/NPC");
    const { Location } = require("../game/model/Location");
    const { World } = require("../game/World");
    const npc = NPC.create(
      id,
      new Location(Number(definition.x) | 0, Number(definition.y) | 0, Number(definition.z ?? 0) | 0)
    );
    if (!npc) {
      return null;
    }
    if (Number.isFinite(definition.wanderRadius)) {
      npc.getMovementCoordinator().setRadius(Math.max(0, Math.trunc(definition.wanderRadius as number)));
    }
    if (Number.isFinite(definition.face)) {
      npc.setFace(Number(definition.face));
    }
    if (definition.owner) {
      npc.setOwner(definition.owner);
    }
    if (definition.ownerOnly) {
      npc.setOwnerOnly(true);
    }
    if (!World.getNpcs().add(npc)) {
      World.getAddNPCQueue().push(npc);
    }
    return npc;
  }

  /** Removes a plugin NPC, whether registered or still queued for addition. */
  public static removeNpc(npc: any): void {
    if (!npc) {
      return;
    }
    const { World } = require("../game/World");
    const addQueue = World.getAddNPCQueue();
    const queued = addQueue.indexOf(npc);
    if (queued !== -1) {
      addQueue.splice(queued, 1);
    }
    if (typeof npc.isRegistered === "function" && npc.isRegistered()) {
      World.getNpcs().remove(npc);
    }
  }

  public static emitPlayerLevelUp(event: PluginPlayerLevelUpEvent): void {
    if (PluginManager.playerLevelUpHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.playerLevelUpHooks) {
      PluginManager.executeHook(hook, event, "player_level_up", "player_level_up");
    }
  }

  public static emitCustomEvent(
    eventName: PluginCustomEventName,
    payload: any
  ): void {
    if (!isPluginCustomEventName(eventName)) {
      return;
    }
    const hooks = PluginManager.customEventHooks.get(eventName);
    if (!hooks?.length) {
      return;
    }
    for (const hook of hooks) {
      PluginManager.executeHook(
        hook,
        payload,
        `custom_event:${eventName}`,
        `custom_event:${eventName}`
      );
    }
  }

  public static emitRegionLoaded(event: PluginRegionLoadedEvent): void {
    if (PluginManager.regionLoadedHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.regionLoadedHooks) {
      PluginManager.executeHook(hook, event, "region_loaded", "region_loaded");
    }
  }

  public static emitActiveRegionsUpdated(event: PluginActiveRegionsEvent): void {
    if (PluginManager.activeRegionsHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.activeRegionsHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "active_regions_updated",
        "active_regions_updated"
      );
    }
  }

  public static emitPathBlocked(event: PluginPathBlockedEvent): void {
    if (PluginManager.pathBlockedHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.pathBlockedHooks) {
      PluginManager.executeHook(hook, event, "path_blocked", "path_blocked");
    }
  }

  public static emitObjectInteraction(
    event: PluginObjectInteractionEvent
  ): boolean {
    if (!event || !event.player || !event.object || event.handled) {
      return false;
    }
    if (PluginManager.nextObjectHookOrder === 0) {
      return false;
    }

    if (!("definition" in event)) {
      event.definition = event.object.getDefinition();
    }

    const hooks = [
      ...PluginManager.objectInteractionHooks,
      ...(PluginManager.objectHooksById.get(`${event.objectId}:${event.clickType}`) ?? []),
      ...(PluginManager.objectHooksByName.get(event.definition?.getName()) ?? []),
    ];
    // Generic, ID and name handlers retain their original registration priority.
    hooks.sort((a, b) => a.order - b.order);
    for (const hook of hooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(
        hook,
        event,
        "object_interaction",
        "object_interaction"
      );
    }
    return event.handled === true;
  }

  public static emitObjectRoute(event: PluginObjectRouteEvent): void {
    if (!event?.player || !event.object) {
      return;
    }
    for (const hook of PluginManager.objectRouteHooks) {
      PluginManager.executeHook(hook, event, "object_route", "object_route");
      if (event.destination) {
        return;
      }
    }
  }

  public static emitNpcRoute(event: PluginNpcRouteEvent): void {
    if (!event?.player || !event.npc) return;
    for (const hook of PluginManager.npcRouteHooks) {
      PluginManager.executeHook(hook, event, "npc_route", "npc_route");
    }
    event.range = Number.isInteger(event.range) ? Math.max(1, Math.min(24, event.range)) : 1;
  }

  // NOTE FOR MAINTAINERS:
  // Keep common event guard clauses centralized in emit* methods so plugin
  // consumers do not have to repeat the same checks in every handler.
  public static emitNpcInteraction(event: PluginNpcInteractionEvent): boolean {
    if (!event || !event.player || !event.npc) {
      return false;
    }

    event.definition ??= event.npc.getCurrentDefinition?.(event.player);

    for (const hooks of [PluginManager.npcInteractionHooks, PluginManager.npcAnyInteractionHooks]) {
      for (const hook of hooks) {
        if (event.handled) {
          break;
        }
        PluginManager.executeHook(hook, event, "npc_interaction", "npc_interaction");
      }
    }
    return event.handled === true;
  }

  /** Asks dialogue plugins which transcript variant to play (first answer wins). */
  public static emitNpcDialogueVariant(
    event: PluginNpcDialogueContext
  ): string | { page?: string; variant: string } | null {
    for (const hook of PluginManager.npcDialogueVariantHooks) {
      try {
        const result = hook.handler(event);
        if (result) {
          return result;
        }
      } catch (error) {
        console.warn(`[plugins] npc dialogue variant hook threw (${hook.pluginName})`, error);
      }
    }
    return null;
  }

  /** Asks dialogue plugins to answer a wiki prose condition (first boolean wins). */
  public static emitNpcDialogueCondition(
    event: PluginNpcDialogueConditionEvent
  ): boolean | null {
    for (const hook of PluginManager.npcDialogueConditionHooks) {
      try {
        const result = hook.handler(event);
        if (typeof result === "boolean") {
          return result;
        }
      } catch (error) {
        console.warn(`[plugins] npc dialogue condition hook threw (${hook.pluginName})`, error);
      }
    }
    return null;
  }

  public static emitNpcDeath(event: PluginNpcDeathEvent): void {
    if (PluginManager.npcDeathHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.npcDeathHooks) {
      PluginManager.executeHook(hook, event, "npc_death", "npc_death");
    }
  }

  public static emitNpcBeforeDeath(event: PluginNpcBeforeDeathEvent): boolean {
    for (const hook of PluginManager.npcBeforeDeathHooks) {
      PluginManager.executeHook(hook, event, "npc_before_death", "npc_before_death");
    }
    return event.preventDeath === true;
  }

  public static emitNpcHitModify(npc: any, hit: any): any {
    if (PluginManager.npcHitModifyHooks.length === 0) {
      return hit;
    }
    const event: PluginNpcHitModifyEvent = { npc, hit };
    for (const hook of PluginManager.npcHitModifyHooks) {
      PluginManager.executeHook(hook, event, "npc_hit_modify", "npc_hit_modify");
    }
    return event.hit;
  }

  public static emitCanAttack(
    attacker: any,
    target: any,
    method?: any
  ): boolean | null {
    if (PluginManager.canAttackHooks.length === 0) {
      return null;
    }
    const event: PluginCanAttackEvent = { attacker, target, method, allow: null };
    for (const hook of PluginManager.canAttackHooks) {
      PluginManager.executeHook(hook, event, "can_attack", "can_attack");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  public static emitCanTeleport(player: any, wildernessLevelLimit: number = 20, destination?: any): boolean | null {
    if (PluginManager.canTeleportHooks.length === 0) {
      return null;
    }
    const event: PluginCanTeleportEvent = { player, wildernessLevelLimit, destination, allow: null };
    for (const hook of PluginManager.canTeleportHooks) {
      PluginManager.executeHook(hook, event, "can_teleport", "can_teleport");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  /** A plugin's reason to refuse the logout button, or null to let it through. */
  public static emitCanLogout(player: any): string | null {
    const event: PluginCanLogoutEvent = { player, allow: null };
    for (const hook of PluginManager.canLogoutHooks) {
      PluginManager.executeHook(hook, event, "can_logout", "can_logout");
      if (event.allow === false) return event.reason ?? "You can't log out right now.";
      if (event.allow === true) return null;
    }
    return null;
  }

  public static emitCanEat(player: any, itemId: number): boolean | null {
    if (PluginManager.canEatHooks.length === 0) {
      return null;
    }
    const event: PluginCanEatEvent = { player, itemId, allow: null };
    for (const hook of PluginManager.canEatHooks) {
      PluginManager.executeHook(hook, event, "can_eat", "can_eat");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  public static emitFiremakingBlocked(
    event: PluginFiremakingBlockedEvent
  ): boolean {
    if (!event || !event.player || event.handled) {
      return false;
    }
    if (PluginManager.firemakingBlockedHooks.length === 0) {
      return false;
    }

    for (const hook of PluginManager.firemakingBlockedHooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(
        hook,
        event,
        "firemaking_blocked",
        "firemaking_blocked"
      );
    }
    return event.handled === true;
  }

  public static emitCanDrink(player: any, itemId: number): boolean | null {
    if (PluginManager.canDrinkHooks.length === 0) {
      return null;
    }
    const event: PluginCanDrinkEvent = { player, itemId, allow: null };
    for (const hook of PluginManager.canDrinkHooks) {
      PluginManager.executeHook(hook, event, "can_drink", "can_drink");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  public static emitCanTrade(player: any, target: any): boolean | null {
    if (PluginManager.canTradeHooks.length === 0) {
      return null;
    }
    const event: PluginCanTradeEvent = { player, target, allow: null };
    for (const hook of PluginManager.canTradeHooks) {
      PluginManager.executeHook(hook, event, "can_trade", "can_trade");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  /** Returns true if a plugin fully handled the trade request (event.handled), replacing the default walk-and-request flow. */
  public static emitTradeRequest(event: PluginTradeRequestEvent): boolean {
    if (!event || event.handled || !event.player || !event.target) {
      return false;
    }
    for (const hook of PluginManager.tradeRequestHooks) {
      if (event.handled) break;
      PluginManager.executeHook(hook, event, "trade_request", "trade_request");
    }
    return event.handled === true;
  }

  /** Observer-only: fires once per player after a completed trade, before the post-trade save. */
  public static emitTradeCompleted(event: PluginTradeCompletedEvent): void {
    if (!event || !event.player || !event.partner) {
      return;
    }
    for (const hook of PluginManager.tradeCompletedHooks) {
      PluginManager.executeHook(hook, event, "trade_completed", "trade_completed");
    }
  }

  public static emitPlayerFollow(event: PluginPlayerFollowEvent): void {
    if (PluginManager.playerFollowHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.playerFollowHooks) {
      PluginManager.executeHook(hook, event, "player_follow", "player_follow");
    }
  }

  public static emitPlayerAttack(event: PluginPlayerAttackEvent): void {
    if (PluginManager.playerAttackHooks.length === 0) {
      return;
    }
    for (const hook of PluginManager.playerAttackHooks) {
      PluginManager.executeHook(hook, event, "player_attack", "player_attack");
    }
  }

  public static emitCanBank(player: any): boolean | null {
    if (PluginManager.canBankHooks.length === 0) {
      return null;
    }
    const event: PluginCanBankEvent = { player, allow: null };
    for (const hook of PluginManager.canBankHooks) {
      PluginManager.executeHook(hook, event, "can_bank", "can_bank");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  public static emitCanBankItem(player: any, item: any): boolean | null {
    if (PluginManager.canBankItemHooks.length === 0) return null;
    const event: PluginCanBankItemEvent = { player, item, allow: null };
    for (const hook of PluginManager.canBankItemHooks) {
      PluginManager.executeHook(hook, event, "can_bank_item", "can_bank_item");
      if (event.allow !== null) return event.allow;
    }
    return null;
  }

  public static emitCanShop(player: any, shopId: number | null = null): boolean | null {
    if (PluginManager.canShopHooks.length === 0) {
      return null;
    }
    const event: PluginCanShopEvent = { player, shopId, allow: null };
    for (const hook of PluginManager.canShopHooks) {
      PluginManager.executeHook(hook, event, "can_shop", "can_shop");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  public static emitShouldDropItemsOnDeath(player: any, killer: any): boolean | null {
    if (PluginManager.shouldDropItemsOnDeathHooks.length === 0) {
      return null;
    }
    const event: PluginShouldDropItemsOnDeathEvent = {
      player,
      killer,
      shouldDrop: null,
    };
    for (const hook of PluginManager.shouldDropItemsOnDeathHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "should_drop_items_on_death",
        "should_drop_items_on_death"
      );
      if (event.shouldDrop !== null) {
        return event.shouldDrop;
      }
    }
    return null;
  }

  public static emitShouldKeepItemOnDeath(player: any, item: any): boolean | null {
    const event: PluginShouldKeepItemOnDeathEvent = {
      player,
      item,
      keep: null,
    };
    for (const hook of PluginManager.shouldKeepItemOnDeathHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "should_keep_item_on_death",
        "should_keep_item_on_death"
      );
      if (event.keep !== null) {
        return event.keep;
      }
    }
    return null;
  }

  public static emitPlayerDeathItemDrop(
    event: PluginPlayerDeathItemDropEvent
  ): boolean {
    if (
      !event ||
      !event.player ||
      !event.item ||
      event.handled
    ) {
      return false;
    }

    for (const hook of PluginManager.playerDeathItemDropHooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(
        hook,
        event,
        "player_death_item_drop",
        "player_death_item_drop"
      );
    }
    return event.handled === true;
  }

  public static emitCanEquip(player: any, slot: number, item: any): boolean | null {
    const event: PluginCanEquipEvent = { player, slot, item, allow: null };
    for (const hook of PluginManager.canEquipHooks) {
      PluginManager.executeHook(hook, event, "can_equip", "can_equip");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  /** Runs hooks until one sets `answerKey`; returns that answer, or null when none did. */
  private static firstAnswer<T>(
    hooks: PluginHook<T>[],
    event: T,
    label: string,
    answerKey: keyof T
  ): boolean | null {
    for (const hook of hooks) {
      PluginManager.executeHook(hook, event, label, label);
      if (event[answerKey] !== null) {
        return event[answerKey] as unknown as boolean;
      }
    }
    return null;
  }

  public static emitCanUseItem(player: any, itemId: number, action: string, option?: string): boolean | null {
    if (PluginManager.canUseItemHooks.length === 0) return null;
    return PluginManager.firstAnswer(PluginManager.canUseItemHooks,
      { player, itemId, action, option, allow: null }, "can_use_item", "allow");
  }

  public static emitCanGainExperience(player: any, skill: any, experience: number): boolean | null {
    if (PluginManager.canGainExperienceHooks.length === 0) return null;
    return PluginManager.firstAnswer(PluginManager.canGainExperienceHooks,
      { player, skill, experience, allow: null }, "can_gain_experience", "allow");
  }

  public static emitCanSpawnNpc(npcId: number, location: any): boolean | null {
    if (PluginManager.canSpawnNpcHooks.length === 0) return null;
    return PluginManager.firstAnswer(PluginManager.canSpawnNpcHooks,
      { npcId, location, allow: null }, "can_spawn_npc", "allow");
  }

  public static emitCanStockItem(shopId: number, itemId: number): boolean | null {
    if (PluginManager.canStockItemHooks.length === 0) return null;
    return PluginManager.firstAnswer(PluginManager.canStockItemHooks,
      { shopId, itemId, allow: null }, "can_stock_item", "allow");
  }

  /** The plugin's refusal message when a prayer is disabled, or null when it is usable. */
  public static emitPrayerDisabled(player: any, prayer: any): string | null {
    if (PluginManager.prayerDisabledHooks.length === 0) return null;
    const event: PluginPrayerDisabledEvent = { player, prayer, disabled: null };
    return PluginManager.firstAnswer(PluginManager.prayerDisabledHooks, event, "prayer_disabled", "disabled") === true
      ? event.message ?? "You cannot use that prayer here."
      : null;
  }

  public static emitCanUnequip(player: any, slot: number, item: any): boolean | null {
    const event: PluginCanUnequipEvent = { player, slot, item, allow: null };
    for (const hook of PluginManager.canUnequipHooks) {
      PluginManager.executeHook(hook, event, "can_unequip", "can_unequip");
      if (event.allow !== null) {
        return event.allow;
      }
    }
    return null;
  }

  public static emitPlayerDeath(event: PluginPlayerDeathEvent): boolean {
    if (!event || !event.player || event.handled) {
      return false;
    }
    for (const hook of PluginManager.playerDeathHooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(hook, event, "player_death", "player_death");
    }
    return event.handled === true;
  }

  public static emitPlayerOption(event: PluginPlayerOptionEvent): boolean {
    if (!event || !event.player || !event.target || event.handled) {
      return false;
    }
    for (const hook of PluginManager.playerOptionHooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(hook, event, "player_option", "player_option");
    }
    return event.handled === true;
  }

  public static emitPlayerDealtDamage(event: PluginPlayerDealtDamageEvent): void {
    if (!event || !event.player || !event.target || !event.hit) {
      return;
    }
    for (const hook of PluginManager.playerDealtDamageHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "player_dealt_damage",
        "player_dealt_damage"
      );
    }
  }

  public static emitAttackTiming(event: PluginAttackTimingEvent): void {
    if (!event?.attacker || !event?.target) return;
    for (const hook of PluginManager.attackTimingHooks) {
      PluginManager.executeHook(hook, event, "attack_timing", "attack_timing");
    }
  }

  public static emitCombatHitRoll(event: PluginCombatHitRollEvent): void {
    if (!event?.attacker || !event?.target) return;
    for (const hook of PluginManager.combatHitRollHooks) {
      PluginManager.executeHook(hook, event, "combat_hit_roll", "combat_hit_roll");
    }
  }

  public static emitCombatHitResolved(event: PluginCombatHitResolvedEvent): void {
    if (!event?.attacker || !event?.target || !event?.hit) return;
    for (const hook of PluginManager.combatHitResolvedHooks) {
      PluginManager.executeHook(hook, event, "combat_hit_resolved", "combat_hit_resolved");
    }
  }

  public static emitCombatAttackDistance(event: PluginCombatAttackDistanceEvent): number {
    for (const hook of PluginManager.combatAttackDistanceHooks) {
      PluginManager.executeHook(hook, event, "combat_attack_distance", "combat_attack_distance");
    }
    return Math.max(1, Math.trunc(event.distance));
  }

  public static emitSpellDisabled(
    player: any,
    spellbook: any,
    spellId: number,
    spell?: any
  ): boolean | null {
    const event: PluginSpellDisabledEvent = {
      player,
      spellbook,
      spellId,
      spell,
      disabled: null,
    };
    for (const hook of PluginManager.spellDisabledHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "spell_disabled",
        "spell_disabled"
      );
      if (event.disabled !== null) {
        return event.disabled;
      }
    }
    return null;
  }

  public static emitSpellRuneBypass(
    player: any,
    spellbook: any,
    spellId: number,
    runeId?: number
  ): boolean | null {
    const event: PluginSpellRuneBypassEvent = {
      player,
      spellbook,
      spellId,
      runeId,
      bypass: null,
    };
    for (const hook of PluginManager.spellRuneBypassHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "spell_rune_bypass",
        "spell_rune_bypass"
      );
      if (event.bypass !== null) {
        return event.bypass;
      }
    }
    return null;
  }

  public static emitNpcAggressionTolerance(
    player: any,
    npc: any
  ): boolean | null {
    const event: PluginNpcAggressionToleranceEvent = {
      player,
      npc,
      override: null,
    };
    for (const hook of PluginManager.npcAggressionToleranceHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "npc_aggression_tolerance",
        "npc_aggression_tolerance"
      );
      if (event.override !== null) {
        return event.override;
      }
    }
    return null;
  }

  public static emitPlayerDefeated(killer: any, victim: any): void {
    const event: PluginPlayerDefeatedEvent = { killer, victim };
    for (const hook of PluginManager.playerDefeatedHooks) {
      PluginManager.executeHook(hook, event, "player_defeated", "player_defeated");
    }
  }

  public static emitGroundItemPickup(event: PluginGroundItemInteractionEvent): boolean {
    for (const hook of PluginManager.groundItemPickupHooks) {
      PluginManager.executeHook(hook, event, "ground_item_pickup", "ground_item_pickup");
    }
    return event.handled === true;
  }

  public static emitItemOnObject(event: PluginItemOnObjectEvent): boolean {
    for (const hook of PluginManager.itemOnObjectHooks) {
      PluginManager.executeHook(hook, event, "item_on_object", "item_on_object");
    }
    return event.handled === true;
  }

  public static emitItemOnItem(event: PluginItemOnItemEvent): boolean {
    for (const hook of PluginManager.itemOnItemHooks) {
      PluginManager.executeHook(hook, event, "item_on_item", "item_on_item");
    }
    return event.handled === true;
  }

  public static emitItemOnNpc(event: PluginItemOnNpcEvent): boolean {
    for (const hook of PluginManager.itemOnNpcHooks) {
      PluginManager.executeHook(hook, event, "item_on_npc", "item_on_npc");
    }
    return event.handled === true;
  }

  public static emitItemOnPlayer(event: PluginItemOnPlayerEvent): boolean {
    for (const hook of PluginManager.itemOnPlayerHooks) {
      PluginManager.executeHook(hook, event, "item_on_player", "item_on_player");
    }
    return event.handled === true;
  }

  public static emitItemOnGroundItem(
    event: PluginItemOnGroundItemEvent
  ): boolean {
    for (const hook of PluginManager.itemOnGroundItemHooks) {
      PluginManager.executeHook(
        hook,
        event,
        "item_on_ground_item",
        "item_on_ground_item"
      );
    }
    return event.handled === true;
  }

  public static emitSpellOnObject(event: PluginSpellOnObjectEvent): boolean {
    for (const hook of PluginManager.spellOnObjectHooks) {
      PluginManager.executeHook(hook, event, "spell_on_object", "spell_on_object");
    }
    return event.handled === true;
  }

  public static emitGroundItemInteraction(
    event: PluginGroundItemInteractionEvent
  ): boolean {
    if (!event || !event.player || !event.groundItem || event.handled) {
      return false;
    }

    for (const hook of PluginManager.groundItemInteractionHooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(
        hook,
        event,
        "ground_item_interaction",
        "ground_item_interaction"
      );
    }
    return event.handled === true;
  }

  public static emitItemAction(event: PluginItemActionEvent): boolean {
    for (const hook of PluginManager.itemActionHooks) {
      PluginManager.executeHook(hook, event, "item_action", "item_action");
    }
    return event.handled === true;
  }

  public static emitItemDropPolicy(event: PluginItemDropEvent): boolean {
    for (const hook of PluginManager.itemDropHooks) {
      PluginManager.executeHook(hook, event, "item_drop", "item_drop");
    }
    return event.handled === true;
  }

  public static emitButtonClick(event: PluginButtonClickEvent): boolean {
    if (
      !event ||
      !event.player ||
      event.handled ||
      !Number.isInteger(event.buttonId)
    ) {
      return false;
    }

    for (const hook of PluginManager.buttonClickHooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(hook, event, "button_click", "button_click");
    }
    return event.handled === true;
  }

  public static emitInterfaceActionClick(
    event: PluginInterfaceActionClickEvent
  ): boolean {
    if (
      !event ||
      !event.player ||
      event.handled ||
      !Number.isInteger(event.buttonId) ||
      !Number.isInteger(event.action)
    ) {
      return false;
    }

    if (MultiChatboxPrompt.handleInterfaceActionClick(event)) {
      event.handled = true;
      return true;
    }

    for (const hook of PluginManager.interfaceActionClickHooks) {
      if (event.handled) {
        break;
      }
      PluginManager.executeHook(
        hook,
        event,
        "interface_action_click",
        "interface_action_click"
      );
    }
    return event.handled === true;
  }

  /** Null means "no restriction"; otherwise the lowest rights id that may run the command. */
  private static normalizeCommandRights(
    minimumRights: PluginCommandRights | undefined
  ): number | null {
    const id = (minimumRights as any)?.getId?.();
    return Number.isInteger(id) ? id : null;
  }

  /**
   * Rights ids are sequential and ordered (none < moderator < administrator < owner <
   * developer), so a command's requirement is a floor everyone above also clears.
   */
  public static playerHasCommandRights(player: any, base: string): boolean {
    // world.json wins over the registered rank and plugin overrides (it is the world owner's call).
    const required = PluginManager.commandPermissions().get(base) ??
      (PluginManager.commandRightsOverrides.has(base)
        ? PluginManager.commandRightsOverrides.get(base)
        : PluginManager.commandRights.get(base));
    if (required === null || required === undefined) {
      return true;
    }
    return player.getRights().getId() >= required;
  }

  /**
   * world.json pluginConfig "commands:permissions": { "<command>": "<PlayerRights name>" },
   * e.g. { "items": "NONE", "teleports": "OWNER" }. Each entry sets the lowest rank that
   * may run that command (no "::"), raising or lowering what it registered with.
   */
  private static commandPermissions(): Map<string, number> {
    if (!PluginManager.commandPermissionsCache) {
      const permissions = new Map<string, number>();
      const config = PluginManager.getPluginConfig<unknown>("commands:permissions", {});
      if (config && typeof config === "object" && !Array.isArray(config)) {
        for (const [command, rights] of Object.entries(config)) {
          const name = command.trim().replace(/^::/, "").toLowerCase();
          const id = typeof rights === "string" ? COMMAND_PERMISSION_RIGHTS[rights.trim().toUpperCase()] : undefined;
          if (!name || id === undefined) {
            console.warn(`[plugins] commands:permissions ignores ${JSON.stringify(command)}: ${JSON.stringify(rights)}`);
            continue;
          }
          permissions.set(name, id);
        }
      }
      PluginManager.commandPermissionsCache = permissions;
    }
    return PluginManager.commandPermissionsCache;
  }

  /** Overrides the rank a command requires. PlayerRights.NONE opens it to every player. */
  public static setCommandRights(
    command: string,
    minimumRights: PluginCommandRights
  ): void {
    if (typeof command !== "string") {
      return;
    }
    const normalized = command.trim().toLowerCase();
    if (!normalized.length) {
      return;
    }
    PluginManager.commandRightsOverrides.set(
      normalized,
      PluginManager.normalizeCommandRights(minimumRights)
    );
  }

  public static getRegisteredCommands(player: any): Array<{ command: string; description: string }> {
    return [...PluginManager.commandHandlersByBase]
      .filter(([command]) => PluginManager.playerHasCommandRights(player, command))
      .map(([command, hooks]) => ({ command, description: hooks.find((hook) => hook.description)?.description ?? "" }))
      .sort((a, b) => a.command.localeCompare(b.command));
  }

  public static emitCommand(event: PluginCommandEvent): boolean {
    for (const hook of PluginManager.commandHooks) {
      PluginManager.executeHook(hook, event, "command", "command_any");
    }

    if (event.handled) {
      return true;
    }

    const baseHandlers = PluginManager.commandHandlersByBase.get(event.base);
    if (!baseHandlers) {
      return event.handled;
    }

    if (!PluginManager.playerHasCommandRights(event.player, event.base)) {
      event.player.sendMessage("You do not have permission to use this command.");
      return true;
    }

    for (const hook of baseHandlers) {
      PluginManager.executeHook(hook, event, "command", `command:${event.base}`);
    }

    return event.handled;
  }

  private static discoverPluginFiles(
    pluginDirectory: string,
    maxDepth: number
  ): string[] {
    const pluginPaths: string[] = [];

    const walk = (directory: string, depth: number) => {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (depth < maxDepth) {
            walk(fullPath, depth + 1);
          }
          continue;
        }

        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith(".plugin.js")) {
          pluginPaths.push(fullPath);
        }
      }
    };

    walk(pluginDirectory, 0);
    pluginPaths.sort((a, b) => a.localeCompare(b));
    return pluginPaths;
  }

  private static loadDisabledPluginNames(): Set<string> {
    const configPath = path.join(process.cwd(), "data", "definitions", "world.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      disabledPlugins?: unknown;
    };
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`[plugins] ${configPath} must contain an object`);
    }
    if (config.disabledPlugins === undefined) {
      return new Set();
    }
    if (
      !Array.isArray(config.disabledPlugins) ||
      config.disabledPlugins.some(
        (pluginName) => typeof pluginName !== "string" || pluginName.trim().length === 0
      )
    ) {
      throw new Error(`[plugins] ${configPath}.disabledPlugins must be a string[]`);
    }
    return new Set(config.disabledPlugins.map(normalizePluginName));
  }

  /** Reads the world.json `pluginConfig` map once (empty when unset or malformed). */
  private static loadPluginConfig(): Record<string, unknown> {
    if (PluginManager.pluginConfigCache) {
      return PluginManager.pluginConfigCache;
    }
    let parsed: unknown;
    try {
      const configPath = path.join(process.cwd(), "data", "definitions", "world.json");
      parsed = (JSON.parse(fs.readFileSync(configPath, "utf8")) as { pluginConfig?: unknown })
        .pluginConfig;
    } catch {
      parsed = undefined;
    }
    PluginManager.pluginConfigCache =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return PluginManager.pluginConfigCache;
  }

  /** Value of world.json `pluginConfig[key]`, or `defaultValue` when the key is unset. */
  public static getPluginConfig<T = unknown>(key: string, defaultValue?: T): T {
    if (typeof key !== "string" || key.length === 0) {
      return defaultValue as T;
    }
    const config = PluginManager.loadPluginConfig();
    return Object.prototype.hasOwnProperty.call(config, key)
      ? (config[key] as T)
      : (defaultValue as T);
  }

  private static collectPluginLoadCandidates(
    pluginPaths: string[]
  ): PluginLoadCandidate[] {
    const candidates: PluginLoadCandidate[] = [];

    for (const pluginPath of pluginPaths) {
      try {
        const imported = require(pluginPath);
        const plugin = (imported?.default ?? imported) as PluginModule;

        if (!plugin || typeof plugin.register !== "function") {
          console.warn(
            `[plugins] skipped ${path.basename(
              pluginPath
            )}: missing register(api) export`
          );
          continue;
        }

        const fallbackName = path.basename(pluginPath, path.extname(pluginPath));
        const pluginName =
          typeof plugin.name === "string" && plugin.name.trim().length > 0
            ? plugin.name.trim()
            : fallbackName;
        const dependsOn = PluginManager.normalizePluginDependencies(
          pluginName,
          plugin.dependsOn,
          pluginPath
        );

        candidates.push({
          pluginPath,
          plugin,
          pluginName,
          dependsOn,
        });
      } catch (err) {
        console.error(
          `[plugins] failed to load ${path.basename(pluginPath)}`,
          err
        );
      }
    }

    return candidates;
  }

  private static normalizePluginDependencies(
    pluginName: string,
    dependsOn: unknown,
    pluginPath: string
  ): string[] {
    if (dependsOn == null) {
      return [];
    }
    if (!Array.isArray(dependsOn)) {
      console.warn(
        `[plugins] ${pluginName} ignored invalid dependsOn in ${path.basename(
          pluginPath
        )}: expected string[]`
      );
      return [];
    }

    const normalized: string[] = [];
    for (const dep of dependsOn) {
      if (typeof dep !== "string" || dep.trim().length === 0) {
        console.warn(
          `[plugins] ${pluginName} ignored invalid dependency value in ${path.basename(
            pluginPath
          )}`
        );
        continue;
      }

      const dependencyName = dep.trim();
      if (dependencyName === pluginName) {
        console.warn(
          `[plugins] ${pluginName} ignored self dependency in ${path.basename(
            pluginPath
          )}`
        );
        continue;
      }
      if (!normalized.includes(dependencyName)) {
        normalized.push(dependencyName);
      }
    }
    return normalized;
  }

  private static loadPluginCandidatesWithDependencies(
    candidates: PluginLoadCandidate[]
  ): void {
    const pending = [...candidates];
    const loadedByName = new Set<string>();

    while (pending.length > 0) {
      let progress = false;
      for (let i = 0; i < pending.length; i++) {
        const candidate = pending[i];
        const missingDeps = candidate.dependsOn.filter(
          (dependency) => !loadedByName.has(dependency)
        );
        if (missingDeps.length > 0) {
          continue;
        }

        if (!PluginManager.registerPluginCandidate(candidate)) {
          pending.splice(i, 1);
          i--;
          progress = true;
          continue;
        }
        loadedByName.add(candidate.pluginName);
        pending.splice(i, 1);
        i--;
        progress = true;
      }

      if (!progress) {
        break;
      }
    }

    if (pending.length === 0) {
      return;
    }

    for (const unresolved of pending) {
      const missingDeps = unresolved.dependsOn.filter(
        (dependency) => !loadedByName.has(dependency)
      );
      console.warn(
        `[plugins] skipped ${unresolved.pluginName}: unresolved dependsOn [${missingDeps.join(
          ", "
        )}]`
      );
    }
  }

  private static registerPluginCandidate(
    candidate: PluginLoadCandidate
  ): boolean {
    try {
      candidate.plugin.register(PluginManager.createApi(candidate.pluginName));
      PluginManager.loadedPlugins.push(candidate.pluginName);
      return true;
    } catch (err) {
      console.error(
        `[plugins] failed to initialize ${path.basename(candidate.pluginPath)}`,
        err
      );
      return false;
    }
  }

  /**
   * Core classes/helpers shared by every plugin as `api.core`. Built lazily from
   * require() so import cycles (CombatFactory <-> PluginManager) are already settled
   * by the time plugins load. One shared object for the whole process.
   */
  private static getCoreApi(): PluginCoreApi {
    if (PluginManager.pluginCoreApi) {
      return PluginManager.pluginCoreApi;
    }
    const combat = "../game/content/combat";
    const model = "../game/model";
    PluginManager.pluginCoreApi = Object.freeze({
      MeleeCombatMethod: require(`${combat}/method/impl/MeleeCombatMethod`).MeleeCombatMethod,
      RangedCombatMethod: require(`${combat}/method/impl/RangedCombatMethod`).RangedCombatMethod,
      MagicCombatMethod: require(`${combat}/method/impl/MagicCombatMethod`).MagicCombatMethod,
      CombatMethod: require(`${combat}/method/CombatMethod`).CombatMethod,
      CombatSpecial: require(`${combat}/CombatSpecial`).CombatSpecial,
      CombatFactory: require(`${combat}/CombatFactory`).CombatFactory,
      CanAttackResponse: require(`${combat}/CombatFactory`).CanAttackResponse,
      CombatType: require(`${combat}/CombatType`).CombatType,
      SkullType: require(`${model}/SkullType`).SkullType,
      CombatConstants: require(`${combat}/CombatConstants`).CombatConstants,
      DamageFormulas: require(`${combat}/formula/DamageFormulas`).DamageFormulas,
      AccuracyFormulasDpsCalc: require(`${combat}/formula/AccuracyFormulasDpsCalc`).AccuracyFormulasDpsCalc,
      PendingHit: require(`${combat}/hit/PendingHit`).PendingHit,
      HitDamage: require(`${combat}/hit/HitDamage`).HitDamage,
      HitMask: require(`${combat}/hit/HitMask`).HitMask,
      RangedWeapon: require(`${combat}/ranged/RangedData`).RangedWeapon,
      Ammunition: require(`${combat}/ranged/RangedData`).Ammunition,
      WeaponProfiles: require(`${combat}/WeaponProfile`).WeaponProfiles,
      FightStyle: require(`${combat}/FightStyle`).FightStyle,
      WeaponInterfaceManager: require(`${combat}/WeaponInterfaceManager`).WeaponInterfaceManager,
      PrayerHandler: require("../game/content/PrayerHandler").PrayerHandler,
      DuelRule: require("../game/content/Duelling").DuelRule,
      RegionManager: require("../game/collision/RegionManager").RegionManager,
      Animation: require(`${model}/Animation`).Animation,
      Graphic: require(`${model}/Graphic`).Graphic,
      GraphicHeight: require(`${model}/GraphicHeight`).GraphicHeight,
      Priority: require(`${model}/Priority`).Priority,
      Projectile: require(`${model}/Projectile`).Projectile,
      Skill: require(`${model}/Skill`).Skill,
      Item: require(`${model}/Item`).Item,
      Flag: require(`${model}/Flag`).Flag,
      Direction: require(`${model}/Direction`).Direction,
      Equipment: require(`${model}/container/impl/Equipment`).Equipment,
      Bank: require(`${model}/container/impl/Bank`).Bank,
      Task: require("../game/task/Task").Task,
      CountdownTask: require("../game/task/impl/CountdownTask").CountdownTask,
      ForceMovement: require(`${model}/ForceMovement`).ForceMovement,
      ForceMovementTask: require("../game/task/impl/ForceMovementTask").ForceMovementTask,
      TaskManager: require("../game/task/TaskManager").TaskManager,
      ItemIdentifiers: require("../util/ItemIdentifiers").ItemIdentifiers,
      ItemIds: require("../util/IdEnums").ItemIds,
      NpcIdentifiers: require("../util/NpcIdentifiers").NpcIdentifiers,
      ObjectIdentifiers: require("../util/ObjectIdentifiers").ObjectIdentifiers,
      ShopIdentifiers: require("../util/ShopIdentifiers").ShopIdentifiers,
      Misc: require("../util/Misc").Misc,
      TimerKey: require("../util/timers/TimerKey").TimerKey,
      Sound: require("../game/Sound").Sound,
      Sounds: require("../game/Sounds").Sounds,
      Location: require(`${model}/Location`).Location,
      Boundary: require(`${model}/Boundary`).Boundary,
      PolygonalBoundary: require(`${model}/PolygonalBoundary`).PolygonalBoundary,
      Area: require(`${model}/areas/Area`).Area,
      ServerPerf: require("../util/ServerPerf").ServerPerf,
      PluginPerf: Object.freeze({
        snapshot: (limit?: number) => PluginManager.getPluginPerformanceSnapshot(limit),
        reset: () => PluginManager.resetPluginPerformanceStats(),
        setEnabled: (enabled: boolean) => PluginManager.setPluginPerformanceProfilingEnabled(enabled),
        isEnabled: () => PluginManager.isPluginPerformanceProfilingEnabled(),
      }),
      World: require("../game/World").World,
      GameObject: require("../game/entity/impl/object/GameObject").GameObject,
      PrivateArea: require(`${model}/areas/impl/PrivateArea`).PrivateArea,
      TemplatedInstanceArea: require(`${model}/areas/impl/TemplatedInstanceArea`).TemplatedInstanceArea,
      ObjectManager: require("../game/entity/impl/object/ObjectManager").ObjectManager,
      OperationType: require("../game/entity/impl/object/ObjectManager").OperationType,
      LocModelType: require("../game/cache/codec/rs/config/loctype/LocModelType").LocModelType,
      MapObjects: require("../game/entity/impl/object/MapObjects").MapObjects,
      ItemOnGroundManager: require("../game/entity/impl/grounditem/ItemOnGroundManager").ItemOnGroundManager,
      ItemDefinition: require("../game/definition/ItemDefinition").ItemDefinition,
      CacheDefinitions: require("../game/cache/CacheDefinitions").CacheDefinitions,
      PathFinder: require(`${model}/movement/path/PathFinder`).PathFinder,
      NpcDefinition: require("../game/definition/NpcDefinition").NpcDefinition,
      ObjectDefinition: require("../game/definition/ObjectDefinition").ObjectDefinition,
      MagicSpellbook: require(`${model}/MagicSpellbook`).MagicSpellbook,
      Spell: require(`${combat}/magic/Spell`).Spell,
      CombatNormalSpell: require(`${combat}/magic/CombatNormalSpell`).CombatNormalSpell,
      NPC: require("../game/entity/impl/npc/NPC").NPC,
      GameConstants: require("../game/GameConstants").GameConstants,
      Music: require("../game/Music").Music,
      // world.json accessors (isMembersWorld, isMembersArea, WORLD_SPAWN, zone boundaries).
      WorldDefinition: require("../game/definition/WorldDefinition"),
      TeleportHandler: require(`${model}/teleportation/TeleportHandler`).TeleportHandler,
      TeleportType: require(`${model}/teleportation/TeleportType`).TeleportType,
      DialogueChainBuilder: require(`${model}/dialogues/builders/DialogueChainBuilder`).DialogueChainBuilder,
      NpcDialogue: require(`${model}/dialogues/entries/impl/NpcDialogue`).NpcDialogue,
      PlayerDialogue: require(`${model}/dialogues/entries/impl/PlayerDialogue`).PlayerDialogue,
      OptionDialogue: require(`${model}/dialogues/entries/impl/OptionDialogue`).OptionDialogue,
      StatementDialogue: require(`${model}/dialogues/entries/impl/StatementDialogue`).StatementDialogue,
      ItemStatementDialogue: require(`${model}/dialogues/entries/impl/ItemStatementDialogue`).ItemStatementDialogue,
      ActionDialogue: require(`${model}/dialogues/entries/impl/ActionDialogue`).ActionDialogue,
      EndDialogue: require(`${model}/dialogues/entries/impl/EndDialogue`).EndDialogue,
      CreationMenu: require(`${model}/menu/CreationMenu`).CreationMenu,
      PlayerRights: require("../game/model/rights/PlayerRights").PlayerRights,
      Server: require("../Server").Server,
      PluginManager: require("./PluginManager").PluginManager,
      ShopManager: require("../game/model/container/shop/ShopManager").ShopManager,
      MultiChatboxPrompt: require("../game/model/menu/MultiChatboxPrompt").MultiChatboxPrompt,
      dispatchClientMessages: require("../net/NetworkBuilder").dispatchClientMessages,
      connectHeadlessClient: require("../net/NetworkBuilder").connectHeadlessClient,
    });
    return PluginManager.pluginCoreApi;
  }

  private static createApi(pluginName: string): PluginApi {
    const npcInteractionDefinitions: Array<
      PluginNpcInteractionDefinition & { npcId: number }
    > = [];
    let npcInteractionSourceRegistered = false;

    const registerNpcInteractionDefinition = (
      npcIds: number | number[],
      definition: PluginNpcInteractionDefinition
    ): void => {
      const normalizedNpcIds = Array.isArray(npcIds) ? npcIds : [npcIds];
      if (
        normalizedNpcIds.length === 0 ||
        normalizedNpcIds.some((npcId) => !Number.isInteger(npcId) || npcId < 0) ||
        !definition ||
        Array.isArray(definition) ||
        typeof definition !== "object"
      ) {
        console.warn(
          `[plugins] ${pluginName} attempted invalid NPC interaction definition registration`
        );
        return;
      }

      const normalized: PluginNpcInteractionDefinition = {};
      for (const property of [
        "firstClick",
        "secondClick",
        "thirdClick",
        "fourthClick",
      ] as const) {
        const action = definition[property];
        if (action === undefined) {
          continue;
        }
        if (!action || Array.isArray(action) || typeof action !== "object") {
          console.warn(
            `[plugins] ${pluginName} attempted invalid ${property} NPC interaction action`
          );
          return;
        }

        const hasShopId = action.shopId !== undefined;
        const hasTeleportLocation = action.teleportLocation !== undefined;
        if (Number(hasShopId) + Number(hasTeleportLocation) !== 1) {
          console.warn(
            `[plugins] ${pluginName} ${property} must define exactly one of shopId or teleportLocation`
          );
          return;
        }
        if (
          hasShopId &&
          (!Number.isInteger(action.shopId) || (action.shopId as number) < 0)
        ) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid ${property}.shopId`
          );
          return;
        }

        if (hasTeleportLocation) {
          const location = action.teleportLocation!;
          const z = location?.z ?? 0;
          if (
            !location ||
            !Number.isFinite(location.x) ||
            !Number.isFinite(location.y) ||
            !Number.isFinite(z)
          ) {
            console.warn(
              `[plugins] ${pluginName} attempted invalid ${property}.teleportLocation`
            );
            return;
          }
          normalized[property] = {
            teleportLocation: {
              x: Math.trunc(location.x),
              y: Math.trunc(location.y),
              z: Math.trunc(z),
            },
          };
        } else {
          normalized[property] = { shopId: action.shopId };
        }
      }

      if (
        !normalized.firstClick &&
        !normalized.secondClick &&
        !normalized.thirdClick &&
        !normalized.fourthClick
      ) {
        console.warn(
          `[plugins] ${pluginName} attempted empty NPC interaction definition registration`
        );
        return;
      }
      if (!npcInteractionSourceRegistered) {
        DefinitionLoader.registerSource(
          NpcInteractionDefinitionLoader.DEFINITION_TYPE,
          pluginName,
          {
            name: pluginName,
            priority: 100,
            load: () => npcInteractionDefinitions,
          }
        );
        npcInteractionSourceRegistered = true;
      }
      for (const npcId of normalizedNpcIds) {
        npcInteractionDefinitions.push({ npcId, ...normalized });
      }
    };

    const registerNpcClickHook = (
      clickType: number,
      npcIds: number | number[],
      handler: (event: PluginNpcInteractionEvent) => void | boolean,
      label = "npc"
    ): void => {
      const normalized = Array.isArray(npcIds) ? npcIds : [npcIds];
      const validIds = normalized.filter(
        (id) => Number.isInteger(id) && id >= 0
      ) as number[];
      if (
        validIds.length === 0 ||
        !Number.isInteger(clickType) ||
        clickType < 1 ||
        clickType > 5 ||
        typeof handler !== "function"
      ) {
        console.warn(
          `[plugins] ${pluginName} attempted invalid ${label} click hook registration ` +
          `npcIds=${JSON.stringify(npcIds)} clickType=${clickType}`
        );
        return;
      }
      if (validIds.length !== normalized.length) {
        console.warn(
          `[plugins] ${pluginName} ${label} click hook registration dropped invalid ids ` +
          `(kept ${validIds.length}/${normalized.length}): npcIds=${JSON.stringify(npcIds)}`
        );
      }

      const npcIdSet = new Set(validIds);
      NpcInteractionManager.registerPluginInteraction(
        pluginName,
        validIds,
        clickType,
        handler
      );
      PluginManager.npcInteractionHooks.push({
        pluginName,
        handler: (event) => {
          if (
            !event ||
            event.handled ||
            event.clickType !== clickType ||
            !npcIdSet.has(event.npcId)
          ) {
            return;
          }
          const result = handler(event);
          if (result !== false) {
            event.handled = true;
          }
        },
      });
    };

    const registerObjectClickHook = (
      clickType: number,
      objectIds: number | number[],
      handler: (event: PluginObjectInteractionEvent) => void | boolean,
      label = "object"
    ): void => {
      const normalized = Array.isArray(objectIds) ? objectIds : [objectIds];
      const validIds = normalized.filter(
        (id) => Number.isInteger(id) && id >= 0
      ) as number[];
      if (!validIds.length || typeof handler !== "function") {
        console.warn(
          `[plugins] ${pluginName} attempted invalid ${label} click hook registration objectIds=${JSON.stringify(objectIds)}`
        );
        return;
      }
      if (validIds.length !== normalized.length) {
        console.warn(
          `[plugins] ${pluginName} ${label} click hook registration dropped invalid ids ` +
          `(kept ${validIds.length}/${normalized.length}): objectIds=${JSON.stringify(objectIds)}`
        );
      }

      const hook: ObjectInteractionHook = {
        pluginName,
        order: PluginManager.nextObjectHookOrder++,
        handler: (event) => {
          if (handler(event) !== false) event.handled = true;
        },
      };
      for (const id of new Set(validIds)) {
        const key = `${id}:${clickType}`;
        const hooks = PluginManager.objectHooksById.get(key) ?? [];
        hooks.push(hook);
        PluginManager.objectHooksById.set(key, hooks);
      }
    };

    const registerGroundItemClickHook = (
      clickType: number,
      itemIds: number | number[],
      handler: (event: PluginGroundItemInteractionEvent) => void | boolean,
      label = "ground-item"
    ): void => {
      const normalized = Array.isArray(itemIds) ? itemIds : [itemIds];
      const validIds = normalized.filter(
        (id) => Number.isInteger(id) && id >= 0
      ) as number[];
      if (!validIds.length || typeof handler !== "function") {
        console.warn(
          `[plugins] ${pluginName} attempted invalid ${label} click hook registration itemIds=${JSON.stringify(itemIds)}`
        );
        return;
      }
      if (validIds.length !== normalized.length) {
        console.warn(
          `[plugins] ${pluginName} ${label} click hook registration dropped invalid ids ` +
          `(kept ${validIds.length}/${normalized.length}): itemIds=${JSON.stringify(itemIds)}`
        );
      }

      const itemIdSet = new Set(validIds);

      PluginManager.groundItemInteractionHooks.push({
        pluginName,
        handler: (event) => {
          if (!event || event.handled || event.clickType !== clickType) {
            return;
          }
          if (!itemIdSet.has(event.groundItemId)) {
            return;
          }

          const result = handler(event);
          if (result !== false) {
            event.handled = true;
          }
        },
      });
    };

    const registerButtonHook = (
      buttonIds: number | number[],
      handler: (event: PluginButtonClickEvent) => void | boolean,
      label = "button"
    ): void => {
      const normalized = Array.isArray(buttonIds) ? buttonIds : [buttonIds];
      const validIds = normalized.filter(
        (id) => Number.isInteger(id) && id >= 0
      ) as number[];
      if (!validIds.length || typeof handler !== "function") {
        console.warn(
          `[plugins] ${pluginName} attempted invalid ${label} hook registration buttonIds=${JSON.stringify(buttonIds)}`
        );
        return;
      }
      if (validIds.length !== normalized.length) {
        console.warn(
          `[plugins] ${pluginName} ${label} hook registration dropped invalid ids ` +
          `(kept ${validIds.length}/${normalized.length}): buttonIds=${JSON.stringify(buttonIds)}`
        );
      }

      const buttonIdSet = new Set(validIds);

      PluginManager.buttonClickHooks.push({
        pluginName,
        handler: (event) => {
          if (!event || event.handled || !buttonIdSet.has(event.buttonId)) {
            return;
          }

          const result = handler(event);
          if (result !== false) {
            event.handled = true;
          }
        },
      });
    };

    const registerInterfaceActionButtonHook = (
      buttonIds: number | number[],
      handler: (event: PluginInterfaceActionClickEvent) => void | boolean,
      label = "interface_action_button"
    ): void => {
      const normalized = Array.isArray(buttonIds) ? buttonIds : [buttonIds];
      const validIds = normalized.filter(
        (id) => Number.isInteger(id) && id >= 0
      ) as number[];
      if (!validIds.length || typeof handler !== "function") {
        console.warn(
          `[plugins] ${pluginName} attempted invalid ${label} hook registration buttonIds=${JSON.stringify(buttonIds)}`
        );
        return;
      }
      if (validIds.length !== normalized.length) {
        console.warn(
          `[plugins] ${pluginName} ${label} hook registration dropped invalid ids ` +
          `(kept ${validIds.length}/${normalized.length}): buttonIds=${JSON.stringify(buttonIds)}`
        );
      }

      const buttonIdSet = new Set(validIds);

      PluginManager.interfaceActionClickHooks.push({
        pluginName,
        handler: (event) => {
          if (!event || event.handled || !buttonIdSet.has(event.buttonId)) {
            return;
          }

          const result = handler(event);
          if (result !== false) {
            event.handled = true;
          }
        },
      });
    };

    const registerNpcActions = (
      name: string | null,
      actions: Record<string, (event: PluginNpcInteractionEvent) => void | boolean>
    ): void => {
      const handlers = new Map(Object.entries(actions ?? {}).filter(([, action]) => typeof action === "function"));
      // Name-specific actions are "specific" and run before the generic any-NPC hooks.
      const hookList = name === null
        ? PluginManager.npcAnyInteractionHooks
        : PluginManager.npcInteractionHooks;
      hookList.push({ pluginName, handler: (event) => {
        if (event.handled || !Number.isInteger(event.clickType) || event.clickType < 1 || event.clickType > 5) return;
        const definition = event.definition;
        if (!definition || (name !== null && definition.getName() !== name)) return;
        const action = handlers.get(definition.getActions()?.[event.clickType - 1]);
        if (action && action(event) !== false) event.handled = true;
      } });
    };

    return {
      core: PluginManager.getCoreApi(),
      onPlayerMapSquareChange: (handler) => {
        if (typeof handler === "function") {
          PluginManager.mapSquareChangeHooks.push({ pluginName, handler });
        }
      },
      onPlayerLogin: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.loginHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.username) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerDisconnect: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.disconnectHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.username) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerLogout: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.logoutHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.username) {
              return;
            }
            handler(event);
          },
        });
      },
      onSocialPacket: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.socialPacketHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.packet) {
              return;
            }
            handler(event);
          },
        });
      },
      onServerStartup: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.serverStartupHooks.push({ pluginName, handler });
      },
      onServerShutdown: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.serverShutdownHooks.push({ pluginName, handler });
      },
      onFriendAdd: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.friendAddHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.other) {
              return;
            }
            handler(event);
          },
        });
      },
      onFriendRemove: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.friendRemoveHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.other) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerProcess: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerProcessHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player) {
              return;
            }
            handler(event);
          },
        });
      },
      onZoneEnter: (zone, handler) => {
        if (typeof handler !== "function" || !zone) {
          return;
        }
        PluginManager.zoneHooks.push({ pluginName, zone, onEnter: handler });
      },
      onZoneExit: (zone, handler) => {
        if (typeof handler !== "function" || !zone) {
          return;
        }
        PluginManager.zoneHooks.push({ pluginName, zone, onExit: handler });
      },
      spawnNpc: (definition) => PluginManager.spawnNpc(definition),
      removeNpc: (npc) => PluginManager.removeNpc(npc),
      onPlayerLevelUp: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerLevelUpHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !event.skill ||
              !Number.isInteger(event.oldLevel) ||
              !Number.isInteger(event.newLevel)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onCustomEvent: (eventName, handler) => {
        if (
          !isPluginCustomEventName(eventName) ||
          typeof handler !== "function"
        ) {
          return;
        }
        const hooks = PluginManager.customEventHooks.get(eventName) ?? [];
        hooks.push({
          pluginName,
          handler,
        });
        PluginManager.customEventHooks.set(eventName, hooks);
      },
      onRegionLoaded: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.regionLoadedHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !Number.isInteger(event.regionId) ||
              !Number.isInteger(event.absX) ||
              !Number.isInteger(event.absY)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onActiveRegionsUpdated: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.activeRegionsHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !Array.isArray(event.regions) || !Array.isArray(event.regionKeys)) {
              return;
            }
            handler(event);
          },
        });
      },
      onPathBlocked: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.pathBlockedHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.entity || !event.from || !event.to) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerPathBlocked: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.pathBlockedHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.isPlayer || !event.entity || !event.username) {
              return;
            }
            handler(event as PluginPlayerPathBlockedEvent);
          },
        });
      },
      onObjectInteraction: (
        handler: string | ((event: PluginObjectInteractionEvent) => void),
        actions?: Record<string, (event: PluginObjectInteractionEvent) => void | boolean>
      ) => {
        if (typeof handler !== "function" && (typeof handler !== "string" || !actions)) {
          return;
        }
        const order = PluginManager.nextObjectHookOrder++;
        if (typeof handler === "function") {
          PluginManager.objectInteractionHooks.push({ pluginName, order, handler });
          return;
        }
        const namedActions = new Map(Object.entries(actions).filter(([, action]) => typeof action === "function"));
        const hooks = PluginManager.objectHooksByName.get(handler) ?? [];
        hooks.push({
          pluginName,
          order,
          handler: (event) => {
            if (!Number.isInteger(event.clickType) || event.clickType < 1 || event.clickType > 5) return;
            const action = namedActions.get(event.definition?.getInteractions()?.[event.clickType - 1]);
            if (action && action(event) !== false) event.handled = true;
          },
        });
        PluginManager.objectHooksByName.set(handler, hooks);
      },
      onObjectRoute: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.objectRouteHooks.push({ pluginName, handler });
      },
      onNpcRoute: (handler) => {
        if (typeof handler === "function") PluginManager.npcRouteHooks.push({ pluginName, handler });
      },
      onNpcInteraction: (
        handler: string | ((event: PluginNpcInteractionEvent) => void),
        actions?: Record<string, (event: PluginNpcInteractionEvent) => void | boolean>
      ) => {
        if (typeof handler === "function") {
          PluginManager.npcInteractionHooks.push({ pluginName, handler });
        } else if (typeof handler === "string" && actions) {
          registerNpcActions(handler, actions);
        }
      },
      onAnyNpcInteraction: (actions) => registerNpcActions(null, actions),
      onNpcDialogueVariant: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.npcDialogueVariantHooks.push({ pluginName, handler });
      },
      onNpcDialogueCondition: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.npcDialogueConditionHooks.push({ pluginName, handler });
      },
      registerNpcInteraction: registerNpcInteractionDefinition,
      registerArea: (area) => {
        area.pluginName = pluginName;
        require("../game/model/areas/AreaManager").AreaManager.areas.push(area);
      },
      onNpcDeath: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.npcDeathHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.killer || !event.npc) {
              return;
            }
            handler(event);
          },
        });
      },
      onNpcBeforeDeath: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.npcBeforeDeathHooks.push({
          pluginName,
          handler: (event) => {
            if (event?.npc) {
              handler(event);
            }
          },
        });
      },
      onNpcHitModify: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.npcHitModifyHooks.push({
          pluginName,
          handler: (event) => {
            if (event?.npc && event?.hit) {
              handler(event);
            }
          },
        });
      },
      onCanAttack: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canAttackHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.attacker || !event.target) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanTeleport: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canTeleportHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanLogout: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canLogoutHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanEat: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canEatHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !Number.isInteger(event.itemId)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onFiremakingBlocked: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.firemakingBlockedHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.location) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanDrink: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canDrinkHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !Number.isInteger(event.itemId)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanTrade: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canTradeHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.target) {
              return;
            }
            handler(event);
          },
        });
      },
      onTradeRequest: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.tradeRequestHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.target) {
              return;
            }
            handler(event);
          },
        });
      },
      onTradeCompleted: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.tradeCompletedHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.partner || !Array.isArray(event.received)) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerFollow: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerFollowHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.leader) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerAttack: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerAttackHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.target) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanBank: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canBankHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanBankItem: (handler) => {
        if (typeof handler !== "function") return;
        PluginManager.canBankItemHooks.push({
          pluginName,
          handler: (event) => {
            if (!event?.player || !event.item) return;
            handler(event);
          },
        });
      },
      onCanShop: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canShopHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player) {
              return;
            }
            handler(event);
          },
        });
      },
      onShouldDropItemsOnDeath: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.shouldDropItemsOnDeathHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player) {
              return;
            }
            handler(event);
          },
        });
      },
      onShouldKeepItemOnDeath: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.shouldKeepItemOnDeathHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.item) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerDeathItemDrop: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerDeathItemDropHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.item) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanUseItem: (handler) => {
        if (typeof handler === "function") PluginManager.canUseItemHooks.push({ pluginName, handler });
      },
      onCanGainExperience: (handler) => {
        if (typeof handler === "function") PluginManager.canGainExperienceHooks.push({ pluginName, handler });
      },
      onCanSpawnNpc: (handler) => {
        if (typeof handler === "function") PluginManager.canSpawnNpcHooks.push({ pluginName, handler });
      },
      onCanStockItem: (handler) => {
        if (typeof handler === "function") PluginManager.canStockItemHooks.push({ pluginName, handler });
      },
      onPrayerDisabled: (handler) => {
        if (typeof handler === "function") PluginManager.prayerDisabledHooks.push({ pluginName, handler });
      },
      onCanEquip: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canEquipHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !event.item ||
              !Number.isInteger(event.slot)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onCanUnequip: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.canUnequipHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !event.item ||
              !Number.isInteger(event.slot)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerDeath: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerDeathHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || event.handled) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerOption: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerOptionHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !event.target ||
              event.handled ||
              !Number.isInteger(event.option)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerDealtDamage: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerDealtDamageHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.target || !event.hit) {
              return;
            }
            handler(event);
          },
        });
      },
      onCombatHitRoll: (handler) => {
        if (typeof handler !== "function") return;
        PluginManager.combatHitRollHooks.push({ pluginName, handler });
      },
      onAttackTiming: (handler) => {
        if (typeof handler !== "function") return;
        PluginManager.attackTimingHooks.push({ pluginName, handler });
      },
      onCombatHitResolved: (handler) => {
        if (typeof handler !== "function") return;
        PluginManager.combatHitResolvedHooks.push({ pluginName, handler });
      },
      onCombatAttackDistance: (handler) => {
        if (typeof handler !== "function") return;
        PluginManager.combatAttackDistanceHooks.push({ pluginName, handler });
      },
      onSpellDisabled: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.spellDisabledHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !Number.isInteger(event.spellId)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onSpellRuneBypass: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.spellRuneBypassHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              !event.player ||
              !Number.isInteger(event.spellId)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onNpcAggressionTolerance: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.npcAggressionToleranceHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.player || !event.npc) {
              return;
            }
            handler(event);
          },
        });
      },
      onPlayerDefeated: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.playerDefeatedHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || !event.victim) {
              return;
            }
            handler(event);
          },
        });
      },
      onNpcClick: (npcIds, clickType, handler) => {
        registerNpcClickHook(clickType, npcIds, handler);
      },
      onNpcFirstClick: (npcIds, handler) => {
        registerNpcClickHook(1, npcIds, handler, "first");
      },
      onNpcSecondClick: (npcIds, handler) => {
        registerNpcClickHook(2, npcIds, handler, "second");
      },
      onNpcThirdClick: (npcIds, handler) => {
        registerNpcClickHook(3, npcIds, handler, "third");
      },
      onNpcFourthClick: (npcIds, handler) => {
        registerNpcClickHook(4, npcIds, handler, "fourth");
      },
      onGroundItemClick: (itemIds, clickType, handler) => {
        if (!Number.isInteger(clickType) || clickType < 1 || clickType > 5) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid ground-item click hook registration itemIds=${JSON.stringify(itemIds)} clickType=${clickType}`
          );
          return;
        }

        registerGroundItemClickHook(clickType, itemIds, handler, "ground-item");
      },
      onGroundItemSecondClick: (itemIds, handler) => {
        registerGroundItemClickHook(2, itemIds, handler, "ground-item-second");
      },
      onGroundItemPickup: (handler) => {
        if (typeof handler !== "function") return;
        PluginManager.groundItemPickupHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.groundItem) return;
            handler(event);
          },
        });
      },
      onItemOnObject: (
        itemNameOrHandler: string | ((event: PluginItemOnObjectEvent) => void),
        objectNameOrFilter?: string | PluginItemUseFilter,
        namedHandler?: (event: PluginItemOnObjectEvent) => void | boolean,
        namedFilter?: PluginItemUseFilter
      ) => {
        const named = typeof itemNameOrHandler === "string";
        const handler: ((event: PluginItemOnObjectEvent) => void | boolean) | undefined = named ? namedHandler : itemNameOrHandler;
        const filter = named ? namedFilter : objectNameOrFilter as PluginItemUseFilter | undefined;
        if (named && typeof objectNameOrFilter !== "string") return;
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.itemOnObjectHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.object) {
              return;
            }
            if (filter?.noted !== undefined && (ItemDefinition.forId(event.itemId).isNoted() !== filter.noted)) return;
            if (named) {
              if (ItemDefinition.forId(event.itemId).getName() !== itemNameOrHandler
                || event.object.getDefinition()?.getName() !== objectNameOrFilter) return;
              if (handler(event) !== false) event.handled = true;
            } else {
              handler(event);
            }
          },
        });
      },
      onItemOnItem: (
        itemNameOrHandler: string | ((event: PluginItemOnItemEvent) => void),
        otherItemNameOrFilter?: string | PluginItemUseFilter,
        namedHandler?: (event: PluginItemOnItemEvent) => void | boolean,
        namedFilter?: PluginItemUseFilter
      ) => {
        const named = typeof itemNameOrHandler === "string";
        const handler: ((event: PluginItemOnItemEvent) => void | boolean) | undefined =
          named ? namedHandler : itemNameOrHandler;
        const filter = named ? namedFilter : otherItemNameOrFilter as PluginItemUseFilter | undefined;
        if (named && typeof otherItemNameOrFilter !== "string") return;
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.itemOnItemHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              !event.player ||
              !event.usedItem ||
              !event.usedWithItem
            ) {
              return;
            }
            if (filter?.noted !== undefined && (ItemDefinition.forId(event.usedItemId).isNoted() !== filter.noted || ItemDefinition.forId(event.usedWithItemId).isNoted() !== filter.noted)) return;
            if (named) {
              const usedName = event.usedItem.getDefinition().getName();
              const targetName = event.usedWithItem.getDefinition().getName();
              if (!((usedName === itemNameOrHandler && targetName === otherItemNameOrFilter)
                || (usedName === otherItemNameOrFilter && targetName === itemNameOrHandler))) return;
              if (handler(event) !== false) event.handled = true;
            } else {
              handler(event);
            }
          },
        });
      },
      onItemOnNpc: (handler, filter) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.itemOnNpcHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.target || !event.item) {
              return;
            }
            if (filter?.noted !== undefined && (ItemDefinition.forId(event.itemId).isNoted() !== filter.noted)) return;
            handler(event);
          },
        });
      },
      onItemOnPlayer: (handler, filter) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.itemOnPlayerHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              !event.player ||
              !event.target ||
              !event.item ||
              !Number.isInteger(event.itemId) ||
              !Number.isInteger(event.slot) ||
              !Number.isInteger(event.interfaceId) ||
              !Number.isInteger(event.targetIndex)
            ) {
              return;
            }
            if (filter?.noted !== undefined && (ItemDefinition.forId(event.itemId).isNoted() !== filter.noted)) return;
            handler(event);
          },
        });
      },
      onItemOnGroundItem: (handler, filter) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.itemOnGroundItemHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.inventoryItem) {
              return;
            }
            if (filter?.noted !== undefined && (ItemDefinition.forId(event.inventoryItemId).isNoted() !== filter.noted || ItemDefinition.forId(event.groundItemId).isNoted() !== filter.noted)) return;
            handler(event);
          },
        });
      },
      onSpellOnObject: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.spellOnObjectHooks.push({
          pluginName,
          handler: (event) => {
            if (!event || event.handled || !event.player || !event.object) {
              return;
            }
            handler(event);
          },
        });
      },
      onItemAction: (
        handler: string | ((event: PluginItemActionEvent) => void),
        actions?: Record<string, (event: PluginItemActionEvent) => void | boolean>
      ) => {
        if (typeof handler !== "function" && (typeof handler !== "string" || !actions)) {
          return;
        }
        const namedActions = new Map(Object.entries(actions ?? {}).filter(([, action]) => typeof action === "function"));
        PluginManager.itemActionHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              !event.player ||
              !event.item ||
              !Number.isInteger(event.slot) ||
              !Number.isInteger(event.itemId) ||
              !Number.isInteger(event.clickType)
            ) {
              return;
            }
            if (typeof handler === "function") {
              handler(event);
              return;
            }
            const definition = CacheDefinitions.getItem(event.itemId);
            if (definition?.name !== handler || event.clickType < 1 || event.clickType > 5) return;
            const option = definition.inventoryActions[event.clickType - 1];
            const action = namedActions.get(option);
            if (action && action(event) !== false) event.handled = true;
          },
        });
      },
      onItemDropPolicy: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.itemDropHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              !event.player ||
              !event.item ||
              !Number.isInteger(event.slot) ||
              !Number.isInteger(event.itemId) ||
              !Number.isInteger(event.interfaceId)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onItemFirstAction: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.itemActionHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              event.clickType !== 1 ||
              !event.player ||
              !event.item
            ) {
              return;
            }
            const result = handler(event);
            if (result !== false) {
              event.handled = true;
            }
          },
        });
      },
      onButtonClick: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.buttonClickHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              !event.player ||
              !Number.isInteger(event.buttonId)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      sendMultiChatboxPrompt: (
        player,
        title,
        ...optionCallbackPairs: Array<
          string | ((player: any, optionIndex: number, optionText: string) => void)
        >
      ) => {
        return MultiChatboxPrompt.showPrompt(
          pluginName,
          player,
          title,
          optionCallbackPairs
        );
      },
      getPluginConfig: <T>(key: string, defaultValue?: T) =>
        PluginManager.getPluginConfig<T>(key, defaultValue),
      onButton: (buttonIds, handler) => {
        registerButtonHook(buttonIds, handler, "button");
      },
      onInterfaceActionClick: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.interfaceActionClickHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              !event.player ||
              !Number.isInteger(event.buttonId) ||
              !Number.isInteger(event.action)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      onInterfaceActionButton: (buttonIds, handler) => {
        registerInterfaceActionButtonHook(
          buttonIds,
          handler,
          "interface_action_button"
        );
      },
      onCommand: (handler) => {
        if (typeof handler !== "function") {
          return;
        }
        PluginManager.commandHooks.push({
          pluginName,
          handler: (event) => {
            if (
              !event ||
              event.handled ||
              !event.player ||
              typeof event.raw !== "string" ||
              typeof event.base !== "string" ||
              !Array.isArray(event.parts)
            ) {
              return;
            }
            handler(event);
          },
        });
      },
      registerContentEndpoint: (name, handler) => {
        if (typeof name !== "string" || typeof handler !== "function") {
          return;
        }
        try {
          ContentApi.register(name, handler);
        } catch (error) {
          console.error(`[plugins] ${pluginName} content endpoint rejected`, error);
        }
      },
      registerCustomInterface: (definition) => {
        try {
          CustomInterfaceRegistry.register(definition as any);
        } catch (error) {
          console.error(`[plugins] ${pluginName} custom interface rejected`, error);
        }
      },
      getRegisteredCommands: (player) => PluginManager.getRegisteredCommands(player),
      registerCommand: (command, handler, minimumRights, description) => {
        if (typeof command !== "string" || typeof handler !== "function") {
          return;
        }
        const normalized = command.trim().toLowerCase();
        if (!normalized.length) {
          return;
        }
        PluginManager.commandRights.set(
          normalized,
          PluginManager.normalizeCommandRights(minimumRights)
        );

        const wrapper: PluginHook<PluginCommandEvent> & { description: string } = {
          pluginName,
          description: typeof description === "string" ? description.trim() : "",
          handler: (event) => {
            if (!event || event.handled) {
              return;
            }
            const result = handler(event);
            if (result !== false) {
              event.handled = true;
            }
          },
        };

        const existing =
          PluginManager.commandHandlersByBase.get(normalized) ?? [];
        existing.push(wrapper);
        PluginManager.commandHandlersByBase.set(normalized, existing);
      },
      setCommandRights: (command, minimumRights) => {
        PluginManager.setCommandRights(command, minimumRights);
      },
      onObjectClick: (objectIds, clickType, handler) => {
        if (!Number.isInteger(clickType) || clickType < 1 || clickType > 5) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid object click hook registration objectIds=${JSON.stringify(objectIds)} clickType=${clickType}`
          );
          return;
        }

        registerObjectClickHook(clickType, objectIds, handler, "object");
      },
      onObjectFirstClick: (objectIds, handler) => {
        registerObjectClickHook(1, objectIds, handler, "first");
      },
      onObjectSecondClick: (objectIds, handler) => {
        registerObjectClickHook(2, objectIds, handler, "second");
      },
      onObjectThirdClick: (objectIds, handler) => {
        registerObjectClickHook(3, objectIds, handler, "third");
      },
      onObjectFourthClick: (objectIds, handler) => {
        registerObjectClickHook(4, objectIds, handler, "fourth");
      },
      onObjectFifthClick: (objectIds, handler) => {
        registerObjectClickHook(5, objectIds, handler, "fifth");
      },
      replaceMapRegion: (regionId, source) => {
        if (!Number.isInteger(regionId) || regionId < 0 || regionId > 0xffff) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid replaceMapRegion regionId=${regionId}`
          );
          return;
        }
        const validSourceArray =
          Array.isArray(source) &&
          source.length === 2 &&
          typeof source[0] === "string" &&
          typeof source[1] === "string";
        const validSource = typeof source === "string" || validSourceArray;
        if (!validSource) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid replaceMapRegion source`
          );
          return;
        }

        try {
          const result = MapRegionReplacementManager.replaceMapRegion(
            regionId,
            source as string | [string, string]
          );

          let clippingReloaded = false;
          try {
            const collisionModule = require("../game/collision/RegionManager");
            clippingReloaded =
              collisionModule?.RegionManager?.reloadRegion?.(regionId) === true;
          } catch (reloadErr) {
            console.error(
              `[plugins] ${pluginName} failed to reload clipping for region ${regionId}`,
              reloadErr
            );
          }

          let streamedPlayers = 0;
          try {
            const worldModule = require("../game/World");
            const World = worldModule?.World;
            if (World?.getPlayers && World?.isPlayerSessionConnected) {
              const players = World.getPlayers();
              players?.forEach?.((player: any) => {
                if (!player || !World.isPlayerSessionConnected(player)) {
                  return;
                }
                if (MapRegionReplacementManager.sendReplacementToPlayer(player, regionId)) {
                  streamedPlayers++;
                }
              });
            }
          } catch (streamErr) {
            console.error(
              `[plugins] ${pluginName} failed to stream region replacement ${regionId}`,
              streamErr
            );
          }

          console.info(`[plugins] ${pluginName} replaced map region`, {
            regionId,
            source: result.source,
            terrainBytes: result.terrainBytes,
            objectBytes: result.objectBytes,
            objectCount: result.objectCount,
            clippingReloaded,
            streamedPlayers,
          });
        } catch (err) {
          console.error(
            `[plugins] ${pluginName} failed to replace map region ${regionId}`,
            err
          );
        }
      },
      registerDefinitionSource: (definitionType, source) => {
        try {
          DefinitionLoader.registerSource(definitionType, pluginName, source);
        } catch (error) {
          console.warn(
            `[plugins] ${pluginName} failed to register definition source ${String(
              definitionType
            )}`,
            error
          );
          throw error;
        }
      },
      registerShopCurrency: (name, handler) => {
        ShopManager.registerCurrency(name, handler);
      },
      registerItemShopCurrency: (itemId, options) => {
        ShopManager.registerItemCurrency(itemId, options);
      },
      persistAttribute: (key) => PlayerSave.persistAttribute(key),
      setPlayerPersistence: (persistence) => {
        if (
          !persistence ||
          typeof (persistence as any).load !== "function" ||
          typeof (persistence as any).save !== "function" ||
          typeof (persistence as any).exists !== "function"
        ) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid player persistence registration`
          );
          return;
        }

        const previousName =
          GameConstants.PLAYER_PERSISTENCE?.constructor?.name ?? "unknown";
        const nextName = (persistence as any).constructor?.name ?? "unknown";
        GameConstants.setPlayerPersistence(persistence);
        PluginManager.lastPersistenceOverride =
          `[plugins] player persistence set by ${pluginName}: ${previousName} -> ${nextName}`;
      },
      setExperienceRate: (rate) => GameConstants.setExperienceRate(rate),
      getActiveRegionSnapshot: () => {
        try {
          const worldModule = require("../game/World");
          const World = worldModule?.World;
          return World?.getActiveRegionSnapshot?.() ?? {
            processCycle: 0,
            updatedAtMs: 0,
            radius: 0,
            regions: [],
            regionKeys: [],
          };
        } catch (err) {
          console.error(
            `[plugins] ${pluginName} failed to read active region snapshot`,
            err
          );
          return {
            processCycle: 0,
            updatedAtMs: 0,
            radius: 0,
            regions: [],
            regionKeys: [],
          };
        }
      },
      getWorld: () => require("../game/World").World,
      getTaskManager: () => require("../game/task/TaskManager").TaskManager,
      getRegionManager: () =>
        require("../game/collision/RegionManager").RegionManager,
      getCombatFactory: () =>
        require("../game/content/combat/CombatFactory").CombatFactory,
      getAreaManager: () =>
        require("../game/model/areas/AreaManager").AreaManager,
      getPrayerHandler: () =>
        require("../game/content/PrayerHandler").PrayerHandler,
      getBonusManager: () =>
        require("../game/model/equipment/BonusManager").BonusManager,
      getItemOnGroundManager: () =>
        require("../game/entity/impl/grounditem/ItemOnGroundManager")
          .ItemOnGroundManager,
      getObjectManager: () =>
        require("../game/entity/impl/object/ObjectManager").ObjectManager,
      getServerPerf: () => require("../util/ServerPerf").ServerPerf,
      getSkillManager: () =>
        require("../game/content/skill/SkillManager").SkillManager,
      getPlayerPunishment: () =>
        require("../util/PlayerPunishment").PlayerPunishment,
      emitCanEat: (player, itemId) => PluginManager.emitCanEat(player, itemId),
      emitCanDrink: (player, itemId) => PluginManager.emitCanDrink(player, itemId),
      emitCanBank: (player) => PluginManager.emitCanBank(player),
      emitCanBankItem: (player, item) => PluginManager.emitCanBankItem(player, item),
      emitShouldKeepItemOnDeath: (player, item) =>
        PluginManager.emitShouldKeepItemOnDeath(player, item),
      emitFiremakingBlocked: (event) => PluginManager.emitFiremakingBlocked(event),
      emitObjectInteraction: (event) => PluginManager.emitObjectInteraction(event),
      emitPlayerLogin: (event) => PluginManager.emitPlayerLogin(event),
      emitCustomEvent: (eventName, payload) =>
        PluginManager.emitCustomEvent(eventName, payload),
      getPluginPerformanceSnapshot: (limit) =>
        PluginManager.getPluginPerformanceSnapshot(limit),
      resetPluginPerformanceStats: () => PluginManager.resetPluginPerformanceStats(),
      setPluginPerformanceProfilingEnabled: (enabled) =>
        PluginManager.setPluginPerformanceProfilingEnabled(enabled),
      isPluginPerformanceProfilingEnabled: () =>
        PluginManager.isPluginPerformanceProfilingEnabled(),
      registerCombatEffectiveLevelModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerCombatEffectiveLevelModifier(modifier),
      registerMeleeHitModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerMeleeHitModifier(
          modifier
        ),
      registerRangedHitModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerRangedHitModifier(
          modifier
        ),
      registerMagicHitModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerMagicHitModifier(
          modifier
        ),
      registerMagicDamageBonusModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerMagicDamageBonusModifier(
          modifier
        ),
      registerMeleeAttackAccuracyModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerMeleeAttackAccuracyModifier(
          modifier
        ),
      registerMeleeDefenseModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerMeleeDefenseModifier(
          modifier
        ),
      registerRangedDefenseModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerRangedDefenseModifier(
          modifier
        ),
      registerRangedAttackAccuracyModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerRangedAttackAccuracyModifier(
          modifier
        ),
      registerMagicAttackAccuracyModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerMagicAttackAccuracyModifier(
          modifier
        ),
      registerMagicDefenseModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerMagicDefenseModifier(
          modifier
        ),
      registerRunEnergyRestoreModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerRunEnergyRestoreModifier(
          modifier
        ),
      registerIncomingDamageModifier: (modifier) =>
        require("../game/content/combat/EquipmentEffects").registerIncomingDamageModifier(
          modifier
        ),
      setCombatEngine: (engine) => {
        if (!engine || typeof engine.getMethod !== "function") {
          console.warn(
            `[plugins] ${pluginName} attempted invalid combat engine registration`
          );
          return;
        }
        PluginManager.setCombatEngineInternal(pluginName, engine);
      },
      setCombatDamageProvider: (provider) => {
        if (
          !provider ||
          typeof provider.calculateMaxMeleeHit !== "function" ||
          typeof provider.calculateMaxRangedHit !== "function" ||
          typeof provider.calculateMagicMaxHit !== "function" ||
          typeof provider.getHitDamage !== "function" ||
          typeof provider.applyExtraHitRolls !== "function"
        ) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid combat damage provider registration`
          );
          return;
        }
        PluginManager.setCombatDamageProviderInternal(pluginName, provider);
      },
      registerBonusProvider: (provider) => {
        if (!provider || typeof provider.apply !== "function") {
          console.warn(
            `[plugins] ${pluginName} attempted invalid bonus provider registration`
          );
          return;
        }
        PluginManager.registerBonusProviderInternal(pluginName, provider);
      },
      registerRangedAmmoResolver: (resolver) => {
        if (!resolver || typeof resolver.resolve !== "function") {
          console.warn(
            `[plugins] ${pluginName} attempted invalid ranged ammo resolver registration`
          );
          return;
        }
        PluginManager.registerRangedAmmoResolverInternal(pluginName, resolver);
      },
      registerRangedAmmoHandler: (handler) => {
        if (
          !handler ||
          typeof handler.checkAmmo !== "function" ||
          typeof handler.decrementAmmo !== "function"
        ) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid ranged ammo handler registration`
          );
          return;
        }
        PluginManager.registerRangedAmmoHandlerInternal(pluginName, handler);
      },
      registerSpellRuneSource: (source) => {
        if (
          !source ||
          typeof source.check !== "function" ||
          typeof source.consume !== "function"
        ) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid spell rune source registration`
          );
          return;
        }
        PluginManager.registerSpellRuneSourceInternal(pluginName, source);
      },
      registerRangedAmmoRecovery: (recovery) => {
        if (!recovery || typeof recovery.recovery !== "function") {
          console.warn(
            `[plugins] ${pluginName} attempted invalid ranged ammo recovery registration`
          );
          return;
        }
        PluginManager.registerRangedAmmoRecoveryInternal(pluginName, recovery);
      },
      registerRangedCombatModifier: (modifier) => {
        if (
          !modifier ||
          typeof modifier.modifyMaxHit !== "function" ||
          typeof modifier.modifyAttackRoll !== "function"
        ) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid ranged combat modifier registration`
          );
          return;
        }
        PluginManager.registerRangedCombatModifierInternal(pluginName, modifier);
      },
      registerWeaponProfile: (profile) => {
        if (!Array.isArray(profile?.itemIds) || !profile.itemIds.every((id) => Number.isInteger(id) && id > 0)) {
          console.warn(`[plugins] ${pluginName} attempted invalid weapon profile registration`);
          return;
        }
        WeaponProfiles.register(profile);
      },
      registerCombatSpecial: (definition) => {
        if (
          !definition ||
          typeof definition.id !== "string" ||
          !definition.id.trim().length ||
          !Array.isArray(definition.itemIds) ||
          definition.itemIds.length === 0 ||
          definition.itemIds.some((id) => !Number.isInteger(id) || id <= 0) ||
          !definition.combatMethod ||
          typeof definition.combatMethod.type !== "function"
        ) {
          console.warn(
            `[plugins] ${pluginName} attempted invalid combat special registration`
          );
          return;
        }
        const registered = CombatSpecial.register(definition as PluginCombatSpecialDefinition);
        if (!registered) {
          console.warn(
            `[plugins] ${pluginName} failed to register combat special ${definition.id}`
          );
        }
      },
      registerCombatMethodResolver: (resolver) => {
        if (!resolver || typeof resolver.resolve !== "function") {
          console.warn(
            `[plugins] ${pluginName} attempted invalid combat method resolver registration`
          );
          return;
        }
        PluginManager.registerCombatMethodResolverInternal(pluginName, resolver);
      },
      registerNpcCombatMethodProvider: (npcIds, methodCtor, options) => {
        const normalized = Array.isArray(npcIds) ? npcIds : [npcIds];
        if (
          !normalized.length ||
          normalized.some((id) => !Number.isInteger(id))
        ) {
          console.warn(
            `[plugins] ${pluginName} provided invalid npc ids for combat method registration`
          );
          return;
        }
        if (!methodCtor || typeof methodCtor !== "function") {
          console.warn(
            `[plugins] ${pluginName} provided invalid combat method constructor`
          );
          return;
        }
        const singleton = options?.singleton ?? true;
        let instance: any | null = null;
        const npcIdSet = new Set(normalized);
        const provider = {
          provide: (npc) => {
            const npcId = npc?.getId?.() ?? npc?.id;
            const npcRealId = npc?.getRealId?.() ?? npcId;
            if (!npcIdSet.has(npcId) && !npcIdSet.has(npcRealId)) {
              return null;
            }
            if (singleton) {
              if (!instance) {
                instance = new methodCtor();
              }
              return instance;
            }
            return new methodCtor();
          },
        };
        PluginManager.registerNpcCombatMethodProviderInternal(
          pluginName,
          provider,
          normalized
        );
      },
      log: (message, extra) => {

        if (extra && Object.keys(extra).length > 0) {
          console.log(`[plugin:${pluginName}] ${message}`, extra);
        } else {
          console.log(`[plugin:${pluginName}] ${message}`);
        }
      },
    };
  }

  public static getCombatEngine(): PluginCombatEngine | null {
    return PluginManager.combatEngine;
  }

  public static getCombatDamageProvider(): PluginCombatDamageProvider | null {
    return PluginManager.combatDamageProvider;
  }

  public static applyBonusProviders(player: any, bonuses: number[]): void {
    if (!player || !Array.isArray(bonuses)) {
      return;
    }
    const event: PluginBonusEvent = { player, bonuses };
    for (const entry of PluginManager.bonusProviders) {
      try {
        entry.provider.apply(event);
      } catch (err) {
        console.error(
          `[plugins] bonus provider failed (${entry.pluginName})`,
          err
        );
      }
    }
  }

  public static resolveRangedAmmunition(player: any): any | null {
    for (const entry of PluginManager.rangedAmmoResolvers) {
      try {
        const resolved = entry.resolver.resolve(player);
        if (resolved != null) {
          return resolved;
        }
      } catch (err) {
        console.error(
          `[plugins] ranged ammo resolver failed (${entry.pluginName})`,
          err
        );
      }
    }
    return null;
  }

  public static checkRangedAmmo(player: any, amountRequired: number, silent = false): boolean | null {
    for (const entry of PluginManager.rangedAmmoHandlers) {
      try {
        const result = entry.handler.checkAmmo(player, amountRequired, silent);
        if (result != null) {
          return result === true;
        }
      } catch (err) {
        console.error(
          `[plugins] ranged ammo check failed (${entry.pluginName})`,
          err
        );
      }
    }
    return null;
  }

  public static decrementRangedAmmo(player: any, pos: any, amount: number, delayTicks = 0): boolean {
    for (const entry of PluginManager.rangedAmmoHandlers) {
      try {
        if (entry.handler.decrementAmmo(player, pos, amount, delayTicks) === true) {
          return true;
        }
      } catch (err) {
        console.error(
          `[plugins] ranged ammo decrement failed (${entry.pluginName})`,
          err
        );
      }
    }
    return false;
  }

  /** The first source that can supply every missing item answers true, or false when none can. */
  public static checkSpellRuneSource(player: any, missingItems: any[]): boolean {
    if (!Array.isArray(missingItems) || missingItems.length === 0) {
      return false;
    }
    for (const entry of PluginManager.spellRuneSources) {
      try {
        if (entry.source.check(player, missingItems) === true) {
          return true;
        }
      } catch (err) {
        console.error(
          `[plugins] spell rune source check failed (${entry.pluginName})`,
          err
        );
      }
    }
    return false;
  }

  /** Deducts the shortfall from the first source that can supply it, leaving the rest alone. */
  public static consumeSpellRuneSource(player: any, missingItems: any[]): void {
    if (!Array.isArray(missingItems) || missingItems.length === 0) {
      return;
    }
    for (const entry of PluginManager.spellRuneSources) {
      try {
        if (entry.source.check(player, missingItems) === true) {
          entry.source.consume(player, missingItems);
          return;
        }
      } catch (err) {
        console.error(
          `[plugins] spell rune source consume failed (${entry.pluginName})`,
          err
        );
      }
    }
  }

  /** The first plugin-declared recovery share for this player's shot, or 0 when none applies. */
  public static rangedAmmoRecovery(player: any): number {
    for (const entry of PluginManager.rangedAmmoRecoveries) {
      try {
        const recovery = entry.recovery.recovery(player);
        if (recovery != null && Number.isFinite(recovery)) {
          return Math.max(0, Math.min(100, Math.floor(recovery)));
        }
      } catch (err) {
        console.error(
          `[plugins] ranged ammo recovery failed (${entry.pluginName})`,
          err
        );
      }
    }
    return 0;
  }

  public static modifyRangedMaxHit(attacker: any, target: any, maxHit: number): number {
    let current = Number.isFinite(maxHit) ? Math.max(0, Math.floor(maxHit)) : 0;
    for (const entry of PluginManager.rangedCombatModifiers) {
      try {
        const modified = entry.modifier.modifyMaxHit(attacker, target, current);
        if (modified != null && Number.isFinite(modified)) {
          current = Math.max(0, Math.floor(modified));
        }
      } catch (err) {
        console.error(
          `[plugins] ranged max hit modifier failed (${entry.pluginName})`,
          err
        );
      }
    }
    return current;
  }

  public static modifyRangedAttackRoll(attacker: any, target: any, attackRoll: number): number {
    let current = Number.isFinite(attackRoll) ? Math.max(0, Math.floor(attackRoll)) : 0;
    for (const entry of PluginManager.rangedCombatModifiers) {
      try {
        const modified = entry.modifier.modifyAttackRoll(attacker, target, current);
        if (modified != null && Number.isFinite(modified)) {
          current = Math.max(0, Math.floor(modified));
        }
      } catch (err) {
        console.error(
          `[plugins] ranged attack roll modifier failed (${entry.pluginName})`,
          err
        );
      }
    }
    return current;
  }

  public static getCombatMethodResolvers(): PluginCombatMethodResolver[] {
    return PluginManager.combatMethodResolvers.slice();
  }

  public static getNpcCombatMethodProviders(): PluginNpcCombatMethodProviderEntry[] {
    return PluginManager.npcCombatMethodProviders.slice();
  }

  private static setCombatEngineInternal(
    pluginName: string,
    engine: PluginCombatEngine
  ): void {
    if (!engine) {
      return;
    }
    if (PluginManager.combatEngine) {
      console.warn(
        `[plugins] combat engine overridden (${PluginManager.combatEngineOwner ?? "unknown"} -> ${pluginName})`
      );
    }
    PluginManager.combatEngine = engine;
    PluginManager.combatEngineOwner = pluginName;
  }

  private static setCombatDamageProviderInternal(
    pluginName: string,
    provider: PluginCombatDamageProvider
  ): void {
    if (!provider) {
      return;
    }
    if (PluginManager.combatDamageProvider) {
      console.warn(
        `[plugins] combat damage provider overridden (${PluginManager.combatDamageProviderOwner ?? "unknown"} -> ${pluginName})`
      );
    }
    PluginManager.combatDamageProvider = provider;
    PluginManager.combatDamageProviderOwner = pluginName;
  }

  private static registerBonusProviderInternal(
    pluginName: string,
    provider: PluginBonusProvider
  ): void {
    PluginManager.bonusProviders.push({ pluginName, provider });
  }

  private static registerRangedAmmoResolverInternal(
    pluginName: string,
    resolver: PluginRangedAmmoResolver
  ): void {
    PluginManager.rangedAmmoResolvers.push({ pluginName, resolver });
  }

  private static registerRangedAmmoHandlerInternal(
    pluginName: string,
    handler: PluginRangedAmmoHandler
  ): void {
    PluginManager.rangedAmmoHandlers.push({ pluginName, handler });
  }

  private static registerSpellRuneSourceInternal(
    pluginName: string,
    source: PluginSpellRuneSource
  ): void {
    PluginManager.spellRuneSources.push({ pluginName, source });
  }

  private static registerRangedAmmoRecoveryInternal(
    pluginName: string,
    recovery: PluginRangedAmmoRecovery
  ): void {
    PluginManager.rangedAmmoRecoveries.push({ pluginName, recovery });
  }

  private static registerRangedCombatModifierInternal(
    pluginName: string,
    modifier: PluginRangedCombatModifier
  ): void {
    PluginManager.rangedCombatModifiers.push({ pluginName, modifier });
  }

  private static registerCombatMethodResolverInternal(
    pluginName: string,
    resolver: PluginCombatMethodResolver
  ): void {
    PluginManager.combatMethodResolvers.push(resolver);
  }

  private static registerNpcCombatMethodProviderInternal(
    pluginName: string,
    provider: PluginNpcCombatMethodProvider,
    npcIds: number[]
  ): void {
    PluginManager.npcCombatMethodProviders.push({
      pluginName,
      provider,
      npcIds: new Set(npcIds),
    });
  }
}
