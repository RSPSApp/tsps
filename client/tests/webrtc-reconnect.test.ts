import assert from "node:assert/strict";
import { initSocketCloseHandler } from "../network/serverConnection/connection/closeHandler";
import { handleAuthTickMessage } from "../network/serverConnection/handlers/authTick";
import { sendLogin } from "../network/serverConnection/login";
import { state } from "../network/serverConnection/state";

/**
 * Drives the real login path on a fake open socket: sendLogin (which stores the credentials before any reply)
 * and, when given, the server's login_response through handleAuthTickMessage. Then the socket closes with
 * `code`, and the result says whether the client schedules a reconnect.
 */
async function reconnects(code: number, responses: object[]): Promise<{ scheduled: boolean; failed: boolean; sent: number }> {
    const ws = new EventTarget() as any;
    let sent = 0;
    ws.readyState = WebSocket.OPEN;
    ws.send = () => { sent++; };
    ws.close = () => {};
    state.socket = ws;
    state.webRtcConfig = null;
    state.lastWelcome = { tickMs: 600, serverTime: 0 } as any;
    state.reconnectAttempts = 0;
    state.reconnectTimer = null;
    state.isReconnecting = false;
    state.hasLoggedIn = false;
    let failed = false;
    const onFailed = () => { failed = true; };
    state.reconnectFailedListeners.add(onFailed);
    initSocketCloseHandler(ws, () => {});
    await sendLogin("toby", "secret");
    assert.equal(state.sessionUsername, "toby", "sendLogin stores the credentials before the server answers");
    for (const payload of responses) handleAuthTickMessage({ type: "login_response", payload });
    ws.dispatchEvent(Object.assign(new Event("close"), { code, reason: "test", wasClean: false }));
    const scheduled = state.reconnectTimer !== null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.reconnectFailedListeners.delete(onFailed);
    return { scheduled, failed, sent };
}

const ok = { success: true, loginToken: "token" };
const refused = { success: false, error: "Your account is already logged in.", errorCode: 5 };

/** Closes a socket that never opened, as a retry against an unreachable server does (code 1006). */
function failedRetry(): { scheduled: boolean; failed: boolean } {
    const ws = new EventTarget() as any;
    ws.readyState = WebSocket.CLOSED;
    ws.send = () => {};
    ws.close = () => {};
    state.socket = ws;
    state.reconnectTimer = null;
    let failed = false;
    const onFailed = () => { failed = true; };
    state.reconnectFailedListeners.add(onFailed);
    initSocketCloseHandler(ws, () => {});
    ws.dispatchEvent(Object.assign(new Event("close"), { code: 1006, reason: "", wasClean: false }));
    const scheduled = state.reconnectTimer !== null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.reconnectFailedListeners.delete(onFailed);
    return { scheduled, failed };
}

async function main(): Promise<void> {
    // Issue 4241: a drop (1006) retries three times, even when the retries never open.
    await reconnects(1006, [ok]);
    state.reconnectAttempts = 0;
    state.hasLoggedIn = true;
    state.isReconnecting = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const retry = failedRetry();
        assert.equal(retry.scheduled, true, `drop ${attempt} schedules a retry`);
        assert.equal(retry.failed, false, `drop ${attempt} keeps the player in game`);
    }
    const exhausted = failedRetry();
    assert.equal(exhausted.scheduled, false, "after three retries it gives up");
    assert.equal(exhausted.failed, true, "and returns to the login screen");
    state.reconnectAttempts = 0;
    state.isReconnecting = false;


    const firstLogin = await reconnects(4000, []);
    assert.equal(firstLogin.sent, 1, "the login went out on the open socket");
    assert.equal(firstLogin.scheduled, false, "a first login that fails to connect stays on the login screen");
    assert.equal(firstLogin.failed, true, "and reports the failed connection there");

    const refusedFirst = await reconnects(4000, [refused]);
    assert.equal(refusedFirst.scheduled, false, "a refused first login ends on 4000");

    const loggedIn = await reconnects(4000, [ok]);
    assert.equal(loggedIn.scheduled, true, "a logged-in player refused once mid-login retries");

    const refusedRelogin = await reconnects(4000, [ok, refused]);
    assert.equal(refusedRelogin.scheduled, false, "a refused automatic relogin is back on the login screen, so 4000 ends it");
    assert.equal(refusedRelogin.failed, true);

    assert.equal((await reconnects(4002, [ok])).scheduled, true);
    assert.equal((await reconnects(4001, [ok])).scheduled, true);
}

main().then(
    () => console.log("WebRTC reconnect test passed"),
    (e) => { console.error(e); process.exit(1); },
);
