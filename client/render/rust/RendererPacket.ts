import type { DrawRange } from "../DrawRange";
import type { LocGeometryData, SdMapData } from "../loader/SdMapData";

/**
 * Version of the TS -> Rust renderer packet ABI.
 *
 * Keep this synchronized with RENDERER_ABI_VERSION in rust-renderer/src/lib.rs.
 */
export const RUST_RENDERER_ABI_VERSION = 1;

export type RustGeometryPacket = {
    packedVertices: Uint32Array;
    indices: Uint32Array;
    drawRanges: Uint32Array;
    drawRangePlanes?: Uint8Array;
};

export type RustStaticMapPacket = {
    abiVersion: number;
    mapX: number;
    mapY: number;
    renderMapX: number;
    renderMapY: number;
    borderSize: number;
    heightMapSize: number;
    terrainOpaque: RustGeometryPacket;
    terrainAlpha: RustGeometryPacket;
    locOpaque: RustGeometryPacket;
    locAlpha: RustGeometryPacket;
    heightMap: Int16Array;
    waterMask: Uint8Array;
};

/**
 * Reinterprets the current 12-byte packed TS vertex stream as the three-u32
 * words consumed by Rust. No semantic repacking occurs.
 */
export function packedVertexWords(vertices: Uint8Array): Uint32Array {
    if (vertices.byteLength % 12 !== 0) {
        throw new Error(
            `Rust renderer vertex packet must be a multiple of 12 bytes; got ${vertices.byteLength}`,
        );
    }

    // Web workers normally transfer these at offset zero. Preserve correctness
    // for sliced views as well, including a rare unaligned byteOffset.
    if ((vertices.byteOffset & 3) === 0) {
        return new Uint32Array(vertices.buffer, vertices.byteOffset, vertices.byteLength / 4);
    }

    const copy = new Uint8Array(vertices.byteLength);
    copy.set(vertices);
    return new Uint32Array(copy.buffer);
}

/**
 * Indices are built as Int32Array in the TS scene compiler but are semantically
 * unsigned element indices. The ABI exposes their identical bits as u32.
 */
export function unsignedIndices(indices: Int32Array): Uint32Array {
    if ((indices.byteOffset & 3) === 0) {
        return new Uint32Array(indices.buffer, indices.byteOffset, indices.length);
    }

    const copy = new Int32Array(indices);
    return new Uint32Array(copy.buffer);
}

/** Flattens [offsetBytes,elements,instances] without JS object graphs. */
export function flattenDrawRanges(ranges: readonly DrawRange[]): Uint32Array {
    const packet = new Uint32Array(ranges.length * 3);
    let write = 0;
    for (const range of ranges) {
        const offset = range[0];
        const elements = range[1];
        const instances = range[2];
        if (offset < 0 || elements < 0 || instances < 0) {
            throw new Error("Rust renderer draw ranges cannot contain negative values");
        }
        packet[write++] = offset >>> 0;
        packet[write++] = elements >>> 0;
        packet[write++] = instances >>> 0;
    }
    return packet;
}

function geometry(
    vertices: Uint8Array,
    indices: Int32Array,
    ranges: readonly DrawRange[],
    planes?: Uint8Array,
): RustGeometryPacket {
    if (planes && planes.length !== ranges.length) {
        throw new Error(
            `Rust renderer range-plane count mismatch: ${ranges.length} ranges, ${planes.length} planes`,
        );
    }
    return {
        packedVertices: packedVertexWords(vertices),
        indices: unsignedIndices(indices),
        drawRanges: flattenDrawRanges(ranges),
        drawRangePlanes: planes,
    };
}

/**
 * Builds the first stable Rust static-scene packet from the existing worker
 * result. It intentionally references TypedArray storage rather than copying
 * it; wasm-bindgen may copy into WASM during Stage 0, then a later shared WASM
 * allocation can remove that final transfer without changing this contract.
 */
export function buildRustStaticMapPacket(data: SdMapData): RustStaticMapPacket {
    return {
        abiVersion: RUST_RENDERER_ABI_VERSION,
        mapX: data.mapX | 0,
        mapY: data.mapY | 0,
        renderMapX: (data.renderPosX ?? data.mapX) | 0,
        renderMapY: (data.renderPosY ?? data.mapY) | 0,
        borderSize: data.borderSize | 0,
        heightMapSize: data.heightMapSize | 0,
        terrainOpaque: geometry(
            data.vertices,
            data.indices,
            data.drawRanges,
            data.drawRangesPlanes,
        ),
        terrainAlpha: geometry(
            data.vertices,
            data.indices,
            data.drawRangesAlpha,
            data.drawRangesAlphaPlanes,
        ),
        locOpaque: locGeometry(data.loc, false),
        locAlpha: locGeometry(data.loc, true),
        heightMap: data.heightMapTextureData,
        waterMask: data.waterMaskTextureData,
    };
}

function locGeometry(data: LocGeometryData, alpha: boolean): RustGeometryPacket {
    return geometry(
        data.vertices,
        data.indices,
        alpha ? data.drawRangesAlpha : data.drawRanges,
        alpha ? data.drawRangesAlphaPlanes : data.drawRangesPlanes,
    );
}
