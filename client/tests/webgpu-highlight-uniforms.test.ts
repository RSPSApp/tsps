import assert from "node:assert/strict";
import { test } from "node:test";

import { InteractHighlightLayer } from "../render/webgpu/overlays/InteractHighlightLayer";
import type { OverlayHost } from "../render/webgpu/overlays/OverlayHost";

test("WebGPU interact highlight reuses its per-target buffers and bind groups every frame", () => {
    let buffers = 0;
    let bindGroups = 0;
    let destroyedBuffers = 0;
    const pass = { setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, setViewport() {}, draw() {}, end() {} };
    const device = {
        createShaderModule: () => ({}),
        createBindGroupLayout: () => ({}),
        createPipelineLayout: () => ({}),
        createRenderPipeline: () => ({}),
        createSampler: () => ({}),
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBuffer: () => {
            buffers++;
            return { destroy: () => destroyedBuffers++ };
        },
        createBindGroup: () => {
            bindGroups++;
            return {};
        },
        createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
        queue: { writeBuffer() {}, submit() {} },
    } as unknown as GPUDevice;
    const canvas = { width: 800, height: 600 };
    const target = { trianglePoints: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: 0xffff00, alpha: 0.5 };
    let targets = [target];
    const host = {
        canvas,
        osrsClient: { clientPlugins: { interactHighlightConfig: () => ({ enabled: true }) } },
        getInteractHighlightDrawTargets: () => targets,
    } as unknown as OverlayHost;

    const layer = new InteractHighlightLayer(host, device, "bgra8unorm", {} as GPUBindGroup, {} as GPUBindGroupLayout);
    layer.init();
    layer.update();
    const buffersAfterFirstFrame = buffers;
    const bindGroupsAfterFirstFrame = bindGroups;
    for (let frame = 0; frame < 500; frame++) layer.update();
    assert.equal(buffers, buffersAfterFirstFrame, "no new buffers while the same target stays highlighted");
    assert.equal(bindGroups, bindGroupsAfterFirstFrame, "no new bind groups while the same target stays highlighted");

    canvas.width = 1024;
    layer.update();
    assert.equal(buffers, buffersAfterFirstFrame, "a resize keeps the uniform buffers");
    assert.equal(bindGroups, bindGroupsAfterFirstFrame + 1, "a resize rebuilds only the compose bind group");

    targets = [target, target];
    layer.update();
    const buffersWithTwo = buffers;
    for (let frame = 0; frame < 100; frame++) layer.update();
    assert.equal(buffers, buffersWithTwo, "a second target gets its own slot once");

    layer.dispose();
    assert.equal(destroyedBuffers, buffers, "dispose frees every buffer the layer created");
});
