import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MapManager } from "../game/MapManager";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { clearSessionCaches } from "../render/render/session";
import { onLocAddChange } from "../render/render/locs";
import { onLocDel, scheduleLocReload } from "../render/render/locs2";
import { getMapSquareId } from "../rs/map/MapFileIndex";
import { MapFileLoader } from "../rs/map/MapFileLoader";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { LocModelType } from "../rs/config/loctype/LocModelType";
import { LocType } from "../rs/config/loctype/LocType";
import { ModelData } from "../rs/model/ModelData";
import { SceneBuilder, LocLoadType } from "../rs/scene/SceneBuilder";
import { getEditModeSceneLoadingStatus } from "../game/plugins/editmode/editModeLoadingScreen";
import { isMapProfileEnabled } from "../render/render/mapLoadProfile";
import { CONSTRUCTION_ROOMS, HOUSE_TEMPLATE_CHUNKS } from "../../server/src/main/typescript/elvarg/game/plugin/impl/construction/ConstructionData";
import { CachePipeline } from "../../server/src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheMaps } from "../../server/src/main/typescript/elvarg/game/cache/CacheMaps";
import { getMinimapMaps } from "../widgets/gl/MinimapRenderer";
import { registerMinimapData } from "../render/render/minimap";
import { clearInstance, doInstanceSceneBuild, loadInstanceScene, replaceSceneWithInstance } from "../render/render/instance";
import { npcOwnerMapId } from "../render/npc/NpcRenderTemplate";
import { npcLocalForMap } from "../render/render/draw";

function houseMinimapUsesFullScene(): void {
    const maps = new MapManager<any>(4, () => {});
    const map = {
        mapX: 102, mapY: 104,
        getRenderBaseTileX: () => 6496,
        getRenderBaseTileY: () => 6648,
        getLocalTileSpan: () => 104,
    };
    maps.mapSquares.set(getMapSquareId(map.mapX, map.mapY), map);
    const renderer = { instanceActive: true, mapManager: maps } as any;
    const expected = [{ mapX: 102, mapY: 104, baseX: 6496, baseY: 6648, size: 104 }];
    for (const x of [6496, 6527, 6528, 6559, 6560, 6599]) {
        for (const y of [6648, 6655, 6656, 6719, 6720, 6751]) {
            assert.deepEqual(getMinimapMaps(renderer, x, y), expected,
                "crossing map squares must retain the same full-size house image and icon origin");
        }
    }
    const urls: string[] = [];
    const registered: number[][] = [];
    const host = {
        ...renderer,
        minimapIcons: new Map(),
        instanceTemplateChunks: [], instanceLocRebuildTimer: null,
        addedLocs: new Map(), locOverrides: new Map(), locSpawns: new Map(),
        clearMaps: () => maps.mapSquares.clear(),
        osrsClient: {
            setMinimapImageUrl(x: number, y: number, url: string, level: number) {
                registered.push([x, y, level]);
                urls.push(url);
            },
            clearMinimapImageUrls() {
                for (const url of urls.splice(0)) URL.revokeObjectURL(url);
            },
        },
    } as any;
    registerMinimapData(host, { mapX: 102, mapY: 104,
        minimapBlobs: Array.from({ length: 4 }, () => new Blob(["minimap"])),
        minimapIcons: [[], [{ localX: 90, localY: 85, spriteId: 1 }], [], []],
    } as any);
    assert.deepEqual(registered, [[102, 104, 0], [102, 104, 1], [102, 104, 2], [102, 104, 3]]);
    clearInstance(host);
    assert.equal(urls.length, 0, "leaving a house releases its minimap images");
    assert.deepEqual(getMinimapMaps(renderer, 6540, 6680), [], "loading an instance must not use overworld images");
    renderer.instanceActive = false;
    const normal = getMinimapMaps(renderer, 3200, 3200);
    assert.equal(normal.length, 9);
    assert.deepEqual(normal[4], { mapX: 50, mapY: 50, baseX: 3200, baseY: 3200, size: 64 });
}

houseMinimapUsesFullScene();

