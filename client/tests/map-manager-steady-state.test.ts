import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientState } from "../game/ClientState";
import { MapManager } from "../game/MapManager";
import { getMapSquareId } from "../rs/map/MapFileIndex";

const square = (mapX: number, mapY: number) => ({ mapX, mapY, canRender: () => true, delete() {} });

test("resident maps need no per-frame map writes or retry lookups while the camera moves", () => {
    const instance = ClientState.inInstance;
    const lowEnd = MapManager.lowEnd;
    const originalSet = Map.prototype.set;
    try {
        ClientState.inInstance = false;
        MapManager.lowEnd = false;
        let loads = 0, frame = 0, writes = 0, retryLookups = 0;
        const manager = new MapManager<any>(4, () => loads++);
        const camera = { getPosX: () => 3232 + Math.sin(frame) * 25,
            getPosZ: () => 3232 + Math.cos(frame) * 25 } as any;
        manager.update(3232, 3232, camera, 0, 1, 3180, 3180);
        const ids = manager.getGridMapIdsSnapshot();
        for (const id of ids) manager.addMap(id >> 8, id & 255, square(id >> 8, id & 255));
        manager.update(3232, 3232, camera, 1, 1, 3180, 3180);
        const retry = (manager as any).mapLoadRetryAfter as Map<number, number>;
        const originalGet = retry.get;
        retry.get = function (key) { retryLookups++; return originalGet.call(this, key); };
        Map.prototype.set = function (key, value) { writes++; return originalSet.call(this, key, value); };
        for (frame = 2; frame <= 61; frame++) {
            manager.update(3232, 3232, camera, frame, 1, 3180, 3180);
            assert.equal(manager.visibleMapCount, ids.length);
            assert.equal(manager.isSceneReady(frame), true);
        }
        assert.equal(loads, ids.length, "camera movement must retain the resident scene");
        assert.equal(retryLookups, 0, "resident squares have no retry decision to make");
        assert.equal(writes, 0, "retained scenery needs no LRU table when nothing evicts from it");
    } finally {
        Map.prototype.set = originalSet;
        ClientState.inInstance = instance;
        MapManager.lowEnd = lowEnd;
    }
});

test("only failed loads read the clock and retry backoff survives pending/resident/invalid guards", () => {
    const originalNow = Date.now;
    let now = 1000, clockReads = 0, loads = 0;
    Date.now = () => { clockReads++; return now; };
    try {
        const manager = new MapManager<any>(1, () => loads++);
        const id = getMapSquareId(37, 48);
        manager.loadMap(37, 48);
        assert.equal(loads, 1);
        manager.loadMap(37, 48);
        assert.equal(clockReads, 0, "new and pending loads have no retry deadline");
        manager.deferFailedMapLoad(37, 48);
        now = 1249;
        manager.loadMap(37, 48, true);
        assert.equal(loads, 1, "force reload also respects failure backoff");
        now = 1250;
        manager.loadMap(37, 48);
        assert.equal(loads, 2);
        now = 2000;
        manager.loadMap(37, 48);
        assert.equal(loads, 2, "a retry already in flight is not duplicated as time advances");
        manager.deferFailedMapLoad(37, 48);
        now = 2499;
        manager.loadMap(37, 48);
        assert.equal(loads, 2, "the second failure waits 500 ms");
        now = 2500;
        manager.loadMap(37, 48);
        assert.equal(loads, 3);
        manager.addMap(37, 48, square(37, 48));
        now = 3000;
        manager.loadMap(37, 48);
        assert.equal(loads, 3, "a completed retry remains resident");
        manager.removeMap(37, 48);
        manager.loadMap(37, 48);
        assert.equal(loads, 4, "successful loads clear the failure deadline");
        manager.addInvalidMap(37, 48);
        const reads = clockReads;
        now = 10000;
        manager.loadMap(37, 48, true);
        assert.equal(loads, 4);
        assert.equal(manager.loadingMapIds.has(id), false);
        assert.equal(clockReads, reads, "invalid squares have no deadline to check");
    } finally {
        Date.now = originalNow;
    }
});

test("a teleport's square is ready only once the grid drawn includes it (issue #2017)", () => {
    const instance = ClientState.inInstance;
    const lowEnd = MapManager.lowEnd;
    try {
        ClientState.inInstance = false;
        MapManager.lowEnd = false;
        const manager = new MapManager<any>(4, () => {});
        const camera = { getPosX: () => 3232, getPosZ: () => 3232 } as any;
        manager.update(3232, 3232, camera, 0, 1, 3180, 3180);
        for (const id of manager.getGridMapIdsSnapshot()) manager.addMap(id >> 8, id & 255, square(id >> 8, id & 255));
        manager.update(3232, 3232, camera, 1, 1, 3180, 3180);
        assert.equal(manager.isSquareReadyAt(3232, 3232, 1), true);

        // Lunar Isle: the player's own square builds first, the rest of the view after it.
        const far = { getPosX: () => 2094, getPosZ: () => 3913 } as any;
        manager.update(2094, 3913, far, 2, 1, 2042, 3861);
        assert.equal(manager.isSquareReadyAt(2094, 3913, 2), false, "nothing built there yet");
        const ids = manager.getGridMapIdsSnapshot();
        const own = getMapSquareId(Math.floor(2094 / 64), Math.floor(3913 / 64));
        manager.addMap(own >> 8, own & 255, square(own >> 8, own & 255));
        manager.update(2094, 3913, far, 3, 1, 2042, 3861);
        assert.equal(manager.isSquareReadyAt(2094, 3913, 3), false,
            "built, but the old grid is still the one drawn until the rest of the view is");
        for (const id of ids) if (id !== own) manager.addMap(id >> 8, id & 255, square(id >> 8, id & 255));
        manager.update(2094, 3913, far, 4, 1, 2042, 3861);
        assert.equal(manager.isSquareReadyAt(2094, 3913, 4), true);
    } finally {
        ClientState.inInstance = instance;
        MapManager.lowEnd = lowEnd;
    }
});
