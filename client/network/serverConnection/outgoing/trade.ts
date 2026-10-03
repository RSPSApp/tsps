import { INVENTORY_SLOT_COUNT } from "../constants";
import type { TradeActionClientPayload } from "../types";
import { send } from "../connection/send";
import { state } from "../state";

function sendTradeActionMessage(payload: TradeActionClientPayload): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "trade_action", payload } as any);
}

export function sendTradeOffer(slot: number, itemId: number, quantity: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const normalizedSlot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slot | 0));
    const normalizedQty = Math.max(1, Math.floor(Number(quantity) || 0));
    const payload: TradeActionClientPayload = {
        action: "offer",
        slot: normalizedSlot,
        quantity: normalizedQty,
    };
    if (itemId > 0) payload.itemId = itemId | 0;
    sendTradeActionMessage(payload);
}

export function sendTradeRemove(slot: number, itemId: number, quantity: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const normalizedSlot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slot | 0));
    const normalizedQty = Math.max(1, Math.floor(Number(quantity) || 0));
    const payload: TradeActionClientPayload = {
        action: "remove",
        slot: normalizedSlot,
        quantity: normalizedQty,
    };
    if (itemId > 0) payload.itemId = itemId | 0;
    sendTradeActionMessage(payload);
}

export function sendTradeAccept(): void {
    sendTradeActionMessage({ action: "accept" });
}

export function sendTradeDecline(): void {
    sendTradeActionMessage({ action: "decline" });
}

export function sendTradeConfirmAccept(): void {
    sendTradeActionMessage({ action: "confirm_accept" });
}

export function sendTradeConfirmDecline(): void {
    sendTradeActionMessage({ action: "confirm_decline" });
}
