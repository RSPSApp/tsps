import assert from "node:assert/strict";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { PerformanceConfig, PerformanceMode } from "../game/performance/PerformanceConfig";
import {
    computePerformancePolicy,
    initPerformancePolicy,
    refreshPerformancePolicy,
} from "../game/performance/PerformancePolicy";

(globalThis as any).self = globalThis;

async function main(): Promise<void> {
    const { resolveEffectiveRenderDistanceTiles } = await import("../render/render/draw2");
    const { resolveEffectiveLodThresholdTiles } = await import("../render/render/misc");
    const { resolveBrowserQualityProfile } = await import("../render/render/quality");
    const { resolveWebGPURenderDistance, resolveWebGPULodDistance } = await import("../render/webgpu/frameConfig");

    const config = new ConfigManager();
    const host: any = {
        osrsClient: {
            renderDistance: 25,
            lodDistance: 23,
            isOnLoginScreen: () => false,
            clientPlugins: { gpuSettings: () => undefined, hdEnabled: () => false, sceneResolutionScale: () => 1 },
        },
        syncBrowserQualityProfile: () => resolveBrowserQualityProfile(host),
    };
    let frame = 0;
    const distance = () => resolveEffectiveRenderDistanceTiles(host, ++frame);
    host.getFrameRenderDistanceTiles = distance;
    const lod = () => resolveEffectiveLodThresholdTiles(host, ++frame);

    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
    initPerformancePolicy(config);
    assert.equal(resolveBrowserQualityProfile(host).key, "low-end");
    assert.equal(distance(), 12, "Low cap");
    assert.equal(lod(), 6, "Low detail cap");
    assert.equal(resolveWebGPURenderDistance(host), 12);
    assert.equal(resolveWebGPULodDistance(host), 6);

    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.MEDIUM);
    refreshPerformancePolicy();
    assert.equal(resolveBrowserQualityProfile(host).key, "medium");
    assert.equal(distance(), 20, "Medium cap");
    assert.equal(lod(), 20, "Medium detail cap");
    assert.equal(resolveWebGPURenderDistance(host), 20);

    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.HIGH);
    refreshPerformancePolicy();
    assert.equal(resolveBrowserQualityProfile(host).key, "desktop");
    assert.equal(distance(), 25, "High keeps the client default draw distance unless the user raises it");
    assert.equal(lod(), 23);
    assert.equal(resolveWebGPURenderDistance(host), 25);

    // An explicit draw distance beats every preset cap and is shared by both renderers.
    config.setConfigValue(PerformanceConfig, "drawDistance", 70);
    refreshPerformancePolicy();
    assert.equal(distance(), 70, "an explicit draw distance beats the High cap");
    assert.equal(lod(), 68, "detail follows the explicit draw distance");
    assert.equal(resolveWebGPURenderDistance(host), 70);
    assert.equal(resolveWebGPULodDistance(host), 68);

    // The same override on a phone still beats the Auto mobile cap, even though handheld memory
    // budgets stay in force for workers/caches.
    const phoneFacts = {
        handheld: true, ios: true, phone: true, coarsePointer: true,
        cores: 8, coresKnown: true, deviceMemoryGb: 8, signature: "phone-explicit",
    };
    const phonePolicy = computePerformancePolicy(config, { facts: phoneFacts, probe: false });
    assert.equal(phonePolicy.explicitDrawDistance, 70);
    assert.equal(phonePolicy.workerCount, 1, "phone worker memory cap remains");
    assert.equal(phonePolicy.cacheFullDat2, false, "phone full-cache cap remains");

    console.log("mobile render settings: tier caps, explicit overrides, shared WebGPU behavior");
}

void main();
