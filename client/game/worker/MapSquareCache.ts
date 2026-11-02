import type { CacheInfo } from "../../rs/cache/CacheInfo";
import type { SdMapData } from "../../render/loader/SdMapData";
import type { SdMapLoaderInput } from "../../render/loader/SdMapLoaderInput";
import type { VarManager } from "../../rs/config/vartype/VarManager";
import { Scene } from "../../rs/scene/Scene";
import { isLowEndDevice } from "../../common/utils/DeviceUtil";

/**
 * Bump when SdMapData or the geometry the loader emits changes, so old entries stop matching.
 * 6: loc id 0 is built (Dwarf Cannon's remains multiloc); format 5 squares left it out.
 */
export const CACHE_FORMAT = 6;
// Desktop HD scenes can cover 64 squares before walking into the next scene.
// Retain several scene windows rather than evicting the previous login's squares.
export const MAX_SQUARES = isLowEndDevice ? 64 : 256;

const DB_NAME = "map-square-cache";

/** [0 = varbit, 1 = varp, id, value] read while building; a hit needs the same values now. */
export type VarRead = [number, number, number];

/**
 * Cache base builds with no runtime changes in their source scene. Global changes elsewhere
 * cannot affect them; changes in the full border can affect lighting, collision and metadata.
 */
export function isCacheable(input: SdMapLoaderInput): boolean {
    if (!(
        input.persistentCache === true &&
        Number.isInteger(input.mapX) && Number.isInteger(input.mapY) &&
        !input.doorOnly &&
        !input.locOnly &&
        !input.minimapOnly &&
        !input.instance &&
        !input.overrideRenderPos &&
        !input.extraLocs?.length &&
        !input.extraNpcs?.length
    )) return false;

    // SdMapDataLoader builds a 64-tile core with six source tiles on every side.
    const minX = input.mapX * Scene.MAP_SQUARE_SIZE - 6;
    const minY = input.mapY * Scene.MAP_SQUARE_SIZE - 6;
    const maxX = minX + Scene.MAP_SQUARE_SIZE + 12;
    const maxY = minY + Scene.MAP_SQUARE_SIZE + 12;
    const affectsPoint = (x: number, y: number) =>
        !Number.isInteger(x) || !Number.isInteger(y) ||
        (x >= minX && x < maxX && y >= minY && y < maxY);
    const affectsKey = (key: string) => {
        const [x, y, level] = key.split(",").map(Number);
        return !Number.isInteger(level) || level < 0 || level >= Scene.MAX_LEVELS || affectsPoint(x, y);
    };
    for (const [key, override] of input.locOverrides ?? []) {
        if (affectsKey(key)) return false;
        if (override.moveToX !== undefined || override.moveToY !== undefined) {
            if (override.moveToX === undefined || override.moveToY === undefined ||
                affectsPoint(override.moveToX, override.moveToY)) return false;
        }
    }
    for (const changes of [input.locSpawns, input.terrainOverrides]) {
        for (const key of changes?.keys() ?? []) if (affectsKey(key)) return false;
    }
    for (const regionId of input.mapRegionReplacements?.keys() ?? []) {
        if (!Number.isInteger(regionId) || regionId < 0 || regionId > 0xffff) return false;
        const x = (regionId >> 8) * Scene.MAP_SQUARE_SIZE;
        const y = (regionId & 0xff) * Scene.MAP_SQUARE_SIZE;
        if (x < maxX && x + Scene.MAP_SQUARE_SIZE > minX &&
            y < maxY && y + Scene.MAP_SQUARE_SIZE > minY) return false;
    }
    return true;
}

/** A build is storable only if its final pass hit no missing groups (those render as gaps). */
export function shouldStore(complete: boolean, data: unknown): boolean {
    return complete && !!data;
}

export function fnv(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    }
    return (h >>> 0).toString(36);
}

/** "<cache identity>|<hash of every input that changes the output>". */
export function cacheKey(info: CacheInfo, input: SdMapLoaderInput, npcsHash: string, definitionArchiveKey = ""): string {
    const prefix = `${info.game}/${info.environment}/${info.name}/${info.revision}/${info.timestamp}/${info.size}/v${CACHE_FORMAT}`;
    const fields = [
        input.mapX,
        input.mapY,
        input.maxLevel,
        input.loadNpcs,
        input.smoothTerrain,
        input.minimizeDrawCalls,
        input.loadNpcs ? npcsHash : "",
        ...(definitionArchiveKey ? [`definitionArchives:${definitionArchiveKey}`] : []),
        // Only when on, so squares cached before this option keep their keys.
        ...(input.smoothLocAnimations ? [`smoothLocAnimations:${input.smoothLocAnimationSteps ?? 4}`] : []),
    ];
    return `${prefix}|${fnv(JSON.stringify(fields))}-${input.mapX},${input.mapY}`;
}

