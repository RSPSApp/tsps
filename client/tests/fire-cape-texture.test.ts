import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { SceneBuffer, getModelFaces } from "../render/buffer/SceneBuffer";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

const cacheInfo = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(
    cacheInfo,
    CacheSystem.fromFiles(cacheInfo, loadCache(cacheInfo).files),
);
const textureLoader = factory.getTextureLoader();
const cape = factory.getObjTypeLoader().load(6570);
const model = factory.getModelLoader().getModel(cape.maleModel);

assert.ok(model, "Fire cape wearable model should load");
const fireTextureId = 40;
assert.ok(model.faceTextures?.includes(fireTextureId), "Fire cape should use texture 40");

const textureLayer = textureLoader.getTextureIds().indexOf(fireTextureId) + 1;
assert.equal(textureLayer, 41, "Fire cape texture should occupy GPU layer 41");

const litModel = model.light(textureLoader, 64, 850, -30, -50, -30);
const layers = new Map(textureLoader.getTextureIds().map((id, index) => [id, index + 1]));
const buffer = new SceneBuffer(textureLoader, layers, litModel.verticesCount);
buffer.addModel(litModel, getModelFaces(litModel));

const packed = new DataView(buffer.vertexBuf.byteArray().buffer);
let textureLayerFromVertex = -1;
for (let offset = 0; offset < packed.byteLength; offset += 12) {
    const v1 = packed.getUint32(offset + 4, true);
    if ((v1 >>> 31) === 0) continue;
    const hsl = (v1 >>> 15) & 0xffff;
    textureLayerFromVertex = (hsl >>> 7) | ((packed.getUint32(offset + 8, true) >>> 5) & 1) << 9;
    break;
}
assert.equal(textureLayerFromVertex, textureLayer, "Fire cape vertices should retain their GPU layer");

const shader = fs.readFileSync(
    path.resolve(__dirname, "../render/shaders/includes/vertex.glsl"),
    "utf8",
);
assert.doesNotMatch(shader, /\) \+ 1\) \* isTextured/, "Shader must not offset texture layers");

console.log("Fire cape texture regression test passed");

test("texture preloads leave missing and empty sparse textures available for later uploads", async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(console, "log", () => {});
    (globalThis as any).self = globalThis;
    for (const ext of [".png", ".jpg", ".webp"]) {
        require.extensions[ext] = (module, file) => { module.exports = file; };
    }
    const { WorldResources } = require("../render/webgpu/WorldResources");
    const { initTextureArray } = require("../render/render/textures/array");
    const pixels = new Int32Array(128 * 128).fill(0xff123456);
    const client = {
        loadedCache: { info: { game: "oldschool", revision: 235 } },
        textureLoader: {
            getTextureIds: () => [1, 2, 3], isSd: () => true, getMaterial: () => ({}),
            getPixelsArgb: (id: number) => {
                if (id === 2) throw new Error("sprite still downloading");
                return id === 3 ? new Int32Array() : pixels;
            },
        },
        clientPlugins: { createWebGPUSceneExtension: () => undefined },
    };
    const device = {
        limits: { maxTextureArrayLayers: 2048 },
        createBuffer: () => ({ destroy() {} }),
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createSampler: () => ({}),
        createPipelineLayout: () => ({}), createShaderModule: () => ({}), createRenderPipeline: () => ({}),
        queue: { writeTexture() {} },
    };
    const world = await WorldResources.create(device, client, "rgba8unorm");
    assert.deepEqual([...world.loadedTextureIds], [1], "WebGPU only skips textures with real uploaded pixels");
    world.uploadMapTextures(new Map([[2, pixels], [3, pixels]]));
    assert.deepEqual([...world.loadedTextureIds], [1, 2, 3], "worker results can fill previously missing layers");
    world.destroy();

    class MockGL {}
    const previousGL = (globalThis as any).WebGL2RenderingContext;
    (globalThis as any).WebGL2RenderingContext = MockGL;
    t.after(() => { (globalThis as any).WebGL2RenderingContext = previousGL; });
    const gl = new Proxy(new MockGL(), { get: () => () => ({}) });
    const host = {
        osrsClient: client, textureIds: [1, 2, 3], loadedTextureIds: new Set<number>(),
        textureIdIndexMap: new Map([[1, 1], [2, 2], [3, 3]]),
        app: { gl, state: { textures: [], activeTexture: 0 } }, gl,
        updateTextureFiltering() {},
    };
    initTextureArray(host);
    assert.deepEqual([...host.loadedTextureIds], [1], "WebGL only skips textures with real uploaded pixels");
    client.textureLoader.getPixelsArgb = () => pixels;
    initTextureArray(host);
    assert.deepEqual([...host.loadedTextureIds], [1, 2, 3]);
});
