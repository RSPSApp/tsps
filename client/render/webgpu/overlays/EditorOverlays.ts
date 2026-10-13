import { cropMaskedPixels, findOpaqueBounds } from "../../../game/plugins/editmode/ModelImageCaptureOverlay";
import { mat4 } from "gl-matrix";
import type { MapIconGroundEntry } from "../../../game/plugins/editmode/MapIconGroundOverlay";
import { buildMapIconGroundVertices } from "../../../game/plugins/editmode/MapIconGroundOverlay";
import type { LocPlacementPreview, LocPlacementPreviewClient, LocPlacementPreviewRenderer } from "../../../game/plugins/editmode/LocPlacementPreviewOverlay";
import { buildZoneGroundGeometry, type ZoneGroundRect } from "../../../game/plugins/editmode/ZoneGroundOverlay";
import { ContourGroundType, SceneBuffer, type DrawCommand } from "../../buffer/SceneBuffer";
import { buildLocGeometryData } from "../../loader/SdMapDataLoader";
import { InteractType } from "../../InteractType";
import { LocModelType } from "../../../rs/config/loctype/LocModelType";
import { GPU_BUFFER_USAGE, GPU_MAP_MODE, GPU_SHADER_STAGE, GPU_TEXTURE_USAGE, SCENE_DEPTH_FORMAT } from "../bindings";
import { createScenePipeline, withSampleCount } from "../multisample";
import { WebGPUMapSquare, type SceneryDrawContext } from "../WebGPUMapSquare";
import type { WebGPURenderer } from "../WebGPURenderer";
import { getWorldResources } from "./rendererAccess";

const UVS = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
const GROUND_SHADER = `
struct SceneMatrices {
    viewProj: mat4x4<f32>, view: mat4x4<f32>, projection: mat4x4<f32>,
    sky: vec4<f32>, hsl: vec4<f32>, camera: vec2<f32>, player: vec2<f32>,
    renderDistance: f32, fogDepth: f32,
};
@group(0) @binding(0) var<uniform> scene: SceneMatrices;
@group(1) @binding(0) var sprite: texture_2d<f32>;
@group(1) @binding(1) var spriteSampler: sampler;
struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>, @location(1) uv: vec2<f32>, @location(2) fog: f32,
};
@vertex fn vs_world(@location(0) position: vec3<f32>, @location(1) color: vec4<f32>, @location(2) uv: vec2<f32>) -> VertexOut {
    let clip = scene.projection * scene.view * vec4<f32>(position, 1.0);
    var out: VertexOut;
    out.position = vec4<f32>(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
    out.color = color; out.uv = uv;
    let delta = abs(position.xz - scene.player);
    let start = min(scene.fogDepth, scene.renderDistance);
    out.fog = clamp((max(delta.x, delta.y) - start) / max(scene.renderDistance - start, 0.0001), 0.0, 1.0);
    return out;
}
@fragment fn fs_world(in: VertexOut) -> @location(0) vec4<f32> {
    var color = in.color * textureSample(sprite, spriteSampler, in.uv);
    color.a *= 1.0 - smoothstep(0.0, 1.0, in.fog);
    if (color.a < 0.005) { discard; }
    return color;
}`;

/** Editor ground geometry uses the same terrain sampling as WebGL, with native GPU resources. */
class EditorGroundLayer {
    private rects: readonly ZoneGroundRect[] = [];
    private icons: readonly MapIconGroundEntry[] = [];
    private dirty = true;
    private key = "";
    private buffer?: GPUBuffer;
    private capacity = 0;
    private pipeline?: GPURenderPipeline;
    private format?: GPUTextureFormat;
    private textureLayout?: GPUBindGroupLayout;
    private sampler?: GPUSampler;
    private white?: GPUBindGroup;
    private textures = new Map<number, { texture: GPUTexture; group: GPUBindGroup }>();
    private batches: { first: number; count: number; spriteId?: number }[] = [];

    constructor(private readonly renderer: WebGPURenderer, private readonly depthTest = true) {}

    setRects(rects: readonly ZoneGroundRect[]): void {
        const key = JSON.stringify(rects);
        if (key === this.key) return;
        this.key = key;
        this.rects = rects;
        this.dirty = true;
    }
    setEntries(icons: readonly MapIconGroundEntry[]): void {
        this.icons = icons;
        this.dirty = true;
    }
    invalidate(): void { this.dirty = true; }

