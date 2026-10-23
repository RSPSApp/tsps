import assert from "node:assert/strict";
import { mat4 } from "gl-matrix";
import { Frustum } from "../game/Frustum";
import { newDrawRange } from "../render/DrawRange";
import { sceneryRangeVisible } from "../render/SceneryVisibility";
import { simplifyFarModel } from "../render/loader/FarScene";
import { Model } from "../rs/model/Model";
import { Scene } from "../rs/scene/Scene";
import { SceneTile } from "../rs/scene/SceneTile";
import { SceneTileModel } from "../rs/scene/SceneTileModel";
import { resolveFogRange } from "../render/RenderDistancePolicy";

(globalThis as any).self = globalThis;
const { SceneBuffer } = require("../render/buffer/SceneBuffer");
const { drawWithRoofPlaneFilter, getMapZoneDistanceFromPoint, isMapWithinRenderDistance } = require("../render/render/draw2");
const { getRenderCullTile } = require("../render/render/camera/roof");

// Fog follows the player while the camera orbits behind them, including without HD.
const edgeRange = newDrawRange(0, 6);
edgeRange.chunk = [0, 0]; edgeRange.bounds = [0, -1, 0, 8, 1, 8];
const edgeMap = { id: 256, mapX: 1, mapY: 0,
    getRenderBaseTileX: () => 64, getRenderBaseTileY: () => 0 };
let cameraX = 0, edgeDraws = 0;
const edgeHost: any = {
    playerPosUni: [49, 0],
    mapManager: { worldEntityMapIds: new Set() },
    getCameraTileXY: () => ({ x: cameraX, y: 0 }),
    clampCullTileToGridBounds: (point: any) => point,
    getRenderCullTile: () => getRenderCullTile(edgeHost),
    getFrameRenderDistanceTiles: () => 25, getFrameLodThresholdTiles: () => 100,
    getMapZoneDistanceFromPoint: (map: any, x: number, y: number) => getMapZoneDistanceFromPoint(edgeHost, map, x, y),
    autoFogDepth: true, autoFogDepthFactor: 0.85, fogDepth: 24,
    osrsClient: { clientPlugins: { hdEnabled: () => false }, camera: { frustum: { intersectsBox: () => true } } },
    frameRoofTotalRangeCount: 0, frameRoofFilteredRangeCount: 0, roofFilteredDrawIndices: [],
    draw: () => edgeDraws++,
};
for (const x of [0, 28, 70]) {
    cameraX = x;
    const point = edgeHost.getRenderCullTile();
    assert.equal(isMapWithinRenderDistance(edgeHost, edgeMap, point.x, point.y, 25, 0), true,
        "a whole-map guard must retain scenery inside the player's fog boundary during camera rotation");
    drawWithRoofPlaneFilter(edgeHost, {}, [edgeRange], undefined, 3, edgeMap);
}
assert.equal(edgeDraws, 3, "non-HD terrain inside player visibility must survive every camera orbit");

const foggedMap = { id: -256, mapX: -1, mapY: 0,
    getRenderBaseTileX: () => -64, getRenderBaseTileY: () => 0 };
const workload = [];
for (let x = -128; x <= 128; x += 8) for (let z = -128; z <= 128; z += 8) {
    const range = newDrawRange(0, 6);
    range.bounds = [x, -1, z, x + 8, 1, z + 8];
    workload.push(range);
}
for (const x of [0, 28, 37, 70]) {
    cameraX = x;
    const point = edgeHost.getRenderCullTile();
    assert.deepEqual(point, { x: 49, y: 0 }, "orbiting must not move the shader's fog/LOD origin");
    assert.equal(isMapWithinRenderDistance(edgeHost, foggedMap, point.x, point.y, 25, 0), false);
    let submitted = 0;
    edgeHost.draw = (_call: unknown, ranges: unknown[], indices?: number[]) => {
        submitted += indices?.length ?? ranges.length;
    };
    drawWithRoofPlaneFilter(edgeHost, {}, workload, undefined, 3,
        { id: 0, getRenderBaseTileX: () => 0, getRenderBaseTileY: () => 0 });
    assert.equal(submitted, 64, "distance culling excludes wholly fogged geometry at every camera offset");
}

