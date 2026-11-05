import assert from "node:assert/strict";

import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import { fillOverlay } from "../game/plugins/editmode/OverlayFill";
import { buildRegionPack, parseRegionPack, readRegionOverlays } from "../game/plugins/editmode/RegionPack";
import type { EditModeEdit, EditModeRegionOverlays } from "../game/plugins/editmode/types";

const REGION = (50 << 8) | 50;
const BASE = 50 * 64;
const terrain = (kind: EditModeEdit["kind"], x: number, y: number, locId: number, shape = 0, rotation = 0, plane = 0): EditModeEdit =>
    ({ kind, locId, tileX: x, tileY: y, plane, shape, rotation });

/** Region terrain with the edits applied, decoded the way the editor host does it. */
const decode = (regionId: number, edits: readonly EditModeEdit[], wide = false): EditModeRegionOverlays => {
    const empty = new Uint8Array(64 * 64 * 4 * (wide ? 2 : 1));
    const pack = buildRegionPack(regionId, 40000, 39999, new Uint8Array([0]), empty, edits, wide, false);
    return readRegionOverlays(parseRegionPack(pack).terrainData, wide);
};
const at = (overlays: EditModeRegionOverlays, x: number, y: number, plane = 0) => {
    const index = (plane * 64 + (x & 63)) * 64 + (y & 63);
    return [overlays.overlays[index], overlays.shapes[index], overlays.rotations[index]];
};

// Decoding reads back the overlay, shape and rotation a pack stores, in both terrain formats.
for (const wide of [false, true]) {
    const decoded = decode(REGION, [
        terrain("terrain", BASE + 3, BASE + 4, 9, 1, 3),
        terrain("terrain", BASE + 63, BASE + 63, wide ? 300 : 200, 0, 0, 2),
        terrain("height", BASE + 3, BASE + 4, 20),
    ], wide);
    assert.deepEqual(at(decoded, 3, 4), [9, 1, 3], "diagonal overlay beside a height");
    assert.deepEqual(at(decoded, 63, 63, 2), [wide ? 300 : 200, 0, 0], "last tile of plane 2");
    assert.deepEqual(at(decoded, 4, 4), [0, 0, 0], "untouched tile has no overlay");
}

// A path of overlay 5 with diagonal edges, a separate patch of 5, and a 6 wedged between them.
const path: EditModeEdit[] = [
    terrain("terrain", BASE + 10, BASE + 10, 5),
    terrain("terrain", BASE + 11, BASE + 10, 5, 1, 2),
    terrain("terrain", BASE + 10, BASE + 11, 5, 2, 1),
    terrain("terrain", BASE + 10, BASE + 12, 5),
    terrain("terrain", BASE + 11, BASE + 11, 6),
    terrain("terrain", BASE + 12, BASE + 12, 5),
];
const regions = new Map([[REGION, decode(REGION, path)]]);
const fill = fillOverlay({ tileX: BASE + 10, tileY: BASE + 10, plane: 0 }, 8, (id) => regions.get(id));
assert.ok("edits" in fill);
const filled = new Map(fill.edits.map((edit) => [`${edit.tileX - BASE},${edit.tileY - BASE}`, [edit.locId, edit.shape, edit.rotation]]));
assert.deepEqual(Object.fromEntries(filled), {
    "10,10": [8, 0, 0],
    "11,10": [8, 1, 2],
    "10,11": [8, 2, 1],
    "10,12": [8, 0, 0],
}, "connected tiles change overlay and keep their shapes; the corner-only patch and the 6 stay");
assert.ok(fill.edits.every((edit) => edit.kind === "terrain" && edit.plane === 0));

assert.deepEqual(fillOverlay({ tileX: BASE + 30, tileY: BASE + 30, plane: 0 }, 8, (id) => regions.get(id)), { error: "no-overlay" });
assert.deepEqual(fillOverlay({ tileX: BASE + 10, tileY: BASE + 10, plane: 0 }, 5, (id) => regions.get(id)), { error: "same-overlay" });
assert.deepEqual(fillOverlay({ tileX: 0, tileY: 0, plane: 0 }, 8, (id) => regions.get(id)), { error: "unloaded" });
assert.deepEqual(fillOverlay({ tileX: BASE + 10, tileY: BASE + 10, plane: 0 }, 8, (id) => regions.get(id), 3), { error: "too-large" });
assert.ok("edits" in fillOverlay({ tileX: BASE + 10, tileY: BASE + 10, plane: 0 }, 8, (id) => regions.get(id), 4), "a fill exactly at the limit goes through");
assert.deepEqual(fillOverlay({ tileX: BASE + 10, tileY: BASE + 10, plane: 1 }, 8, (id) => regions.get(id)), { error: "no-overlay" }, "planes are separate");

