import assert from "node:assert/strict";
import { canUseCacheStorage, openCache } from "../rs/cache/CacheFiles";

async function main() {
    const browserCache = { match() {}, put() {}, delete() {} };
    let opens = 0;
    (globalThis as any).caches = { async open() { opens++; return browserCache; } };
    for (const protocol of ["http:", "https:"]) {
        (globalThis as any).location = { protocol };
        assert.equal(canUseCacheStorage(), true);
        assert.equal(await openCache("desktop-test"), browserCache);
    }
    (globalThis as any).location = { protocol: "tauri:" };
    assert.equal(canUseCacheStorage(), false);
    const fallback = await openCache("desktop-test");
    await fallback.put("tauri://localhost/caches/test", new Response("cached asset"));
    assert.equal(await (await fallback.match("tauri://localhost/caches/test"))?.text(), "cached asset");
    assert.equal(opens, 2);
    console.log("HTTP keeps browser storage; desktop URLs use the existing fallback.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
