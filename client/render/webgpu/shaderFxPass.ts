/**
 * The Shader Effects plugin's WebGPU pass, shared by both scene paths:
 *
 *  - 117 HD records it between depth of field and tonemap on linear HDR, into an output the pass
 *    owns (`encode`, `displayReferred` false, an rgba16float format).
 *  - The core renderer, with HD off, draws the world into an intermediate display-colour target
 *    and runs it from there into the canvas, or into FXAA's target when FXAA is on
 *    (`prepare` then `encodeTo`, `displayReferred` true).
 *
 * `prepare` asks the plugin's runtime for the frame's uniforms and says whether any effect would
 * change the picture. When none would, nothing is recorded and the frame is unchanged, so the
 * plugin costs nothing while it is off or idle.
 */
import { SHADER_FX_UNIFORM_FLOATS, FxSlot, type ShaderFxRuntime } from "../../game/plugins/shaderfx/ShaderFxState";
import { GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE } from "./bindings";
import { SHADERFX_WGSL } from "./shaders/shaderfx.wgsl";

const UNIFORM_BYTES = SHADER_FX_UNIFORM_FLOATS * 4;
const FULLSCREEN_VERTICES = 3;
const FRAGMENT_STAGE = GPU_SHADER_STAGE.FRAGMENT;

export class ShaderFxPass {
    private readonly device: GPUDevice;
    private readonly format: GPUTextureFormat;
    private readonly displayReferred: boolean;
    private readonly uniformBuffer: GPUBuffer;
    private readonly uniformBindGroup: GPUBindGroup;
    private readonly textureLayout: GPUBindGroupLayout;
    private readonly pipeline: GPURenderPipeline;
    private readonly sampler: GPUSampler;
    private readonly uniforms = new Float32Array(SHADER_FX_UNIFORM_FLOATS);

    private texture?: GPUTexture;
    private view?: GPUTextureView;
    private sourceBindGroup?: GPUBindGroup;
    private sourceView?: GPUTextureView;
    private sourceMaskView?: GPUTextureView;
    /** Stands in for the player mask when there is none: all zero. */
    private readonly emptyMask: GPUTexture;
    private readonly emptyMaskView: GPUTextureView;
    private sourceTexture?: GPUTexture;
    private sourceTextureView?: GPUTextureView;
    private width = 0;
    private height = 0;
    private disposed = false;

