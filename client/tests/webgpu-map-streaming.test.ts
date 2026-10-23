import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import Denque from "denque";

import { ClientState } from "../game/ClientState";
import { MapManager } from "../game/MapManager";
import { getMapSquareId } from "../rs/map/MapFileIndex";

(globalThis as any).self = globalThis;
require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
const { updateWebGPUMapStreaming } = require("../render/webgpu/frameConfig");
const { WebGPURenderer } = require("../render/webgpu/WebGPURenderer");
const { hasPendingMapStreamingWork: hasPendingWebGLStreaming } = require("../render/render/streaming");
const { GameRenderer } = require("../game/GameRenderer");

test("cache initialization leaves map scheduling to the first renderer frame", () => {
    const calls: string[] = [];
    const renderer = {
        mapManager: { init: () => calls.push("init"), update: () => calls.push("eager queue") },
        stats: { frameCount: 0 },
        osrsClient: {
            loadedCache: { info: { game: "oldschool", revision: 237 } }, mapFileIndex: {},
            isLoggedIn: () => true, mapRadius: 1, expandedMapLoading: 0,
            camera: { getPosX: () => 3200, getPosZ: () => 3200 },
        },
    };
    GameRenderer.prototype.initCache.call(renderer);
    assert.deepEqual(calls, ["init"], "cache readiness must not queue a second camera-centred loading policy");
});

test("WebGPU streams the server scene around the player across camera orbits and scene rebases", () => {
    const previous = [ClientState.baseX, ClientState.baseY, ClientState.inInstance] as const;
    try {
        ClientState.baseX = 3040;
        ClientState.baseY = 3464;
        ClientState.inInstance = false;
        let cameraX = 3090, cameraY = 3520, preview = false, worldView = -1;
        const queued: number[] = [];
        const maps = new MapManager<any>(4, (x, y) => {
            queued.push(getMapSquareId(x, y));
            maps.addMap(x, y, { mapX: x, mapY: y, canRender: () => true, delete() {} });
        });
        const renderer = {
            mapManager: maps, playerPosUni: new Float32Array([3090, 3520]),
            osrsClient: {
                mapRadius: 1, renderDistance: 25, expandedMapLoading: 0,
                isLoggedIn: () => !preview, get scenePreviewEnabled() { return preview; },
                camera: { getPosX: () => cameraX, getPosZ: () => cameraY },
                playerEcs: { getIndexForServerId: () => 0, getWorldViewId: () => worldView },
                controlledPlayerServerId: 1,
                clientPlugins: { gpuSettings: () => undefined, hdEnabled: () => false },
            },
        } as any;
        updateWebGPUMapStreaming(renderer, 0);
        for (let frame = 1; frame <= maps.gridMapCount; frame++) updateWebGPUMapStreaming(renderer, frame);
        assert.equal(maps.hasPendingMapLoads(maps.gridMapCount), false, "finish the stationary background preload before orbiting");
        const revision = maps.getGridRevision();
        const initial = queued.length;
        for (let i = 1; i <= 64; i++) {
            cameraX = 3090 + Math.sin(i) * 25;
            cameraY = 3520 + Math.cos(i) * 25;
            updateWebGPUMapStreaming(renderer, i);
        }
        assert.equal(maps.getGridRevision(), revision, "camera movement must not rebase the scene");
        assert.equal(queued.length, initial, "camera movement must not queue new regions");
        assert.deepEqual(maps.getGridTileBounds(), { minX: 3024, maxX: 3160, minY: 3448, maxY: 3584 });

        ClientState.baseX += 64;
        updateWebGPUMapStreaming(renderer, 65);
        assert.equal(maps.getGridRevision(), revision + 1, "server scene rebases still queue new regions");
        assert.ok(queued.length > initial);

        worldView = 3;
        updateWebGPUMapStreaming(renderer, 66);
        assert.equal(maps.currentMapX, Math.floor(renderer.playerPosUni[0] / 64));
        assert.equal(maps.currentMapY, Math.floor(renderer.playerPosUni[1] / 64), "boats use their projected player position");
        preview = true;
        cameraX = 3300;
        cameraY = 3300;
        updateWebGPUMapStreaming(renderer, 67);
        assert.equal(maps.currentMapX, 51, "editor preview still streams around its camera");
        assert.equal(maps.currentMapY, 51);
    } finally {
        [ClientState.baseX, ClientState.baseY, ClientState.inInstance] = previous;
    }
});

