import assert from "node:assert/strict";
import { test } from "node:test";

import { Frustum } from "../game/Frustum";
import { newDrawRange, type DrawRange } from "../render/DrawRange";
import { MAP_UNIFORMS_GROUP } from "../render/webgpu/bindings";
import { WebGPUMapSquare, type SceneryDrawContext } from "../render/webgpu/WebGPUMapSquare";

function range(offset: number, elements: number, x: number, chunk = true): DrawRange {
    const r = newDrawRange(offset, elements);
    r.bounds = [x, -1, 0, x + 8, 1, 8];
    if (chunk) r.chunk = [x, 0];
    return r;
}

function fixture(full: DrawRange[], far: DrawRange[], planes?: Uint8Array) {
    const device = {
        queue: { writeBuffer() {}, writeTexture() {} },
        createBuffer: (descriptor: unknown) => ({ descriptor, destroy() {} }),
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBindGroup: (descriptor: unknown) => descriptor,
    };
    const geometry = {
        vertices: new Uint8Array(48), indices: new Int32Array(256),
        modelTextureData: new Uint16Array(64), modelTextureDataAlpha: new Uint16Array(64),
        modelTextureDataLod: new Uint16Array(64), modelTextureDataLodAlpha: new Uint16Array(64),
        drawRanges: full, drawRangesAlpha: [], drawRangesPlanes: planes,
        drawRangesLod: far, drawRangesLodAlpha: [],
    };
    const data = {
        ...geometry, mapX: 0, mapY: 0, borderSize: 0, heightMapSize: 1,
        heightMapTextureData: new Int16Array(4), waterMaskTextureData: new Uint8Array(4),
        doorVertices: new Uint8Array(), doorIndices: new Int32Array(),
        doorDrawRanges: [], doorDrawRangesAlpha: [],
        collisionDatas: Array.from({ length: 4 }, () => ({
            sizeX: 64, sizeY: 64, flags: new Int32Array(64 * 64),
        })),
        tileRenderFlags: [], locsAnimated: [], loc: geometry,
    };
    // Scene and loc groups use the same fixture ranges; make scene empty for draw assertions.
    data.drawRanges = [];
    data.drawRangesLod = [];
    const resources = { depthPipelines: [{}, {}], depthTextureBindGroup: {} };
    const square = WebGPUMapSquare.load(device as any, resources as any, data as any, 0, 0);
    const draws: { count: number; first: number; uniform: number }[] = [];
    let uniform = -1;
    const pass = {
        setPipeline() {}, setVertexBuffer() {}, setIndexBuffer() {},
        setBindGroup(group: number, _binding: unknown, offsets?: number[]) {
            if (group === MAP_UNIFORMS_GROUP) uniform = offsets![0];
        },
        drawIndexed(count: number, _instances: number, first: number) {
            draws.push({ count, first, uniform });
        },
    } as unknown as GPURenderPassEncoder;
    const context: SceneryDrawContext = {
        tileX: 0, tileZ: 0, distance: 40, lodDistance: 8,
        camera: { intersectsBox: (box: number[][]) => box[0][0] < 40 } as Frustum,
    };
    return { square, draws, pass, context, data, device, resources };
}

test("WebGPU editor previews load and draw without collision metadata", () => {
    const f = fixture([range(0, 6, 0)], []);
    const preview = WebGPUMapSquare.load(f.device as any, f.resources as any,
        { ...f.data, collisionDatas: undefined } as any, -1, 0);
    assert.deepEqual(preview.collisionMaps, []);
    assert.equal(preview.getCollisionFlag(0, 7, 9), 0);
    preview.drawOpaque(f.pass, 3, f.context);
    assert.equal(f.draws.length, 1, "draw-only previews still render their model");
    preview.delete();
    f.square.delete();
});

test("WebGPU retains collision flags and refreshes them with scenery metadata", () => {
    const f = fixture([], []);
    f.data.collisionDatas[2].flags[7 + 9 * 64] = 0x20100;
    assert.equal(f.square.getCollisionFlag(2, 7, 9), 0x20100);
    assert.equal(f.square.getCollisionFlag(1, 7, 9), 0);
    const collisionDatas = f.data.collisionDatas.map(data => ({ ...data, flags: data.flags.slice() }));
    collisionDatas[2].flags[7 + 9 * 64] = 0;
    f.square.refreshPartial({ ...f.data, collisionDatas, locOnly: true } as any, {} as any, 1);
    assert.equal(f.square.getCollisionFlag(2, 7, 9), 0);
    f.square.delete();
});

