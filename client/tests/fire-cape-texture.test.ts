import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { SceneBuffer, getModelFaces } from "../render/buffer/SceneBuffer";
import { createActorShaderModule } from "../render/webgpu/shaders/actor.wgsl";
import { createMainVertexWgsl } from "../render/webgpu/shaders/main.vert.wgsl";
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

test("WebGPU material reads preserve signed scroll speeds for capes and other animated textures", () => {
    let actorShader = "";
    createActorShaderModule({ createShaderModule: ({ code }: GPUShaderModuleDescriptor) => {
        actorShader = code;
        return {};
    } } as GPUDevice, { alpha: false });
    for (const shader of [createMainVertexWgsl(), actorShader]) {
        for (const component of ["U", "V"]) {
            // Execute the scalar read emitted by the shader, using the unsigned atlas bytes.
            const expression = shader.match(new RegExp(`material\\.anim${component} = ([^;]+);`))![1];
            const read = new Function("data", "i32", `return ${expression.replace(/(\d+)u\b/g, "$1")};`);
            for (let speed = -128; speed <= 127; speed++) {
                const byte = new Uint8Array(new Int8Array([speed]).buffer)[0];
                assert.equal(read({ r: byte, g: byte }, (value: number) => value | 0), speed);
            }
        }
    }
    for (const [itemId, textureId, speed] of [[6570, 40, -2], [21295, 59, -1]]) {
        const cape = factory.getObjTypeLoader().load(itemId);
        assert.ok(factory.getModelLoader().getModel(cape.maleModel)?.faceTextures?.includes(textureId));
        const material = textureLoader.getMaterial(textureId);
        assert.deepEqual([material.animU, material.animV, material.frameCount], [0, speed, 1]);
    }
});

test("renderers can use map textures before worker preloads finish", async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(console, "log", () => {});
    (globalThis as any).self = globalThis;
    for (const ext of [".png", ".jpg", ".webp"]) {
        require.extensions[ext] = (module, file) => { module.exports = file; };
    }
    const pico = require("picogl");
    pico.PicoGL = pico;
    const { WorldResources } = require("../render/webgpu/WorldResources");
    const { initTextureArray, updateTextureArray } = require("../render/render/textures/array");
    const pixels = new Int32Array(128 * 128).fill(0xff123456);
    const pending: ((textures: Map<number, Int32Array>) => void)[] = [];
    const client = {
        workerPool: { preloadWorldTextures: (ids: number[], size: number) => {
            assert.deepEqual(ids, [1, 2, 3]);
            assert.equal(size, 128);
            return new Promise<Map<number, Int32Array>>((resolve) => pending.push(resolve));
        } },
        textureLoader: {
            getTextureIds: () => [1, 2, 3], isSd: () => true,
            getMaterial: (id: number) => textureLoader.getMaterial(id === 1 ? 40 : 59),
        },
        clientPlugins: { createWebGPUSceneExtension: () => undefined },
    };
    let materialBytes: Uint8Array | undefined;
    const device = {
        limits: { maxTextureArrayLayers: 2048 },
        createBuffer: () => ({ destroy() {} }),
        createTexture: ({ label }: GPUTextureDescriptor) => ({ label, createView: () => ({}), destroy() {} }),
        createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createSampler: () => ({}),
        createPipelineLayout: () => ({}), createShaderModule: () => ({}), createRenderPipeline: () => ({}),
        queue: { writeTexture(destination: GPUImageCopyTexture, data: Int8Array) {
            if (destination.texture.label === "webgpu material lookup") materialBytes = new Uint8Array(data.buffer.slice(0));
        } },
    };
    const world = await WorldResources.create(device, client, "rgba8unorm");
    assert.deepEqual(Array.from(materialBytes!.slice(4, 6)), [0, 254], "Fire cape's -2 is uploaded as unsigned byte 254");
    assert.deepEqual(Array.from(materialBytes!.slice(8, 10)), [0, 255], "Infernal cape's -1 is uploaded as unsigned byte 255");
    assert.equal(world.loadedTextureIds.size, 0);
    world.uploadMapTextures(new Map([[2, pixels]]));
    pending.shift()!(new Map([[1, pixels], [2, pixels]]));
    await Promise.resolve();
    assert.deepEqual([...world.loadedTextureIds], [2, 1], "missing layers remain available for map uploads");
    world.uploadMapTextures(new Map([[3, pixels]]));
    assert.equal(world.loadedTextureIds.size, 3);
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
        updateTextureArray(textures: Map<number, Int32Array>) { updateTextureArray(this, textures); },
    };
    initTextureArray(host);
    assert.equal(host.loadedTextureIds.size, 0);
    initTextureArray(host);
    host.updateTextureArray(new Map([[2, pixels]]));
    pending.shift()!(new Map([[3, pixels]]));
    pending.shift()!(new Map([[1, pixels], [2, pixels]]));
    await Promise.resolve();
    assert.deepEqual([...host.loadedTextureIds], [2, 1], "a replaced atlas ignores the stale preload");
    host.updateTextureArray(new Map([[3, pixels]]));
    assert.equal(host.loadedTextureIds.size, 3);
});

test("quiet mipmap regeneration does not wait for off-screen preload or retry backoff", async () => {
    (globalThis as any).self = globalThis;
    const pico = require("picogl");
    pico.PicoGL = pico;
    const { maybeRegenerateTextureMipmaps } = await import("../render/render/textures/array");
    const { TextureFilterMode } = await import("../render/render/constants");
    let ready = false, generated = 0;
    const host: any = {
        textureMipmapsDirty: true, textureMipmapsDirtyAtMs: 0,
        textureMipmapsLastGenAtMs: 0, textureMipmapsDirtyUpdates: 1,
        textureFilterMode: TextureFilterMode.BILINEAR,
        textureArray: { bind() {} },
        gl: { generateMipmap: () => generated++ },
        mapManager: { isSceneReady: () => ready }, stats: { frameCount: 10 },
        hasPendingMapStreamingWork: () => true,
    };
    maybeRegenerateTextureMipmaps(host, 300);
    assert.equal(generated, 0, "foreground streaming still defers the quiet path");
    ready = true;
    host.textureFilterMode = TextureFilterMode.DISABLED;
    maybeRegenerateTextureMipmaps(host, 300);
    assert.equal(generated, 0);
    assert.equal(host.textureMipmapsDirty, true, "enabling filtering must still see pending uploads");
    host.textureFilterMode = TextureFilterMode.BILINEAR;
    maybeRegenerateTextureMipmaps(host, 300);
    assert.equal(generated, 1, "even a single remaining texture gets mipmaps during background work");
    assert.equal(host.textureMipmapsDirty, false);
    assert.equal(host.textureMipmapsDirtyUpdates, 0);
});