    draw(pass: GPURenderPassEncoder): void {
        const world = getWorldResources(this.renderer);
        if (!world || (!this.rects.length && !this.icons.length)) return;
        const device = this.renderer.device;
        const format = (world.extensionActive && world.extension?.sceneColorFormat) || this.renderer.format;
        if (!this.pipeline || this.format !== format) {
            this.format = format;
            this.textureLayout ??= device.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPU_SHADER_STAGE.FRAGMENT, texture: {} },
                { binding: 1, visibility: GPU_SHADER_STAGE.FRAGMENT, sampler: {} },
            ] });
            this.sampler ??= device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
            const module = device.createShaderModule({ code: GROUND_SHADER, label: "editor ground" });
            this.pipeline = createScenePipeline(device, {
                label: "editor ground", layout: device.createPipelineLayout({ bindGroupLayouts: [world.sceneUniformsLayout, this.textureLayout] }),
                vertex: { module, entryPoint: "vs_world", buffers: [{ arrayStride: 36, attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x3" },
                    { shaderLocation: 1, offset: 12, format: "float32x4" },
                    { shaderLocation: 2, offset: 28, format: "float32x2" },
                ] }] },
                fragment: { module, entryPoint: "fs_world", targets: [{ format, blend: {
                    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                    alpha: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                } }] },
                primitive: { topology: "triangle-list", cullMode: "none" },
                depthStencil: { format: SCENE_DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: this.depthTest ? "less-equal" : "always" },
            });
            if (!this.white) {
                const texture = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST });
                device.queue.writeTexture({ texture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
                const group = this.bindTexture(texture);
                this.textures.set(-1, { texture, group });
                this.white = group;
            }
        }
        if (this.dirty) {
            const geometry = buildZoneGroundGeometry(this.rects, (x, y, plane) => this.renderer.sampleHeightAtExactPlane(x, y, plane));
            const zoneCount = geometry.positions.length / 3;
            const data = new Float32Array((zoneCount + this.icons.length * 6) * 9);
            for (let i = 0; i < zoneCount; i++) {
                data.set(geometry.positions.subarray(i * 3, i * 3 + 3), i * 9);
                data.set(geometry.colors.subarray(i * 4, i * 4 + 4), i * 9 + 3);
            }
            this.batches = zoneCount ? [{ first: 0, count: zoneCount }] : [];
            this.icons.forEach((icon, index) => {
                if (!this.textures.has(icon.spriteId)) {
                    const texture = device.createTexture({ size: [icon.sprite.width, icon.sprite.height], format: "rgba8unorm", usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT });
                    device.queue.copyExternalImageToTexture({ source: icon.sprite }, { texture }, [icon.sprite.width, icon.sprite.height]);
                    this.textures.set(icon.spriteId, { texture, group: this.bindTexture(texture) });
                }
                const positions = buildMapIconGroundVertices(icon, (x, y, plane) => this.renderer.sampleHeightAtExactPlane(x, y, plane));
                const first = zoneCount + index * 6;
                for (let i = 0; i < 6; i++) {
                    data.set(positions.subarray(i * 3, i * 3 + 3), (first + i) * 9);
                    data.set([1, 1, 1, 1, UVS[i * 2], UVS[i * 2 + 1]], (first + i) * 9 + 3);
                }
                this.batches.push({ first, count: 6, spriteId: icon.spriteId });
            });
            if (data.byteLength > this.capacity) {
                this.buffer?.destroy();
                this.capacity = Math.max(4096, Math.ceil(data.byteLength / 4096) * 4096);
                this.buffer = device.createBuffer({ size: this.capacity, usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST });
            }
            if (data.byteLength) device.queue.writeBuffer(this.buffer!, 0, data);
            this.dirty = false;
        }
        if (!this.buffer) return;
        pass.setPipeline(withSampleCount(this.pipeline, world.sampleCount));
        pass.setBindGroup(0, world.sceneBindGroup);
        pass.setVertexBuffer(0, this.buffer);
        for (const batch of this.batches) {
            pass.setBindGroup(1, batch.spriteId === undefined ? this.white! : this.textures.get(batch.spriteId)!.group);
            pass.draw(batch.count, 1, batch.first);
        }
    }
    private bindTexture(texture: GPUTexture): GPUBindGroup {
        return this.renderer.device.createBindGroup({ layout: this.textureLayout!, entries: [
            { binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler! },
        ] });
    }
    dispose(): void {
        this.buffer?.destroy();
        for (const entry of this.textures.values()) entry.texture.destroy();
        this.textures.clear();
    }
}

