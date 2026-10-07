import assert from "node:assert/strict";

import { getBrowserHostWorldConfig, getCacheBaseUrl, getServerListUrl, getWebRtcRelayConfig } from "../config/clientEnv";
import { handleServerListClick } from "../game/login/renderer/input/mouseClick";
import { forumProfileUrl, refreshServerList, relayWorldEntries, replaceRelayWorlds } from "../game/login/renderer/serverList";
import { resolveServerTransport, setServerUrl } from "../network/serverConnection/outgoing/connectionInfo";
import { state as connectionState } from "../network/serverConnection/state";

assert.deepEqual(getWebRtcRelayConfig(), {
    signalUrl: "wss://worlds.rsps.app",
    iceServers: [{ urls: "stun:stun.rsps.app:3478" }],
});

const previousPublicUrl = process.env.PUBLIC_URL;
process.env.PUBLIC_URL = "/play";
assert.equal(getServerListUrl(), "/play/servers.json");
assert.equal(getCacheBaseUrl(), "/play/caches/");
if (previousPublicUrl === undefined) delete process.env.PUBLIC_URL;
else process.env.PUBLIC_URL = previousPublicUrl;

const previousSignalUrl = process.env.REACT_APP_WEBRTC_SIGNAL_URL;
process.env.REACT_APP_WEBRTC_SIGNAL_URL = "ws://127.0.0.1:8787";
(globalThis as any).window = { location: { search: "?browser-host-client=1&browser-host-world=browser-test" } };
assert.equal(getWebRtcRelayConfig()?.signalUrl, "wss://worlds.rsps.app");
assert.deepEqual(getBrowserHostWorldConfig(), {
    signalUrl: "wss://worlds.rsps.app",
    iceServers: [{ urls: "stun:stun.rsps.app:3478" }],
    worldId: "browser-test",
});
setServerUrl("ws://127.0.0.1:43594");
assert.deepEqual(connectionState.webRtcConfig, getBrowserHostWorldConfig());
delete (globalThis as any).window;
if (previousSignalUrl === undefined) delete process.env.REACT_APP_WEBRTC_SIGNAL_URL;
else process.env.REACT_APP_WEBRTC_SIGNAL_URL = previousSignalUrl;

const discovered = relayWorldEntries("ws://127.0.0.1:8787", [], {
    worlds: [
        { worldId: "toby", name: "TobyScape", ownerUsername: "toby", playerCount: 12 },
        { worldId: "alice" },
        { worldId: "invalid world", name: "Ignored" },
    ],
});
assert.deepEqual(discovered.map((world) => world.worldId), ["toby", "alice"]);
assert.equal(discovered[0].transport, "webrtc");
assert.equal(discovered[0].playerCount, 12);
assert.equal(discovered[0].name, "TobyScape");
assert.equal(discovered[0].ownerUsername, "toby");
assert.equal(forumProfileUrl("toby"), "https://rsps.app/public/u/toby");

const opened: string[] = [];
(globalThis as any).window = { open: (url: string) => opened.push(url) };
const clickHost = {
    probed: true,
    serverList: [{ ownerUsername: "toby" }],
    canvasWidth: 800,
    canvasHeight: 600,
    contentScale: 1,
    layoutConfig: { isTouch: false, minTouchTarget: 44 },
    fontPlain12: { measure: (text: string) => text.length * 6 },
} as any;
assert.equal(handleServerListClick(clickHost, {} as any, 365, 310), undefined);
assert.deepEqual(opened, ["https://rsps.app/public/u/toby"]);
assert.deepEqual(handleServerListClick(clickHost, {} as any, 400, 310), { type: "select_server", index: 0 });
delete (globalThis as any).window;

const configured = {
    ...discovered[0],
    name: "Toby's World",
    relayDiscovered: false,
};
const refreshed = replaceRelayWorlds([configured, { ...discovered[1], worldId: "stale" }], discovered);
assert.deepEqual(refreshed.map((world) => world.worldId), ["toby", "alice"]);
assert.equal(refreshed[0].name, "Toby's World");

console.log("WebRTC relay world discovery test passed");

async function checkDedicatedWorld(): Promise<void> {
    const payload = { worlds: [
        { worldId: "world-1", name: "World 1", transport: "websocket", webSocketUrl: "wss://game.example.com/game?world=1", playerCount: 4 },
        { worldId: "bad-url", transport: "websocket", webSocketUrl: "https://example.com" },
        { worldId: "bad-auth", transport: "websocket", webSocketUrl: "wss://user:pass@example.com" },
    ] };
    const entries = relayWorldEntries("wss://worlds.rsps.app", [], payload);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].transport, "websocket");
    assert.equal(entries[0].address, "game.example.com/game?world=1");
    assert.equal(entries[0].secure, true);
    assert.equal(entries[0].playerCount, 4);
    assert.equal(replaceRelayWorlds([{ ...entries[0], relayDiscovered: false }], entries).length, 1);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => payload })) as any;
    (globalThis as any).window = { location: { search: "", pathname: "/play/world-1" } };
    try {
        const host = { serverList: [{ ...entries[0], relayDiscovered: false, playerCount: -1 }], probing: false } as any;
        refreshServerList(host);
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(host.serverList.length, 1);
        assert.equal(host.serverList[0].playerCount, 4);
        assert.equal(host.serverList[0].transport, "websocket");
        setServerUrl("wss://worlds.rsps.app", { signalUrl: "wss://worlds.rsps.app", worldId: "world-1", iceServers: [] });
        assert.equal(await resolveServerTransport(), true);
        assert.equal(connectionState.lastUrl, "wss://game.example.com/game?world=1");
        assert.equal(connectionState.webRtcConfig, undefined);
        // Explicit selections must override the world in the URL path.
        setServerUrl("wss://other.example.com", null);
        assert.equal(connectionState.webRtcConfig, undefined);
        const pending = resolveServerTransport();
        assert.equal(await pending, true);
        setServerUrl("wss://worlds.rsps.app", { signalUrl: "wss://worlds.rsps.app", worldId: "world-1", iceServers: [] });
        const resolving = resolveServerTransport();
        setServerUrl("wss://other.example.com", null);
        assert.equal(await resolving, false);
        assert.equal(connectionState.lastUrl, "wss://other.example.com");
    } finally {
        globalThis.fetch = originalFetch;
        delete (globalThis as any).window;
    }
}
void checkDedicatedWorld().then(() => console.log("Dedicated WebSocket world discovery test passed"));
