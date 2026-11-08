import assert from "node:assert/strict";

import { openCache } from "../rs/cache/CacheFiles";

async function main(): Promise<void> {
    const globals = globalThis as typeof globalThis & { caches?: CacheStorage; indexedDB?: IDBFactory };
    const cachesDescriptor = Object.getOwnPropertyDescriptor(globals, "caches");
    const indexedDBDescriptor = Object.getOwnPropertyDescriptor(globals, "indexedDB");
    try {
        Object.defineProperty(globals, "caches", { configurable: true, writable: true, value: undefined });
        Object.defineProperty(globals, "indexedDB", { configurable: true, writable: true, value: undefined });
        const cache = await openCache("null-body-test");

        await cache.put("/partial", new Response("payload", {
            status: 206,
            statusText: "Partial Content",
            headers: { "X-Test": "partial" },
        }));
        for (let i = 0; i < 2; i++) {
            const hit = await cache.match("/partial");
            assert.ok(hit);
            assert.equal(hit.status, 206);
            assert.equal(hit.statusText, "Partial Content");
            assert.equal(hit.headers.get("X-Test"), "partial");
            assert.notEqual(hit.body, null);
            assert.equal(await hit.text(), "payload");
        }

        await cache.put("/empty-blob", new Response(new Blob([])));
        const empty = await cache.match("/empty-blob");
        assert.ok(empty);
        assert.equal(empty.status, 200);
        assert.notEqual(empty.body, null);
        assert.equal(await empty.text(), "");

        for (const status of [204, 205, 304]) {
            const key = `/null-body-${status}`;
            await cache.put(key, new Response(null, {
                status,
                statusText: "Test Status",
                headers: { "X-Test": "null-body" },
            }));
            for (let i = 0; i < 2; i++) {
                const hit = await cache.match(key);
                assert.ok(hit);
                assert.equal(hit.status, status);
                assert.equal(hit.statusText, "Test Status");
                assert.equal(hit.headers.get("X-Test"), "null-body");
                assert.equal(hit.body, null);
                assert.equal(await hit.text(), "");
            }
        }
    } finally {
        if (cachesDescriptor) Object.defineProperty(globals, "caches", cachesDescriptor);
        else Reflect.deleteProperty(globals, "caches");
        if (indexedDBDescriptor) Object.defineProperty(globals, "indexedDB", indexedDBDescriptor);
        else Reflect.deleteProperty(globals, "indexedDB");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
