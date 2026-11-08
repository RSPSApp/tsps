import assert from "node:assert/strict";
import { initSocketCloseHandler } from "../network/serverConnection/connection/closeHandler";
import { state } from "../network/serverConnection/state";

/**
 * Closes a fake socket with `code` and reports whether the client schedules a reconnect. The credentials are
 * always stored, because sendLogin (login.ts) stores them before it connects: only a successful login sets
 * hasLoggedIn (authTick.ts login_response).
 */
function reconnects(code: number, loggedIn: boolean): { scheduled: boolean; failed: boolean } {
    const ws = new EventTarget() as any;
    state.socket = ws;
    state.reconnectAttempts = 0;
    state.reconnectTimer = null;
    state.isReconnecting = false;
    state.sessionUsername = "toby";
    state.sessionPassword = "secret";
    state.hasLoggedIn = loggedIn;
    let failed = false;
    const onFailed = () => { failed = true; };
    state.reconnectFailedListeners.add(onFailed);
    initSocketCloseHandler(ws, () => {});
    ws.dispatchEvent(Object.assign(new Event("close"), { code, reason: "test", wasClean: false }));
    const scheduled = state.reconnectTimer !== null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.reconnectFailedListeners.delete(onFailed);
    return { scheduled, failed };
}

const firstLogin = reconnects(4000, false);
assert.equal(firstLogin.scheduled, false, "a first login that fails to connect stays on the login screen");
assert.equal(firstLogin.failed, true, "and reports the failed connection there");
assert.equal(reconnects(4000, true).scheduled, true, "a logged-in player refused once mid-login retries");
assert.equal(reconnects(4002, true).scheduled, true);
assert.equal(reconnects(4001, true).scheduled, true);

console.log("WebRTC reconnect test passed");
