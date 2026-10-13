import assert from "node:assert/strict";
import { AntiAliasingMode } from "../game/plugins/gpu/GpuConfig";
import { resolveGpuSettings } from "../game/plugins/gpu/GpuPlugin";
import { createScenePipeline, WEBGPU_MSAA_SAMPLES, withSampleCount } from "../render/webgpu/multisample";

const settings = (antiAliasingMode: string, extra: Partial<Parameters<typeof resolveGpuSettings>[0]> = {}) =>
    resolveGpuSettings({ antiAliasingMode, drawDistance: 25, fpsLimit: 240, colorBanding: 0, ...extra });

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
