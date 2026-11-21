import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { DesktopPlugin, desktopClientManifestUrl } from "../game/plugins/desktop/DesktopPlugin";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import type { GameSocket } from "../network/serverConnection/connection/GameSocket";
import { sendLogin } from "../network/serverConnection/login";
import { getSelectedWorld } from "../network/serverConnection/outgoing/connectionInfo";
import { state } from "../network/serverConnection/state";

async function main() {
    const target = { address: "world.example/game", secure: true };
    const installed = "a".repeat(64);
    const recommended = "b".repeat(64);
    const warnings: string[] = [];
    const showWarning = (message: string) => warnings.push(message);
    const { signal } = new AbortController();
    const desktop = new DesktopPlugin();
    await desktop.start();
    (globalThis as any).window = {};
    (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1; };
    window.__RSPS_DESKTOP_PROFILE__ = { ...target, name: "Example", maxPlayers: 2047 };
    let requests = 0;
    let worldInfo = Promise.resolve(Response.json({ clientVersion: installed }));
    globalThis.fetch = async input => {
        requests++;
        if (String(input) === "/client-release.json") return Response.json({ clientVersion: installed });
        assert.equal(String(input), "https://world.example/api/world-info");
        return (await worldInfo).clone();
    };
    await desktop.clientReady(signal, showWarning);
    desktop.onWorldLogin(target);
    assert.equal(requests, 0, "a browser profile alone cannot enable the desktop check");

    window.__TAURI__ = { core: { invoke: async () => undefined } };
    await desktop.clientReady(signal, showWarning);
    assert.equal(await desktopClientManifestUrl(target), `https://github.com/RSPSApp/tsps/releases/download/client-${installed}/manifest.json`);
    desktop.onWorldLogin(target);
    await setImmediate();
    assert.deepEqual(warnings, [], "a matching build is quiet");

    const plugins = new ClientPluginManager();
    plugins.add(desktop);
    state.onWorldLogin = () => plugins.onWorldLogin(getSelectedWorld());
    state.lastUrl = "wss://world.example/game";
    (globalThis as any).WebSocket = { OPEN: 1 };
    let sent = 0;
    state.socket = { readyState: WebSocket.OPEN, send: () => sent++ } as unknown as GameSocket;
    state.lastWelcome = { tickMs: 600, serverTime: Date.now() };

    const lookup = Promise.withResolvers<Response>();
    worldInfo = lookup.promise;
    await sendLogin("test-player", "test-password");
    assert.equal(sent, 1, "login proceeds while the advisory lookup is pending");
    assert.deepEqual(warnings, []);
    lookup.resolve(Response.json({ clientVersion: recommended }));
    await setImmediate();
    assert.match(warnings[0], /recommends a different client build/);

    worldInfo = Promise.resolve(Response.json({ clientVersion: "../../other-repository" }));
    await assert.rejects(desktopClientManifestUrl(target), /does not advertise/);
    await sendLogin("test-player", "test-password");
    await setImmediate();
    assert.equal(sent, 2, "invalid metadata cannot block login");
    assert.equal(warnings.length, 1, "only a confirmed mismatch displays a warning");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