test("non-HD streaming covers the full visible footprint before the server rebases", () => {
    const previous = [ClientState.baseX, ClientState.baseY, ClientState.inInstance] as const;
    const previousLowEnd = MapManager.lowEnd;
    try {
        ClientState.inInstance = false;
        MapManager.lowEnd = false;
        for (const distance of [25, 90]) {
            for (let phase = 0; phase < 64; phase += 8) {
                ClientState.baseX = 3200 + phase;
                ClientState.baseY = 3200 + phase;
                for (const localX of [16, 87]) for (const localY of [16, 87]) {
                    const x = ClientState.baseX + localX, y = ClientState.baseY + localY;
                    const maps = new MapManager<any>(4, () => {});
                    const renderer = {
                        mapManager: maps, playerPosUni: new Float32Array([x, y]),
                        osrsClient: {
                            mapRadius: 1, renderDistance: distance, expandedMapLoading: 0,
                            isLoggedIn: () => true, scenePreviewEnabled: false,
                            camera: { getPosX: () => x - 25, getPosZ: () => y },
                            playerEcs: { getIndexForServerId: () => 0, getWorldViewId: () => -1 },
                            controlledPlayerServerId: 1,
                            clientPlugins: { gpuSettings: () => ({ drawDistance: distance }), hdEnabled: () => false },
                        },
                    } as any;
                    updateWebGPUMapStreaming(renderer, 0);
                    for (let mx = Math.floor((x - distance) / 64); mx <= Math.floor((x + distance) / 64); mx++) {
                        for (let my = Math.floor((y - distance) / 64); my <= Math.floor((y + distance) / 64); my++) {
                            assert.equal(maps.isMapInTargetGrid(mx, my), true,
                                `draw${distance}, base phase${phase}, local${localX},${localY}: visible map${mx},${my} must load before it enters view`);
                        }
                    }
                }
            }
        }
    } finally {
        [ClientState.baseX, ClientState.baseY, ClientState.inInstance] = previous;
        MapManager.lowEnd = previousLowEnd;
    }
});

function loaderFixture() {
    let resolve!: (data: any) => void;
    let reject!: (error: Error) => void;
    const completion = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
    const mapId = getMapSquareId(48, 55);
    const maps = new MapManager<any>(1, () => {});
    const camera = { getPosX: () => 3089.5, getPosZ: () => 3524.5 } as any;
    maps.update(3089.5, 3524.5, camera, 0, 1, 3040, 3464);
    for (const id of maps.getGridMapIdsSnapshot()) {
        maps.addMap(id >> 8, id & 0xff, { mapX: id >> 8, mapY: id & 0xff, canRender: () => true, delete() {} });
    }
    maps.update(3089.5, 3524.5, camera, 1, 1, 3040, 3464);
    maps.loadingMapIds.add(mapId);
    let target = true;
    maps.isMapInTargetGrid = () => target;
    const renderer: any = {
        pendingMapBuilds: 0, mapLoadEpoch: 0, mapManager: maps, mapsToLoad: new Denque(),
        stats: { frameCount: 10 },
        instances: { hasPendingWork: () => false },
        instanceActive: false,
        osrsClient: { workerPool: { queueLoad: () => completion }, clientPlugins: { objectSettings: () => undefined } },
        locUpdates: { applyGamemode() {}, version: () => 0 },
        getExtraLocs: () => undefined,
        loadSceneData: WebGPURenderer.prototype.loadSceneData,
    };
    return { renderer, resolve, reject, mapId, maps, leaveTarget: () => { target = false; } };
}

