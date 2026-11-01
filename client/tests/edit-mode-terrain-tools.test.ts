import assert from "node:assert/strict";

import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { parseEditorLocation, regionBounds, regionIdOf } from "../game/plugins/editmode/EditorCoordinates";
import { MAX_REGION_PACK_PAYLOAD, buildRegionPack, oversizedRegionPacks, parseRegionPack } from "../game/plugins/editmode/RegionPack";
import { adjustHeightBytes } from "../game/plugins/editmode/TerrainHeight";
import type { EditModeEdit } from "../game/plugins/editmode/types";
import { getOverlayShapeTriangles } from "../rs/scene/SceneTileModel";

const area = (triangles: [number, number][][]): number => triangles.reduce((sum, [a, b, c]) =>
    sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);

// Shape geometry: the full tile fills, the diagonal halves, and rotation turns it clockwise.
assert.equal(area(getOverlayShapeTriangles(0, 0)), 1);
for (let rotation = 0; rotation < 4; rotation++) {
    assert.equal(area(getOverlayShapeTriangles(1, rotation)), 0.5, "a diagonal covers half the tile at every rotation");
}
const corners = (rotation: number): string => getOverlayShapeTriangles(1, rotation)[0].map(String).sort().join(" ");
assert.equal(new Set([0, 1, 2, 3].map(corners)).size, 4, "each rotation of a diagonal covers a different half");
for (let shape = 0; shape < 12; shape++) {
    const covered = area(getOverlayShapeTriangles(shape, 0));
    assert.ok(covered > 0 && covered <= 1, `shape ${shape} draws an overlay inside the tile`);
}

// Height: the block moves fully and the rings around it fall off towards nothing.
const flat = () => 10;
const raised = adjustHeightBytes({ minX: 5, maxX: 6, minY: 5, maxY: 6 }, 9, 2, flat);
const at = (x: number, y: number) => raised.find((vertex) => vertex.tileX === x && vertex.tileY === y)?.height;
assert.equal(at(5, 5), 19);
assert.equal(at(6, 6), 19);
assert.equal(at(4, 5), 16, "first ring takes two thirds");
assert.equal(at(3, 3), 13, "diagonals slope like the sides");
assert.equal(at(2, 5), undefined, "ground past the smoothing stays put");
const lowered = adjustHeightBytes({ minX: 5, maxX: 6, minY: 5, maxY: 6 }, -9, 2, flat);
assert.equal(lowered.find((vertex) => vertex.tileX === 4 && vertex.tileY === 5)?.height, 4, "lowering mirrors raising");

