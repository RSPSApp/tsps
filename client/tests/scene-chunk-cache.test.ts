import assert from "node:assert/strict";
import { test } from "node:test";

import { finishBuild } from "../common/utils/BuildSteps";
import { ModelHashBuffer } from "../render/buffer/ModelHashBuffer";
import { InteractType } from "../render/InteractType";
import { ContourGroundType, SceneBuffer } from "../render/buffer/SceneBuffer";
import type { DrawCommand, SceneModel } from "../render/buffer/SceneBuffer";
import { SceneChunkCache } from "../render/loader/SceneChunkCache";
import { addSceneModels, addSceneModelsByChunk } from "../render/loader/SdMapDataLoader";
import { Model } from "../rs/model/Model";

/**
 * A loc-only rebuild packs the square's scenery chunk by chunk and reuses the chunks whose models
 * didn't change. Reusing must give the geometry that packing the whole list at once does.
 */
const textureLoader = { isTransparent: () => false } as never;
const hashBuf = new ModelHashBuffer(5000);

let seed = 0x6240;
function random(): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 8) / (1 << 24);
}
const pick = (count: number) => Math.floor(random() * count);

function makeModel(faces: number, translucent = false): Model {
    const model = new Model();
    const vertices = faces + 2;
    model.verticesCount = model.usedVertexCount = vertices;
    model.faceCount = faces;
    model.verticesX = Int32Array.from({ length: vertices }, () => pick(200) - 100);
    model.verticesY = Int32Array.from({ length: vertices }, () => -pick(300));
    model.verticesZ = Int32Array.from({ length: vertices }, () => pick(200) - 100);
    model.indices1 = Int32Array.from({ length: faces }, (_, i) => i);
    model.indices2 = Int32Array.from({ length: faces }, (_, i) => i + 1);
    model.indices3 = Int32Array.from({ length: faces }, (_, i) => i + 2);
    const color = () => Int32Array.from({ length: faces }, () => 6000 + pick(2000));
    model.faceColors1 = color();
    model.faceColors2 = color();
    model.faceColors3 = color();
    if (translucent) model.faceAlphas = Int8Array.from({ length: faces }, (_, i) => (i % 2 ? 100 : 0));
    return model;
}

const models = [makeModel(6), makeModel(14), makeModel(40), makeModel(9, true), makeModel(120)];

function sceneModel(model: Model, sceneX: number, sceneZ: number, extra: Partial<SceneModel> = {}): SceneModel {
    return {
        model,
        sceneX,
        sceneZ,
        sceneHeight: -(pick(3) * 16),
        heightOffset: 0,
        level: pick(2),
        priority: pick(3),
        interactType: InteractType.NONE,
        interactId: 40000 + pick(50),
        contourGround: ContourGroundType.NONE,
        lowDetail: pick(4) === 0,
        forceMerge: pick(5) === 0,
        ...extra,
    };
}

/** Placements over a 5x4 grid of chunks; the 40-face model is placed densely so it draws instanced. */
function makeScene(): SceneModel[] {
    const out: SceneModel[] = [];
    for (let i = 0; i < 160; i++) {
        out.push(sceneModel(models[pick(models.length)], pick(5 * 1024), pick(4 * 1024)));
    }
    for (let i = 0; i < 90; i++) out.push(sceneModel(models[2], 1024 + pick(300), 2048 + pick(300), { level: 0, forceMerge: false }));
    return out;
}

const COMMAND_LISTS = [
    "drawCommands", "drawCommandsAlpha", "drawCommandsLod", "drawCommandsLodAlpha",
    "drawCommandsInteract", "drawCommandsInteractAlpha", "drawCommandsInteractLod", "drawCommandsInteractLodAlpha",
] as const;

/** What the buffer draws, independent of the order commands were added and of vertex numbering. */
function canonical(buffer: SceneBuffer): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const list of COMMAND_LISTS) {
        out[list] = (buffer[list] as DrawCommand[]).map((command) => {
            const triangles: string[] = [];
            const first = command.offset / 4;
            for (let i = first; i < first + command.elements; i += 3) {
                triangles.push([0, 1, 2].map((corner) => {
                    const at = buffer.indices[i + corner] * buffer.vertexBuf.stride;
                    return [0, 4, 8].map((word) => buffer.vertexBuf.view.getInt32(at + word, true)).join(",");
                }).join("|"));
            }
            return JSON.stringify({ instances: command.instances, chunk: command.chunk, triangles });
        }).sort();
    }
    return out;
}

function direct(sceneModels: SceneModel[]): SceneBuffer {
    const buffer = new SceneBuffer(textureLoader, new Map(), 1024);
    finishBuild(addSceneModels(hashBuf, textureLoader, buffer, sceneModels, false));
    return buffer;
}

function byChunk(cache: SceneChunkCache, sceneModels: SceneModel[], square = 1): SceneBuffer {
    const buffer = new SceneBuffer(textureLoader, new Map(), 1024);
    finishBuild(addSceneModelsByChunk(hashBuf, textureLoader, buffer, sceneModels, false, cache, square));
    return buffer;
}

