import assert from "node:assert/strict";

import { Model } from "../rs/model/Model";
import { collectObjSurfaceHeights, objSurfaceHeightAt } from "../rs/scene/ObjSurfaceHeights";

/** A loc whose model reaches `height` model units up, flagged 256 when it supports items. */
function loc(height: number, supportsItems: boolean) {
    const entity = Object.create(Model.prototype);
    entity.calculateBoundsCylinder = () => {};
    entity.height = height;
    return { flags: supportsItems ? 256 : 0, entity };
}

function scene(locs: Record<string, unknown[]>) {
    const tiles = [0, 1].map((level) =>
        [0, 1, 2].map((x) => [0, 1, 2].map((y) => ({ locs: locs[`${level},${x},${y}`] ?? [] }))),
    );
    return { levels: 2, sizeX: 3, sizeY: 3, tiles } as never;
}

function aCrateRaisesItsTileToItsTallestSupportingModel(): void {
    const packed = collectObjSurfaceHeights(scene({
        "0,1,2": [loc(96, true), loc(120, true), loc(500, false)],
        "1,0,0": [loc(40, true)],
    }));
    assert.equal(objSurfaceHeightAt(packed, 0, 1, 2), 120, "the tallest that supports items");
    assert.equal(objSurfaceHeightAt(packed, 1, 0, 0), 40, "each level has its own");
}

function everywhereElseStaysOnTheGround(): void {
    const packed = collectObjSurfaceHeights(scene({ "0,1,1": [loc(500, false)], "0,2,2": [{ flags: 256, entity: {} }] }));
    assert.equal(packed.length, 0, "a loc that doesn't support items, or has no model, adds nothing");
    assert.equal(objSurfaceHeightAt(packed, 0, 1, 1), 0);
    assert.equal(objSurfaceHeightAt(undefined, 0, 1, 1), 0, "a map square without the data");
}

aCrateRaisesItsTileToItsTallestSupportingModel();
everywhereElseStaysOnTheGround();
console.log("Obj surface height tests passed");
