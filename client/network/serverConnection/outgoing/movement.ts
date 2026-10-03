import { send } from "../connection/send";
import { state } from "../state";

export function sendWalk(to: { x: number; y: number }, run: boolean = false): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "walk", payload: { to, run } });
}

/** Sets the heading (0-15) of the boat the player is steering. */
export function sendSetHeading(heading: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "set_heading", payload: { heading: heading & 15 } });
}

/**
 * Send a varp (player variable) update to the server.
 * Used for transmit varps that need server-side sync.
 */
export function sendVarpTransmit(varpId: number, value: number): void {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    send({ type: "varp_transmit", payload: { varpId: varpId | 0, value: value | 0 } } as any);
}