// Height limits: bytes stay in range, the unrepresentable 1 is skipped, unloaded vertices are left.
assert.deepEqual(adjustHeightBytes({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, -5, 0, () => 2), [{ tileX: 0, tileY: 0, height: 0 }]);
assert.deepEqual(adjustHeightBytes({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 1, 0, () => 0), [{ tileX: 0, tileY: 0, height: 2 }]);
assert.deepEqual(adjustHeightBytes({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, -1, 0, () => 2), [{ tileX: 0, tileY: 0, height: 0 }]);
assert.deepEqual(adjustHeightBytes({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 5, 0, () => 255), []);
assert.deepEqual(adjustHeightBytes({ minX: 0, maxX: 0, minY: 0, maxY: 0 }, 5, 0, () => undefined), []);

// Coordinates and regions.
assert.equal(regionIdOf(3222, 3218), 12850);
assert.deepEqual(regionBounds(12850), { minX: 3200, maxX: 3263, minY: 3200, maxY: 3263 });
assert.deepEqual(parseEditorLocation("3222, 3218"), { tileX: 3222, tileY: 3218 });
assert.deepEqual(parseEditorLocation("3222 3218 1"), { tileX: 3222, tileY: 3218, plane: 1 });
assert.deepEqual(parseEditorLocation("12850"), { tileX: 3232, tileY: 3232 });
for (const bad of ["", "abc", "1,2,3,4", "3222,3218,9", "99999", "-1,5", "20000,5"]) {
    assert.equal(parseEditorLocation(bad), undefined, `rejects ${JSON.stringify(bad)}`);
}

// Plugin wiring against a recording host.
const calls: unknown[][] = [];
const refreshes: number[][] = [];
let pointer = { tileX: 3222, tileY: 3218, plane: 0 };
const makePlugin = () => {
    const plugin = new EditModePlugin();
    plugin.attach({
        getCanvas: () => undefined,
        getPointerTile: () => pointer,
        getPointerLoc: () => undefined,
        isLoggedIn: () => true,
        setFreeCamera: () => {},
        cancelPendingClick: () => {},
        getTerrainHeight: () => -1,
        jumpCameraToTile: () => {},
        setTerrainOverlay: (tile: unknown, overlay: number, shape: number, rotation: number) =>
            calls.push(["paint", tile, overlay, shape, rotation]),
        clearTerrainOverride: (tile: unknown) => calls.push(["clearTerrain", tile]),
        onLocAddChange: (id: number) => calls.push(["add", id]),
        onLocDel: () => calls.push(["del"]),
        restoreLoc: () => calls.push(["restore"]),
        refreshEditedRegions: (regions: number[]) => refreshes.push(regions),
        selectTileRange: (start: any, end: any) => ({ ...start, tileEndX: end.tileX, tileEndY: end.tileY, locId: -1, locName: "" }),
    } as any);
    plugin.setConfig({ enabled: true, active: true, overlayId: 7 });
    return plugin;
};

// Painting uses the picked shape and rotation, and R turns it.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "terrain", overlayShape: 1, overlayRotation: 3 });
    plugin.applyAtPointer();
    assert.deepEqual(calls.at(-1), ["paint", pointer, 7, 1, 3]);
    plugin.rotate();
    assert.equal(plugin.getConfig().overlayRotation, 0);
    assert.equal(plugin.getConfig().rotation, 0, "rotating a tile shape leaves the loc rotation alone");
    plugin.setConfig({ overlayShape: 99 });
    assert.equal(plugin.getConfig().overlayShape, 11, "shapes stop at what the map format can store");
}

// A shaped overlay reaches the saved map: opcode 2 + shape * 4 + rotation.
{
    const terrain = new Uint8Array(64 * 64 * 4);
    const edit: EditModeEdit = { kind: "terrain", locId: 7, tileX: 3200, tileY: 3200, plane: 0, shape: 1, rotation: 3 };
    const pack = parseRegionPack(buildRegionPack((50 << 8) | 50, 40000, 39999, new Uint8Array([0]), terrain, [edit], false));
    assert.deepEqual(Array.from(pack.terrainData.subarray(0, 3)), [2 + 1 * 4 + 3, 7, 0]);
}

// Saving checks the limit the server loads regions under: 7 + terrain + objects, exactly at the edge.
{
    const pack = (objects: number) => {
        const terrain = new Uint8Array(64 * 64 * 4);
        const data = buildRegionPack((50 << 8) | 50, 40000, 39999, new Uint8Array(objects), terrain, [], false, false);
        return { regionId: (50 << 8) | 50, data };
    };
    const fits = MAX_REGION_PACK_PAYLOAD - 7 - 64 * 64 * 4;
    assert.deepEqual(oversizedRegionPacks([pack(fits)]), []);
    assert.deepEqual(oversizedRegionPacks([pack(fits + 1)]), [{ regionId: (50 << 8) | 50, payload: MAX_REGION_PACK_PAYLOAD + 1 }]);
}

// Undo: a multi-tile action goes as one step, and what was underneath comes back.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "terrain", overlayShape: 0 });
    plugin.applyAtPointer();
    plugin.setConfig({ overlayShape: 1 });
    plugin.applyAtPointer();
    calls.length = 0;
    assert.equal(plugin.undo(), true);
    assert.deepEqual(calls, [["clearTerrain", pointer], ["paint", pointer, 7, 0, 0]], "repainting a tile undoes to the old paint");
    assert.equal(plugin.undo(), true);
    assert.equal(plugin.getConfig().edits.length, 0);
    assert.equal(plugin.undo(), false);

    plugin.setConfig({ tool: "select" });
    plugin.applyAtPointer();
    plugin.selectRegion();
    const selection = plugin.getState().selection!;
    assert.deepEqual([selection.tileX, selection.tileY, selection.tileEndX, selection.tileEndY], [3200, 3200, 3263, 3263]);
    plugin.paintSelection();
    assert.equal(plugin.getConfig().edits.length, 64 * 64);
    assert.equal(plugin.undo(), true);
    assert.equal(plugin.getConfig().edits.length, 0, "painting a region is one undo");
}

// Redo: puts an undone action back whole, and a new edit ends the redo history.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "terrain", overlayShape: 0 });
    plugin.applyAtPointer();
    plugin.setConfig({ overlayShape: 1 });
    plugin.applyAtPointer();
    assert.equal(plugin.redo(), false, "nothing to redo before an undo");
    plugin.undo();
    calls.length = 0;
    assert.equal(plugin.redo(), true);
    assert.deepEqual(calls.at(-1), ["paint", pointer, 7, 1, 0], "the undone paint shows again");
    assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.shape), [0, 1]);
    plugin.undo();
    plugin.undo();
    assert.equal(plugin.getConfig().edits.length, 0);
    plugin.redo();
    plugin.redo();
    assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.shape), [0, 1], "redo replays in order");
    assert.equal(plugin.undo(), true, "a redone action can be undone again");
    plugin.setConfig({ overlayShape: 2 });
    plugin.applyAtPointer();
    assert.equal(plugin.redo(), false, "a new edit ends the redo history");
    assert.deepEqual(plugin.getConfig().edits.map((edit) => edit.shape), [0, 2]);

    plugin.setConfig({ tool: "select" });
    plugin.applyAtPointer();
    plugin.selectRegion();
    plugin.paintSelection();
    const painted = plugin.getConfig().edits.length;
    plugin.undo();
    plugin.redo();
    assert.equal(plugin.getConfig().edits.length, painted, "a region paint comes back as one step");

    plugin.undo();
    plugin.markMapEditsSaved([]);
    assert.equal(plugin.redo(), false, "saving ends the redo history");
}

