import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHdProgram } from "../game/plugins/hd/HdShader";
import { resolveHdEnvironment } from "../game/plugins/hd/HdEnvironment";
import { animateHdLight, hdLightOffset } from "../game/plugins/hd/HdLights";
import { HD_OBJECT_LIGHTS_BY_ID } from "../game/plugins/hd/hdObjectLightData";
import { prependDefines } from "../render/shaders/ShaderUtil";

function shader(file: string): string {
    return fs.readFileSync(file, "utf8").replace(/^#include "([^"]+)";?/gm,
        (_, include) => shader(path.resolve(path.dirname(file), include)));
}

const lighting = shader(path.resolve(__dirname, "../game/plugins/hd/hd-lighting.glsl"));
const programs: string[][] = [];
for (const kind of ["main", "npc", "projectile", "player"]) {
    const vertex = shader(path.resolve(__dirname, `../render/shaders/${kind}.vert.glsl`));
    const fragment = shader(path.resolve(__dirname, `../render/shaders/${kind === "player" ? "player" : "main"}.frag.glsl`));
    for (const alpha of [false, true]) for (const multiDraw of [false, true]) {
        const defines = [...(alpha ? ["DISCARD_ALPHA"] : []), ...(multiDraw ? ["MULTI_DRAW"] : [])];
        const result = createHdProgram([prependDefines(vertex, defines), prependDefines(fragment, defines)], lighting);
        assert.match(result[0], /uniform bool u_hdEnabled/);
        assert.ok(result[0].includes(`v_hdTerrain = ${kind === "main" ? "modelInfo.contourGround == 3.0 ? 1.0 : 0.0" : "0.0"};`),
            "Only terrain draws may replace geometric lighting normals");
        assert.match(result[0], /flat out float v_hdTerrain;/);
        assert.match(result[1], /flat in float v_hdTerrain;/);
        if (kind === "main") assert.match(result[0], /if \(modelInfo.contourGround < CONTOUR_GROUND_NONE\) \{\s*localPos.y -= getHeightInterp/);
        assert.match(result[1], /if \(u_hdEnabled &&/);
        assert.match(result[1], /if \(!gl_FrontFacing\) normal = -normal;/);
        assert.ok(!result[1].includes("if (dot(normal, viewDir) < 0.0) normal = -normal;"),
            "Smooth normals must not flip at grazing camera angles");
        if (kind !== "player") {
            assert.match(result[1], /if \(u_hdEnabled && !isFloorWater\)/);
            assert.ok(fragment.includes("const bool hdWater = false;"), "Core water is vanilla without 117 HD");
            assert.ok(result[1].includes("bool hdWater = u_hdEnabled;"), "117 HD switches floor water on");
            const waterFunction = fragment.slice(fragment.indexOf("vec3 shadeWater("), fragment.indexOf("vec4 sampleModelTexture("));
            assert.ok(result[1].includes(waterFunction), "Water shading must remain byte-for-byte unchanged");
        }
        programs.push(result);
    }
}
assert.throws(() => createHdProgram(["invalid", "invalid"], lighting), /unsupported/);
assert.equal(resolveHdEnvironment(0, 0).name, "default");
assert.equal(resolveHdEnvironment(2595 >> 8 << 6, (2595 & 255) << 6).name, "OVERWORLD");
const torch = HD_OBJECT_LIGHTS_BY_ID[196][0];
assert.ok(Number.isFinite(animateHdLight(torch, 5, 1234)));
assert.equal(animateHdLight({ ...torch, type: "STATIC" }, 1, 0), 1);
assert.deepEqual(hdLightOffset("CENTER", 3, 2, 4), [0, 0]);
assert.deepEqual(hdLightOffset("NORTH", 3, 2, 4), [0, 2]);
assert.ok(Math.abs(hdLightOffset("FRONT", 0, 2, 4)[1] + 2) < 1e-6);
assert.ok(Math.abs(hdLightOffset("FRONT", 1, 2, 4)[0] + 1) < 1e-6);

// Stub only asset loading; exercise the real plugin and its renderer lifecycle.
require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
require.extensions[".png"] = (module, file) => { module.exports = file; };
require.extensions[".jpg"] = (module, file) => { module.exports = file; };
(globalThis as any).self = globalThis;
const { HdPlugin } = require("../game/plugins/hd/HdPlugin");
const storage = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) };
(globalThis as any).Image = class { onload = null; onerror = null; src = ""; };
const plugin = new HdPlugin();
let frameTime = 0;
const originalNow = performance.now;
performance.now = () => frameTime;
assert.equal(plugin.isEnabled(), false, "Fresh installs must keep HD disabled");
let deleted = 0;
let shadows = 0;
let actorShadows = 0;
let shadowCopies = 0;
let viewport: number[] = [];
const resource = () => ({ delete: () => deleted++, data() {}, resize() {}, depthTarget() { return this; } });
const values = new Map<string, unknown>();
let programBinds = 0;
const program = { bind() { programBinds++; }, uniform: (name: string, value: unknown) => values.set(name, value) };
const app = {
    createTexture2D: resource, createTextureArray: resource, createFramebuffer: resource,
    drawFramebuffer(value: unknown) { this.target = value; return this; }, target: undefined as unknown,
    readFramebuffer() { return this; }, defaultReadFramebuffer() { return this; },
    blitFramebuffer(mask: number) { assert.equal(mask, 256); shadowCopies++; return this; },
    viewport(...rect: number[]) { viewport = rect; return this; }, disable() { return this; }, enable() { return this; }, depthMask() { return this; },
};
const renderer = {
    app, gl: { getParameter: () => [0, 0, 640, 480], isEnabled: () => false, clear() {}, drawBuffers() {} },
    playerPosUni: [0, 0], getFrameRenderDistanceTiles: () => 50, getPlayerRawPlane: () => 0,
    osrsClient: { camera: { viewMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } },
    mapManager: { visibleMapCount: 0 }, textureIdIndexMap: new Map(),
    sampleHeightAtExactPlane: () => 0, shouldUseDirectTextureScenePass: () => true,
    framebuffer: {}, textureFramebuffer: {},
    renderOpaquePass: () => {
        assert.deepEqual(viewport, [0, 0, 2048, 2048]);
        assert.equal(values.get("u_hdShadowPass"), true);
        assert.equal(values.get("u_hdEnabled"), true);
        assert.equal(values.get("u_hdShadowStrength"), 0.5);
        assert.deepEqual(values.get("u_hdGrading"), [1.12, 1, 0.6, 0]);
        shadows++;
    }, renderTransparentPass() {},
};
plugin.sceneProgramsReady(renderer, [program]);
plugin.beforeSceneRender(renderer, () => actorShadows++);
assert.equal(shadows, 0);
assert.equal(programBinds, 1, "Batch disabled-state uniforms into one program bind");
plugin.setEnabledState(true);
programBinds = 0;
plugin.beforeSceneRender(renderer, () => actorShadows++);
assert.equal(programBinds, 2, "Bind once for shadow uniforms and once to restore the scene pass");
assert.equal(shadows, 1);
assert.deepEqual(viewport, [0, 0, 640, 480], "Restore scene viewport after the smaller shadow pass");
assert.equal(actorShadows, 1);
assert.equal(shadowCopies, 1);
assert.equal(app.target, renderer.textureFramebuffer, "Restore the active direct-texture target");
assert.equal(values.get("u_hdShadowPass"), false);
const shadowMatrix = Array.from(values.get("u_hdShadowMatrix") as Float32Array);
for (const i of [12, 13]) assert.equal(shadowMatrix[i] * 1024, Math.round(shadowMatrix[i] * 1024), "Snap the shadow projection to texels");
frameTime = 8;
renderer.playerPosUni[0] = 0.1;
programBinds = 0;
plugin.beforeSceneRender(renderer, () => actorShadows++);
assert.equal(shadows, 1, "Reuse the shadow map between 15 Hz updates");
assert.equal(actorShadows, 2, "Moving actor shadows must use the current pose every frame");
assert.equal(shadowCopies, 2, "Replace previous actor depth with cached world depth");
assert.equal(programBinds, 2);
assert.deepEqual(Array.from(values.get("u_hdShadowMatrix") as Float32Array), shadowMatrix);
assert.equal((values.get("u_hdLightPositions[0]") as Float32Array).length, 16 * 4);
frameTime = 68;
plugin.beforeSceneRender(renderer, () => actorShadows++);
assert.equal(shadows, 2, "Refresh moving shadows at the next deadline");
renderer.playerPosUni[0] = 10;
plugin.beforeSceneRender(renderer, () => actorShadows++);
assert.equal(shadows, 3, "Teleporting must refresh shadows immediately");
frameTime = 136;
renderer.renderOpaquePass = () => { throw new Error("draw failed"); };
assert.throws(() => plugin.beforeSceneRender(renderer, () => {}), /draw failed/);
assert.equal(values.get("u_hdShadowPass"), false, "Restore shadow state even after a failed draw");
assert.equal(app.target, renderer.textureFramebuffer);
plugin.setEnabledState(false);
plugin.beforeSceneRender(renderer, () => {});
assert.equal(values.get("u_hdEnabled"), false);
plugin.disposeRenderer(renderer);
assert.equal(deleted, 7, "Dispose both shadow framebuffers/depth textures and material/placeholder textures");
assert.equal(new HdPlugin().isEnabled(), false, "Disabled by default");
performance.now = originalNow;

