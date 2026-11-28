import assert from "node:assert/strict";

import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { parseAreaStamp } from "../game/plugins/editmode/AreaStamp";
import { parseEditorLocation, regionBounds, regionIdOf } from "../game/plugins/editmode/EditorCoordinates";
import { MAX_REGION_PACK_PAYLOAD, buildRegionPack, oversizedRegionPacks, parseRegionPack, readRegionOverlays } from "../game/plugins/editmode/RegionPack";
import { adjustHeightBytes } from "../game/plugins/editmode/TerrainHeight";
import { buildZoneGroundGeometry } from "../game/plugins/editmode/ZoneGroundOverlay";
import type { EditModeEdit, EditModeHost } from "../game/plugins/editmode/types";
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
{
    const rect = { minX: 2, maxX: 2, minY: 3, maxY: 3, plane: 1, shape: 1, rotation: 3, alpha: 1, colorRgb: 0x506070 };
    const { positions } = buildZoneGroundGeometry([rect], () => -1);
    const vertices = Array.from({ length: positions.length / 3 }, (_, index) => [positions[index * 3] - 2, positions[index * 3 + 2] - 3]);
    assert.deepEqual(vertices, getOverlayShapeTriangles(1, 3).flat(), "the immediate paint preview shares the saved shape and rotation");
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
const blockedFrames: { tileX: number; tileY: number; plane: number }[][] = [];
let pointer = { tileX: 3222, tileY: 3218, plane: 0 };
const makePlugin = (getTerrainHeight: (tile: typeof pointer) => number = () => -1, overrides?: Partial<EditModeHost>) => {
    const plugin = new EditModePlugin();
    plugin.attach({
        getCanvas: () => undefined,
        getPointerTile: () => pointer,
        getPointerLoc: () => undefined,
        isLoggedIn: () => true,
        setFreeCamera: () => {},
        cancelPendingClick: () => {},
        getTerrainHeight,
        getLocPlacementShape: () => 10,
        getStampObjectInfo: () => ({ sizeX: 1, sizeY: 1, interactive: false }),
        getTerrainFlags: () => 0,
        getCameraTile: () => pointer,
        showTileFlagTiles: (flag, tiles) => { if (flag === 1) blockedFrames.push([...tiles]); },
        jumpCameraToTile: () => {},
        setTerrainOverlay: (tile: unknown, overlay: number, shape: number, rotation: number) =>
            calls.push(["paint", tile, overlay, shape, rotation]),
        clearTerrainOverride: (tile: unknown) => calls.push(["clearTerrain", tile]),
        onLocAddChange: (id: number) => calls.push(["add", id]),
        onLocDel: () => calls.push(["del"]),
        restoreLoc: () => calls.push(["restore"]),
        refreshEditedRegions: (regions: number[]) => refreshes.push(regions),
        selectTileRange: (start: any, end: any) => ({ ...start, tileEndX: end.tileX, tileEndY: end.tileY, locId: -1, locName: "" }),
        ...overrides,
    } as any);
    plugin.setConfig({ enabled: true, active: true, overlayId: 7 });
    return plugin;
};

// A vertex gets another application after the brush leaves and returns. The
// entire drag, including its repeated passes, still shares one history entry.
{
    const plugin = makePlugin();
    const origin = { ...pointer };
    const far = { ...pointer, tileX: pointer.tileX + 3 };
    plugin.setTerrainBrush({ action: "raise", radius: 0, step: 4 });
    const brush = plugin as unknown as {
        applyTerrainStroke(path: (typeof pointer)[]): void;
    };
    brush.applyTerrainStroke([origin, origin, far, origin]);
    const height = () => plugin.getConfig().edits.findLast((edit) => edit.kind === "height" &&
        edit.tileX === origin.tileX && edit.tileY === origin.tileY)?.locId;
    assert.equal(height(), 24, "a second pass raises the vertex again while a stationary sample does nothing");
    assert.equal(plugin.undo(), true);
    assert.equal(plugin.getConfig().edits.length, 0);
    assert.equal(plugin.undo(), false);
    assert.equal(plugin.redo(), true);
    assert.equal(height(), 24);
}

{
    const plugin = makePlugin();
    const origin = { ...pointer };
    const middle = { ...origin, tileX: origin.tileX + 1 };
    const far = { ...origin, tileX: origin.tileX + 2 };
    plugin.armScatter([1276], 0, 0.5);
    const scatter = plugin as unknown as { applyScatter(path: (typeof pointer)[]): void };
    const samples = [0.9, 0.9, 0.9, 0, 0, 0, 0.9];
    const random = Math.random;
    Math.random = () => samples.shift() ?? 0.9;
    try {
        scatter.applyScatter([origin, origin, far, origin]);
    } finally {
        Math.random = random;
    }
    assert.deepEqual(plugin.getConfig().edits, [{ kind: "place", ...middle, locId: 1276, shape: 10, rotation: 0 }],
        "scatter can place on a previously missed tile after leaving and returning");
    assert.equal(plugin.undo(), true);
    assert.deepEqual(plugin.getConfig().edits, []);
}

{
    const oldPointer = pointer;
    const random = Math.random;
    const requestFrame = globalThis.requestAnimationFrame;
    const cancelFrame = globalThis.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    globalThis.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    const renderFrame = () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(0);
    };
    const areaPreviews: (readonly (typeof pointer)[])[] = [];
    const plugin = makePlugin(undefined, { setScatterBrushPreview: (tiles) => { areaPreviews.push([...tiles]); } });
    type BrushGesture = {
        onMouseDown(event: MouseEvent): void;
        onMouseMove(event: MouseEvent): void;
        onMouseUp(event: MouseEvent): void;
    };
    const gesture = plugin as unknown as BrushGesture;
    const input = (step: number): MouseEvent => {
        pointer = { ...oldPointer, tileX: oldPointer.tileX + step };
        return { button: 0, clientX: step * 12, clientY: 0, preventDefault() {} } as MouseEvent;
    };
    Math.random = () => 0.005;
    try {
        plugin.armScatter([1276], 10, 0.001);
        renderFrame();
        areaPreviews.length = 0;
        gesture.onMouseDown(input(0));
        for (let step = 1; step <= 30; step++) gesture.onMouseMove(input(step));
        renderFrame();
        assert.equal(areaPreviews.length, 1, "multiple mouse events draw a single wide brush preview per frame");
        const preview = areaPreviews[0];
        assert.ok(preview.some((tile) => tile.tileX === oldPointer.tileX - 10 && tile.tileY === oldPointer.tileY));
        assert.ok(preview.some((tile) => tile.tileX === oldPointer.tileX + 40 && tile.tileY === oldPointer.tileY));
        assert.equal(plugin.getConfig().edits.length, 0, "release mode leaves edits alone while previewing");
        gesture.onMouseUp(input(30));
        assert.equal(plugin.getConfig().edits.length, 0, "half-percent samples miss at minimum density");

        const previewed: EditModeEdit[] = [];
        const rebuilds: number[][] = [];
        let updates = 0;
        const livePlugin = makePlugin(undefined, {
            previewScatteredLocs: (edits) => { previewed.push(...edits); },
            refreshEditedRegions: (regions) => { rebuilds.push(regions); },
        });
        const liveGesture = livePlugin as unknown as BrushGesture;
        livePlugin.setConfig({ brushTiming: "live" });
        livePlugin.armScatter([1276], 10, 0.001);
        livePlugin.subscribe(() => { updates++; });
        Math.random = () => 0;
        liveGesture.onMouseDown(input(0));
        assert.ok(previewed.length > 0, "live mode previews scenery on press");
        for (let step = 1; step <= 30; step++) liveGesture.onMouseMove(input(step));
        renderFrame();
        assert.equal(previewed.length, preview.length, "live batches cover the same tiles as the release preview");
        assert.equal(rebuilds.length, 0, "live previews do not rebuild the map during a drag");
        assert.equal(updates, 0, "live placement skips full workspace refreshes during a drag");
        liveGesture.onMouseUp(input(30));
        assert.equal(updates, 1);
        assert.equal(rebuilds.length, 1);
        assert.equal(livePlugin.undo(), true);
        assert.deepEqual(livePlugin.getConfig().edits, []);
        assert.equal(livePlugin.redo(), true);
        assert.equal(livePlugin.getConfig().edits.length, preview.length);
        assert.equal(livePlugin.undo(), true);

        liveGesture.onMouseDown(input(0));
        assert.ok(livePlugin.getConfig().edits.length > 0);
        assert.equal(livePlugin.cancelBrushStroke(), true);
        assert.deepEqual(livePlugin.getConfig().edits, []);
        assert.equal(livePlugin.undo(), false, "cancelling a live stroke leaves no undo step");
        renderFrame();
    } finally {
        pointer = oldPointer;
        Math.random = random;
        globalThis.requestAnimationFrame = requestFrame;
        globalThis.cancelAnimationFrame = cancelFrame;
    }
}