/** Counts what the packing does: model groups packed, and chunks packed (a reused chunk is neither). */
function countPacking<T>(run: () => T): { result: T; packed: number; chunks: number } {
    const addModelGroup = SceneBuffer.prototype.addModelGroup;
    const toFragment = SceneBuffer.prototype.toFragment;
    let packed = 0;
    let chunks = 0;
    SceneBuffer.prototype.addModelGroup = function (group) {
        packed += group.models.length;
        return addModelGroup.call(this, group);
    };
    SceneBuffer.prototype.toFragment = function () {
        chunks++;
        return toFragment.call(this);
    };
    try {
        return { result: run(), packed, chunks };
    } finally {
        SceneBuffer.prototype.addModelGroup = addModelGroup;
        SceneBuffer.prototype.toFragment = toFragment;
    }
}

test("packing by chunk draws what packing everything at once draws, cold and reused", () => {
    const scene = makeScene();
    const expected = canonical(direct(scene));
    assert.ok(expected.drawCommands.length > 10 && expected.drawCommandsAlpha.length > 0, "the scene should use every kind of command");

    const cache = new SceneChunkCache();
    const cold = countPacking(() => byChunk(cache, scene));
    assert.deepEqual(canonical(cold.result), expected, "cold chunked pack differs");
    assert.ok(cold.packed > 0);

    const warm = countPacking(() => byChunk(cache, scene));
    assert.deepEqual(canonical(warm.result), expected, "reused chunks differ");
    assert.equal(warm.packed, 0, "an unchanged square must pack nothing");
    assert.equal(warm.result.vertexCount(), cold.result.vertexCount());
    assert.equal(warm.result.indices.length, cold.result.indices.length);
    assert.deepEqual(Array.from(warm.result.usedTextureIds), Array.from(cold.result.usedTextureIds));
});

test("a changed model repacks only its own chunk", () => {
    const scene = makeScene();
    const cache = new SceneChunkCache();
    byChunk(cache, scene);

    // Fell one placement: its chunk loses a model, every other chunk stays as it was.
    const gone = scene.findIndex((m) => m.model === models[4]);
    assert.ok(gone >= 0);
    const chunkOf = (m: SceneModel) => `${Math.floor(m.sceneX / 1024)}:${Math.floor(m.sceneZ / 1024)}`;
    const chunkCount = new Set(scene.map(chunkOf)).size;
    const changed = scene.filter((_, i) => i !== gone);

    const rebuilt = countPacking(() => byChunk(cache, changed));
    assert.deepEqual(canonical(rebuilt.result), canonical(direct(changed)));
    assert.equal(rebuilt.chunks, 1, `packed ${rebuilt.chunks} of ${chunkCount} chunks`);
    assert.ok(chunkCount > 10);

    // The stump: a different model standing where the tree was.
    const replaced = changed.concat(sceneModel(models[0], scene[gone].sceneX, scene[gone].sceneZ, { level: scene[gone].level }));
    const again = countPacking(() => byChunk(cache, replaced));
    assert.deepEqual(canonical(again.result), canonical(direct(replaced)));
    assert.equal(again.chunks, 1, "the stump changes the one chunk it stands in");
});

test("a model that changes colour at the same place is not mistaken for the old one", () => {
    const scene = makeScene();
    const cache = new SceneChunkCache();
    byChunk(cache, scene);

    const target = scene[10];
    const recoloured = makeModel(target.model.faceCount);
    recoloured.verticesX = target.model.verticesX;
    recoloured.verticesY = target.model.verticesY;
    recoloured.verticesZ = target.model.verticesZ;
    recoloured.faceColors1 = target.model.faceColors1.map((c) => c + 1);
    recoloured.faceColors2 = target.model.faceColors2;
    recoloured.faceColors3 = target.model.faceColors3;
    const changed = scene.map((m, i) => (i === 10 ? { ...m, model: recoloured } : m));

    const rebuilt = countPacking(() => byChunk(cache, changed));
    assert.deepEqual(canonical(rebuilt.result), canonical(direct(changed)));
    assert.equal(rebuilt.chunks, 1);
});

test("squares are cached apart and the oldest are dropped past the limit", () => {
    const scene = makeScene();
    const cache = new SceneChunkCache(2, 1 << 30);
    byChunk(cache, scene, 1);
    byChunk(cache, scene, 2);
    assert.equal(countPacking(() => byChunk(cache, scene, 1)).packed, 0);
    byChunk(cache, scene, 3); // pushes out square 2, the one not used last
    assert.equal(countPacking(() => byChunk(cache, scene, 1)).packed, 0, "recently used square is kept");
    assert.ok(countPacking(() => byChunk(cache, scene, 2)).packed > 0, "the oldest square was dropped");

    const tiny = new SceneChunkCache(4, 1);
    byChunk(tiny, scene, 1);
    assert.ok(countPacking(() => byChunk(tiny, scene, 1)).packed > 0, "a square over the byte limit is not kept");
});
