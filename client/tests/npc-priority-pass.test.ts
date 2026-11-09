import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTOR_VERTEX_STRIDE } from "../render/buffer/ActorNormals";
import { VertexBuffer } from "../render/buffer/VertexBuffer";
import type { DynamicNpcFrameGeometry } from "../render/npc/DynamicNpcAnimLoader";
import { getNpcPriorityGeometry, usesNpcPriorityPass } from "../render/npc/NpcPriorityPass";

test("museum display opaque faces draw by priority, then back to front", () => {
    const vertices = new VertexBuffer(9, ACTOR_VERTEX_STRIDE);
    for (const [priority, z] of [[2, -10], [0, -20], [2, -30]]) {
        for (let x = 0; x < 3; x++) {
            vertices.addVertex(x, 0, z, 0, 255, 0, 0, -1, false, priority);
        }
    }
    const indices = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const geometry: DynamicNpcFrameGeometry = {
        key: "display", npcTypeId: 6011, seqId: 6437, frameId: 0,
        opaqueVertices: new Uint8Array(vertices.byteArray()), opaqueIndices: indices,
        alphaVertices: new Uint8Array(0), alphaIndices: new Int32Array(0), approxBytes: 0,
    };
    const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    assert.ok(usesNpcPriorityPass(6011));
    assert.ok(!usesNpcPriorityPass(6007));
    const sorted = getNpcPriorityGeometry(geometry, view, 0);
    assert.deepEqual([...sorted.opaqueIndices], [3, 4, 5, 6, 7, 8, 0, 1, 2]);
    assert.equal(getNpcPriorityGeometry(geometry, view, 0), sorted);
    assert.equal(sorted.alphaIndices, geometry.alphaIndices);
    assert.deepEqual([...geometry.opaqueIndices], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual([...getNpcPriorityGeometry(geometry, view, 1024).opaqueIndices],
        [3, 4, 5, 0, 1, 2, 6, 7, 8]);
});