test("WebGPU selects one scenery tier per chunk, culls fog/frustum and keeps unchunked items", () => {
    const f = fixture([range(0, 6, 0), range(24, 12, 24), range(72, 18, 64), range(144, 3, 24, false)],
        [range(156, 3, 0), range(168, 3, 24), range(180, 3, 64)]);
    f.square.drawOpaque(f.pass, 3, f.context);
    assert.deepEqual(f.draws.map(d => [d.first, d.count]), [[0, 6], [36, 3], [42, 3]]);
    const batches = (f.square as any).opaqueBatches;
    assert.equal(batches[0].vertexBuffer, batches[1].vertexBuffer, "tiers share the baked mesh buffers");
    assert.equal(batches[0].indexBuffer, batches[1].indexBuffer);
    f.square.delete();
});

test("WebGPU shadows use full geometry and the light frustum, including off-screen casters", () => {
    const f = fixture([range(0, 6, 0), range(24, 12, 64)], [range(72, 3, 64)]);
    f.square.drawDepth(f.pass, 3, { ...f.context,
        shadow: { intersectsBox: (box: number[][]) => box[0][0] >= 64 } as Frustum });
    assert.deepEqual(f.draws.map(d => [d.first, d.count]), [[6, 12]]);
    f.square.delete();
});

test("WebGPU coalesces identical contiguous terrain, but never across a hidden roof range", () => {
    const full = [range(0, 6, 0), range(24, 6, 0), range(48, 6, 0), range(72, 6, 0)];
    full.forEach(r => r.batchKey = 1);
    const f = fixture(full, [], new Uint8Array([0, 0, 1, 0]));
    f.square.drawOpaque(f.pass, 0, f.context);
    assert.deepEqual(f.draws.map(d => [d.first, d.count, d.uniform]), [[0, 12, 0], [18, 6, 768]]);
    f.square.delete();
});

test("WebGPU boat decks bypass world-coordinate culling and always use full geometry", () => {
    const f = fixture([range(0, 6, 200)], [range(24, 3, 200)]);
    f.square.setWorldEntityTransform(new Float32Array(16));
    f.square.drawOpaque(f.pass, 3, f.context);
    assert.deepEqual(f.draws.map(d => [d.first, d.count]), [[0, 6]]);
    f.square.delete();
});

test("WebGPU advances both full and far animated ranges to the same baked frame", () => {
    const full = [range(0, 6, 0)], far = [range(24, 6, 24)];
    const fullRange = full[0], farRange = far[0];
    const f = fixture(full, far);
    const frame = range(48, 12, 24);
    f.square.locsAnimated = [{ frame: 0, anim: { frames: [frame] }, update() {},
        getDrawRangeIndex: (alpha: boolean) => alpha ? -1 : 0 } as any];
    f.square.updateAnimatedLocs({} as any, 10);
    assert.equal(full[0], fullRange);
    assert.equal(far[0], farRange);
    assert.deepEqual(full[0].slice(0, 2), [48, 12]);
    assert.deepEqual(far[0].slice(0, 2), [48, 12]);
    assert.deepEqual(full[0].chunk, [0, 0]);
    assert.deepEqual(far[0].chunk, [24, 0]);
    f.square.delete();
});


test("WebGPU wall previews give each placement its own uniform slot", () => {
    const f = fixture([range(0, 6, 0)], []);
    const first = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]);
    const second = first.slice(); second[12] = 20;
    f.square.setWorldEntityTransforms([first, second]);
    f.square.drawOpaque(f.pass, 3, f.context);
    assert.deepEqual(f.draws.map(draw => draw.uniform), [0, 256], "copies cannot share the last matrix uploaded");
    f.draws.length = 0;
    f.square.setWorldEntityTransforms([first]);
    f.square.drawOpaque(f.pass, 3, f.context);
    assert.equal(f.draws.length, 1, "shortening a wall removes old preview copies");
    f.draws.length = 0;
    f.square.setWorldEntityTransforms([]);
    f.square.drawOpaque(f.pass, 3, f.context);
    assert.equal(f.draws.length, 0, "clearing previews leaves no phantom copy");
    f.square.delete();
});
