import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

type Pending = { url: URL; resolve: (value: any) => void; reject: (error: Error) => void };
const response = (body: unknown) => ({ ok: true, json: async () => body });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("new overlay selects a typed base and exposes paired model recolors", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost/", pretendToBeVisual: true });
    const globalNames = ["window", "document", "navigator", "HTMLElement", "fetch", "IS_REACT_ACT_ENVIRONMENT"] as const;
    const descriptors = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
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
            if (url.origin === "http://example.test:44695" && url.pathname === "/definitions" && (!init?.method || init.method === "GET")) {
                return Promise.resolve(response({ revision: "rev-1", rows: [] })) as Promise<Response>;
            }
            if (url.origin !== "http://example.test:43594" || (init?.method && init.method !== "GET") || ![
                "/api/cache-kinds", "/api/cache-search", "/api/cache-inspect", "/api/cache-fields",
            ].includes(url.pathname)) {
                violations.push(String(url));
                return Promise.reject(new Error("unexpected request"));
            }
            return new Promise((resolve, reject) => pending.push({ url, resolve, reject })) as Promise<Response>;
        }) as typeof fetch;

        React = await import("react");
        const { createRoot } = await import("react-dom/client");
        state = (await import("../network/serverConnection/state")).state;
        savedUrl = state.lastUrl;
        savedRtc = state.webRtcConfig;
        state.lastUrl = "ws://example.test:43594";
        state.webRtcConfig = undefined;
        const { CacheEditor } = await import("../custom/cache-editor/CacheEditor");
        root = createRoot(document.getElementById("root")!);
        await React.act(async () => root!.render(React!.createElement(CacheEditor, {})));

        const take = (path: string, query?: string) => {
            const request = pending.shift();
            assert.ok(request, `expected request ${path}`);
            assert.equal(request.url.pathname, path);
            if (query !== undefined) assert.equal(request.url.search, `?${query}`);
            return request;
        };
        const button = (text: string, scope: ParentNode = document) => {
            const match = [...scope.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === text);
            assert.ok(match, `expected button: ${text}`);
            return match;
        };
        await React.act(async () => take("/api/cache-kinds").resolve(response({ kinds: [
            { kind: "loc", label: "Loc (object)", decoded: true, usable: true, count: 100 },
            { kind: "npc", label: "NPC", decoded: true, usable: true, count: 200 },
            { kind: "item", label: "Item", decoded: true, usable: true, count: 300 },
        ] })));

        await React.act(async () => { button("+ New").click(); await tick(); });
        const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
        assert.ok(dialog);
        assert.match(dialog.textContent ?? "", /Based on/);

        const type = document.querySelector<HTMLSelectElement>("#cache-editor-base-kind");
        assert.ok(type);
        await React.act(async () => {
            Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(type, "npc");
            type.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
            await tick();
        });
        assert.equal(type.value, "npc");
        const queryInput = document.querySelector<HTMLInputElement>("#cache-editor-base-query");
        assert.ok(queryInput);
        await React.act(async () => {
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(queryInput, "goblin");
            queryInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
        await React.act(async () => button("Find", dialog).click());
        const search = take("/api/cache-search", new URLSearchParams({ text: "goblin", kind: "npc", limit: "20" }).toString());
        await React.act(async () => search.resolve(response({ hits: [{ kind: "npc", id: 7, name: "Goblin" }] })));
        const baseResult = dialog.querySelector<HTMLButtonElement>(".cache-editor-base-result");
        assert.ok(baseResult);
        await React.act(async () => baseResult.click());
        const inspect = take("/api/cache-inspect", "kind=npc&id=7");
        await React.act(async () => inspect.resolve(response({
            kind: "npc", id: 7, exists: true, name: "Goblin", label: "NPC",
            values: { name: "Goblin", recolorFrom: [123], recolorTo: [456] },
        })));
        assert.match(dialog.textContent ?? "", /npc 7/);

        await React.act(async () => button("Create definition").click());
        const fields = take("/api/cache-fields", "kind=npc&all=1");
        await React.act(async () => fields.resolve(response({ fields: [
            { name: "name", type: "string" },
            { name: "recolorFrom", type: "int[]" },
            { name: "recolorTo", type: "int[]" },
        ] })));
        assert.equal(document.querySelector('[role="dialog"]'), null, "creation replaces the modal with the new draft editor");
        assert.ok([...document.querySelectorAll("button")].some((entry) => entry.textContent?.includes("Save changes")));
        assert.ok(document.querySelector('[aria-label="Original packed HSL color 1"]'));
        assert.equal(document.querySelector('[aria-label="Edit recolorFrom"]'), null, "paired controls replace the raw array editors");

        await React.act(async () => button("+ Add color pair").click());
        const original = document.querySelector<HTMLInputElement>('[aria-label="Original packed HSL color 2"]');
        const replacement = document.querySelector<HTMLInputElement>('[aria-label="Choose replacement color 2"]');
        assert.ok(original && replacement);
        await React.act(async () => {
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(original, "1234");
            original.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
        await React.act(async () => {
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(replacement, "#ff0000");
            replacement.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        });
        const summary = [...document.querySelectorAll("summary")].find((entry) => entry.textContent?.includes("View draft data"));
        assert.ok(summary);
        await React.act(async () => summary.click());
        const draft = document.querySelector(".cache-editor-draft-data code")?.textContent ?? "";
        assert.match(draft, /"recolorFrom":\[123,1234\]/);
        assert.match(draft, /"recolorTo":\[456,960\]/);
        assert.deepEqual(violations, []);
        assert.equal(pending.length, 0);
    } finally {
        try { if (root && React) await React.act(async () => root!.unmount()); }
        finally {
            if (state && savedUrl !== undefined) { state.lastUrl = savedUrl; state.webRtcConfig = savedRtc; }
            for (const name of globalNames) {
                const descriptor = descriptors.get(name);
                if (descriptor) Object.defineProperty(globalThis, name, descriptor);
                else Reflect.deleteProperty(globalThis, name);
            }
            dom.window.close();
        }
    }
});
