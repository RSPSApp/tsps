import assert from "node:assert/strict";
import { test } from "node:test";

import { getWorldMapImageTile } from "../game/worldMap/WorldMapImageCache";
import { WORLDMAP_TILE_RETRY_MS } from "../game/worldMap/WorldMapTypes";

function state() {
    const area = { id: 1 };
    const worldMapState = {
        currentArea: area,
        displayX: 64,
        displayY: 64,
        displayWidth: 256,
        displayHeight: 256,
        zoomPercentage: 100,
        getCurrentMapAreaId: () => area.id,
        getZoomScale: () => 1,
        tileIcons: [] as any[],
        setTileIcons(_x: number, _y: number, _level: number, icons: any[]) {
            this.tileIcons = icons;
        },
        clearTileIcons() {},
        removeTileIcons() {},
    };
    return {
        worldMapState,
        worldMapImageTiles: new Map(),
        worldMapImageAccess: new Map(),
        worldMapImageDrawnAt: new Map(),
        pendingWorldMapImageIds: new Set(),
        failedWorldMapImageIds: new Map(),
        retainedWorldMapImageIds: new Set(),
        worldMapImageRequestViewportKey: "",
        worldMapImageRequestEpoch: 0,
        worldMapImageCacheEpoch: 0,
        worldMapIconCache: new Map(),
        worldMapIconCacheAreaId: -2,
    } as any;
}

const deps = (loadTile: () => Promise<unknown>) => ({
    getMinimapImageKey: (x: number, y: number) => (x << 8) | y,
    getWorldMapArchiveRenderer: () => ({ loadTile }) as any,
    loadMapElement: () => undefined,
    getWidgetManager: () => undefined,
    evictTextureKey: () => {},
    scheduleRepaint: () => {},
});

test("malformed decoded world-map tiles are discarded without escaping the renderer", async () => {
    const cache = state();
    const tile = getWorldMapImageTile(cache, deps(async () => ({
        pixels: new Uint8Array(1),
        width: 64,
        height: 64,
        icons: [],
    })), 1, 1);
    assert.equal(tile, undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cache.worldMapImageTiles.size, 0);
    assert.equal(cache.pendingWorldMapImageIds.size, 0);
    assert.equal(cache.failedWorldMapImageIds.size, 1);
});

test("a valid decoded world-map tile is cached", async () => {
    const cache = state();
    const pixels = new Uint8Array(64 * 64 * 4);
    getWorldMapImageTile(cache, deps(async () => ({ pixels, width: 64, height: 64, icons: [] })), 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cache.worldMapImageTiles.size, 1);
    assert.equal(cache.pendingWorldMapImageIds.size, 0);
});

test("invalid world-map icon entries are filtered before tile state receives them", async () => {
    const cache = state();
    const pixels = new Uint8Array(64 * 64 * 4);
    const valid = { localX: 4, localY: 5, elementId: 1, category: -1, spriteId: 7 };
    const icons = [null, { ...valid, localX: 64 }, valid];
    getWorldMapImageTile(cache, deps(async () => ({ pixels, width: 64, height: 64, icons })), 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(cache.worldMapState.tileIcons, [valid]);
});

test("a missing world-map archive tile retries and recovers after the backoff", async () => {
    const cache = state();
    const pixels = new Uint8Array(64 * 64 * 4);
    let attempts = 0;
    const loadDeps = deps(async () => {
        attempts++;
        return attempts === 1 ? undefined : { pixels, width: 64, height: 64, icons: [] };
    });
    getWorldMapImageTile(cache, loadDeps, 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(cache.worldMapImageTiles.size, 0);
    const failedId = cache.failedWorldMapImageIds.keys().next().value;
    assert.notEqual(failedId, undefined);
    cache.failedWorldMapImageIds.set(failedId, performance.now() - WORLDMAP_TILE_RETRY_MS - 1);
    getWorldMapImageTile(cache, loadDeps, 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(attempts, 2);
    assert.equal(cache.worldMapImageTiles.size, 1);
});

test("a stale viewport reply cannot publish or remove a newer request for the same tile", async () => {
    const cache = state();
    const replies: Array<(tile: any) => void> = [];
    const tile = { pixels: new Uint8Array(64 * 64 * 4), width: 64, height: 64, icons: [] };
    let cancelled = 0;
    const loadDeps = { ...deps(() => new Promise(resolve => replies.push(resolve))), cancelTileLoads: () => cancelled++ };
    getWorldMapImageTile(cache, loadDeps, 1, 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    // A new zoom level (same rendered size here) cancels what is in flight.
    cache.worldMapState.zoomPercentage = 50;
    getWorldMapImageTile(cache, loadDeps, 1, 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(replies.length, 2, "the new viewport replaces the old pending request");
    replies[0](tile);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cache.pendingWorldMapImageIds.size, 1, "stale finally must retain the new pending marker");
    assert.equal(cache.worldMapImageTiles.size, 0);
    assert.equal(cache.failedWorldMapImageIds.size, 0);
    replies[1](tile);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cache.pendingWorldMapImageIds.size, 0);
    assert.equal(cache.worldMapImageTiles.size, 1);
    assert.equal(cancelled, 2);
});

test("panning keeps the loads in flight instead of cancelling them at each 64-tile step", async () => {
    const cache = state();
    const replies: Array<(tile: any) => void> = [];
    const tile = { pixels: new Uint8Array(64 * 64 * 4), width: 64, height: 64, icons: [] };
    let cancelled = 0;
    const loadDeps = { ...deps(() => new Promise(resolve => replies.push(resolve))), cancelTileLoads: () => cancelled++ };
    getWorldMapImageTile(cache, loadDeps, 1, 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const startCancels = cancelled;
    cache.worldMapState.displayX += 64 * 3;
    cache.worldMapState.displayY -= 64 * 2;
    getWorldMapImageTile(cache, loadDeps, 4, 1);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cancelled, startCancels, "a pan cancels nothing");
    assert.equal(replies.length, 2, "the first square isn't requested again");
    replies[0](tile);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cache.worldMapImageTiles.size, 1, "the square left behind still lands in the cache");
});