/**
 * Relighting a Gauntlet room or building a POH room resends the instance palette. The drawn
 * scene must stay until the new one is ready and then be swapped in one step; a build that a
 * newer one superseded must never be applied.
 */
async function instanceRebuildKeepsTheSceneUntilTheSwap(): Promise<void> {
    const builds: Array<(data: any) => void> = [];
    const drawn = new Set<string>(["old"]);
    let cleared = 0;
    const host: any = {
        osrsClient: {
            loadedCache: {},
            workerPool: { queueLoad: () => new Promise((resolve) => builds.push(resolve)) },
            clearMinimapImageUrls() {},
            rehomeNpcs(refreshMapId?: number) { host.rehomed = (host.rehomed ?? 0) + 1; host.refreshedMapId = refreshMapId; },
        },
        addedLocs: new Map(), locOverrides: new Map(), locSpawns: new Map(),
        instanceActive: false, instanceTemplateChunks: null, instanceLocRebuildTimer: null,
        instanceBuildSeq: 0, pendingInstanceScene: null,
        mapsToLoad: { items: [] as any[], clear() { this.items.length = 0; }, push(item: any) { this.items.push(item); } },
        pendingStreamMapsByGeneration: new Map(),
        mapManager: { loadingMapIds: new Set<number>() },
        maxLevel: 3, loadNpcs: false, smoothTerrain: false, hasMultiDraw: true, loadedTextureIds: new Set(),
        getInstanceExtraLocs: () => undefined,
        clearMaps() { cleared++; drawn.clear(); },
        skipMapFadeIn: false,
    };
    host.doInstanceSceneBuild = (...args: any[]) => (doInstanceSceneBuild as any)(host, ...args);
    host.addedLocs.set("a", { locId: 1 });

    const first = loadInstanceScene(host, [[[1]]], 100, 100);
    assert.equal(cleared, 0, "the drawn scene stays while the new one builds");
    // A loc spawned with the rebuild schedules a loc rebuild; the first build takes it instead.
    host.instanceLocRebuildTimer = setTimeout(() => {}, 1000);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(host.instanceLocRebuildTimer, null, "spawned locs are folded into the one build");
    const second = loadInstanceScene(host, [[[2]]], 100, 100);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(builds.length, 2);
    builds[1]({ mapX: 12, mapY: 12, id: "new" });
    builds[0]({ mapX: 12, mapY: 12, id: "stale" });
    await Promise.all([first, second]);
    assert.deepEqual(host.mapsToLoad.items.map((map: any) => map.id), ["new"], "a superseded build is dropped");
    assert.equal(host.pendingInstanceScene?.id, "new");
    assert.ok(drawn.has("old") && cleared === 0, "still drawing the old scene until the new one is applied");

    replaceSceneWithInstance(host, host.pendingInstanceScene);
    assert.equal(cleared, 1);
    assert.equal(host.skipMapFadeIn, true, "the new scene appears without the fog fade-in");
    assert.equal(host.pendingInstanceScene, null);
    // Every NPC in the scene now belongs to the square it is built as (Gauntlet monsters in
    // other 64x64 squares were drawn offset and could not be clicked).
    assert.deepEqual(host.instanceSceneMap, { mapX: 12, mapY: 12 });
    assert.equal(host.rehomed, 1, "NPCs move to the instance square at the swap");
    assert.equal(host.refreshedMapId, (12 << 8) | 12, "and the new scene's map gets its NPCs back");
    assert.equal(npcOwnerMapId({ x: 12 * 64 + 70, y: 12 * 64 + 3, ownerMapId: (12 << 8) | 12 }), (12 << 8) | 12);
    assert.equal(npcOwnerMapId({ x: 12 * 64 + 70, y: 12 * 64 + 3 }), (13 << 8) | 12, "outside an instance: its own square");
    // An instance is drawn from its scene base, not its square's corner: an NPC west of the
    // corner must still land inside the scene (the draw data is unsigned, so negative wrapped).
    const sceneBase = 12 * 64 - 40;
    const npcWorldX = (12 * 64 - 10) * 128;
    assert.equal(npcLocalForMap(npcWorldX, sceneBase), 30 * 128);
    assert.equal(npcLocalForMap(npcWorldX, 12 * 64), -10 * 128, "from the corner it would be negative");
}

