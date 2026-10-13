/**
 * Multisampled twins of the world-pass pipelines. A pipeline's sample count must match the
 * pass it draws in, and MSAA is a runtime setting (the GPU plugin), so every pipeline that
 * draws in the world pass is created through `createScenePipeline` and swapped for its twin
 * with `withSampleCount` at draw time. Twins are built on first use and kept.
 */

/** WebGPU core only has 1 and 4 samples. */
export const WEBGPU_MSAA_SAMPLES = 4;

const descriptors = new WeakMap<GPURenderPipeline, { device: GPUDevice; descriptor: GPURenderPipelineDescriptor }>();
const twins = new WeakMap<GPURenderPipeline, GPURenderPipeline>();

/** A single-sampled world-pass pipeline that can later be drawn multisampled. */
export function createScenePipeline(device: GPUDevice, descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
    const pipeline = device.createRenderPipeline({ ...descriptor, multisample: { count: 1 } });
    descriptors.set(pipeline, { device, descriptor });
    return pipeline;
}

/** `pipeline`, or its multisampled twin when the pass has more than one sample. */
export function withSampleCount(pipeline: GPURenderPipeline, sampleCount: number): GPURenderPipeline {
    if (sampleCount <= 1) return pipeline;
    let twin = twins.get(pipeline);
    if (!twin) {
        const source = descriptors.get(pipeline);
        if (!source) return pipeline;
        twin = source.device.createRenderPipeline({
            ...source.descriptor,
            label: `${source.descriptor.label ?? "scene pipeline"} msaa`,
            multisample: { count: WEBGPU_MSAA_SAMPLES },
        });
        twins.set(pipeline, twin);
    }
    return twin;
}
