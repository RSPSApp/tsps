import assert from "node:assert/strict";
import { test } from "node:test";

import {
    getWorldMapImageSource,
    getWorldMapImageTile,
    retainWorldMapImageTiles,
} from "../game/worldMap/WorldMapImageCache";
import { WorldMapCompositeTextures } from "../game/worldMap/WorldMapCompositeTexture";
import { MAX_WORLDMAP_IMAGE_BYTES } from "../game/worldMap/WorldMapTypes";
import { WorldMapState } from "../rs/map/WorldMapArea";

/**
 * The world map's zoom eases between levels (RenderOverview.smoothZoom), its rendered tiles are
 * kept by bytes like the client's 36 MB region sprite cache, and a square whose tile for the
 * current zoom isn't rendered yet draws the same square from another zoom instead of nothing.
 */

function zoomState(zoom: number, target = zoom) {
    const area = { id: 0 };
    return {
        worldMapState: {
            currentArea: area,
            displayX: 3200,
            displayY: 3200,
            displayWidth: 256,
            displayHeight: 256,
            zoomPercentage: 100,
            zoom,
            target,
            getCurrentMapAreaId: () => area.id,
            getZoomScale() {
                return this.zoom;
            },
            getTargetZoomScale() {
                return this.target;
            },
            getDisplayPixelWidth: () => 1024,
            getDisplayPixelHeight: () => 768,
            setTileIcons() {},
            clearTileIcons() {},
            removeTileIcons() {},
        },
        worldMapImageTiles: new Map(),
        worldMapImageBytes: 0,
        worldMapImageAccess: new Map(),
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

/** Renders each requested square at the requested pixels per tile, counting the requests. */
function renderer() {
    const loads: Array<{ mapX: number; mapY: number; pixelsPerTile: number }> = [];
    const evicted: string[] = [];
    const deps = {
        getMinimapImageKey: (x: number, y: number) => (x << 8) | y,
        getWorldMapArchiveRenderer: () => ({
            loadTile: async (_area: unknown, mapX: number, mapY: number, pixelsPerTile: number) => {
                loads.push({ mapX, mapY, pixelsPerTile });
                const size = 64 * pixelsPerTile;
                return { pixels: new Uint8Array(size * size * 4), width: size, height: size, icons: [] };
            },
        }) as any,
        loadMapElement: () => undefined,
        getWidgetManager: () => undefined,
        evictTextureKey: (key: string) => evicted.push(key),
        scheduleRepaint: () => {},
    };
    return { deps, loads, evicted };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Retains then draws every square of a w x h block, as one frame of the map widget does. */
async function drawFrame(cache: any, deps: any, w: number, h: number) {
    const squares = [];
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) squares.push({ mapX: 40 + x, mapY: 40 + y });
    retainWorldMapImageTiles(cache, deps, squares);
    const drawn = squares.map(({ mapX, mapY }) => getWorldMapImageSource(cache, deps, mapX, mapY));
    await settle();
    return drawn;
}

/** Draws frames until every square has its tile (loads are capped per frame). */
async function drawUntilLoaded(cache: any, deps: any, w: number, h: number) {
    for (let frame = 0; frame < 20; frame++) {
        await drawFrame(cache, deps, w, h);
        if (cache.pendingWorldMapImageIds.size === 0 && retainedAllLoaded(cache)) break;
    }
}

function retainedAllLoaded(cache: any): boolean {
    for (const id of cache.retainedWorldMapImageIds) if (!cache.worldMapImageTiles.has(id)) return false;
    return true;
}

test("a script's zoom eases in a thirtieth per cycle, as RenderOverview.smoothZoom", () => {
    const state = new WorldMapState();
    state.setZoomPercentage(100, true);
    state.setZoomPercentage(200);
    assert.equal(state.zoomPercentage, 200, "CS2 reads the target at once");
    assert.equal(state.getZoomScale(), 4, "nothing is drawn at the new zoom before a cycle");
    assert.equal(state.getTargetZoomScale(), 8);
    assert.equal(state.cycle(), true, "a zoom step repaints the map");
    assert.ok(Math.abs(state.getZoomScale() - (4 + 4 / 30)) < 1e-9);
    let cycles = 1;
    while (state.getZoomScale() < 8 && cycles < 100) {
        state.cycle();
        cycles++;
    }
    assert.equal(state.getZoomScale(), 8, "it lands exactly on the target");
    assert.equal(cycles, 22, "100% to 200% takes 22 cycles (0.44s)");
    assert.equal(state.cycle(), false, "a settled zoom doesn't repaint");

    state.setZoomPercentage(25);
    state.cycle();
    assert.ok(Math.abs(state.getZoomScale() - (8 - 8 / 30)) < 1e-9, "zooming out eases the same way");
});

test("opening an area snaps to its zoom instead of easing", () => {
    const state = new WorldMapState();
    state.setZoomPercentage(200);
    state.setZoomPercentage(50, true);
    assert.equal(state.getZoomScale(), 2);
    assert.equal(state.cycle(), false);
});

test("zooming back to a level already viewed draws its tiles without rendering them again", async () => {
    const { deps, loads } = renderer();
    // 25% zoom over a large widget: 24 x 18 squares, far more than the old 96-tile cap.
    const cache = zoomState(1);
    await drawUntilLoaded(cache, deps, 24, 18);
    assert.equal(loads.length, 24 * 18);

    cache.worldMapState.zoom = cache.worldMapState.target = 2;
    cache.worldMapState.zoomPercentage = 50;
    await drawUntilLoaded(cache, deps, 24, 18);
    assert.equal(loads.length, 2 * 24 * 18);

    cache.worldMapState.zoom = cache.worldMapState.target = 1;
    cache.worldMapState.zoomPercentage = 25;
    const drawn = await drawFrame(cache, deps, 24, 18);
    assert.equal(loads.length, 2 * 24 * 18, "no square is rendered again");
    assert.ok(drawn.every((tile) => tile?.width === 64), "every square draws its 25% tile at once");
});

test("tiles are evicted by bytes, oldest first, never the ones on screen", async () => {
    const { deps, evicted } = renderer();
    // 8 pixels per tile: 1 MiB a square, so 36 squares fill the budget.
    const cache = zoomState(8);
    await drawFrame(cache, deps, 6, 6);
    assert.equal(cache.worldMapImageBytes, 36 * 512 * 512 * 4);
    assert.ok(cache.worldMapImageBytes <= MAX_WORLDMAP_IMAGE_BYTES);
    assert.equal(evicted.length, 0);

    // Pan to 36 new squares: the old ones go, as far as the budget needs.
    cache.worldMapState.displayX += 64 * 6;
    const squares = [];
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) squares.push({ mapX: 46 + x, mapY: 40 + y });
    retainWorldMapImageTiles(cache, deps, squares);
    for (const { mapX, mapY } of squares) getWorldMapImageSource(cache, deps, mapX, mapY);
    await settle();
    assert.ok(cache.worldMapImageBytes <= MAX_WORLDMAP_IMAGE_BYTES);
    assert.equal(evicted.length, 36, "every old square was evicted for a new one");
    for (const { mapX, mapY } of squares) {
        assert.ok(getWorldMapImageSource(cache, deps, mapX, mapY), `${mapX},${mapY} on screen kept`);
    }
});

test("while a zoom's tile renders, the same square from another zoom is drawn instead", async () => {
    const { deps } = renderer();
    const cache = zoomState(4);
    await drawFrame(cache, deps, 1, 1);

    // Zooming in to 200%: the 8px tile is requested; until it lands the 4px one is stretched.
    cache.worldMapState.target = 8;
    cache.worldMapState.zoomPercentage = 200;
    cache.worldMapState.zoom = 4 + 4 / 30;
    const standIn = getWorldMapImageSource(cache, deps, 40, 40);
    assert.equal(standIn?.width, 256, "the 4px tile stands in");
    assert.equal(getWorldMapImageTile(cache, deps, 40, 40), undefined, "the exact lookup has no stand-in");
    await settle();
    assert.equal(getWorldMapImageSource(cache, deps, 40, 40)?.width, 512, "then the 8px tile is drawn");
});

test("mid zoom-out the larger cached size is drawn shrunk, not the target size stretched", async () => {
    const { deps } = renderer();
    const cache = zoomState(4);
    await drawFrame(cache, deps, 1, 1);
    cache.worldMapState.target = 1;
    cache.worldMapState.zoomPercentage = 25;
    await drawFrame(cache, deps, 1, 1);
    assert.equal(cache.worldMapImageTiles.size, 2, "both sizes are cached");

    cache.worldMapState.zoom = 3.4;
    assert.equal(getWorldMapImageSource(cache, deps, 40, 40)?.width, 256, "4px shrunk at 3.4");
    cache.worldMapState.zoom = 1;
    assert.equal(getWorldMapImageSource(cache, deps, 40, 40)?.width, 64, "1px once it settles");
});

test("the stand-in on screen is retained while new tiles fill the budget around it", async () => {
    const { deps } = renderer();
    const cache = zoomState(8);
    await drawFrame(cache, deps, 1, 1);
    const standInIds = [...cache.worldMapImageTiles.keys()];

    // Zooming out 8 -> 4, mid-ease at 4.1, before any 4px tile exists: the 8px tile drawn
    // meanwhile is retained along with the 4px request.
    cache.worldMapState.target = 4;
    cache.worldMapState.zoom = 4.1;
    cache.worldMapState.zoomPercentage = 100;
    retainWorldMapImageTiles(cache, deps, [{ mapX: 40, mapY: 40 }]);
    assert.ok(standInIds.every((id) => cache.retainedWorldMapImageIds.has(id)));
});

test("easing zoom keeps the requests it started instead of cancelling them each cycle", async () => {
    let cancels = 0;
    const { deps } = renderer();
    const cancelDeps = { ...deps, cancelTileLoads: () => cancels++ };
    const cache = zoomState(4, 8);
    cache.worldMapState.zoomPercentage = 200;
    getWorldMapImageSource(cache, cancelDeps, 40, 40);
    const startCancels = cancels;
    for (const width of [250, 200, 160, 130]) {
        cache.worldMapState.displayWidth = width;
        getWorldMapImageSource(cache, cancelDeps, 40, 40);
    }
    assert.equal(cancels, startCancels, "the tile span changing with the zoom isn't a new viewport");
});

test("an area's composite texture loads once and is drawn under its tiles", async () => {
    const bytes = new Int8Array([1, 2, 3]);
    let reads = 0;
    const archive = {
        getFileNamed: (name: string) => (name === "main" ? { id: 0, data: bytes } : undefined),
    };
    const cache = {
        getIndex: () => {
            reads++;
            return { getArchiveId: () => -1, archiveExists: (id: number) => id === 2, getArchive: () => archive };
        },
    } as any;
    let repaints = 0;
    const textures = new WorldMapCompositeTextures(
        () => cache,
        () => repaints++,
        () => {},
        async (data) => {
            assert.deepEqual([...data], [1, 2, 3]);
            return { pixels: new Uint8Array(768 * 544 * 4), width: 768, height: 544 };
        },
    );
    const main = { id: 0, internalName: "main" };
    assert.equal(textures.get(main), undefined, "nothing yet while it decodes");
    assert.equal(textures.get(main), undefined);
    await settle();
    await settle();
    const texture = textures.get(main);
    assert.equal(texture?.width, 768);
    assert.equal(texture?.height, 544);
    assert.equal(reads, 1, "one read for repeated frames");
    assert.equal(repaints, 1, "the map repaints when it lands");

    // An area without one is remembered as none.
    assert.equal(textures.get({ id: 7, internalName: "nowhere" }), undefined);
    await settle();
    await settle();
    assert.equal(textures.get({ id: 7, internalName: "nowhere" }), undefined);
    assert.equal(reads, 2);
});

test("every area in the cache has a composite texture file", async () => {
    const { CacheSystem } = await import("../rs/cache/CacheSystem");
    const { IndexType } = await import("../rs/cache/IndexType");
    const { worldMapGroupId, compositeMapFileFor } = await import("../rs/map/WorldMapArea");
    const { loadCache, loadCacheInfos, loadCacheList } = await import("../scripts/cache/load-util");
    const info = loadCacheList(loadCacheInfos()).latest;
    const cacheSystem = CacheSystem.fromFiles(info, loadCache(info).files);
    const state: any = WorldMapState.load(cacheSystem);
    const index: any = cacheSystem.getIndex(IndexType.OSRS.worldMap);
    const archive = index.getArchive(worldMapGroupId(index, "compositetexture"));
    for (const area of state.areasById.values()) {
        const file = compositeMapFileFor(archive, area);
        assert.ok(file, `${area.internalName} has a composite texture`);
        const data = new Uint8Array(file.data.buffer, file.data.byteOffset, 4);
        assert.deepEqual([...data], [0x89, 0x50, 0x4e, 0x47], `${area.internalName}'s is a PNG`);
    }
});

/**
 * One frame of renderWidgetTree's world map: draws the squares visible at the zoom drawn now,
 * retaining (and so requesting) only those visible at the zoom being eased toward.
 */
function squaresAt(cx: number, cy: number, width: number, height: number, pixelsPerTile: number) {
    const spanX = width / (2 * pixelsPerTile) + 64;
    const spanY = height / (2 * pixelsPerTile) + 64;
    const squares = [];
    for (let mapY = Math.floor((cy - spanY) / 64); mapY <= Math.floor((cy + spanY) / 64); mapY++) {
        for (let mapX = Math.floor((cx - spanX) / 64); mapX <= Math.floor((cx + spanX) / 64); mapX++) {
            squares.push({ mapX, mapY });
        }
    }
    return squares;
}

async function easedFrame(cache: any, deps: any, zoom: WorldMapState, width: number, height: number) {
    const s = cache.worldMapState;
    s.zoom = zoom.getZoomScale();
    s.target = zoom.getTargetZoomScale();
    s.zoomPercentage = zoom.zoomPercentage;
    retainWorldMapImageTiles(cache, deps, squaresAt(s.displayX, s.displayY, width, height, s.target));
    for (const { mapX, mapY } of squaresAt(s.displayX, s.displayY, width, height, s.zoom)) {
        getWorldMapImageSource(cache, deps, mapX, mapY);
    }
    await settle();
}

test("zooming 100% -> 200% -> 100% through the ease keeps the 100% tiles (1024x768 map)", async () => {
    const { deps, loads } = renderer();
    const zoom = new WorldMapState();
    zoom.setZoomPercentage(100, true);
    const cache = zoomState(4);
    const frames = async (n: number) => {
        for (let i = 0; i < n; i++) {
            zoom.cycle();
            await easedFrame(cache, deps, zoom, 1024, 768);
        }
    };
    await frames(30);
    const loads100 = loads.filter((l) => l.pixelsPerTile === 4).length;
    assert.ok(loads100 > 0);

    zoom.setZoomPercentage(200);
    await frames(40);
    const target8 = squaresAt(3200, 3200, 1024, 768, 8).length;
    assert.equal(
        loads.filter((l) => l.pixelsPerTile === 8).length,
        target8,
        "only the squares in the 200% view render at 8px, not the whole 100% view",
    );
    assert.ok(cache.worldMapImageBytes <= MAX_WORLDMAP_IMAGE_BYTES, "within the budget");

    zoom.setZoomPercentage(100);
    await frames(40);
    assert.equal(loads.filter((l) => l.pixelsPerTile === 4).length, loads100, "no 100% square renders again");
    zoom.setZoomPercentage(200);
    await frames(40);
    assert.equal(loads.filter((l) => l.pixelsPerTile === 8).length, target8, "nor any 200% square");
});
