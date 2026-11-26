import assert from "node:assert/strict";
import { test } from "node:test";
import { clearWorldOverlays, loadFromPayload, getWorldLocChanges, getWorldLocSpawns, getWorldTerrainOverrides, getMapWarpActions } from "../common/gamemode/GamemodeContentStore";

test("partial content updates preserve other world datasets; explicit empty datasets clear only their owner", () => {
    const changes = [{ oldId: 1, newId: 2, x: 3200, y: 3200, level: 0 }];
    const spawns = [{ locId: 3, x: 3201, y: 3200, level: 0, shape: 10, rotation: 0 }];
    const terrain = [{ x: 3200, y: 3200, level: 0, overlay: 4 }];
    loadFromPayload({ gamemodeId: "world", datasets: [
        { key: "worldLocChanges", rows: changes }, { key: "worldLocSpawns", rows: spawns },
        { key: "worldTerrainOverrides", rows: terrain },
    ] });
    loadFromPayload({ gamemodeId: "seasonal", datasets: [{ key: "definitionArchives", rows: [] }] });
    assert.deepEqual(getWorldLocChanges(), changes);
    assert.deepEqual(getWorldLocSpawns(), spawns);
    assert.deepEqual(getWorldTerrainOverrides(), terrain);
    loadFromPayload({ gamemodeId: "world", datasets: [{ key: "worldLocSpawns", rows: [] }] });
    assert.deepEqual(getWorldLocSpawns(), []);
    assert.deepEqual(getWorldLocChanges(), changes);
    assert.deepEqual(getWorldTerrainOverrides(), terrain);
    clearWorldOverlays();
    assert.deepEqual(getWorldLocChanges(), []);
    assert.deepEqual(getWorldLocSpawns(), []);
    assert.deepEqual(getWorldTerrainOverrides(), []);
});

test("warp menu options apply to the exact placement and clear on reconnect", () => {
    loadFromPayload({ gamemodeId: "world", datasets: [
        { key: "mapWarpActions", rows: [{ id: 50, op: 1, from: [3200, 3200, 0], actionLabel: "Climb down" }] },
        { key: "mapWarpActionsAppend", rows: [{ id: 50, op: 4, from: [3200, 3200, 0], actionLabel: "Enter" }] },
    ] });
    assert.deepEqual([...getMapWarpActions(50, 3200, 3200, 0)!], [[0, "Climb down"], [3, "Enter"]]);
    assert.equal(getMapWarpActions(51, 3200, 3200, 0), undefined);
    assert.equal(getMapWarpActions(50, 3201, 3200, 0), undefined);
    assert.equal(getMapWarpActions(50, 3200, 3200, 1), undefined);
    clearWorldOverlays();
    assert.equal(getMapWarpActions(50, 3200, 3200, 0), undefined);
});
