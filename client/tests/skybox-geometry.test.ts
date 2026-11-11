import assert from "node:assert/strict";

import { buildSkyboxGeometry } from "../render/SkyboxGeometry";

// One flat face, one smooth face, one hidden by lighting (colour3 -2), one fully transparent.
const geometry = buildSkyboxGeometry({
    faceCount: 4,
    indices1: Int32Array.of(0, 0, 0, 0),
    indices2: Int32Array.of(1, 1, 1, 1),
    indices3: Int32Array.of(2, 2, 2, 2),
    verticesX: [0, 128, 0],
    verticesY: [-256, 0, 0],
    verticesZ: [0, 0, 128],
    faceColors1: Int32Array.of(100, 100, 100, 100),
    faceColors2: Int32Array.of(0, 200, 0, 0),
    faceColors3: Int32Array.of(-1, 300, -2, 0),
    faceAlphas: Int8Array.of(0, 128 - 256, 0, -1),
});
assert.equal(geometry.vertexCount, 6);
// Positions stay in model units; the shader divides by 128 around the camera.
assert.deepEqual(Array.from(geometry.positions.slice(0, 9)), [0, -256, 0, 128, 0, 0, 0, 0, 128]);
// A flat face repeats colour1 at every corner and is opaque.
assert.deepEqual(Array.from(geometry.colors.slice(0, 4)), Array.from(geometry.colors.slice(8, 12)));
assert.equal(geometry.colors[3], 1);
// Alpha byte 128 is about half transparent.
assert.ok(Math.abs(geometry.colors[12 + 3] - (1 - 128 / 255)) < 1e-6);
console.log("skybox geometry: ok");
