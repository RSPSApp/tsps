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
    /** The in-game unlock hint, column 2: "in Varrock.", "during the Dragon Slayer II quest.". */
    unlockHint?: string;
    /** How long the track plays, in game ticks (column 3). */
    lengthTicks?: number;
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
    /** The silent track. */
    public static readonly SILENCE_TRACK = 147;
    /** Native varp holding the playing track's DB row, -1 between tracks. */
    public static readonly CURRENT_TRACK_VARP = 3883;
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
            const unlockHint = row.string(2);
            const lengthTicks = row.int(3, -1);
            return [{
                rowId: row.id,
                id,
                name,
                ...(slot.length >= 2 ? { unlockBank: Number(slot[0]), unlockBit: Number(slot[1]) } : {}),
                autoUnlock: row.int(6) === 1,
                ...(parentRowId >= 0 ? { parentRowId } : {}),
                ...(unlockHint ? { unlockHint } : {}),
                ...(lengthTicks > 0 ? { lengthTicks } : {}),
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

    /** The first of the region's area tracks. */
    public static forRegion(regionId: number): number | undefined {
        return MUSIC_DATA.regions[regionId]?.[0];
    }

    /** Every track that plays in the region's music area; the area shuffles between them. */
    public static tracksForRegion(regionId: number): number[] {
        return [...(MUSIC_DATA.regions[regionId] ?? [])];
    }

    /** How many ticks the track plays for, or undefined when the cache has no length. */
    public static lengthTicks(trackId: number): number | undefined {
        return this.cachedTracks().find(({ id }) => id === trackId)?.lengthTicks;
    }

    /**
     * A random track of the area. When one has just finished, the next is another of the area's
     * tracks; an area with one track plays it again.
     */
    public static pickAreaTrack(tracks: readonly number[], previous = -1, random: () => number = Math.random): number | undefined {
        const choices = tracks.length > 1 ? tracks.filter((track) => track !== previous) : tracks;
        return choices.length === 0 ? undefined : choices[Math.floor(random() * choices.length) % choices.length];
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