/** A cache-model preview, kept out of map state and exported edits. */
class EditorLocPreview {
    private previews: readonly LocPlacementPreview[] = [];
    private square?: WebGPUMapSquare;
    private key?: string;
    private textureIds = new Set<number>();
    private sizeX = 1;
    private sizeY = 1;
    private readonly transforms: Float32Array[] = [];
    private readonly inverseView = mat4.create();

    constructor(private readonly renderer: WebGPURenderer) {}
    setPreview(client: LocPlacementPreviewClient, renderer: LocPlacementPreviewRenderer, preview: LocPlacementPreview): void {
        this.setPreviews(client, renderer, [preview]);
    }
    setPreviews(_client: LocPlacementPreviewClient, _renderer: LocPlacementPreviewRenderer, previews: readonly LocPlacementPreview[]): void {
        this.previews = previews;
        const next = previews[0];
        const key = next && `${next.locId}:${next.shape}:${next.rotation}`;
        if (key !== this.key) { this.square?.delete(); this.square = undefined; this.key = key; }
    }
    clear(): void { this.previews = []; }

    draw(pass: GPURenderPassEncoder, visibility: SceneryDrawContext): void {
        const world = getWorldResources(this.renderer);
        const preview = this.previews[0];
        const client = this.renderer.osrsClient;
        if (!world || !preview || !client.textureLoader) return;
        if (!this.square) {
            let type = client.locTypeLoader.load(preview.locId);
            if (type.transforms) {
                const transformed = type.transform(client.varManager, client.locTypeLoader);
                if (!transformed) return;
                type = transformed;
            }
            const diagonal = preview.shape === LocModelType.NORMAL_DIAGIONAL;
            const model = this.renderer.interactionHost.getInteractLocModelLoader()?.getModelAnimated(type,
                diagonal ? LocModelType.NORMAL : preview.shape as LocModelType,
                diagonal ? (preview.rotation + 4) & 7 : preview.rotation, -1, -1);
            if (!model) return;
            this.sizeX = preview.rotation & 1 ? type.sizeY : type.sizeX;
            this.sizeY = preview.rotation & 1 ? type.sizeX : type.sizeY;
            const textureIds = client.textureLoader.getTextureIds().filter(id => client.textureLoader.isSd(id)).slice(0, 2047);
            const scene = new SceneBuffer(client.textureLoader, new Map(textureIds.map((id, index) => [id, index + 1])), model.verticesCount);
            for (const alpha of [false, true]) {
                const range = scene.addModelAnimFrame(model, alpha);
                if (!range[1]) continue;
                const command: DrawCommand = { offset: range[0], elements: range[1], instances: [{
                    sceneX: 0, sceneZ: 0, heightOffset: 0, level: 0, contourGround: ContourGroundType.NONE,
                    priority: 0, interactType: InteractType.NONE, interactId: 0xffff,
                }] };
                (alpha ? scene.drawCommandsAlpha : scene.drawCommands).push(command);
            }
            this.textureIds = scene.usedTextureIds;
            const geometry = buildLocGeometryData(scene);
            // This square is draw-only: no streaming, collision, actors or map metadata.
            this.square = WebGPUMapSquare.load(this.renderer.device, world, {
                ...geometry, mapX: 0, mapY: 0, borderSize: 0, heightMapSize: 1,
                heightMapTextureData: new Int16Array(4), waterMaskTextureData: new Uint8Array(4), tileRenderFlags: [],
                doorVertices: new Uint8Array(), doorIndices: new Int32Array(), doorDrawRanges: [], doorDrawRangesAlpha: [],
            }, -1, 0);
        }
        const textures = new Map<number, Int32Array>();
        for (const id of this.textureIds) {
            if (world.loadedTextureIds.has(id)) continue;
            try { textures.set(id, client.textureLoader.getPixelsArgb(id, 128, true, 1)); }
            catch { /* Sparse-cache texture data is retried on the next frame. */ }
        }
        if (textures.size) world.uploadMapTextures(textures);
        const view = client.camera.viewMatrix;
        if (!mat4.invert(this.inverseView, view)) return;
        this.transforms.length = Math.min(this.transforms.length, this.previews.length);
        this.previews.forEach((entry, index) => {
            const transform = this.transforms[index] ??= mat4.create() as Float32Array;
            const x = entry.x + this.sizeX * 0.5, z = entry.y + this.sizeY * 0.5;
            const height = entry.height ?? this.renderer.sampleHeightAtExactPlane(x, z, entry.plane);
            // Map-square transforms operate in view space, so conjugate the world translation.
            mat4.translate(transform, view, [x, height, z]);
            mat4.multiply(transform, transform, this.inverseView);
        });
        this.square.setWorldEntityTransforms(this.transforms);
        this.square.drawOpaque(pass, 3, visibility);
        this.square.drawAlpha(pass, 3, visibility);
    }
    dispose(): void { this.square?.delete(); }
}

