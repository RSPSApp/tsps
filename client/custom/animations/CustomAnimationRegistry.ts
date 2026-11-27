import { decodeArchivedType } from "../../rs/config/ArchivedTypeLoader";
import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { Type } from "../../rs/config/Type";
import type { TypeConstructor, TypeLoader } from "../../rs/config/TypeLoader";

/**
 * Custom animations and graphics from the server (`customAnimations` dataset, from
 * the cache editor's animation and graphic assets). An animation is a sequence definition plus its
 * frames, in a frame group of its own; a graphic is a spot animation definition plus its model.
 * Definitions are in the cache's own encoding. Frames use the cache's frame maps, or frame maps of
 * the animation's own (`framemaps`, id -> bytes), which the cache doesn't have.
 */
export type CustomAnimationRow =
    | {
        kind: "seq"; id: number; name: string; data: string; group: number; frames: Record<string, string>;
        framemaps?: Record<string, string>;
    }
    | { kind: "spotanim"; id: number; name: string; data: string; model?: { id: number; data: string } }
    /** Clears every animation and graphic: the first row of the set the server sends at login. */
    | { kind: "reset" };

const seqs = new Map<number, string>();
const spotanims = new Map<number, string>();
const frameGroups = new Map<number, Map<number, Int8Array>>();
const frameMaps = new Map<number, Int8Array>();
const models = new Map<number, Int8Array>();
/** The registered rows by kind and id, to send the render workers again (rows()). */
const registered = new Map<string, CustomAnimationRow>();

function bytes(base64: string): Int8Array {
    const decoded = atob(base64);
    return Int8Array.from(decoded, (byte) => byte.charCodeAt(0));
}

function validId(id: unknown, max: number): id is number {
    return Number.isInteger(id) && (id as number) >= 0 && (id as number) <= max;
}

export const CustomAnimationRegistry = {
    revision: 0,
    /**
     * One animation or graphic. A "reset" row (or an empty dataset, from older servers) clears them
     * all: the server sends the whole set in one dataset, starting with a reset.
     */
    register(row: CustomAnimationRow): void {
        if (row?.kind === "reset") {
            this.clear();
            return;
        }
        if (!row || typeof row.data !== "string" || !validId(row.id, 0xfffe)) throw new Error("Invalid custom animation");
        if (row.kind === "seq") {
            // Frame ids are group << 16 | file in a signed int: groups stay below 32768.
            if (!validId(row.group, 0x7fff) || !row.frames || typeof row.frames !== "object") throw new Error("Invalid custom animation frames");
            const files = new Map<number, Int8Array>();
            for (const [file, data] of Object.entries(row.frames)) files.set(Number(file), bytes(data));
            // A frame names its frame map in a u16.
            const maps = new Map<number, Int8Array>();
            if (row.framemaps !== undefined) {
                if (!row.framemaps || typeof row.framemaps !== "object") throw new Error("Invalid custom frame maps");
                for (const [id, data] of Object.entries(row.framemaps)) {
                    if (!/^\d+$/.test(id) || !validId(Number(id), 0xffff) || typeof data !== "string") throw new Error("Invalid custom frame map");
                    maps.set(Number(id), bytes(data));
                }
            }
            seqs.set(row.id, row.data);
            frameGroups.set(row.group, files);
            for (const [id, data] of maps) frameMaps.set(id, data);
        } else if (row.kind === "spotanim") {
            if (row.model) {
                if (!validId(row.model.id, 0x7fffffff) || row.model.id < 1000000) throw new Error("Invalid custom graphic model");
                models.set(row.model.id, bytes(row.model.data));
            }
            spotanims.set(row.id, row.data);
        } else {
            throw new Error("Unknown custom animation kind");
        }
        registered.set(`${row.kind}:${row.id}`, row);
        this.revision++;
    },
    clear(): void {
        seqs.clear();
        spotanims.clear();
        frameGroups.clear();
        frameMaps.clear();
        models.clear();
        registered.clear();
        this.revision++;
    },
    /** The whole set as rows (a reset first), as the server sends it: for the render workers. */
    rows(): CustomAnimationRow[] {
        return [{ kind: "reset" }, ...registered.values()];
    },
    seq(id: number): string | undefined { return seqs.get(id); },
    spotanim(id: number): string | undefined { return spotanims.get(id); },
    /** A custom animation's frame files (file id -> frame bytes), by frame group. */
    frameGroup(group: number): ReadonlyMap<number, Int8Array> | undefined { return frameGroups.get(group); },
    /** A custom animation's own frame map (skeleton) bytes, by frame map id. */
    frameMap(id: number): Int8Array | undefined { return frameMaps.get(id); },
    model(id: number): Int8Array | undefined { return models.get(id); },
};

/** A type loader answering custom ids (`source(id)`: base64 definition bytes) before the cache. */
export function withCustomTypes<T extends Type>(
    base: TypeLoader<T>,
    constructor: TypeConstructor<T>,
    cacheInfo: CacheInfo,
    source: (id: number) => string | undefined,
): TypeLoader<T> {
    const decoded = new Map<number, { data: string; value: T }>();
    return {
        load(id: number): T {
            const data = source(id);
            if (data === undefined) return base.load(id);
            const cached = decoded.get(id);
            if (cached?.data === data) return cached.value;
            const value = decodeArchivedType(constructor, id, { cacheInfo, dataBase64: data });
            decoded.set(id, { data, value });
            return value;
        },
        getCount: () => base.getCount(),
        clearCache(): void {
            decoded.clear();
            base.clearCache();
        },
    };
}
