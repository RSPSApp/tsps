// Unexecuted test-only candidate: place in client/tests at the reviewed pin.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

type Pending = { url: URL; resolve: (value: any) => void; reject: (error: Error) => void };
const hit = (id: number, name: string) => ({ hits: [{ kind: "loc", id, name }] });
const response = (body: unknown) => ({ ok: true, json: async () => body });

async function fixture(run: (f: { submit: (text: string, enter?: boolean, expectedKind?: string) => Promise<Pending>; kind: () => Promise<void>; body: () => string; settle: (p: Pending, body: unknown) => Promise<void>; fail: (p: Pending, message: string) => Promise<void> }) => Promise<void>) {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/", pretendToBeVisual: true });
    const names = ["window", "document", "navigator", "HTMLElement", "fetch", "IS_REACT_ACT_ENVIRONMENT"] as const;
    const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const pending: Pending[] = [];
    const violations: string[] = [];
    let root: { unmount: () => void } | undefined;
    let state: (typeof import("../network/serverConnection/state"))["state"] | undefined;
    let savedUrl: string | undefined;
    let savedRtc: (typeof import("../network/serverConnection/state"))["state"]["webRtcConfig"];
    let React: typeof import("react") | undefined;
    try {
        Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(String(input));
            if (url.origin !== "http://example.test:43594" || (init?.method && init.method !== "GET") || !["/api/cache-kinds", "/api/cache-search"].includes(url.pathname)) {
                violations.push(String(url));
                return Promise.reject(new Error("unexpected request"));
            }
            return new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
        }) as typeof fetch;
        React = await import("react");
        const { createRoot } = await import("react-dom/client");
        state = (await import("../network/serverConnection/state")).state;
        savedUrl = state.lastUrl; savedRtc = state.webRtcConfig;
        state.lastUrl = "ws://example.test:43594"; state.webRtcConfig = undefined;
        const { CacheEditor } = await import("../custom/cache-editor/CacheEditor");
        const mounted = createRoot(document.getElementById("root")!); root = mounted;
        await React.act(async () => mounted.render(React!.createElement(CacheEditor, {})));
        const take = (path: string, query?: string, expectedKind = "loc") => {
            const p = pending.shift(); assert.ok(p); assert.equal(p.url.pathname, path);
            if (query === undefined) assert.equal(p.url.search, "");
            else assert.equal(p.url.search, "?" + new URLSearchParams({ text: query, kind: expectedKind, limit: "20" }));
            return p;
        };
        await React.act(async () => take("/api/cache-kinds").resolve(response({ kinds: [{ kind: "loc", label: "Loc", usable: true }, { kind: "npc", label: "NPC", usable: true }] })));
        const input = document.querySelector<HTMLInputElement>('input[placeholder="name or id, e.g. crate"]');
        const find = [...document.querySelectorAll("button")].find(button => button.textContent === "Find");
        assert.ok(input && find);
        const submit = async (text: string, enter = false, expectedKind = "loc") => {
            await React!.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
            await React!.act(async () => { if (enter) input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); else find.click(); });
            return take("/api/cache-search", text, expectedKind);
        };
        await run({ submit, body: () => document.body.textContent!,
            kind: async () => { const select = document.querySelector<HTMLSelectElement>("select"); assert.ok(select); await React!.act(async () => { select.value = "npc"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); }); },
            settle: async (p, body) => { await React!.act(async () => p.resolve(response(body))); },
            fail: async (p, message) => { await React!.act(async () => p.reject(new Error(message))); },
        });
    } finally {
        try { if (root && React) await React.act(async () => root!.unmount()); }
        finally {
            if (state && savedUrl !== undefined) { state.lastUrl = savedUrl; state.webRtcConfig = savedRtc; }
            for (const name of names) { const descriptor = descriptors.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
            dom.window.close();
            assert.deepEqual(violations, [], "unexpected I/O");
            assert.equal(pending.length, 0, "unconsumed requests");
        }
    }
}

test("ordinary Find and Enter searches display their results", async () => fixture(async f => {
    await f.settle(await f.submit("first"), hit(1, "First result")); assert.match(f.body(), /First result/);
    await f.settle(await f.submit("second", true), hit(2, "Second result")); assert.match(f.body(), /Second result/);
}));
test("older search cannot replace latest result", async () => fixture(async f => {
    const old = await f.submit("older"), latest = await f.submit("newer");
    await f.settle(latest, hit(2, "Latest result")); assert.match(f.body(), /Latest result/);
    await f.settle(old, hit(3, "Obsolete result")); assert.match(f.body(), /Latest result/); assert.doesNotMatch(f.body(), /Obsolete result/);
}));
test("kind change invalidates pending search", async () => fixture(async f => {
    const old = await f.submit("before kind change"); await f.kind();
    const fresh = await f.submit("after kind change", false, "npc");
    await f.settle(fresh, { hits: [{ kind: "npc", id: 5, name: "Fresh NPC" }] });
    assert.match(f.body(), /Fresh NPC/);
    await f.settle(old, hit(4, "Wrong kind"));
    assert.match(f.body(), /Fresh NPC/); assert.doesNotMatch(f.body(), /Wrong kind/);
}));
test("current failure is visible", async () => fixture(async f => {
    await f.fail(await f.submit("failure"), "Current failure"); assert.match(f.body(), /Current failure/);
}));
test("obsolete failure cannot replace newer success", async () => fixture(async f => {
    const old = await f.submit("older"), latest = await f.submit("newer");
    await f.settle(latest, hit(5, "Latest success")); assert.match(f.body(), /Latest success/);
    await f.fail(old, "Obsolete failure"); assert.doesNotMatch(f.body(), /Obsolete failure/); assert.match(f.body(), /Latest success/);
}));
