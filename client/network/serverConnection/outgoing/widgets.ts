import type { WidgetActionClientPayload } from "../types";
import { send } from "../connection/send";
import { state } from "../state";

export function sendWidgetOpen(groupId: number, opts: { modal?: boolean } = {}): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({
        type: "widget",
        payload: { action: "open", groupId: groupId | 0, modal: !!opts.modal },
    } as any);
}

export function sendWidgetClose(groupId: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "widget", payload: { action: "close", groupId: groupId | 0 } } as any);
}

function normalizeWidgetActionPayload(
    payload: WidgetActionClientPayload,
): WidgetActionClientPayload | undefined {
    if (!payload) return undefined;
    const widgetId = Number(payload.widgetId);
    const groupId = Number(payload.groupId);
    const childId = Number(payload.childId);
    if (!Number.isFinite(widgetId) || !Number.isFinite(groupId) || !Number.isFinite(childId)) {
        return undefined;
    }
    const normalized: WidgetActionClientPayload = {
        widgetId: widgetId | 0,
        groupId: groupId | 0,
        childId: childId | 0,
    };
    if (payload.option !== undefined) normalized.option = String(payload.option ?? "");
    if (payload.target !== undefined) normalized.target = String(payload.target ?? "");
    if (typeof payload.isPrimary === "boolean") normalized.isPrimary = !!payload.isPrimary;
    if (Number.isFinite(payload.opId)) normalized.opId = Math.floor(payload.opId as number);
    if (Number.isFinite(payload.subOpId))
        normalized.subOpId = Math.floor(payload.subOpId as number);
    if (Number.isFinite(payload.cursorX))
        normalized.cursorX = Math.floor(payload.cursorX as number);
    if (Number.isFinite(payload.cursorY))
        normalized.cursorY = Math.floor(payload.cursorY as number);
    if (Number.isFinite(payload.slot)) normalized.slot = Math.floor(payload.slot as number);
    if (Number.isFinite(payload.itemId)) normalized.itemId = Math.floor(payload.itemId as number);
    return normalized;
}

/**
 * Map opId (1-10) to IF_BUTTON packet IDs.
 * Op0 (targetVerb) uses IF_BUTTONT, handled separately.
 */
const OP_TO_IF_BUTTON: Record<number, number> = {
    1: 23, // IF_BUTTON1
    2: 25, // IF_BUTTON2
    3: 31, // IF_BUTTON3
    4: 63, // IF_BUTTON4
    5: 69, // IF_BUTTON5
    6: 11, // IF_BUTTON6
    7: 14, // IF_BUTTON7
    8: 19, // IF_BUTTON8
    9: 20, // IF_BUTTON9
    10: 84, // IF_BUTTON10
};

/**
 * Send widget action as binary IF_BUTTON packet.
 * Sends IF_BUTTON1-10 packets for widget ops.
 *
 * Packet format (8 bytes):
 * - widgetId: int (4 bytes)
 * - slot: short (2 bytes)
 * - itemId: short (2 bytes)
 */
export function sendWidgetAction(payload: WidgetActionClientPayload): void {
    const normalized = normalizeWidgetActionPayload(payload);
    if (!normalized) {
        return;
    }
    // PlayerDesign (group 679) is client-only. Only the final APPEARANCE_SET packet is sent.
    if ((((normalized.widgetId ?? 0) >>> 16) & 0xffff) === 679) {
        return;
    }

    const opId = normalized.opId ?? 1;

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("../../packet");
    const { ClientPacketId } = require("../../../common/network/ClientPacketId");

    // Ops invoked from an op submenu carry the op index and 0-based submenu index
    // in a dedicated packet, mirroring the second widget op packet in the client.
    if (typeof normalized.subOpId === "number" && normalized.subOpId >= 1) {
        if (opId < 1 || opId > 10) {
            return;
        }
        const pkt = createPacket(ClientPacketId.IF_BUTTON_SUB);
        pkt.packetBuffer.writeInt(normalized.widgetId);
        pkt.packetBuffer.writeShort(normalized.slot ?? 0xffff);
        pkt.packetBuffer.writeShort(normalized.itemId ?? -1);
        pkt.packetBuffer.writeByte(opId);
        pkt.packetBuffer.writeByte(normalized.subOpId - 1);
        queuePacket(pkt);
        return;
    }

    const packetId = OP_TO_IF_BUTTON[opId];

    if (!packetId) {
        return;
    }

    const pkt = createPacket(packetId);
    pkt.packetBuffer.writeInt(normalized.widgetId);
    // For IF_BUTTON packets, slot is 65535 when unused.
    // Using 0 breaks server-side routing that distinguishes "no slot" (static component)
    // from "slot index" (inventory/dynamic child index).
    pkt.packetBuffer.writeShort(normalized.slot ?? 0xffff);
    pkt.packetBuffer.writeShort(normalized.itemId ?? -1);
    queuePacket(pkt);
}

