import assert from "node:assert/strict";
import { DesktopPlugin } from "../game/plugins/desktop/DesktopPlugin";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";

async function main() {
    const calls: string[] = [];
    (globalThis as any).window = {
        __TAURI__: { core: { invoke: async (command: string) => { calls.push(command); } } },
    };
    const plugins = new ClientPluginManager();
    const desktop = new DesktopPlugin();
    await desktop.start();
    plugins.add(desktop);
    const controller = new AbortController();
    let frames = 0;
    (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
        frames++;
        callback(0);
        return frames;
    };
    globalThis.fetch = async () => { assert.fail("startup does not repeat the launcher lookup"); };
    await plugins.clientReady(controller.signal);
    assert.deepEqual(calls, [], "browser startup never invokes native commands");
    assert.equal(frames, 0, "browser startup adds no frame delay");

    window.__RSPS_DESKTOP_PROFILE__ = { name: "Example", address: "example.com", secure: true, maxPlayers: 2047 };
    await plugins.clientReady(controller.signal);
    assert.deepEqual(calls, ["plugin:hot-update|notify_app_ready"]);
    assert.equal(frames, 1, "updates are acknowledged after a rendered frame");
    controller.abort();
    await plugins.clientReady(controller.signal);
    assert.equal(calls.length, 1, "disposed clients cannot acknowledge updates");

    delete window.__TAURI__;
    await plugins.clientReady(new AbortController().signal);
    assert.equal(calls.length, 1, "a missing bridge cannot break startup");
    const failure = new Error("Native acknowledgement unavailable");
    let warning: unknown[] | undefined;
    const previousWarn = console.warn;
    console.warn = (...args) => { warning = args; };
    window.__TAURI__ = { core: { invoke: async () => { throw failure; } } };
    try {
        await plugins.clientReady(new AbortController().signal);
        assert.equal(warning?.[1], failure);
    } finally { console.warn = previousWarn; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
