import { Scene } from "../../../rs/scene/Scene";
import type { SdMapData } from "../../loader/SdMapData";
import { GPU_BUFFER_USAGE, GPU_TEXTURE_USAGE } from "../bindings";
import type { WorldResources } from "../WorldResources";

export const ACTOR_DATA_WIDTH = 16;
/** 8 uint16 per actor = 2 texels; 16-wide RGBA16UI rows therefore hold 8 actors each. */
export const ACTOR_MAX = 8192;
const ACTOR_DATA_ROWS = ACTOR_MAX / 8;
const ACTOR_DATA_BYTES_PER_ROW = ACTOR_DATA_WIDTH * 4 * 2;
export const ACTOR_UNIFORM_BYTES = 128;
/** GPU player poses: 3 RGBA32F texels per label (LabelRig allows 255), one row per pose. */
export const POSE_ROWS = 256;
export const POSE_WIDTH = 255 * 3;
const IDENTITY_MAT4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Dynamic-offset stride; 256 matches bindings.ts, grown if the device needs more. */
export function actorUniformStride(device: GPUDevice): number {
    return Math.max(256, device.limits.minUniformBufferOffsetAlignment || 1);
}

/** group(3): the per-frame actor data texture and the GPU player pose texture. */
export class ActorDataTexture {
    readonly texture: GPUTexture;
    readonly poseTexture: GPUTexture;
    readonly bindGroup: GPUBindGroup;

