import type { DrawRange } from "../DrawRange";
import type { LocGeometryData, SdMapData } from "./SdMapData";

/** Retain only vertices and indices addressed by the far draw lists. Offsets are byte offsets. */
export function compactFarGeometry(vertices: Uint8Array, indices: Int32Array,
    lists: readonly DrawRange[][], stride = 12): { vertices: Uint8Array; indices: Int32Array; ranges: DrawRange[][] } {
    const sourceVertices: number[] = [], packedIndices: number[] = [];
    const remap = new Map<number, number>();
    const ranges = lists.map(list => list.map(range => {
        const next = Object.assign([packedIndices.length * 4, range[1], range[2]], range) as DrawRange;
        next[0] = packedIndices.length * 4;
        for (let i = range[0] / 4; i < range[0] / 4 + range[1]; i++) {
            const source = indices[i];
            let target = remap.get(source);
            if (target === undefined) {
                target = sourceVertices.length;
                remap.set(source, target);
                sourceVertices.push(source);
            }
            packedIndices.push(target);
        }
        return next;
    }));
    const packedVertices = new Uint8Array(sourceVertices.length * stride);
    sourceVertices.forEach((source, target) => packedVertices.set(vertices.subarray(source * stride, (source + 1) * stride), target * stride));
    return { vertices: packedVertices, indices: new Int32Array(packedIndices), ranges };
}

function compactGroup(group: LocGeometryData): void {
    const packed = compactFarGeometry(group.vertices, group.indices, [group.drawRangesLod, group.drawRangesLodAlpha]);
    group.vertices = packed.vertices;
    group.indices = packed.indices;
    group.drawRanges = group.drawRangesLod = packed.ranges[0];
    group.drawRangesAlpha = group.drawRangesLodAlpha = packed.ranges[1];
    group.modelTextureData = group.modelTextureDataLod;
    group.modelTextureDataAlpha = group.modelTextureDataLodAlpha;
    group.drawRangesPlanes = group.drawRangesLodPlanes;
    group.drawRangesAlphaPlanes = group.drawRangesLodAlphaPlanes;
    group.drawRangesInteract = group.drawRangesInteractAlpha = group.drawRangesInteractLod = group.drawRangesInteractLodAlpha = [];
    group.modelTextureDataInteract = group.modelTextureDataInteractAlpha = group.modelTextureDataInteractLod = group.modelTextureDataInteractLodAlpha = new Uint16Array(64);
}

/** Far squares keep ground/height metadata, but no full meshes, animation frames or pick meshes. */
export function compactFarMap(data: SdMapData): SdMapData {
    const terrain = { ...data } as unknown as LocGeometryData;
    compactGroup(terrain);
    for (const key of ["vertices", "indices", "drawRanges", "drawRangesAlpha", "drawRangesLod", "drawRangesLodAlpha",
        "modelTextureData", "modelTextureDataAlpha", "modelTextureDataLod", "modelTextureDataLodAlpha",
        "drawRangesPlanes", "drawRangesAlphaPlanes", "drawRangesLodPlanes", "drawRangesLodAlphaPlanes",
        "drawRangesInteract", "drawRangesInteractAlpha", "drawRangesInteractLod", "drawRangesInteractLodAlpha",
        "modelTextureDataInteract", "modelTextureDataInteractAlpha", "modelTextureDataInteractLod", "modelTextureDataInteractLodAlpha"] as const) {
        (data as unknown as Record<string, unknown>)[key] = terrain[key];
    }
    compactGroup(data.loc);
    // Doors and their animations are foreground detail. The static horizon cannot promise their live state.
    data.doorVertices = new Uint8Array(0); data.doorIndices = new Int32Array(0);
    for (const key of Object.keys(data)) {
        if (key.startsWith("doorDrawRanges")) (data as unknown as Record<string, unknown>)[key] = key.endsWith("Planes") ? new Uint8Array(0) : [];
        if (key.startsWith("doorModelTextureData")) (data as unknown as Record<string, unknown>)[key] = new Uint16Array(64);
    }
    data.farOnly = true;
    data.objSurfaceHeights = undefined;
    data.tileLocOffsetsByLevel = []; data.tileLocIdsByLevel = []; data.tileLocTypeRotByLevel = [];
    data.locsAnimated = []; data.npcs = [];
    data.npcVertices = new Uint8Array(0); data.npcIndices = new Int32Array(0);
    data.terrainPickTileOffsets = new Uint32Array(0);
    data.terrainPickVertices = new Float32Array(0);
    data.terrainPickPlanes = new Uint8Array(0);
    data.minimapBlobs = []; data.minimapIcons = []; data.worldMapIcons = [];
    return data;
}

/** Deduplicate aliased far/full arrays when transferring ownership out of a worker. */
export function mapTransferables(data: SdMapData): ArrayBuffer[] {
    const buffers = new Set<ArrayBuffer>();
    const seen = new Set<object>();
    const visit = (value: unknown): void => {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer); }
        else if (value instanceof Map) for (const entry of value.values()) visit(entry);
        else if (Array.isArray(value)) value.forEach(visit);
        else for (const entry of Object.values(value)) visit(entry);
    };
    visit(data);
    return [...buffers];
}
