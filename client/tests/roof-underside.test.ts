import assert from "node:assert/strict";
import { Model } from "../rs/model/Model";
import { Scene } from "../rs/scene/Scene";

(globalThis as any).self = globalThis;
const { SceneBuffer } = require("../render/buffer/SceneBuffer");
const { createSceneModel } = require("../render/loc/SceneLocs");
const scene = new Scene(4, 8, 8);

// A roof viewed from below must have an occluding underside without extra vertices.
const roof = new Model(); roof.verticesCount = roof.usedVertexCount = 4; roof.faceCount = 2;
roof.verticesX = new Int32Array([-64, -64, 64, 64]);
roof.verticesY = new Int32Array(4).fill(-32);
roof.verticesZ = new Int32Array([64, -64, -64, 64]);
roof.indices1 = new Int32Array([0, 0]); roof.indices2 = new Int32Array([1, 2]); roof.indices3 = new Int32Array([2, 3]);
roof.faceColors1 = roof.faceColors2 = roof.faceColors3 = new Int32Array([10000, 10000]);
const locLoader = { load: () => ({ contourGroundType: 0 }) };
const placement = { tag: 0n, flags: 12, x: 64, y: 64, height: 0 };
for (let type = 12; type <= 21; type++) {
    assert.equal(createSceneModel(locLoader, scene, roof, { ...placement, flags: type },
        0, 0, 1, 0, 0, 1).doubleSided, true);
}
assert.equal(createSceneModel(locLoader, scene, roof, { ...placement, flags: 10 },
    0, 0, 1, 0, 0, 1).doubleSided, false, "Ordinary scenery must remain single-sided");
const roofPlacement = createSceneModel(locLoader, scene, roof, placement, 0, 0, 1, 0, 0, 1);
const roofBuffer = new SceneBuffer({} as any, new Map(), 16);
roofBuffer.addModelGroup({ transparent: false, lowDetail: false, level: 1,
    priority: 1, planeCullLevel: 2, models: [roofPlacement] });
assert.equal(roofBuffer.vertexCount(), 4, "Roof undersides must reuse the original vertices and UVs");
assert.equal(roofBuffer.indices.length, 12);
for (let face = 0; face < roofBuffer.indices.length; face += 6)
    assert.deepEqual(roofBuffer.indices.slice(face + 3, face + 6),
        roofBuffer.indices.slice(face, face + 3).reverse(), "Undersides must face the opposite direction");
const animatedRoofBuffer = new SceneBuffer({} as any, new Map(), 16);
assert.equal(animatedRoofBuffer.addModelAnimFrame(roof, false, undefined, true)[1], 12);
assert.equal(animatedRoofBuffer.addModelAnimFrame(roof, false)[1], 6);
assert.equal(roof.faceCount, 2, "Shared cache models must remain unchanged");

console.log("Roof underside checks passed: reverse-facing indices, shared vertices, unchanged ordinary scenery and animation frames");