const hdFog = resolveFogRange({ renderDistance: 160, autoFogDepth: true,
    autoFogDepthFactor: 0.85, manualFogDepth: 24, hd: true });
assert.deepEqual(hdFog, { fogEnd: 120, fogDepth: 24 }, "Long views need stronger haze and an obscured outer margin");
const shortFog = resolveFogRange({ renderDistance: 25, autoFogDepth: true,
    autoFogDepthFactor: 0.85, manualFogDepth: 24, hd: true });
assert.deepEqual(shortFog, { fogEnd: 24.75, fogDepth: 19.5 }, "Short views must keep nearby scenery clear");
let previousEnd = 0;
for (let distance = 25; distance <= 160; distance++) {
    const fog = resolveFogRange({ renderDistance: distance, autoFogDepth: true,
        autoFogDepthFactor: 0.85, manualFogDepth: 24, hd: true });
    assert.ok(fog.fogEnd > previousEnd, "Increasing draw distance must extend visibility");
    assert.ok(fog.fogDepth < fog.fogEnd, "The fade must retain a positive width");
    previousEnd = fog.fogEnd;
}
assert.deepEqual(resolveFogRange({ renderDistance: 90, autoFogDepth: true,
    autoFogDepthFactor: 0.85, manualFogDepth: 24 }), { fogEnd: 90, fogDepth: 76.5 });
assert.equal(resolveFogRange({ renderDistance: 160, autoFogDepth: false,
    autoFogDepthFactor: 0.85, manualFogDepth: 60, hd: true }).fogDepth, 60);
const scene = new Scene(4, 8, 8);
for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) scene.tileHeights[0][x][z] = -(x * x + z * z);
for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) {
    const h = scene.tileHeights[0];
    const tile = new SceneTile(0, x, z);
    tile.tileModel = new SceneTileModel(0, 0, -1, x, z, h[x][z], h[x + 1][z], h[x + 1][z + 1], h[x][z + 1],
        96, 96, 96, 96, 10000, 10000, 10000, 10000, 10000, 10000, 0, 0);
    tile.tileModel.underlayId = 7;
    scene.tiles[0][x][z] = tile;
}
const buffer = new SceneBuffer({} as any, new Map(), 128);
buffer.addTerrain(scene, 0, 3, 8);
const full = buffer.createDrawRange(buffer.drawCommands[0]);
const far = buffer.createDrawRange(buffer.drawCommandsLod[0]);
assert.equal(full[1] / 3, 128);
assert.equal(far[1] / 3, 80, "Distant terrain must actually reduce triangle count");
const edges = (range: typeof full) => {
    const result = new Set<string>();
    for (let i = range[0] / 4; i < range[0] / 4 + range[1]; i++) {
        const offset = buffer.indices[i] * 12, view = buffer.vertexBuf.view;
        const x = (view.getUint32(offset, true) >>> 17) - 16384;
        const y = 16384 - (view.getUint32(offset + 4, true) & 32767);
        const z = (view.getUint32(offset + 8, true) >>> 17) - 16384;
        if (x === 0 || x === 1024 || z === 0 || z === 1024) result.add(`${x}:${y}:${z}`);
    }
    return result;
};
assert.deepEqual(edges(far), edges(full), "Different terrain LODs must meet at exact edge heights");
assert.deepEqual(structuredClone(far), far, "Worker transfer must retain chunk and bounds metadata");

