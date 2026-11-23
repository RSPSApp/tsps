import assert from "node:assert/strict";
import { test } from "node:test";

import { initServerConnection } from "../network/serverConnection/connection/init";
import { WS_SUPPRESS_RECONNECT_KEY } from "../network/serverConnection/constants";
import { state } from "../network/serverConnection/state";
import { EXIT_GUARD_STATE_KEY, type ExitGuardHistory, type ExitGuardHost } from "../game/plugins/exitguard/exitGuard";
import { ExitGuardPlugin, type LeaveDialogView } from "../game/plugins/exitguard/ExitGuardPlugin";

const originalWindow = (globalThis as any).window;
const originalWebSocket = (globalThis as any).WebSocket;

// --- The page and the socket, as far as the connection owner can see -----------------------------

type Listener = (event: any) => void;

class FakeWindow {
    readonly listeners = new Map<string, Set<Listener>>();

    addEventListener(type: string, listener: Listener): void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type: string, event: unknown): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    }

    listenerCount(type: string): number {
        return this.listeners.get(type)?.size ?? 0;
    }
}

class FakeSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readyState = FakeSocket.OPEN;
    binaryType = "arraybuffer";
    bufferedAmount = 0;
    readonly url: string;
    readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
    private readonly listeners = new Map<string, Set<Listener>>();

    constructor(url: string) {
        this.url = url;
    }

    addEventListener(type: string, listener: Listener): void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }

    send(): void {}

    close(code?: number, reason?: string): void {
        if (this.readyState === FakeSocket.CLOSED) return;
        this.closeCalls.push({ code, reason });
        this.readyState = FakeSocket.CLOSED;
        // The real socket reports the close asynchronously; running it here makes the close
        // handler read whatever the page set up before asking for the close.
        for (const listener of [...(this.listeners.get("close") ?? [])]) {
            listener({ code: code ?? 1005, reason: reason ?? "", wasClean: true });
        }
    }
}

class FakeHistory implements ExitGuardHistory {
    readonly entries: unknown[] = [{ from: 0 }, { routerKey: "page" }];
    index = 1;
    readonly goCalls: number[] = [];

    get state(): unknown {
        return this.entries[this.index];
    }

    pushState(data: unknown): void {
        this.entries.splice(this.index + 1);
        this.entries.push(data);
        this.index = this.entries.length - 1;
    }

    go(delta: number): void {
        this.goCalls.push(delta);
        const target = this.index + delta;
        if (target >= 0 && target < this.entries.length) this.index = target;
    }

    hasSentinel(): boolean {
        return (this.state as Record<string, unknown> | null)?.[EXIT_GUARD_STATE_KEY] === true;
    }
}

class FakeDialog implements LeaveDialogView {
    open = false;

    holds(): boolean {
        return false;
    }

    show(): void {
        this.open = true;
    }

    hide(): void {
        this.open = false;
    }

    destroy(): void {
        this.open = false;
    }
}

type Fixture = {
    win: FakeWindow;
    socket: FakeSocket;
    history: FakeHistory;
    plugin: ExitGuardPlugin;
    /** A reload's beforeunload; `commit` models answering Leave, which then fires pagehide. */
    unload: (commit?: boolean) => { defaultPrevented: boolean };
};

/**
 * Brings up the real connection owner (`initServerConnection`) on a fake page and then arms the
 * real exit guard on the same page, which is the order the game itself uses.
 */
function fixture(): Fixture {
    const win = new FakeWindow();
    (globalThis as any).window = win;
    (globalThis as any).WebSocket = FakeSocket;

    state.socket = null;
    state.webRtcConfig = undefined;
    state.sessionUsername = null;
    state.sessionPassword = null;
    state.reconnectTimer = null;
    state.hasLoggedIn = false;

    initServerConnection("ws://localhost:43594");
    const socket = state.socket as unknown as FakeSocket;
    assert.ok(socket instanceof FakeSocket, "the connection owner created its socket");
    // The socket opened, which is what clears the suppression left by a previous page.
    (win as any)[WS_SUPPRESS_RECONNECT_KEY] = false;

    const history = new FakeHistory();
    const host: ExitGuardHost = {
        history,
        addEventListener: (type, listener, capture) => win.addEventListener(type, listener),
        removeEventListener: (type, listener) => win.removeEventListener(type, listener),
        close: () => {},
        isVisible: () => true,
        after: (_delayMs, run) => run(),
    };
    const plugin = new ExitGuardPlugin(host, new FakeDialog(), { addInputFilter: () => () => {} }, () => true);

    return {
        win,
        socket,
        history,
        plugin,
        unload: (commit = false) => {
            const event = {
                defaultPrevented: false,
                returnValue: "leave?",
                preventDefault() {
                    this.defaultPrevented = true;
                },
            };
            // A real reload fires beforeunload first: the guard raises the browser's prompt.
            win.dispatch("beforeunload", event);
            // Answering Stay cancels the navigation, so no pagehide follows. Leave commits it.
            if (commit) win.dispatch("pagehide", { persisted: false });
            return event;
        },
    };
}