export function cachePrefix(key: string): string {
    return key.slice(0, key.indexOf("|") + 1);
}

// Var reads made by any build in this worker; extra reads from a concurrent load only cost hits.
const recorders = new Set<Map<string, VarRead>>();
const tracked = new WeakSet<VarManager>();

export function trackVarReads(vm: VarManager): void {
    if (tracked.has(vm)) return;
    tracked.add(vm);
    const bit = vm.getVarbit.bind(vm);
    const varp = vm.getVarp.bind(vm);
    vm.getVarbit = (id: number) => {
        const v = bit(id);
        for (const r of recorders) r.set(`0,${id}`, [0, id, v]);
        return v;
    };
    vm.getVarp = (id: number) => {
        const v = varp(id);
        for (const r of recorders) r.set(`1,${id}`, [1, id, v]);
        return v;
    };
}

export async function recordVarReads<T>(
    run: () => Promise<T>,
): Promise<{ result: T; reads: VarRead[] }> {
    const rec = new Map<string, VarRead>();
    recorders.add(rec);
    try {
        const result = await run();
        return { result, reads: [...rec.values()] };
    } finally {
        recorders.delete(rec);
    }
}

export function varReadsMatch(vm: VarManager, reads: VarRead[]): boolean {
    return reads.every(([kind, id, value]) => (kind === 0 ? vm.getVarbit(id) : vm.getVarp(id)) === value);
}

type Entry = { data: SdMapData; reads: VarRead[] };

function req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}

let dbPromise: Promise<IDBDatabase | undefined> | undefined;
const purged = new Set<string>();

function openDb(): Promise<IDBDatabase | undefined> {
    dbPromise ??= new Promise((resolve) => {
        try {
            const open = indexedDB.open(DB_NAME, 1);
            open.onupgradeneeded = () => {
                const db = open.result;
                db.createObjectStore("data");
                db.createObjectStore("meta").createIndex("lastUsed", "lastUsed");
            };
            open.onsuccess = () => resolve(open.result);
            open.onerror = open.onblocked = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
    return dbPromise;
}

export function compactSquareGeometry(data: SdMapData): boolean {
    let changed = false;
    for (const key of ["vertices", "doorVertices", "npcVertices"] as const) {
        const bytes = data[key];
        if (bytes && bytes.buffer.byteLength !== bytes.byteLength) {
            data[key] = bytes.slice();
            changed = true;
        }
    }
    const loc = data.loc;
    if (loc && loc.vertices.buffer.byteLength !== loc.vertices.byteLength) {
        loc.vertices = loc.vertices.slice();
        changed = true;
    }
    return changed;
}

/** Every failure resolves to "no cache": map loading must never depend on storage. */
export async function readSquare(key: string): Promise<Entry | undefined> {
    try {
        const db = await openDb();
        if (!db) return undefined;
        const tx = db.transaction(["data", "meta"], "readwrite");
        const entry = (await req(tx.objectStore("data").get(key))) as Entry | undefined;
        if (entry) {
            if (compactSquareGeometry(entry.data)) {
                try { tx.objectStore("data").put(entry, key); } catch {}
            }
            tx.objectStore("meta").put({ lastUsed: Date.now() }, key);
        }
        return entry;
    } catch {
        return undefined;
    }
}

export async function writeSquare(key: string, entry: Entry): Promise<void> {
    try {
        const db = await openDb();
        if (!db) return;
        const tx = db.transaction(["data", "meta"], "readwrite");
        const data = tx.objectStore("data");
        const meta = tx.objectStore("meta");
        data.put(entry, key); // clones now, before the caller transfers the buffers away
        meta.put({ lastUsed: Date.now() }, key);

        const prefix = cachePrefix(key);
        const drop = (k: IDBValidKey) => {
            data.delete(k);
            meta.delete(k);
        };
        if (!purged.has(prefix)) {
            // Entries of another cache revision can never match again.
            purged.add(prefix);
            const all = (await req(meta.getAllKeys())) as string[];
            for (const k of all) if (!k.startsWith(prefix)) drop(k);
        }
        const count = await req(meta.count());
        if (count > MAX_SQUARES) {
            let excess = count - MAX_SQUARES;
            const cursor = meta.index("lastUsed").openKeyCursor();
            await new Promise<void>((resolve, reject) => {
                cursor.onerror = () => reject(cursor.error);
                cursor.onsuccess = () => {
                    const c = cursor.result;
                    if (!c || excess <= 0) return resolve();
                    if (c.primaryKey !== key) {
                        drop(c.primaryKey);
                        excess--;
                    }
                    c.continue();
                };
            });
        }
        await done(tx);
    } catch {
        // quota or storage disabled: keep going without a cache
    }
}