{
    const plugin = makePlugin();
    plugin.setConfig({ showUnwalkableFlags: true });
    plugin.setTerrainBrush({ action: "block", radius: 0 });
    plugin.applyAtPointer();
    assert.deepEqual(blockedFrames.at(-1), [pointer], "the blocked overlay updates as soon as a stroke lands");
    plugin.setTerrainBrush({ action: "unblock", radius: 0 });
    plugin.applyAtPointer();
    assert.deepEqual(blockedFrames.at(-1), [], "the blocked overlay clears as soon as the tile is unblocked");
    plugin.undo();
    assert.deepEqual(blockedFrames.at(-1), [pointer], "undo updates the overlay without a checkbox toggle");
}

{
    const sample = ({ tileX, tileY }: typeof pointer) => -(16 + tileX - pointer.tileX + 2 * (tileY - pointer.tileY)) / 16;
    const plugin = makePlugin(sample);
    const house = parseAreaStamp({
        name: "House", foundation: true, source: { x: 0, y: 0 }, width: 3, height: 2,
        objects: [{ id: 1, dx: 0, dy: 0, z: 0, type: 0, face: 0 }, { id: 2, dx: 0, dy: 0, z: 0, type: 22, face: 0 }],
        tiles: [{ dx: 0, dy: 0, z: 0, flag: 4, overlay: { id: 5, shape: 0, rotation: 0 } }, { dx: 3, dy: 2, z: 1, height: 37 }],
    });
    plugin.armStamp(house, { turns: 1, terrain: "floors", interactive: false });
    plugin.applyAtPointer();
    const edits = plugin.getConfig().edits;
    const floor = edits.find(edit => edit.kind === "terrain")!;
    const removedGrass = edits.filter(edit => edit.kind === "delete");
    assert.deepEqual(removedGrass.map(edit => edit.rotation), [0, 1, 2, 3], "all grass rotations are cleared beneath the new floor");
    assert.ok(removedGrass.every(edit => edit.shape === 22 && edit.tileX === floor.tileX && edit.tileY === floor.tileY && edit.plane === floor.plane),
        "clear only floor decorations on the rotated painted floor, leaving surrounding scenery alone");
    const decoration = edits.findIndex(edit => edit.kind === "place" && edit.locId === 2);
    assert.ok(decoration > edits.indexOf(removedGrass.at(-1)!), "cleanup precedes the template's own floor decorations");
    const elevations = new Set<number>();
    for (let dx = 0; dx <= 2; dx++) for (let dy = 0; dy <= 3; dy++) {
        const tile = { tileX: pointer.tileX + dx, tileY: pointer.tileY + dy, plane: 0 };
        const height = edits.find((edit) => edit.kind === "height" && edit.plane === 0 &&
            edit.tileX === tile.tileX && edit.tileY === tile.tileY)?.locId;
        elevations.add(height ?? -16 * sample(tile));
    }
    assert.equal(elevations.size, 1, "every vertex under the rotated building is level");
    assert.ok(edits.some((edit) => edit.kind === "height" && edit.plane === 1 && edit.locId === 37),
        "levelling ground leaves the template's upper-floor gaps intact");
    plugin.undo();
    assert.deepEqual(plugin.getConfig().edits, [], "foundation, grass cleanup and stamp undo together");
    plugin.armStamp(house, { turns: 0, terrain: "objects", interactive: false });
    plugin.applyAtPointer();
    assert.ok(!plugin.getConfig().edits.some(edit => edit.kind === "delete"), "objects-only stamps preserve existing ground decorations");
    plugin.undo();
}

