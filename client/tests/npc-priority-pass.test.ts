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

test("translucent graphics of several priorities are painted lowest priority first, far to near (r241 depthSorted)", async () => {
    const { CacheSystem } = await import("../rs/cache/CacheSystem");
    const { getCacheLoaderFactory } = await import("../rs/cache/loader/CacheLoaderFactory");
    const { loadCache, loadCacheInfos, loadCacheList } = await import("../scripts/cache/load-util");
    const { SceneBuffer, getModelFacesFiltered } = await import("../render/buffer/SceneBuffer");
    const { getPainterIndices, hasMixedPriorities } = await import("../render/npc/NpcPriorityPass");
    const info = loadCacheList(loadCacheInfos()).latest;
    const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
    const textureLoader = factory.getTextureLoader();
    // Built as GfxCache builds a graphic's translucent frame.
    const model = factory.getModelLoader().getModel(60153)!.light(textureLoader, 64, 850, -30, -50, -30);
    const faces = getModelFacesFiltered(model, textureLoader, true);
    const buffer = new SceneBuffer(textureLoader, new Map(), model.verticesCount + 16, true);
    buffer.addModel(model, faces, undefined, true, new Uint16Array(model.verticesCount));
    const vertices = new Uint8Array(buffer.vertexBuf.byteArray());
    const indices = new Int32Array(buffer.indices);
    const facePriorities = Uint8Array.from(faces, (face) => face.renderLayer ?? face.priority);
    // Looking straight down -Z, so a more negative Z is farther.
    const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const data = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const depth = (v: number) => data.getUint32(v * ACTOR_VERTEX_STRIDE + 8, true) >>> 17;
    const band = (v: number) => (data.getUint32(v * ACTOR_VERTEX_STRIDE + 8, true) >>> 6) & 7;

    // Echo Amoxliatl's icicle spikes (spotanim 3712): black (4), dark red (5) and bright red (6)
    // shells, the black outermost. Live paints the bright red last, over the black. The vertex
    // packing still bands 4 with 5 for the depth bias, so the sort takes the cache priorities.
    assert.deepEqual([...new Set(faces.map((face) => face.priority))].sort(), [4, 5, 6]);
    assert.deepEqual([...new Set(Array.from(indices, band))].sort(), [4, 5]);
    assert.ok(hasMixedPriorities(vertices, indices, facePriorities));

    const sorted = getPainterIndices("spike", vertices, indices, view, 0, facePriorities).indices;
    const priorityOf = new Map<number, number>();
    for (let f = 0; f < faces.length; f++) priorityOf.set(indices[f * 3] * 1e6 + indices[f * 3 + 1] * 1e3 + indices[f * 3 + 2], facePriorities[f]);
    const order = Array.from({ length: sorted.length / 3 }, (_, f) => {
        const [a, b, c] = sorted.subarray(f * 3, f * 3 + 3);
        return { priority: priorityOf.get(a * 1e6 + b * 1e3 + c)!, depth: depth(a) + depth(b) + depth(c) };
    });
    for (let f = 1; f < order.length; f++) {
        assert.ok(order[f - 1].priority <= order[f].priority, "priority groups lowest first");
        if (order[f - 1].priority === order[f].priority) assert.ok(order[f - 1].depth <= order[f].depth, "far to near");
    }
    assert.deepEqual([...new Set(order.map((face) => face.priority))], [4, 5, 6]);

    // A translucent mesh of one priority keeps the normal pass.
    assert.ok(!hasMixedPriorities(vertices, indices.slice(0, 3), facePriorities.slice(0, 1)));
});
