import { GPU_SHADER_STAGE, GPU_TEXTURE_USAGE } from "./bindings";
import { FXAA_WGSL } from "./shaders/fxaa.wgsl";

/**
 * The scene (or 117 HD's tonemap) draws into this display-colour target; FXAA presents it to
 * the canvas before the HUD draws.
 */
export class FxaaPass {
    private readonly pipeline: GPURenderPipeline;
    private readonly layout: GPUBindGroupLayout;
    private readonly sampler: GPUSampler;
    private texture?: GPUTexture;
    private bindGroup?: GPUBindGroup;
    private view?: GPUTextureView;

    constructor(private readonly device: GPUDevice, private readonly format: GPUTextureFormat) {
        const module = device.createShaderModule({ label: "fxaa", code: FXAA_WGSL });
        this.layout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 1, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: { type: "filtering" } },
        ] });
        this.pipeline = device.createRenderPipeline({
            label: "fxaa", layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
            vertex: { module, entryPoint: "vs_fullscreen" },
            fragment: { module, entryPoint: "fs_fxaa", targets: [{ format }] },
            primitive: { topology: "triangle-list" },
        });
        this.sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" });
    }

    ensure(width: number, height: number): GPUTextureView {
        if (!this.texture || this.texture.width !== width || this.texture.height !== height) {
            this.texture?.destroy();
            this.texture = this.device.createTexture({
                label: "fxaa display colour", size: [width, height], format: this.format,
                usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
            });
            this.view = this.texture.createView();
            this.bindGroup = this.device.createBindGroup({ layout: this.layout, entries: [
                { binding: 0, resource: this.view }, { binding: 1, resource: this.sampler },
            ] });
        }
        return this.view!;
    }

    encode(encoder: GPUCommandEncoder, canvasView: GPUTextureView): void {
        const pass = encoder.beginRenderPass({ label: "fxaa", colorAttachments: [
            { view: canvasView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ] });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup!);
        pass.draw(3);
        pass.end();
    }

    dispose(): void {
        this.texture?.destroy();
        this.texture = undefined;
        this.view = undefined;
        this.bindGroup = undefined;
    }
}
