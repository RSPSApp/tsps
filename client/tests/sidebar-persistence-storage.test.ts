import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserSidebarPersistence } from "../game/sidebar/BrowserSidebarPersistence";
import { SidebarStore } from "../game/sidebar/SidebarStore";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
function withWindow(value: unknown, run: () => void): void {
    Object.defineProperty(globalThis, "window", { configurable: true, value });
    try { run(); } finally {
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else Reflect.deleteProperty(globalThis, "window");
    }
}
const denied = () => { throw new DOMException("storage denied", "SecurityError"); };

test("sidebar storage controls: absence, roundtrip, and method failures", () => {
    withWindow({}, () => assert.equal(createBrowserSidebarPersistence("sidebar"), undefined));
    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
    };
    withWindow({ localStorage: storage }, () => {
        const store = new SidebarStore(createBrowserSidebarPersistence("sidebar"));
        assert.deepEqual(store.getState(), { selected: null, collapsed: false });
        store.select("Inventory");
        store.setCollapsed(true);
        const restored = new SidebarStore(createBrowserSidebarPersistence("sidebar"));
        assert.deepEqual(restored.getState(), { selected: "Inventory", collapsed: true });
    });
    withWindow({ localStorage: { getItem: denied, setItem: denied } }, () => {
        const store = new SidebarStore(createBrowserSidebarPersistence("sidebar"));
        store.select("Skills");
        assert.deepEqual(store.getState(), { selected: "Skills", collapsed: false });
    });
    let blocked = false;
    withWindow({ get localStorage() { if (blocked) denied(); return storage; } }, () => {
        const persistence = createBrowserSidebarPersistence("sidebar")!;
        blocked = true;
        assert.equal(persistence.load(), undefined);
        assert.doesNotThrow(() => persistence.save({ open: true, selectedId: "Skills", collapsed: false }));
    });
});

test("sidebar denied acquisition falls back to in-memory store", () => {
    withWindow({ get localStorage() { return denied(); } }, () => {
        const persistence = createBrowserSidebarPersistence("sidebar");
        assert.equal(persistence, undefined);
        const store = new SidebarStore(persistence);
        assert.deepEqual(store.getState(), { selected: null, collapsed: false });
        store.select("Skills");
        store.setCollapsed(true);
        assert.deepEqual(store.getState(), { selected: "Skills", collapsed: true });
    });
});
