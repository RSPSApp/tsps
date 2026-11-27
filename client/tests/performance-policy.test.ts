import assert from "node:assert/strict";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { PerformanceConfig, PerformanceMode, isWebGPURendererActive } from "../game/performance/PerformanceConfig";
import {
    computePerformancePolicy,
    getWorkerPerformancePolicy,
    initPerformancePolicy,
    resolveAutoTier,
    type PerformanceFacts,
} from "../game/performance/PerformancePolicy";

const desktop: PerformanceFacts = {
    handheld: false, ios: false, phone: false, coarsePointer: false,
    cores: 8, coresKnown: true, deviceMemoryGb: 8, signature: "policy-desktop",
};
const phone: PerformanceFacts = {
    handheld: true, ios: false, phone: true, coarsePointer: true,
    cores: 8, coresKnown: true, deviceMemoryGb: 4, signature: "policy-phone",
};

const policyFor = (mode: PerformanceMode, facts = desktop) => {
    const config = new ConfigManager();
    config.setConfigValue(PerformanceConfig, "mode", mode);
    return computePerformancePolicy(config, { facts, probe: false });
};

const low = policyFor(PerformanceMode.LOW);
assert.deepEqual({
    preset: low.preset, scene: low.sceneResolution, draw: low.drawDistanceCap, lod: low.lodThresholdCap,
    fps: low.fpsLimit, msaa: low.sceneMsaaSamples, workers: low.workerCount,
    map: low.mapSquareCacheLimit, chunkSquares: low.sceneChunkMaxSquares,
    chunkBytes: low.sceneChunkMaxBytes, fullDat2: low.cacheFullDat2, restore: low.cacheRestore,
    prefetch: low.cachePrefetch, nearby: low.nearbyOnlyMaps, oneSquare: low.oneMapSquarePerFrame,
    hudHz: low.hudMaxHz, hudCache: low.hudSizeCacheMs, unanimated: low.unanimatedPlayerCount,
    maxPlayers: low.maxPlayersPerMap, reducedOverlays: low.reducedOverlayWork,
    banding: low.colorBanding, fog: low.autoFogDepthFactor,
}, {
    preset: "low", scene: 0.5, draw: 12, lod: 6, fps: 30, msaa: 0, workers: 1,
    map: 64, chunkSquares: 1, chunkBytes: 24 << 20, fullDat2: false, restore: false,
    prefetch: false, nearby: true, oneSquare: true, hudHz: 25, hudCache: 500,
    unanimated: 25, maxPlayers: 32, reducedOverlays: true, banding: 55, fog: 0.7,
});

const medium = policyFor(PerformanceMode.MEDIUM);
assert.equal(medium.preset, "medium");
assert.equal(medium.sceneResolution, 1);
assert.equal(medium.drawDistanceCap, 20);
assert.equal(medium.lodThresholdCap, 20);
assert.equal(medium.fpsLimit, 60);
assert.equal(medium.sceneMsaaSamples, 0);
assert.equal(medium.workerCount, 2);
assert.equal(medium.mapSquareCacheLimit, 128);
assert.equal(medium.sceneChunkMaxSquares, 2);
assert.equal(medium.cacheFullDat2, false);
assert.equal(medium.cacheRestore, true);
assert.equal(medium.cachePrefetch, true);
assert.equal(medium.nearbyOnlyMaps, false);
assert.equal(medium.oneMapSquarePerFrame, false);
assert.equal(medium.hudMaxHz, 0);
assert.equal(medium.unanimatedPlayerCount, 100);
assert.equal(medium.maxPlayersPerMap, 64);
assert.equal(medium.reducedOverlayWork, false);

const high = policyFor(PerformanceMode.HIGH);
assert.equal(high.preset, "high");
assert.equal(high.sceneResolution, 1);
assert.equal(high.drawDistanceCap, 160);
assert.equal(high.lodThresholdCap, 160);
assert.equal(high.fpsLimit, 240);
assert.equal(high.workerCount, 4, "8 cores leaves headroom for four scene workers");
assert.equal(high.mapSquareCacheLimit, 256);
assert.equal(high.sceneChunkMaxSquares, 4);
assert.equal(high.cacheFullDat2, true);
assert.equal(high.nearbyOnlyMaps, false);
assert.equal(high.maxPlayersPerMap, Number.POSITIVE_INFINITY);

// Auto keeps today's mobile preset, including 30 FPS and the reduced scene.
const autoMobile = computePerformancePolicy(new ConfigManager(), { facts: phone, probe: false });
assert.equal(autoMobile.mode, PerformanceMode.AUTO);
assert.equal(autoMobile.preset, "auto-mobile");
assert.equal(autoMobile.sceneResolution, 0.6);
assert.equal(autoMobile.drawDistanceCap, 20);
assert.equal(autoMobile.lodThresholdCap, 10, "today's mobile low-end LOD cap is preserved");
assert.equal(autoMobile.fpsLimit, 30);
assert.equal(autoMobile.workerCount, 1);

// Auto desktop: core/memory caps first, then the probe.
assert.equal(resolveAutoTier({ ...desktop, cores: 2 }), "low");
assert.equal(resolveAutoTier({ ...desktop, cores: 4, deviceMemoryGb: undefined }), "medium");
assert.equal(resolveAutoTier(desktop, 2), "high");
assert.equal(resolveAutoTier(desktop, 6), "medium");
assert.equal(resolveAutoTier(desktop, 20), "low");
assert.equal(resolveAutoTier({ ...desktop, cores: 8, coresKnown: false, deviceMemoryGb: undefined }, 2), "high",
    "hidden hardware facts fall back to the probe");

// Explicit overrides, including on a phone.
const overridden = new ConfigManager();
overridden.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
overridden.setConfigValue(PerformanceConfig, "sceneResolution", 80);
overridden.setConfigValue(PerformanceConfig, "drawDistance", 120);
overridden.setConfigValue(PerformanceConfig, "fpsLimit", 0);
const custom = computePerformancePolicy(overridden, { facts: phone, probe: false });
assert.equal(custom.sceneResolution, 0.8);
assert.equal(custom.explicitDrawDistance, 120);
assert.equal(custom.fpsLimit, 0);
assert.equal(custom.explicitFpsLimit, 0);
assert.equal(custom.workerCount, 1, "Low's one-worker choice also satisfies the phone cap");

// Worker payload matches the policy.
const workerConfig = new ConfigManager();
workerConfig.setConfigValue(PerformanceConfig, "mode", PerformanceMode.MEDIUM);
initPerformancePolicy(workerConfig);
assert.deepEqual(getWorkerPerformancePolicy(), {
    mapSquareCacheLimit: 128,
    sceneChunkMaxSquares: 2,
    sceneChunkMaxBytes: 64 << 20,
});

// WebGPU has no scene-resolution scaling yet: the control is disabled and says so.
(globalThis as any).__osrsClient = { renderer: { type: "webgpu" } };
assert.equal(isWebGPURendererActive(), true);
assert.equal(PerformanceConfig.items.sceneResolution.disabled?.(), true);
assert.match(PerformanceConfig.items.sceneResolution.disabledReason ?? "", /follow-up/);
(globalThis as any).__osrsClient = { renderer: { type: "webgl" } };
assert.equal(PerformanceConfig.items.sceneResolution.disabled?.(), false);
delete (globalThis as any).__osrsClient;

console.log("performance policy: tier table, Auto rule, overrides and worker payload");