    constructor(device: GPUDevice, format: GPUTextureFormat, displayReferred: boolean) {
        this.device = device;
        this.format = format;
        this.displayReferred = displayReferred;
        const module = device.createShaderModule({ code: SHADERFX_WGSL, label: "shaderfx" });
        const uniformLayout = device.createBindGroupLayout({
            label: "shaderfx uniform layout",
            entries: [
                { binding: 0, visibility: FRAGMENT_STAGE, buffer: { type: "uniform", minBindingSize: UNIFORM_BYTES } },
            ],
        });
        this.textureLayout = device.createBindGroupLayout({
            label: "shaderfx source layout",
            entries: [
                { binding: 0, visibility: FRAGMENT_STAGE, texture: { sampleType: "float", viewDimension: "2d" } },
                { binding: 1, visibility: FRAGMENT_STAGE, sampler: { type: "filtering" } },
                { binding: 2, visibility: FRAGMENT_STAGE, texture: { sampleType: "float", viewDimension: "2d" } },
            ],
        });
        this.emptyMask = device.createTexture({
            label: "shaderfx empty player mask",
            size: [1, 1],
            format: "r8unorm",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.emptyMaskView = this.emptyMask.createView();
        this.pipeline = device.createRenderPipeline({
            label: "shaderfx",
            layout: device.createPipelineLayout({
                label: "shaderfx pipeline layout",
                bindGroupLayouts: [uniformLayout, this.textureLayout],
            }),
            vertex: { module, entryPoint: "vs_fullscreen" },
            fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
            primitive: { topology: "triangle-list" },
        });
        this.uniformBuffer = device.createBuffer({
            label: "shaderfx uniforms",
            size: UNIFORM_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.uniformBindGroup = device.createBindGroup({
            label: "shaderfx uniform bind group",
            layout: uniformLayout,
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer, offset: 0, size: UNIFORM_BYTES } }],
        });
        this.sampler = device.createSampler({
            label: "shaderfx sampler",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            magFilter: "linear",
            minFilter: "linear",
        });
    }

    /** (Re)creates the owned output when the scene size changes. Only `encode` uses it. */
    ensure(width: number, height: number): void {
        if (this.disposed || width < 1 || height < 1) return;
        if (this.texture && this.width === width && this.height === height) return;
        this.texture?.destroy();
        this.width = width;
        this.height = height;
        this.texture = this.device.createTexture({
            label: "shaderfx scene",
            size: [width, height],
            format: this.format,
            usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.view = this.texture.createView();
    }

    /**
     * The core renderer's use: a display-colour target the world draws into, which `encodeTo`
     * then reads. Recreated when the canvas size changes.
     */
    ensureSource(width: number, height: number): GPUTextureView {
        if (!this.sourceTexture || this.sourceTexture.width !== width || this.sourceTexture.height !== height) {
            this.sourceTexture?.destroy();
            this.sourceTexture = this.device.createTexture({
                label: "shaderfx world colour",
                size: [width, height],
                format: this.format,
                usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
            });
            this.sourceTextureView = this.sourceTexture.createView();
        }
        return this.sourceTextureView!;
    }

    /** Fills this frame's uniforms. False when no effect would change the picture. */
    prepare(runtime: ShaderFxRuntime | undefined): boolean {
        if (this.disposed || !runtime) return false;
        return runtime.fill(this.uniforms);
    }

    /**
     * Draws the prepared effects from `sourceView` into `targetView`. `maskView`, the frame-sized
     * coverage of the player's own model, lets the prayer aura follow it; without it the aura
     * falls back to a generic figure.
     */
    encodeTo(
        encoder: GPUCommandEncoder,
        sourceView: GPUTextureView,
        targetView: GPUTextureView,
        width: number,
        height: number,
        maskView?: GPUTextureView,
    ): void {
        if (this.disposed || width < 1 || height < 1) return;
        const mask = maskView ?? this.emptyMaskView;
        if (this.sourceView !== sourceView || this.sourceMaskView !== mask || !this.sourceBindGroup) {
            this.sourceBindGroup = this.device.createBindGroup({
                label: "shaderfx source bind group",
                layout: this.textureLayout,
                entries: [
                    { binding: 0, resource: sourceView },
                    { binding: 1, resource: this.sampler },
                    { binding: 2, resource: mask },
                ],
            });
            this.sourceView = sourceView;
            this.sourceMaskView = mask;
        }
        const data = this.uniforms;
        data[FxSlot.SCREEN] = width;
        data[FxSlot.SCREEN + 1] = height;
        data[FxSlot.SCREEN + 2] = 1 / width;
        data[FxSlot.SCREEN + 3] = 1 / height;
        data[FxSlot.TIME + 1] = width / height;
        data[FxSlot.GRADE + 2] = this.displayReferred ? 1 : 0;
        data[FxSlot.GRADE + 3] = maskView ? 1 : 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);

        const pass = encoder.beginRenderPass({
            label: "shaderfx",
            colorAttachments: [
                { view: targetView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
            ],
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.uniformBindGroup);
        pass.setBindGroup(1, this.sourceBindGroup);
        pass.draw(FULLSCREEN_VERTICES);
        pass.end();
    }

    /**
     * 117 HD's use: the view the tonemap should read. The effects' output when any are active,
     * else `sceneView`, with nothing recorded.
     */
    encode(
        encoder: GPUCommandEncoder,
        sceneView: GPUTextureView,
        runtime: ShaderFxRuntime | undefined,
        maskView?: GPUTextureView,
    ): GPUTextureView {
        if (!this.view || !this.prepare(runtime)) return sceneView;
        this.encodeTo(encoder, sceneView, this.view, this.width, this.height, maskView);
        return this.view;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.texture?.destroy();
        this.texture = undefined;
        this.view = undefined;
        this.sourceBindGroup = undefined;
        this.sourceView = undefined;
        this.sourceTexture?.destroy();
        this.sourceTexture = undefined;
        this.sourceTextureView = undefined;
        this.sourceMaskView = undefined;
        this.emptyMask.destroy();
        this.uniformBuffer.destroy();
        (this.sampler as GPUSampler & { destroy?(): void }).destroy?.();
    }
}
