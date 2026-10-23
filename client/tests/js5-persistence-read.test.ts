import assert from "node:assert/strict";

import { Js5Persistence } from "../rs/cache/js5/Js5Persistence";
import { Sector } from "../rs/cache/store/Sector";
import { SparseDat2 } from "../rs/cache/store/SparseDat2";

// A CacheStorage shared by every Js5Persistence, like the browser's across sessions.
const entries = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>();
let puts = 0;
const cache = {
    async match(request: string) {
        const entry = entries.get(request);
        return entry && new Response(entry.body.slice(0), { headers: entry.headers });
    },
    async matchAll(request: string) {
        return [...entries].filter(([url]) => url.split("?")[0] === request)
            .map(([, entry]) => new Response(entry.body.slice(0), { headers: entry.headers }));
    },
    async put(request: string, response: Response) {
        puts++;
        entries.set(request, { body: await response.arrayBuffer(), headers: [...response.headers] });
    },
    async delete(request: string) {
        return entries.delete(request);
    },
};
(globalThis as any).caches = { open: async () => cache };

(async () => {
    const dat2 = new SparseDat2(Sector.SIZE * 100, false);
    const bytes = Uint8Array.from({ length: Sector.SIZE * 10 }, (_, i) => i % 251);
    dat2.write(Sector.SIZE * 20, bytes);

    const first = new Js5Persistence("test", "/caches/dat2", dat2);
    first.queue(Sector.SIZE * 20, bytes.byteLength);
    await first.flush();
    assert.equal(puts, 1);

    // The next session restores nothing into memory and reads stored bytes on demand.
    const next = new Js5Persistence("test", "/caches/dat2", new SparseDat2(dat2.byteLength, false));
    assert.deepEqual(await next.read(Sector.SIZE * 22 + 7, 1000), bytes.subarray(Sector.SIZE * 2 + 7, Sector.SIZE * 2 + 1007),
        "a range inside a stored one reads back from storage");
    assert.equal(await next.read(Sector.SIZE * 29, Sector.SIZE * 2), undefined, "a range running past what is stored goes to the network");
    assert.equal(await next.read(0, 10), undefined);

    next.queue(Sector.SIZE * 20, bytes.byteLength);
    await next.flush();
    assert.equal(puts, 1, "a range an earlier session stored is not stored again");

    // Fetch batching can join groups that previous flushes stored separately.
    const more = Uint8Array.from({ length: Sector.SIZE * 10 }, (_, i) => (i + 7) % 239);
    dat2.write(Sector.SIZE * 30, more);
    first.queue(Sector.SIZE * 30, more.byteLength);
    await first.flush();
    dat2.write(Sector.SIZE * 45, more.subarray(0, Sector.SIZE));
    first.queue(Sector.SIZE * 45, Sector.SIZE);
    await first.flush();
    const later = new Js5Persistence("test", "/caches/dat2", new SparseDat2(dat2.byteLength, false));
    const joined = await later.read(Sector.SIZE * 25, Sector.SIZE * 10);
    assert.ok(joined, "a batch spanning adjacent stored ranges reads entirely from storage");
    assert.deepEqual(joined, dat2.read(Sector.SIZE * 25, Sector.SIZE * 10));
    assert.equal(await later.read(Sector.SIZE * 19, Sector.SIZE * 2), undefined, "a gap before stored data still needs the network");
    assert.equal(await later.read(Sector.SIZE * 39, Sector.SIZE * 2), undefined, "a gap after stored data still needs the network");
    assert.equal(await later.read(Sector.SIZE * 39, Sector.SIZE * 7), undefined, "a gap between stored parts still needs the network");

    const stored = entries.get("/caches/dat2/range/?s=30&n=10")!;
    stored.body = stored.body.slice(0, Sector.SIZE);
    assert.equal(await later.read(Sector.SIZE * 25, Sector.SIZE * 10), undefined, "a truncated stored part is never returned as a complete batch");
    entries.delete("/caches/dat2/range/?s=30&n=10");
    assert.equal(await later.read(Sector.SIZE * 25, Sector.SIZE * 10), undefined, "an evicted part falls back to the network");

    (globalThis as any).caches = { open: async () => { throw new Error("storage denied"); } };
    const unavailable = new Js5Persistence("test", "/caches/dat2", dat2);
    assert.equal(await unavailable.read(Sector.SIZE * 20, Sector.SIZE), undefined,
        "unavailable storage must let the caller fetch from the network");
    unavailable.queue(Sector.SIZE * 20, Sector.SIZE);
    await unavailable.flush();
    unavailable.queue(Sector.SIZE * 21, Sector.SIZE);
    await unavailable.flush();
    console.log("js5 persistence read ok");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
