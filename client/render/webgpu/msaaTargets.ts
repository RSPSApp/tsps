import { GPU_TEXTURE_USAGE, SCENE_DEPTH_FORMAT } from "./bindings";
import { WEBGPU_MSAA_SAMPLES } from "./multisample";

/** Copies sample 0 of the multisampled depth into the single-sampled scene depth. */
const DEPTH_RESOLVE_WGSL = /* wgsl */ `
@group(0) @binding(0) var depthSamples: texture_depth_multisampled_2d;

@vertex
fn vs_fullscreen(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs_resolve(@builtin(position) position: vec4<f32>) -> @builtin(frag_depth) f32 {
    return textureLoad(depthSamples, vec2<i32>(position.xy), 0);
}
`;

/**
 * The world pass's multisampled colour and depth while MSAA is on. Colour resolves into the
 * pass's normal target as the pass ends; depth has no resolve in WebGPU, so `resolveDepth`
 * copies it for scene extensions that sample or test against the scene depth afterwards.
 */
export class SceneMsaaTargets {
    private colorTexture?: GPUTexture;
    private depthTexture?: GPUTexture;
    private resolvePipeline?: GPURenderPipeline;
    private resolveBindGroup?: GPUBindGroup;
    colorView?: GPUTextureView;
    depthView?: GPUTextureView;

    constructor(private readonly device: GPUDevice) {}

    /** (Re)creates the targets for this size and colour format. */
    ensure(width: number, height: number, colorFormat: GPUTextureFormat): void {
        const color = this.colorTexture;
        if (color && color.width === width && color.height === height && color.format === colorFormat) {
            return;
        }
        this.destroy();
        this.colorTexture = this.device.createTexture({
            label: "webgpu scene msaa colour",
            size: [width, height],
            format: colorFormat,
            sampleCount: WEBGPU_MSAA_SAMPLES,
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
        });
        this.depthTexture = this.device.createTexture({
            label: "webgpu scene msaa depth",
            size: [width, height],
            format: SCENE_DEPTH_FORMAT,
            sampleCount: WEBGPU_MSAA_SAMPLES,
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.colorView = this.colorTexture.createView();
        this.depthView = this.depthTexture.createView();
        this.resolveBindGroup = undefined;
    }

    resolveDepth(encoder: GPUCommandEncoder, target: GPUTextureView): void {
        if (!this.depthView) return;
        if (!this.resolvePipeline) {
            const module = this.device.createShaderModule({ label: "webgpu scene depth resolve", code: DEPTH_RESOLVE_WGSL });
            this.resolvePipeline = this.device.createRenderPipeline({
                label: "webgpu scene depth resolve",
                layout: "auto",
                vertex: { module, entryPoint: "vs_fullscreen" },
                fragment: { module, entryPoint: "fs_resolve", targets: [] },
                primitive: { topology: "triangle-list" },
                depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "always" },
            });
        }
        this.resolveBindGroup ??= this.device.createBindGroup({
            layout: this.resolvePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: this.depthView }],
        });
        const pass = encoder.beginRenderPass({
            label: "webgpu scene depth resolve",
            colorAttachments: [],
            depthStencilAttachment: {
                view: target,
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });
        pass.setPipeline(this.resolvePipeline);
        pass.setBindGroup(0, this.resolveBindGroup);
        pass.draw(3);
        pass.end();
    }

    destroy(): void {
        this.colorTexture?.destroy();
        this.depthTexture?.destroy();
        this.colorTexture = undefined;
        this.depthTexture = undefined;
        this.colorView = undefined;
        this.depthView = undefined;
        this.resolveBindGroup = undefined;
    }
}
