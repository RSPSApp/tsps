import { encodeClientMessage } from "../../packet/ClientBinaryEncoder";
import type { ClientToServer } from "../types/clientMessages";
import { state } from "../state";

export function send(msg: ClientToServer): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (state.protocolRejected) return;
    if ((msg.type === "login" || msg.type === "handshake") && !state.protocolReady) {
        state.pendingAuthentication = msg;
        return;
    }
    const binary = encodeClientMessage(msg as { type: string; payload: any });
    state.socket.send(binary as Uint8Array<ArrayBuffer>);
}

export function isSocketOpen(): boolean {
    return !!state.socket && state.socket.readyState === WebSocket.OPEN;
}
