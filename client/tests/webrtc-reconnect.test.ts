import assert from "node:assert/strict";
import { initSocketCloseHandler } from "../network/serverConnection/connection/closeHandler";
import { state } from "../network/serverConnection/state";

/** Closes a fake socket with `code` and reports whether the client schedules a reconnect. */
function reconnects(code: number, loggedIn: boolean): boolean {
    const ws = new EventTarget() as any;
    state.socket = ws;
    state.reconnectAttempts = 0;
    state.reconnectTimer = null;
    state.sessionUsername = loggedIn ? "toby" : null;
    state.sessionPassword = loggedIn ? "secret" : null;
    initSocketCloseHandler(ws, () => {});
    ws.dispatchEvent(Object.assign(new Event("close"), { code, reason: "test", wasClean: false }));
    const scheduled = state.reconnectTimer !== null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    return scheduled;
}

assert.equal(reconnects(4000, false), false, "a first login that fails to connect stays on the login screen");
assert.equal(reconnects(4000, true), true, "a logged-in player refused once mid-login retries");
assert.equal(reconnects(4002, true), true);
assert.equal(reconnects(4001, true), true);

console.log("WebRTC reconnect test passed");
