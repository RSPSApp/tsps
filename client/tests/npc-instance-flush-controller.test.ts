import assert from "node:assert/strict";

import { NpcEcs } from "../game/ecs/NpcEcs";
import { NpcInstanceFlushController } from "../game/npc/NpcInstanceFlushController";
import { addUnbatchedNpcRenderData } from "../render/render/draw";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error("Timed out waiting for NPC geometry flush");
}

async function staleAppearanceRefreshIsNeverApplied(): Promise<void> {
    const firstGeometry = deferred<any>();
    const instanceSnapshots: number[] = [];
    const appliedGeometry: number[] = [];
    let latestTypeId = -1;
    let geometryCalls = 0;

    const map = {
        refreshNpcGeometry: (...args: any[]) => {
            appliedGeometry.push(args.at(-1).appearanceVersion);
        },
    };
    const mapManager = {
        currentMapX: 1,
        currentMapY: 2,
        worldEntityMapIds: new Set<number>(),
        isMapInCurrentGrid: () => true,
        getMap: () => map,
        loadMap: () => undefined,
    };
    const workerPool = {
        setNpcInstances: async (instances: Array<{ typeId: number }>) => {
            latestTypeId = instances[0]?.typeId ?? -1;
            instanceSnapshots.push(latestTypeId);
        },
        queueNpcGeometry: () => {
            geometryCalls++;
            if (geometryCalls === 1) return firstGeometry.promise;
            return Promise.resolve({
                mapX: 1,
                mapY: 2,
                appearanceVersion: latestTypeId,
                loadedTextures: new Map(),
                vertices: new Uint8Array(),
                indices: new Int32Array(),
                npcs: [],
            });
        },
    };
    const renderer = {
        app: {},
        npcProgram: {},
        textureArray: {},
        textureMaterials: {},
        waterTextures: {},
        sceneUniformBuffer: {},
        mapManager,
        maxLevel: 3,
        loadedTextureIds: new Set<number>(),
        updateTextureArray: () => undefined,
    };
    const controller = new NpcInstanceFlushController({
        getRenderer: () => renderer,
        workerPool,
        getSeqTypeLoader: () => ({}),
        getSeqFrameLoader: () => ({}),
        getNpcTypeLoader: () => ({ load: () => ({}) }),
        getBasTypeLoader: () => ({}),
    } as any);

    const mapId = (1 << 8) | 2;
    const instance = { serverId: 1, typeId: 1, x: 64, y: 128, level: 0 };
    controller.instanceMap.set("sid:1", instance);
    controller.markMapPendingReload(mapId);
    controller.scheduleFlush();

    await waitFor(() => geometryCalls === 1);

    instance.typeId = 2;
    controller.markMapPendingReload(mapId);
    controller.scheduleFlush();
    firstGeometry.resolve({
        mapX: 1,
        mapY: 2,
        appearanceVersion: 1,
        loadedTextures: new Map(),
        vertices: new Uint8Array(),
        indices: new Int32Array(),
        npcs: [],
    });

    await waitFor(() => appliedGeometry.length === 1);

    assert.deepEqual(instanceSnapshots, [1, 2]);
    assert.deepEqual(appliedGeometry, [2]);
    assert.equal(controller.mapsPendingReload.size, 0);
}

function serverSpawnRendersBeforeMapBatchRefresh(): void {
    const unbatchedMap = {
        mapX: 50,
        mapY: 50,
        npcEntityIds: [] as number[],
        drawCallNpc: undefined,
        getLocalTileSpan: () => 64,
        getRenderBaseTileX() {
            return this.mapX * 64;
        },
        getRenderBaseTileY() {
            return this.mapY * 64;
        },
    };
    const existingMap = {
        mapX: 51,
        mapY: 50,
        npcEntityIds: [2, 3],
        drawCallNpc: {},
        getLocalTileSpan: () => 64,
        getRenderBaseTileX() {
            return this.mapX * 64;
        },
        getRenderBaseTileY() {
            return this.mapY * 64;
        },
    };
    const mapByNpc = new Map<number, any>([
        [1, unbatchedMap],
        [2, existingMap],
        // NPC 3 walked into the unbatched map; the existing map's batch still lists it.
        [3, unbatchedMap],
    ]);
    const ecs = {
        getServerLinkedEcsIds: () => [1, 2, 3],
        getWorldViewId: () => -1,
        getNpcTypeId: (id: number) => 100 + id,
        getMapX: (id: number) => mapByNpc.get(id).mapX,
        getMapY: (id: number) => mapByNpc.get(id).mapY,
        // World positions, 1/128 tile: (64 + id * 128, 192 + id * 128) inside the owning map.
        getWorldX: (id: number) => mapByNpc.get(id).mapX * 64 * 128 + 64 + id * 128,
        getWorldY: (id: number) => mapByNpc.get(id).mapY * 64 * 128 + 192 + id * 128,
        getLevel: () => 0,
        getRotation: () => 0,
        getServerId: (id: number) => 500 + id,
        getColorOverride: () => ({
            hue: 0,
            sat: 0,
            lum: 0,
            amount: 0,
            startCycle: 0,
            endCycle: 0,
        }),
    };
    const host = {
        unifiedActorData: true,
        loadNpcs: true,
        actorRenderCount: 0,
        actorRenderData: new Uint16Array(16 * 8),
        unbatchedNpcRenderEntries: [] as any[],
        osrsClient: { npcEcs: ecs },
        mapManager: {
            visibleMapCount: 2,
            visibleMaps: [unbatchedMap, existingMap],
        },
        getEffectiveNpcType: () => ({}),
        // As in the renderer, a map draws an NPC only when it owns it: NPC 2 has a
        // valid map draw entry, while NPC 3's stale batch entry is suppressed, so
        // NPCs 1 and 3 must use the immediate path from the map that owns them.
        shouldRenderNpcFromMap: (map: any, id: number) => mapByNpc.get(id) === map,
        smoothed: new Set<number>(),
        isNpcSmoothed(id: number) {
            return this.smoothed.has(id);
        },
    };

    addUnbatchedNpcRenderData(host as any);

    assert.equal(host.actorRenderCount, 2);
    assert.deepEqual(
        host.unbatchedNpcRenderEntries.map((entry) => entry.ecsId),
        [1, 3],
    );
    assert.deepEqual(
        host.unbatchedNpcRenderEntries.map((entry) => entry.dataOffset),
        [0, 1],
    );

    // Animation smoothing draws NPC 2 through this path too, though its map's batch has it.
    host.smoothed.add(2);
    host.actorRenderCount = 0;
    addUnbatchedNpcRenderData(host as any);
    assert.deepEqual(
        host.unbatchedNpcRenderEntries.map((entry) => entry.ecsId),
        [1, 2, 3],
    );
}

