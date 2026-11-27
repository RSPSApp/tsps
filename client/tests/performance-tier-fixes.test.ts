import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { EventBus } from "../runelite/client/eventbus/EventBus";
import { CLIENT_TOKEN } from "../runelite/client/plugins/PluginInjector";
import { PluginManager } from "../runelite/client/plugins/PluginManager";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { GpuPlugin } from "../game/plugins/gpu/GpuPlugin";
import { PerformanceConfig, PerformanceMode } from "../game/performance/PerformanceConfig";
import {
    _setAutoCacheForTests,
    computePerformancePolicy,
    getPerformanceFacts,
    getPerformancePolicy,
    initPerformancePolicy,
    refreshPerformancePolicy,
    type PerformanceFacts,
} from "../game/performance/PerformancePolicy";
import { PerformancePlugin } from "../game/performance/PerformancePlugin";

(globalThis as any).self = globalThis;
require.extensions[".glsl"] = (module: any, file: string) => { module.exports = require("node:fs").readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module: any, file: string) => { module.exports = file; };
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size; },
    clear: () => memory.clear(),
} });

const desktopFacts: PerformanceFacts = {
    handheld: false, ios: false, phone: false, coarsePointer: false,
    cores: 8, coresKnown: true, deviceMemoryGb: 8, signature: "fixes-desktop",
};
const phoneFacts: PerformanceFacts = {
    handheld: true, ios: false, phone: true, coarsePointer: true,
    cores: 8, coresKnown: true, deviceMemoryGb: 8, signature: "fixes-phone",
};

async function setupPlugins(mode: PerformanceMode, renderDistance = 25) {
    const events = new EventBus();
    const config = new ConfigManager(events);
    const manager = new PluginManager(events, config);
    const client: any = {
        screenBrightnessListener: undefined,
        getScreenBrightness: () => 50,
        applyScreenBrightness: () => {},
        renderer: undefined,
        clientPlugins: undefined,
        renderDistance,
        isOnLoginScreen: () => false,
    };
    manager.getInjector().provide(CLIENT_TOKEN, client);
    config.setConfigValue(PerformanceConfig, "mode", mode);
    manager.loadCorePlugins([GpuPlugin, PerformancePlugin]);
    await manager.setPluginEnabled(GpuPlugin, true);
    const clientPlugins = new ClientPluginManager();
    for (const plugin of manager.getPlugins()) clientPlugins.add(plugin);
    return { config, client, clientPlugins, manager };
}

test("1. Medium has no scene MSAA; High asks for exactly four samples on WebGL and WebGPU", async () => {
    const mediumConfig = new ConfigManager();
    mediumConfig.setConfigValue(PerformanceConfig, "mode", PerformanceMode.MEDIUM);
    const medium = computePerformancePolicy(mediumConfig, {
        facts: desktopFacts, probe: false,
    });
    const highConfig = new ConfigManager();
    highConfig.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
    const high = computePerformancePolicy(highConfig, { facts: desktopFacts, probe: false });
    assert.equal(medium.sceneMsaaSamples, 0, "Medium must not enable scene MSAA");
    assert.equal(high.sceneMsaaSamples, 4);

    const policy: any = await import("../game/performance/PerformancePolicy");
    assert.equal(typeof policy.requestedMsaaSamples, "function");
    assert.equal(policy.requestedMsaaSamples(undefined, false, 0), 0);
    assert.equal(policy.requestedMsaaSamples(undefined, true, 4), 4);
    assert.equal(policy.requestedMsaaSamples(undefined, true, 0), 4);
    assert.equal(policy.requestedMsaaSamples(2, true, 4), 2);
    assert.equal(typeof policy.webgpuSampleCount, "function");
    assert.equal(policy.webgpuSampleCount(undefined, 0), 1);
    assert.equal(policy.webgpuSampleCount(undefined, 4), 4);
    assert.equal(policy.webgpuSampleCount(2, 4), 4);
    assert.equal(policy.webgpuSampleCount(0, 4), 1);
});

test("1b. applyPerformancePolicy sets the exact sample count and Medium disables it", async () => {
    const { WebGLOsrsRenderer } = await import("../render/WebGLOsrsRenderer");
    const renderer: any = Object.create(WebGLOsrsRenderer.prototype);
    renderer.fpsLimit = 120;
    renderer.autoFogDepthFactor = 0.85;
    renderer.colorBanding = 255;

    const mediumConfig = new ConfigManager();
    mediumConfig.setConfigValue(PerformanceConfig, "mode", PerformanceMode.MEDIUM);
    const medium = computePerformancePolicy(mediumConfig, { facts: desktopFacts, probe: false });
    WebGLOsrsRenderer.prototype.applyPerformancePolicy.call(renderer, medium);
    assert.equal(renderer.msaaEnabled, false);
    assert.equal(renderer.performanceMsaaSamples, 0);

    const highConfig = new ConfigManager();
    highConfig.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
    const high = computePerformancePolicy(highConfig, { facts: desktopFacts, probe: false });
    WebGLOsrsRenderer.prototype.applyPerformancePolicy.call(renderer, high);
    assert.equal(renderer.msaaEnabled, true);
    assert.equal(renderer.performanceMsaaSamples, 4);
});

