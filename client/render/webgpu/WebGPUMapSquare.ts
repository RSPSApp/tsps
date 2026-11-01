import { objSurfaceHeightAt } from "../../rs/scene/ObjSurfaceHeights";
import { CollisionMap } from "../../rs/scene/CollisionMap";
import { MapGeometryUpload, mapGeometrySources } from "../MapGeometryUpload";
import type { MapSquare } from "../../game/MapManager";
import type { Frustum } from "../../game/Frustum";
import { getMapSquareId } from "../../rs/map/MapFileIndex";
import { Scene } from "../../rs/scene/Scene";
import type { DrawRange } from "../DrawRange";
import { sceneryBoundsVisible, sceneryRangeVisible } from "../SceneryVisibility";
import { LocAnimated, type LocFrameSoundHandler } from "../loc/LocAnimated";
import { LocAnimationUpdater, type LocAnimationGeometry } from "../loc/LocAnimationUpdater";
import { hasSunkenLocs, sunkenRangeIndices } from "../loc/SunkenLocs";
import type { SeqFrameLoader } from "../../rs/model/seq/SeqFrameLoader";
import type { SeqTypeLoader } from "../../rs/config/seqtype/SeqTypeLoader";
import type { SdMapData } from "../loader/SdMapData";
import {
    DRAW_RANGE_INDEX_BYTES,
    GPU_BUFFER_USAGE,
    GPU_TEXTURE_USAGE,
    MAP_TEXTURE_BINDINGS,
    MAP_TEXTURES_GROUP,
    MAP_UNIFORMS_GROUP,
    MAP_UNIFORM_STRIDE,
    SCENE_GROUP,
    SCENE_DEPTH_FORMAT,
    WORLD_TEXTURES_GROUP,
} from "./bindings";
import { SceneryDrawBundle } from "./SceneryDrawBundle";
import type { WorldResources } from "./WorldResources";

const FRAME_RENDER_DELAY = 0;
const MODEL_INFO_WIDTH = 16;
const MODEL_INFO_COMPONENTS = 4;
const MODEL_INFO_BYTES_PER_ROW = MODEL_INFO_WIDTH * MODEL_INFO_COMPONENTS * 2;
const MAP_UNIFORM_USED_BYTES = 96;
const MAP_UNIFORM_TRANSFORM_OFFSET = 92;
const WORLD_ENTITY_ENABLED = new Uint32Array([1]);

type BatchKind = "opaque" | "alpha" | "opaqueLod" | "alphaLod";

type MapDrawBatch = {
    lod: boolean;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    ranges: DrawRange[];
    bounds?: number[];
    planes: Uint8Array | undefined;
    bindGroup: GPUBindGroup;
    /** The group's MapUniforms (one entry per range, u_drawId = range index). */
    uniformsBindGroup: GPUBindGroup;
    uniformBase: number;
    uniformEntries: number;
    bundles?: [SceneryDrawBundle[], SceneryDrawBundle[]];
};

/**
 * The three geometry groups of a map square (SdMapData's scene, door and loc buffers), each with
 * its own GPU resources so a door-only or loc-only rebuild replaces just that group.
 */
type GeometryGroupKind = "scene" | "door" | "loc";
const GROUP_ORDER: GeometryGroupKind[] = ["scene", "door", "loc"];

type GeometryGroup = {
    opaque?: MapDrawBatch;
    alpha?: MapDrawBatch;
    opaqueLod?: MapDrawBatch;
    alphaLod?: MapDrawBatch;
    buffers: GPUBuffer[];
    textures: GPUTexture[];
    /** This group's MapUniforms buffer (one entry per range) and its entry count. */
    uniformBuffer?: GPUBuffer;
    uniformEntries?: number;
    uniformData?: ArrayBuffer;
};

/** Fields needed to upload scenery; draw-only editor models have no gameplay metadata. */
export type RenderMapData = Pick<SdMapData,
    "mapX" | "mapY" | "borderSize" | "heightMapSize" | "tileRenderFlags" |
    "vertices" | "indices" | "modelTextureData" | "modelTextureDataAlpha" |
    "modelTextureDataLod" | "modelTextureDataLodAlpha" | "drawRanges" | "drawRangesAlpha" |
    "drawRangesLod" | "drawRangesLodAlpha"> & Partial<SdMapData>;

type GeometryInput = {
    vertices: Uint8Array;
    indices: Int32Array;
    opaqueModelInfo: Uint16Array;
    opaqueRanges: DrawRange[];
    opaquePlanes: Uint8Array | undefined;
    alphaModelInfo: Uint16Array;
    alphaRanges: DrawRange[];
    alphaPlanes: Uint8Array | undefined;
    opaqueLodModelInfo: Uint16Array;
    opaqueLodRanges: DrawRange[];
    opaqueLodPlanes: Uint8Array | undefined;
    alphaLodModelInfo: Uint16Array;
    alphaLodRanges: DrawRange[];
    alphaLodPlanes: Uint8Array | undefined;
};

export interface SceneryDrawContext {
    tileX: number;
    tileZ: number;
    distance: number;
    lodDistance: number;
    camera: Frustum;
    shadow?: Frustum;
}

type PendingGeometry = {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    opaqueTexture: GPUTexture;
    alphaTexture: GPUTexture;
    opaqueBindGroup: GPUBindGroup;
    alphaBindGroup: GPUBindGroup;
    opaqueRanges: DrawRange[];
    opaquePlanes: Uint8Array | undefined;
    alphaRanges: DrawRange[];
    alphaPlanes: Uint8Array | undefined;
};

