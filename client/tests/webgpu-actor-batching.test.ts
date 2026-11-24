import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
(globalThis as any).self = globalThis;
const { WebGPUActors } = require("../render/webgpu/actors/WebGPUActors");
const { createScenePipeline } = require("../render/webgpu/multisample");

const geometry = () => ({ vertices: {}, indices: {}, labels: {}, indexCount: 12 });
function state(opaque: any[], alpha: any[] = []) {
    const group = {};
    return { opaque, alpha, uniforms: { bindGroupFor: () => group, offsetFor: (entry: number) => entry * 256 } };
}
function harness(maps: any[]) {
    const actors = Object.create(WebGPUActors.prototype);
    Object.assign(actors, {
        world: { sceneBindGroup: {}, worldTextureBindGroup: {}, sampleCount: 1 },
        actorData: { bindGroup: {} }, variants: new Map(), posePipelines: new Set(), frameMaps: maps,
    });
    const counts = { pipeline: 0, vertex: 0, index: 0, actorGroup: 0 };
    let group: object, offset = 0, pipeline: any;
    const draws: { group: object; pipeline: any; instances: number; entries: number[] }[] = [];
    const pass = {
        setPipeline(value: any) { pipeline = value; counts.pipeline++; },
        setBindGroup(index: number, value: object, offsets?: number[]) {
            if (index === 2) { group = value; offset = offsets?.[0] ?? 0; counts.actorGroup++; }
        },
        setVertexBuffer() { counts.vertex++; }, setIndexBuffer() { counts.index++; },
        drawIndexed(_indices: number, instances = 1, _firstIndex = 0, _baseVertex = 0, firstInstance?: number) {
            const first = firstInstance ?? offset / 256;
            draws.push({ group, pipeline, instances, entries: Array.from({ length: instances }, (_, i) => first + i) });
        },
    };
    return { actors, pass, draws, counts };
}

test("WebGPU identical adjacent opaque actors share one instanced draw and state binds", () => {
    const g = geometry(), pipeline = {};
    const f = harness([state(Array.from({ length: 100 }, (_, entry) => ({ geometry: g, pipeline, entry })))]);
    f.actors.drawOpaque(f.pass);
    assert.equal(f.draws.length, 1, "a 100-NPC crowd sharing geometry needs one draw");
    assert.equal(f.draws[0].instances, 100);
    assert.deepEqual(f.draws[0].entries, Array.from({ length: 100 }, (_, i) => i));
    assert.deepEqual(f.counts, { pipeline: 1, vertex: 1, index: 1, actorGroup: 1 });
});

test("WebGPU opaque batches stop at geometry, actor-row gaps and map/deck boundaries", () => {
    const a = geometry(), b = geometry(), pipeline = {};
    const items = [[a, 2], [a, 3], [a, 7], [b, 8], [a, 9]].map(([geometry, entry]) => ({ geometry, pipeline, entry }));
    const mapA = state(items), mapB = state([{ geometry: a, pipeline, entry: 0 }]);
    const f = harness([mapA, mapB]);
    f.actors.drawOpaque(f.pass);
    assert.deepEqual(f.draws.map(draw => draw.entries), [[2, 3], [7], [8], [9], [0]]);
    assert.notEqual(f.draws[0].group, f.draws[4].group, "a different map/deck keeps its own height map and transform rows");
    assert.equal(f.counts.pipeline, 1);
    assert.equal(f.counts.actorGroup, 2);
});

test("WebGPU transparent actors retain map and draw order with individual actor rows", () => {
    const g = geometry(), pipeline = {};
    const alpha = (entries: number[]) => entries.map(entry => ({ geometry: g, pipeline, entry }));
    const f = harness([state([], alpha([3, 4])), state([], alpha([12, 11]))]);
    f.actors.drawAlpha(f.pass);
    assert.deepEqual(f.draws.map(draw => draw.entries), [[12], [11], [3], [4]]);
    assert.equal(f.counts.pipeline, 1, "the state cache can still avoid redundant alpha binds");
});

test("WebGPU batches keep extended, MSAA and depth player pipelines and label bindings", () => {
    const device = { createRenderPipeline: (descriptor: any) => ({ descriptor }) };
    const extended = createScenePipeline(device, { label: "extended player" });
    const depth = {}, base = {}, g = geometry();
    const item = (entry: number) => ({ geometry: g, pipeline: base, entry });
    const f = harness([state([item(0), item(1)], [item(0), item(1)])]);
    f.actors.world.extensionActive = true;
    f.actors.world.sampleCount = 4;
    f.actors.variants.set(base, { extended, depth });
    f.actors.posePipelines.add(extended);
    f.actors.posePipelines.add(depth);
    f.actors.drawOpaque(f.pass);
    assert.equal(f.draws[0].instances, 2);
    assert.equal(f.draws[0].pipeline.descriptor.multisample.count, 4);
    assert.equal(f.counts.vertex, 2, "player labels remain bound beside the rest mesh");
    f.draws.length = 0;
    f.actors.drawDepth(f.pass);
    assert.deepEqual(f.draws.map(draw => draw.entries), [[0, 1], [0], [1]]);
    assert.ok(f.draws.every(draw => draw.pipeline === depth));
});

test("WebGPU a spot effect shares one actor record between opaque and alpha geometry", () => {
    const f = harness([]);
    const mesh = { vertices: new Uint8Array(20), indices: new Int32Array([0, 1, 2]) };
    f.actors.gfx = { cache: { ensureFrameGeometry: () => mesh } };
    f.actors.geometry = { getOrCreate: () => geometry() };
    f.actors.pipelines = new Map([["gfx", [{}, {}]]]);
    const records: any[][] = [];
    f.actors.actorEntry = (...args: any[]) => { records.push(args); return records.length - 1; };
    const target = state([]);
    f.actors.pushSpotGeometry(target, {}, -1, 3, 0, 0, 10, 7, 0.25, 0.75);
    assert.equal(records.length, 1, "both passes use the same position, actor identity and fractional offsets");
    assert.equal(target.opaque[0].entry, target.alpha[0].entry);
    assert.deepEqual(records[0].slice(4), [7, 0, 0.25, 0.75, -1, 0]);
});
