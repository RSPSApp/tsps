import assert from "node:assert/strict";

import { PlayerPoseGeometry } from "../render/webgpu/actors/actorPlayers";
import { Model } from "../rs/model/Model";

const baseModel = new Model();
baseModel.verticesCount = baseModel.usedVertexCount = 4;
baseModel.verticesX = new Int32Array([0, 128, 0, 128]);
baseModel.verticesY = new Int32Array([0, 0, -128, -128]);
baseModel.verticesZ = new Int32Array(4);
baseModel.faceCount = 2;
baseModel.indices1 = new Int32Array([0, 0]);
baseModel.indices2 = new Int32Array([1, 2]);
baseModel.indices3 = new Int32Array([2, 3]);
baseModel.faceColors1 = baseModel.faceColors2 = baseModel.faceColors3 = new Int32Array([100, 200]);
baseModel.faceAlphas = new Int8Array([0, -128]);

const appearance = { getCacheKey: () => "same-appearance" };
const client: any = {
    textureLoader: {}, clientPlugins: { smoothsPlayer: () => false },
    playerEcs: {
        getAnimSeqId: () => -1, getAnimMovementSeqId: () => 1, getAnimSeq: () => 1,
        getAppearance: () => appearance, getServerIdForIndex: (pid: number) => pid,
    },
    playerAnimController: {
        getSequenceState: () => undefined,
        getMovementSequenceState: (pid: number) => ({ frame: pid - 1 }),
    },
};
const geometry: any = new PlayerPoseGeometry(client, new Map(), new Set(), () => {});
geometry.baseForAppearance = () => ({ baseModel, baseCenterX: 0, baseCenterZ: 0 });
geometry.applySequenceToModel = (model: Model, _seqId: number, frame: number) => {
    model.verticesY[0] -= frame * 32;
    return true;
};

const first = geometry.resolve(1, false)!;
assert.ok(first.opaqueVertices.length > 0 && first.alphaVertices.length > 0);
const opaqueBefore = first.opaqueVertices.slice(), alphaBefore = first.alphaVertices.slice();
const second = geometry.resolve(2, false)!;
assert.notDeepEqual(second.opaqueVertices, opaqueBefore, "the next CPU pose has different opaque geometry");
assert.notDeepEqual(second.alphaVertices, alphaBefore, "the next CPU pose has different alpha geometry");
assert.equal(geometry.resolve(1, false), first, "the old CPU pose remains cached for a later GPU re-upload");
assert.deepEqual(first.opaqueVertices, opaqueBefore, "a later pose cannot overwrite cached opaque bytes");
assert.deepEqual(first.alphaVertices, alphaBefore, "a later pose cannot overwrite cached alpha bytes");
assert.equal(first.logicalHeight, -first.bounds![1], "cached CPU geometry retains its animated model height");
assert.equal(second.logicalHeight, -second.bounds![1]);
console.log("CPU player pose cache snapshots passed");


assert.ok(first.bounds && second.bounds, "final CPU poses retain bounds for both geometry passes");
let boundsTests = 0, poseRequests = 0;
geometry.poseCache.set(first.key, null);
geometry.poseFor = () => { poseRequests++; return undefined; };
const offscreen = (cached: any) => { boundsTests++; assert.equal(cached, first); return false; };
assert.equal(geometry.resolve(1, true, offscreen), undefined);
assert.equal(boundsTests, 1);
assert.equal(poseRequests, 0, "known off-screen CPU poses must skip pose preparation");
assert.equal(geometry.resolve(3, true, offscreen)?.key.includes("|2"), true,
    "unknown animation frames prepare once and do not inherit old bounds");
assert.equal(boundsTests, 1);
assert.equal(poseRequests, 1);
geometry.poseCache.delete(first.key);
assert.equal(geometry.resolve(1, true, () => { throw new Error("unverified GPU pose was culled"); }), first,
    "a pose without known CPU-only eligibility is retained");
console.log("CPU player visibility checks passed");
