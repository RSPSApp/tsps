import { INVENTORY_SLOT_COUNT } from "../constants";
import { send } from "../connection/send";
import { state } from "../state";

export function sendBankDepositInventory(tab?: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const payload: { tab?: number } = {};
    if (Number.isFinite(tab) && (tab as number) > 0) {
        payload.tab = Math.max(1, Math.min(9, Math.floor(tab as number)));
    }
    send({ type: "bank_deposit_inventory", payload } as any);
}

export function sendBankDepositEquipment(tab?: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const payload: { tab?: number } = {};
    if (Number.isFinite(tab) && (tab as number) > 0) {
        payload.tab = Math.max(1, Math.min(9, Math.floor(tab as number)));
    }
    send({ type: "bank_deposit_equipment", payload } as any);
}

export function sendBankDepositItem(
    slot: number,
    itemId: number,
    quantity: number,
    tab?: number,
): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const normalizedSlot = Math.max(0, Math.min(INVENTORY_SLOT_COUNT - 1, slot | 0));
    const normalizedQty = Math.max(1, Math.floor(Number(quantity) || 0));
    const payload: { slot: number; quantity: number; itemId?: number; tab?: number } = {
        slot: normalizedSlot,
        quantity: normalizedQty,
    };
    if (itemId >= 0) {
        payload.itemId = itemId | 0;
    }
    if (Number.isFinite(tab) && (tab as number) > 0) {
        payload.tab = Math.max(1, Math.min(9, Math.floor(tab as number)));
    }
    send({ type: "bank_deposit_item", payload } as any);
}

export function sendBankMove(
    from: number,
    to: number,
    opts: { mode?: "swap" | "insert"; tab?: number } = {},
): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const payload = {
        from: Math.max(0, Math.floor(Number(from) || 0)),
        to: Math.max(0, Math.floor(Number(to) || 0)),
        mode: opts.mode,
        tab: opts.tab,
    };
    send({ type: "bank_move", payload } as any);
}

/**
 * Send IF_BUTTOND binary packet for widget drag-to-widget operations.
 * Used for bank operations, item rearrangement, etc.
 *
 * onDragComplete sends the IF_BUTTOND packet.
 *
 * Packet format (16 bytes):
 * - targetItemId: ShortLE (2 bytes)
 * - targetWidgetId: IntLE (4 bytes)
 * - sourceItemId: Short (2 bytes)
 * - sourceSlot: ShortAddLE (2 bytes)
 * - sourceWidgetId: IntME (4 bytes)
 * - targetSlot: ShortLE (2 bytes)
 */
export function sendWidgetDrag(
    sourceWidgetId: number,
    sourceSlot: number,
    sourceItemId: number,
    targetWidgetId: number,
    targetSlot: number,
    targetItemId: number,
): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return;
    }

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("../../packet");
    const { ClientPacketId } = require("../../packet/ClientPacket");

    const pkt = createPacket(ClientPacketId.IF_BUTTOND);
    pkt.packetBuffer.writeShortLE(targetItemId | 0);
    pkt.packetBuffer.writeIntLE(targetWidgetId | 0);
    pkt.packetBuffer.writeShort(sourceItemId | 0);
    pkt.packetBuffer.writeShortAddLE(sourceSlot | 0);
    pkt.packetBuffer.writeIntME(sourceWidgetId | 0);
    pkt.packetBuffer.writeShortLE(targetSlot | 0);
    queuePacket(pkt);
}

export function sendBankCustomQuantity(amount: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    sendResumeCountDialog(amount);
}

export function sendResumeCountDialog(amount: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const raw = Number(amount);
    const normalized = Number.isFinite(raw)
        ? Math.max(-2147483648, Math.min(2147483647, Math.floor(raw)))
        : 0;
    send({ type: "resume_countdialog", payload: { amount: normalized } } as any);
}

export function sendResumeNameDialog(value: string): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "resume_namedialog", payload: { value: String(value ?? "") } } as any);
}

export function sendResumeStringDialog(value: string): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "resume_stringdialog", payload: { value: String(value ?? "") } } as any);
}
