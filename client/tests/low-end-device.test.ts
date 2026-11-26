import assert from "node:assert/strict";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { PerformanceConfig, PerformanceMode } from "../game/performance/PerformanceConfig";
import {
    computePerformancePolicy,
    getPerformancePolicy,
    initPerformancePolicy,
    refreshPerformancePolicy,
    resolveAutoTier,
} from "../game/performance/PerformancePolicy";
import {
    getSceneRenderSize,
    getSceneResolutionScale,
    resolveBrowserQualityProfile,
} from "../render/render/quality";

// These module-level device facts are resolved at import time. The point of this test is that
// the saved Performance preset, not isLowEndDevice, owns the scene scale and worker/cache budgets.
const config = new ConfigManager();
const client: any = {
    clientPlugins: { sceneResolutionScale: () => 1 },
    isOnLoginScreen: () => false,
    mobileEffectiveResolutionScale: 1,
    gameState: 30,
};
const host: any = {
    osrsClient: client,
    sceneResolutionScale: 1,
    app: { width: 1652, height: 982 },
    getSceneResolutionScale: () => getSceneResolutionScale(host),
    getSceneRenderSize: () => getSceneRenderSize(host),
    resolveBrowserQualityProfile: () => resolveBrowserQualityProfile(host),
    syncBrowserQualityProfile: () => resolveBrowserQualityProfile(host),
};

config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
initPerformancePolicy(config);

const low = getPerformancePolicy();
assert.equal(low.mode, PerformanceMode.LOW);
assert.equal(low.preset, "low");
assert.equal(low.sceneResolution, 0.5);
assert.equal(low.drawDistanceCap, 12);
assert.equal(low.lodThresholdCap, 6);
assert.equal(low.fpsLimit, 30);
assert.equal(low.sceneMsaaSamples, 0);
assert.equal(low.workerCount, 1, "Low allows one scene worker on a two-core PC");
assert.equal(low.mapSquareCacheLimit, 64);
assert.equal(low.sceneChunkMaxSquares, 1);
assert.equal(low.cacheFullDat2, false);
assert.equal(low.cacheRestore, false);
assert.equal(low.nearbyOnlyMaps, true);
assert.equal(low.oneMapSquarePerFrame, true);
assert.equal(low.hudMaxHz, 25);
assert.equal(low.hudSizeCacheMs, 500);
assert.equal(low.unanimatedPlayerCount, 25);
assert.equal(low.maxPlayersPerMap, 32);
assert.equal(low.reducedOverlayWork, true);
assert.equal(low.autoFogDepthFactor, 0.7);

assert.equal(getSceneResolutionScale(host), 0.5);
assert.deepEqual(getSceneRenderSize(host), { width: 826, height: 491 });
assert.equal(resolveBrowserQualityProfile(host).key, "low-end");

config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
refreshPerformancePolicy();
assert.equal(getPerformancePolicy().fpsLimit, 240);
assert.equal(getPerformancePolicy().sceneResolution, 1);
assert.equal(getPerformancePolicy().drawDistanceCap, 160);
assert.equal(resolveBrowserQualityProfile(host).key, "desktop");
assert.equal(getSceneResolutionScale(host), 1, "High keeps the scene at native resolution");
assert.deepEqual(getSceneRenderSize(host), { width: 1652, height: 982 });

// Stretched Mode's scene-resolution setting is an explicit reduction, also on Low.
client.clientPlugins.sceneResolutionScale = () => 0.75;
assert.equal(getSceneResolutionScale(host), 0.75, "Stretched Mode is no longer ignored");
client.clientPlugins.sceneResolutionScale = () => 1;

// The new per-field override beats the preset.
config.setConfigValue(PerformanceConfig, "sceneResolution", 60);
refreshPerformancePolicy();
assert.equal(getSceneResolutionScale(host), 0.6, "an explicit scene-resolution override wins");
config.setConfigValue(PerformanceConfig, "sceneResolution", 0);

client.isOnLoginScreen = () => true;
assert.equal(getSceneResolutionScale(host), 1, "the login screen stays at native resolution");
client.isOnLoginScreen = () => false;

// Auto resolves by hardware facts and the probe, not by the GPU name.
const desktopFacts = (cores: number, memory?: number) => ({
    handheld: false, ios: false, phone: false, coarsePointer: false,
    cores, coresKnown: true, deviceMemoryGb: memory, signature: `t:${cores}:${memory ?? "?"}`,
});
assert.equal(resolveAutoTier(desktopFacts(2)), "low", "two cores is Low");
assert.equal(resolveAutoTier(desktopFacts(4)), "medium", "four cores without memory info is Medium");
assert.equal(resolveAutoTier(desktopFacts(8, 8), 1), "high", "a fast probe on a large desktop is High");
assert.equal(resolveAutoTier(desktopFacts(8, 8), 12), "low", "a slow probe overrides the nominal hardware");
assert.equal(resolveAutoTier({ ...desktopFacts(8, 8), handheld: true, signature: "mobile" }), "low",
    "handhelds stay on the mobile preset");

// Phone/tablet memory caps survive High.
const handheldFacts = {
    handheld: true, ios: false, phone: true, coarsePointer: true,
    cores: 8, coresKnown: true, deviceMemoryGb: 8, signature: "phone-high",
};
const mobileHigh = computePerformancePolicy(config, { facts: handheldFacts, probe: false });
assert.equal(mobileHigh.tier, "high");
assert.equal(mobileHigh.workerCount, 2, "handheld worker cap");
assert.equal(mobileHigh.mapSquareCacheLimit, 64, "handheld map cache cap");
assert.equal(mobileHigh.sceneChunkMaxSquares, 1, "handheld chunk square cap");
assert.equal(mobileHigh.sceneChunkMaxBytes, 24 << 20, "handheld chunk byte cap");
assert.equal(mobileHigh.cacheFullDat2, false, "handhelds never load the full dat2");
assert.equal(mobileHigh.cacheRestore, false);
assert.equal(mobileHigh.cachePrefetch, false);
assert.equal(mobileHigh.nearbyOnlyMaps, true, "handhelds keep near-only map building even on High");

console.log("low-end device: Performance preset owns scene scale and worker/cache budgets");
