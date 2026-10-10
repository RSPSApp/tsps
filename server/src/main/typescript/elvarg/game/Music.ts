import * as fs from "fs";
import * as path from "path";
import { CacheDefinitions } from "./cache/CacheDefinitions";

type MusicData = {
    regions: Record<number, number[]>;
    trackNames: Record<number, string>;
};

type CachedTrack = {
    rowId: number;
    id: number;
    name: string;
    unlockBank?: number;
    unlockBit?: number;
    autoUnlock: boolean;
    parentRowId?: number;
};

const MUSIC_DATA: MusicData = (() => {
    try {
        return JSON.parse(fs.readFileSync(path.resolve("data/definitions/music-data.json"), "utf8"));
    } catch (error) {
        console.warn("[music] failed to load region music", error);
        return { regions: {}, trackNames: {} };
    }
})();

export class Music {
    private static tracksCache?: CachedTrack[];

    private static cachedTracks(): CachedTrack[] {
        if (this.tracksCache) return this.tracksCache;
        const rows = CacheDefinitions.getDbTableRows(44);
        if (rows.length === 0) return [];
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        return this.tracksCache = rows.flatMap((row) => {
            const id = row.int(4, -1);
            const name = row.string(1) || row.string(0);
            if (id < 0 || !name) return [];
            let slot = row.column(5);
            const parentRowId = row.int(12, -1);
            if (slot.length < 2 && parentRowId >= 0) {
                slot = rowsById.get(parentRowId)?.column(5) ?? [];
            }
            return [{
                rowId: row.id,
                id,
                name,
                ...(slot.length >= 2 ? { unlockBank: Number(slot[0]), unlockBit: Number(slot[1]) } : {}),
                autoUnlock: row.int(6) === 1,
                ...(parentRowId >= 0 ? { parentRowId } : {}),
            }];
        });
    }

    public static tracks(): CachedTrack[] {
        return this.cachedTracks();
    }

    public static trackNames(): Record<number, string> {
        const tracks = this.cachedTracks();
        if (tracks.length > 0) {
            return Object.fromEntries(tracks.map(({ id, name }) => [id, name]));
        }
        return MUSIC_DATA.trackNames;
    }

    public static forRegion(regionId: number): number | undefined {
        return MUSIC_DATA.regions[regionId]?.[0];
    }

    public static forInstanceLocation(area: any, x: number, y: number, plane: number): number | undefined {
        const region = this.regionForInstanceLocation(area, x, y, plane);
        return region === undefined ? undefined : this.forRegion(region);
    }

    public static regionForInstanceLocation(area: any, x: number, y: number, plane: number): number | undefined {
        if (typeof area?.getBaseX !== "function" || typeof area?.getChunk !== "function") return undefined;
        const chunk = area.getChunk(plane, (x - area.getBaseX()) >> 3, (y - area.getBaseY()) >> 3);
        if (!chunk) return undefined;
        return ((chunk.sourceChunkX >> 3) << 8) | (chunk.sourceChunkY >> 3);
    }
}
