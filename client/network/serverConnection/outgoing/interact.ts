import { send } from "../connection/send";
import { state } from "../state";

export function sendInteractFollow(targetId: number, mode: "follow" | "trade" = "follow"): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "interact", payload: { mode, targetId: targetId | 0 } } as any);
}

/** Sends the native OPPLAYER packet selected by a CS2 chatbox action. */
export function sendPlayerOption(targetId: number, option: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const target = targetId | 0;
    const op = option | 0;
    if (target < 0 || op < 1 || op > 8) return;

    const { ClientPacket, createPacket, queuePacket } = require("../../packet");
    const packet = createPacket(ClientPacket[`OPPLAYER${op}` as const]);
    const buffer = packet.packetBuffer;
    switch (op) {
        case 1:
        case 3:
            buffer.writeByteSub(0);
            buffer.writeShort(target);
            break;
        case 2:
            buffer.writeByte(0);
            buffer.writeShort(target);
            break;
        case 4:
        case 6:
            buffer.writeShort(target);
            buffer.writeByteNeg(0);
            break;
        case 5:
            buffer.writeShortAddLE(target);
            buffer.writeByteSub(0);
            break;
        case 7:
            buffer.writeShortAdd(target);
            buffer.writeByteSub(0);
            break;
        case 8:
            buffer.writeByte(0);
            buffer.writeShortAdd(target);
            break;
    }
    queuePacket(packet);
}
export function sendInteractStop(): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "interact_stop", payload: {} } as any);
}

export function sendNpcOption(npcId: number, opNum: number, modifierFlags: number = 0): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (npcId == null) return;
    const { ClientPacket, createPacket, queuePacket } = require("../../packet");
    const ctrl = (modifierFlags & 1) !== 0 ? 1 : 0;
    const op = opNum | 0;
    const pkt =
        op === 1
            ? createPacket(ClientPacket.OPNPC1_ALT)
            : op === 2
              ? createPacket(ClientPacket.OPNPC2)
              : op === 3
                ? createPacket(ClientPacket.OPNPC3)
                : op === 4
                  ? createPacket(ClientPacket.OPNPC4)
                  : op === 5
                    ? createPacket(ClientPacket.OPNPC1)
                    : undefined;
    if (!pkt) return;
    if (op === 1) {
        pkt.packetBuffer.writeByte(ctrl);
        pkt.packetBuffer.writeShortAddLE(npcId | 0);
    } else if (op === 2) {
        pkt.packetBuffer.writeShortAddLE(npcId | 0);
        pkt.packetBuffer.writeByte(ctrl);
    } else if (op === 3) {
        pkt.packetBuffer.writeShortAdd(npcId | 0);
        pkt.packetBuffer.writeByteNeg(ctrl);
    } else if (op === 4) {
        pkt.packetBuffer.writeByteNeg(ctrl);
        pkt.packetBuffer.writeShortLE(npcId | 0);
    } else {
        pkt.packetBuffer.writeByteAdd(ctrl);
        pkt.packetBuffer.writeShortLE(npcId | 0);
    }
    queuePacket(pkt);
}

export function sendLocInteract(
    id: number,
    tile: { x: number; y: number },
    level?: number,
    action?: string,
): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({
        type: "loc_interact",
        payload: { id: id | 0, tile: { x: tile.x | 0, y: tile.y | 0 }, level, action },
    } as any);
}

/** Sends a native OPWORLDENTITY option (1-6) for a static ship or boat. */
export function sendWorldEntityOption(entityIndex: number, option: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const index = entityIndex | 0;
    const op = option | 0;
    if (index < 0 || op < 1 || op > 6) return;
    const { ClientPacket, createPacket, queuePacket } = require("../../packet");
    const pkt = createPacket(ClientPacket[`OPWORLDENTITY${op}` as const]);
    const buffer = pkt.packetBuffer;
    switch (op) {
        case 1:
            buffer.writeShortLE(index);
            buffer.writeByteSub(0);
            break;
        case 2:
            buffer.writeShortAdd(index);
            buffer.writeByteAdd(0);
            break;
        case 3:
            buffer.writeShort(index);
            buffer.writeByteNeg(0);
            break;
        case 4:
            buffer.writeByteSub(0);
            buffer.writeShort(index);
            break;
        case 5:
            buffer.writeByteAdd(0);
            buffer.writeShortLE(index);
            break;
        default:
            buffer.writeShortAddLE(index);
            break;
    }
    queuePacket(pkt);
}
