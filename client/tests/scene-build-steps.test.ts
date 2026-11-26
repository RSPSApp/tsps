import assert from "node:assert/strict";
import { test } from "node:test";
import { BuildSteps, finishBuild } from "../common/utils/BuildSteps";
import { Scene } from "../rs/scene/Scene";
import { SceneTile } from "../rs/scene/SceneTile";
import { SceneTileModel } from "../rs/scene/SceneTileModel";
import { SceneBuffer } from "../render/buffer/SceneBuffer";

test("worker steps accept cancellation between units and release unfinished state", async (t) => {
    let clock = 0, units = 0, released = false;
    t.mock.method(performance, "now", () => clock);
    const controller = new AbortController();
    function* build() {
        try {
            for (let i = 0; i < 100; i++) { units++; clock += 4; yield; }
            return "complete";
        } finally { released = true; }
    }
    const work = new BuildSteps(controller.signal).run(build());
    assert.equal(units, 2, "pause after the time budget, before draining the whole square");
    controller.abort();
    await assert.rejects(work, { name: "AbortError" });
    assert.equal(units, 2, "cancellation must not process another unit");
    assert.equal(released, true);
});

test("8x8 terrain steps retain exact geometry, both LODs and border coordinates", async () => {
    const size = 16, border = 6;
    const scene = new Scene(4, size + border * 2, size + border * 2);
    for (let x = 0; x < scene.sizeX; x++) for (let y = 0; y < scene.sizeY; y++) {
        const tile = new SceneTile(0, x, y);
        tile.tileModel = new SceneTileModel(0, 0, -1, x, y, 0, 0, 0, 0,
            96, 96, 96, 96, 10000, 10000, 10000, 10000, 10000, 10000, 0, 0);
        scene.tiles[0][x][y] = tile;
    }
    const whole = new SceneBuffer({} as any, new Map(), 128);
    const stepped = new SceneBuffer({} as any, new Map(), 128);
    const expected = whole.addTerrain(scene, border, 3, size);
    const steps = stepped.addTerrainSteps(scene, border, 3, size);
    assert.equal(steps.next().done, false);
    assert.equal(stepped.indices.length, 0, "the first chunk is a deferred work unit");
    steps.next();
    assert.equal(stepped.drawCommands.length, 1);
    assert.deepEqual(stepped.drawCommands[0].chunk, [0, 0]);
    assert.equal(stepped.drawCommands[0].elements, 8 * 8 * 6, "one step packs one 8x8 chunk");
    assert.equal(await new BuildSteps().run(steps), expected);
    assert.deepEqual(stepped.vertexBuf.byteArray(), whole.vertexBuf.byteArray());
    assert.deepEqual(stepped.indices, whole.indices);
    assert.deepEqual(stepped.drawCommands, whole.drawCommands);
    assert.deepEqual(stepped.drawCommandsLod, whole.drawCommandsLod);
});


