import { Buffer } from './Buffer';
import { CacheMaps } from '../cache/CacheMaps';
import { CachePipeline } from '../cache/CachePipeline';

/** A loc as the cache map file stores it: region-local tile, its own plane, before bridges. */
export interface TemplateLoc {
    id: number;
    localX: number;
    localY: number;
    plane: number;
    type: number;
    face: number;
}

/** What a templated instance copies from a cache region: tile settings and locs. */
export interface TemplateRegion {
    /** Tile settings (`1` blocked, `2` bridge, `4` under roof) at `(plane << 12) | (x << 6) | y`. */
    settings: Uint8Array;
    /** Locs grouped by 8x8 chunk, at `(plane << 6) | (chunkX << 3) | chunkY` within the region. */
    chunks: TemplateLoc[][];
}

const regions = new Map<number, TemplateRegion | null>();

export function templateChunkKey(plane: number, chunkX: number, chunkY: number): number {
    return (plane << 6) | ((chunkX & 7) << 3) | (chunkY & 7);
}

/** Decodes (once) the cache map files of a region that instances use as templates. */
export function getTemplateRegion(regionId: number): TemplateRegion | null {
    if (regions.has(regionId)) return regions.get(regionId)!;
    const data = CacheMaps.getRegion(regionId);
    const region = data?.terrainData ? decode(data.terrainData, data.objectData) : null;
    regions.set(regionId, region);
    return region;
}

function decode(terrain: Uint8Array, objects: Uint8Array | undefined): TemplateRegion {
    const settings = new Uint8Array(4 * 64 * 64);
    const ground = new Buffer(terrain);
    const newTerrainFormat = CachePipeline.getActive().revision >= 209;
    for (let z = 0; z < 4; z++) {
        for (let x = 0; x < 64; x++) {
            for (let y = 0; y < 64; y++) {
                while (true) {
                    const opcode = newTerrainFormat ? ground.readUShort() : ground.readUnsignedByte();
                    if (opcode === 0) break;
                    if (opcode === 1) {
                        ground.readUnsignedByte();
                        break;
                    }
                    if (opcode <= 49) {
                        if (newTerrainFormat) ground.readUShort();
                        else ground.readUnsignedByte();
                    } else if (opcode <= 81) {
                        settings[(z << 12) | (x << 6) | y] = opcode - 49;
                    }
                }
            }
        }
    }

    const chunks: TemplateLoc[][] = Array.from({ length: 4 * 64 }, () => []);
    if (objects) {
        const stream = new Buffer(objects);
        let id = -1;
        let idDelta: number;
        while ((idDelta = stream.readSmart()) !== 0) {
            id += idDelta;
            let packed = 0;
            let packedDelta: number;
            while ((packedDelta = stream.getUSmart()) !== 0) {
                packed += packedDelta - 1;
                const attributes = stream.readUnsignedByte();
                const loc: TemplateLoc = {
                    id,
                    localX: (packed >> 6) & 0x3f,
                    localY: packed & 0x3f,
                    plane: (packed >> 12) & 3,
                    type: attributes >> 2,
                    face: attributes & 3,
                };
                chunks[templateChunkKey(loc.plane, loc.localX >> 3, loc.localY >> 3)].push(loc);
            }
        }
    }
    return { settings, chunks };
}