    constructor(device: GPUDevice, layout: GPUBindGroupLayout, label: string) {
        this.texture = device.createTexture({
            label,
            size: [ACTOR_DATA_WIDTH, ACTOR_DATA_ROWS],
            format: "rgba16uint",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        this.poseTexture = device.createTexture({
            label: "webgpu player poses",
            size: [POSE_WIDTH, POSE_ROWS],
            format: "rgba32float",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
        });
        this.bindGroup = device.createBindGroup({
            layout,
            entries: [
                { binding: 0, resource: this.texture.createView() },
                { binding: 1, resource: this.poseTexture.createView() },
            ],
        });
    }

    /** Uploads the first `texels` texels of `rows` POSE_WIDTH-texel rows packed in `data`. */
    updatePoses(device: GPUDevice, data: Float32Array, texels: number, rows: number): void {
        if (rows <= 0 || texels <= 0) return;
        device.queue.writeTexture(
            { texture: this.poseTexture },
            data,
            { bytesPerRow: POSE_WIDTH * 16, rowsPerImage: rows },
            { width: texels, height: rows, depthOrArrayLayers: 1 },
        );
    }

    /** Uploads `count` actors (8 uint16 each) from the start of `data`. */
    update(device: GPUDevice, data: Uint16Array, count: number): void {
        if (count <= 0) return;
        const rows = Math.min(ACTOR_DATA_ROWS, Math.ceil((count * 2) / ACTOR_DATA_WIDTH));
        const u16Count = rows * ACTOR_DATA_WIDTH * 4;
        device.queue.writeTexture(
            { texture: this.texture },
            data.subarray(0, u16Count),
            { bytesPerRow: ACTOR_DATA_BYTES_PER_ROW, rowsPerImage: rows },
            { width: ACTOR_DATA_WIDTH, height: rows, depthOrArrayLayers: 1 },
        );
    }

    destroy(): void {
        this.texture.destroy();
        this.poseTexture.destroy();
    }
}

function createHeightMapTexture(device: GPUDevice, mapData: SdMapData): GPUTexture {
    const borderSize = mapData.borderSize | 0;
    const size = mapData.heightMapSize ?? Scene.MAP_SQUARE_SIZE + borderSize * 2;
    const data = mapData.heightMapTextureData ?? new Int16Array(0);
    const expected = size * size * Scene.MAX_LEVELS;
    const texture = device.createTexture({
        label: "webgpu actor height map",
        size: data.length >= expected && size > 0 ? [size, size, Scene.MAX_LEVELS] : [1, 1, 1],
        format: "r16sint",
        usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
    });
    if (data.length >= expected && size > 0) {
        device.queue.writeTexture(
            { texture },
            new Uint8Array(data.buffer, data.byteOffset, expected * 2),
            { bytesPerRow: size * 2, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: Scene.MAX_LEVELS },
        );
    } else {
        device.queue.writeTexture(
            { texture },
            new Int16Array([0]),
            { bytesPerRow: 2 },
            { width: 1, height: 1, depthOrArrayLayers: 1 },
        );
    }
    return texture;
}

/**
 * Per-map group(2): a dynamic-offset uniform buffer plus the map's own height map texture.
 * One uniform entry per draw item; entries are reused by the opaque and alpha passes.
 */
export class MapActorUniforms {
    readonly heightTexture: GPUTexture;
    readonly borderSize: number;
    readonly renderPosX: number;
    readonly renderPosY: number;

    private readonly device: GPUDevice;
    private readonly layout: GPUBindGroupLayout;
    private readonly stride: number;
    private capacity = 0;
    private buffer: GPUBuffer | undefined;
    private bindGroup: GPUBindGroup | undefined;
    private scratch: Float32Array;
    private view: DataView;
    /** View-space deck placement, shared by every entry on this map (identity otherwise). */
    private worldEntityTransform: Float32Array = IDENTITY_MAT4;

    entryCount = 0;

    constructor(
        device: GPUDevice,
        layout: GPUBindGroupLayout,
        stride: number,
        mapData: SdMapData,
    ) {
        this.device = device;
        this.layout = layout;
        this.stride = stride;
        this.borderSize = mapData.borderSize | 0;
        this.renderPosX = mapData.renderPosX ?? mapData.mapX;
        this.renderPosY = mapData.renderPosY ?? mapData.mapY;
        this.heightTexture = createHeightMapTexture(device, mapData);
        this.scratch = new Float32Array(stride / 4);
        this.view = new DataView(this.scratch.buffer);
    }

    reset(): void {
        this.entryCount = 0;
    }

    /** Deck placement for this frame's entries; undefined puts every entry back to identity. */
    setWorldEntityTransform(transform: Float32Array | undefined): void {
        this.worldEntityTransform = transform ?? IDENTITY_MAT4;
    }

    /** Appends one draw entry and returns its index. */
    addEntry(
        mapPosX: number,
        mapPosY: number,
        timeLoaded: number,
        modelYOffset: number,
        dataOffset: number,
        drawId: number,
        subOffsetX: number,
        subOffsetY: number,
        poseRow: number = -1,
    ): number {
        const entry = this.entryCount++;
        if (entry >= this.capacity) {
            this.grow(Math.max(8, this.capacity * 2));
        }
        const base = entry * (this.stride / 4);
        const f = this.scratch;
        f[base + 0] = mapPosX;
        f[base + 1] = mapPosY;
        f[base + 2] = timeLoaded;
        f[base + 3] = modelYOffset;
        this.view.setUint32(base * 4 + 16, dataOffset >>> 0, true);
        this.view.setUint32(base * 4 + 20, drawId >>> 0, true);
        f[base + 6] = subOffsetX;
        f[base + 7] = subOffsetY;
        this.view.setInt32(base * 4 + 32, this.borderSize | 0, true);
        f[base + 9] = 1.0;
        this.view.setInt32(base * 4 + 40, poseRow | 0, true);
        this.view.setUint32(
            base * 4 + 44,
            this.worldEntityTransform === IDENTITY_MAT4 ? 0 : 1,
            true,
        );
        f.set(this.worldEntityTransform, base + 16);
        return entry;
    }

    /** Uploads this frame's entries and refreshes the bind group if the buffer grew. */
    flush(): void {
        if (!this.buffer) return;
        if (this.entryCount > 0) {
            this.device.queue.writeBuffer(
                this.buffer,
                0,
                this.scratch.buffer,
                0,
                this.entryCount * this.stride,
            );
        }
    }

    bindGroupFor(entry: number): GPUBindGroup | undefined {
        return this.bindGroup;
    }

    offsetFor(entry: number): number {
        return entry * this.stride;
    }

    destroy(): void {
        this.heightTexture.destroy();
        this.buffer?.destroy();
        this.buffer = undefined;
        this.bindGroup = undefined;
    }

    private grow(capacity: number): void {
        this.capacity = capacity;
        this.scratch = new Float32Array(capacity * (this.stride / 4));
        this.view = new DataView(this.scratch.buffer);
        const old = this.buffer;
        this.buffer = this.device.createBuffer({
            label: "webgpu actor uniforms",
            size: capacity * this.stride,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.bindGroup = this.device.createBindGroup({
            label: "webgpu actor uniforms",
            layout: this.layout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.buffer, offset: 0, size: this.stride },
                },
                { binding: 1, resource: this.heightTexture.createView({ dimension: "2d-array" }) },
            ],
        });
        old?.destroy();
    }
}

export interface GpuGeometry {
    vertices: GPUBuffer;
    indices: GPUBuffer;
    indexCount: number;
    /** Per-vertex GPU pose labels (player rest meshes only). */
    labels?: GPUBuffer;
}

function createGeometryBuffer(device: GPUDevice, data: Uint8Array, usage: GPUBufferUsageFlags): GPUBuffer {
    const size = Math.max(4, Math.ceil(data.byteLength / 4) * 4);
    const buffer = device.createBuffer({ size, usage });
    if (data.byteLength > 0) {
        if (data.byteLength % 4 === 0) {
            device.queue.writeBuffer(buffer, 0, data);
        } else {
            const padded = new Uint8Array(size);
            padded.set(data);
            device.queue.writeBuffer(buffer, 0, padded);
        }
    }
    return buffer;
}

function createIndexBuffer(device: GPUDevice, data: Int32Array): GPUBuffer {
    const size = Math.max(4, data.byteLength);
    const buffer = device.createBuffer({ size, usage: GPU_BUFFER_USAGE.INDEX | GPU_BUFFER_USAGE.COPY_DST });
    if (data.length > 0) {
        device.queue.writeBuffer(buffer, 0, data);
    }
    return buffer;
}

/**
 * GPU mirror of the CPU geometry caches (DynamicNpcAnimLoader / GfxCache). Evicted buffers
 * are destroyed at the start of the next frame, after the draws that reference them have
 * been submitted.
 */
export class ActorGeometryCache {
    private readonly device: GPUDevice;
    private readonly entries = new Map<string, GpuGeometry>();
    private retired: GPUBuffer[] = [];
    private readonly maxEntries: number;