export class EditorOverlays {
    private pendingCapture?: { points: ReadonlyArray<readonly [number, number, number]>; resolve: (image: string | undefined) => void };
    readonly zones: EditorGroundLayer;
    readonly wall: EditorGroundLayer;
    readonly icons: EditorGroundLayer;
    readonly preview: EditorLocPreview;
    constructor(private readonly renderer: WebGPURenderer) {
        this.zones = new EditorGroundLayer(renderer);
        this.wall = new EditorGroundLayer(renderer, false);
        this.icons = new EditorGroundLayer(renderer);
        this.preview = new EditorLocPreview(renderer);
    }
    draw(pass: GPURenderPassEncoder, visibility: SceneryDrawContext): void {
        this.zones.draw(pass);
        this.icons.draw(pass);
        this.preview.draw(pass, visibility);
        this.wall.draw(pass);
    }
    capture(points: ReadonlyArray<readonly [number, number, number]>): Promise<string | undefined> {
        this.pendingCapture?.resolve(undefined);
        return new Promise(resolve => { this.pendingCapture = { points, resolve }; });
    }
    /** Read the submitted WebGPU frame, masking/cropping it with the shared editor image path. */
    encodeCapture(encoder: GPUCommandEncoder, texture: GPUTexture): void {
        const pending = this.pendingCapture;
        if (!pending) return;
        this.pendingCapture = undefined;
        const { width, height } = this.renderer.canvas;
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = width; maskCanvas.height = height;
        const ctx = maskCanvas.getContext("2d");
        if (!ctx) { pending.resolve(undefined); return; }
        ctx.fillStyle = "white";
        const clip = this.renderer.getSceneViewportWidgetRect();
        ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.width, clip.height); ctx.clip();
        const host = this.renderer.interactionHost;
        for (let i = 0; i + 2 < pending.points.length; i += 3) {
            const points = pending.points.slice(i, i + 3).map(point => host.worldToScreen(...point));
            if (points.some(point => !point)) continue;
            ctx.beginPath(); ctx.moveTo(points[0]![0], points[0]![1]);
            ctx.lineTo(points[1]![0], points[1]![1]); ctx.lineTo(points[2]![0], points[2]![1]); ctx.closePath(); ctx.fill();
        }
        const maskPixels = ctx.getImageData(0, 0, width, height).data;
        const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
        const buffer = this.renderer.device.createBuffer({ size: bytesPerRow * height, usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ });
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
        // Mapping starts after render() submits this encoder; mapAsync waits for that GPU work.
        void Promise.resolve().then(async () => {
            try {
                await buffer.mapAsync(GPU_MAP_MODE.READ);
                const pixels = new Uint8Array(buffer.getMappedRange());
                const scene = new Uint8Array(width * height * 4), mask = new Uint8Array(scene.length);
                const bgra = this.renderer.format.startsWith("bgra");
                for (let y = 0; y < height; y++) {
                    const targetRow = (height - 1 - y) * width * 4;
                    mask.set(maskPixels.subarray(y * width * 4, (y + 1) * width * 4), targetRow);
                    for (let x = 0; x < width; x++) {
                        const source = y * bytesPerRow + x * 4, target = targetRow + x * 4;
                        scene[target] = pixels[source + (bgra ? 2 : 0)];
                        scene[target + 1] = pixels[source + 1];
                        scene[target + 2] = pixels[source + (bgra ? 0 : 2)];
                        scene[target + 3] = pixels[source + 3];
                    }
                }
                const bounds = findOpaqueBounds(mask, width, height);
                pending.resolve(bounds ? cropMaskedPixels(scene, mask, width, height, bounds) : undefined);
            } catch (error) {
                console.warn("[edit] model image capture failed", error); pending.resolve(undefined);
            } finally { buffer.destroy(); }
        });
    }
    dispose(): void {
        this.pendingCapture?.resolve(undefined); this.pendingCapture = undefined;
        this.zones.dispose(); this.wall.dispose(); this.icons.dispose(); this.preview.dispose();
    }
}
