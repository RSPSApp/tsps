import assert from "node:assert/strict";

// PicoGL expects a browser global when SceneRaycaster imports WebGLMapSquare.
(globalThis as any).self = globalThis;
const { SceneRaycaster } = require("../game/scene/SceneRaycaster");

const npcType = { id: 1300, name: "Fishing spot", modelIds: [1] };
let npcSize = 1;
const npcEcs = {
    queryByMap: () => [1],
    isActive: () => true,
    isLinked: () => true,
    getMapId: () => 7,
    getWorldX: () => 10.5 * 128,
    getWorldY: () => 10.5 * 128,
    getSize: () => npcSize,
    getNpcTypeId: () => 1300,
    getLevel: () => 0,
    getServerId: () => 42,
};
const raycaster = new SceneRaycaster({}, {
    npcEcs,
    npcTypeLoader: { load: () => npcType },
});
raycaster.sampleHeightAt = () => 0;
raycaster.npcHeightProvider = () => 128;

let posedModelRequests = 0;
raycaster.npcTrianglesProvider = () => {
    posedModelRequests++;
    return [[10.5, -0.5, 10.5], [10.6, -0.5, 10.5], [10.5, -0.6, 10.5]];
};

const pick = (x: number) => {
    const hits: any[] = [];
    raycaster.collectNpcHitsForMap(
        { id: 7, mapX: 0, mapY: 0 },
        { origin: [x, -0.5, 8], direction: [0, 0, 1] },
        10,
        hits,
        0,
    );
    return hits;
};

assert.equal(pick(10.99)[0]?.interactId, 1300, "the spot remains selectable near its tile edge");
assert.equal(pick(10.99)[0]?.interactId, 1300, "a stationary pointer keeps selecting the same spot");
assert.equal(posedModelRequests, 0, "spot picking does not depend on animated model bounds");
assert.equal(pick(11.01).length, 0, "the stable hitbox ends at the spot's tile boundary");

npcSize = 5;
assert.equal(pick(12.3)[0]?.interactId, 1300, "a large spot remains selectable across its footprint");
assert.equal(pick(13.01).length, 0, "a large spot's hitbox ends at its footprint boundary");

console.log("Fishing spot hitboxes remain stable across animation frames and NPC sizes");