// A detailed patch inside the chunk must join the coarse neighbour at its curved midpoint.
scene.tiles[0][4][2]!.tileModel!.underlayId = 8;
const mixedBuffer = new SceneBuffer({} as any, new Map(), 128);
mixedBuffer.addTerrain(scene, 0, 3, 8);
const mixedFull = mixedBuffer.createDrawRange(mixedBuffer.drawCommands[0]);
const mixedFar = mixedBuffer.createDrawRange(mixedBuffer.drawCommandsLod[0]);
const transitionEdges = (range: typeof full) => {
    const result = new Set<string>();
    const vertex = (index: number) => {
        const offset = index * 12, view = mixedBuffer.vertexBuf.view;
        return [(view.getUint32(offset, true) >>> 17) - 16384,
            16384 - (view.getUint32(offset + 4, true) & 32767),
            (view.getUint32(offset + 8, true) >>> 17) - 16384];
    };
    for (let i = range[0] / 4; i < range[0] / 4 + range[1]; i += 3) {
        const face = mixedBuffer.indices.slice(i, i + 3).map(vertex);
        if (face.some(v => v[0] > 512) || !face.some(v => v[0] < 512)) continue;
        const edge = face.filter(v => v[0] === 512 && v[2] >= 256 && v[2] <= 512);
        if (edge.length === 2) result.add(edge.map(v => v.join(":")).sort().join("|"));
    }
    return result;
};
assert.equal(transitionEdges(mixedFull).size, 2);
assert.deepEqual(transitionEdges(mixedFar), transitionEdges(mixedFull),
    "Coarse terrain must retain a detailed neighbour's midpoint inside the chunk");

const camera = new Frustum(); camera.setPlanes(mat4.ortho(mat4.create(), -100, 100, -100, 100, -100, 100));
const range = newDrawRange(0, 3); range.chunk = [64, 0]; range.bounds = [64, -1, 0, 72, 1, 8];
for (const x of [0, 16, 17, 70]) {
    const visible = (lod: boolean) => sceneryRangeVisible(range, 0, 0, x, 0, 160, 48, lod, camera);
    assert.notEqual(visible(false), visible(true), "A chunk must select exactly one geometry tier");
}
assert.equal(sceneryRangeVisible(range, 0, 0, 0, 0, 32, 48, true, camera), false);
const offscreen = new Frustum(); offscreen.setPlanes(mat4.ortho(mat4.create(), -5, 5, -5, 5, -5, 5));
assert.equal(sceneryRangeVisible(range, 0, 0, 0, 0, 160, 48, true, offscreen), false);
assert.equal(sceneryRangeVisible(range, 0, 0, 0, 0, 32, 48, false, offscreen, camera), true,
    "An off-screen caster inside the light volume must survive camera and distance culling");

const model = new Model(); model.verticesCount = 5; model.faceCount = 2;
model.verticesX = new Int32Array([0, 16, 0, 128, 0]);
model.verticesY = new Int32Array([0, 0, 16, 0, 128]);
model.verticesZ = new Int32Array(5);
model.indices1 = new Int32Array([0, 0]); model.indices2 = new Int32Array([1, 3]); model.indices3 = new Int32Array([2, 4]);
model.faceColors3 = new Int32Array([10000, 10000]);
const simplified = simplifyFarModel(model);
assert.equal(simplified, model, "Open scenery must retain its joining geometry");
assert.deepEqual(Array.from(model.verticesX), [0, 16, 0, 128, 0]);
assert.equal(model.faceColors3[0], 10000, "Simplification must never mutate the nearby source model");
const { createSceneModel } = require("../render/loc/SceneLocs");
const bakedGround = createSceneModel({ load: () => ({ contourGroundType: 1 }) }, scene, model,
    { tag: 0n, flags: 10, x: 64, y: 64, height: 0 }, 0, 0, 0, 0, 0, 2);
assert.equal(model.contourVerticesY, undefined);
assert.equal(bakedGround.groundConforming, true,
    "Baked ModelData contours must stay protected even without a separate contour array");

// A roof viewed from below must have an occluding underside without extra vertices.
const roof = new Model(); roof.verticesCount = roof.usedVertexCount = 4; roof.faceCount = 2;
roof.verticesX = new Int32Array([-64, -64, 64, 64]);
roof.verticesY = new Int32Array(4).fill(-32);
roof.verticesZ = new Int32Array([64, -64, -64, 64]);
roof.indices1 = new Int32Array([0, 0]); roof.indices2 = new Int32Array([1, 2]); roof.indices3 = new Int32Array([2, 3]);
roof.faceColors1 = roof.faceColors2 = roof.faceColors3 = new Int32Array([10000, 10000]);
const locLoader = { load: () => ({ contourGroundType: 0 }) };
const placement = { tag: 0n, flags: 12, x: 64, y: 64, height: 0 };
for (let type = 12; type <= 21; type++) {
    assert.equal(createSceneModel(locLoader, scene, roof, { ...placement, flags: type },
        0, 0, 1, 0, 0, 1).doubleSided, true);
}
assert.equal(bakedGround.doubleSided, false, "Ordinary scenery must remain single-sided");
const roofPlacement = createSceneModel(locLoader, scene, roof, placement, 0, 0, 1, 0, 0, 1);
const roofBuffer = new SceneBuffer({} as any, new Map(), 16);
roofBuffer.addModelGroup({ transparent: false, lowDetail: false, level: 1,
    priority: 1, planeCullLevel: 2, models: [roofPlacement] });
