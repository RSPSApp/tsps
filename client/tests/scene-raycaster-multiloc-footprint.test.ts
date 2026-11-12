import assert from "node:assert/strict";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

// The Giants' Foundry mould jig is loc 44777, a 3x3 multiloc whose forms (Empty, Setup, ...) are
// 1x1. SceneBuilder places a loc by the map's id, so the jig is drawn around the middle of its
// 3x3 footprint; hover used to size it by its form and click-tested a tile away.
const PARENT_ID = 44777;
const FORM_ID = 44625;
const parent = { id: PARENT_ID, sizeX: 3, sizeY: 3, transforms: [FORM_ID] };
const form = { id: FORM_ID, sizeX: 1, sizeY: 1, actions: ["Setup"], isInteractive: 1 };
const raycaster = new SceneRaycaster({}, {
    locTypeLoader: { load: (id: number) => (id === PARENT_ID ? parent : form) },
    varManager: {},
});
raycaster.getResolvedLocType = () => form;
raycaster.sampleHeightAt = () => 0;

const BASE_X = 3328;
const BASE_Y = 11456;
const map = {
    id: 1,
    interactionPlane: -1,
    getRenderBaseTileX: () => BASE_X,
    getRenderBaseTileY: () => BASE_Y,
    getLocalTileSpan: () => 64,
    getLocIdsAtLocal: (_level: number, x: number, y: number) => (x === 42 && y === 32 ? [PARENT_ID] : []),
    getLocTypeRotsAtLocal: () => [10 | (1 << 6)], // scenery, rotation 1 (the jig is placed turned)
};
raycaster.getMapLocalTile = (_map: unknown, x: number, y: number) => ({ x: x - BASE_X, y: y - BASE_Y });
raycaster.osrsClient = {
    ...raycaster.osrsClient,
    locTypeLoader: { load: (id: number) => (id === PARENT_ID ? parent : form) },
    groundItems: { getStacksAt: () => undefined },
};
const placed: Array<[number, number]> = [];
raycaster.intersectLocModel = (_ray: unknown, _max: number, _type: unknown, _modelType: number,
    _rotation: number, entityX: number, entityZ: number) => {
    placed.push([entityX, entityZ]);
    return undefined;
};

raycaster.collectTileHits(map, {}, 3370, 11488, 50, [], undefined, undefined, 0);

// Anchor (3370, 11488): the middle of the 3x3 footprint is 1.5 tiles on, in 1/128ths.
assert.equal(placed.length, 1);
assert.deepEqual(placed[0], [3370 * 128 + 192, 11488 * 128 + 192]);
console.log("Multiloc hover uses the placed footprint");
