import { CacheIndex } from "../cache/CacheIndex";
import { Bzip2 } from "../compression/Bzip2";
import { Gzip } from "../compression/Gzip";
import { ByteBuffer } from "../io/ByteBuffer";
import { MapFileIndex } from "./MapFileIndex";

export type XteaMap = Map<number, number[]>;
export type MapRegionReplacement = { terrainData: Int8Array; objectData?: Int8Array };

export class MapFileLoader {
    private regionReplacements: Map<number, MapRegionReplacement> = new Map();

    constructor(
        readonly mapIndex: CacheIndex,
        readonly mapFileIndex: MapFileIndex,
    ) {}

    setRegionReplacements(replacements?: Map<number, MapRegionReplacement>): void {
        this.regionReplacements = new Map(
            [...(replacements ?? new Map())].map(([regionId, replacement]) => [
                regionId,
                {
                    ...replacement,
                    terrainData: (replacement.terrainData[0] & 0xff) === 0x1f &&
                        (replacement.terrainData[1] & 0xff) === 0x8b
                        ? Gzip.decompress(replacement.terrainData)
                        : replacement.terrainData,
                },
            ]),
        );
    }

    getTerrainData(mapX: number, mapY: number, xteasMap?: XteaMap): Int8Array | undefined {
        const replacement = this.regionReplacements.get((mapX << 8) | mapY);
        if (replacement) return replacement.terrainData;
        const archiveId = this.mapFileIndex.getTerrainArchiveId(mapX, mapY);
        if (archiveId === -1) {
            return undefined;
        }
        const fileId = this.mapFileIndex.getTerrainFileId(mapX, mapY);
        const key = xteasMap?.get(archiveId);
        try {
            const file = this.mapIndex.getFile(archiveId, fileId, key);
            return file?.data;
        } catch (e) {
            return undefined;
        }
    }

    getLocData(mapX: number, mapY: number, xteasMap: XteaMap): Int8Array | undefined {
        const replacement = this.regionReplacements.get((mapX << 8) | mapY);
        if (replacement) return replacement.objectData;
        const archiveId = this.mapFileIndex.getLocArchiveId(mapX, mapY);
        if (archiveId === -1) {
            return undefined;
        }
        const fileId = this.mapFileIndex.getLocFileId(mapX, mapY);
        const key = xteasMap.get(archiveId);
        try {
            const file = this.mapIndex.getFile(archiveId, fileId, key);
            return file?.data;
        } catch (e) {
            return undefined;
        }
    }
}

export class LegacyMapFileLoader extends MapFileLoader {
    decompress(data: Int8Array): Int8Array {
        const buffer = new ByteBuffer(data);
        const actualSize = buffer.readInt();
        const compressed = buffer.readUnsignedBytes(buffer.remaining);
        const decompressed = Bzip2.decompress(compressed, actualSize);
        return decompressed;
    }

    override getTerrainData(mapX: number, mapY: number, xteasMap?: XteaMap): Int8Array | undefined {
        const data = super.getTerrainData(mapX, mapY, xteasMap);
        if (!data) {
            return undefined;
        }
        try {
            return this.decompress(data);
        } catch (e) {
            console.error("Failed decompressing terrain data", mapX, mapY, data.length, e);
            return undefined;
        }
    }

    override getLocData(mapX: number, mapY: number, xteasMap: XteaMap): Int8Array | undefined {
        const data = super.getLocData(mapX, mapY, xteasMap);
        if (!data) {
            return undefined;
        }
        try {
            return this.decompress(data);
        } catch (e) {
            console.error("Failed decompressing loc data", mapX, mapY, data.length, data, e);
            return undefined;
        }
    }
}
