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

test("translucent meshes of several priorities are painted lowest priority first, far to near (r241 depthSorted)", async () => {
    const { CacheSystem } = await import("../rs/cache/CacheSystem");
    const { getCacheLoaderFactory } = await import("../rs/cache/loader/CacheLoaderFactory");
    const { loadCache, loadCacheInfos, loadCacheList } = await import("../scripts/cache/load-util");
    const { SceneBuffer } = await import("../render/buffer/SceneBuffer");
    const { getPainterIndices, hasMixedPriorities } = await import("../render/npc/NpcPriorityPass");
    const info = loadCacheList(loadCacheInfos()).latest;
    const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
    const textureLoader = factory.getTextureLoader();
    const mesh = (modelId: number) => {
        const model = factory.getModelLoader().getModel(modelId)!.light(textureLoader, 64, 850, -30, -50, -30);
        const buffer = new SceneBuffer(textureLoader, new Map(), model.verticesCount + 16, true);
        buffer.addModelAnimFrame(model, true, new Uint16Array(model.verticesCount));
        return { model, vertices: new Uint8Array(buffer.vertexBuf.byteArray()), indices: new Int32Array(buffer.indices) };
    };
    // Looking straight down -Z, so a more negative Z is farther.
    const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    // Echo Amoxliatl's icicle spikes (spotanim 3712): black (4), dark red (5) and bright red (6)
    // shells, the black outermost. Live paints the bright red last, over the black.
    const spike = mesh(60153);
    assert.ok(hasMixedPriorities(spike.vertices, spike.indices));
    const sorted = getPainterIndices("spike", spike.vertices, spike.indices, view, 0).indices;
    const data = new DataView(spike.vertices.buffer, spike.vertices.byteOffset, spike.vertices.byteLength);
    const priority = (v: number) => (data.getUint32(v * ACTOR_VERTEX_STRIDE + 8, true) >>> 6) & 7;
    const depth = (v: number) => data.getUint32(v * ACTOR_VERTEX_STRIDE + 8, true) >>> 17;
    const faces = Array.from({ length: sorted.length / 3 }, (_, f) => sorted.subarray(f * 3, f * 3 + 3));
    for (let f = 1; f < faces.length; f++) {
        const [a, b] = [faces[f - 1], faces[f]];
        assert.ok(priority(a[0]) <= priority(b[0]), "priority groups lowest first");
        if (priority(a[0]) === priority(b[0])) {
            assert.ok(depth(a[0]) + depth(a[1]) + depth(a[2]) <= depth(b[0]) + depth(b[1]) + depth(b[2]), "far to near");
        }
    }
    assert.deepEqual([priority(faces[0][0]), priority(faces[faces.length - 1][0])], [4, 6]);

    // The Aberrant spectre's body (0) and shell and eyes (1) mix priorities too.
    const spectre = mesh(5085);
    assert.ok(hasMixedPriorities(spectre.vertices, spectre.indices));
    // A translucent mesh of one priority keeps the normal pass.
    assert.ok(!hasMixedPriorities(spectre.vertices, spectre.indices.slice(spectre.indices.length - 3)));
});
