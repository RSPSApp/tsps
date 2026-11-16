import type { ShopServerPayload, ShopWindowState } from "../types";
import { cloneShopState, createDefaultShopState } from "./defaults";
import { state } from "../state";
import { sanitizeShopStockEntryMessage } from "../utils/sanitize";

export { createDefaultShopState, cloneShopState };

const clampShopMode = (mode: number | undefined): number => {
    if (!Number.isFinite(mode)) return 0;
    const normalized = Math.floor(mode as number);
    if (normalized < 0) return 0;
    if (normalized > 4) return 4;
    return normalized;
};

export function handleShopPayload(payload: ShopServerPayload | undefined): void {
    if (!payload) return;
    if (payload.kind === "open") {
        const stock = Array.isArray(payload.stock)
            ? payload.stock.map((entry) => sanitizeShopStockEntryMessage(entry))
            : [];
        stock.sort((a, b) => a.slot - b.slot);
        state.lastShopState = {
            open: true,
            shopId: payload.shopId,
            name: payload.name,
            currencyItemId:
                typeof payload.currencyItemId === "number"
                    ? (payload.currencyItemId as number) | 0
                    : undefined,
            generalStore: !!payload.generalStore,
            buyMode: clampShopMode(payload.buyMode),
            sellMode: clampShopMode(payload.sellMode),
            stock,
            inventoryId: typeof payload.inventoryId === "number" ? payload.inventoryId | 0 : undefined,
        };
    } else if (payload.kind === "close") {
        state.lastShopState = createDefaultShopState();
    } else if (payload.kind === "slot") {
        if (
            state.lastShopState.shopId &&
            payload.shopId &&
            payload.shopId !== state.lastShopState.shopId
        ) {
            return;
        }
        const entry = sanitizeShopStockEntryMessage(payload.slot);
        const idx = state.lastShopState.stock.findIndex((slot) => slot.slot === entry.slot);
        if (idx >= 0) state.lastShopState.stock[idx] = entry;
        else {
            state.lastShopState.stock.push(entry);
            state.lastShopState.stock.sort((a, b) => a.slot - b.slot);
        }
        if (!state.lastShopState.shopId && payload.shopId) {
            state.lastShopState.shopId = payload.shopId;
        }
        state.lastShopState.open = true;
    } else if (payload.kind === "mode") {
        if (
            state.lastShopState.shopId &&
            payload.shopId &&
            payload.shopId !== state.lastShopState.shopId
        ) {
            return;
        }
        if (payload.buyMode !== undefined) {
            state.lastShopState.buyMode = clampShopMode(payload.buyMode);
        }
        if (payload.sellMode !== undefined) {
            state.lastShopState.sellMode = clampShopMode(payload.sellMode);
        }
    }
    const snapshot = cloneShopState(state.lastShopState);
    for (const listener of state.shopListeners) {
        try {
            listener(snapshot);
        } catch (err) {
            console.warn("shop listener error", err);
        }
    }
}
