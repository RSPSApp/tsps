/**
 * 117 HD's WebGPU SSAO: a half-res HBAO/GTAO-lite pass over the world depth, followed by a depth-aware
 * blur and upsample (or the original half-resolution box blur).
 *
 * encode() reconstructs view positions from the scene's depth32float attachment with the inverse
 * projection, samples 12 golden-angle directions per pixel and returns the blurred r8unorm view
 * the tonemap pass multiplies into the HDR scene. Both targets are RENDER_ATTACHMENT |
 * TEXTURE_BINDING and read back with textureLoad, so no sampler is needed.
 */
import { GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE } from "../../../../render/webgpu/bindings";
import { HD_SSAO_WGSL } from "./hd-ssao.wgsl";

const AO_FORMAT: GPUTextureFormat = "r8unorm";
const UNIFORM_FLOATS = 32;
const UNIFORM_BYTES = UNIFORM_FLOATS * 4;
const FULLSCREEN_VERTICES = 3;
const FRAGMENT_STAGE = GPU_SHADER_STAGE.FRAGMENT;
/** x=radius, y=maxRadius (view units, 1 unit = 1 tile), z=strength, w=bias. */
const AO_PARAMS = [0.75, 2.0, 1.0, 0.03] as const;

export class HdSsaoPass {
    private readonly device: GPUDevice;
    private readonly uniformBuffer: GPUBuffer;
    private readonly uniformBindGroup: GPUBindGroup;
    private readonly depthLayout: GPUBindGroupLayout;
    private readonly textureLayout: GPUBindGroupLayout;
    private readonly ssaoPipeline: GPURenderPipeline;
    private readonly blurPipeline: GPURenderPipeline;
    private readonly uniforms = new Float32Array(UNIFORM_FLOATS);

    private aoTexture?: GPUTexture;
    private blurTexture?: GPUTexture;
    private aoView?: GPUTextureView;
    private blurView?: GPUTextureView;
    private depthBindGroup?: GPUBindGroup;
    private depthView?: GPUTextureView;
    private blurBindGroup?: GPUBindGroup;
    private depthAware = true;
    private width = 0;
    private height = 0;
    private sceneWidth = 0;
    private sceneHeight = 0;
    private disposed = false;

    constructor(device: GPUDevice) {
        this.device = device;
        const module = device.createShaderModule({ code: HD_SSAO_WGSL, label: "hd-ssao" });

        const uniformLayout = device.createBindGroupLayout({
            label: "hd-ssao uniform layout",
            entries: [
                {
                    binding: 0,
                    visibility: FRAGMENT_STAGE,
                    buffer: { type: "uniform", minBindingSize: UNIFORM_BYTES },
                },
            ],
        });
        this.depthLayout = device.createBindGroupLayout({
            label: "hd-ssao depth layout",
            entries: [
                {
                    binding: 0,
                    visibility: FRAGMENT_STAGE,
                    texture: { sampleType: "depth", viewDimension: "2d" },
                },
            ],
        });
        this.textureLayout = device.createBindGroupLayout({
            label: "hd-ssao texture layout",
            entries: [
                { binding: 0, visibility: FRAGMENT_STAGE, texture: { sampleType: "depth", viewDimension: "2d" } },
                {
                    binding: 1,
                    visibility: FRAGMENT_STAGE,
                    texture: { sampleType: "float", viewDimension: "2d" },
                },
            ],
        });

        this.uniformBuffer = device.createBuffer({
            label: "hd-ssao uniforms",
            size: UNIFORM_BYTES,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.uniformBindGroup = device.createBindGroup({
            label: "hd-ssao uniform bind group",
            layout: uniformLayout,
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer, offset: 0, size: UNIFORM_BYTES } }],
        });