assert.equal(roofBuffer.vertexCount(), 4, "Roof undersides must reuse the original vertices and UVs");
assert.equal(roofBuffer.indices.length, 12);
for (let face = 0; face < roofBuffer.indices.length; face += 6)
    assert.deepEqual(roofBuffer.indices.slice(face + 3, face + 6),
        roofBuffer.indices.slice(face, face + 3).reverse(), "Undersides must face the opposite direction");
const animatedRoofBuffer = new SceneBuffer({} as any, new Map(), 16);
assert.equal(animatedRoofBuffer.addModelAnimFrame(roof, false, undefined, true)[1], 12);
assert.equal(animatedRoofBuffer.addModelAnimFrame(roof, false)[1], 6);
assert.equal(roof.faceCount, 2, "Shared cache models must remain unchanged");

// A closed prop with two nearby interior vertices can still simplify without shifting its outer planes.
const prop = new Model(); prop.verticesCount = prop.usedVertexCount = 6; prop.faceCount = 8;
prop.verticesX = new Int32Array([-128, 128, -128, 128, -48, -40]);
prop.verticesY = new Int32Array([-128, -128, 128, 128, -48, -40]);
prop.verticesZ = new Int32Array([-128, 128, 128, -128, 32, 48]);
const faces = [[0, 1, 4], [2, 0, 4], [1, 2, 5], [2, 4, 5], [4, 1, 5], [0, 3, 1], [1, 3, 2], [2, 3, 0]];
prop.indices1 = Int32Array.from(faces.map(f => f[0]));
prop.indices2 = Int32Array.from(faces.map(f => f[1]));
prop.indices3 = Int32Array.from(faces.map(f => f[2]));
prop.faceColors3 = new Int32Array(8).fill(10000);
const farProp = simplifyFarModel(prop);
assert.equal(Array.from(farProp.faceColors3).filter(c => c !== -2).length, 6);
for (const field of ["verticesX", "verticesY", "verticesZ"] as const)
    assert.deepEqual(farProp[field].slice(0, 4), prop[field].slice(0, 4), "Outer planes must stay exact");
prop.contourVerticesY = prop.verticesY.slice();
assert.equal(simplifyFarModel(prop), prop, "Ground-conforming props must retain their fitted surface");
prop.contourVerticesY = undefined;
prop.faceCount--;
assert.equal(simplifyFarModel(prop), prop, "Open meshes with enough faces to cluster must also stay exact");

const { createDrawBackend } = require("../render/DrawBackend");
const backend = createDrawBackend(false);
const draws: { id: number; range: number[] }[] = [];
let id = -1, active: number[] = [];
const drawCall = {
    uniform(name: string, value: number) { if (name === "u_drawIdOverride") id = value; return this; },
    drawRanges(range: number[]) { active = [...range]; return this; },
    draw() { draws.push({ id, range: active }); },
};
const chunks = [newDrawRange(0, 6), newDrawRange(24, 6), newDrawRange(48, 6)];
for (const chunk of chunks) chunk.batchKey = 0;
backend.draw(drawCall, chunks);
assert.deepEqual(draws, [{ id: 0, range: [0, 18, 1] }], "Single-draw devices must coalesce contiguous terrain chunks");
draws.length = 0;
backend.draw(drawCall, chunks, [0, 2]);
assert.deepEqual(draws, [{ id: 0, range: [0, 6, 1] }, { id: 2, range: [48, 6, 1] }], "Culling must never draw an excluded gap or change model IDs");
console.log("Scenery distance checks passed: 128 → 80 terrain triangles, joined chunk/mixed-detail edges, exact open meshes, exclusive LODs and light-volume culling");

