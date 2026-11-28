import assert from "node:assert/strict";
import { test } from "node:test";
import { GroupMissingError } from "../rs/cache/js5/GroupMissingError";
import { previewEditorBuilding } from "../game/plugins/editmode/EditorBuildings";
import { preview } from "../game/plugins/editmode/generation/buildings/MapPlans";

test("local building generation waits for sparse cache footprints", async () => {
    const query = new URLSearchParams({ name: "house", width: "8", height: "8", seed: "42" });
    let available = false;
    let waits = 0;
    const dimensions = () => ({ sizeX: 2, sizeY: 3 });
    const result = await previewEditorBuilding(query, (id) => {
        if (!available) throw new GroupMissingError(2, id, 0, 1);
        return dimensions();
    }, async () => { available = true; waits++; });
    assert.equal(waits, 1);
    assert.deepEqual(result, preview(query, dimensions), "placement uses real dimensions after cache loading");
});

test("local building generation reports cache failures without endless retries", async () => {
    const query = new URLSearchParams({ name: "house" });
    let waits = 0;
    await assert.rejects(previewEditorBuilding(query, (id) => {
        throw new GroupMissingError(2, id, 0, 1);
    }, async () => { waits++; }), GroupMissingError);
    assert.equal(waits, 1);
    await assert.rejects(previewEditorBuilding(query, () => { throw new Error("Invalid object definition"); }), /Invalid object definition/);
});
