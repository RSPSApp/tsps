import { PlayerSyncContext } from "../../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../../game/sync/PlayerUpdateDecoder";
import type { PlayerSyncFrame } from "../../game/sync/PlayerSyncTypes";
import type { ProjectileLaunch } from "../../common/projectiles/ProjectileLaunch";
import { CombatStateStore } from "../combat/CombatStateStore";
import type { GameSocket, WebRtcConnectionConfig } from "./connection/GameSocket";
import { DEFAULT_URL } from "./constants";
import {
    createDefaultShopState,
    createDefaultSmithingState,
    createDefaultTradeState,
} from "./domain/defaults";
import type {
    BankServerUpdate,
    ChatMessageEvent,
    CollectionLogServerPayload,
    CollectionLogSlotMessage,
    GroundItemsServerPayload,
    FriendsChatSnapshot,
    InventoryServerUpdate,
    InventorySlotMessage,
    NpcInfoPayload,
    NotificationEvent,
    RunEnergyState,
    ShopWindowState,
    SkillEntryMessage,
    SmithingWindowState,
    SpellResultPayload,
    SpotAnimationPayload,
    TradeWindowState,
} from "./types";
import type { SkillsUpdateEvent } from "./types/sync";
import type {
    RebuildNormalPayload,
    RebuildRegionPayload,
    RebuildWorldEntityPayload,
    WorldEntityInfoPayload,
} from "./types/sync";
import type { WidgetServerPayload } from "./types/widgets";

export type GroundItemsSnapshotPayload = Extract<GroundItemsServerPayload, { kind: "snapshot" }>;

export type InternalSkillsState = {
    totalLevel: number;
    combatLevel: number;
    byId: Map<number, SkillEntryMessage>;
};

export type PlayerAnimPayload = {
    idle?: number;
    walk?: number;
    walkBack?: number;
    walkLeft?: number;
    walkRight?: number;
    turnLeft?: number;
    turnRight?: number;
    run?: number;
    runBack?: number;
    runLeft?: number;
    runRight?: number;
};

export type PathCallback = (res: {
    ok: boolean;
    waypoints?: { x: number; y: number }[];
    message?: string;
}) => void;