/**
 * An instance scene is one map that isn't streamed: the map manager has no current map and
 * the scene's map is never "in the grid". Its NPCs must still be refreshed into it, or they
 * are never in its update list (no animation or facing) - the Gauntlet's monsters.
 */
async function instanceSceneNpcsAreRefreshed(): Promise<void> {
    const applied: number[] = [];
    const map = { refreshNpcGeometry: () => applied.push(1), getRenderBaseTileX: () => 8160, getRenderBaseTileY: () => 1600 };
    let renderBase: unknown;
    const renderer = {
        app: {}, npcProgram: {}, textureArray: {}, textureMaterials: {}, waterTextures: {}, sceneUniformBuffer: {},
        instanceActive: true,
        instanceSceneMap: { mapX: 128, mapY: 25 },
        mapManager: {
            currentMapX: -1,
            currentMapY: -1,
            worldEntityMapIds: new Set<number>(),
            isMapInCurrentGrid: () => false,
            getMap: () => map,
            loadMap: () => undefined,
        },
        maxLevel: 3,
        loadedTextureIds: new Set<number>(),
        updateTextureArray: () => undefined,
    };
    const controller = new NpcInstanceFlushController({
        getRenderer: () => renderer,
        workerPool: {
            setNpcInstances: async () => undefined,
            queueNpcGeometry: (...args: any[]) => {
                renderBase = args[4];
                return Promise.resolve({ mapX: 128, mapY: 25, loadedTextures: new Map(), vertices: new Uint8Array(), indices: new Int32Array(), npcs: [] });
            },
        },
        getSeqTypeLoader: () => ({}),
        getSeqFrameLoader: () => ({}),
        getNpcTypeLoader: () => ({ load: () => ({}) }),
        getBasTypeLoader: () => ({}),
    } as any);
    controller.instanceMap.set("sid:7", { serverId: 7, typeId: 9028, x: 8250, y: 1700, level: 1, ownerMapId: (128 << 8) | 25 });
    controller.markMapPendingReload((128 << 8) | 25);
    controller.scheduleFlush();
    await waitFor(() => applied.length === 1);
    assert.deepEqual(renderBase, { x: 8160, y: 1600 }, "built from where the scene is drawn");
}

/** Deleting an instance scene map keeps its server NPCs for the rebuilt copy. */
function instanceSceneRebuildKeepsServerNpcs(): void {
    const ecs = new NpcEcs();
    const id = ecs.createNpc(128, 25, 9028, 2, 0, 0, 1, 0, 0, 0);
    ecs.setServerMapping(id, 7);
    ecs.destroyNpcsForMap(128, 25, true);
    assert.ok(ecs.isActive(id) && ecs.getEcsIdForServer(7) === id, "kept for the rebuilt scene");
    ecs.destroyNpcsForMap(128, 25);
    assert.ok(!ecs.isActive(id), "a world square unloading still takes its NPCs");
}

async function run(): Promise<void> {
    await staleAppearanceRefreshIsNeverApplied();
    await instanceSceneNpcsAreRefreshed();
    instanceSceneRebuildKeepsServerNpcs();
    serverSpawnRendersBeforeMapBatchRefresh();
}

void run()
    .then(() => {
        console.log("NPC visibility and refresh regression tests passed");
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
