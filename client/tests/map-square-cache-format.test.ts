// A browser that cached a map square before a geometry change must not keep serving it. Format 6
// builds loc id 0 (the Dwarf Cannon remains at the watchtower, square 40,53); format 5 squares
// left it out, and their tile-loc metadata has no loc 0 whose varp could trigger a rebuild.
// Format 7 builds rev 242 multilocs: format 6 squares stored while the browser failed to decode
// them (stale ByteBuffer.js, #4007/#4135) left out Edgeville's poll booth and loot chest (#4240).
import assert from "node:assert/strict";
import { CACHE_FORMAT, cacheKey, cachePrefix, readSquare, writeSquare } from "../game/worker/MapSquareCache";

const info: any = { game: "oldschool", environment: "live", name: "c1", revision: 230, timestamp: "t", size: 5 };
const watchtower: any = {
    persistentCache: true, mapX: 40, mapY: 53, maxLevel: 3, loadNpcs: false,
    smoothTerrain: true, minimizeDrawCalls: false, loadedTextureIds: new Set(),
};

// In-memory IndexedDB with the two stores MapSquareCache opens.
const stores = { data: new Map<string, any>(), meta: new Map<string, any>() };
const request = (read: () => unknown): any => {
    const result: any = {};
    queueMicrotask(() => {
        result.result = read();
        result.onsuccess?.();
    });
    return result;
};
const store = (map: Map<string, any>) => ({
    get: (key: string) => request(() => map.get(key)),
    put: (value: any, key: string) => request(() => map.set(key, value)),
    delete: (key: string) => map.delete(key),
    getAllKeys: () => request(() => [...map.keys()]),
    count: () => request(() => map.size),
    createIndex: () => {},
    index: () => ({ openKeyCursor: () => request(() => null) }),
});
const db = {
    createObjectStore: (name: "data" | "meta") => store(stores[name]),
    transaction: () => ({
        objectStore: (name: "data" | "meta") => store(stores[name]),
        set oncomplete(callback: () => void) { setTimeout(callback, 0); },
    }),
};
(globalThis as any).indexedDB = {
    open: () => {
        const open: any = { result: db };
        queueMicrotask(() => {
            open.onupgradeneeded?.();
            open.onsuccess?.();
        });
        return open;
    },
};

async function main(): Promise<void> {
    assert.ok(CACHE_FORMAT >= 7, "squares cached before rev 242 multilocs were built are a different format");
    const key = cacheKey(info, watchtower, "");
    const staleKeys = [5, 6].map((format) => key.replace(`/v${CACHE_FORMAT}|`, `/v${format}|`));
    for (const staleKey of staleKeys) {
        assert.notEqual(staleKey, key);
        assert.notEqual(cachePrefix(staleKey), cachePrefix(key));
        stores.data.set(staleKey, { data: { missingLocs: true }, reads: [] });
        stores.meta.set(staleKey, { lastUsed: 1 });
    }

    assert.equal(await readSquare(key), undefined, "format 5 and 6 squares are not served: the loader builds them again");
    const fresh = { data: { locZero: true }, reads: [[1, 0, 3]] };
    await writeSquare(key, fresh as any);
    for (const staleKey of staleKeys) {
        assert.equal(stores.data.has(staleKey), false, "storing the rebuilt square purges the old formats");
        assert.equal(stores.meta.has(staleKey), false);
    }
    assert.deepEqual((await readSquare(key))?.data, fresh.data, "the rebuilt square is the one served");
    console.log("map-square-cache-format: ok");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
