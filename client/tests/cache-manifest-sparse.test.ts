import assert from "node:assert/strict";
import { isCacheManifestComplete } from "../common/utils/CacheManifest";

async function main() {
    const original = globalThis.caches;
    const base = "https://rsps.app/play/caches/test/";
    const dat2 = "main_file_cache.dat2";
    let entries = new Map<string, Response>();
    const setEntries = (...items: Array<[string, Response]>) => {
        entries = new Map(items.map(([path, response]) => [base + path, response]));
    };
    const file = () => new Response(new Uint8Array([1]));
    const part = (index: number, bytes: number) => new Response(new Uint8Array(bytes), {
        headers: { "Cache-Part": String(index), "Content-Length": String(bytes) },
    });
    const manifest = (total: number) => new Response(JSON.stringify({ total }), {
        headers: { "Content-Type": "application/json" },
    });
    (globalThis as any).caches = { open: async () => ({
        keys: async () => [...entries.keys()].map(url => new Request(url)),
        match: async (request: RequestInfo) => entries.get(typeof request === "string" ? request : request.url)?.clone(),
    }) };
    const entry = { cacheName: "test", files: ["main_file_cache.idx255", dat2], updatedAt: "" };
    const index: [string, Response] = ["main_file_cache.idx255", file()];
    try {
        setEntries(index, [`${dat2}/range/manifest`, file()]);
        assert.equal(await isCacheManifestComplete(entry), true, "Persisted sparse cache must survive reload");
        setEntries(index);
        assert.equal(await isCacheManifestComplete(entry), false, "Missing dat2 still invalidates cache");
        setEntries(index, [dat2, file()]);
        assert.equal(await isCacheManifestComplete(entry), true, "Full cache remains supported");

        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/?p=1`, part(1, 2)], [`${dat2}/part/manifest`, manifest(5)]);
        assert.equal(await isCacheManifestComplete(entry), true, "Completed retained parts must survive reload");

        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/?p=1`, part(1, 2)], [`${dat2}/part/?p=3`, part(3, 1)], [`${dat2}/part/manifest`, manifest(5)]);
        assert.equal(await isCacheManifestComplete(entry), true, "Stale parts beyond a gap do not join the prefix");
        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/?p=1`, part(1, 2)], [`${dat2}/part/?p=2`, part(2, 1)], [`${dat2}/part/manifest`, manifest(5)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A contiguous stale tail exceeds the completed total");
        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/manifest`, manifest(5)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A missing trailing part is incomplete");
        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/?p=2`, part(2, 2)], [`${dat2}/part/manifest`, manifest(5)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A gap in part indexes is incomplete");
        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/?p=1`, part(1, 1)], [`${dat2}/part/manifest`, manifest(5)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A short retained prefix is incomplete");
        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/?p=1`, part(1, 2)]);
        assert.equal(await isCacheManifestComplete(entry), false, "Parts without a completion manifest are incomplete");

        const badManifest = () => new Response("not json");
        setEntries(index, [dat2, file()], [`${dat2}/part/manifest`, badManifest()]);
        assert.equal(await isCacheManifestComplete(entry), true, "Full file ignores a bad part manifest");
        setEntries(index, [`${dat2}/range/manifest`, file()], [`${dat2}/part/manifest`, badManifest()]);
        assert.equal(await isCacheManifestComplete(entry), true, "Sparse manifest ignores a bad part manifest");
        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/manifest`, badManifest()]);
        assert.equal(await isCacheManifestComplete(entry), false, "Malformed completion metadata is incomplete");
        setEntries(index, [`${dat2}/part/?p=0`, part(0, 3)], [`${dat2}/part/manifest`, manifest(0)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A nonpositive total is incomplete");
        setEntries(index, [`${dat2}/part/?p=0`, new Response(new Uint8Array(3), { headers: { "Content-Length": "3" } })], [`${dat2}/part/manifest`, manifest(3)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A part without its index header is incomplete");
        setEntries(index, [`${dat2}/part/?p=0`, part(1, 3)], [`${dat2}/part/manifest`, manifest(3)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A mismatched part index is incomplete");
        setEntries(index, [`${dat2}/part/?p=0`, new Response(new Uint8Array(3), { headers: { "Cache-Part": "0" } })], [`${dat2}/part/manifest`, manifest(3)]);
        assert.equal(await isCacheManifestComplete(entry), false, "A part without its length header is incomplete");
    } finally { (globalThis as any).caches = original; }
    console.log("Sparse cache manifest regression passed");
}
void main();