// Animated commands start empty, but every baked pose must contribute to their culling bounds.
const animatedBoundsBuffer = new SceneBuffer({} as any, new Map(), 32);
const bakedFrame = (points: number[][]) => {
    const offset = animatedBoundsBuffer.indexByteOffset();
    for (const [x, y, z] of points) animatedBoundsBuffer.indices.push(
        animatedBoundsBuffer.vertexBuf.addVertex(x, y, z, 100, 255, 0, 0, -1, false));
    return newDrawRange(offset, points.length);
};
const emptyFrame = newDrawRange(0, 0);
const bakedFrames = {
    frames: [emptyFrame, bakedFrame([[-128, -64, 0], [256, 320, 64], [0, 0, -128]]),
        bakedFrame([[-384, -192, 128], [128, 640, 384], [0, 0, 0]])],
    framesAlpha: [bakedFrame([[-512, -320, -384], [640, 960, 512], [0, 0, 0]]), emptyFrame, emptyFrame],
    frameStarts: [0, 2],
};
const contourScene = new Scene(4, 1, 1);
for (const column of contourScene.tileHeights[2]) column.fill(-320);
contourScene.tileHeights[2][0][0] = 192;
animatedBoundsBuffer.setHeightBounds(contourScene);
const placements = [
    { sceneX: 8 * 128 + 64, sceneZ: 16 * 128 + 64, heightOffset: -275, level: 2, contourGround: 1 },
    { sceneX: 90 * 128, sceneZ: -40 * 128, heightOffset: 67, level: 0, contourGround: 2 },
].map(placement => ({ ...placement, lowDetail: false, interactId: 1,
    entity: { seqId: 1, seqRandomStart: false, rotation: 0 } }));
for (const placement of placements) animatedBoundsBuffer.addLocAnimated({ anim: bakedFrames, locs: [] }, placement);
for (const commands of [animatedBoundsBuffer.drawCommands, animatedBoundsBuffer.drawCommandsAlpha,
    animatedBoundsBuffer.drawCommandsLod, animatedBoundsBuffer.drawCommandsLodAlpha,
    animatedBoundsBuffer.drawCommandsInteract, animatedBoundsBuffer.drawCommandsInteractAlpha,
    animatedBoundsBuffer.drawCommandsInteractLod, animatedBoundsBuffer.drawCommandsInteractLodAlpha]) {
    for (const command of commands) {
        const draw = animatedBoundsBuffer.createDrawRange(command);
        assert.ok(draw.bounds, "empty initial commands still retain the full animation bounds");
        const placement = command.instances[0];
        for (const frame of [...bakedFrames.frames, ...bakedFrames.framesAlpha]) {
            for (let i = frame[0] / 4; i < frame[0] / 4 + frame[1]; i++) {
                const offset = animatedBoundsBuffer.indices[i] * 12, view = animatedBoundsBuffer.vertexBuf.view;
                for (const height of placement.contourGround === 1 ? [-320, 192] : [0]) {
                    const point = [((view.getUint32(offset, true) >>> 17) - 16384 + placement.sceneX) / 128,
                        (16384 - (view.getUint32(offset + 4, true) & 32767) - Math.round(placement.heightOffset / 8) * 8 + height) / 128,
                        ((view.getUint32(offset + 8, true) >>> 17) - 16384 + placement.sceneZ) / 128];
                    point.forEach((value, axis) => assert.ok(value >= draw.bounds[axis] && value <= draw.bounds[axis + 3],
                        "all opaque/alpha/intermediate poses and contour heights stay inside the instance bounds"));
                }
            }
        }
    }
}
for (const frames of [[emptyFrame], [bakedFrames.frames[1], undefined], [newDrawRange(1e9, 3)]]) {
    const conservative = new SceneBuffer({} as any, new Map(), 1);
    conservative.vertexBuf = animatedBoundsBuffer.vertexBuf;
    conservative.indices = animatedBoundsBuffer.indices;
    conservative.addLocAnimated({ anim: { frames, framesAlpha: undefined }, locs: [] }, placements[0]);
    assert.equal(conservative.createDrawRange(conservative.drawCommands[0]).bounds, undefined,
        "empty, missing or unavailable geometry keeps the unbounded fallback");
}
