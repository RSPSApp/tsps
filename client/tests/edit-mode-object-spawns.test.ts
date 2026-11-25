import { quarterTurnToDirection, DIRECTION_TO_ORIENTATION } from "../common/Direction";
import assert from "node:assert/strict";
import { buildObjectSpawnExport, buildRegionPack, parseRegionPack, objectSpawnEdits } from "../game/plugins/editmode/RegionPack";
import { parseObjectSpawns } from "../game/plugins/editmode/hostProtocol/objectSpawnsMessage";
import { EditModePlugin } from "../game/plugins/editmode/EditModePlugin";
import type { EditModeEdit } from "../game/plugins/editmode/types";

const region = (48 << 8) | 54;
const terrain = new Uint8Array(4 * 64 * 64);
const chair: EditModeEdit = { kind: "place", locId: 29716, tileX: 3090, tileY: 3494, plane: 0, shape: 11, rotation: 2 };
const base = parseRegionPack(buildRegionPack(region, 1, 2, new Uint8Array([0]), terrain, [chair], false));
const pool: EditModeEdit = { ...chair, locId: 29241, tileX: 3085, tileY: 3518, shape: 10, rotation: 0 };
const deletion: EditModeEdit = { ...chair, kind: "delete", locId: 0 };
const edits = [pool, deletion];
const changes = buildObjectSpawnExport([], edits, true, () => base.objectData)!;
assert.deepEqual(changes, [
    { id: chair.locId, position: { x: 3090, y: 3494, z: 0 }, type: 11, face: 2, remove: true },
    { id: pool.locId, position: { x: 3085, y: 3518, z: 0 }, type: 10, face: 0 },
]);
assert.deepEqual(parseObjectSpawns(JSON.stringify(changes)), changes);
assert.deepEqual(buildObjectSpawnExport(changes, edits, true, () => base.objectData), changes, "repeat Save is idempotent");
assert.deepEqual(buildObjectSpawnExport(changes, [{ ...pool, kind: "delete", locId: 0 }], true, () => base.objectData), [changes[0]], "deleting a JSON addition removes its record");
const elsewhere = { ...changes[1], position: { x: 3200, y: 3200, z: 0 } };
assert.deepEqual(buildObjectSpawnExport([...changes, elsewhere], edits, false, () => { throw new Error("not needed"); }), [elsewhere], "pack mode consumes only records in exported regions");
assert.equal(buildObjectSpawnExport([], edits, false, () => base.objectData), undefined);
assert.deepEqual(buildObjectSpawnExport([], [chair, { ...chair, rotation: 3 }], true, () => base.objectData)?.map(s => [s.remove ?? false, s.face]), [[true, 2], [false, 3]], "rotations retain the original collision removal");
const terrainEdit: EditModeEdit = { ...chair, kind: "terrain", locId: 1, shape: 0, rotation: 0 };
assert.equal(buildObjectSpawnExport(changes, [terrainEdit], false, () => base.objectData), undefined,
    "a terrain-only save does not migrate unrelated object spawn definitions");
const jsonPack = parseRegionPack(buildRegionPack(region, 1, 2, base.objectData, terrain, [...edits, terrainEdit], false, false));
assert.deepEqual(jsonPack.objectData, base.objectData, "JSON mode never bakes object edits into terrain packs");
assert.notDeepEqual(jsonPack.terrainData, terrain);
const clear: EditModeEdit = { ...chair, kind: "clear", locId: 0 };
const clearPack = parseRegionPack(buildRegionPack(region, 1, 2, base.objectData, terrain, [clear], false, false));
assert.deepEqual(clearPack.objectData, base.objectData, "area clearing keeps object deletion in JSON");
assert.deepEqual(buildObjectSpawnExport([], [clear], true, () => base.objectData), [changes[0]]);
const packed = parseRegionPack(buildRegionPack(region, 1, 2, base.objectData, terrain, [...objectSpawnEdits(changes), ...edits], false));
assert.notDeepEqual(packed.objectData, base.objectData, "pack mode includes JSON baseline and object edits");
for (const invalid of [{ ...changes[0], remove: "true" }, { ...changes[0], id: -1 }, { ...changes[0], position: { x: -1, y: 0, z: 0 } }]) {
    assert.throws(() => parseObjectSpawns(JSON.stringify([invalid])));
}
let saved: any;
const plugin = new EditModePlugin({ load: () => undefined, save: (config) => { saved = config; } });
assert.equal(plugin.getConfig().saveObjectSpawns, false);
plugin.attach({ getPointerTile: () => undefined, exportRegionPack: () => ({ regionId: region, data: new Uint8Array() }) } as any);
plugin.setConfig({ edits });
assert.equal(plugin.exportModifiedRegionPacks().length, 1, "default is region packs");
plugin.setConfig({ saveObjectSpawns: true });
assert.equal(saved.saveObjectSpawns, true, "preference is persisted");
assert.equal(plugin.exportModifiedRegionPacks().length, 0, "JSON-only edits do not export packs");
plugin.setConfig({ edits: [...edits, terrainEdit] });
assert.equal(plugin.exportModifiedRegionPacks().length, 1, "terrain still exports a pack");
console.log("Object spawn editor export tests passed");

plugin.markMapEditsSaved([], changes);
assert.equal(plugin.getConfig().edits.length, 0, "saved changes become the base, not edits replayed in the next mode");
const nextDeletion: EditModeEdit = { ...pool, kind: "delete", locId: 0 };
const afterPackSave = buildObjectSpawnExport([], [nextDeletion], true, () => packed.objectData)!;
assert.deepEqual(afterPackSave, [{ ...changes[1], remove: true }], "switching from a saved pack to JSON deletes the baked addition");

assert.deepEqual([0, 1, 2, 3].map(quarterTurnToDirection), [1, 3, 6, 4]);
for (const rotation of [0, 1, 2, 3]) {
    assert.equal(DIRECTION_TO_ORIENTATION[quarterTurnToDirection(rotation)], rotation * 512, "saved NPC direction matches preview after reloading");
}