instanceRebuildKeepsTheSceneUntilTheSwap().catch(error => { console.error(error); process.exitCode = 1; });

function mapProfilingRequiresExplicitFlag(): void {
    const original = Object.getOwnPropertyDescriptor(globalThis, "location");
    try {
        for (const [search, enabled] of [["", false], ["?edit=1", false],
            ["?edit=1&map-profile=0", false], ["?edit=1&map-profile=1", true],
            ["?map-profile=1", true]] as const) {
            Object.defineProperty(globalThis, "location", { configurable: true, value: { search } });
            assert.equal(isMapProfileEnabled(), enabled, search);
        }
    } finally {
        if (original) Object.defineProperty(globalThis, "location", original);
        else Reflect.deleteProperty(globalThis, "location");
    }
}

function editorWaitsForRenderableRegion(): void {
    const maps = new MapManager<any>(4, () => {});
    const progress = { pending: 3, active: 1, downloadedBytes: 2.5 * 1048576 };
    const client = {
        scenePreviewEnabled: true,
        scenePreviewLoadingStartedAt: performance.now(),
        renderer: { mapManager: maps },
        js5: { getProgress: () => progress },
    } as any;
    assert.match(getEditModeSceneLoadingStatus(client)!, /Downloading scenery - 2.5 MiB received/);
    progress.pending = 20; // A build pass discovers more dependencies.
    assert.match(getEditModeSceneLoadingStatus(client)!, /Downloading scenery - 2.5 MiB received/);
    progress.downloadedBytes = 3 * 1048576;
    progress.pending = 0;
    maps.loadingMapIds.add(1);
    assert.match(getEditModeSceneLoadingStatus(client)!, /Building the first region - 3.0 MiB received/);
    client.js5 = undefined;
    maps.loadingMapIds.add(1);
    assert.match(getEditModeSceneLoadingStatus(client)!, /Building the first region/);
    // A received/uploaded region alone must not dismiss the screen.
    maps.mapSquares.set(1, { mapX: 0, mapY: 1 });
    assert.ok(getEditModeSceneLoadingStatus(client));
    maps.visibleMaps = [{ mapX: 0, mapY: 1 }];
    maps.visibleMapCount = 1;
    assert.ok(getEditModeSceneLoadingStatus(client), "stale visible regions must not dismiss loading");
    maps.isMapInTargetGrid = () => true;
    assert.equal(getEditModeSceneLoadingStatus(client), undefined);
    assert.equal(client.scenePreviewLoadingStartedAt, undefined);
    maps.visibleMapCount = 0;
    assert.equal(getEditModeSceneLoadingStatus(client), undefined, "later streaming must not reopen startup loading");
    client.scenePreviewLoadingStartedAt = performance.now();
    client.scenePreviewEnabled = false;
    assert.equal(getEditModeSceneLoadingStatus(client), undefined, "leaving preview must release the overlay");
}

function multipartLocsRequestAllMissingModelsTogether(): void {
    for (const typed of [false, true]) {
        const requested: number[] = [];
        const present = new Set<number>();
        const loader = new LocModelLoader({} as any, {
            getModel(id) {
                requested.push(id);
                return present.has(id) ? new ModelData() : undefined;
            },
        }, {} as any, {} as any, {} as any, undefined);
        const loc = new LocType(1, { game: "oldschool", revision: 237 } as any);
        loc.models = [[10, 20, 30]];
        loc.types = typed ? [LocModelType.NORMAL] : undefined;

        assert.equal(loader.getLocModelData(loc, LocModelType.NORMAL, 0), undefined);
        assert.deepEqual(requested, [10, 20, 30], "all missing parts must be requested in one build pass");
        present.add(10);
        present.add(30);
        assert.equal(loader.getLocModelData(loc, LocModelType.NORMAL, 0), undefined,
            "a missing middle part must not merge stale or partial geometry");
        present.add(20);
        assert.ok(loader.getLocModelData(loc, LocModelType.NORMAL, 0));
    }
}

