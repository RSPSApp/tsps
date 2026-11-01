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

test("client ticks flush interface input before scene rendering is ready", () => {
    const { OsrsClient } = require("../game/OsrsClient");
    const { getPacketWriter, createPacket, queuePacket, ClientPacketId } = require("../network/packet");
    const writer = getPacketWriter();
    const previousSocket = writer.socket;
    const sent: Uint8Array[] = [];
    writer.setSocket({ readyState: WebSocket.OPEN, send: (bytes: Uint8Array) => sent.push(bytes.slice()) });
    try {
        const packet = createPacket(ClientPacketId.IF_BUTTON1);
        packet.packetBuffer.writeInt((378 << 16) | 72);
        packet.packetBuffer.writeShort(-1);
        packet.packetBuffer.writeShort(-1);
        queuePacket(packet);
        const client = {
            transmitCycles: { cycleCntr: 0 },
            updateSoundListener() {}, processWidgetTransmits() {},
            processWidgetTimers() {}, processScriptEvents() {},
            get renderer() { assert.fail("sending input must not require a rendered scene"); },
        };
        assert.equal(sent.length, 0);
        OsrsClient.prototype.runClientTicks.call(client, 1);
        assert.equal(sent.length, 1, "Play is sent on the next client tick");
        assert.equal(sent[0][0], ClientPacketId.IF_BUTTON1);
        OsrsClient.prototype.runClientTicks.call(client, 1);
        assert.equal(sent.length, 1, "a later tick must not send the button twice");
    } finally {
        writer.clearBuffer();
        writer.setSocket(previousSocket);
    }
});

