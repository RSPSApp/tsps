import { cloneRunEnergyState, state } from "../state";
import { cloneShopState, cloneSmithingState, cloneTradeState } from "../domain/defaults";
import { cloneGroundItemsPayload } from "../utils/groundItems";
import type {
    BankServerUpdate,
    ChatMessageEvent,
    CollectionLogServerPayload,
    GroundItemsServerPayload,
    FriendsChatSnapshot,
    InventoryServerUpdate,
    NotificationEvent,
    RunEnergyState,
    ShopWindowState,
    SkillEntryMessage,
    SmithingWindowState,
    SpellResultPayload,
    TradeWindowState,
} from "../types";
import type { SkillsUpdateEvent } from "../types/sync";
import type { WidgetServerPayload } from "../types/widgets";
import type { CombatStatePayload } from "../../combat/CombatStateStore";

export function subscribeAnim(
    cb: (anim: {
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
    }) => void,
): () => void {
    state.animListeners.add(cb);
    if (state.lastAnim) {
        try {
            cb(state.lastAnim);
        } catch {}
    }
    return () => state.animListeners.delete(cb);
}

export function subscribeWelcome(
    cb: (info: { tickMs: number; serverTime: number }) => void,
): () => void {
    state.welcomeListeners.add(cb);
    if (state.lastWelcome) {
        try {
            cb(state.lastWelcome);
        } catch {}
    }
    return () => state.welcomeListeners.delete(cb);
}

export function subscribeHandshake(
    cb: (info: {
        id: number;
        appearance?: { gender: number; colors?: number[]; kits?: number[]; equip?: number[] };
        name?: string;
        chatIcons?: number[];
        chatPrefix?: string;
        isAdmin?: boolean;
        membersWorld?: boolean;
    }) => void,
): () => void {
    state.handshakeListeners.add(cb);
    if (state.lastHandshake) {
        try {
            cb(state.lastHandshake);
        } catch {}
    }
    return () => state.handshakeListeners.delete(cb);
}

export function subscribeInventory(cb: (update: InventoryServerUpdate) => void): () => void {
    state.inventoryListeners.add(cb);
    if (state.lastInventorySnapshot) {
        cb({
            kind: "snapshot",
            slots: state.lastInventorySnapshot.map((slot) => ({ ...slot })),
        });
    }
    return () => state.inventoryListeners.delete(cb);
}

export function subscribeCollectionLog(
    cb: (update: CollectionLogServerPayload) => void,
): () => void {
    state.collectionLogListeners.add(cb);
    if (state.lastCollectionLogSnapshot) {
        cb({
            kind: "snapshot",
            slots: state.lastCollectionLogSnapshot.map((slot) => ({ ...slot })),
        });
    }
    return () => state.collectionLogListeners.delete(cb);
}

export function subscribeBank(cb: (update: BankServerUpdate) => void): () => void {
    state.bankListeners.add(cb);
    if (state.lastBankState) {
        try {
            cb({
                kind: "snapshot",
                capacity: state.lastBankState.capacity,
                slots: state.lastBankState.slots.map((slot) => ({ ...slot })),
            });
        } catch (err) {
            console.warn("bank listener error", err);
        }
    }
    return () => state.bankListeners.delete(cb);
}

export function subscribeShop(cb: (state: ShopWindowState) => void): () => void {
    state.shopListeners.add(cb);
    try {
        cb(cloneShopState(state.lastShopState));
    } catch (err) {
        console.warn("shop listener error", err);
    }
    return () => state.shopListeners.delete(cb);
}

export function subscribeSmithing(cb: (state: SmithingWindowState) => void): () => void {
    state.smithingListeners.add(cb);
    try {
        cb(cloneSmithingState(state.lastSmithingState));
    } catch (err) {
        console.warn("smelting listener error", err);
    }
    return () => state.smithingListeners.delete(cb);
}

export function subscribeTrade(cb: (state: TradeWindowState) => void): () => void {
    state.tradeListeners.add(cb);
    try {
        cb(cloneTradeState(state.lastTradeState));
    } catch (err) {
        console.warn("trade listener error", err);
    }
    return () => state.tradeListeners.delete(cb);
}

export function subscribeGroundItems(cb: (payload: GroundItemsServerPayload) => void): () => void {
    state.groundItemListeners.add(cb);
    if (state.lastGroundItems) {
        try {
            cb(cloneGroundItemsPayload(state.lastGroundItems));
        } catch (err) {
            console.warn("ground item listener error", err);
        }
    }
    return () => state.groundItemListeners.delete(cb);
}