// A fill crosses into the next region, and stops at one that is not loaded.
{
    const east = (51 << 8) | 50;
    const river = [BASE + 62, BASE + 63, BASE + 64, BASE + 65].map((x) => terrain("terrain", x, BASE + 5, 3));
    const loaded = new Map([[REGION, decode(REGION, river)], [east, decode(east, river)]]);
    const across = fillOverlay({ tileX: BASE + 62, tileY: BASE + 5, plane: 0 }, 4, (id) => loaded.get(id));
    assert.ok("edits" in across);
    assert.deepEqual(across.edits.map((edit) => edit.tileX - BASE).sort(), [62, 63, 64, 65]);
    loaded.delete(east);
    const stopped = fillOverlay({ tileX: BASE + 62, tileY: BASE + 5, plane: 0 }, 4, (id) => loaded.get(id));
    assert.ok("edits" in stopped);
    assert.deepEqual(stopped.edits.map((edit) => edit.tileX - BASE).sort(), [62, 63]);
}

// The tool: hover previews the fill, a click paints it as one undo step, and the next fill sees it.
{
    const paints: unknown[][] = [];
    const previews: number[] = [];
    const notices: string[] = [];
    let pointer = { tileX: BASE + 10, tileY: BASE + 10, plane: 0 };
    const plugin = new EditModePlugin();
    plugin.attach({
        getCanvas: () => undefined,
        getPointerTile: () => pointer,
        getPointerLoc: () => undefined,
        isLoggedIn: () => true,
        setFreeCamera: () => {},
        cancelPendingClick: () => {},
        jumpCameraToTile: () => {},
        setTerrainOverlay: (tile: any, overlay: number, shape: number, rotation: number) =>
            paints.push([tile.tileX - BASE, tile.tileY - BASE, overlay, shape, rotation]),
        clearTerrainOverride: () => {},
        setTerrainPreview: (edits: readonly EditModeEdit[]) => previews.push(edits.length),
        clearTerrainPreview: () => previews.push(0),
        onLocAddChange: () => {},
        onLocDel: () => {},
        getRegionOverlays: (regionId: number, edits: readonly EditModeEdit[]) =>
            regionId === REGION ? decode(REGION, [...path, ...edits]) : undefined,
    } as any);
    plugin.setNoticeListener((message) => notices.push(message));
    plugin.setConfig({ enabled: true, active: true, overlayId: 8, tool: "fill" });
    assert.equal(previews.at(-1), 4, "arming the tool previews the four connected tiles");

    plugin.applyAtPointer();
    assert.deepEqual(paints.sort(), [[10, 10, 8, 0, 0], [10, 11, 8, 2, 1], [10, 12, 8, 0, 0], [11, 10, 8, 1, 2]]);
    assert.equal(plugin.getConfig().edits.length, 4);

    plugin.applyAtPointer();
    assert.equal(notices.at(-1), "This area already has the chosen overlay", "the fill reads its own pending edits");

    plugin.setConfig({ overlayId: 5 });
    plugin.applyAtPointer();
    assert.equal(plugin.getConfig().edits.length, 8, "filling back over the same tiles");
    plugin.undo();
    assert.equal(plugin.getConfig().edits.length, 4, "a fill undoes as one step");
    plugin.undo();
    assert.equal(plugin.getConfig().edits.length, 0);

    pointer = { tileX: BASE + 40, tileY: BASE + 40, plane: 0 };
    plugin.applyAtPointer();
    assert.equal(notices.at(-1), "Nothing to fill: this tile has no overlay");
    assert.equal(plugin.getConfig().edits.length, 0);
}

console.log("edit-mode overlay fill tests passed");
