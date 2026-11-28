import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEditorTemplate, loadEditorTemplateCatalog } from "../game/plugins/editmode/EditorTemplates";
import { parseAreaStamp, planAreaStamp, stampSize } from "../game/plugins/editmode/AreaStamp";

test("built-in templates load and stamp offline on every rotation", async () => {
    const fetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("Offline: templates must be bundled with the editor"); };
    try {
        const catalog = await loadEditorTemplateCatalog();
        assert.deepEqual(catalog.map(({ name }) => name), ["varrock-house-a", "varrock-house-west", "varrock-tent"]);
        const destination = { tileX: 4096, tileY: 4096, plane: 0 };
        for (const entry of catalog) {
            const area = parseAreaStamp(await loadEditorTemplate(entry.name));
            assert.equal(area.width, entry.width);
            assert.equal(area.height, entry.height);
            assert.ok(area.objects.length && area.floors.length, "captured objects and terrain remain available");
            for (let turns = 0; turns < 4; turns++) {
                const plan = planAreaStamp(area, destination, { turns, terrain: "floors", interactive: true }, () => ({
                    sizeX: 1, sizeY: 1, interactive: false,
                }));
                const [width, height] = stampSize(area, turns);
                const placements = plan.edits.filter(edit => edit.kind === "place");
                assert.ok(placements.length > 0);
                assert.ok(placements.every(edit => edit.tileX >= destination.tileX && edit.tileX < destination.tileX + width &&
                    edit.tileY >= destination.tileY && edit.tileY < destination.tileY + height), "rotated template stays inside its footprint");
            }
        }
    } finally {
        globalThis.fetch = fetch;
    }
});

test("template instances are independent and unknown names cannot escape the bundled library", async () => {
    const first = await loadEditorTemplate("varrock-tent") as { objects: { id: number }[] };
    const original = first.objects[0].id;
    first.objects[0].id = -1;
    const second = await loadEditorTemplate("varrock-tent") as typeof first;
    assert.equal(second.objects[0].id, original, "editing one loaded template does not corrupt the preset");
    const catalog = await loadEditorTemplateCatalog();
    const planes = [...catalog[0].source.planes];
    catalog[0].source.planes.length = 0;
    assert.deepEqual((await loadEditorTemplateCatalog())[0].source.planes, planes);
    for (const name of ["../world", "__proto__", "missing-template"]) {
        await assert.rejects(loadEditorTemplate(name), /No built-in template/);
    }
});