export function subscribeChatMessages(cb: (msg: ChatMessageEvent) => void): () => void {
    state.chatMessageListeners.add(cb);
    return () => state.chatMessageListeners.delete(cb);
}

export function subscribeFriendsChat(cb: (snapshot: FriendsChatSnapshot) => void): () => void {
    state.friendsChatListeners.add(cb);
    if (state.lastFriendsChat) cb(state.lastFriendsChat);
    return () => state.friendsChatListeners.delete(cb);
}

export function subscribeNotifications(cb: (event: NotificationEvent) => void): () => void {
    state.notificationListeners.add(cb);
    return () => state.notificationListeners.delete(cb);
}

export function subscribeSystemUpdate(
    cb: (info: { remainingCentis: number }) => void,
): () => void {
    state.systemUpdateListeners.add(cb);
    const last = state.lastSystemUpdate;
    if (last && last.remainingCentis > 0) {
        try {
            cb({ remainingCentis: last.remainingCentis });
        } catch {}
    }
    return () => state.systemUpdateListeners.delete(cb);
}

/**
 * Emit a client-side chat message (for testing purposes).
 * This triggers all chat message listeners as if a message came from the server.
 */
export function emitTestChatMessage(text: string, messageType: string = "game"): void {
    const event: ChatMessageEvent = {
        messageType,
        text,
    };
    for (const cb of state.chatMessageListeners) cb(event);
}

export function subscribeSkills(cb: (update: SkillsUpdateEvent) => void): () => void {
    state.skillsListeners.add(cb);
    if (state.lastSkillsState) {
        try {
            cb({
                kind: "snapshot",
                totalLevel: state.lastSkillsState.totalLevel,
                combatLevel: state.lastSkillsState.combatLevel,
                skills: Array.from(state.lastSkillsState.byId.values()).map((entry) => ({ ...entry })),
            });
        } catch (err) {
            console.warn("skills listener error", err);
        }
    }
    return () => state.skillsListeners.delete(cb);
}

export function getLatestSkills():
    | { totalLevel: number; combatLevel: number; skills: SkillEntryMessage[] }
    | undefined {
    if (!state.lastSkillsState) return undefined;
    return {
        totalLevel: state.lastSkillsState.totalLevel,
        combatLevel: state.lastSkillsState.combatLevel,
        skills: Array.from(state.lastSkillsState.byId.values()).map((entry) => ({ ...entry })),
    };
}

export function subscribeCombat(cb: (payload: CombatStatePayload) => void): () => void {
    return state.combatStateStore.subscribe(cb);
}

export function getLatestCombatState(): CombatStatePayload | undefined {
    return state.combatStateStore.getLatest();
}

export function subscribeRunEnergy(cb: (state: RunEnergyState) => void): () => void {
    state.runEnergyListeners.add(cb);
    if (state.lastRunEnergyState) {
        try {
            cb(cloneRunEnergyState(state.lastRunEnergyState));
        } catch (err) {
            console.warn("run energy listener error", err);
        }
    }
    return () => state.runEnergyListeners.delete(cb);
}

export function getLatestRunEnergy(): RunEnergyState | undefined {
    return state.lastRunEnergyState ? cloneRunEnergyState(state.lastRunEnergyState) : undefined;
}

export function getLatestShopState(): ShopWindowState {
    return cloneShopState(state.lastShopState);
}

export function getLatestSmithingState(): SmithingWindowState {
    return cloneSmithingState(state.lastSmithingState);
}

export function getLatestTradeState(): TradeWindowState {
    return cloneTradeState(state.lastTradeState);
}

export function getLatestSpellResult(): SpellResultPayload | undefined {
    if (!state.lastSpellResult) return undefined;
    return {
        ...state.lastSpellResult,
        runesConsumed: state.lastSpellResult.runesConsumed
            ? state.lastSpellResult.runesConsumed.map((entry) => ({ ...entry }))
            : undefined,
        runesRefunded: state.lastSpellResult.runesRefunded
            ? state.lastSpellResult.runesRefunded.map((entry) => ({ ...entry }))
            : undefined,
        tile: state.lastSpellResult.tile ? { ...state.lastSpellResult.tile } : undefined,
        modifiers: state.lastSpellResult.modifiers
            ? { ...state.lastSpellResult.modifiers }
            : undefined,
    };
}

export function subscribeWidgetEvents(cb: (payload: WidgetServerPayload) => void): () => void {
    state.widgetListeners.add(cb);
    return () => state.widgetListeners.delete(cb);
}
