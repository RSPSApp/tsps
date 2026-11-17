import assert from "node:assert/strict";
import { mock } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { RuneLiteConfig } from "../runelite/client/config/RuneLiteConfig";
import { ProtocolNoticeBanner } from "../game/ProtocolNoticeBanner";

async function main() {
    const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document,
        IS_REACT_ACT_ENVIRONMENT: true });
    mock.timers.enable({ apis: ["setTimeout"] });
    const clearTimer = mock.method(globalThis, "clearTimeout");
    const manager = new ConfigManager(undefined, dom.window.localStorage);
    const root = createRoot(document.getElementById("root")!);
    const first = { kind: "warning" as const, message: "Unknown world" };
    const next = { kind: "error" as const, message: "Incompatible world" };
    const render = async (notice: { kind: "warning" | "error"; message: string } = first) => act(() => root.render(
        React.createElement(ProtocolNoticeBanner, { notice, configManager: manager })));
    const tick = async (ms: number) => act(() => mock.timers.tick(ms));
    try {
        assert.equal(manager.getConfig(RuneLiteConfig).showProtocolCompatibilityNotices(), true);
        await render(); await tick(2000); await render(); await tick(999);
        assert.equal(document.querySelector('[role="status"]')?.textContent, "Unknown world");
        await tick(1); assert.equal(document.querySelector('[role="status"]'), null,
            "unrelated rerenders must not prolong the three-second notice");
        await render(next); await tick(2000);
        await render({ ...first }); await tick(1000);
        assert.equal(document.querySelector('[role="status"]')?.textContent, "Unknown world",
            "replacement cancels the previous notice's timeout");
        await act(() => manager.setConfiguration("runelite", "showProtocolCompatibilityNotices", false));
        assert.equal(document.querySelector('[role="status"]'), null, "off hides immediately");
        await tick(4000);
        const reloaded = new ConfigManager(undefined, dom.window.localStorage);
        assert.equal(reloaded.getConfig(RuneLiteConfig).showProtocolCompatibilityNotices(), false,
            "notice preference persists in the existing configuration storage");
        reloaded.destroy();
        await act(() => manager.setConfiguration("runelite", "showProtocolCompatibilityNotices", true));
        assert.equal(document.querySelector('[role="status"]')?.textContent, "Unknown world");
        await tick(3000); assert.equal(document.querySelector('[role="status"]'), null);
        await render(next); assert.equal(document.querySelector('[role="alert"]')?.textContent, "Incompatible world");
        const clears = clearTimer.mock.callCount();
        await act(() => root.unmount());
        assert.equal(clearTimer.mock.callCount(), clears + 1, "unmount cancels the active notice timer");
        await tick(4000);
        console.log("Protocol notice timer, replacement, rerender, preference persistence and unmount checks passed.");
    } finally { manager.destroy(); mock.restoreAll(); mock.timers.reset(); dom.window.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
