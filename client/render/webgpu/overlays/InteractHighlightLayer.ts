import { GPU_BUFFER_USAGE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE } from "../bindings";
import { HIGHLIGHT_COMPOSE_WGSL, HIGHLIGHT_MASK_WGSL } from "../shaders/overlay.wgsl";
import type { OverlayHost } from "./OverlayHost";

const SHADER_STAGES = GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT;
const MAX_TRI_POINTS = 131072;
const DEFAULT_OUTLINE_RADIUS = 1.9;
const IDENTITY_MAT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

type HighlightTarget = {
    points: ReadonlyArray<readonly [number, number, number]>;
    color: number;
    alpha: number;
    /** View-space deck placement for a target aboard a world entity (identity elsewhere). */
    worldEntityTransform?: Float32Array;
};

/** Per-target uniforms, rewritten in place each frame. */
type TargetUniforms = {
    transformBuffer: GPUBuffer;
    transformBindGroup: GPUBindGroup;
    composeBuffer: GPUBuffer;
    composeBindGroup?: GPUBindGroup;
    /** The mask view composeBindGroup samples; a resize replaces the views. */
    composeView?: GPUTextureView;
};

/**
 * Interact-highlight overlay for WebGPU. The mask + multi-ring blur compose pass is a port of
 * client/ui/devoverlay/InteractHighlightOverlay.ts and client/render/render/interact/highlight.ts.
 *
 * Targets (active + hover, NPC and loc) come from the shared getInteractHighlightDrawTargets
 * pipeline via OverlayHost; map loc metadata is read from WebGPUMapSquare's CPU loc arrays.
 * A target aboard a world entity carries the deck's view-space placement matrix, which the mask
 * pass applies like the WebGL uniform of the same name.
 */
export class InteractHighlightLayer {
    private readonly host: OverlayHost;
    private readonly device: GPUDevice;
    private readonly format: GPUTextureFormat;
    private readonly sceneBindGroup: GPUBindGroup;
    private readonly sceneLayout: GPUBindGroupLayout;

    private maskPipeline!: GPURenderPipeline;
    private composePipeline!: GPURenderPipeline;
    // One mask target per draw target: WebGL reuses a single framebuffer by drawing the mask
    // and composing it per target, but WebGPU composes later, so each target keeps its mask.
    private maskTextures: GPUTexture[] = [];
    private maskViews: GPUTextureView[] = [];
    private maskWidth = 0;
    private maskHeight = 0;
    private sampler!: GPUSampler;

    private targetVertexBuffers: GPUBuffer[] = [];
    private targetVertexCapacities: number[] = [];
    private screenVertexBuffer?: GPUBuffer;
    private targets: HighlightTarget[] = [];
    private composeBindGroups: GPUBindGroup[] = [];
    // Created once per target index and reused: buffers and bind groups made every frame
    // pile up in Chrome's GPU process (hundreds of MB a minute at high frame rates, #559).
    private targetUniforms: TargetUniforms[] = [];
    private uniformBindGroupLayout!: GPUBindGroupLayout;
    private composeLayout!: GPUBindGroupLayout;
    private readonly composeData = new Float32Array(8);

    constructor(
        host: OverlayHost,
        device: GPUDevice,
        format: GPUTextureFormat,
        sceneBindGroup: GPUBindGroup,
        sceneLayout: GPUBindGroupLayout,
    ) {
        this.host = host;
        this.device = device;
        this.format = format;
        this.sceneBindGroup = sceneBindGroup;
        this.sceneLayout = sceneLayout;
    }