// A generated building only exists in the rebuilt region, and stays that way through redo.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "select" });
    plugin.applyAtPointer();
    plugin.selectRegion();
    calls.length = 0;
    plugin.generateBuilding("Classic", 1, "Rectangle");
    const generated = plugin.getConfig().edits.length;
    assert.ok(generated > 0);
    assert.equal(calls.filter((call) => call[0] === "add").length, 0, "generating places nothing directly");
    plugin.undo();
    assert.equal(plugin.getConfig().edits.length, 0);
    calls.length = 0;
    refreshes.length = 0;
    plugin.redo();
    assert.equal(plugin.getConfig().edits.length, generated);
    assert.equal(calls.filter((call) => call[0] === "add" || call[0] === "paint").length, 0, "redo places nothing directly either");
    assert.ok(refreshes.at(-1)!.includes(12850), "redo rebuilds the region that holds it");
}

// Undo brings back a deleted object.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "delete" });
    plugin.applyAtPointer();
    calls.length = 0;
    assert.equal(plugin.undo(), true);
    assert.deepEqual(calls, [["restore"]]);
    assert.equal(plugin.getConfig().edits.length, 0);
    calls.length = 0;
    assert.equal(plugin.redo(), true);
    assert.deepEqual(calls, [["del"]], "redo deletes it again");
}

// Going somewhere drops the old selection, so Select region acts on where the camera is now.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "select" });
    plugin.applyAtPointer();
    assert.ok(plugin.getState().selection);
    assert.equal(plugin.goToLocation("nowhere"), false);
    assert.ok(plugin.getState().selection, "a bad location changes nothing");
    assert.equal(plugin.goToLocation("3222, 3218, 1"), true);
    assert.equal(plugin.getState().selection, undefined);
}

// Undo after a save has nothing to take back: those edits are the base map now.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "terrain" });
    plugin.applyAtPointer();
    plugin.markMapEditsSaved([]);
    assert.equal(plugin.undo(), false);
}

// Height tool: repeat clicks add up before the scene rebuild, a corner moves one vertex, undo restores.
{
    const plugin = makePlugin();
    plugin.setConfig({ tool: "select" });
    plugin.applyAtPointer();
    plugin.adjustHeight(4, 0);
    plugin.adjustHeight(4, 0);
    const vertices = plugin.getConfig().edits.filter((edit) => edit.kind === "height" && edit.tileX === 3222 && edit.tileY === 3218);
    assert.deepEqual(vertices.map((edit) => edit.locId), [20, 24], "height -1 is byte 16, then two steps of 4");
    assert.deepEqual(refreshes.at(-1), [12850], "the edited region rebuilds");
    const before = plugin.getConfig().edits.length;
    plugin.adjustHeight(4, 0, "ne");
    assert.equal(plugin.getConfig().edits.length, before + 1);
    const corner = plugin.getConfig().edits.at(-1)!;
    assert.deepEqual([corner.tileX, corner.tileY, corner.locId], [3223, 3219, 28]);
    plugin.undo();
    assert.equal(plugin.getConfig().edits.length, before);
    plugin.undo();
    plugin.undo();
    assert.equal(plugin.getConfig().edits.length, 0);
    assert.deepEqual(refreshes.at(-1), [12850], "undoing height rebuilds the region too");
    refreshes.length = 0;
    plugin.redo();
    assert.deepEqual(refreshes.at(-1), [12850], "redoing height rebuilds the region too");
    assert.ok(plugin.getConfig().edits.some((edit) => edit.kind === "height"));
}

console.log("Editor terrain tools tests passed");