function mapLoadBackoff(): void {
    const originalNow = Date.now;
    let now = 1000;
    Date.now = () => now;
    try {
        let loads = 0;
        const manager = new MapManager(1, () => {
            loads++;
        });

        manager.loadMap(37, 48);
        assert.equal(loads, 1);
        manager.deferFailedMapLoad(37, 48);
        manager.loadMap(37, 48);
        assert.equal(loads, 1);

        now += 250;
        manager.loadMap(37, 48);
        assert.equal(loads, 2);
    } finally {
        Date.now = originalNow;
    }
}

function incomingMapsRenderBeforeTheWholeGridIsReady(): void {
    const manager = new MapManager(1, () => {});
    const camera = { getPosX: () => 3232, getPosZ: () => 3232 } as any;
    const map = (mapX: number, mapY: number) => ({
        mapX,
        mapY,
        canRender: () => true,
        delete: () => {},
    });

    manager.update(3232, 3232, camera, 0, 1, 3200, 3200);
    for (const mapId of manager.getGridMapIdsSnapshot()) {
        manager.addMap(mapId >> 8, mapId & 0xff, map(mapId >> 8, mapId & 0xff));
    }
    manager.update(3232, 3232, camera, 1, 1, 3200, 3200);

    manager.update(3296, 3232, camera, 2, 1, 3264, 3200);
    manager.addMap(52, 50, map(52, 50));
    manager.update(3296, 3232, camera, 3, 1, 3264, 3200);

    assert.ok(manager.visibleMaps.some((entry) => entry.mapX === 52 && entry.mapY === 50));
}

function duplicateLocReplayIsIgnored(): void {
    let refreshes = 0;
    const host = {
        addedLocs: new Map(),
        locOverrides: new Map(),
        instanceActive: false,
        osrsClient: { locTypeLoader: { load: () => undefined } },
        scheduleLocGeometryUpdate: () => {
            refreshes++;
        },
    } as any;

    onLocAddChange(host, 411, { x: 2431, y: 3076 }, 1, 10, 1);
    onLocAddChange(host, 411, { x: 2431, y: 3076 }, 1, 10, 1);
    assert.equal(refreshes, 1);

    host.locOverrides.clear();
    onLocAddChange(host, 411, { x: 2431, y: 3076 }, 1, 10, 1);
    assert.equal(refreshes, 2);

    onLocAddChange(host, 411, { x: 2431, y: 3076 }, 1, 10, 0);
    assert.equal(refreshes, 3);
}

