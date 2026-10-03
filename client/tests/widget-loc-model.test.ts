import assert from "node:assert/strict";

import { LocModelType } from "../rs/config/loctype/LocModelType";
import { widgetLocModel } from "../render/render/init/widgetLocModel";

// The sailing customisation shows each part's loc (script 8825 via cc_setmodel_loc).
const requests: unknown[][] = [];
const lit: unknown[][] = [];
const unlit: any = {
    ambient: 64,
    contrast: 768,
    light: (...args: unknown[]) => {
        lit.push(args);
        return "lit model";
    },
};
const locTypeLoader: any = { load: (id: number) => (id === 59494 ? { id } : undefined) };
const locModelLoader: any = {
    getModel: (...args: unknown[]) => {
        requests.push(args);
        return unlit;
    },
};
const textureLoader: any = {};

assert.equal(widgetLocModel(59494, locTypeLoader, locModelLoader, textureLoader), "lit model");
assert.deepEqual(requests, [[{ id: 59494 }, LocModelType.NORMAL, 0]], "the loc's centrepiece, unrotated");
assert.deepEqual(lit, [[textureLoader, 64, 768, -50, -10, -50]]);

assert.equal(widgetLocModel(1, locTypeLoader, locModelLoader, textureLoader), undefined, "no such loc");
assert.equal(widgetLocModel(-1, locTypeLoader, locModelLoader, textureLoader), undefined);
assert.equal(requests.length, 1);

console.log("widget-loc-model: ok");
