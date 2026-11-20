import assert from "node:assert/strict";

async function main() {
    (globalThis as any).window = { location: { hostname: "localhost", protocol: "tauri:", search: "" },
        __RSPS_DESKTOP_PROFILE__: { name: "Example", address: "example.com", secure: true, maxPlayers: 2047 } };
    process.env.PUBLIC_URL = "/";
    process.env.REACT_APP_CACHE_BASE_URL = "https://cdn.example.com/caches/";
    const info = { name: "osrs-242_2026-11-03", game: "oldschool" as const, environment: "live", revision: 242, timestamp: "2026-11-03T00:00:00Z", size: 100 };
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        if (url === "/caches/caches.json") return Response.json([info]);
        if (url === `https://cdn.example.com/caches/${info.name}/keys.json`) return Response.json({ "1": [1, 2, 3, 4] });
        throw new Error(`Unexpected cache request: ${url}`);
    }) as typeof fetch;
    const { fetchCacheInfos, loadCacheFiles } = await import("../game/Caches");
    const { CacheFiles } = await import("../rs/cache/CacheFiles");
    assert.deepEqual(await fetchCacheInfos(), [info], "the installed release selects the cache, not the CDN's latest metadata");
    let sharedLoaderCalled = false;
    CacheFiles.fetchDat2 = async (baseUrl, cacheName) => {
        sharedLoaderCalled = true;
        assert.equal(baseUrl, `https://cdn.example.com/caches/${info.name}/`);
        assert.equal(cacheName, info.name);
        return new CacheFiles(new Map());
    };
    const loaded = await loadCacheFiles(info);
    assert.equal(sharedLoaderCalled, true, "desktop uses the existing browser data loader");
    assert.deepEqual(loaded.xteas.get(1), [1, 2, 3, 4]);
    assert.equal(urls.some(url => url === "https://cdn.example.com/caches/caches.json"), false);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