/**
 * Direct widget_action transport for custom client-driven widget interactions that need
 * richer payload data than the IF_BUTTON packets carry, such as live text updates.
 */
export function sendWidgetActionMessage(payload: WidgetActionClientPayload): void {
    const normalized = normalizeWidgetActionPayload(payload);
    if (!normalized) {
        return;
    }
    send({ type: "widget_action", payload: normalized });
}


/**
 * IF_TRIGGEROPLOCAL (2929) forwarding packet.
 * Payload format mirrors  (ClientPacket id 30, var-short).
 */
export function sendIfTriggerOpLocal(
    widgetUid: number,
    childIndex: number,
    itemId: number,
    opcodeParam: number,
    args: any[],
): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (!Number.isFinite(widgetUid) || !Number.isFinite(childIndex)) return;

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("../../packet");
    const { ClientPacketId } = require("../../packet/ClientPacket");

    const pkt = createPacket(ClientPacketId.IF_TRIGGEROPLOCAL);
    const buf = pkt.packetBuffer;

    // Inner var-short payload section for this packet's argument block.
    buf.writeShort(0);
    const blockStart = buf.offset;

    // Fixed fields: intLE, shortLE, intLE, shortLE
    buf.writeIntLE(opcodeParam | 0);
    buf.writeShortLE(childIndex | 0);
    buf.writeIntLE(widgetUid | 0);
    buf.writeShortLE(itemId | 0);

    const objectArgs = Array.isArray(args) ? args : [];
    for (let i = 0; i < objectArgs.length; i++) {
        const arg = objectArgs[i];
        if (typeof arg === "number" && Number.isFinite(arg)) {
            // zigzag + LEB128-style varint.
            let v = (((arg | 0) << 1) ^ ((arg | 0) >> 31)) >>> 0;
            while ((v & ~0x7f) !== 0) {
                buf.writeByte((v & 0x7f) | 0x80);
                v >>>= 7;
            }
            buf.writeByte(v & 0x7f);
        } else if (typeof arg === "string") {
            buf.writeStringCp1252NullTerminated(arg);
        } else if (arg == null) {
            buf.writeByte(0);
        }
    }

    const blockLength = buf.offset - blockStart;
    buf.writeLengthShort(blockLength);
    queuePacket(pkt);
}

/**
 * PlayerDesign (679): send final appearance selection to server.
 * The client mutates appearance locally while editing,
 * and only transmits the final selection on confirm.
 */
export function sendPlayerDesignConfirm(appearance: {
    gender: number;
    colors?: number[];
    kits?: number[];
}): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (!appearance || !Number.isFinite(appearance.gender)) return;

    // Import packet functions dynamically to avoid circular dependencies
    const { createPacket, queuePacket } = require("../../packet");
    const { ClientPacketId } = require("../../../common/network/ClientPacketId");

    // Payload: gender (1), kits[7] (14, signed short, -1=0xffff), colors[5] (5)
    const pkt = createPacket(ClientPacketId.APPEARANCE_SET);
    const gender = (appearance.gender | 0) === 1 ? 1 : 0;
    pkt.packetBuffer.writeByte(gender);

    // Identity kit ids in current caches exceed 255, and 255 is itself a valid kit, so kits
    // must go out as shorts rather than bytes (a byte would alias 256-306 and steal the -1 sentinel).
    const kits = Array.isArray(appearance.kits) ? appearance.kits : [];
    for (let i = 0; i < 7; i++) {
        const v = Number.isFinite(kits[i]) ? kits[i] | 0 : -1;
        pkt.packetBuffer.writeShort(v);
    }

    const colors = Array.isArray(appearance.colors) ? appearance.colors : [];
    for (let i = 0; i < 5; i++) {
        const v = Number.isFinite(colors[i]) ? colors[i] | 0 : 0;
        pkt.packetBuffer.writeByte(v);
    }

    queuePacket(pkt);
}