test("WebGPU stays busy while workers build or finished maps await upload", async () => {
    const f = loaderFixture();
    const busy = () => WebGPURenderer.prototype.hasPendingMapStreamingWork.call(f.renderer);
    assert.equal(busy(), true, "queued target regions are still streaming");
    f.maps.loadingMapIds.clear();
    assert.equal(busy(), false);
    const build = f.renderer.loadSceneData({ mapX: 48, mapY: 55 });
    assert.equal(busy(), true, "direct instance, boat and loc builds must count before any result arrives");
    f.resolve({ mapX: 48, mapY: 55 });
    const data = await build;
    assert.equal(busy(), false);
    f.renderer.mapsToLoad.push({ mapData: data });
    assert.equal(busy(), true, "finished maps stay busy until uploaded");
    f.renderer.mapsToLoad.clear();
    assert.equal(busy(), false);

    const failed = loaderFixture();
    const failure = failed.renderer.loadSceneData({ mapX: 48, mapY: 55 });
    failed.reject(new Error("worker failed"));
    await assert.rejects(failure, /worker failed/);
    assert.equal(failed.renderer.pendingMapBuilds, 0, "failed builds release their pending count");
    f.renderer.instances.hasPendingWork = () => true;
    assert.equal(busy(), true, "composed instance scenes awaiting upload are still busy");
});

test("WebGPU does not report idle while a required region waits for retry backoff", async () => {
    const f = loaderFixture();
    f.maps.removeMap(48, 55);
    const build = WebGPURenderer.prototype.loadMapData.call(f.renderer, 48, 55, 1);
    f.reject(new Error("transient region failure"));
    await build;
    assert.equal(f.renderer.pendingMapBuilds, 0);
    assert.equal(f.maps.loadingMapIds.has(f.mapId), false, "backoff has no active request marker");
    assert.equal(WebGPURenderer.prototype.hasPendingMapStreamingWork.call(f.renderer), true,
        "the unfinished target scene must keep background prefetch waiting");
});

test("both backends stay busy when off-screen scenery waits for retry backoff", () => {
    const f = loaderFixture();
    f.maps.loadingMapIds.clear();
    f.maps.removeMap(49, 55);
    f.maps.deferFailedMapLoad(49, 55);
    const camera = { getPosX: () => 3089.5, getPosZ: () => 3524.5 } as any;
    f.maps.update(3089.5, 3524.5, camera, 10, 1, 3040, 3464, 0, 25);
    assert.equal(f.maps.isSceneReady(10), true, "off-screen retry backoff must not block login");
    assert.equal(f.maps.loadingMapIds.size, 0, "the background map is waiting for its next retry");
    const webgl = { mapManager: f.maps, mapsToLoad: new Denque(), stats: { frameCount: 10 },
        getPendingStreamMapCount: () => 0 };
    assert.equal(WebGPURenderer.prototype.hasPendingMapStreamingWork.call(f.renderer), true);
    assert.equal(hasPendingWebGLStreaming(webgl), true, "prefetch must wait for unfinished background scenery");
    f.maps.addInvalidMap(49, 55);
    assert.equal(WebGPURenderer.prototype.hasPendingMapStreamingWork.call(f.renderer), false);
    assert.equal(hasPendingWebGLStreaming(webgl), false);
});

test("WebGPU drops streamed results superseded by a scene move or session reset", async () => {
    for (const resetSession of [false, true]) {
        const f = loaderFixture();
        const build = WebGPURenderer.prototype.loadMapData.call(f.renderer, 48, 55, 1);
        if (resetSession) f.renderer.mapLoadEpoch++;
        else f.leaveTarget();
        f.resolve({ mapX: 48, mapY: 55 });
        await build;
        assert.equal(f.renderer.mapsToLoad.length, 0, "superseded regions must not reach the GPU upload queue");
        if (!resetSession) assert.equal(f.maps.loadingMapIds.has(f.mapId), false);
    }
    const empty = loaderFixture();
    const build = WebGPURenderer.prototype.loadMapData.call(empty.renderer, 48, 55, 1);
    empty.resolve(undefined);
    await build;
    assert.equal(empty.maps.invalidMapIds.has(empty.mapId), true, "absent regions must not endlessly rebuild or block scene readiness");
});

test("WebGPU rechecks the target before uploading a completed region", () => {
    const f = loaderFixture();
    f.renderer.world = {};
    f.renderer.mapsToLoad.push({ mapData: { mapX: 48, mapY: 55 }, streamGeneration: 1 });
    const existing = f.maps.getMap(48, 55);
    f.leaveTarget();
    WebGPURenderer.prototype.applyReadyMaps.call(f.renderer, 10);
    assert.equal(f.renderer.mapsToLoad.length, 0);
    assert.equal(f.maps.loadingMapIds.has(f.mapId), false);
    assert.equal(f.maps.getMap(48, 55), existing, "a stale build must not replace existing scenery");
});
