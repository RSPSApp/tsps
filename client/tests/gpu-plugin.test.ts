import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigManager } from "../runelite/client/config/ConfigManager";
import { EventBus } from "../runelite/client/eventbus/EventBus";
import { PluginManager } from "../runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "../runelite/client/plugins/PluginInjector";
import { AntiAliasingMode, GpuConfig } from "../game/plugins/gpu/GpuConfig";
import { GpuPlugin, resolveGpuSettings } from "../game/plugins/gpu/GpuPlugin";
import { createScenePipeline, WEBGPU_MSAA_SAMPLES, withSampleCount } from "../render/webgpu/multisample";

const settings = (antiAliasingMode: string, extra: Partial<Parameters<typeof resolveGpuSettings>[0]> = {}) =>
    resolveGpuSettings({ antiAliasingMode, drawDistance: 25, fpsLimit: 240, colorBanding: 0, autoFog: true, fogStart: 85, manualFogStart: 24, ...extra });

assert.equal(GpuConfig.items.antiAliasingMode.default, AntiAliasingMode.MSAA_4, "desktop AA default is preserved");
assert.equal(GpuConfig.items.fpsLimit.default, 240, "desktop FPS default is preserved");

// Each anti-aliasing mode maps to MSAA samples or FXAA, never both.
assert.deepEqual(
    Object.values(AntiAliasingMode).map((mode) => [settings(mode).msaaSamples, settings(mode).fxaa]),
    [[0, false], [0, true], [2, false], [4, false], [8, false], [16, false]],
);
assert.equal(settings("unknown").msaaSamples, 0, "an unknown stored mode is no anti-aliasing");

// Draw distance and the FPS cap are clamped to their ranges.
assert.equal(settings(AntiAliasingMode.DISABLED, { drawDistance: 5 }).drawDistance, 25);
assert.equal(settings(AntiAliasingMode.DISABLED, { drawDistance: 500 }).drawDistance, 160);
assert.equal(settings(AntiAliasingMode.DISABLED, { fpsLimit: -1 }).fpsLimit, 0);

// Colour banding uses the dev panel's mapping: 0% is the smooth 255.
assert.equal(settings(AntiAliasingMode.DISABLED).colorBanding, 255);
assert.equal(settings(AntiAliasingMode.DISABLED, { colorBanding: 100 }).colorBanding, 55);

// Fog options and the renderer choice are plugin settings, not just debug-panel ones.
assert.deepEqual(
    [settings(AntiAliasingMode.DISABLED).autoFogDepth, settings(AntiAliasingMode.DISABLED).autoFogDepthFactor, settings(AntiAliasingMode.DISABLED).fogDepth],
    [true, 0.85, 24],
);
assert.equal(settings(AntiAliasingMode.DISABLED, { fogStart: 500, manualFogStart: 999 }).autoFogDepthFactor, 1);
assert.equal(settings(AntiAliasingMode.DISABLED, { manualFogStart: 999 }).fogDepth, 400);
assert.equal(settings(AntiAliasingMode.DISABLED).overrideDeviceCaps, true,
    "explicit GPU choices outrank the mobile profile's distance caps");
for (const key of ["renderer", "brightness", "autoFog", "fogStart", "manualFogStart", "skyColor"]) assert.ok(key in GpuConfig.items, key);
assert.equal(GpuConfig.items.skyColor.color, true, "the area sky colour is editable outside the debug panel");

// Scene pipelines get one multisampled twin, built on first use.
const created: GPURenderPipelineDescriptor[] = [];
const device = {
    createRenderPipeline(descriptor: GPURenderPipelineDescriptor) {
        created.push(descriptor);
        return { label: descriptor.label } as GPURenderPipeline;
    },
} as unknown as GPUDevice;
const base = createScenePipeline(device, { label: "main", layout: "auto", vertex: {} as GPUVertexState });
assert.equal(created[0].multisample?.count, 1);
assert.equal(withSampleCount(base, 1), base, "single-sampled passes keep the pipeline");
const twin = withSampleCount(base, WEBGPU_MSAA_SAMPLES);
assert.notEqual(twin, base);
assert.equal(created[1].multisample?.count, WEBGPU_MSAA_SAMPLES);
assert.equal(withSampleCount(base, WEBGPU_MSAA_SAMPLES), twin, "the twin is reused");
assert.equal(created.length, 2);

console.log("gpu-plugin tests passed");


test("brightness applies through the bound client, including settings changed while disabled", async () => {
    const events = new EventBus();
    const config = new ConfigManager(events);
    const manager = new PluginManager(events, config);
    const applied: number[] = [];
    manager.getInjector().provide(CLIENT_TOKEN, { applyScreenBrightness: (value: number) => applied.push(value) });
    manager.loadCorePlugins([GpuPlugin]);
    await manager.setPluginEnabled(GpuPlugin, true);
    assert.deepEqual(applied, [], "an unset plugin brightness preserves the Settings-tab value");
    config.setConfigValue(GpuConfig, "brightness", 90);
    assert.deepEqual(applied, [90], "the event runs after the constructor injector scope ends");
    await manager.setPluginEnabled(GpuPlugin, false);
    config.setConfigValue(GpuConfig, "brightness", 20);
    assert.deepEqual(applied, [90], "disabled plugins do not receive config events");
    await manager.setPluginEnabled(GpuPlugin, true);
    assert.deepEqual(applied, [90, 20], "enabling picks up the saved brightness");
    await manager.setPluginEnabled(GpuPlugin, false);
});

test("a picked sky colour reaches the active renderer, and an unpicked one leaves the area colour", async () => {
    const events = new EventBus();
    const config = new ConfigManager(events);
    const manager = new PluginManager(events, config);
    const colours: number[][] = [];
    let clears = 0;
    manager.getInjector().provide(CLIENT_TOKEN, {
        applyScreenBrightness: () => {},
        renderer: {
            setSkyColor: (r: number, g: number, b: number) => colours.push([r, g, b]),
            clearSkyColorOverride: () => clears++,
        },
    });
    manager.loadCorePlugins([GpuPlugin]);
    await manager.setPluginEnabled(GpuPlugin, true);
    assert.deepEqual(colours, [], "the area's own sky keeps following the environment");
    config.setConfigValue(GpuConfig, "skyColor", 0x112233);
    assert.deepEqual(colours, [[0x11, 0x22, 0x33]], "the pick applies immediately");
    const beforeReset = clears;
    config.setDefaultConfiguration(GpuConfig, true);
    assert.equal(clears, beforeReset + 1, "Reset releases the picked sky back to the area environment");
});