test("cache initialization does not queue maps around the login-screen camera", () => {
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

test("the first player sync starts the same scene workers before interface rendering", () => {
    const previous = [ClientState.baseX, ClientState.baseY, ClientState.inInstance, ClientState.scenePositionReady] as const;
    try {
        ClientState.baseX = 3024;
        ClientState.baseY = 3440;
        ClientState.inInstance = false;
        const queued: number[] = [];
        const maps = new MapManager<any>(4, (x, y) => queued.push(getMapSquareId(x, y)));
        const renderer = {
            mapManager: maps, stats: { frameCount: 0 }, playerPosUni: new Float32Array([3079.5, 3490.5]),
            resolveEffectiveRenderDistanceTiles: () => 25,
            osrsClient: {
                mapRadius: 1, expandedMapLoading: 0, renderDistance: 25,
                camera: { getPosX: () => 3079.5, getPosZ: () => 3490.5 },
                isLoggedIn: () => true,
                playerEcs: { getIndexForServerId: () => 0, getWorldViewId: () => -1 },
                controlledPlayerServerId: 1,
                clientPlugins: { gpuSettings: () => undefined, hdEnabled: () => false },
            },
        } as any;
        // LOADING_GAME counts as logged in, but frames before player_sync must not
        // consume the initial grid revision using a zero or previous-session base.
        for (const base of [0, 6000]) {
            ClientState.scenePositionReady = false;
            ClientState.baseX = ClientState.baseY = base;
            updateWebGPUMapStreaming(renderer, 0);
            assert.equal(maps.getGridRevision(), 0);
            assert.deepEqual(queued, []);
        }
        ClientState.baseX = 3024;
        ClientState.baseY = 3440;
        ClientState.scenePositionReady = true;
        GameRenderer.prototype.prepareInitialScene.call(renderer, 3079, 3490);
        assert.equal(queued.length, 4, "queue the four visible squares without waiting for a rendered frame");
        const revision = maps.getGridRevision();
        const bounds = maps.getGridTileBounds();
        updateWebGPUMapStreaming(renderer, 1);
        GameRenderer.prototype.prepareInitialScene.call(renderer, 3079, 3490);
        assert.equal(maps.getGridRevision(), revision, "the first render must use the same authoritative grid");
        assert.deepEqual(maps.getGridTileBounds(), bounds);
        assert.equal(queued.length, 4, "subsequent syncs and rendering must not duplicate the builds");

        maps.cleanUp();
        queued.length = 0;
        ClientState.inInstance = true;
        GameRenderer.prototype.prepareInitialScene.call(renderer, 3079, 3490);
        assert.deepEqual(queued, [], "instance loading keeps its own scene builder");
    } finally {
        [ClientState.baseX, ClientState.baseY, ClientState.inInstance, ClientState.scenePositionReady] = previous;
    }
});

test("WebGPU streams the server scene around the player across camera orbits and scene rebases", () => {
    const previous = [ClientState.baseX, ClientState.baseY, ClientState.inInstance, ClientState.scenePositionReady] as const;
    try {
        ClientState.scenePositionReady = true;
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
        ClientState.scenePositionReady = false;
        cameraX = 3300;
        cameraY = 3300;
        updateWebGPUMapStreaming(renderer, 67);
        assert.equal(maps.currentMapX, 51, "editor preview still streams around its camera");
        assert.equal(maps.currentMapY, 51);
    } finally {
        [ClientState.baseX, ClientState.baseY, ClientState.inInstance, ClientState.scenePositionReady] = previous;
    }
});

test("non-HD streaming covers the full visible footprint before the server rebases", () => {
    const previous = [ClientState.baseX, ClientState.baseY, ClientState.inInstance, ClientState.scenePositionReady] as const;
    const previousLowEnd = MapManager.lowEnd;
    try {
        ClientState.scenePositionReady = true;
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
        [ClientState.baseX, ClientState.baseY, ClientState.inInstance, ClientState.scenePositionReady] = previous;
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
        pendingMapBuilds: 0, mapLoadEpoch: 0, sceneBuilds: new Map(), mapManager: maps, mapsToLoad: new Denque(),
        stats: { frameCount: 10 },
        instances: { hasPendingWork: () => false },
        instanceActive: false,
        osrsClient: { workerPool: { queueLoad: () => completion }, clientPlugins: { objectSettings: () => undefined } },
        locUpdates: { applyGamemode() {}, version: () => 0 },
        getExtraLocs: () => undefined,
        getPlayerRawPlane: () => 0,
        loadSceneData: WebGPURenderer.prototype.loadSceneData,
        cancelObsoleteSceneBuilds: WebGPURenderer.prototype.cancelObsoleteSceneBuilds,
    };
    return { renderer, resolve, reject, mapId, maps, leaveTarget: () => { target = false; } };
}

test("new object state cancels obsolete worker builds instead of waiting several build times", async (t) => {
    const { Pool } = require("threads");
    const { RenderDataWorkerPool } = require("../game/worker/RenderDataWorkerPool");
    const { LocUpdates } = require("../render/webgpu/locUpdates");
    const treeId = 1276, stumpId = 1342, fireId = 26185;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const settle = async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        t.mock.timers.tick(0); // threads dispatches pool tasks through a zero-delay timer.
        await new Promise<void>(resolve => setImmediate(resolve));
    };
    for (const scene of ["resident", "loading", "instance"]) {
        const resident = scene !== "loading";
        const f = loaderFixture();
        if (!resident) f.maps.removeMap(48, 55);
        f.maps.loadingMapIds.add(f.mapId);
        const tree = { x: 3080, y: 3540 }, oldFire = { x: 3082, y: 3540 }, newFire = { x: 3084, y: 3540 };
        f.maps.getMapForWorldTile = (x: number, y: number) => resident ? {
            getRenderBaseWorldX: () => 3072, getRenderBaseWorldY: () => 3520,
            getLocIdsAtLocal: () => x === tree.x && y === tree.y ? [treeId] : [],
            getLocTypeRotsAtLocal: () => [10],
        } as any : undefined;
        const started: Array<{ input: any; id: number }> = [];
        const cancelled: number[] = [];
        const jobs = new Map<number, { timer: ReturnType<typeof setTimeout>; reject: (error: Error) => void }>();
        const worker = {
            load: (_loader: unknown, input: any, id: number) => {
                started.push({ input, id });
                return new Promise((resolve, reject) => {
                    // A deterministic 400 ms build, close to the measured warm cache cost.
                    const timer = setTimeout(() => { jobs.delete(id); resolve({ ...input }); }, 400);
                    jobs.set(id, { timer, reject });
                });
            },
            cancelLoad: async (id: number) => {
                const job = jobs.get(id);
                if (!job) return;
                clearTimeout(job.timer);
                jobs.delete(id);
                cancelled.push(id);
                job.reject(new DOMException("Cancelled", "AbortError"));
            },
        };
        const pool = Pool(() => Promise.resolve(worker), 1);
        const r = f.renderer;
        Object.assign(r, {
            locOverrides: new Map(), locSpawns: new Map(), addedLocs: new Map(),
            terrainOverrides: new Map(), mapRegionReplacements: new Map(), worldEntityOverlays: new Map(),
            loadMapData: WebGPURenderer.prototype.loadMapData,
            loadInstancePartial: WebGPURenderer.prototype.loadInstancePartial,
            getExtraLocs: WebGPURenderer.prototype.getExtraLocs,
            queueLocReload: WebGPURenderer.prototype.queueLocReload,
        });
        if (scene === "instance") Object.assign(r, {
            instanceActive: true, instanceSceneMap: { mapX: 48, mapY: 55 }, instanceTemplateChunks: [[[]]],
        });
        Object.assign(r.osrsClient, {
            loadedCache: {}, locTypeLoader: { load: (id: number) => ({ id, name: "Tree", actions: [] }) },
            workerPool: new RenderDataWorkerPool(pool, (pool as any).workers, 1),
        });
        const updates = r.locUpdates = new LocUpdates(r);
        const initial = scene === "instance" ? r.loadInstancePartial("loc") : r.loadMapData(48, 55, 1);
        await settle();
        assert.equal(started.length, 1);
        updates.onLocDel(tree, 0, 10, 0);
        updates.onLocAddChange(stumpId, tree, 0, 10, 0);
        updates.onLocAddChange(fireId, oldFire, 0, 10, 0);
        t.mock.timers.tick(25);
        await settle();
        assert.deepEqual(cancelled, [started[0].id], "the obsolete running build releases the real worker pool");
        assert.equal(started.length, 2, "the current state starts before the old 400 ms build finishes");
        updates.onLocDel(oldFire, 0, 10, 0);
        updates.onLocAddChange(fireId, newFire, 0, 10, 0);
        t.mock.timers.tick(25);
        await settle();
        assert.equal(cancelled.length, 2);
        assert.equal(started.length, 3);
        const latest = started[2].input;
        assert.equal(latest.locOnly, resident, "a square still loading must rebuild terrain as well as objects");
        if (!resident) assert.equal(f.maps.loadingMapIds.has(f.mapId), true, "a replacement keeps the initial square marked as loading");
        assert.ok([...latest.locOverrides.values()].some((override: any) => override.newId === 0), "the tree removal survives cancellation");
        assert.deepEqual(latest.extraLocs.map((loc: any) => [loc.id, loc.x]), [[stumpId, tree.x], [fireId, newFire.x]],
            "the latest snapshot keeps the stump replacement and newest fire, without the removed fire");
        t.mock.timers.tick(400);
        await settle();
        await initial;
        assert.equal(r.mapsToLoad.length, 1, "only the latest geometry reaches upload, after 450 ms rather than three serial builds");
        assert.equal(r.mapsToLoad.peekFront().locVersion, updates.version(48, 55));
        assert.equal(r.mapsToLoad.peekFront().instance === true, scene === "instance");
        updates.dispose();
    }
});

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
        "the unfinished target scene still counts as streaming work");
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
    assert.equal(hasPendingWebGLStreaming(webgl), true, "background scenery stays visible in full streaming diagnostics");
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

test("both backends publish new squares without per-upload fades and preserve replacement timing", (t) => {
    const { WebGPUMapSquare } = require("../render/webgpu/WebGPUMapSquare");
    const { WebGLMapSquare } = require("../render/WebGLMapSquare");
    const { loadMap } = require("../render/render/map");
    const square = (timeLoaded: number) => ({
        id: getMapSquareId(48, 55), mapX: 48, mapY: 55, timeLoaded, frameLoaded: 5,
        canRender: () => true, delete() {}, initAnimatedLocs() {},
    });
    const glTimes: number[] = [], gpuTimes: number[] = [];
    t.mock.method(WebGLMapSquare, "load", (...args: any[]) => {
        glTimes.push(args[13]);
        return square(args[13]);
    });
    t.mock.method(WebGPUMapSquare, "load", (...args: any[]) => {
        gpuTimes.push(args[3]);
        return square(args[3]);
    });
    for (const previousTime of [undefined, 0.25]) {
        const f = loaderFixture();
        f.maps.removeMap(48, 55);
        if (previousTime !== undefined) {
            f.maps.addMap(48, 55, Object.assign(Object.create(WebGLMapSquare.prototype), square(previousTime)));
        }
        const glHost: any = {
            mapManager: f.maps, stats: { frameCount: 10 },
            osrsClient: {}, registerMinimapData() {}, rebuildGroundItemsForMap: () => false,
            groundItemStacks: new Map(), updateTextureArray() {},
            pendingLocUpdates: new Set(), pendingLocGeometryUpdates: new Set(), pendingDoorLocUpdates: new Set(),
        };
        const data = { mapX: 48, mapY: 55 };
        loadMap(glHost, undefined, undefined, undefined, undefined, undefined, undefined, undefined, data);

        const g = loaderFixture();
        g.maps.removeMap(48, 55);
        if (previousTime !== undefined) g.maps.addMap(48, 55, square(previousTime));
        g.renderer.world = { uploadMapTextures() {} };
        g.renderer.worldEntityOverlays = new Map();
        g.renderer.mapsToLoad.push({ mapData: data });
        WebGPURenderer.prototype.applyReadyMaps.call(g.renderer, 10);
    }
    assert.deepEqual(glTimes, [-1, 0.25], "new WebGL squares appear with their group; replacements keep their timing");
    assert.deepEqual(gpuTimes, glTimes, "WebGPU uses the same publication policy");
});


test("obsolete builds cancel in the worker while overlapping target squares keep building", async () => {
    const f = loaderFixture();
    let signal!: AbortSignal;
    f.renderer.osrsClient.workerPool.queueLoad = (_loader: unknown, _input: unknown, next: AbortSignal) => {
        signal = next;
        return new Promise((_resolve, reject) => next.addEventListener("abort", () => reject(next.reason), { once: true }));
    };
    const build = WebGPURenderer.prototype.loadMapData.call(f.renderer, 48, 55, 1);
    WebGPURenderer.prototype.cancelObsoleteSceneBuilds.call(f.renderer);
    assert.equal(signal.aborted, false, "current target work survives a new streaming generation");
    f.leaveTarget();
    WebGPURenderer.prototype.cancelObsoleteSceneBuilds.call(f.renderer);
    await build;
    assert.equal(signal.aborted, true);
    assert.equal(f.maps.loadingMapIds.has(f.mapId), false, "the slot can load the new destination");
    assert.equal(f.renderer.mapsToLoad.length, 0, "cancelled geometry is never published");
    assert.equal(f.renderer.pendingMapBuilds, 0);
    assert.equal(f.renderer.sceneBuilds.size, 0);
});