        const createPipeline = (label: string, entryPoint: string, layout: GPUPipelineLayout): GPURenderPipeline =>
            device.createRenderPipeline({
                label,
                layout,
                vertex: { module, entryPoint: "vs_fullscreen" },
                fragment: { module, entryPoint, targets: [{ format: AO_FORMAT }] },
                primitive: { topology: "triangle-list" },
            });
        this.ssaoPipeline = createPipeline(
            "hd-ssao pipeline",
            "fs_ssao",
            device.createPipelineLayout({
                label: "hd-ssao pipeline layout",
                bindGroupLayouts: [uniformLayout, this.depthLayout],
            }),
        );
        this.blurPipeline = createPipeline(
            "hd-ssao blur pipeline",
            "fs_blur",
            device.createPipelineLayout({
                label: "hd-ssao blur pipeline layout",
                bindGroupLayouts: [uniformLayout, this.textureLayout],
            }),
        );
    }

    /** Half-res AO; the depth-aware filter also upsamples to full resolution. */
    ensure(width: number, height: number, depthAware = true): void {
        if (this.disposed || width < 1 || height < 1) return;
        const targetWidth = Math.max(1, Math.floor(width / 2));
        const targetHeight = Math.max(1, Math.floor(height / 2));
        if (
            this.aoTexture &&
            this.width === targetWidth &&
            this.height === targetHeight &&
            this.sceneWidth === width &&
            this.sceneHeight === height &&
            this.depthAware === depthAware
        ) {
            return;
        }
        this.destroyTargets();
        this.width = targetWidth;
        this.height = targetHeight;
        this.sceneWidth = width;
        this.sceneHeight = height;
        this.depthAware = depthAware;

        const usage = GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING;
        this.aoTexture = this.device.createTexture({
            label: "hd-ssao ao",
            size: [targetWidth, targetHeight],
            format: AO_FORMAT,
            usage,
        });
        this.blurTexture = this.device.createTexture({
            label: "hd-ssao blur",
            size: depthAware ? [width, height] : [targetWidth, targetHeight],
            format: AO_FORMAT,
            usage,
        });
        this.aoView = this.aoTexture.createView();
        this.blurView = this.blurTexture.createView();
    }

    /** Records AO + blur passes and returns the blurred AO view (r8unorm), or undefined if not ready. */
    encode(
        encoder: GPUCommandEncoder,
        depthView: GPUTextureView,
        inverseProjection: Float32Array,
    ): GPUTextureView | undefined {
        const { aoView, blurView } = this;
        if (this.disposed || !aoView || !blurView) return undefined;

        if (this.depthView !== depthView || !this.depthBindGroup) {
            this.depthBindGroup = this.device.createBindGroup({
                label: "hd-ssao depth bind group",
                layout: this.depthLayout,
                entries: [{ binding: 0, resource: depthView }],
            });
            this.blurBindGroup = this.device.createBindGroup({
                label: "hd-ssao blur sources",
                layout: this.textureLayout,
                entries: [{ binding: 0, resource: depthView }, { binding: 1, resource: aoView }],
            });
            this.depthView = depthView;
        }

        this.writeUniforms(inverseProjection);
        this.recordPass(encoder, this.ssaoPipeline, this.depthBindGroup, aoView);
        this.recordPass(encoder, this.blurPipeline, this.blurBindGroup!, blurView);
        return blurView;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.destroyTargets();
        this.uniformBuffer.destroy();
    }

    private writeUniforms(inverseProjection: Float32Array): void {
        const data = this.uniforms;
        data.set(inverseProjection.subarray(0, 16), 0);
        data[16] = AO_PARAMS[0];
        data[17] = AO_PARAMS[1];
        data[18] = AO_PARAMS[2];
        data[19] = AO_PARAMS[3];
        data[20] = this.width;
        data[21] = this.height;
        data[22] = 1 / this.width;
        data[23] = 1 / this.height;
        // gl-matrix ortho/perspective [5] is the reciprocal of its inverse's [5].
        data[24] = inverseProjection[5] !== 0 ? 1 / inverseProjection[5] : 1;
        data[25] = this.depthAware ? 1 : 0;
        data[26] = 0;
        data[27] = 0;
        data[28] = this.sceneWidth;
        data[29] = this.sceneHeight;
        data[30] = 1 / this.sceneWidth;
        data[31] = 1 / this.sceneHeight;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }

    private recordPass(
        encoder: GPUCommandEncoder,
        pipeline: GPURenderPipeline,
        source: GPUBindGroup,
        target: GPUTextureView,
    ): void {
        const pass = encoder.beginRenderPass({
            label: "hd-ssao",
            colorAttachments: [
                {
                    view: target,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, this.uniformBindGroup);
        pass.setBindGroup(1, source);
        pass.draw(FULLSCREEN_VERTICES);
        pass.end();
    }

    private destroyTargets(): void {
        this.aoTexture?.destroy();
        this.blurTexture?.destroy();
        this.aoTexture = undefined;
        this.blurTexture = undefined;
        this.aoView = undefined;
        this.blurView = undefined;
        this.blurBindGroup = undefined;
        this.depthBindGroup = undefined;
        this.depthView = undefined;
        this.width = 0;
        this.height = 0;
        this.sceneWidth = 0;
        this.sceneHeight = 0;
    }
}
