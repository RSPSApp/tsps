import type { Model } from "../../rs/model/Model";

// One extra word carries an octahedral normal and the original face colour.
export const ACTOR_VERTEX_STRIDE = 16;

export function packActorNormal(x: number, y: number, z: number): number {
    const length = Math.abs(x) + Math.abs(y) + Math.abs(z);
    if (length < 1e-10) return 0;
    x /= length;
    y /= length;
    if (z < 0) {
        const oldX = x;
        x = (1 - Math.abs(y)) * (x < 0 ? -1 : 1);
        y = (1 - Math.abs(oldX)) * (y < 0 ? -1 : 1);
    }
    // Reserve zero for meshes without actor normals, including effect meshes.
    return Math.round(128 + x * 127) | (Math.round(128 + y * 127) << 8);
}

type ActorNormalScratch = { groups: Int32Array; sums: Float32Array; normals: Uint16Array };
const normalScratch = new WeakMap<Model, ActorNormalScratch>();

function createNormalScratch(baseModel: Model): ActorNormalScratch {
    const welded = new Map<string, number>();
    const groups = new Int32Array(baseModel.verticesCount);
    const { verticesX: x, verticesY: y, verticesZ: z } = baseModel;
    for (let i = 0; i < baseModel.verticesCount; i++) {
        const key = `${x[i]}:${y[i]}:${z[i]}`;
        let group = welded.get(key);
        if (group === undefined) {
            group = welded.size;
            welded.set(key, group);
        }
        groups[i] = group;
    }
    return { groups, sums: new Float32Array(welded.size * 3), normals: new Uint16Array(baseModel.verticesCount) };
}

/** Rebuild posed normals in reusable storage; weld once in the rest pose. */
export function buildActorNormals(model: Model, baseModel: Model = model): Uint16Array {
    let scratch = normalScratch.get(baseModel);
    if (!scratch || scratch.normals.length !== model.verticesCount) {
        scratch = createNormalScratch(baseModel);
        normalScratch.set(baseModel, scratch);
    }
    const { groups, sums, normals } = scratch;
    const { verticesX: x, verticesY: y, verticesZ: z } = model;
    sums.fill(0);
    for (let face = 0; face < model.faceCount; face++) {
        if (model.faceColors3[face] === -2) continue;
        const a = model.indices1[face], b = model.indices2[face], c = model.indices3[face];
        const abX = x[b] - x[a], abY = y[b] - y[a], abZ = z[b] - z[a];
        const acX = x[c] - x[a], acY = y[c] - y[a], acZ = z[c] - z[a];
        const nx = abY * acZ - abZ * acY;
        const ny = abZ * acX - abX * acZ;
        const nz = abX * acY - abY * acX;
        const lengthSquared = nx * nx + ny * ny + nz * nz;
        if (lengthSquared < 1e-20) continue;
        const inverseLength = 1 / Math.sqrt(lengthSquared);
        const sx = nx * inverseLength, sy = ny * inverseLength, sz = nz * inverseLength;
        const ga = groups[a] * 3, gb = groups[b] * 3, gc = groups[c] * 3;
        sums[ga] += sx; sums[ga + 1] += sy; sums[ga + 2] += sz;
        sums[gb] += sx; sums[gb + 1] += sy; sums[gb + 2] += sz;
        sums[gc] += sx; sums[gc + 1] += sy; sums[gc + 2] += sz;
    }
    for (let i = 0; i < normals.length; i++) {
        const offset = groups[i] * 3;
        normals[i] = packActorNormal(sums[offset], sums[offset + 1], sums[offset + 2]);
    }
    // The caller packs these into its geometry before building another pose.
    return normals;
}
