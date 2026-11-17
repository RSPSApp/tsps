import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
(globalThis as any).self = globalThis;
const { renderOpaqueActorPass } = require("../render/render/frame/render4");

const map = () => ({ renderPosX: 50, renderPosY: 50, timeLoaded: 1, borderSize: 6, heightMapTexture: {} });
function harness(entries: { map: any; dataOffset: number; key: string; worldView?: number }[]) {
    const uniforms = new Map<string, any>();
    const drawCall: any = {
        offsets: [0], numElements: [0], numInstances: [1],
        uniform(key: string, value: any) { uniforms.set(key, value); return this; },
        texture() { return this; },
    };
    const draws: { first: number; instances: number; transform: any }[] = [];
    let uploads = 0;
    const transform = {};
    const host: any = {
        mapManager: { visibleMapCount: 0 }, getRenderCullTile: () => ({ x: 3200, y: 3200 }),
        getFrameRenderDistanceTiles: () => 25, isMapWithinRenderDistance: () => true,
        unbatchedNpcRenderEntries: entries.map((entry, ecsId) => ({ ...entry, ecsId })),
        resolveUnbatchedNpcGeometry: (id: number) => ({ key: entries[id].key, npcTypeId: 1 }),
        uploadDynamicNpcGeometry: () => { uploads++; return 12; },
        dynamicNpcDrawCall: drawCall,
        osrsClient: { npcEcs: { getWorldViewId: (id: number) => entries[id].worldView ?? -1, getNpcTypeId: () => 1 } },
        getNpcModelYOffset: () => 10, getWorldEntityDeckHeight: () => 0,
        worldEntityAnimator: { getTransform: () => transform },
        dynamicNpcSingleDrawRange: [0, 0, 1],
        draw(_call: any, ranges: any[]) {
            assert.equal(drawCall.numInstances[0], ranges[0][2], "the multi-draw backend must see the same instance count");
            draws.push({ first: uniforms.get("u_npcDataOffset"), instances: ranges[0][2], transform: uniforms.get("u_worldEntityTransform") });
        },
    };
    host.dynamicNpcSingleDrawRanges = [host.dynamicNpcSingleDrawRange];
    return { host, draws, drawCall, uploads: () => uploads, transform };
}

test("WebGL a contiguous identical NPC crowd shares geometry upload and instanced draw", () => {
    const square = map();
    const f = harness(Array.from({ length: 100 }, (_, dataOffset) => ({ map: square, dataOffset, key: "idle" })));
    renderOpaqueActorPass(f.host, 0, {});
    assert.equal(f.draws.length, 1);
    assert.equal(f.draws[0].first, 0);
    assert.equal(f.draws[0].instances, 100);
    assert.equal(f.uploads(), 1);
    assert.equal(f.host.dynamicNpcSingleDrawRange[2], 1, "shared alpha/depth range is restored");
    assert.equal(f.drawCall.numInstances[0], 1);
});

test("WebGL NPC instances stop at offset gaps, maps, deck transforms and geometry changes", () => {
    const a = map(), b = map();
    const f = harness([
        { map: a, dataOffset: 0, key: "a" }, { map: a, dataOffset: 1, key: "a" },
        { map: a, dataOffset: 4, key: "a" }, { map: b, dataOffset: 5, key: "a" },
        { map: b, dataOffset: 6, key: "a", worldView: 1 },
        { map: b, dataOffset: 7, key: "a", worldView: 2 },
        { map: b, dataOffset: 8, key: "b", worldView: 2 },
    ]);
    renderOpaqueActorPass(f.host, 0, {});
    assert.deepEqual(f.draws.map(draw => [draw.first, draw.instances]), [[0, 2], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1]]);
    assert.equal(f.draws[3].transform, f.transform);
});

test("WebGL restores the shared instance count when drawing fails", () => {
    const square = map();
    const f = harness([{ map: square, dataOffset: 0, key: "a" }, { map: square, dataOffset: 1, key: "a" }]);
    f.host.draw = () => { throw new Error("draw failed"); };
    assert.throws(() => renderOpaqueActorPass(f.host, 0, {}), /draw failed/);
    assert.equal(f.host.dynamicNpcSingleDrawRange[2], 1);
    assert.equal(f.drawCall.numInstances[0], 1);
});
