// Blocked storage (a sandboxed frame, cookies blocked) throws a SecurityError on the
// `window.localStorage` read itself, not only on getItem/setItem. Each persistence entry point
// must then fall back instead of throwing during client start-up.
import assert from "node:assert/strict";
import test from "node:test";

import { loadBrowserVarcs, saveBrowserVarcs } from "../game/BrowserVarcsPersistence";
import { createBrowserEditModePluginPersistence } from "../game/plugins/editmode/BrowserEditModePluginPersistence";
import { createBrowserMenuSwapperPluginPersistence } from "../game/plugins/menuswapper/BrowserMenuSwapperPersistence";
import { defaultConfigStorage } from "../runelite/client/config/ConfigStorage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
function withWindow(value: unknown, run: () => void): void {
    Object.defineProperty(globalThis, "window", { configurable: true, value });
    try {
        run();
    } finally {
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
}
const blocked = {
    get localStorage(): Storage {
        throw new DOMException("The operation is insecure.", "SecurityError");
    },
};

test("varcs load and save do nothing when reading window.localStorage throws", () => {
    withWindow(blocked, () => {
        assert.equal(loadBrowserVarcs("varcs"), undefined);
        assert.doesNotThrow(() => saveBrowserVarcs("varcs", { ints: [], strings: [] }));
    });
});

test("edit mode and menu swapper persistence are absent when reading window.localStorage throws", () => {
    withWindow(blocked, () => {
        assert.equal(createBrowserEditModePluginPersistence("editmode"), undefined);
        assert.equal(createBrowserMenuSwapperPluginPersistence("menuswapper"), undefined);
    });
});

test("RuneLite config storage falls back to memory when reading window.localStorage throws", () => {
    withWindow(blocked, () => {
        const storage = defaultConfigStorage();
        storage.setItem("key", "value");
        assert.equal(storage.getItem("key"), "value");
    });
});

test("readable storage is still used", () => {
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
    };
    withWindow({ localStorage: storage }, () => {
        saveBrowserVarcs("varcs", { ints: [[1, 2]], strings: [[3, "x"]] });
        assert.deepEqual(loadBrowserVarcs("varcs"), { ints: [[1, 2]], strings: [[3, "x"]] });
        assert.equal(defaultConfigStorage(), storage);
    });
});