async function teardown(f: Fixture): Promise<void> {
    await f.plugin.stop();
    state.socket = null;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.isReconnecting = false;
    state.hasLoggedIn = false;
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
}

// --- Regressions: cancelling the reload prompt must not end the live session ---------------------

test("cancelling the browser's reload prompt leaves the live connection alone", async () => {
    const f = fixture();
    try {
        await f.plugin.start();

        // A reload during a live session: the guard asks the browser to prompt, and the
        // connection owner must not have torn anything down before that answer is known.
        const prompt = f.unload();
        assert.equal(prompt.defaultPrevented, true, "the browser's Stay/Leave prompt is raised");

        // The player chose Stay: the document stays, so no pagehide follows.
        assert.equal(state.socket, f.socket as any, "the same socket is still the live one");
        assert.equal(f.socket.readyState, FakeSocket.OPEN);
        assert.deepEqual(f.socket.closeCalls, [], "cancelling the navigation does not close it");
        assert.equal((f.win as any)[WS_SUPPRESS_RECONNECT_KEY], false, "reconnection stays available");
        assert.equal(state.reconnectTimer, null, "and nothing was left waiting to reconnect");
        assert.equal(state.isReconnecting, false);

        // The session is still usable: the next reload prompts again rather than starting dead.
        const again = f.unload();
        assert.equal(again.defaultPrevented, true);
        assert.equal(f.socket.readyState, FakeSocket.OPEN);
    } finally {
        await teardown(f);
    }
});

test("a committed navigation still closes the connection cleanly", async () => {
    const f = fixture();
    try {
        await f.plugin.start();

        // The page being put in the back/forward cache keeps this document: the session survives.
        f.win.dispatch("pagehide", { persisted: true });
        assert.equal(f.socket.readyState, FakeSocket.OPEN, "a bfcache page is still this page");
        assert.equal((f.win as any)[WS_SUPPRESS_RECONNECT_KEY], false);

        // Leaving for real: the prompt was answered with Leave, so pagehide follows.
        const prompt = f.unload(true);
        assert.equal(prompt.defaultPrevented, true, "the guard still asked before leaving");
        assert.deepEqual(f.socket.closeCalls, [{ code: 1000, reason: "page unload" }]);
        assert.equal((f.win as any)[WS_SUPPRESS_RECONNECT_KEY], true, "no reconnect after a real unload");
        assert.equal(state.socket, null, "the close handler released the socket");
    } finally {
        await teardown(f);
    }
});

test("the connection owner defers teardown even without an exit guard prompt", async () => {
    const f = fixture();
    try {
        // No plugin: nothing prevents the unload, and a cancelled navigation is not modelled
        // here, but beforeunload alone still must not be treated as a committed navigation.
        const event = {
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            },
        };
        f.win.dispatch("beforeunload", event);
        assert.equal(event.defaultPrevented, false);
        assert.equal(f.socket.readyState, FakeSocket.OPEN, "beforeunload is not a navigation yet");
        assert.deepEqual(f.socket.closeCalls, []);
        assert.equal((f.win as any)[WS_SUPPRESS_RECONNECT_KEY], false);

        f.win.dispatch("pagehide", { persisted: false });
        assert.deepEqual(f.socket.closeCalls, [{ code: 1000, reason: "page unload" }]);
        assert.equal((f.win as any)[WS_SUPPRESS_RECONNECT_KEY], true);
    } finally {
        await teardown(f);
    }
});

test("the connection owner tears down on pagehide, not beforeunload", async () => {
    const f = fixture();
    try {
        assert.equal(f.win.listenerCount("pagehide"), 1, "a committed navigation has a teardown");
        assert.equal(
            f.win.listenerCount("beforeunload"),
            0,
            "nothing tears the session down before the prompt's answer",
        );
    } finally {
        await teardown(f);
    }
});

console.log("exit guard + connection owner: cancelled reload keeps the session alive");
