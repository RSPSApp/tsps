import assert from "node:assert/strict";
import { buildAreaClipboard, buildRegionPack, createRegionPack, parseRegionPack } from "../game/plugins/editmode/RegionPack";
import { parseAreaStamp, planAreaStamp, previewAreaStamp } from "../game/plugins/editmode/AreaStamp";

for (const wide of [false, true]) {
    const value = (n: number) => wide ? [n >> 8, n & 255] : [n];
    // Overlay shape 2, rotation 3; flag 5; underlay 9; explicit height 7.
    const terrainTile = [...value(13), ...value(42), ...value(54), ...value(90), ...value(1), 7];
    const terrain = Uint8Array.from(Array.from({ length: 4 * 64 * 64 }, () => terrainTile).flat());
    const edits = [
        { kind: "place", tileX: 63, tileY: 9, plane: 3, locId: 123, shape: 10, rotation: 2 },
        { kind: "place", tileX: 62, tileY: 9, plane: 0, locId: 456, shape: 10, rotation: 0 },
        { kind: "height", tileX: 64, tileY: 10, plane: 2, locId: 11, shape: 0, rotation: 0 },
    ] as const;
    const requested: number[] = [];
    const copied = JSON.parse(buildAreaClipboard({ minX: 63, maxX: 64, minY: 9, maxY: 10 }, (x, y) => {
        const id = ((x >> 6) << 8) | (y >> 6);
        requested.push(id);
        return buildRegionPack(id, 1, 2, new Uint8Array([0]), terrain, edits, wide);
    }, wide));
    assert.deepEqual(requested, [0, 256], "read each intersecting region once");
    assert.equal(copied.tiles.length, 16, "2x2 selection includes all four planes");
    assert.deepEqual(copied.origin, { x: 63, y: 9 });
    assert.equal(copied.wideTerrain, wide);
    assert.deepEqual(copied.objects, [{ id: 123, x: 0, y: 0, plane: 3, shape: 10, rotation: 2 }]);
    for (const tile of copied.tiles) {
        const expected = [...terrainTile];
        if (tile.x === 1 && tile.y === 1 && tile.plane === 2) expected[expected.length - 1] = 11;
        assert.deepEqual(tile.terrain, expected, "retain every terrain byte and unsaved height edits");
    }
}
assert.throws(() => buildAreaClipboard({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, () => {
    throw new Error("Region is not loaded");
}, false), /not loaded/);

const stamp = parseAreaStamp({
    source: { x: 4096, y: 4096 },
    name: "Test house",
    width: 4,
    height: 3,
    objects: [
        { id: 100, dx: 1, dy: 0, z: 0, type: 10, face: 0 },
        { id: 101, dx: 1, dy: 1, z: 0, type: 0, face: 1 },
    ],
    tiles: [{ dx: 1, dy: 0, z: 1, overlay: { id: 7, shape: 2, rotation: 3 }, height: 30 }],
});
const target = { tileX: 100, tileY: 200, plane: 0 };
const turned = planAreaStamp(stamp, target, { turns: 1, terrain: "floors", interactive: false }, (id) => ({
    sizeX: 2, sizeY: 1, interactive: id === 101,
}));
assert.equal(turned.skipped, 1);
assert.deepEqual(turned.edits[0], { kind: "place", tileX: 100, tileY: 201, plane: 0, shape: 10, rotation: 1, locId: 100 });
assert.deepEqual(turned.edits[1], { kind: "terrain", tileX: 100, tileY: 202, plane: 1, shape: 2, rotation: 0, locId: 7 });
assert.equal(turned.edits[2].tileY, 203, "height turns about the vertex grid");
assert.throws(() => planAreaStamp(stamp, { ...target, tileY: 16383 }, { turns: 0, terrain: "all", interactive: false },
    () => undefined), /edge of the world/);
assert.throws(() => parseAreaStamp({ format: "elvarg-map-area", version: 1, width: 100, height: 100 }), /4096/);

const synthetic = createRegionPack(0x5050, true, 48, true);
const header = new DataView(synthetic.buffer);
assert.equal(header.getInt32(4), -1);
assert.equal(header.getInt32(8), -1);
const parsed = parseRegionPack(synthetic);
assert.deepEqual([...parsed.objectData], [0]);
assert.deepEqual([...parsed.terrainData.slice(0, 5)], [0, 129, 0, 1, 24]);
assert.deepEqual([...parsed.terrainData.slice(64 * 64 * 5, 64 * 64 * 5 + 2)], [0, 0]);
console.info("Area clipboard preserves all planes, terrain records, objects and edits across regions");

const stampBase = { tileX: 100, tileY: 200, shape: 0, rotation: 0 };
const roofHeights = [0, 1].flatMap((dx) => [0, 1].flatMap((dy) => [0, 1].map((plane) => ({
    ...stampBase, tileX: stampBase.tileX + dx, tileY: stampBase.tileY + dy, plane, kind: "height" as const, locId: 32,
}))));
const roofPreview = previewAreaStamp([
    ...roofHeights,
    { ...stampBase, plane: 1, kind: "place", locId: 15552, shape: 12 },
    { ...stampBase, plane: 0, kind: "terrain", locId: 81 },
    ...Array.from({ length: 200 }, (_, idx) => ({
        ...stampBase, kind: "place" as const, plane: 0, locId: 1902, tileX: stampBase.tileX + 2 + idx,
    })),
], 0, () => -10, () => ({ sizeX: 1, sizeY: 1, interactive: false }));
assert.equal(roofPreview.objects[0].previewHeight, -4, "preview roofs at the stamp's planned plane height");
assert.equal(roofPreview.floors[0].previewHeight, -2, "preview paving on the planned foundation");
assert.equal(roofPreview.objects.at(-1)?.tileX, 301, "preview all models across a town-sized plan");
