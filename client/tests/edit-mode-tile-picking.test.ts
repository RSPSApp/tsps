import assert from "node:assert/strict";
import { Ray } from "../game/math/Raycast";
import { isEditorRoofCutawayTile, pickEditorTile, type EditorPickMap } from "../game/plugins/editmode/EditorTilePicking";

function map(baseX = 0, baseY = 0): EditorPickMap {
    const size = 9;
    const heights = new Int16Array(4 * size * size);
    for (let plane = 0; plane < 4; plane++) heights.fill(plane * 32, plane * size * size, (plane + 1) * size * size);
    return { heightMapData: heights, heightMapSize: size, borderSize: 0,
        getRenderBaseWorldX: () => baseX, getRenderBaseWorldY: () => baseY, getLocalTileSpan: () => 8 };
}
const emptyFloors = map();
const slanted = new Ray([1.25, -10, -2.25], [0, 1, 1]);
for (let plane = 0; plane < 4; plane++) {
    assert.deepEqual(pickEditorTile(slanted, plane, [emptyFloors]), { tileX: 1, tileY: 7 - plane * 2, plane },
        "upper-floor picks intersect that floor, instead of relabelling a lower-floor tile");
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        assert.deepEqual(pickEditorTile(new Ray([x + 0.5, -12, y + 0.5], [0, 1, 0]), plane, [emptyFloors]),
            { tileX: x, tileY: y, plane }, "every empty tile is selectable without a rendered mesh");
    }
}
const neighbour = map(0, 8);
assert.deepEqual(pickEditorTile(new Ray([1.25, -10, -1.5], [0, 1, 1]), 0, [emptyFloors, neighbour]),
    { tileX: 1, tileY: 8, plane: 0 }, "picks cross region boundaries without shifting the preview");
const distant = map(100, 200);
assert.deepEqual(pickEditorTile(new Ray([102.75, -12, 203.25], [0, 1, 0]), 3, [distant]),
    { tileX: 102, tileY: 203, plane: 3 }, "world coordinates are not clamped to a player or camera radius");
const slope = map();
for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) slope.heightMapData[2 * 81 + y * 9 + x] = 64 + 8 * x;
const target: [number, number, number] = [2.75, -5.375, 3.25];
assert.deepEqual(pickEditorTile(new Ray([2.75, -10, -1], [0, target[1] + 10, target[2] + 1]), 2, [slope]),
    { tileX: 2, tileY: 3, plane: 2 }, "sloped upper floors use the same corner heights as their highlights");
assert.equal(pickEditorTile(new Ray([1, -10, 1], [1, 0, 0]), 1, [emptyFloors]), undefined, "parallel rays do not invent tiles");
assert.equal(pickEditorTile(new Ray([1, -10, 1], [0, -1, 0]), 1, [emptyFloors]), undefined, "sky-facing rays do not pick behind the camera");
assert.equal(pickEditorTile(slanted, 2, [{ ...emptyFloors, heightMapData: new Int16Array() }]), undefined, "unloaded floors have no stale fallback");
console.log("Editor heightfield picking tests passed");

// Roof cutaway includes the exterior wall edge and its corners, then restores outdoors.
const roof = (x: number, y: number, plane: number) => plane === 0 && x >= 64 && x <= 66 && y >= 64 && y <= 66;
for (const [x, y] of [[65, 65], [63, 65], [67, 65], [65, 63], [65, 67], [63, 63], [67, 67]]) {
    assert.equal(isEditorRoofCutawayTile({ tileX: x, tileY: y, plane: 0 }, roof), true,
        `interior, wall edges and corners keep roofs hidden at ${x},${y}`);
}
for (const [x, y] of [[62, 65], [68, 65], [65, 62], [65, 68]]) {
    assert.equal(isEditorRoofCutawayTile({ tileX: x, tileY: y, plane: 0 }, roof), false, "leaving the wall margin restores roofs");
}
assert.equal(isEditorRoofCutawayTile({ tileX: 65, tileY: 65, plane: 1 }, roof), false, "roof flags are sampled on the edited plane");
