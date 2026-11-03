import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import * as React from "react";
import { createRoot } from "react-dom/client";

// The phone check reads the user agent when DeviceUtil loads, so the globals come first and the
// modules under test are imported afterwards.
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
    // DeviceUtil probes WebGL at load; jsdom reports the missing canvas, which is expected.
    virtualConsole: new VirtualConsole(),
});
Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)", maxTouchPoints: 5 },
});

/** A Screen Orientation API whose landscape lock excludes portrait until unlocked. */
function orientationMock(deferLock: boolean) {
    const state = { locked: false, locks: 0, unlocks: 0 };
    const pending: Array<() => void> = [];
    const api = {
        type: "portrait-primary",
        lock: () => {
            state.locks++;
            return new Promise<void>((resolve) => {
                const grant = () => {
                    state.locked = true;
                    resolve();
                };
                if (deferLock) pending.push(grant);
                else grant();
            });
        },
        unlock: () => {
            state.unlocks++;
            state.locked = false;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
    };
    Object.defineProperty(dom.window.screen, "orientation", { configurable: true, value: api });
    return { state, grantPending: () => pending.splice(0).forEach((grant) => grant()) };
}

void (async () => {
    const { useSafariLandscapeLock } = await import("../game/useSafariLandscapeLock");
    const { setPortraitModeEnabled } = await import("../game/plugins/portraitmode/PortraitLayout");

    function Lock(): null {
        useSafariLandscapeLock(true);
        return null;
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    // Off, then on: the lock taken with Portrait Mode off is released when it turns on.
    {
        const orientation = orientationMock(false);
        const root = createRoot(document.getElementById("root")!);
        await React.act(async () => root.render(React.createElement(Lock)));
        await settle();
        assert.equal(orientation.state.locked, true, "portrait mode off locks landscape");
        assert.equal(orientation.state.locks, 1);

        await React.act(async () => setPortraitModeEnabled(true));
        await settle();
        assert.equal(orientation.state.locked, false, "turning portrait mode on releases the lock");
        assert.ok(orientation.state.unlocks >= 1);

        // Taps no longer lock while it is on.
        await React.act(async () => {
            dom.window.dispatchEvent(new dom.window.Event("click"));
        });
        await settle();
        assert.equal(orientation.state.locks, 1, "no new lock while portrait mode is on");
        assert.equal(orientation.state.locked, false);

        // And off again locks landscape as before.
        await React.act(async () => setPortraitModeEnabled(false));
        await settle();
        assert.equal(orientation.state.locked, true, "turning it off locks landscape again");
        await React.act(async () => root.unmount());
    }

    // A lock request still pending when Portrait Mode turns on is released once it is granted.
    {
        const orientation = orientationMock(true);
        const root = createRoot(document.getElementById("root")!);
        await React.act(async () => root.render(React.createElement(Lock)));
        assert.equal(orientation.state.locks, 1, "the lock was requested");
        assert.equal(orientation.state.locked, false, "but not granted yet");

        await React.act(async () => setPortraitModeEnabled(true));
        orientation.grantPending();
        await settle();
        assert.equal(orientation.state.locked, false, "a lock granted after portrait mode turned on is released");
        await React.act(async () => root.unmount());
        setPortraitModeEnabled(false);
    }

    console.log("portrait-mode-orientation-lock: ok");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