export const state = {
    socket: null as GameSocket | null,
    lastUrl: DEFAULT_URL,
    webRtcConfig: undefined as WebRtcConnectionConfig | undefined,
    reconnectTimer: null as ReturnType<typeof setTimeout> | null,
    reconnectDelayMs: 250,
    reconnectAttempts: 0,
    isReconnecting: false,
    loginConnectRetryTimer: null as ReturnType<typeof setTimeout> | null,
    loginConnectAttemptId: 0,
    sessionUsername: null as string | null,
    sessionPassword: null as string | null,
    sessionRevision: 0,
    currentTick: 0,
    serverTickMs: 600,
    serverClockOffsetMs: 0,
    lastTickServerTimeMs: 0,
    lastTickLocalRecvMs: 0,
    clientCycleProvider: undefined as (() => number | undefined | null) | undefined,
    clientCycleFallbackStartMs: 0,
    clientCycleFallbackBaseCycle: 0,
    nextReqId: 1,
    autoSendHandshake: true,
    playerSyncContext: null as PlayerSyncContext | null,
    playerUpdateDecoder: null as PlayerUpdateDecoder | null,
    lastWelcome: undefined as { tickMs: number; serverTime: number } | undefined,
    lastAnim: undefined as PlayerAnimPayload | undefined,
    lastHandshake: undefined as
        | {
              id: number;
              appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
              name?: string;
              chatIcons?: number[];
              chatPrefix?: string;
              isAdmin?: boolean;
              membersWorld?: boolean;
          }
        | undefined,
    lastInventorySnapshot: undefined as InventorySlotMessage[] | undefined,
    lastCollectionLogSnapshot: undefined as CollectionLogSlotMessage[] | undefined,
    lastBankState: undefined as { capacity: number; slots: import("./types").BankSlotMessage[] } | undefined,
    lastShopState: createDefaultShopState(),
    lastTradeState: createDefaultTradeState(),
    lastSkillsState: undefined as InternalSkillsState | undefined,
    lastGroundItems: undefined as GroundItemsSnapshotPayload | undefined,
    lastFriendsChat: undefined as FriendsChatSnapshot | undefined,
    lastRunEnergyState: undefined as RunEnergyState | undefined,
    lastSpellResult: undefined as SpellResultPayload | undefined,
    lastServerPath: undefined as { x: number; y: number }[] | undefined,
    animDebugProvider: null as (() => any) | null,
    lastSmithingState: createDefaultSmithingState(),
    lastSystemUpdate: undefined as { remainingCentis: number; receivedAtMs: number } | undefined,
    combatStateStore: new CombatStateStore(),
    pending: new Map<number, PathCallback>(),
    tickListeners: new Set<(tick: number, time: number) => void>(),
    npcInfoListeners: new Set<(payload: NpcInfoPayload) => void>(),
    spellResultListeners: new Set<(payload: SpellResultPayload) => void>(),
    projectileListeners: new Set<(spawn: ProjectileLaunch) => void>(),
    soundListeners: new Set<
        (payload: {
            soundId: number;
            x?: number;
            y?: number;
            level?: number;
            loops?: number;
            delay?: number;
            radius?: number;
            attenuation?: number;
        }) => void
    >(),
    playSongListeners: new Set<
        (payload: {
            trackId: number;
            fadeOutDelay?: number;
            fadeOutDuration?: number;
            fadeInDelay?: number;
            fadeInDuration?: number;
        }) => void
    >(),
    playJingleListeners: new Set<(payload: { jingleId: number; delay?: number }) => void>(),
    animListeners: new Set<(anim: PlayerAnimPayload) => void>(),
    pathDebugListeners: new Set<(waypoints: { x: number; y: number }[] | undefined) => void>(),
    rebuildRegionListeners: new Set<(payload: RebuildRegionPayload) => void>(),
    rebuildNormalListeners: new Set<(payload: RebuildNormalPayload) => void>(),
    rebuildWorldEntityListeners: new Set<(payload: RebuildWorldEntityPayload) => void>(),
    worldEntityInfoListeners: new Set<(payload: WorldEntityInfoPayload) => void>(),
    welcomeListeners: new Set<(info: { tickMs: number; serverTime: number }) => void>(),
    loginResponseListeners: new Set<
        (info: { success: boolean; error?: string; displayName?: string }) => void
    >(),
    logoutResponseListeners: new Set<(info: { success: boolean; reason?: string }) => void>(),
    handshakeListeners: new Set<
        (info: {
            id: number;
            appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
            name?: string;
            chatIcons?: number[];
            chatPrefix?: string;
            isAdmin?: boolean;
            membersWorld?: boolean;
        }) => void
    >(),
    inventoryListeners: new Set<(update: InventoryServerUpdate) => void>(),
    collectionLogListeners: new Set<(update: CollectionLogServerPayload) => void>(),
    widgetListeners: new Set<(payload: WidgetServerPayload) => void>(),
    skillsListeners: new Set<(update: SkillsUpdateEvent) => void>(),
    runEnergyListeners: new Set<(state: RunEnergyState) => void>(),
    bankListeners: new Set<(payload: BankServerUpdate) => void>(),
    shopListeners: new Set<(state: ShopWindowState) => void>(),
    tradeListeners: new Set<(state: TradeWindowState) => void>(),
    chatMessageListeners: new Set<(msg: ChatMessageEvent) => void>(),
    friendsChatListeners: new Set<(snapshot: FriendsChatSnapshot) => void>(),
    notificationListeners: new Set<(event: NotificationEvent) => void>(),
    systemUpdateListeners: new Set<(info: { remainingCentis: number }) => void>(),
    groundItemListeners: new Set<(payload: GroundItemsServerPayload) => void>(),
    playerSyncListeners: new Set<(frame: PlayerSyncFrame) => void>(),
    disconnectListeners: new Set<
        (evt: { code: number; reason: string; willReconnect: boolean }) => void
    >(),
    reconnectFailedListeners: new Set<() => void>(),
    smithingListeners: new Set<(state: SmithingWindowState) => void>(),
    spotListeners: new Set<(payload: SpotAnimationPayload) => void>(),
};

export function cloneRunEnergyState(s: RunEnergyState): RunEnergyState {
    return { ...s, stamina: s.stamina ? { ...s.stamina } : undefined };
}