function instanceFurnitureReplacesOnlyItsHotspot(): void {
    const builder = new SceneBuilder({ game: "oldschool", revision: 237 } as any,
        {} as any, {} as any, {} as any,
        { load: () => ({ sizeX: 1, sizeY: 1 }) } as any, {} as any, new Map());
    const scene = { sizeX: 104, sizeY: 104, levels: 4, tileRenderFlags: [], collisionMaps: [] } as any;
    // Two identical template hotspots (id 100, shape 10, orientation 1), at (2,3) and (3,3).
    const data = Int8Array.from([101, 128, 132, 41, 65, 41, 0, 0]);
    const placements: number[][] = [];
    builder.addLoc = (_scene, plane, x, y, id, shape, rotation) => { placements.push([plane, x, y, id, shape, rotation]); };
    const destinations = [[18, 27], [19, 29], [21, 28], [20, 26]];
    for (let rotation = 0; rotation < 4; rotation++) {
        const [x, y] = destinations[rotation];
        const decode = () => {
            placements.length = 0;
            (builder as any).decodeInstanceLocs(scene, data, 1, 16, 24, 0, 0, 0, rotation, LocLoadType.NO_MODELS);
        };
        builder.clearLocOverrides();
        decode();
        assert.equal(placements.length, 2);
        assert.deepEqual(placements[0], [1, x, y, 100, 10, (1 + rotation) & 3]);
        const neighbor = placements[1];
        // A floor decoration and chair can occupy the same tile. Both removals
        // must survive the renderer-to-scene override transfer independently.
        const overlapping = { addedLocs: new Map(), locOverrides: new Map(), instanceActive: true,
            scheduleInstanceLocRebuild() {} } as any;
        onLocDel(overlapping, { x, y }, 1, 22, 0);
        onLocDel(overlapping, { x, y }, 1, 10, (1 + rotation) & 3);
        onLocAddChange(overlapping, 6752, { x, y }, 1, 10, 0);
        assert.equal(overlapping.locOverrides.size, 2);
        for (const [key, value] of overlapping.locOverrides) {
            const [tileX, tileY, plane, oldId] = key.split(",").map(Number);
            builder.setLocOverride(tileX, tileY, plane, oldId, value.newId,
                undefined, undefined, undefined, undefined, undefined, value.matchType);
        }
        assert.equal((builder as any).getLocOverride(x, y, 1, 999, 22, 0)?.newId, 0,
            "the floor hotspot removal must survive the chair override");
        decode();
        assert.deepEqual(placements, [neighbor], "overlapping hotspot removals must not overwrite each other");
        builder.clearLocOverrides();
        let instanceRebuilds = 0;
        const host = { addedLocs: new Map(), locOverrides: new Map(), instanceActive: true,
            scheduleInstanceLocRebuild() { instanceRebuilds++; } } as any;
        onLocAddChange(host, 6752, { x: 6400 + x, y: 6400 + y }, 1, 10, 0);
        const override = host.locOverrides.get(`${6400 + x},${6400 + y},1,-1`);
        builder.setLocOverride(x, y, 1, -1, override.newId, undefined, undefined, undefined, undefined, undefined, override.matchType);
        decode();
        assert.deepEqual(placements, [neighbor], "building must hide only the occupied hotspot, including rotated rooms");

        const rebuildsBeforeRemoval = instanceRebuilds;
        onLocDel(host, { x: 6400 + x, y: 6400 + y }, 1, 10, (1 + rotation) & 3);
        assert.equal(instanceRebuilds, rebuildsBeforeRemoval + 1, "hotspot removal must rebuild the instance, not load a world map");
        assert.equal(host.addedLocs.size, 0);
        const removal = host.locOverrides.get(`${6400 + x},${6400 + y},1,-1`);
        builder.setLocOverride(x, y, 1, -1, removal.newId, undefined, undefined, undefined, undefined, undefined, removal.matchType);
        decode();
        assert.deepEqual(placements, [neighbor], "normal entry hides the empty hotspot after its furniture is removed");

        builder.clearLocOverrides(); // Removing furniture rebuilds the saved house without its spawn.
        decode();
        assert.equal(placements.length, 2, "removing furniture must restore its template hotspot");
        builder.setLocOverride(x, y, 0, -1, 0);
        builder.setLocOverride(x, y, 1, -1, 0, undefined, undefined, undefined, undefined, undefined, 0);
        decode();
        assert.equal(placements.length, 2, "other planes and object shapes must remain independent");
    }
    builder.clearLocOverrides();
    builder.setLocOverride(2, 3, 0, -1, 0, undefined, undefined, undefined, undefined, undefined, 10);
    placements.length = 0;
    builder.decodeLocs(scene, data, 0, 0, LocLoadType.NO_MODELS);
    assert.deepEqual(placements, [[0, 3, 3, 100, 10, 1]], "normal maps must retain the same replacement behavior");
}

instanceFurnitureReplacesOnlyItsHotspot();

function locUpdateBeforeInitialMapDoesNotStartADuplicateMapTask(): void {
    const mapX = 48;
    const mapY = 54;
    const mapId = getMapSquareId(mapX, mapY);
    const host = {
        locReloadVersions: new Map<number, number>(),
        mapManager: {
            loadingMapIds: new Set(),
            getMap: () => undefined,
        },
        pendingStreamMapsByGeneration: new Map(),
        pendingLocReloadMaps: new Map(),
        pendingLocReloadFlushTimer: undefined,
        beginLocReloadBatch: () => assert.fail("initial load must not start a second reload"),
    } as any;

    scheduleLocReload(host, mapX, mapY);
    assert.equal(host.locReloadVersions.get(mapId), 1);
    assert.equal(host.pendingLocReloadMaps.size, 0);
}

