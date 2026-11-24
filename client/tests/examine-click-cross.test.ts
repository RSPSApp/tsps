import assert from "node:assert/strict";
import { test } from "node:test";

import { wrapExamineWithClickCross } from "../render/render/interact/checkExamineCross";

// OSRS shows the red click cross for Examine on an NPC, loc, player or ground item.
test("choosing Examine spawns a red cross and still examines", () => {
    const calls: unknown[][] = [];
    const host = {
        toGLClickXY: () => ({ x: 5, y: 6 }),
        spawnClickCross: (tile: unknown, xy: unknown, color: string) => calls.push(["cross", tile, xy, color]),
    };
    const entry = { onClick: () => calls.push(["examine"]) };
    const tile = { tileX: 1, tileY: 2 };
    wrapExamineWithClickCross(host, entry, tile);
    (entry.onClick as any)();
    assert.deepEqual(calls, [["cross", tile, { x: 5, y: 6 }, "red"], ["examine"]]);
});
