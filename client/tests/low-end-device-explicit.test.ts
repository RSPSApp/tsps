import assert from "node:assert/strict";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { EventBus } from "../runelite/client/eventbus/EventBus";
import { CLIENT_TOKEN } from "../runelite/client/plugins/PluginInjector";
import { PluginManager } from "../runelite/client/plugins/PluginManager";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { GpuConfig, AntiAliasingMode } from "../game/plugins/gpu/GpuConfig";
import { GpuPlugin } from "../game/plugins/gpu/GpuPlugin";
import { PerformanceConfig, PerformanceMode } from "../game/performance/PerformanceConfig";
import { PerformancePlugin } from "../game/performance/PerformancePlugin";
import { getPerformancePolicy } from "../game/performance/PerformancePolicy";

async function main(): Promise<void> {
    (globalThis as any).self = globalThis;
    const { resolveEffectiveRenderDistanceTiles } = await import("../render/render/draw2");
    const { resolveBrowserQualityProfile } = await import("../render/render/quality");
    const events = new EventBus();
    const config = new ConfigManager(events);
    const manager = new PluginManager(events, config);
    manager.getInjector().provide(CLIENT_TOKEN, {
        screenBrightnessListener: undefined,
        getScreenBrightness: () => 50,
        applyScreenBrightness: () => {},
        renderer: undefined,
        clientPlugins: undefined,
    });
    config.setConfigValue(PerformanceConfig, "mode", PerformanceMode.LOW);
    manager.loadCorePlugins([GpuPlugin, PerformancePlugin]);
    await manager.setPluginEnabled(GpuPlugin, true);

    const clientPlugins = new ClientPluginManager();
    for (const plugin of manager.getPlugins()) clientPlugins.add(plugin);

    let frame = 0;
    const host: any = {
        osrsClient: {
            renderDistance: 25,
            lodDistance: 23,
            clientPlugins,
            isOnLoginScreen: () => false,
        },
        syncBrowserQualityProfile: () => resolveBrowserQualityProfile(host),
    };
    assert.equal(getPerformancePolicy().preset, "low");

    // The GPU plugin is on but its draw-distance field is untouched: the Low preset still caps.
    let gpu = clientPlugins.gpuSettings();
    assert.ok(gpu);
    assert.equal(gpu.drawDistance, 25, "a tier-derived GPU value starts at the hard minimum");
    assert.equal(gpu.overrideDeviceCaps, false, "an untouched GPU field must not bypass the tier cap");
    assert.equal(resolveEffectiveRenderDistanceTiles(host, ++frame), 12,
        "the Low preset's 12-tile cap applies even with the GPU plugin on");

    // An explicit GPU choice is the user's choice and beats the tier.
    config.setConfigValue(GpuConfig, "drawDistance", 70);
    config.setConfigValue(GpuConfig, "fpsLimit", 60);
    config.setConfigValue(GpuConfig, "antiAliasingMode", AntiAliasingMode.MSAA_4);
    gpu = clientPlugins.gpuSettings();
    assert.ok(gpu);
    assert.equal(gpu.drawDistance, 70);
    assert.equal(gpu.fpsLimit, 60);
    assert.equal(gpu.msaaSamples, 4);
    assert.equal(gpu.overrideDeviceCaps, true, "an explicit draw distance outranks the tier cap");
    assert.equal(resolveEffectiveRenderDistanceTiles(host, ++frame), 70);
}

main().then(() => console.log("low-end device explicit: GPU overrides beat the Performance tier"))
    .catch((error) => { console.error(error); process.exitCode = 1; });