{
    const original = pointer;
    pointer = { tileX: 3262, tileY: 3218, plane: 0 };
    const home = regionIdOf(pointer.tileX, pointer.tileY);
    const east = regionIdOf(pointer.tileX + 2, pointer.tileY);
    const available = new Set([home]);
    const notices: string[] = [];
    const validation: number[][] = [];
    const plugin = makePlugin(({ tileX, tileY }) => -(16 + tileX - pointer.tileX + tileY - pointer.tileY) / 16, {
        isEditableMapRegion: (region) => available.has(region),
        validateStampRegions: (regions) => {
            validation.push([...regions]);
            assert.ok(regions.every((region) => available.has(region)), "a visible scene border cannot be saved as a map");
        },
    });
    plugin.setNoticeListener((message) => notices.push(message));
    const house = parseAreaStamp({
        name: "Boundary house", foundation: true, source: { x: 0, y: 0 }, width: 2, height: 2,
        objects: [{ id: 1, dx: 1, dy: 0, z: 0, type: 0, face: 0 }],
        tiles: [{ dx: 2, dy: 2, z: 1, height: 37 }],
    });
    plugin.armStamp(house, { turns: 0, terrain: "floors", interactive: false });
    plugin.applyAtPointer();
    assert.ok(plugin.getConfig().edits.some((edit) => edit.kind === "place"), "the entire footprint fits on the last two mapped columns");
    assert.deepEqual(validation.at(-1), [home]);
    assert.ok(plugin.undo());

    pointer = { ...pointer, tileX: 3263 };
    plugin.applyAtPointer();
    assert.deepEqual(plugin.getConfig().edits, []);
    assert.match(notices.at(-1) ?? "", new RegExp(`outside the mapped area.*${east}`));
    available.add(east);
    plugin.applyAtPointer();
    assert.ok(plugin.getConfig().edits.some((edit) => edit.kind === "place" && edit.tileX === 3264));
    assert.deepEqual(new Set(validation.at(-1)), available);
    pointer = original;
}

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
    const base = parseRegionPack(buildRegionPack((50 << 8) | 50, 40000, 39999, new Uint8Array([0]), terrain,
        [edit, { ...edit, kind: "underlay", locId: 3 }], false));
    const material = readRegionOverlays(base.terrainData, false, true);
    assert.equal(material.overlays[0], 7);
    assert.equal(material.underlays?.[0], 3, "undo can preview the original base ground under a shaped overlay");
}

