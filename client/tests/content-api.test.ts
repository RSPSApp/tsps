import assert from "node:assert/strict";
import { fetchClientBackground, fetchContent, fetchInterfaceDefinition, getContentApiBase } from "../network/serverConnection/contentApi";
import { state } from "../network/serverConnection/state";

const contentApiTest = (async () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = state.lastUrl;
    const originalConfig = state.webRtcConfig;
    const originalSocket = state.socket;
    const requested: string[] = [];
    try {
        state.lastUrl = "wss://worlds.rsps.app";
        state.webRtcConfig = { signalUrl: state.lastUrl, worldId: "browser-test", iceServers: [] };
        globalThis.fetch = (async (url: string | URL | Request) => {
            requested.push(String(url));
            return {
                ok: true,
                status: 200,
                json: async () => ({ groupId: 30003, widgets: [] }),
            } as Response;
        }) as typeof fetch;
        assert.equal(getContentApiBase(), undefined, "the signalling relay is not a content server");
        assert.equal((await fetchInterfaceDefinition(30003))?.groupId, 30003);
        state.socket = { fetchContent: async (path: string) => {
            requested.push(path);
            return path.startsWith("/api/interfaces/") ? { groupId: 30002, widgets: [] } : { rows: [{ id: 4151, name: "Abyssal whip" }] };
        } } as any;
        assert.equal((await fetchInterfaceDefinition(30002)).groupId, 30002);
        assert.equal((await fetchContent("/api/world/shops")).rows[0].id, 4151);
        assert.deepEqual(requested.slice(1), ["/api/interfaces/30002", "/api/world/shops"]);
        assert.match(requested[0], /^\/browser-host\/interfaces\/30003\.json\?v=\d+$/);

        state.webRtcConfig = undefined;
        state.lastUrl = "wss://worlds.rsps.app/game";
        globalThis.fetch = async url => {
            assert.equal(String(url), "https://worlds.rsps.app/api/login-screen");
            return Response.json({ jpg: "fixture" });
        };
        assert.equal(await fetchClientBackground(new AbortController().signal), "fixture");
    } finally {
        globalThis.fetch = originalFetch;
        state.lastUrl = originalUrl;
        state.webRtcConfig = originalConfig;
        state.socket = originalSocket;
    }
})();

void contentApiTest.catch((error) => { console.error(error); process.exitCode = 1; });