const { HdMaterials, HD_LOOKUP_WIDTH, HD_TEXTURE_SIZE } = require("../game/plugins/hd/HdMaterials");
const { HD_MATERIALS, HD_GROUND_MATERIALS } = require("../game/plugins/hd/HdMaterialData");
for (const id of [6, 16, 44, 45, 50, 55]) {
    assert.equal(HD_MATERIALS.find((m: any) => m.id === id).params[0], 0, "Roofs, including the wood-grain replacement, stay matte");
}
for (const id of [1, 2, 3, 4, 5]) {
    assert.equal(HD_GROUND_MATERIALS.find((m: any) => m.id === id).params[0], 0, "Dry natural ground stays matte");
}
const images: any[] = [];
(globalThis as any).Image = class { onload: any; src = ""; constructor() { images.push(this); } };
const texels = new Uint8ClampedArray(HD_TEXTURE_SIZE * HD_TEXTURE_SIZE * 4).fill(192);
(globalThis as any).document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: texels }) }) }) };
let lookup: Float32Array;
let atlasUploads = 0;
const materialState = new HdMaterials({
    createTexture2D: () => ({ data: (data: Float32Array) => { lookup = data.slice(); }, delete() {} }),
    createTextureArray: (_data: unknown, width: number, height: number, depth: number, options: any) => {
        assert.equal(width, 256); assert.equal(height, 256); assert.ok(depth <= width);
        assert.equal(options.maxAnisotropy, 8);
        return { data: () => atlasUploads++, delete() {} };
    },
} as any);
const layers = new Map([[2, 5], [3, 0]]);
materialState.update(layers);
const metadata = (layer: number) => Array.from(lookup!.slice((HD_LOOKUP_WIDTH + layer) * 4, (HD_LOOKUP_WIDTH + layer + 1) * 4));
assert.deepEqual(metadata(0), [0, 0, 0, 1], "An exhausted cache layer must not turn every untextured floor into wood");
assert.equal(metadata(5)[0], 0, "Use the cache texture until the HD image loads");
const brick = HD_MATERIALS.find((m: any) => m.id === 2);
images.find(image => image.src === brick.file).onload();
materialState.update(layers);
assert.ok(metadata(5)[0] > 0, "Publish a successfully loaded replacement");
assert.equal(metadata(5)[2], 0, "Keep geometric normals until the normal image loads");
images.find(image => image.src === brick.normal).onload();
materialState.update(layers);
assert.ok(metadata(5)[2] > 0);
const uploadsBeforeRemap = atlasUploads;
layers.set(2, 9);
materialState.update(layers);
assert.equal(metadata(5)[0], 0);
assert.ok(metadata(9)[0] > 0, "Follow cache-layer remaps without reuploading image pixels");
assert.equal(atlasUploads, uploadsBeforeRemap);
materialState.dispose();
images.find(image => image.src === brick.file).onload();
assert.equal(atlasUploads, uploadsBeforeRemap, "Ignore image completions after renderer disposal");

