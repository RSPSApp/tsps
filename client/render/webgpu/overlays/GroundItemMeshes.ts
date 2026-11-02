import type { ClientGroundItemStack } from "../../../game/data/ground/GroundItemStore";
import { Scene } from "../../../rs/scene/Scene";
import { MAX_TEXTURES, TEXTURE_SIZE } from "../../render/constants";
import type { GroundItemGeometryBuildData } from "../../ground/GroundItemMeshBuilder";
import { buildGroundItemGeometry } from "../../ground/GroundItemMeshBuilder";
import type { SdMapData } from "../../loader/SdMapData";
import { getMapSquareId } from "../../../rs/map/MapFileIndex";
import type { DrawRange } from "../../DrawRange";
import {
    DRAW_RANGE_INDEX_BYTES,
    GPU_BUFFER_USAGE,
    GPU_TEXTURE_USAGE,
    MAP_TEXTURE_BINDINGS,
    MAP_TEXTURES_GROUP,
    MAP_UNIFORMS_GROUP,
    MAP_UNIFORM_STRIDE,
    SCENE_GROUP,
    WORLD_TEXTURES_GROUP,
} from "../bindings";
import type { WebGPUMapSquare } from "../WebGPUMapSquare";
import type { WebGPURenderer } from "../WebGPURenderer";
import { getWorldResources } from "./rendererAccess";

const MODEL_INFO_WIDTH = 16;
const MODEL_INFO_COMPONENTS = 4;
const MODEL_INFO_BYTES_PER_ROW = MODEL_INFO_WIDTH * MODEL_INFO_COMPONENTS * 2;
const MAP_UNIFORM_USED_BYTES = 96;

type MeshBatch = {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    modelInfoTexture: GPUTexture;
    bindGroup: GPUBindGroup;
    ranges: DrawRange[];
};

type GroundItemMeshMap = {
    mapId: number;
    opaque: MeshBatch;
    alpha: MeshBatch;
    mapUniformsBindGroup: GPUBindGroup;
    mapUniformBuffer: GPUBuffer;
};

function createGeometryBuffer(
    device: GPUDevice,
    data: Uint8Array | Int32Array,
    usage: GPUBufferUsageFlags,
): GPUBuffer {
    const byteLength = data.byteLength;
    const size = Math.max(4, Math.ceil(byteLength / 4) * 4);
    const buffer = device.createBuffer({ size, usage });
    if (byteLength > 0) {
        if (byteLength % 4 === 0) {
            device.queue.writeBuffer(buffer, 0, data);
        } else {
            const padded = new Uint8Array(size);
            padded.set(new Uint8Array(data.buffer, data.byteOffset, byteLength));
            device.queue.writeBuffer(buffer, 0, padded);
        }
    }
    return buffer;
}

function createModelInfoTexture(device: GPUDevice, data: Uint16Array): GPUTexture {
    const height = Math.max(Math.ceil(data.length / (MODEL_INFO_WIDTH * MODEL_INFO_COMPONENTS)), 1);
    const texelCount = height * MODEL_INFO_WIDTH * MODEL_INFO_COMPONENTS;
    const source =
        data.length === texelCount
            ? data
            : (() => {
                  const padded = new Uint16Array(texelCount);
                  padded.set(data);
                  return padded;
              })();
    const texture = device.createTexture({
        size: [MODEL_INFO_WIDTH, height],
        format: "rgba16uint",
        usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
    });
    device.queue.writeTexture(
        { texture },
        source,
        { bytesPerRow: MODEL_INFO_BYTES_PER_ROW, rowsPerImage: height },
        { width: MODEL_INFO_WIDTH, height, depthOrArrayLayers: 1 },
    );
    return texture;
}

