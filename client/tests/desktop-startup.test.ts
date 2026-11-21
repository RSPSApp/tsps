import assert from "node:assert/strict";
import { DesktopPlugin } from "../game/plugins/desktop/DesktopPlugin";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";

async function main() {
    const calls: string[] = [];
    (globalThis as any).window = {
        __TAURI__: { core: { invoke: async (command: string) => { calls.push(command); } } },
    };
    const plugins = new ClientPluginManager();
    const controller = new AbortController();
    const frames: FrameRequestCallback[] = [];
    (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => frames.push(callback);
    const runFrame = () => frames.shift()!(0);
    plugins.clientReady(controller.signal);
    assert.equal(frames.length, 0, "without the desktop plugin startup schedules no native callback");

    plugins.add(new DesktopPlugin());
    plugins.clientReady(controller.signal);
    assert.deepEqual(calls, [], "the update is not acknowledged before the next frame");
    runFrame();
    assert.deepEqual(calls, ["plugin:hot-update|notify_app_ready"]);

    plugins.clientReady(controller.signal);
    controller.abort();
    runFrame();
    assert.equal(calls.length, 1, "disposed clients cannot acknowledge updates");

    delete window.__TAURI__;
    plugins.clientReady(new AbortController().signal);
    runFrame();
    assert.equal(calls.length, 1, "a missing bridge cannot break startup");
    const failure = new Error("Native acknowledgement unavailable");
    let warning: unknown[] | undefined;
    const previousWarn = console.warn;
    console.warn = (...args) => { warning = args; };
    window.__TAURI__ = { core: { invoke: async () => { throw failure; } } };
    try {
        plugins.clientReady(new AbortController().signal);
        runFrame();
        await Promise.resolve();
        assert.equal(warning?.[1], failure);
    } finally { console.warn = previousWarn; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