    constructor(device: GPUDevice, maxEntries: number = 1024) {
        this.device = device;
        this.maxEntries = maxEntries;
    }

    getOrCreate(
        key: string,
        vertices: Uint8Array,
        indices: Int32Array,
        labels?: Uint32Array,
    ): GpuGeometry | undefined {
        if (vertices.byteLength === 0 || indices.length === 0) return undefined;
        const existing = this.entries.get(key);
        if (existing) {
            // LRU touch.
            this.entries.delete(key);
            this.entries.set(key, existing);
            return existing;
        }
        const geometry: GpuGeometry = {
            vertices: createGeometryBuffer(
                this.device,
                vertices,
                GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
            ),
            indices: createIndexBuffer(this.device, indices),
            indexCount: indices.length,
            labels: labels
                ? createGeometryBuffer(
                      this.device,
                      new Uint8Array(labels.buffer, labels.byteOffset, labels.byteLength),
                      GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
                  )
                : undefined,
        };
        this.entries.set(key, geometry);
        this.evictIfNeeded();
        return geometry;
    }

    /** Call once per frame before uploading new geometry. */
    beginFrame(): void {
        for (const buffer of this.retired) buffer.destroy();
        this.retired.length = 0;
    }

    destroy(): void {
        for (const entry of this.entries.values()) {
            entry.vertices.destroy();
            entry.indices.destroy();
            entry.labels?.destroy();
        }
        this.entries.clear();
        this.beginFrame();
    }

    private evictIfNeeded(): void {
        while (this.entries.size > this.maxEntries) {
            const oldestKey = this.entries.keys().next().value as string | undefined;
            if (oldestKey === undefined) break;
            const oldest = this.entries.get(oldestKey);
            this.entries.delete(oldestKey);
            if (oldest) {
                this.retired.push(oldest.vertices, oldest.indices);
                if (oldest.labels) this.retired.push(oldest.labels);
            }
        }
    }
}
