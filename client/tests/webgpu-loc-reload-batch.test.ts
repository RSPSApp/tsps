import "./browser-self";
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import Denque from "denque";

import { LocUpdates } from "../render/webgpu/locUpdates";

require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
const { WebGPURenderer } = require("../render/webgpu/WebGPURenderer");
const { WebGPUMapSquare } = require("../render/webgpu/WebGPUMapSquare");

// Guidor's gate (#1826): its closed leaves stand at x 3264 (square 51) and its open leaves at
// x 3262-3263 (square 50). One tick swaps them, but each square rebuilt on its own, so for a
// moment the gate was both open and shut, or neither.
const CLOSED = { x: 3264, y: 3405 };
const OPEN = { x: 3263, y: 3405 };
const gate = { name: "Gate", actions: ["Open"], seqId: -1 };
const openLeaf = { name: "null", actions: [], seqId: -1 };

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

test("one tick's changes in two squares reload them as one batch", async () => {
    const reloads: Array<{ square: string; group: string; batch: unknown }> = [];
    const renderer: any = {
        instanceActive: false,
        addedLocs: new Map(), locOverrides: new Map(), locSpawns: new Map(),
        mapManager: { getMap: () => ({}), getMapForWorldTile: () => undefined, loadingMapIds: new Set<number>() },
        osrsClient: { locTypeLoader: { load: (id: number) => (id === 2052 ? openLeaf : gate) } },
        queueLocReload: (mapX: number, mapY: number, group: string, batch: unknown) =>
            reloads.push({ square: `${mapX},${mapY}`, group, batch }),
    };
    const updates = new LocUpdates(renderer);
    updates.onLocAddChange(2050, CLOSED, 0, 0, 0);
    updates.onLocAddChange(2052, OPEN, 0, 0, 3);
    await flush();
    assert.deepEqual(reloads.map(({ square, group }) => `${square} ${group}`), ["51,53 door", "50,53 loc"]);
    assert.ok(reloads[0].batch, "the squares share a batch");
    assert.equal(reloads[0].batch, reloads[1].batch);
    assert.equal((reloads[0].batch as any).remaining, 2);

    reloads.length = 0;
    updates.onLocDel(OPEN, 0, 0, 3);
    await flush();
    assert.equal(reloads.length, 1);
    assert.equal(reloads[0].batch, undefined, "a change in one square needs no batch");
    updates.dispose();
});

function rendererFixture() {
    const applied: string[] = [];
    const builds = new Map<string, () => void>();
    const square = (mapX: number, mapY: number) => ({
        refreshPartial: (data: any) => applied.push(`${mapX},${mapY} ${data.doorOnly ? "door" : "loc"}`),
    });
    const squares = new Map([["50,53", square(50, 53)], ["51,53", square(51, 53)]]);
    const renderer: any = {
        mapLoadEpoch: 0, instanceActive: false, mapsToLoad: new Denque(), device: {},
        world: { uploadMapTextures() {} },
        osrsClient: { loadedCache: {}, seqTypeLoader: {} },
        mapManager: { getMap: (x: number, y: number) => squares.get(`${x},${y}`), loadingMapIds: new Set<number>() },
        locUpdates: { isCurrent: () => true, applied() {} },
        overlays: { onMapLocsRefreshed() {}, onMapAdded() {} },
        ui: { registerMinimapData() {} },
        // A worker build: finishes when the test says so, then hands its result over as
        // loadMapData does (to the batch, or straight to the upload queue).
        loadMapData(mapX: number, mapY: number, _gen: unknown, partial: string, batch: any) {
            return new Promise<void>((resolve) => builds.set(`${mapX},${mapY}`, () => {
                const queued = { mapData: { mapX, mapY, doorOnly: partial === "door", locOnly: partial === "loc" }, locVersion: 0 };
                if (batch) batch.ready.push(queued);
                else this.mapsToLoad.push(queued);
                resolve();
            }));
        },
    };
    for (const name of ["queueLocReload", "settleLocReloadBatch", "applyReadyMaps", "applyLocReloadBatch", "applyQueuedMap"]) {
        renderer[name] = WebGPURenderer.prototype[name];
    }
    const finish = async (square: string) => {
        builds.get(square)!();
        await new Promise<void>((resolve) => setImmediate(resolve));
    };
    return { renderer, applied, finish };
}

test("a batch's squares are applied in the same frame once all have built", async () => {
    const { renderer, applied, finish } = rendererFixture();
    const batch = { remaining: 2, ready: [] };
    renderer.queueLocReload(51, 53, "door", batch);
    renderer.queueLocReload(50, 53, "loc", batch);

    await finish("51,53");
    renderer.applyReadyMaps(1);
    assert.deepEqual(applied, [], "the closed leaves stay until the open ones are ready");
    assert.equal(renderer.mapsToLoad.length, 0);

    await finish("50,53");
    renderer.applyReadyMaps(2);
    assert.deepEqual(applied, ["51,53 door", "50,53 loc"], "both squares change in one frame");
    assert.equal(renderer.mapsToLoad.length, 0);
});

test("a batch waits for every whole-square upload before applying any of it", async (t) => {
    const { renderer, applied } = rendererFixture();
    let uploaded = false;
    t.mock.method(WebGPUMapSquare, "prepareLoad", () => uploaded);
    const loaded: string[] = [];
    t.mock.method(WebGPUMapSquare, "load", (_device: unknown, _world: unknown, data: any) => {
        loaded.push(`${data.mapX},${data.mapY}`);
        return { initAnimatedLocs() {} };
    });
    renderer.mapManager.removeMap = () => {};
    renderer.mapManager.addMap = () => {};
    renderer.worldEntityOverlays = new Map();
    const batch = { remaining: 2, ready: [], epoch: 0 };
    batch.ready.push(
        { mapData: { mapX: 51, mapY: 53, doorOnly: true }, locVersion: 0 },
        { mapData: { mapX: 50, mapY: 53 }, locVersion: 0 },
    );
    renderer.settleLocReloadBatch(batch);
    renderer.settleLocReloadBatch(batch);
    assert.equal(renderer.mapsToLoad.length, 2);

    renderer.applyReadyMaps(1);
    assert.deepEqual([...applied, ...loaded], [], "the door-only square waits for its neighbour's upload");
    uploaded = true;
    renderer.applyReadyMaps(2);
    assert.deepEqual(applied, ["51,53 door"]);
    assert.deepEqual(loaded, ["50,53"]);
});

test("a batch started before a scene reset is dropped", async () => {
    const { renderer, applied, finish } = rendererFixture();
    const batch = { remaining: 2, ready: [] };
    renderer.queueLocReload(51, 53, "door", batch);
    renderer.queueLocReload(50, 53, "loc", batch);
    await finish("51,53");
    renderer.mapLoadEpoch++;
    await finish("50,53");
    renderer.applyReadyMaps(1);
    assert.deepEqual(applied, []);
    assert.equal(renderer.mapsToLoad.length, 0);
});