    init(): void {
        const device = this.device;
        const maskModule = device.createShaderModule({ code: HIGHLIGHT_MASK_WGSL, label: "highlight-mask" });
        const composeModule = device.createShaderModule({
            code: HIGHLIGHT_COMPOSE_WGSL,
            label: "highlight-compose",
        });

        // Reuse the exact layout the scene bind group was created with; WebGPU requires
        // layout identity between a pipeline layout and a bound bind group.
        const sceneLayout = this.sceneLayout;
        this.uniformBindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: SHADER_STAGES,
                    buffer: { type: "uniform", minBindingSize: 64 },
                },
            ],
        });
        this.maskPipeline = device.createRenderPipeline({
            label: "highlight-mask pipeline",
            layout: device.createPipelineLayout({
                bindGroupLayouts: [sceneLayout, this.uniformBindGroupLayout],
            }),
            vertex: {
                module: maskModule,
                entryPoint: "vs_mask",
                buffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
                    },
                ],
            },
            fragment: {
                module: maskModule,
                entryPoint: "fs_mask",
                targets: [{ format: "rgba8unorm", blend: undefined }],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
        });

        this.composeLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: SHADER_STAGES,
                    texture: { sampleType: "float", viewDimension: "2d" },
                },
                {
                    binding: 1,
                    visibility: SHADER_STAGES,
                    sampler: { type: "filtering" },
                },
                {
                    binding: 2,
                    visibility: SHADER_STAGES,
                    buffer: { type: "uniform", minBindingSize: 32 },
                },
            ],
        });
        this.composePipeline = device.createRenderPipeline({
            label: "highlight-compose pipeline",
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.composeLayout] }),
            vertex: {
                module: composeModule,
                entryPoint: "vs_compose",
                buffers: [
                    {
                        arrayStride: 8,
                        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
                    },
                ],
            },
            fragment: {
                module: composeModule,
                entryPoint: "fs_compose",
                targets: [
                    {
                        format: this.format,
                        blend: {
                            color: {
                                srcFactor: "src-alpha",
                                dstFactor: "one-minus-src-alpha",
                                operation: "add",
                            },
                            alpha: {
                                srcFactor: "src-alpha",
                                dstFactor: "one-minus-src-alpha",
                                operation: "add",
                            },
                        },
                    },
                ],
            },
            primitive: { topology: "triangle-list", cullMode: "none" },
        });

        this.sampler = device.createSampler({
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
            magFilter: "linear",
            minFilter: "linear",
        });
        // Fullscreen triangle in NDC; the compose shader derives UVs from position.
        this.screenVertexBuffer = device.createBuffer({
            label: "highlight compose vertices",
            size: 24,
            usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
        });
        device.queue.writeBuffer(
            this.screenVertexBuffer,
            0,
            new Float32Array([-1, -1, 3, -1, -1, 3]),
        );
        this.composeData[6] = DEFAULT_OUTLINE_RADIUS;
    }

    /** Resolves targets and renders each mask into the offscreen target. */
    update(): void {
        this.targets = [];
        this.composeBindGroups = [];

        const config = this.host.osrsClient.clientPlugins.interactHighlightConfig();
        if (!config?.enabled) return;

        try {
            // Active + hover targets, resolved with the same shared helpers the WebGL
            // overlay uses (local interaction sync, hover entries, expiry).
            const drawTargets = this.host.getInteractHighlightDrawTargets();
            for (const drawTarget of drawTargets) {
                const points = drawTarget?.trianglePoints;
                if (!points || points.length < 3) continue;
                this.targets.push({
                    points,
                    color: drawTarget.color ?? 0xffffff,
                    alpha: typeof drawTarget.alpha === "number" ? drawTarget.alpha : 0.45,
                    worldEntityTransform: drawTarget.worldEntityTransform,
                });
            }
        } catch {
            return;
        }
        if (this.targets.length === 0) return;

        this.encodeMasks();
    }

    drawScreen(pass: GPURenderPassEncoder): void {
        if (this.targets.length === 0 || this.maskViews.length === 0) return;
        const width = this.host.canvas.width;
        const height = this.host.canvas.height;
        pass.setPipeline(this.composePipeline);
        if (this.screenVertexBuffer) pass.setVertexBuffer(0, this.screenVertexBuffer);
        for (const bindGroup of this.composeBindGroups) {
            pass.setBindGroup(0, bindGroup);
            pass.setViewport(0, 0, width, height, 0, 1);
            pass.draw(3, 1, 0, 0);
        }
    }

    dispose(): void {
        for (const texture of this.maskTextures) texture.destroy();
        this.maskTextures.length = 0;
        this.maskViews.length = 0;
        for (const buffer of this.targetVertexBuffers) buffer.destroy();
        this.targetVertexBuffers.length = 0;
        this.targetVertexCapacities.length = 0;
        this.screenVertexBuffer?.destroy();
        this.screenVertexBuffer = undefined;
        for (const uniforms of this.targetUniforms) {
            uniforms.transformBuffer.destroy();
            uniforms.composeBuffer.destroy();
        }
        this.targetUniforms.length = 0;
    }

    /** Ensures one canvas-sized mask target per requested index. */
    private ensureMaskTargets(count: number): boolean {
        const width = this.host.canvas.width | 0;
        const height = this.host.canvas.height | 0;
        if (width <= 0 || height <= 0) return false;
        if (this.maskWidth !== width || this.maskHeight !== height) {
            for (const texture of this.maskTextures) texture.destroy();
            this.maskTextures.length = 0;
            this.maskViews.length = 0;
            this.maskWidth = width;
            this.maskHeight = height;
        }
        while (this.maskTextures.length < count) {
            const texture = this.device.createTexture({
                label: `highlight mask ${this.maskTextures.length}`,
                size: [width, height],
                format: "rgba8unorm",
                usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
            });
            this.maskTextures.push(texture);
            this.maskViews.push(texture.createView());
        }
        return true;
    }

    private vertexBufferFor(index: number, usedBytes: number): GPUBuffer {
        let buffer = this.targetVertexBuffers[index];
        const capacity = this.targetVertexCapacities[index] ?? 0;
        if (!buffer || capacity < usedBytes) {
            buffer?.destroy();
            const size = Math.max(4096, Math.ceil(usedBytes / 4096) * 4096);
            buffer = this.device.createBuffer({
                label: `highlight vertices ${index}`,
                size,
                usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
            });
            this.targetVertexBuffers[index] = buffer;
            this.targetVertexCapacities[index] = size;
        }
        return buffer;
    }

    private uniformsFor(index: number): TargetUniforms {
        let uniforms = this.targetUniforms[index];
        if (!uniforms) {
            const transformBuffer = this.device.createBuffer({
                label: `highlight transform ${index}`,
                size: 64,
                usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
            });
            uniforms = {
                transformBuffer,
                transformBindGroup: this.device.createBindGroup({
                    layout: this.uniformBindGroupLayout,
                    entries: [{ binding: 0, resource: { buffer: transformBuffer, offset: 0, size: 64 } }],
                }),
                composeBuffer: this.device.createBuffer({
                    label: `highlight compose ${index}`,
                    size: 32,
                    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
                }),
            };
            this.targetUniforms[index] = uniforms;
        }
        return uniforms;
    }

    private composeBindGroupFor(uniforms: TargetUniforms, maskView: GPUTextureView): GPUBindGroup {
        if (!uniforms.composeBindGroup || uniforms.composeView !== maskView) {
            uniforms.composeBindGroup = this.device.createBindGroup({
                layout: this.composeLayout,
                entries: [
                    { binding: 0, resource: maskView },
                    { binding: 1, resource: this.sampler },
                    {
                        binding: 2,
                        resource: { buffer: uniforms.composeBuffer, offset: 0, size: 32 },
                    },
                ],
            });
            uniforms.composeView = maskView;
        }
        return uniforms.composeBindGroup;
    }

    private encodeMasks(): void {
        if (this.targets.length === 0) return;
        if (!this.ensureMaskTargets(this.targets.length)) return;

        const encoder = this.device.createCommandEncoder({ label: "highlight masks" });
        for (let targetIndex = 0; targetIndex < this.targets.length; targetIndex++) {
            const target = this.targets[targetIndex];
            const maskView = this.maskViews[targetIndex];
            if (!maskView) continue;

            const pointCount = Math.min(target.points.length, MAX_TRI_POINTS);
            const vertexData = new Float32Array(pointCount * 3);
            for (let i = 0; i < pointCount; i++) {
                const point = target.points[i];
                vertexData[i * 3] = point[0];
                vertexData[i * 3 + 1] = point[1];
                vertexData[i * 3 + 2] = point[2];
            }
            const usedBytes = vertexData.byteLength;
            const targetBuffer = this.vertexBufferFor(targetIndex, usedBytes);
            this.device.queue.writeBuffer(targetBuffer, 0, vertexData);

            const uniforms = this.uniformsFor(targetIndex);
            this.device.queue.writeBuffer(
                uniforms.transformBuffer,
                0,
                target.worldEntityTransform ?? IDENTITY_MAT4,
            );

            const color = target.color >>> 0;
            this.composeData[0] = ((color >> 16) & 0xff) / 255.0;
            this.composeData[1] = ((color >> 8) & 0xff) / 255.0;
            this.composeData[2] = (color & 0xff) / 255.0;
            this.composeData[3] = Math.max(0, Math.min(1, target.alpha));
            this.composeData[4] = 1.0 / Math.max(1, this.maskWidth);
            this.composeData[5] = 1.0 / Math.max(1, this.maskHeight);
            this.device.queue.writeBuffer(uniforms.composeBuffer, 0, this.composeData);
            this.composeBindGroups.push(this.composeBindGroupFor(uniforms, maskView));

            const pass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: maskView,
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: "clear",
                        storeOp: "store",
                    },
                ],
            });
            pass.setPipeline(this.maskPipeline);
            pass.setBindGroup(0, this.sceneBindGroup);
            pass.setBindGroup(1, uniforms.transformBindGroup);
            pass.setVertexBuffer(0, targetBuffer);
            pass.draw(pointCount, 1, 0, 0);
            pass.end();
        }
        this.device.queue.submit([encoder.finish()]);
    }
}
