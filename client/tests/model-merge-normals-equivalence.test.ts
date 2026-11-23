import assert from "node:assert/strict";
import { ModelData } from "../rs/model/ModelData";
import { VertexNormal } from "../rs/model/VertexNormal";

/**
 * ModelData.mergeNormals skips pairs whose ranges can't meet and indexes the second model's
 * vertices only when needed. It must still merge exactly what the plain version did: this keeps
 * that version (every pair indexed by "x,z" strings) and compares the two on random models.
 */
const TOLERANCE = (ModelData as unknown as { MERGE_NORMAL_Y_TOLERANCE: number }).MERGE_NORMAL_Y_TOLERANCE;

function referenceMerge(
    model0: ModelData,
    model1: ModelData,
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    hideOccludedFaces: boolean,
): void {
    model0.calculateBounds();
    model0.calculateVertexNormals();
    model1.calculateBounds();
    model1.calculateVertexNormals();
    if (!model0.normals || !model1.normals) return;

    const verticesY0 = model0.contourVerticesY || model0.verticesY;
    const verticesY1 = model1.contourVerticesY || model1.verticesY;
    const tagged0 = new Map<number, true>();
    const tagged1 = new Map<number, true>();
    let mergedCount = 0;

    const vertexMap = new Map<string, number[]>();
    for (let v1 = 0; v1 < model1.usedVertexCount; v1++) {
        if (model1.normals[v1].magnitude === 0) continue;
        const key = `${model1.verticesX[v1]},${model1.verticesZ[v1]}`;
        let indices = vertexMap.get(key);
        if (!indices) vertexMap.set(key, (indices = []));
        indices.push(v1);
    }
    for (let v0 = 0; v0 < model0.usedVertexCount; v0++) {
        const normal0 = model0.normals[v0];
        if (normal0.magnitude === 0) continue;
        const y = verticesY0[v0] - offsetY;
        if (y > model1.minHeight + TOLERANCE) continue;
        const x = model0.verticesX[v0] - offsetX;
        if (x < model1.minX || x > model1.maxX) continue;
        const z = model0.verticesZ[v0] - offsetZ;
        if (z < model1.minZ || z > model1.maxZ) continue;
        for (const v1 of vertexMap.get(`${x},${z}`) ?? []) {
            if (Math.abs(y - verticesY1[v1]) > TOLERANCE) continue;
            const normal1 = model1.normals[v1];
            model0.mergedNormals ??= new Array(model0.usedVertexCount);
            model1.mergedNormals ??= new Array(model1.usedVertexCount);
            const merged0 = (model0.mergedNormals[v0] ??= VertexNormal.copy(normal0));
            const merged1 = (model1.mergedNormals[v1] ??= VertexNormal.copy(normal1));
            merged0.x += normal1.x;
            merged0.y += normal1.y;
            merged0.z += normal1.z;
            merged0.magnitude += normal1.magnitude;
            merged1.x += normal0.x;
            merged1.y += normal0.y;
            merged1.z += normal0.z;
            merged1.magnitude += normal0.magnitude;
            mergedCount++;
            tagged0.set(v0, true);
            tagged1.set(v1, true);
        }
    }
    if (mergedCount >= 3 && hideOccludedFaces) {
        for (const [model, tagged] of [[model0, tagged0], [model1, tagged1]] as const) {
            for (let i = 0; i < model.faceCount; i++) {
                if (tagged.has(model.indices1[i]) && tagged.has(model.indices2[i]) && tagged.has(model.indices3[i])) {
                    model.faceRenderTypes ??= new Int8Array(model.faceCount);
                    model.faceRenderTypes[i] = 2;
                }
            }
        }
    }
}

let seed = 0x6240;
function random(): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 8) / (1 << 24);
}
const pick = (count: number) => Math.floor(random() * count);

function randomModel(): ModelData {
    const model = new ModelData();
    const vertices = 5 + pick(12);
    model.verticesCount = vertices;
    model.usedVertexCount = vertices;
    model.faceCount = 2 + pick(10);
    // A coarse grid, so vertices of two models often coincide; Y wobbles inside and outside the tolerance.
    model.verticesX = Int32Array.from({ length: vertices }, () => pick(5) * 64);
    model.verticesZ = Int32Array.from({ length: vertices }, () => pick(5) * 64);
    model.verticesY = Int32Array.from({ length: vertices }, () => -pick(4) * 32 + pick(5) - 2);
    const corner = () => Int32Array.from({ length: model.faceCount }, () => pick(vertices));
    model.indices1 = corner();
    model.indices2 = corner();
    model.indices3 = corner();
    model.faceColors = new Uint16Array(model.faceCount);
    return model;
}

function copy(model: ModelData): ModelData {
    const clone = new ModelData();
    clone.verticesCount = model.verticesCount;
    clone.usedVertexCount = model.usedVertexCount;
    clone.faceCount = model.faceCount;
    clone.verticesX = model.verticesX.slice();
    clone.verticesY = model.verticesY.slice();
    clone.verticesZ = model.verticesZ.slice();
    clone.indices1 = model.indices1.slice();
    clone.indices2 = model.indices2.slice();
    clone.indices3 = model.indices3.slice();
    clone.faceColors = model.faceColors?.slice();
    return clone;
}

function snapshot(model: ModelData): unknown {
    return {
        merged: model.mergedNormals
            ? Array.from(model.mergedNormals, (n) => n && [n.x, n.y, n.z, n.magnitude])
            : undefined,
        types: model.faceRenderTypes ? Array.from(model.faceRenderTypes) : undefined,
    };
}

let merged = 0;
let skipped = 0;
let hidden = 0;
for (let i = 0; i < 4000; i++) {
    const a = randomModel();
    // Every fourth pair shares its geometry (a wall against its twin), where faces get hidden.
    const b = i % 4 === 0 ? copy(a) : randomModel();
    if (i % 4 === 0) b.verticesY = b.verticesY.map((y) => y + pick(3) - 1);
    // Offsets of the kind Scene.mergeLargeLocNormals passes: whole tiles or half tiles, plus a height.
    const offsets: [number, number, number] = i % 4 === 0
        ? [0, pick(3) - 1, 0]
        : [(pick(5) - 2) * 64, pick(3) - 1, (pick(5) - 2) * 64];
    const hide = random() < 0.5;

    const a2 = copy(a);
    const b2 = copy(b);
    ModelData.mergeNormals(a, b, ...offsets, hide);
    referenceMerge(a2, b2, ...offsets, hide);

    assert.deepEqual(snapshot(a), snapshot(a2), `model0 differs in pair ${i}`);
    assert.deepEqual(snapshot(b), snapshot(b2), `model1 differs in pair ${i}`);
    if (a.mergedNormals) merged++;
    else skipped++;
    if (a.faceRenderTypes || b.faceRenderTypes) hidden++;
}

// Both outcomes must be common, or the comparison proves little.
assert.ok(merged > 300, `only ${merged} pairs merged`);
assert.ok(hidden > 30, `only ${hidden} pairs hid occluded faces`);
assert.ok(skipped > 200, `only ${skipped} pairs were skipped`);

console.log(`model merge-normal equivalence check passed (${merged} merged, ${hidden} hid faces, ${skipped} without a merge)`);