function locReplayInvalidatesCompletedMapsWaitingToRender(): void {
    const mapId = getMapSquareId(48, 154);
    let reloads = 0;
    const host = {
        locReloadVersions: new Map(),
        mapManager: { getMap: () => undefined },
        pendingStreamMapsByGeneration: new Map([[1, new Map([[mapId, {}]])]]),
        queueLoadMap: (x: number, y: number) => {
            assert.deepEqual([x, y], [48, 154]);
            reloads++;
        },
    } as any;
    scheduleLocReload(host, 48, 154);
    assert.equal(host.pendingStreamMapsByGeneration.get(1).has(mapId), false,
        "a completed map with closed doors must not render after open-door replay");
    assert.equal(reloads, 1, "rebuild a nonresident map whose completed build was invalidated");
    scheduleLocReload(host, 48, 154);
    assert.equal(reloads, 1, "later replay packets must not start duplicate builds");
}

function crossShapeReplacementKeepsBaseWallHidden(): void {
    const tile = { x: 2643, y: 2592 };
    const host = {
        addedLocs: new Map(),
        locOverrides: new Map(),
        instanceActive: false,
        osrsClient: { locTypeLoader: { load: () => undefined } },
        getLocIdsAtTileAllLevels: () => [],
        scheduleLocGeometryUpdate: () => undefined,
    } as any;

    onLocDel(host, tile, 0, 0, 0);
    onLocAddChange(host, 14245, tile, 0, 22, 0);
    assert.equal(host.locOverrides.get("2643,2592,0,-1").matchType, 0);
    assert.equal(host.addedLocs.get("2643,2592,0,22").locId, 14245);

    onLocDel(host, tile, 0, 22, 0);
    onLocAddChange(host, 14233, tile, 0, 0, 0);
    assert.equal(host.locOverrides.get("2643,2592,0,-1").matchType, 0);
    assert.equal(host.addedLocs.has("2643,2592,0,22"), false);
    assert.equal(host.addedLocs.get("2643,2592,0,0").locId, 14233);
}

function regionReplacementUsesNativeMapData(): void {
    const payload = Uint8Array.from([48, 55, 1, 0, 3, 0, 2, 1, 2, 3, 4, 5]);
    const frame = Uint8Array.from([144, 0, payload.length, ...payload]);
    const decoded = decodeServerPacket(frame) as any;
    assert.equal(decoded.type, "region_replacement");
    assert.equal(decoded.payload.regionId, 12343);
    assert.equal(decoded.payload.allowReload, true);
    assert.deepEqual([...decoded.payload.terrainData], [1, 2, 3]);
    assert.deepEqual([...decoded.payload.objectData], [4, 5]);

    const loader = new MapFileLoader({} as any, {} as any);
    loader.setRegionReplacements(new Map([[12343, {
        terrainData: Int8Array.from([1, 2, 3]),
        objectData: Int8Array.from([4, 5]),
    }]]));
    assert.deepEqual([...loader.getTerrainData(48, 55)!], [1, 2, 3]);
    assert.deepEqual([...loader.getLocData(48, 55, new Map())!], [4, 5]);
}

mapLoadBackoff();
mapProfilingRequiresExplicitFlag();
editorWaitsForRenderableRegion();
multipartLocsRequestAllMissingModelsTogether();
incomingMapsRenderBeforeTheWholeGridIsReady();
duplicateLocReplayIsIgnored();
locUpdateBeforeInitialMapDoesNotStartADuplicateMapTask();
locReplayInvalidatesCompletedMapsWaitingToRender();
crossShapeReplacementKeepsBaseWallHidden();
regionReplacementUsesNativeMapData();
console.log("Map loading regression tests passed");

