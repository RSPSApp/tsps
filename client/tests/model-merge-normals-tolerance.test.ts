import assert from "node:assert/strict";
import { ModelData } from "../rs/model/ModelData";

function triangle(yOffset: number): ModelData {
    const model = new ModelData();
    model.verticesCount = 3;
    model.usedVertexCount = 3;
    model.faceCount = 1;

    model.verticesX = Int32Array.from([0, 128, 0]);
    model.verticesY = Int32Array.from([yOffset, -240 + yOffset, -240 + yOffset]);
    model.verticesZ = Int32Array.from([0, 0, 128]);

    model.indices1 = Int32Array.from([0]);
    model.indices2 = Int32Array.from([1]);
    model.indices3 = Int32Array.from([2]);
    model.faceColors = Uint16Array.from([0]);

    return model;
}

const shifted = triangle(1);
const base = triangle(0);
ModelData.mergeNormals(shifted, base, 0, 0, 0, true);

assert.equal(shifted.mergedNormals?.filter(Boolean).length, 3);
assert.equal(base.mergedNormals?.filter(Boolean).length, 3);
assert.equal(shifted.faceRenderTypes?.[0], 2);
assert.equal(base.faceRenderTypes?.[0], 2);

const outsideTolerance = triangle(3);
const comparison = triangle(0);
ModelData.mergeNormals(outsideTolerance, comparison, 0, 0, 0, true);

assert.equal(outsideTolerance.mergedNormals, undefined);
assert.equal(comparison.mergedNormals, undefined);
assert.equal(outsideTolerance.faceRenderTypes, undefined);
assert.equal(comparison.faceRenderTypes, undefined);

console.log("model merge-normal vertical tolerance check passed");