test("3. GpuPlugin re-reads after a Performance policy change", async () => {
    const { config, clientPlugins } = await setupPlugins(PerformanceMode.HIGH);
    let gpu = clientPlugins.gpuSettings();
    assert.ok(gpu);
    assert.equal(gpu.msaaSamples, 4);
    assert.equal(gpu.fpsLimit, 240);

    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
    gpu = clientPlugins.gpuSettings();
    assert.ok(gpu);
    assert.equal(gpu.msaaSamples, 0, "Low turns scene AA off");
    assert.equal(gpu.fpsLimit, 30, "Low's FPS cap applies");
});

test("3b. The Performance settings plugin is not toggleable", async () => {
    assert.equal(PerformancePlugin.descriptor.toggleable, false);
    const { manager } = await setupPlugins(PerformanceMode.MEDIUM);
    await manager.setPluginEnabled(PerformancePlugin, false);
    assert.equal(manager.isEnabled(PerformancePlugin), true,
        "stored/attempted disable is ignored so config changes keep applying");
});

test("4. Untouched GPU draw distance keeps the client's longer choice", async () => {
    const { clientPlugins } = await setupPlugins(PerformanceMode.MEDIUM, 70);
    const gpu = clientPlugins.gpuSettings();
    assert.ok(gpu);
    assert.equal(gpu.drawDistance, 70, "an untouched GPU draw must not become the preset cap");

    const { resolveEffectiveRenderDistanceTiles } = await import("../render/render/draw2");
    const { resolveBrowserQualityProfile } = await import("../render/render/quality");
    const host: any = {
        osrsClient: {
            clientPlugins, renderDistance: 70, lodDistance: 68,
            isOnLoginScreen: () => false,
        },
        syncBrowserQualityProfile: () => resolveBrowserQualityProfile(host),
    };
    assert.equal(resolveEffectiveRenderDistanceTiles(host, 1), 70,
        "Medium must not reduce a longer distance the user chose");
});

test("5. Selecting Auto in the config panel clears the cached probe result", async () => {
    const { config } = await setupPlugins(PerformanceMode.HIGH);
    const facts = getPerformanceFacts();
    _setAutoCacheForTests(facts.signature, "low");
    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.AUTO);
    assert.notEqual(getPerformancePolicy().tier, "low",
        "Auto must re-detect instead of reusing the cached Low result");
});

test("6. The renderer/target FPS control and hidden-tab cap are honoured", async () => {
    const { GameRenderer } = await import("../game/GameRenderer");
    const config = new ConfigManager();
    const setMode = (mode: PerformanceMode, fps = -1) => {
        config.setConfigValue(PerformanceConfig, "mode", mode);
        config.setConfigValue(PerformanceConfig, "fpsLimit", fps);
        initPerformancePolicy(config);
        refreshPerformancePolicy();
    };
    const host = (targetFps: number, gpu?: { fpsLimit: number }) => ({
        fpsLimit: 120,
        osrsClient: { targetFps, clientPlugins: { gpuSettings: () => gpu } },
    });
    const limit = (targetFps: number, gpu?: { fpsLimit: number }) =>
        (GameRenderer.prototype as any).getEffectiveFpsLimit.call(host(targetFps, gpu));

    setMode(PerformanceMode.HIGH);
    assert.equal(limit(30), 30, "a 30 FPS renderer/target cap applies over High's 240");
    assert.equal(limit(240), 240);

    setMode(PerformanceMode.LOW);
    assert.equal(limit(240), 30, "Low's cap remains");

    setMode(PerformanceMode.HIGH);
    assert.equal(limit(30, { fpsLimit: 120 }), 30, "the renderer cap applies over an explicit GPU limit");
    assert.equal(limit(240, { fpsLimit: 10 }), 10, "an explicit GPU limit applies");

    setMode(PerformanceMode.HIGH, 60);
    assert.equal(limit(240), 60, "an explicit Performance FPS choice applies");

    setMode(PerformanceMode.HIGH);
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: true } });
    try {
        assert.equal(limit(0), 30, "hidden tabs stay capped at 30");
    } finally {
        if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
        else delete (globalThis as any).document;
    }
});

test("6b. setTargetFps honours a sub-60 desktop setting", async () => {
    const { OsrsClient } = await import("../game/OsrsClient");
    const client: any = Object.create(OsrsClient.prototype);
    client.targetFps = 240;
    client.renderer = { fpsLimit: 240 };
    OsrsClient.prototype.setTargetFps.call(client, 30);
    assert.equal(client.targetFps, 30, "the desktop renderer FPS control is not replaced by 240");
    assert.equal(client.renderer.fpsLimit, 30);
});

test("7. Handhelds get at most one worker on every preset", () => {
    for (const mode of [PerformanceMode.LOW, PerformanceMode.MEDIUM, PerformanceMode.HIGH]) {
        const config = new ConfigManager();
        config.setConfigValue(PerformanceConfig, "mode", mode);
        const policy = computePerformancePolicy(config, { facts: phoneFacts, probe: false });
        assert.equal(policy.workerCount, 1, `${mode} on a handheld`);
    }
});

test("8. Auto probe drops the first sample, takes several and logs; thresholds unchanged", async () => {
    const policy: any = await import("../game/performance/PerformancePolicy");
    assert.equal(typeof policy.summarizeProbeSamples, "function");
    assert.equal(policy.summarizeProbeSamples([100, 5, 4, 6]), 5,
        "the first measured batch is discarded and the median of the rest is used");
    assert.equal(policy.resolveAutoTier(desktopFacts, 8.1), "low", "8 ms threshold is unchanged");
    assert.equal(policy.resolveAutoTier(desktopFacts, 3.1), "medium", "3 ms threshold is unchanged");
});