// Disconnect restores the cache door and must discard its old open counterpart.
const session: any = {
    interactHighlightDrawTargets: [],
    clearInteractHighlightActiveTarget() {},
    clearInteractHighlightHoverTarget() {},
    clearDynamicNpcAnimRuntimeState() {},
    clearCameraShake() {},
};
for (const key of [
    "npcDefaultHeightCache", "npcNameCache", "npcHitsplats", "playerHitsplats",
    "npcHealthBars", "playerHealthBars", "hitsplatSeenNpc", "actorServerTilesSeenNpc",
    "locOverrides", "locAnimTimers", "locSpawns", "addedLocs", "terrainOverrides",
    "mapRegionReplacements", "gamemodeWorldLocOverrideKeys", "gamemodeWorldLocSpawnKeys",
    "gamemodeWorldTerrainOverrideKeys", "mapsToLoad", "pendingStreamMapsByGeneration",
    "activeStreamExpectedMapIds", "pendingLocUpdates", "pendingLocGeometryUpdates",
    "pendingDoorLocUpdates", "pendingLocReloadMaps", "pendingLocReloadBatches",
    "queuedLocReloadBatchByMap", "groundItemStacks", "groundItemStackHashes",
    "minimapIcons", "projectileRenderDebugCounts", "cachedLocIds", "cachedObjIds", "cachedNpcIds",
]) session[key] = new Map();
session.locOverrides.set("3200,3200,0,-1", { newId: 0, matchType: 0 });
session.addedLocs.set("3199,3200,0,0", { locId: 778, x: 3199, y: 3200, level: 0, shape: 0, rotation: 1 });
clearSessionCaches(session);
assert.equal(session.locOverrides.size, 0);
assert.equal(session.addedLocs.size, 0, "reconnect must remove the previous session's open door");

// Check the server's room coordinates against the same native maps the client decodes.
// This integration check requires the project's installed cache and never downloads one.
async function constructionTemplatesUseProjectCache(): Promise<void> {
    const root = resolve(__dirname, '../../server');
    const target = readFileSync(resolve(root, 'target.txt'), 'utf8').trim();
    for (const file of ['main_file_cache.dat2', 'main_file_cache.idx255', 'info.json', 'keys.json']) {
        assert.ok(existsSync(resolve(root, 'caches', target, file)), 'Run server ensure-cache before this integration check');
    }
    await CachePipeline.initialize(root);
    try {
        const builder = new SceneBuilder({ game: 'oldschool', revision: CachePipeline.getActive().revision } as any,
            {} as any, {} as any, {} as any,
            { load: () => ({ sizeX: 1, sizeY: 1 }) } as any, {} as any, new Map());
        const scene = { sizeX: 64, sizeY: 64, levels: 4, tileRenderFlags: [], collisionMaps: [] } as any;
        const templates = [...CONSTRUCTION_ROOMS, ...Object.values(HOUSE_TEMPLATE_CHUNKS)];
        const regions = new Set(templates.map(room => ((room.sourceChunkX >> 3) << 8) | (room.sourceChunkY >> 3)));
        const placements: number[][] = [];
        for (const region of regions) {
            const data = CacheMaps.getRegion(region);
            assert.ok(data?.terrainData.length && data.objectData?.length, 'Every house template must exist in the project cache');
            builder.addLoc = (_scene, plane, x, y, id, shape, rotation) => {
                if (plane === 0) placements.push([(region >> 8) * 64 + x, (region & 255) * 64 + y, id, shape, rotation]);
            };
            builder.decodeLocs(scene, new Int8Array(data.objectData!), 0, 0, LocLoadType.NO_MODELS);
        }
        for (const room of CONSTRUCTION_ROOMS) {
            assert.ok(placements.some(([x, y]) => (x >> 3) === room.sourceChunkX && (y >> 3) === room.sourceChunkY), room.key);
        }
        const parlour = CONSTRUCTION_ROOMS.find(room => room.key === 'PARLOUR')!;
        const chairs = placements.filter(([x, y, id]) => (x >> 3) === parlour.sourceChunkX &&
            (y >> 3) === parlour.sourceChunkY && id >= 4515 && id <= 4517);
        assert.deepEqual(chairs.map(([x, y, id, shape, rotation]) => [x & 7, y & 7, id, shape, rotation]),
            [[2, 4, 4515, 11, 2], [5, 4, 4516, 11, 1], [4, 3, 4517, 10, 2]]);
        console.log('Native construction templates: all rooms and chair placements passed');
    } finally {
        CachePipeline.getStore().close();
    }
}
constructionTemplatesUseProjectCache().catch(error => { console.error(error); process.exitCode = 1; });
