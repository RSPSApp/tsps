import assert from "node:assert/strict";
import { test } from "node:test";

import { WebGPUInstances } from "../render/webgpu/instances";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

function fixture() {
    const builds: Array<{ resolve(data: any): void; reject(error: Error): void }> = [];
    const renderer: any = {
        osrsClient: { loadedCache: {}, clientPlugins: { objectSettings: () => ({}) }, clearMinimapImageUrls() {} },
        addedLocs: new Map(), locOverrides: new Map(), locSpawns: new Map(),
        loadSceneData: () => new Promise((resolve, reject) => builds.push({ resolve, reject })),
        getExtraLocs: () => undefined,
    };
    return { renderer, builds, instances: new WebGPUInstances(renderer) };
}

test("instance streaming stays busy from its initial delay through GPU upload", async () => {
    const { renderer, builds, instances } = fixture();
    assert.equal(instances.hasPendingWork(), false);
    const loading = instances.load([[[1]]], 100, 100);
    assert.equal(builds.length, 0, "loc packets have a turn to arrive before the worker starts");
    assert.equal(instances.hasPendingWork(), true, "the initial deferred build is pending work");
    await settle();
    assert.equal(builds.length, 1);
    assert.equal(instances.hasPendingWork(), true, "the worker is still building");
    const scene = { mapX: 12, mapY: 12 } as any;
    builds[0].resolve(scene);
    await loading;
    assert.equal(instances.hasPendingWork(), true, "a completed scene still awaits GPU upload");
    assert.equal(instances.takeBuiltScene(), scene);
    assert.equal(instances.hasPendingWork(), false);

    renderer.osrsClient.loadedCache = undefined;
    await instances.load([[[2]]], 100, 100);
    assert.equal(instances.hasPendingWork(), false, "a load without a cache creates no pending work");
});

test("scheduled instance rebuilds stay busy and clear safely while work is in flight", async () => {
    const { builds, instances } = fixture();
    const canceled = instances.load([[[1]]], 100, 100);
    instances.clear();
    await canceled;
    assert.equal(builds.length, 0, "clear cancels an initial build before it reaches the worker");
    assert.equal(instances.hasPendingWork(), false);

    const loading = instances.load([[[2]]], 100, 100);
    await settle();
    builds[0].resolve({ mapX: 12, mapY: 12 });
    await loading;
    instances.takeBuiltScene();
    instances.scheduleLocRebuild();
    instances.scheduleLocRebuild();
    assert.equal(instances.hasPendingWork(), true, "the debounced rebuild timer is pending work");
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(builds.length, 2, "loc bursts create one worker build");
    instances.clear();
    assert.equal(instances.hasPendingWork(), true, "a superseded worker is still running");
    builds[1].resolve({ mapX: 12, mapY: 12 });
    await settle();
    assert.equal(instances.takeBuiltScene(), null, "clear rejects the old worker result");
    assert.equal(instances.hasPendingWork(), false, "the cleared worker releases its pending count");

    instances.scheduleLocRebuild();
    instances.clear();
    assert.equal(instances.hasPendingWork(), false, "clear also removes scheduled rebuild work");
});

test("superseded instance builds cannot hide newer work or replace the completed scene", async () => {
    const { builds, instances } = fixture();
    const first = instances.load([[[1]]], 100, 100);
    await settle();
    const second = instances.load([[[2]]], 100, 100);
    await settle();
    const latest = { mapX: 12, mapY: 12, version: "latest" } as any;
    builds[1].resolve(latest);
    await second;
    assert.equal(instances.takeBuiltScene(), latest);
    assert.equal(instances.hasPendingWork(), true, "the older worker still counts after the latest scene is uploaded");
    builds[0].resolve({ mapX: 12, mapY: 12, version: "stale" });
    await first;
    assert.equal(instances.takeBuiltScene(), null);
    assert.equal(instances.hasPendingWork(), false);
});

test("failed instance builds release pending state and can be retried", async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(console, "warn", () => {});
    const { builds, instances } = fixture();
    const failed = instances.load([[[1]]], 100, 100);
    await settle();
    builds[0].reject(new Error("worker failed"));
    await failed;
    assert.equal(instances.hasPendingWork(), false);

    const retry = instances.load([[[1]]], 100, 100);
    await settle();
    builds[1].resolve({ mapX: 12, mapY: 12 });
    await retry;
    assert.equal(instances.hasPendingWork(), true);
    instances.clear();
    assert.equal(instances.hasPendingWork(), false, "clear discards completed scenes awaiting upload");
});