const { hdGroundMaterial, HdGroundMaterial } = require("../game/plugins/hd/HdGroundMaterials");
const { SceneTileModel } = require("../rs/scene/SceneTileModel");
const { SceneTile } = require("../rs/scene/SceneTile");
const { SceneBuffer } = require("../render/buffer/SceneBuffer");
const { FloatUtil } = require("../common/utils/FloatUtil");
const { Model } = require("../rs/model/Model");
const { buildActorNormals, ACTOR_VERTEX_STRIDE } = require("../render/buffer/ActorNormals");
const actor = new Model();
actor.verticesCount = 6;
actor.faceCount = 2;
actor.verticesX = new Int32Array([0, 128, 0, 0, 128, 0]);
actor.verticesY = new Int32Array([0, 0, -128, 0, 0, 0]);
actor.verticesZ = new Int32Array([0, 0, 0, 0, 0, 128]);
actor.indices1 = new Int32Array([0, 3]);
actor.indices2 = new Int32Array([1, 5]);
actor.indices3 = new Int32Array([2, 4]);
actor.faceColors = new Uint16Array([5000, 5000]);
actor.faceColors1 = actor.faceColors2 = actor.faceColors3 = new Int32Array([4000, 4000]);
const actorNormals = buildActorNormals(actor).slice();
assert.equal(actorNormals[0], actorNormals[3], "Coincident vertices across body parts share a smooth normal");
assert.equal(actorNormals[1], actorNormals[4]);
assert.notEqual(actorNormals[0], actorNormals[2], "Shared corners blend neighbouring face directions");
const actorBuffer = new SceneBuffer({} as any, new Map(), 16, true);
actorBuffer.addModel(actor, [{ index: 0, alpha: 255, priority: 0, textureId: -1 }]);
assert.equal(actorBuffer.vertexBuf.stride, ACTOR_VERTEX_STRIDE);
const actorWord = actorBuffer.vertexBuf.view.getUint32(12, true);
assert.equal(actorWord & 0xffff, 5000, "HD retains the original colour without baked light");
assert.equal(actorWord >>> 16, actorNormals[0]);
assert.equal(actorBuffer.vertexBuf.view.getUint32(4, true) >>> 15 & 0xffff, 4000, "Disabling HD keeps vanilla vertex colours");
actor.verticesX = actor.verticesX.map((x: number) => -x);
actor.verticesZ = actor.verticesZ.map((z: number) => -z);
assert.notEqual(buildActorNormals(actor)[0], actorNormals[0], "Normals follow animated vertex positions");
assert.equal(hdGroundMaterial(7, false, 10000), HdGroundMaterial.GRASS);
assert.equal(hdGroundMaterial(64, false, (8 << 10) | (5 << 7) | 32), HdGroundMaterial.GRASS, "Olive grass near the ditch must follow its colour instead of being forced to dirt");
assert.equal(hdGroundMaterial(10, true, 10000), HdGroundMaterial.GRAVEL);
assert.equal(hdGroundMaterial(6, true, 10000), HdGroundMaterial.NONE, "Water stays in the water renderer");
assert.equal(hdGroundMaterial(9999, false, 10000), HdGroundMaterial.NONE);
const tile = new SceneTile(0, 1, 1);
tile.tileModel = new SceneTileModel(2, 0, -1, 1, 1, 0, 0, 0, 0, 96, 96, 96, 96, 10000, 10000, 10000, 10000, 10000, 10000, 0, 0);
tile.tileModel.underlayId = 7;
tile.tileModel.overlayId = 10;
const sceneBuffer = new SceneBuffer({} as any, new Map(), 16);
sceneBuffer.addTerrainTile(tile, 0, 0);
let index = 0;
for (const face of tile.tileModel.faces) for (const vertex of face.vertices) {
    const offset = sceneBuffer.indices[index++] * 12;
    const v0 = sceneBuffer.vertexBuf.view.getUint32(offset, true);
    const v2 = sceneBuffer.vertexBuf.view.getUint32(offset + 8, true);
    const material = Math.round(-FloatUtil.unpackFloat11((v0 >>> 11 & 63) | (v2 & 31) << 6) * 64);
    assert.equal(material, face.isOverlay ? HdGroundMaterial.GRAVEL : HdGroundMaterial.GRASS);
    assert.equal(v2 >>> 6 & 7, 0, "Ground recipes must not change face priorities");
}

if (process.argv[2]) {
    fs.writeFileSync(process.argv[2], `<!doctype html><title>HD shader check</title><pre id="result">Running</pre><script>
    (async () => { try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) throw Error('WebGL2 unavailable');
        const multiDraw = gl.getExtension('WEBGL_multi_draw');
        let count = 0;
        for (const [vertex, fragment] of ${JSON.stringify(programs)}) {
            if (vertex.includes('#define MULTI_DRAW') && !multiDraw) continue;
            const program = gl.createProgram();
            for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
                const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
                gl.attachShader(program, shader);
            }
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
            count++;
        }
        document.getElementById('result').textContent = 'PASS: ' + count + ' shader programs linked';
    } catch (error) { document.getElementById('result').textContent = 'FAIL: ' + error; }
    document.querySelector('script').remove(); })();
    </script>`);
}
console.log("117 HD shader, water isolation and lifecycle tests passed");