// Saving checks the packet the server can stream: raw when the sections fit, deflated when not.
{
    const terrain = new Uint8Array(64 * 64 * 4);
    const pack = (objects: Uint8Array) => {
        const data = buildRegionPack((50 << 8) | 50, 40000, 39999, objects, terrain, [], false, false);
        return { regionId: (50 << 8) | 50, data };
    };
    // 80 KB of zeros is far over the raw ceiling but deflates to almost nothing.
    assert.deepEqual(oversizedRegionPacks([pack(new Uint8Array(80_000))]), []);
    // The client must also be able to hold the expanded data, however well it compresses.
    assert.throws(() => oversizedRegionPacks([pack(new Uint8Array(16 * 1024 * 1024))]), /16 MiB/);
    // Random bytes can also exceed the compressed packet budget.
    const random = new Uint8Array(80_000);
    let seed = 123456789;
    for (let index = 0; index < random.length; index++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        seed >>>= 0;
        random[index] = seed & 0xff;
    }
    const oversized = oversizedRegionPacks([pack(random)]);
    assert.equal(oversized.length, 1);
    assert.equal(oversized[0].regionId, (50 << 8) | 50);
    assert.ok(oversized[0].payload > MAX_REGION_PACK_PAYLOAD, "reports the compressed payload it cannot send");
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
    assert.equal(plugin.getConfig().heightLevel, 1, "a coordinate with a floor moves editing to that floor");
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

// View flags work independently of the paint tool and respect the edited floor.
{
    const frames = new Map<number, readonly typeof pointer[]>();
    const plugin = makePlugin(() => -1, {
        getTerrainFlags: tile => tile.tileX === pointer.tileX && tile.tileY === pointer.tileY ? 31 : 0,
        showTileFlagTiles: (flag, tiles) => frames.set(flag, tiles),
    });
    plugin.setConfig({ tool: "select", showUnwalkableFlags: true, showBridgeFlags: true,
        showRemoveRoofFlags: true, showLowerZFlags: true, showDisableRenderFlags: true });
    for (const flag of [1, 2, 4, 8, 16]) assert.deepEqual(frames.get(flag), [pointer]);
    plugin.setConfig({ showBridgeFlags: false, heightLevel: 1 });
    assert.deepEqual(frames.get(2), [], "turning off one flag hides only that flag");
    assert.deepEqual(frames.get(4), [{ ...pointer, plane: 1 }], "flags follow the selected height level");
    assert.equal(plugin.getConfig().edits.length, 0, "visibility never edits map flags");
    plugin.setConfig({ active: false });
    for (const flag of [1, 2, 4, 8, 16]) assert.deepEqual(frames.get(flag), []);
}
{
    const frames = new Map<number, readonly typeof pointer[]>();
    const region = regionIdOf(pointer.tileX, pointer.tileY);
    const plugin = makePlugin(() => -1, {
        getVisibleRegionIds: () => [region, region + 256],
        getTerrainFlags: tile => tile.tileY === pointer.tileY &&
            (tile.tileX === pointer.tileX || tile.tileX === pointer.tileX + 64) ? 2 : 0,
        showTileFlagTiles: (flag, tiles) => frames.set(flag, tiles),
    });
    plugin.setConfig({ showBridgeFlags: true });
    assert.deepEqual(frames.get(2), [pointer, { ...pointer, tileX: pointer.tileX + 64 }],
        "flag visibility covers all visible map squares, not only the one under the pointer");
}

// Flag brushes use the base map rather than a renderer still rebuilding an undone edit.
{
    const plugin = makePlugin(() => -1, {
        getBaseRegionFlags: () => new Uint8Array(4 * 64 * 64),
        getTerrainFlags: () => 1,
    });
    plugin.setTerrainBrush({ action: "block", radius: 0, flagMask: 2 });
    plugin.applyAtPointer();
    assert.equal(plugin.getConfig().edits.at(-1)?.locId, 2, "the cache is authoritative for unchanged flags");
    plugin.undo();
    plugin.setTerrainBrush({ action: "unblock", flagMask: 1 });
    plugin.applyAtPointer();
    assert.equal(plugin.getConfig().edits.length, 0, "stale renderer flags do not recreate an undone edit");
}

// Flags brushes set/clear only the checked mask, independently of tile selection.
{
    const plugin = makePlugin(() => -1, { getTerrainFlags: () => 1 });
    plugin.setTerrainBrush({ action: "block", radius: 0, flagMask: 6 });
    plugin.applyAtPointer();
    assert.equal(plugin.getConfig().edits.at(-1)?.locId, 7, "bridge and roof bits are added without removing unwalkable");
    plugin.setTerrainBrush({ action: "unblock", flagMask: 6 });
    plugin.applyAtPointer();
    assert.equal(plugin.getConfig().edits.at(-1)?.locId, 1, "only the checked flags are cleared");
    plugin.undo();
    assert.equal(plugin.getConfig().edits.at(-1)?.locId, 7, "clearing flags is one undo step");
    const count = plugin.getConfig().edits.length;
    plugin.setTerrainBrush({ flagMask: 0 });
    plugin.applyAtPointer();
    assert.equal(plugin.getConfig().edits.length, count, "no checked flags means no map edits");
}