function createGeometryBuffer(
    device: GPUDevice,
    data: Uint8Array | Int32Array,
    usage: GPUBufferUsageFlags,
    prepared?: Map<ArrayBufferView, GPUBuffer>,
): GPUBuffer {
    const ready = prepared?.get(data);
    if (ready) {
        prepared!.delete(data);
        return ready;
    }
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
    const source = data.length === texelCount ? data : (() => {
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

function createHeightMapTexture(
    device: GPUDevice,
    data: Int16Array,
    size: number,
): GPUTexture {
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

function createWaterMaskTexture(
    device: GPUDevice,
    data: Uint8Array,
    size: number,
): GPUTexture {
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
    } else {
        device.queue.writeTexture(
            { texture },
            new Uint8Array(4),
            { bytesPerRow: 4 },
            { width: 1, height: 1, depthOrArrayLayers: 1 },
        );
    }
    return texture;
}

function createGroundMaterialTexture(
    device: GPUDevice,
    data: Uint8Array[][] | undefined,
    size: number,
): GPUTexture {
    const expected = size * size * Scene.MAX_LEVELS;
    const usable = !!data && data.length > 0 && size > 0;
    const texture = device.createTexture({
        size: usable ? [size, size, Scene.MAX_LEVELS] : [1, 1, 1],
        format: "r8uint",
        usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
    });
    if (usable) {
        // Grid is [level][x][y]; the GPU texture is layer-major rows of y then x, matching
        // the height map upload so texel (x, y) is tile (x, y).
        const flat = new Uint8Array(expected);
        for (let level = 0; level < Math.min(Scene.MAX_LEVELS, data.length); level++) {
            const columns = data[level];
            if (!columns) continue;
            const layerBase = level * size * size;
            for (let x = 0; x < Math.min(size, columns.length); x++) {
                const column = columns[x];
                if (!column) continue;
                const count = Math.min(size, column.length);
                for (let y = 0; y < count; y++) flat[layerBase + y * size + x] = column[y];
            }
        }
        device.queue.writeTexture(
            { texture },
            flat,
            { bytesPerRow: size, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: Scene.MAX_LEVELS },
        );
    } else {
        device.queue.writeTexture(
            { texture },
            new Uint8Array(1),
            { bytesPerRow: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 1 },
        );
    }
    return texture;
}

function createMapTextureBindGroup(
    device: GPUDevice, resources: WorldResources, modelInfo: GPUTexture,
    heightMapTexture: GPUTexture, waterMaskTexture: GPUTexture, groundMaterialTexture: GPUTexture,
): GPUBindGroup {
    return device.createBindGroup({
        layout: resources.mapTexturesLayout,
        entries: [
            { binding: MAP_TEXTURE_BINDINGS.modelInfo, resource: modelInfo.createView() },
            {
                binding: MAP_TEXTURE_BINDINGS.heightMap,
                resource: heightMapTexture.createView({ dimension: "2d-array" }),
            },
            {
                binding: MAP_TEXTURE_BINDINGS.waterMask,
                resource: waterMaskTexture.createView({ dimension: "2d-array" }),
            },
            {
                binding: MAP_TEXTURE_BINDINGS.groundMaterial,
                resource: groundMaterialTexture.createView({ dimension: "2d-array" }),
            },
        ],
    });
}

function createPendingGeometry(
    device: GPUDevice,
    resources: WorldResources,
    heightMapTexture: GPUTexture,
    waterMaskTexture: GPUTexture,
    groundMaterialTexture: GPUTexture,
    input: GeometryInput,
    prepared?: Map<ArrayBufferView, GPUBuffer>,
): PendingGeometry | undefined {
    if (input.opaqueRanges.length === 0 && input.alphaRanges.length === 0) return undefined;
    if (input.vertices.byteLength === 0 || input.indices.length === 0) return undefined;

    const vertexBuffer = createGeometryBuffer(
        device,
        input.vertices,
        GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
        prepared,
    );
    const indexBuffer = createGeometryBuffer(
        device,
        input.indices,
        GPU_BUFFER_USAGE.INDEX | GPU_BUFFER_USAGE.COPY_DST,
        prepared,
    );
    const opaqueTexture = createModelInfoTexture(device, input.opaqueModelInfo);
    const alphaTexture = createModelInfoTexture(device, input.alphaModelInfo);


    return {
        vertexBuffer,
        indexBuffer,
        opaqueTexture,
        alphaTexture,
        opaqueBindGroup: createMapTextureBindGroup(device, resources, opaqueTexture, heightMapTexture, waterMaskTexture, groundMaterialTexture),
        alphaBindGroup: createMapTextureBindGroup(device, resources, alphaTexture, heightMapTexture, waterMaskTexture, groundMaterialTexture),
        opaqueRanges: input.opaqueRanges,
        opaquePlanes: input.opaquePlanes,
        alphaRanges: input.alphaRanges,
        alphaPlanes: input.alphaPlanes,
    };
}

function writeMapUniform(
    floats: Float32Array,
    view: DataView,
    entry: number,
    drawId: number,
    mapPosX: number,
    mapPosY: number,
    timeLoaded: number,
    borderSize: number,
): void {
    const base = entry * (MAP_UNIFORM_STRIDE / 4);
    floats[base] = 1;
    floats[base + 5] = 1;
    floats[base + 10] = 1;
    floats[base + 15] = 1;
    floats[base + 16] = mapPosX;
    floats[base + 17] = mapPosY;
    floats[base + 18] = timeLoaded;
    floats[base + 20] = 1.0;
    floats[base + 21] = 3.0;
    const byteBase = entry * MAP_UNIFORM_STRIDE;
    view.setInt32(byteBase + 76, borderSize | 0, true);
    view.setUint32(byteBase + 88, drawId, true);
    view.setUint32(byteBase + 92, 0, true);
}

export class WebGPUMapSquare implements MapSquare {
    private static readonly pendingGeometry = new Map<RenderMapData,
        { device: GPUDevice; upload: MapGeometryUpload<GPUBuffer> }>();

    static prepareLoad(device: GPUDevice, data: RenderMapData): boolean {
        let pending = this.pendingGeometry.get(data);
        if (!pending) {
            const sources = mapGeometrySources(data);
            if (sources.reduce((sum, source) => sum + source.data.byteLength, 0) <= MapGeometryUpload.FRAME_BYTES) return true;
            const upload = new MapGeometryUpload(sources, (source) => device.createBuffer({
                size: Math.ceil(source.data.byteLength / 4) * 4,
                usage: (source.index ? GPU_BUFFER_USAGE.INDEX : GPU_BUFFER_USAGE.VERTEX) | GPU_BUFFER_USAGE.COPY_DST,
            }), (buffer, bytes, offset) => {
                if (bytes.byteLength % 4) {
                    const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
                    padded.set(bytes);
                    device.queue.writeBuffer(buffer, offset, padded);
                } else device.queue.writeBuffer(buffer, offset, bytes);
            }, (buffer) => buffer.destroy());
            pending = { device, upload };
            this.pendingGeometry.set(data, pending);
        }
        try {
            return pending.upload.step();
        } catch (error) {
            this.cancelPreparedLoad(data);
            throw error;
        }
    }

    static cancelPreparedLoad(data: RenderMapData): void {
        this.pendingGeometry.get(data)?.upload.dispose();
        this.pendingGeometry.delete(data);
    }

    static cancelPreparedLoads(device: GPUDevice): void {
        for (const [data, pending] of this.pendingGeometry) {
            if (pending.device === device) this.cancelPreparedLoad(data);
        }
    }
    readonly locDataChangedListeners = new Set<() => void>();

    mapX: number;
    mapY: number;
    timeLoaded: number;
    frameLoaded: number;

    /** Stable map-square id, same value the WebGL map and MapManager key use. */
    readonly id: number;
    /** Interaction/deck plane; -1 for normal maps. Deck maps set it to the deck's plane. */
    interactionPlane: number = -1;

    /** CPU-side height/flag data other systems sample (bridge camera, route finding). */
    tileRenderFlags!: Uint8Array[][];
    objSurfaceHeights?: Int16Array[][];
    tileOverlays?: Int16Array[][];
    /** HD ground recipe grid copied from SdMapData, [level][x][y], full heightmap grid incl. border. */
    tileGroundMaterials?: Uint8Array[][];
    tileGroundColors?: Uint32Array[][];
    bridgeSurfaceFlags?: Uint8Array[][];
    heightMapData!: Int16Array;

    /** Loc CSR arrays for interaction queries (SceneRaycaster, hover highlights). */
    collisionMaps: CollisionMap[] = [];
    tilePresenceByLevel?: Uint8Array[];
    tileLocOffsetsByLevel?: Uint32Array[];
    tileLocIdsByLevel?: Int32Array[];
    tileLocTypeRotByLevel?: Uint8Array[];

    /** CPU terrain pick triangles, shared with the WebGL pick path. */
    terrainPickTileOffsets!: Uint32Array;
    terrainPickVertices!: Float32Array;
    terrainPickPlanes!: Uint8Array;

    /** Animated locs: each swaps its draw range in the loc batch for its current frame. */
    locsAnimated: LocAnimated[] = [];
    /** The loc geometry's draw ranges (shared with the loc batches), which animations rewrite. */
    private locRanges?: LocAnimationGeometry;
    private readonly locAnimationUpdater = new LocAnimationUpdater();
    private worldEntity = false;
    private transformCount = 1;

    private locIdsAtLocalBuffer: number[] = [];
    private locTypeRotsAtLocalBuffer: number[] = [];

    private readonly device: GPUDevice;
    private readonly resources: WorldResources;
    private readonly renderPosX: number;
    private readonly renderPosY: number;
    readonly borderSize: number;
    readonly heightMapSize: number;
    private readonly heightMapTexture: GPUTexture;
    private readonly waterMaskTexture: GPUTexture;
    private readonly groundMaterialTexture: GPUTexture;
    private readonly opaqueBatches: MapDrawBatch[] = [];
    private readonly alphaBatches: MapDrawBatch[] = [];
    private readonly groups = new Map<GeometryGroupKind, GeometryGroup>();

    private constructor(
        device: GPUDevice,
        resources: WorldResources,
        mapX: number,
        mapY: number,
        renderPosX: number,
        renderPosY: number,
        borderSize: number,
        heightMapSize: number,
        timeLoaded: number,
        frameLoaded: number,
        heightMapTexture: GPUTexture,
        waterMaskTexture: GPUTexture,
        groundMaterialTexture: GPUTexture,
    ) {
        this.device = device;
        this.resources = resources;
        this.mapX = mapX;
        this.mapY = mapY;
        this.id = getMapSquareId(mapX, mapY);
        this.renderPosX = renderPosX;
        this.renderPosY = renderPosY;
        this.borderSize = borderSize;
        this.heightMapSize = heightMapSize;
        this.timeLoaded = timeLoaded;
        this.frameLoaded = frameLoaded;
        this.heightMapTexture = heightMapTexture;
        this.waterMaskTexture = waterMaskTexture;
        this.groundMaterialTexture = groundMaterialTexture;
    }

    static load(
        device: GPUDevice,
        resources: WorldResources,
        mapData: RenderMapData,
        time: number,
        frame: number,
    ): WebGPUMapSquare {
        const prepared = this.pendingGeometry.get(mapData)?.upload.take();
        this.pendingGeometry.delete(mapData);
        const { mapX, mapY, borderSize } = mapData;
        const renderPosX = mapData.renderPosX ?? mapX;
        const renderPosY = mapData.renderPosY ?? mapY;
        const heightMapSize = mapData.heightMapSize ?? Scene.MAP_SQUARE_SIZE + borderSize * 2;

        const heightMapTexture = createHeightMapTexture(
            device,
            mapData.heightMapTextureData ?? new Int16Array(0),
            heightMapSize,
        );
        const waterMaskTexture = createWaterMaskTexture(
            device,
            mapData.waterMaskTextureData ?? new Uint8Array(0),
            heightMapSize,
        );
        const groundMaterialTexture = createGroundMaterialTexture(
            device,
            mapData.groundMaterials,
            heightMapSize,
        );

        const square = new WebGPUMapSquare(
            device,
            resources,
            mapX,
            mapY,
            renderPosX,
            renderPosY,
            borderSize,
            heightMapSize,
            time,
            frame,
            heightMapTexture,
            waterMaskTexture,
            groundMaterialTexture,
        );
        for (const kind of GROUP_ORDER) square.setGroup(kind, mapData, prepared);
        for (const unused of prepared?.values() ?? []) unused.destroy();
        square.collisionMaps = (mapData.collisionDatas ?? []).map(CollisionMap.fromData);
        square.tilePresenceByLevel = mapData.tilePresenceByLevel;
        square.tileRenderFlags = mapData.tileRenderFlags;
        square.objSurfaceHeights = mapData.objSurfaceHeights;
        square.tileOverlays = mapData.tileOverlays;
        square.tileGroundMaterials = mapData.groundMaterials;
        square.tileGroundColors = mapData.groundColors;
        square.bridgeSurfaceFlags = mapData.bridgeSurfaceFlags;
        square.heightMapData = mapData.heightMapTextureData ?? new Int16Array(0);
        square.tileLocOffsetsByLevel = mapData.tileLocOffsetsByLevel;
        square.tileLocIdsByLevel = mapData.tileLocIdsByLevel;
        square.tileLocTypeRotByLevel = mapData.tileLocTypeRotByLevel;
        square.terrainPickTileOffsets = mapData.terrainPickTileOffsets ?? new Uint32Array(0);
        square.terrainPickVertices = mapData.terrainPickVertices ?? new Float32Array(0);
        square.terrainPickPlanes = mapData.terrainPickPlanes ?? new Uint8Array(0);
        return square;
    }

    /** SdMapData's buffers for one geometry group. */
    private static groupInput(kind: GeometryGroupKind, mapData: RenderMapData): GeometryInput | undefined {
        if (kind === "scene") {
            return {
                vertices: mapData.vertices,
                indices: mapData.indices,
                opaqueModelInfo: mapData.modelTextureData,
                opaqueRanges: mapData.drawRanges,
                opaquePlanes: mapData.drawRangesPlanes,
                alphaModelInfo: mapData.modelTextureDataAlpha,
                alphaRanges: mapData.drawRangesAlpha,
                alphaPlanes: mapData.drawRangesAlphaPlanes,
                opaqueLodModelInfo: mapData.modelTextureDataLod,
                opaqueLodRanges: mapData.drawRangesLod,
                opaqueLodPlanes: mapData.drawRangesLodPlanes,
                alphaLodModelInfo: mapData.modelTextureDataLodAlpha,
                alphaLodRanges: mapData.drawRangesLodAlpha,
                alphaLodPlanes: mapData.drawRangesLodAlphaPlanes,
            };
        }
        if (kind === "door") {
            if (!mapData.doorVertices?.length || !mapData.doorIndices?.length) return undefined;
            return {
                vertices: mapData.doorVertices,
                indices: mapData.doorIndices,
                opaqueModelInfo: mapData.doorModelTextureData!,
                opaqueRanges: mapData.doorDrawRanges!,
                opaquePlanes: mapData.doorDrawRangesPlanes,
                alphaModelInfo: mapData.doorModelTextureDataAlpha!,
                alphaRanges: mapData.doorDrawRangesAlpha!,
                alphaPlanes: mapData.doorDrawRangesAlphaPlanes,
                opaqueLodModelInfo: mapData.doorModelTextureDataLod!,
                opaqueLodRanges: mapData.doorDrawRangesLod!,
                opaqueLodPlanes: mapData.doorDrawRangesLodPlanes,
                alphaLodModelInfo: mapData.doorModelTextureDataLodAlpha!,
                alphaLodRanges: mapData.doorDrawRangesLodAlpha!,
                alphaLodPlanes: mapData.doorDrawRangesLodAlphaPlanes,
            };
        }
        const loc = mapData.loc;
        if (!loc) return undefined;
        return {
            vertices: loc.vertices,
            indices: loc.indices,
            opaqueModelInfo: loc.modelTextureData,
            opaqueRanges: loc.drawRanges,
            opaquePlanes: loc.drawRangesPlanes,
            alphaModelInfo: loc.modelTextureDataAlpha,
            alphaRanges: loc.drawRangesAlpha,
            alphaPlanes: loc.drawRangesAlphaPlanes,
            opaqueLodModelInfo: loc.modelTextureDataLod,
            opaqueLodRanges: loc.drawRangesLod,
            opaqueLodPlanes: loc.drawRangesLodPlanes,
            alphaLodModelInfo: loc.modelTextureDataLodAlpha,
            alphaLodRanges: loc.drawRangesLodAlpha,
            alphaLodPlanes: loc.drawRangesLodAlphaPlanes,
        };
    }

    /** (Re)builds one geometry group from `mapData`, destroying the group it replaces. */
    private setGroup(kind: GeometryGroupKind, mapData: RenderMapData, prepared?: Map<ArrayBufferView, GPUBuffer>): void {
        this.destroyGroup(kind);
        if (kind === "loc") {
            this.locAnimationUpdater.clear();
            this.locRanges = undefined;
        }
        const input = WebGPUMapSquare.groupInput(kind, mapData);
        const geometry = input
            ? createPendingGeometry(
                  this.device,
                  this.resources,
                  this.heightMapTexture,
                  this.waterMaskTexture,
                  this.groundMaterialTexture,
                  input,
                  prepared,
              )
            : undefined;
        if (geometry) {
            const group: GeometryGroup = {
                buffers: [geometry.vertexBuffer, geometry.indexBuffer],
                textures: [geometry.opaqueTexture, geometry.alphaTexture],
            };
            const batches: { key: BatchKind; ranges: DrawRange[]; planes: Uint8Array | undefined;
                bindGroup: GPUBindGroup; lod: boolean }[] = [
                { key: "opaque", ranges: geometry.opaqueRanges, planes: geometry.opaquePlanes,
                    bindGroup: geometry.opaqueBindGroup, lod: false },
                { key: "alpha", ranges: geometry.alphaRanges, planes: geometry.alphaPlanes,
                    bindGroup: geometry.alphaBindGroup, lod: false },
            ];
            for (const alpha of [false, true]) {
                const ranges = (alpha ? input!.alphaLodRanges : input!.opaqueLodRanges) ?? [];
                if (ranges.length === 0) continue;
                const texture = createModelInfoTexture(this.device,
                    alpha ? input!.alphaLodModelInfo : input!.opaqueLodModelInfo);
                group.textures.push(texture);
                batches.push({
                    key: alpha ? "alphaLod" : "opaqueLod", ranges,
                    planes: alpha ? input!.alphaLodPlanes : input!.opaqueLodPlanes,
                    bindGroup: createMapTextureBindGroup(this.device, this.resources, texture,
                        this.heightMapTexture, this.waterMaskTexture, this.groundMaterialTexture),
                    lod: true,
                });
            }
            const entries = batches.reduce((sum, batch) => sum + batch.ranges.length, 0);
            if (entries > 0) {
                const arrayBuffer = new ArrayBuffer(entries * MAP_UNIFORM_STRIDE);
                const floats = new Float32Array(arrayBuffer);
                const view = new DataView(arrayBuffer);
                let entry = 0;
                for (const batch of batches) {
                    for (let i = 0; i < batch.ranges.length; i++) {
                        writeMapUniform(floats, view, entry++, i, this.renderPosX,
                            this.renderPosY, this.timeLoaded, this.borderSize);
                    }
                }
                const uniformBuffer = this.device.createBuffer({
                    size: arrayBuffer.byteLength,
                    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
                });
                this.device.queue.writeBuffer(uniformBuffer, 0, arrayBuffer);
                group.buffers.push(uniformBuffer);
                group.uniformBuffer = uniformBuffer;
                group.uniformEntries = entries;
                group.uniformData = arrayBuffer;
                const uniformsBindGroup = this.device.createBindGroup({
                    layout: this.resources.mapUniformsLayout,
                    entries: [{ binding: 0,
                        resource: { buffer: uniformBuffer, offset: 0, size: MAP_UNIFORM_USED_BYTES } }],
                });
                entry = 0;
                for (const batch of batches) {
                    if (batch.ranges.length > 0) {
                        // A missing animation bound must keep the whole batch conservative.
                        let bounds = batch.ranges[0].bounds?.slice();
                        for (const range of batch.ranges) {
                            if (!bounds || !range.bounds) { bounds = undefined; break; }
                            for (let axis = 0; axis < 3; axis++) {
                                bounds[axis] = Math.min(bounds[axis], range.bounds[axis]);
                                bounds[axis + 3] = Math.max(bounds[axis + 3], range.bounds[axis + 3]);
                            }
                        }
                        group[batch.key] = {
                            vertexBuffer: geometry.vertexBuffer, indexBuffer: geometry.indexBuffer,
                            ranges: batch.ranges, bounds, planes: batch.planes, bindGroup: batch.bindGroup,
                            uniformsBindGroup, uniformBase: entry, uniformEntries: entries, lod: batch.lod,
                        };
                    }
                    entry += batch.ranges.length;
                }
            }
            this.groups.set(kind, group);
            if (kind === "loc" && mapData.loc) {
                this.locRanges = {
                    drawCall: { drawRanges: mapData.loc.drawRanges },
                    drawCallAlpha: { drawRanges: mapData.loc.drawRangesAlpha },
                    drawCallLod: { drawRanges: mapData.loc.drawRangesLod },
                    drawCallLodAlpha: { drawRanges: mapData.loc.drawRangesLodAlpha },
                };
            }
        }
        this.opaqueBatches.length = 0;
        this.alphaBatches.length = 0;
        for (const k of GROUP_ORDER) {
            const group = this.groups.get(k);
            if (group?.opaque) this.opaqueBatches.push(group.opaque);
            if (group?.opaqueLod) this.opaqueBatches.push(group.opaqueLod);
            if (group?.alpha) this.alphaBatches.push(group.alpha);
            if (group?.alphaLod) this.alphaBatches.push(group.alphaLod);
        }
    }

    private destroyGroup(kind: GeometryGroupKind): void {
        const group = this.groups.get(kind);
        if (!group) return;
        for (const buffer of group.buffers) buffer.destroy();
        for (const texture of group.textures) texture.destroy();
        this.groups.delete(kind);
    }

    /**
     * Applies a door-only or loc-only build (SdMapData.doorOnly/locOnly) to this square: port of
     * WebGLMapSquare.refreshDoorGeometry/refreshLocGeometry. Terrain and the other group stay.
     * Callers must do this before the frame's visible list is built (see WebGPURenderer.render).
     */
    refreshPartial(mapData: SdMapData, seqTypeLoader: SeqTypeLoader, cycle: number): void {
        if (mapData.collisionDatas) this.collisionMaps = mapData.collisionDatas.map(CollisionMap.fromData);
        this.tilePresenceByLevel = mapData.tilePresenceByLevel;
        this.tileLocOffsetsByLevel = mapData.tileLocOffsetsByLevel;
        this.tileLocIdsByLevel = mapData.tileLocIdsByLevel;
        this.tileLocTypeRotByLevel = mapData.tileLocTypeRotByLevel;
        for (const listener of this.locDataChangedListeners) listener();
        if (mapData.doorOnly) {
            this.setGroup("door", mapData);
        } else {
            this.setGroup("loc", mapData);
            this.objSurfaceHeights = mapData.objSurfaceHeights;
            this.initAnimatedLocs(mapData, seqTypeLoader, cycle);
        }
    }

    /**
     * Port of WebGLMapSquare's LocAnimated setup: animated locs index the loc group's
     * (non-LOD, non-interact) draw ranges, whose every frame is baked into its buffers.
     */
    initAnimatedLocs(mapData: SdMapData, seqTypeLoader: SeqTypeLoader, cycle: number): void {
        if (!this.locRanges) return;
        const previous = this.locsAnimated;
        this.locsAnimated = mapData.locsAnimated.map(
            (loc) =>
                new LocAnimated(
                    loc.drawRangeIndex,
                    loc.drawRangeAlphaIndex,
                    loc.drawRangeLodIndex,
                    loc.drawRangeLodAlphaIndex,
                    loc.drawRangeInteractIndex,
                    loc.drawRangeInteractAlphaIndex,
                    loc.drawRangeInteractLodIndex,
                    loc.drawRangeInteractLodAlphaIndex,
                    loc.anim,
                    seqTypeLoader.load(loc.seqId),
                    cycle,
                    loc.randomStart,
                    loc.locId,
                    loc.x,
                    loc.y,
                    loc.level,
                    loc.rotation,
                ),
        );
        LocAnimated.carryOver(previous, this.locsAnimated);
    }

    /**
     * Advances animated locs (Client.cycle timing) and points their ranges at the frame (draw2.ts).
     * All passes share a pose; sounds are delivered only when the square becomes visible.
     */
    updateAnimatedLocs(seqFrameLoader: SeqFrameLoader, cycle: number, onFrameSound?: LocFrameSoundHandler): void {
        if (this.locRanges) this.locAnimationUpdater.update(
            this.locsAnimated, this.locRanges, seqFrameLoader, cycle, onFrameSound);
    }

    canRender(frameCount: number): boolean {
        return frameCount - this.frameLoaded >= FRAME_RENDER_DELAY;
    }

    getObjSurfaceHeight(level: number, tileX: number, tileY: number): number {
        return objSurfaceHeightAt(this.objSurfaceHeights, level, tileX + this.borderSize, tileY + this.borderSize);
    }

    getTileRenderFlag(level: number, tileX: number, tileY: number): number {
        const row = this.tileRenderFlags[level]?.[tileX + this.borderSize];
        return row ? row[tileY + this.borderSize] | 0 : 0;
    }

    /** Ground recipe at local tile coords (border applied internally); 0 = none. */
    getGroundMaterial(level: number, tileX: number, tileY: number): number {
        const row = this.tileGroundMaterials?.[level]?.[tileX + this.borderSize];
        return row ? row[tileY + this.borderSize] | 0 : 0;
    }

    /** Tile colour (0xRRGGBB) at local tile coords (border applied internally); 0 = none. */
    getCollisionFlag(level: number, tileX: number, tileY: number): number {
        const map = this.collisionMaps[level];
        const x = tileX + this.borderSize, y = tileY + this.borderSize;
        return map?.isWithinBounds(x, y) ? map.getFlag(x, y) : 0;
    }

    getGroundColor(level: number, tileX: number, tileY: number): number {
        const row = this.tileGroundColors?.[level]?.[tileX + this.borderSize];
        return row ? row[tileY + this.borderSize] >>> 0 : 0;
    }

    isBridgeSurface(level: number, tileX: number, tileY: number): boolean {
        const flags = this.bridgeSurfaceFlags?.[level];
        if (!flags) return false;
        const column = flags[tileX + this.borderSize];
        if (!column) return false;
        return column[tileY + this.borderSize] !== 0;
    }

    getRenderBaseTileX(): number {
        return Math.floor(this.renderPosX * Scene.MAP_SQUARE_SIZE);
    }

    getRenderBaseTileY(): number {
        return Math.floor(this.renderPosY * Scene.MAP_SQUARE_SIZE);
    }

    getRenderBaseWorldX(): number {
        return this.renderPosX * Scene.MAP_SQUARE_SIZE;
    }

    getRenderBaseWorldY(): number {
        return this.renderPosY * Scene.MAP_SQUARE_SIZE;
    }

    getLocalTileSpan(): number {
        return Math.max(0, (this.heightMapSize | 0) - (this.borderSize | 0) * 2);
    }

    /**
     * Bilinear terrain height at a world tile/plane (same math as the WebGL helper). Shared by
     * the overlay adapter and the HD light collection, which need ground heights.
     */
    sampleHeightAtExactPlane(worldX: number, worldZ: number, plane: number): number {
        const data = this.heightMapData;
        if (!data) return 0;
        const size = Math.max(1, Math.round(Math.sqrt(data.length / 4)));
        const span = this.getLocalTileSpan();
        const border = Math.max(0, Math.floor((size - span) / 2));

        const localPxX = Math.floor((worldX - this.getRenderBaseTileX()) * 128);
        const localPxZ = Math.floor((worldZ - this.getRenderBaseTileY()) * 128);
        let tileX = localPxX >> 7;
        let tileZ = localPxZ >> 7;
        if (tileX < 0 || tileZ < 0 || tileX >= span || tileZ >= span) return 0;
        tileX = Math.max(0, Math.min(span - 1, tileX));
        tileZ = Math.max(0, Math.min(span - 1, tileZ));

        const offX = localPxX & 0x7f;
        const offZ = localPxZ & 0x7f;
        const samplePlane = Math.max(0, Math.min(Scene.MAX_LEVELS - 1, plane | 0));
        const base = samplePlane * size * size;
        const ix = tileX + border;
        const iz = tileZ + border;
        const ix1 = Math.min(ix + 1, size - 1);
        const iz1 = Math.min(iz + 1, size - 1);

        const h00 = ((data[base + iz * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
        const h10 = ((data[base + iz * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
        const h01 = ((data[base + iz1 * size + ix] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;
        const h11 = ((data[base + iz1 * size + ix1] || 0) * Scene.UNITS_TILE_HEIGHT_BASIS) | 0;

        const delta0 = (h00 * (128 - offX) + h10 * offX) >> 7;
        const delta1 = (h01 * (128 - offX) + h11 * offX) >> 7;
        const hWorld = (delta0 * (128 - offZ) + delta1 * offZ) >> 7;
        return -(hWorld / 128.0);
    }

    // Returns a reusable buffer - caller must consume results before next call.
    getLocIdsAtLocal(level: number, localX: number, localY: number): number[] {
        const out = this.locIdsAtLocalBuffer;
        out.length = 0;
        try {
            if (!this.tileLocOffsetsByLevel || !this.tileLocIdsByLevel) return out;
            if (level < 0 || level >= this.tileLocOffsetsByLevel.length) return out;
            const span = this.getLocalTileSpan();
            if (localX < 0 || localY < 0 || localX >= span || localY >= span) return out;
            const offsets = this.tileLocOffsetsByLevel[level];
            const ids = this.tileLocIdsByLevel[level];
            const idx = (localY | 0) * span + (localX | 0);
            const start = offsets[idx] | 0;
            const end = offsets[idx + 1] | 0;
            if (end <= start) return out;
            const count = end - start;
            for (let i = start, j = 0; j < count; i++, j++) {
                out[j] = ids[i] | 0;
            }
            out.length = count;
            return out;
        } catch {
            out.length = 0;
            return out;
        }
    }

    // Packed loc modelType (bits 0..5) / rotation (bits 6..7), parallel to getLocIdsAtLocal.
    getLocTypeRotsAtLocal(level: number, localX: number, localY: number): number[] {
        const out = this.locTypeRotsAtLocalBuffer;
        out.length = 0;
        try {
            if (
                !this.tileLocOffsetsByLevel ||
                !this.tileLocIdsByLevel ||
                !this.tileLocTypeRotByLevel
            ) {
                return out;
            }
            if (level < 0 || level >= this.tileLocOffsetsByLevel.length) return out;
            const span = this.getLocalTileSpan();
            if (localX < 0 || localY < 0 || localX >= span || localY >= span) return out;
            const offsets = this.tileLocOffsetsByLevel[level];
            const ids = this.tileLocIdsByLevel[level];
            const typeRots = this.tileLocTypeRotByLevel[level];
            const idx = (localY | 0) * span + (localX | 0);
            const start = offsets[idx] | 0;
            const end = offsets[idx + 1] | 0;
            if (end <= start) return out;
            const count = end - start;
            if (ids.length < end || typeRots.length < end) return out;
            for (let i = start, j = 0; j < count; i++, j++) {
                out[j] = typeRots[i] | 0;
            }
            out.length = count;
            return out;
        } catch {
            out.length = 0;
            return out;
        }
    }

    /**
     * Writes this deck map's view-space placement matrix (WorldEntityAnimator.getTransform)
     * into every MapUniforms entry and flags the draw as a world entity, matching the WebGL
     * u_worldEntityTransform/u_isWorldEntity uniforms. Normal maps never call it.
     */
    setWorldEntityTransform(transform: Float32Array | undefined): void {
        if (!transform) return;
        if (this.transformCount !== 1) { this.setWorldEntityTransforms([transform]); return; }
        this.worldEntity = true;
        for (const group of this.groups.values()) {
            const buffer = group.uniformBuffer;
            const entries = group.uniformEntries ?? 0;
            if (!buffer || entries <= 0) continue;
            for (let i = 0; i < entries; i++) {
                const offset = i * MAP_UNIFORM_STRIDE;
                this.device.queue.writeBuffer(
                    buffer,
                    offset,
                    transform.buffer,
                    transform.byteOffset,
                    64,
                );
                this.device.queue.writeBuffer(
                    buffer,
                    offset + MAP_UNIFORM_TRANSFORM_OFFSET,
                    WORLD_ENTITY_ENABLED,
                );
            }
        }
    }

    /** Draw one cached model at several placements, with a separate uniform slot per copy. */
    setWorldEntityTransforms(transforms: readonly Float32Array[]): void {
        this.worldEntity = true;
        const count = transforms.length;
        if (count === 0) { this.transformCount = 0; return; }
        for (const group of this.groups.values()) {
            const base = group.uniformData;
            const entries = group.uniformEntries ?? 0;
            if (!base || !entries) continue;
            if (count !== this.transformCount) {
                const old = group.uniformBuffer!;
                const buffer = this.device.createBuffer({ size: base.byteLength * count,
                    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST });
                group.buffers[group.buffers.indexOf(old)] = buffer;
                group.uniformBuffer = buffer;
                old.destroy();
                const bindGroup = this.device.createBindGroup({ layout: this.resources.mapUniformsLayout,
                    entries: [{ binding: 0, resource: { buffer, offset: 0, size: MAP_UNIFORM_USED_BYTES } }] });
                for (const batch of [group.opaque, group.alpha, group.opaqueLod, group.alphaLod]) {
                    if (batch) batch.uniformsBindGroup = bindGroup;
                }
            }
            const data = new Uint8Array(base.byteLength * count);
            const floats = new Float32Array(data.buffer);
            for (let copy = 0; copy < transforms.length; copy++) {
                data.set(new Uint8Array(base), copy * base.byteLength);
                for (let i = 0; i < entries; i++) {
                    const offset = (copy * entries + i) * MAP_UNIFORM_STRIDE;
                    floats.set(transforms[copy], offset / 4);
                    data.set(new Uint8Array(WORLD_ENTITY_ENABLED.buffer), offset + MAP_UNIFORM_TRANSFORM_OFFSET);
                }
            }
            this.device.queue.writeBuffer(group.uniformBuffer!, 0, data);
        }
        this.transformCount = count;
    }

    drawOpaque(pass: GPURenderPassEncoder, roofPlaneLimit: number, visibility: SceneryDrawContext): void {
        this.drawBatches(pass, this.opaqueBatches, roofPlaneLimit, false, visibility);
    }

    drawAlpha(pass: GPURenderPassEncoder, roofPlaneLimit: number, visibility: SceneryDrawContext): void {
        this.drawBatches(pass, this.alphaBatches, roofPlaneLimit, true, visibility);
    }

    /**
     * Scene-extension depth pass: opaque then alpha ranges, the WebGL draw order of
     * renderOpaquePass()/renderTransparentPass(), with the extension's depth pipelines.
     */
    drawDepth(pass: GPURenderPassEncoder, roofPlaneLimit: number, visibility: SceneryDrawContext): void {
        this.drawBatches(pass, this.opaqueBatches, roofPlaneLimit, false, visibility, true);
        this.drawBatches(pass, this.alphaBatches, roofPlaneLimit, true, visibility, true);
    }

    /** Whether any of its locs is drawn below the floor (SunkenLocs). */
    hasSunkenLocs(): boolean {
        return !this.worldEntity && hasSunkenLocs(this.locsAnimated);
    }

    /**
     * SunkenLocs, after the opaque scene: `punch` resets the depth under their opaque and alpha
     * faces (the caller sets the viewport's depth to 1), otherwise their opaque faces again.
     */
    drawSunkenLocs(pass: GPURenderPassEncoder, punch: boolean, roofPlaneLimit: number, visibility: SceneryDrawContext): void {
        const group = this.groups.get("loc");
        if (!group || this.worldEntity) return;
        const resources = this.resources;
        const baseX = this.getRenderBaseTileX(), baseZ = this.getRenderBaseTileY();
        for (const alpha of punch ? [false, true] : [false]) {
            const batch = alpha ? group.alpha : group.opaque;
            if (!batch) continue;
            const indices = sunkenRangeIndices(this.locsAnimated, alpha).filter((i) => {
                const range = batch.ranges[i];
                return !!range && range[1] > 0 && range[2] > 0 &&
                    !(roofPlaneLimit < 3 && batch.planes && i < batch.planes.length && batch.planes[i] > roofPlaneLimit) &&
                    sceneryRangeVisible(range, baseX, baseZ, visibility.tileX, visibility.tileZ, visibility.distance,
                        visibility.lodDistance, false, visibility.camera, visibility.shadow);
            });
            if (indices.length === 0) continue;
            pass.setPipeline(punch ? resources.punchPipelines[alpha ? 1 : 0] : resources.opaquePipeline);
            pass.setBindGroup(SCENE_GROUP, resources.sceneBindGroup);
            pass.setBindGroup(WORLD_TEXTURES_GROUP, resources.mapWorldTextureBindGroup);
            pass.setBindGroup(MAP_TEXTURES_GROUP, batch.bindGroup);
            pass.setVertexBuffer(0, batch.vertexBuffer);
            pass.setIndexBuffer(batch.indexBuffer, "uint32");
            for (const i of indices) {
                const range = batch.ranges[i];
                pass.setBindGroup(MAP_UNIFORMS_GROUP, batch.uniformsBindGroup, [(batch.uniformBase + i) * MAP_UNIFORM_STRIDE]);
                pass.drawIndexed(range[1] | 0, range[2] | 0, (range[0] / DRAW_RANGE_INDEX_BYTES) | 0, 0, 0);
            }
        }
    }

    delete(): void {
        for (const kind of GROUP_ORDER) this.destroyGroup(kind);
        this.heightMapTexture.destroy();
        this.waterMaskTexture.destroy();
        this.groundMaterialTexture.destroy();
        this.opaqueBatches.length = 0;
        this.alphaBatches.length = 0;
    }

    private drawBatches(
        pass: GPURenderPassEncoder,
        batches: MapDrawBatch[],
        roofPlaneLimit: number,
        alpha: boolean,
        visibility: SceneryDrawContext,
        depth: boolean = false,
    ): void {
        if (batches.length === 0) return;

        const resources = this.resources;
        const depthPipelines = resources.depthPipelines;
        if (depth && (!depthPipelines || !resources.depthTextureBindGroup)) return;
        const pipeline = depth ? depthPipelines![alpha ? 1 : 0]
            : alpha ? resources.alphaPipeline : resources.opaquePipeline;
        const worldTextures = depth ? resources.depthTextureBindGroup! : resources.mapWorldTextureBindGroup;

        const cullPlanes = roofPlaneLimit < 3;
        const cullLimit = roofPlaneLimit | 0;

        const baseX = this.getRenderBaseTileX(), baseZ = this.getRenderBaseTileY();
        for (const batch of batches) {
            if (batch.lod && (depth || this.worldEntity)) continue;
            if (!this.worldEntity && batch.bounds && !sceneryBoundsVisible(batch.bounds, baseX, baseZ,
                visibility.tileX, visibility.tileZ, visibility.distance, visibility.camera, visibility.shadow)) continue;
            batch.bundles ??= [[], []];
            const bundles = batch.bundles[depth ? 1 : 0];
            for (const bundle of bundles) if (bundle) bundle.commands.length = 0;
            const planes = batch.planes;
            const visible = (i: number): boolean => {
                const range = batch.ranges[i];
                return !!range && range[1] > 0 && range[2] > 0 &&
                    !(cullPlanes && planes && i < planes.length && planes[i] > cullLimit) &&
                    (this.worldEntity || sceneryRangeVisible(range, baseX, baseZ,
                        visibility.tileX, visibility.tileZ, visibility.distance, visibility.lodDistance,
                        batch.lod, visibility.camera, visibility.shadow));
            };
            for (let i = 0; i < batch.ranges.length; i++) {
                if (!visible(i)) continue;
                const range = batch.ranges[i];
                let elements = range[1] | 0;
                const instances = range[2] | 0;
                const first = i;
                // Identical terrain instance data can share the first range's drawId, as on WebGL.
                if (range.batchKey !== undefined && instances === 1) {
                    while (i + 1 < batch.ranges.length && ((i + 1) >>> 5) === (first >>> 5)) {
                        const next = batch.ranges[i + 1];
                        if (!next || next.batchKey !== range.batchKey || next[2] !== 1 ||
                            next[0] !== range[0] + elements * DRAW_RANGE_INDEX_BYTES || !visible(i + 1)) break;
                        elements += next[1];
                        i++;
                    }
                }
                // One animated loc must not invalidate the rest of a large scenery batch.
                const commands = (bundles[first >>> 5] ??= new SceneryDrawBundle()).commands;
                for (let copy = 0; copy < this.transformCount; copy++) {
                    commands.push(
                        (copy * batch.uniformEntries + batch.uniformBase + first) * MAP_UNIFORM_STRIDE,
                        elements, instances, (range[0] / DRAW_RANGE_INDEX_BYTES) | 0,
                    );
                }
            }
            for (const bundle of bundles) {
                if (!bundle || bundle.commands.length === 0) continue;
                const commands = bundle.commands;
                const bindings = [resources.sceneBindGroup, worldTextures, batch.bindGroup, batch.uniformsBindGroup];
                bundle.draw(this.device, pass, pipeline, bindings, {
                    colorFormats: depth ? [] : [resources.extensionActive
                        ? resources.extension?.sceneColorFormat ?? resources.canvasFormat : resources.canvasFormat],
                    depthStencilFormat: depth ? resources.extension?.depthFormat ?? SCENE_DEPTH_FORMAT : SCENE_DEPTH_FORMAT,
                    sampleCount: depth ? 1 : resources.sampleCount,
                }, (encoder) => {
                    encoder.setPipeline(pipeline);
                    encoder.setBindGroup(SCENE_GROUP, bindings[0]);
                    encoder.setBindGroup(WORLD_TEXTURES_GROUP, bindings[1]);
                    encoder.setBindGroup(MAP_TEXTURES_GROUP, bindings[2]);
                    encoder.setVertexBuffer(0, batch.vertexBuffer);
                    encoder.setIndexBuffer(batch.indexBuffer, "uint32");
                    for (let i = 0; i < commands.length; i += 4) {
                        encoder.setBindGroup(MAP_UNIFORMS_GROUP, bindings[3], [commands[i]]);
                        encoder.drawIndexed(commands[i + 1], commands[i + 2], commands[i + 3], 0, 0);
                    }
                });
            }
        }
    }
}
