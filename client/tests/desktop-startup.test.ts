import assert from "node:assert/strict";
import { notifyDesktopAppReady } from "../desktop";

async function main() {
    let calls: string[] = [];
    (globalThis as any).window = {
        __TAURI__: { core: { invoke: async (command: string) => { calls.push(command); } } },
    };
    await notifyDesktopAppReady();
    assert.deepEqual(calls, [], "ordinary browser startup never invokes native commands");
    window.__RSPS_DESKTOP_PROFILE__ = { name: "Example", address: "example.com", secure: true, maxPlayers: 2047 };
    await notifyDesktopAppReady();
    assert.deepEqual(calls, ["plugin:hot-update|notify_app_ready"]);
    delete window.__TAURI__;
    await notifyDesktopAppReady();
    assert.equal(calls.length, 1, "a missing bridge cannot break startup");
    const failure = new Error("Native acknowledgement unavailable");
    let warning: unknown[] | undefined;
    const previousWarn = console.warn;
    console.warn = (...args) => { warning = args; };
    window.__TAURI__ = { core: { invoke: async () => { throw failure; } } };
    try {
        await notifyDesktopAppReady();
        assert.equal(warning?.[1], failure, "a failed acknowledgement is reported without preventing play");
    } finally { console.warn = previousWarn; }
    console.log("Only desktop startup acknowledges native updates; bridge errors cannot block play.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
