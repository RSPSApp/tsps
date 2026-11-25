import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) {
    require.extensions[ext] = (module, file) => { module.exports = file; };
}
(globalThis as any).self = globalThis;
const { WebGPURenderer } = require("../render/webgpu/WebGPURenderer");
const { WebGPUUi } = require("../render/webgpu/ui/WebGPUUi");

test("WebGPU initializes title/loading presentation before the cache and world exist", async () => {
    const renderer = Object.create(WebGPURenderer.prototype);
    const device = { lost: new Promise(() => {}) };
    const context = { configure() {} };
    Object.assign(renderer, {
        canvas: { width: 800, height: 600, getContext: () => context },
        osrsClient: { inputManager: { init() {} } },
        ensureDepthTexture() { this.depthView = {}; },
    });
    const probe = WebGPURenderer.probeAdapter;
    const initUi = WebGPUUi.prototype.init;
    const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const win = Object.getOwnPropertyDescriptor(globalThis, "window");
    let initialized = 0;
    try {
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
            gpu: { getPreferredCanvasFormat: () => "bgra8unorm" },
        } });
        Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
        WebGPURenderer.probeAdapter = async () => ({ requestDevice: async () => device });
        WebGPUUi.prototype.init = async function () { initialized++; };
        await renderer.init();
        assert.equal(renderer.world, undefined);
        assert.equal(renderer.osrsClient.loadedCache, undefined);
        assert.equal(initialized, 1, "phased cache loading needs a presentation before initCache");
        assert.ok(renderer.ui instanceof WebGPUUi);
    } finally {
        WebGPURenderer.probeAdapter = probe;
        WebGPUUi.prototype.init = initUi;
        if (nav) Object.defineProperty(globalThis, "navigator", nav);
        else delete (globalThis as any).navigator;
        if (win) Object.defineProperty(globalThis, "window", win);
        else delete (globalThis as any).window;
    }
});

test("WebGPU presents each loading frame while world resources are unavailable", () => {
    const renderer = Object.create(WebGPURenderer.prototype);
    const updates: [number, number][] = [];
    Object.assign(renderer, {
        canvas: { width: 800, height: 600 },
        device: {}, depthView: {}, world: undefined,
        ui: { update: (time: number, delta: number) => updates.push([time, delta]) },
    });
    renderer.render(1000, 16, false);
    renderer.render(1016, 16, false);
    assert.deepEqual(updates, [[1000, 16], [1016, 16]],
        "loading percent/text changes must reach the DOM surface instead of a blank canvas");
});


test("WebGPU widget adapter exposes the same lazy native preview loaders as world interaction", async () => {
    const paths = ['../widgets/gl/widgetsOverlayFactory', '../render/webgpu/ui/presentation', '../render/webgpu/ui/WebGPUUi'].map(path => require.resolve(path));
    const previous = paths.map(path => require.cache[path]);
    let host: any;
    const npcLoader = {}, locLoader = {};
    try {
        require.cache[paths[0]] = { ...previous[0], exports: { createWidgetsOverlay: (adapter: any) => { host = adapter; return {}; } } } as any;
        require.cache[paths[1]] = { ...previous[1], exports: { WebgpuUiPresentation: class { attachLoginLayer() {} } } } as any;
        delete require.cache[paths[2]];
        const { WebGPUUi: ActualUi } = require(paths[2]);
        let calls = 0;
        const renderer = { canvas: { width: 800, height: 600 }, osrsClient: {}, interactionHost: {
            getInteractNpcModelLoader() { calls++; return npcLoader; },
            getInteractLocModelLoader() { return locLoader; },
        } };
        await new ActualUi(renderer).init();
        assert.equal(calls, 0, 'preview loaders stay lazy before cache initialization');
        assert.equal(host.getInteractNpcModelLoader?.(), npcLoader, 'full-body widgets need the native NPC loader under WebGPU');
        assert.equal(host.getInteractLocModelLoader?.(), locLoader);
    } finally {
        paths.forEach((path, index) => { if (previous[index]) require.cache[path] = previous[index]; else delete require.cache[path]; });
    }
});