test("warm complete square builds preserve every geometry byte and scene metadata", async () => {
    const { CacheSystem } = await import("../rs/cache/CacheSystem");
    const { getCacheLoaderFactory } = await import("../rs/cache/loader/CacheLoaderFactory");
    const { LocModelLoader } = await import("../rs/config/loctype/LocModelLoader");
    const { VarManager } = await import("../rs/config/vartype/VarManager");
    const { SceneBuilder } = await import("../rs/scene/SceneBuilder");
    const { MinimapImageRenderer } = await import("../rs/map/MinimapImageRenderer");
    const { SdMapDataLoader } = await import("../render/loader/SdMapDataLoader");
    const { Hasher } = await import("../common/utils/Hasher");
    const { loadCache, loadCacheInfos, loadCacheList } = await import("../scripts/cache/load-util");
    await Hasher.init();
    const cache = loadCache(loadCacheList(loadCacheInfos()).latest);
    const cacheSystem = CacheSystem.fromFiles(cache.info, cache.files);
    const factory = getCacheLoaderFactory(cache.info, cacheSystem);
    const locTypeLoader = factory.getLocTypeLoader(), textureLoader = factory.getTextureLoader();
    const locModelLoader = new LocModelLoader(locTypeLoader, factory.getModelLoader(), textureLoader,
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    const state: any = { cache, cacheSystem, locTypeLoader, textureLoader, locModelLoader,
        varManager: new VarManager(factory.getVarBitTypeLoader()), npcInstances: [],
        sceneBuilder: new SceneBuilder(cache.info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
            factory.getOverlayTypeLoader(), locTypeLoader, locModelLoader, cache.xteas),
        minimapImageRenderer: new MinimapImageRenderer(locTypeLoader, factory.getMapScenes()),
    };
    const loader = new SdMapDataLoader();
    const input = { mapX: 50, mapY: 50, maxLevel: 3, loadNpcs: false, smoothTerrain: true,
        minimizeDrawCalls: true, minimapLevel: 0, loadedTextureIds: new Set<number>() };
    const immediate = new BuildSteps();
    immediate.run = async steps => finishBuild(steps);
    await loader.load(state, input, immediate);
    const expected = await loader.load(state, input, immediate);
    const actual = await loader.load(state, input, new BuildSteps());
    assert.deepEqual(actual.data, expected.data, "yielding cannot change geometry, minimaps, bridge flags or picking metadata");

    const far = await loader.load(state, { ...input, farOnly: true }, immediate);
    assert.ok(far.data?.farOnly);
    assert.equal(far.data.locsAnimated.length, 0, "horizon scenery does not bake animated meshes");
    assert.equal(far.data.terrainPickVertices.length, 0);
    assert.equal(far.data.tileLocIdsByLevel.length, 0, "horizon scenery has no interaction or sound-emitter catalog");
    const fullBytes = actual.transferables.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    const farBytes = far.transferables.reduce((sum, buffer) => sum + buffer.byteLength, 0);
    assert.ok(farBytes < fullBytes, "the real cache region's far payload uses fewer bytes");
    structuredClone(far.data, { transfer: far.transferables });
    console.log(`Distant World region 50,50 worker payload: full=${fullBytes}, far=${farBytes} bytes`);

    const castleInput = { ...input, mapX: 37, mapY: 48,
        extraLocs: [{ id: 4444, x: 2411, y: 3080, level: 0, shape: 4, rotation: 0 }] };
    const castle = await loader.load(state, castleInput, immediate);
    const ropeReload = await loader.load(state, { ...castleInput, locOnly: true }, immediate);
    // A loc-only reload packs the scenery chunk by chunk, so its vertices are numbered and
    // ordered differently from a whole build's: compare the lit triangles they draw.
    const litTriangles = (loc: { vertices: Uint8Array; indices: Int32Array }) => {
        const words = new Int32Array(loc.vertices.buffer, loc.vertices.byteOffset, loc.vertices.byteLength >> 2);
        const out: string[] = [];
        for (let i = 0; i < loc.indices.length; i += 3) {
            out.push([0, 1, 2].map((corner) => {
                const at = loc.indices[i + corner] * 3;
                return `${words[at]},${words[at + 1]},${words[at + 2]}`;
            }).join("|"));
        }
        return out.sort();
    };
    const castleTriangles = litTriangles(castle.data!.loc);
    assert.ok(castleTriangles.length > 1000, "the castle square draws scenery");
    assert.deepEqual(litTriangles(ropeReload.data!.loc), castleTriangles,
        "a rope's loc-only reload keeps the castle's merged wall lighting");
    // Reloading again reuses the chunks the first reload packed, and draws the same.
    const secondReload = await loader.load(state, { ...castleInput, locOnly: true }, immediate);
    assert.deepEqual(litTriangles(secondReload.data!.loc), castleTriangles, "reused chunks draw what packed ones did");
    const farRequestedPartial = await loader.load(state, { ...castleInput, locOnly: true, farOnly: true }, immediate);
    assert.equal(farRequestedPartial.data?.farOnly, undefined, "partial updates cannot turn detailed locs into an unpickable horizon");
    assert.deepEqual(farRequestedPartial.data?.loc, ropeReload.data?.loc);
    assert.ok(farRequestedPartial.data!.tileLocIdsByLevel.length > 0);
});

test("pool skips cancelled queued jobs and forwards cancellation to a running worker", async () => {
    const { RenderDataWorkerPool } = await import("../game/worker/RenderDataWorkerPool");
    let dispatch!: (worker: any) => Promise<unknown>;
    const pool = new RenderDataWorkerPool({ queue: (task: typeof dispatch) => { dispatch = task; return {}; } } as any, [], 1);
    const queued = new AbortController();
    pool.queueLoad({} as any, {}, queued.signal);
    queued.abort();
    await assert.rejects(dispatch({ load: () => assert.fail("cancelled jobs never reach a worker") }), { name: "AbortError" });

    const active = new AbortController();
    let requestId: number | undefined, cancelId: number | undefined;
    let reject!: (reason: unknown) => void;
    pool.queueLoad({} as any, {}, active.signal);
    const pending = dispatch({
        load: (_loader: unknown, _input: unknown, id: number) => {
            requestId = id;
            return new Promise((_resolve, no) => { reject = no; });
        },
        cancelLoad: async (id: number) => { cancelId = id; reject(active.signal.reason); },
    });
    active.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(cancelId, requestId, "only the dispatched job is cancelled");
});

test("loc-only rebuilds of the world all run on the first worker, one at a time and after its builds", async () => {
    const { RenderDataWorkerPool } = await import("../game/worker/RenderDataWorkerPool");
    let queued = 0, scheduled = 0;
    const pool = { queue: () => { queued++; return {}; }, scheduleWork: () => { scheduled++; } };
    const log: string[] = [];
    const worker = (name: string) => {
        const thread = { load: async (_loader: unknown, input: { tag: string }) => { log.push(`${name} ${input.tag}`); return input.tag; }, cancelLoad: async () => {} };
        return { init: Promise.resolve(thread), runningTasks: [] as Promise<unknown>[] };
    };
    const first = worker("first"), second = worker("second");
    const workers = [first, second] as any;
    const pooled = new RenderDataWorkerPool(pool as any, workers, 2);

    // A build already running on the first worker: the loc-only one waits for it.
    let finishRunning!: () => void;
    const running = new Promise<void>((resolve) => { finishRunning = resolve; });
    // The pool takes a build off its worker's running tasks when it ends; so does this.
    void running.then(() => { first.runningTasks = first.runningTasks.filter((task) => task !== running); });
    first.runningTasks.push(running);
    const a = pooled.queueLoad({} as any, { locOnly: true, tag: "a" } as any) as unknown as Promise<string>;
    const b = pooled.queueLoad({} as any, { locOnly: true, tag: "b" } as any) as unknown as Promise<string>;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(log, [], "nothing starts while the worker is busy");
    assert.equal(first.runningTasks.length, 3, "the reservations keep the pool from handing the worker anything else");
    finishRunning();
    assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
    assert.deepEqual(log, ["first a", "first b"], "both ran on the first worker, in order");
    assert.equal(first.runningTasks.length, 0, "reservations are released");
    assert.ok(scheduled >= 2, "the pool is told the worker is free again");
    assert.equal(queued, 0, "loc-only rebuilds do not go through the pool's own queue");

    // Anything else keeps going through the pool: whole squares, instances, and boat decks.
    pooled.queueLoad({} as any, { tag: "full" } as any);
    pooled.queueLoad({} as any, { locOnly: true, instance: { templateChunks: [] }, tag: "instance" } as any);
    pooled.queueLoad({} as any, { locOnly: true, overrideRenderPos: { x: 0, y: 0 }, tag: "deck" } as any);
    assert.equal(queued, 3);

    // A single worker is the pool already.
    const single = new RenderDataWorkerPool(pool as any, [first] as any, 1);
    single.queueLoad({} as any, { locOnly: true, tag: "single" } as any);
    assert.equal(queued, 4);

    // A failed or cancelled build still releases its reservation.
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(pooled.queueLoad({} as any, { locOnly: true, tag: "x" } as any, cancelled.signal) as unknown as Promise<unknown>, { name: "AbortError" });
    assert.equal(first.runningTasks.length, 0);
});
