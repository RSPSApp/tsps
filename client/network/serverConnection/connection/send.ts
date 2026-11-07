import { encodeClientMessage } from "../../packet/ClientBinaryEncoder";
import type { ClientToServer } from "../types/clientMessages";
import { state } from "../state";

export function send(msg: ClientToServer): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (msg.type === "login") {
        if (!state.lastWelcome) {
            const socket = state.socket;
            state.loginOnWelcome = () => { if (state.socket === socket) send(msg); };
            return;
        }
        const flags = state.loginExtension?.loginFlags(msg.payload.flags ?? 0) ?? (msg.payload.flags ?? 0);
        state.sessionLoginFlags = flags;
        msg = { ...msg, payload: { ...msg.payload, flags } };
    }
    const binary = encodeClientMessage(msg as { type: string; payload: any });
    state.socket.send(binary as Uint8Array<ArrayBuffer>);
}

export function isSocketOpen(): boolean {
    return !!state.socket && state.socket.readyState === WebSocket.OPEN;
}