function createHeightMapTexture(device: GPUDevice, data: Int16Array, size: number): GPUTexture {
    const expected = size * size * Scene.MAX_LEVELS;
    const texture = device.createTexture({
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
    }
    return texture;
}

function createWaterMaskTexture(device: GPUDevice, data: Uint8Array, size: number): GPUTexture {
    const expected = size * size * 4 * Scene.MAX_LEVELS;
    const texture = device.createTexture({
        size: data.length >= expected && size > 0 ? [size, size, Scene.MAX_LEVELS] : [1, 1, 1],
        format: "rgba8unorm",
        usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
    });
    if (data.length >= expected && size > 0) {
        device.queue.writeTexture(
            { texture },
            new Uint8Array(data.buffer, data.byteOffset, expected),
            { bytesPerRow: size * 4, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: Scene.MAX_LEVELS },
        );
    }
    return texture;
}

/**
 * Ground-item mesh meshes for WebGPU. Geometry building is shared with the WebGL path
 * (`buildGroundItemGeometry`); grouping/hashing follows updateGroundItemMeshes in
 * client/render/render/draw3.ts. Draws through the world main pipelines with a compatible
 * group(2)/group(3) built here because WebGPUMapSquare keeps theirs private.
 */
export class GroundItemMeshes {
    private readonly renderer: WebGPURenderer;
    private readonly device: GPUDevice;

    private readonly stacks = new Map<number, ClientGroundItemStack[]>();
    private readonly desiredHashes = new Map<number, string>();
    private readonly builtHashes = new Map<number, string>();
    private readonly maps = new Map<number, GroundItemMeshMap>();
    private readonly mapDataById = new Map<number, SdMapData>();
    private readonly ownedTextures = new Map<number, GPUTexture[]>();

    private textureIdIndexMap?: Map<number, number>;

    constructor(renderer: WebGPURenderer, device: GPUDevice) {
        this.renderer = renderer;
        this.device = device;
    }

    onMapAdded(map: WebGPUMapSquare, mapData: SdMapData): void {
        this.mapDataById.set(getMapSquareId(map.mapX, map.mapY), mapData);
    }

    onMapRemoved(mapX: number, mapY: number): void {
        const mapId = getMapSquareId(mapX, mapY);
        this.mapDataById.delete(mapId);
        this.destroyMap(mapId);
        this.builtHashes.delete(mapId);
    }

    /** The locs under this map's items were rebuilt: the next update rebuilds its items on them. */
    onMapLocsRefreshed(mapId: number): void {
        this.builtHashes.delete(mapId);
    }

    /**
     * Port of updateGroundItemMeshes (draw3.ts): group stacks per map, hash, rebuild changed
     * maps, and return true while sparse models are still pending so the client retries.
     */
    update(stacks: ClientGroundItemStack[]): boolean {
        let modelsPending = false;
        const grouped = new Map<number, ClientGroundItemStack[]>();
        for (const stack of stacks) {
            const tileX = stack.tile.x | 0;
            const tileY = stack.tile.y | 0;
            const mapX = tileX >> 6;
            const mapY = tileY >> 6;
            if (mapX < 0 || mapY < 0) continue;
            const mapId = getMapSquareId(mapX, mapY);
            const clone: ClientGroundItemStack = {
                ...stack,
                itemId: stack.itemId | 0,
                quantity: Math.max(1, stack.quantity | 0),
                tile: { x: tileX, y: tileY, level: stack.tile.level | 0 },
            };
            const list = grouped.get(mapId);
            if (list) list.push(clone);
            else grouped.set(mapId, [clone]);
        }

        const allKeys = new Set<number>([...this.desiredHashes.keys(), ...grouped.keys()]);
        for (const key of allKeys) {
            const next = grouped.get(key) ?? [];
            const hashNext = next.length > 0 ? this.hashGroundStacks(next) : "";
            const prevHash = this.desiredHashes.get(key) ?? "";
            const builtHash = this.builtHashes.get(key);
            const needsBuild = hashNext !== prevHash || builtHash !== hashNext;
            if (!needsBuild) continue;
            if (next.length > 0) {
                this.stacks.set(key, next);
                this.desiredHashes.set(key, hashNext);
            } else {
                this.stacks.delete(key);
                this.desiredHashes.delete(key);
            }
            const mapX = key >> 8;
            const mapY = key & 0xff;
            const map = this.renderer.mapManager.getMap(mapX, mapY);
            if (!map) continue;
            const result = this.rebuildMap(map, next);
            if (result.pending) {
                this.desiredHashes.delete(key);
                modelsPending = true;
            } else {
                this.builtHashes.set(key, hashNext);
            }
        }
        return modelsPending;
    }

    hashGroundStacks(stacks: ClientGroundItemStack[]): string {
        return stacks
            .slice()
            .sort(
                (a, b) =>
                    a.tile.x - b.tile.x ||
                    a.tile.y - b.tile.y ||
                    a.tile.level - b.tile.level ||
                    a.itemId - b.itemId ||
                    a.quantity - b.quantity ||
                    (a.id | 0) - (b.id | 0),
            )
            .map(
                (stack) =>
                    `${stack.tile.x},${stack.tile.y},${stack.tile.level},${stack.itemId},${stack.quantity},${stack.id}`,
            )
            .join("|");
    }

    drawWorld(pass: GPURenderPassEncoder): void {
        const world = getWorldResources(this.renderer);
        if (!world || this.maps.size === 0) return;

        let pipelineSet = false;
        for (const mesh of this.maps.values()) {
            // Opaque batch.
            if (mesh.opaque.ranges.length > 0) {
                if (!pipelineSet) {
                    pass.setPipeline(world.opaquePipeline);
                    pass.setBindGroup(SCENE_GROUP, world.sceneBindGroup);
                    pass.setBindGroup(WORLD_TEXTURES_GROUP, world.mapWorldTextureBindGroup);
                    pipelineSet = true;
                }
                pass.setBindGroup(MAP_TEXTURES_GROUP, mesh.opaque.bindGroup);
                pass.setVertexBuffer(0, mesh.opaque.vertexBuffer);
                pass.setIndexBuffer(mesh.opaque.indexBuffer, "uint32");
                for (let i = 0; i < mesh.opaque.ranges.length; i++) {
                    const range = mesh.opaque.ranges[i];
                    if (!range) continue;
                    const elements = range[1] | 0;
                    const instances = range[2] | 0;
                    if (elements <= 0 || instances <= 0) continue;
                    pass.setBindGroup(MAP_UNIFORMS_GROUP, mesh.mapUniformsBindGroup, [i * MAP_UNIFORM_STRIDE]);
                    pass.drawIndexed(
                        elements,
                        instances,
                        (range[0] / DRAW_RANGE_INDEX_BYTES) | 0,
                        0,
                        0,
                    );
                }
            }
        }

        // Alpha batch switches pipeline; the main renderer already drew map/actor alpha, so
        // ground-item alpha is drawn last with the alpha pipeline.
        let alphaSet = false;
        for (const mesh of this.maps.values()) {
            if (mesh.alpha.ranges.length === 0) continue;
            if (!alphaSet) {
                pass.setPipeline(world.alphaPipeline);
                pass.setBindGroup(SCENE_GROUP, world.sceneBindGroup);
                pass.setBindGroup(WORLD_TEXTURES_GROUP, world.mapWorldTextureBindGroup);
                alphaSet = true;
            }
            pass.setBindGroup(MAP_TEXTURES_GROUP, mesh.alpha.bindGroup);
            pass.setVertexBuffer(0, mesh.alpha.vertexBuffer);
            pass.setIndexBuffer(mesh.alpha.indexBuffer, "uint32");
            for (let i = 0; i < mesh.alpha.ranges.length; i++) {
                const range = mesh.alpha.ranges[i];
                if (!range) continue;
                const elements = range[1] | 0;
                const instances = range[2] | 0;
                if (elements <= 0 || instances <= 0) continue;
                pass.setBindGroup(MAP_UNIFORMS_GROUP, mesh.mapUniformsBindGroup, [i * MAP_UNIFORM_STRIDE]);
                pass.drawIndexed(
                    elements,
                    instances,
                    (range[0] / DRAW_RANGE_INDEX_BYTES) | 0,
                    0,
                    0,
                );
            }
        }
    }

    dispose(): void {
        for (const key of [...this.maps.keys()]) this.destroyMap(key);
        this.maps.clear();
        this.stacks.clear();
        this.desiredHashes.clear();
        this.builtHashes.clear();
        this.mapDataById.clear();
    }

    private rebuildMap(
        map: WebGPUMapSquare,
        stacks: ClientGroundItemStack[],
    ): { pending: boolean } {
        const osrsClient = this.renderer.osrsClient;
        const objModelLoader = osrsClient.objModelLoader;
        const textureLoader = osrsClient.textureLoader;
        if (!objModelLoader || !textureLoader) return { pending: false };

        const mapId = getMapSquareId(map.mapX, map.mapY);
        const mapData = this.mapDataById.get(mapId);
        if (!mapData) return { pending: false };

        const missesBefore = objModelLoader.modelLoader?.missCount ?? 0;
        const data = buildGroundItemGeometry(
            map,
            stacks.length > 0 ? stacks : undefined,
            objModelLoader,
            textureLoader,
            this.getTextureIdIndexMap(),
        );

        if (!data) {
            this.destroyMap(mapId);
            const pending = (objModelLoader.modelLoader?.missCount ?? 0) > missesBefore;
            return { pending };
        }

        // Upload any textures this geometry needs into the shared world atlas.
        const textureUpdates = new Map<number, Int32Array>();
        const world = getWorldResources(this.renderer);
        for (const texId of data.usedTextureIds) {
            if (world?.loadedTextureIds.has(texId)) continue;
            try {
                const pixels = textureLoader.getPixelsArgb(texId, TEXTURE_SIZE, true, 1.0);
                textureUpdates.set(texId, pixels);
            } catch {}
        }
        if (textureUpdates.size > 0) {
            world?.uploadMapTextures(textureUpdates);
        }

        this.destroyMap(mapId);
        this.maps.set(mapId, this.createMapResources(mapId, mapData, data));
        return { pending: false };
    }

    private createMapResources(
        mapId: number,
        mapData: SdMapData,
        data: GroundItemGeometryBuildData,
    ): GroundItemMeshMap {
        const device = this.device;
        const world = getWorldResources(this.renderer);
        const borderSize = mapData.borderSize | 0;
        const heightMapSize =
            mapData.heightMapSize ?? Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const heightTexture = createHeightMapTexture(
            device,
            mapData.heightMapTextureData ?? new Int16Array(0),
            heightMapSize,
        );
        const waterTexture = createWaterMaskTexture(
            device,
            mapData.waterMaskTextureData ?? new Uint8Array(0),
            heightMapSize,
        );
        // Ground items never read the HD ground-recipe texture (v_hdGroundMaterial is 0), but
        // the shared map-textures layout requires the binding to be present.
        const groundMaterialTexture = device.createTexture({
            label: "webgpu ground item ground material placeholder",
            size: [1, 1, 1],
            format: "r8uint",
            usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING,
        });
        this.ownedTextures.set(mapId, [heightTexture, waterTexture, groundMaterialTexture]);

        const createBatch = (
            modelInfoData: Uint16Array,
            ranges: DrawRange[],
        ): MeshBatch | undefined => {
            if (!world) return undefined;
            const vertexBuffer = createGeometryBuffer(
                device,
                data.vertices,
                GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
            );
            const indexBuffer = createGeometryBuffer(
                device,
                data.indices,
                GPU_BUFFER_USAGE.INDEX | GPU_BUFFER_USAGE.COPY_DST,
            );
            const texture = createModelInfoTexture(device, modelInfoData);
            const bindGroup = device.createBindGroup({
                layout: world.mapTexturesLayout,
                entries: [
                    { binding: MAP_TEXTURE_BINDINGS.modelInfo, resource: texture.createView() },
                    {
                        binding: MAP_TEXTURE_BINDINGS.heightMap,
                        resource: heightTexture.createView({ dimension: "2d-array" }),
                    },
                    {
                        binding: MAP_TEXTURE_BINDINGS.waterMask,
                        resource: waterTexture.createView({ dimension: "2d-array" }),
                    },
                    {
                        binding: MAP_TEXTURE_BINDINGS.groundMaterial,
                        resource: groundMaterialTexture.createView({ dimension: "2d-array" }),
                    },
                ],
            });
            return { vertexBuffer, indexBuffer, modelInfoTexture: texture, bindGroup, ranges };
        };

        const opaque = createBatch(data.modelTextureData, data.drawRanges);
        const alpha = createBatch(data.modelTextureDataAlpha, data.drawRangesAlpha);
        if (!opaque || !alpha) {
            throw new Error("webgpu ground items: world resources missing");
        }

        // One uniform entry per draw range: u_drawId selects the range's stack in the model-info
        // texture, as gl_DrawID does for WebGL's multi-draw. Opaque and alpha ranges each count
        // from 0 into their own model-info texture, so they share the entries.
        const rangeCount = Math.max(1, data.drawRanges.length, data.drawRangesAlpha.length);
        const mapUniformBuffer = device.createBuffer({
            size: rangeCount * MAP_UNIFORM_STRIDE,
            usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
        });
        this.writeMapUniforms(mapUniformBuffer, mapData, borderSize, rangeCount);
        const mapUniformsBindGroup = device.createBindGroup({
            layout: world!.mapUniformsLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: mapUniformBuffer,
                        offset: 0,
                        size: MAP_UNIFORM_USED_BYTES,
                    },
                },
            ],
        });

        return { mapId, opaque, alpha, mapUniformBuffer, mapUniformsBindGroup };
    }

    private writeMapUniforms(
        buffer: GPUBuffer,
        mapData: SdMapData,
        borderSize: number,
        rangeCount: number,
    ): void {
        const arrayBuffer = new ArrayBuffer(rangeCount * MAP_UNIFORM_STRIDE);
        const view = new DataView(arrayBuffer);
        for (let i = 0; i < rangeCount; i++) {
            const base = i * MAP_UNIFORM_STRIDE;
            const floats = new Float32Array(arrayBuffer, base, MAP_UNIFORM_STRIDE / 4);
            floats[0] = 1;
            floats[5] = 1;
            floats[10] = 1;
            floats[15] = 1;
            floats[16] = mapData.renderPosX ?? mapData.mapX;
            floats[17] = mapData.renderPosY ?? mapData.mapY;
            floats[18] = -1.0; // loadTime: skip the map fade-in for ground items
            floats[20] = 1.0;
            floats[21] = 3.0;
            view.setInt32(base + 76, borderSize | 0, true);
            view.setUint32(base + 88, i, true);
            view.setUint32(base + 92, 0, true);
        }
        this.device.queue.writeBuffer(buffer, 0, arrayBuffer);
    }

    private destroyMap(mapId: number): void {
        const mesh = this.maps.get(mapId);
        if (mesh) {
            mesh.opaque.vertexBuffer.destroy();
            mesh.opaque.indexBuffer.destroy();
            mesh.opaque.modelInfoTexture.destroy();
            mesh.alpha.vertexBuffer.destroy();
            mesh.alpha.indexBuffer.destroy();
            mesh.alpha.modelInfoTexture.destroy();
            mesh.mapUniformBuffer.destroy();
            this.maps.delete(mapId);
        }
        const textures = this.ownedTextures.get(mapId);
        if (textures) {
            for (const texture of textures) texture.destroy();
            this.ownedTextures.delete(mapId);
        }
    }

    private getTextureIdIndexMap(): Map<number, number> {
        if (this.textureIdIndexMap) return this.textureIdIndexMap;
        const map = new Map<number, number>();
        const textureLoader = this.renderer.osrsClient.textureLoader;
        if (textureLoader) {
            const textureIds = textureLoader
                .getTextureIds()
                .filter((id) => textureLoader.isSd(id))
                .slice(0, MAX_TEXTURES - 1);
            textureIds.forEach((id, index) => map.set(id, index + 1));
        }
        this.textureIdIndexMap = map;
        return map;
    }
}
