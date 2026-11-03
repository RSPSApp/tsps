import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { mat3, mat4, vec2, vec3, vec4 } from "gl-matrix";

import { Camera } from "../game/Camera";
import { HD_SCENE_SHADERS } from "../game/plugins/hd/webgpu/hdSceneShaders";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { LocModelLoader } from "../rs/config/loctype/LocModelLoader";
import { NpcModelLoader } from "../rs/config/npctype/NpcModelLoader";
import { VarManager } from "../rs/config/vartype/VarManager";
import { LocLoadType, SceneBuilder } from "../rs/scene/SceneBuilder";
import { actorVertexEntry, createActorShaderModule } from "../render/webgpu/shaders/actor.wgsl";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

const GIANT_SPIDER = 3017;
const GIANT_SPIDER_DEATH = 5329;
/** actorFloorY's ground offset for an NPC: the 10-unit ground clearance, upward. */
const NPC_GROUND_OFFSET = -10;

const info = loadCacheList(loadCacheInfos()).latest;
const cache = loadCache(info);
const factory: any = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, cache.files));
const npcs = factory.getNpcTypeLoader();
const npcModels = new NpcModelLoader(npcs, factory.getModelLoader(), factory.getTextureLoader(),
    factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader?.(),
    new VarManager(factory.getVarBitTypeLoader()));
const spider = npcs.load(GIANT_SPIDER);

// Issue 2016: the Giant spider's death folds its legs under the floor. OSRS still shows them, so
// the actor shaders must not let the floor's depth hide anything below the actor's ground plane.
test("the Giant spider's death sinks its legs below the floor", () => {
    const lowest = (seqId: number, frame: number) => {
        const model = npcModels.getModel(spider, seqId, frame)!;
        model.calculateBounds();
        return model.maxY;
    };
    assert.ok(lowest(spider.idleSeqId, 0) <= 0, "standing, it is on the floor");
    // Model y is down: frame 10 of the death is the deepest, about 0.4 tiles under.
    assert.ok(lowest(GIANT_SPIDER_DEATH, 10) > 40, "dying, its legs are under the floor");
});

type FloorY = (x: number, z: number) => number;

/** height-map.glsl actorFloorViewPos, step for step (`floorY` stands in for actorFloorY). */
function actorFloorViewPos(viewPos: vec4, localPos: vec3, floorY: FloorY, worldToView: mat4, projection: mat4): vec4 {
    if (localPos[1] <= floorY(localPos[0], localPos[2])) return viewPos;
    const ortho = projection[15] > 0.5;
    const towardEye = ortho ? vec3.fromValues(0, 0, 1) : vec3.fromValues(-viewPos[0], -viewPos[1], -viewPos[2]);
    const ray = vec3.transformMat3(vec3.create(), towardEye, mat3.transpose(mat3.create(), mat3.fromMat4(mat3.create(), worldToView)));
    vec3.scale(ray, ray, 128);
    const stepT = 8 / Math.max(vec3.length(ray), 0.001);
    const maxT = ortho ? 1e6 : 0.999;
    const isOver = (t: number) => {
        const p = vec3.scaleAndAdd(vec3.create(), localPos, ray, t);
        return p[1] <= floorY(p[0], p[2]);
    };
    let under = 0;
    let over = -1;
    for (let i = 1; i <= 128; i++) {
        const t = Math.min(i * stepT, maxT);
        if (isOver(t)) {
            over = t;
            break;
        }
        under = t;
        if (t >= maxT) break;
    }
    if (over < 0) return viewPos;
    for (let i = 0; i < 6; i++) {
        const mid = 0.5 * (under + over);
        if (isOver(mid)) over = mid;
        else under = mid;
    }
    return vec4.fromValues(viewPos[0] + towardEye[0] * over, viewPos[1] + towardEye[1] * over, viewPos[2] + towardEye[2] * over, viewPos[3]);
}

/** A local-units point in view space (map square 0). */
function toView(local: vec3, view: mat4): vec4 {
    return vec4.transformMat4(vec4.create(), [local[0] / 128, local[1] / 128, local[2] / 128, 1], view);
}

function ndcZ(viewPos: vec4, projection: mat4): number {
    const clip = vec4.transformMat4(vec4.create(), viewPos, projection);
    return clip[2] / clip[3];
}

function eyeOf(view: mat4): vec3 {
    return mat4.getTranslation(vec3.create(), mat4.invert(mat4.create(), view));
}

/**
 * Checks a corrected depth for a sunk vertex: same screen position, on the first floor crossing
 * of its line of sight (every point before it, sampled each unit, is still under the floor), and
 * still behind a wall face standing between it and the camera. Returns how far the crossing is.
 */
function assertFirstCrossingBehindWall(vertex: vec3, floorY: FloorY, camera: Camera, wallHit: (ray: vec3) => vec3): number {
    const view = camera.viewMatrix;
    const projection = camera.projectionMatrix;
    const viewPos = toView(vertex, view);
    const fixed = actorFloorViewPos(viewPos, vertex, floorY, view, projection);
    for (const i of [0, 1]) assert.ok(Math.abs(fixed[i] / fixed[2] - viewPos[i] / viewPos[2]) < 1e-6, "same screen position");

    const ray = vec3.sub(vec3.create(), vec3.scale(vec3.create(), eyeOf(view), 128), vertex);
    const t = (fixed[2] - viewPos[2]) / -viewPos[2];
    const distance = t * vec3.length(ray);
    assert.ok(distance > 0, "it comes up out of the floor");
    const landed = vec3.scaleAndAdd(vec3.create(), vertex, ray, t);
    assert.ok(Math.abs(landed[1] - floorY(landed[0], landed[2])) < 1, "on the floor");
    for (let d = 0; d < distance - 1; d++) {
        const p = vec3.scaleAndAdd(vec3.create(), vertex, ray, d / vec3.length(ray));
        assert.ok(p[1] > floorY(p[0], p[2]), `still under the floor ${d} units along`);
    }

    const hit = wallHit(ray);
    const wallFloor = floorY(hit[0], hit[2]);
    assert.ok(hit[1] < wallFloor && hit[1] > wallFloor - 128, "the line of sight passes through the wall");
    assert.ok(ndcZ(fixed, projection) > ndcZ(toView(hit, view), projection), "the wall still covers the sunk vertex");
    assert.ok(ndcZ(fixed, projection) < ndcZ(viewPos, projection), "but the floor no longer does");
    return distance;
}

// Review of PR 2034: on ground falling toward the camera, a wall between the camera and a sunk
// vertex must still hide it. Production camera at pitch 171, its eye 20 degrees above the actor
// (10 tiles out, 3.64 up); local units, y down, map square 0.
test("a sunk vertex on a slope down toward the camera stays behind a wall in front of it", () => {
    const camera = new Camera(30, -10 * Math.tan((20 * Math.PI) / 180), 30, 171, 0);
    camera.update(800, 600);
    const eye = eyeOf(camera.viewMatrix);
    const forward = vec3.sub(vec3.create(), vec3.transformMat4(vec3.create(), [0, 0, -1], mat4.invert(mat4.create(), camera.viewMatrix)), eye);
    const actorTiles = vec3.scaleAndAdd(vec3.create(), eye, forward, 10 / Math.hypot(forward[0], forward[2]));
    const toEye = vec2.normalize(vec2.create(), [eye[0] - actorTiles[0], eye[2] - actorTiles[2]]);
    const actor = vec2.fromValues(actorTiles[0] * 128, actorTiles[2] * 128);
    // Falls 64 units a tile toward the camera.
    const floorY: FloorY = (x, z) => NPC_GROUND_OFFSET + 0.5 * vec2.dot([x - actor[0], z - actor[1]], toEye);
    // Frame 10's vertex 57 is 32 units below its floor once the clearance is taken.
    const vertex = vec3.fromValues(actor[0], floorY(actor[0], actor[1]) + 32, actor[1]);
    // A wall face on the next tile boundary toward the camera, 64 units out.
    const distance = assertFirstCrossingBehindWall(vertex, floorY, camera,
        (ray) => vec3.scaleAndAdd(vec3.create(), vertex, ray, 64 / vec2.dot([ray[0], ray[2]], toEye)));
    // The plane crossing, worked out by hand: per unit across, the ray climbs `rise` and the floor
    // falls 0.5, so it is 32 / (rise + 0.5) across.
    const ray = vec3.sub(vec3.create(), vec3.scale(vec3.create(), eye, 128), vertex);
    const across = Math.hypot(ray[0], ray[2]);
    assert.ok(Math.abs((distance * across) / vec3.length(ray) - 32 / (-ray[1] / across + 0.5)) < 0.5);
});

/** A map square's floor as the shaders sample it (height-map.glsl getHeightInterp, or the WGSL integer one). */
function cachedFloor(mapX: number, mapY: number, integer: boolean): FloorY {
    const locModels = new LocModelLoader(factory.getLocTypeLoader(), factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    const builder = new SceneBuilder(info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
        factory.getOverlayTypeLoader(), factory.getLocTypeLoader(), locModels, cache.xteas);
    const border = 6;
    const scene = builder.buildScene(mapX * 64 - border, mapY * 64 - border, 64 + 2 * border, 64 + 2 * border, false, LocLoadType.NO_MODELS);
    // The height texture holds -tileHeight / 8, truncated; getTileHeight scales it back.
    const tile = (x: number, z: number) => ((-scene.tileHeights[0][border + x][border + z] / 8) | 0) * 8;
    const height = integer
        ? (x: number, z: number) => {
              const ix = Math.trunc(x), iz = Math.trunc(z);
              const tx = ix >> 7, tz = iz >> 7, ox = ix & 127, oz = iz & 127;
              const sw = tile(tx, tz), se = tile(tx + 1, tz), nw = tile(tx, tz + 1), ne = tile(tx + 1, tz + 1);
              const h0 = ox + oz <= 128
                  ? (sw * 128 + (se - sw) * ox + (nw - sw) * oz) >> 7
                  : (ne * 128 + (nw - ne) * (128 - ox) + (se - ne) * (128 - oz)) >> 7;
              const h1 = ox <= oz
                  ? (sw * 128 + (nw - sw) * oz + (ne - nw) * ox) >> 7
                  : (sw * 128 + (se - sw) * ox + (ne - se) * oz) >> 7;
              return Math.max(h0, h1);
          }
        : (x: number, z: number) => {
              const tx = Math.floor(x / 128), tz = Math.floor(z / 128);
              const ox = x / 128 - tx, oz = z / 128 - tz;
              const sw = tile(tx, tz), se = tile(tx + 1, tz), nw = tile(tx, tz + 1), ne = tile(tx + 1, tz + 1);
              const h0 = ox + oz <= 1
                  ? sw + (se - sw) * ox + (nw - sw) * oz
                  : ne + (nw - ne) * (1 - ox) + (se - ne) * (1 - oz);
              const h1 = ox <= oz
                  ? sw + (nw - sw) * oz + (ne - nw) * ox
                  : sw + (se - sw) * ox + (ne - se) * oz;
              return Math.max(h0, h1);
          };
    return (x, z) => -height(x, z) + NPC_GROUND_OFFSET;
}

// Second review of PR 2034, on cached Lumbridge terrain (map square 50,50): the spider centred at
// local (1392, 5200), the camera at local tiles (0.875, -5.797, 40.5), pitch 128, yaw 512. The line
// of sight leaves the floor about 157 units out, then goes back under; Newton steps jumped past
// that to 270 and drew the vertex over a wall at x = 1152, 240 units out.
test("on cached multi-tile terrain the first floor crossing is used, behind a wall in front", () => {
    const frame = npcModels.getModel(spider, GIANT_SPIDER_DEATH, 10)! as any;
    assert.deepEqual([frame.verticesX[57], frame.verticesY[57], frame.verticesZ[57]], [0, 42, -16], "frame 10's vertex 57");
    const camera = new Camera(0.875, -5.796875, 40.5, 128, 512);
    camera.update(800, 600);
    for (const integer of [false, true]) {
        const floorY = cachedFloor(50, 50, integer);
        const centre = [1392, 5200];
        // Grounded like npc.vert.glsl: the centre's floor (with clearance) plus the model y.
        const vertex = vec3.fromValues(centre[0] + 0, floorY(centre[0], centre[1]) + 42, centre[1] - 16);
        assert.ok(Math.abs(vertex[1] + 230) < 1, `grounded at y -230 (${vertex[1]})`);
        const toEye = vec3.sub(vec3.create(), vec3.scale(vec3.create(), eyeOf(camera.viewMatrix), 128), vertex);
        assert.ok(vec3.distance(vec3.normalize(vec3.create(), toEye), vec3.normalize(vec3.create(), [-1280, -512, 0])) < 1e-4, "the review's sight line");
        const distance = assertFirstCrossingBehindWall(vertex, floorY, camera,
            (ray) => vec3.scaleAndAdd(vec3.create(), vertex, ray, (1152 - vertex[0]) / ray[0]));
        assert.ok(Math.abs(distance * (1280 / Math.hypot(1280, 512)) - 157) < 8, `crossing ${distance} units along`);
    }
});

test("on flat ground the line of sight meets the floor where it reaches the floor's level", () => {
    const camera = new Camera(30, -8, 30, 300, 700);
    camera.update(800, 600);
    const view = camera.viewMatrix;
    const eye = eyeOf(view);
    const vertex = vec3.fromValues(eye[0] * 128 + 300, 40, eye[2] * 128 - 900);
    const viewPos = toView(vertex, view);
    const fixed = actorFloorViewPos(viewPos, vertex, () => -10, view, camera.projectionMatrix);
    const ray = vec3.sub(vec3.create(), vec3.scale(vec3.create(), eye, 128), vertex);
    const expected = 50 / -ray[1];
    assert.ok(Math.abs((fixed[2] - viewPos[2]) / -viewPos[2] - expected) * vec3.length(ray) < 0.25);
    // Above the floor nothing moves.
    const standing = vec3.fromValues(vertex[0], -30, vertex[2]);
    const standingView = toView(standing, view);
    assert.deepEqual(actorFloorViewPos(standingView, standing, () => -10, view, camera.projectionMatrix), standingView);
    // With no way out of the floor in reach, the vertex keeps its own depth.
    assert.deepEqual(actorFloorViewPos(viewPos, vertex, () => 1000, view, camera.projectionMatrix), viewPos);
});

/** The steps the twin above copies, as the GLSL and WGSL helpers spell them. */
const MARCH_STEPS = [
    "ACTOR_FLOOR_MARCH_STEP / max(length(ray), 0.001)",
    "<= ACTOR_FLOOR_MARCH_STEPS; i++)",
    "if (p.y <= actorFloorY(p.xz, plane, groundOffset)) {\n            over = t;\n            break;",
    "under = t;\n        if (t >= maxT) {",
    "if (over < 0.0) {\n        return viewPos;",
    "< ACTOR_FLOOR_BISECTIONS; i++)",
    "over = mid;\n        } else {\n            under = mid;",
    "viewPos.xyz + towardEye * over",
];

function shaderSource(name: string): string {
    return fs.readFileSync(path.resolve(__dirname, "../render/shaders", name), "utf8").replace(/\r\n/g, "\n");
}

test("WebGL actor shaders take sunk vertices' depth from actorFloorViewPos", () => {
    const helper = shaderSource("includes/height-map.glsl");
    for (const step of MARCH_STEPS) assert.ok(helper.includes(step), step);
    assert.ok(helper.includes("const float ACTOR_FLOOR_MARCH_STEP = 8.0;\nconst int ACTOR_FLOOR_MARCH_STEPS = 128;\nconst int ACTOR_FLOOR_BISECTIONS = 6;"));
    assert.ok(helper.includes("return -getHeightInterp(xz, plane) + groundOffset;"));
    assert.ok(helper.includes("transpose(mat3(worldToView)) * towardEye * 128.0"));
    for (const [name, step, args] of [
        ["npc.vert.glsl", "-=", "npcInfo.plane, -u_modelYOffset"],
        ["player.vert.glsl", "+=", "playerInfo.plane, u_modelYOffset"],
    ]) {
        const source = shaderSource(name);
        // Taken after the tile height and ground offset, in local units.
        assert.ok(source.includes(`localPos.y ${step} u_modelYOffset;\n    vec4 groundedPos = localPos;`), name);
        assert.ok(source.includes(`actorFloorViewPos(viewPos, groundedPos, ${args},\n        u_worldEntityTransform * u_viewMatrix, u_projectionMatrix)`), name);
        // Only depth is replaced, so the vertex keeps its screen position.
        assert.match(source, /gl_Position = u_projectionMatrix \* viewPos;\s*gl_Position\.z = /, name);
    }
});

test("WebGPU npc and player entries take sunk vertices' depth from actorFloorViewPos", () => {
    for (const ext of [undefined, HD_SCENE_SHADERS]) {
        let code = "";
        createActorShaderModule({
            createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
                code = descriptor.code;
                return {};
            },
        } as GPUDevice, { alpha: false, ext });
        for (const step of MARCH_STEPS) assert.ok(code.includes(step), step);
        assert.ok(code.includes("const ACTOR_FLOOR_MARCH_STEP: f32 = 8.0;\nconst ACTOR_FLOOR_MARCH_STEPS: i32 = 128;\nconst ACTOR_FLOOR_BISECTIONS: i32 = 6;"));
        assert.ok(code.includes("return -getHeightInterp(xz, plane) + groundOffset;"));
        const entries = ["gfx", "player", "npc", "projectile"].map((kind) => [kind, code.indexOf(`fn ${actorVertexEntry(kind as any, false)}(`)] as const);
        for (const [kind, start] of entries) {
            assert.ok(start >= 0, kind);
            const next = entries.map(([, s]) => s).filter((s) => s > start).sort((a, b) => a - b)[0] ?? code.length;
            const body = code.slice(start, next);
            if (kind === "npc" || kind === "player") {
                const offset = kind === "npc" ? "-actorU.u_modelYOffset" : "actorU.u_modelYOffset";
                assert.ok(body.includes(`actorU.u_modelYOffset;\n    let groundedPos = localPos;`), kind);
                assert.ok(body.includes(`actorFloorViewPos(viewPos, groundedPos, info.plane, ${offset},`), kind);
                assert.match(body, /clipPosition = vec4<f32>\(clip\.x, clip\.y, \((floorZ|playerZ) \+ clip\.w\)/, kind);
            } else {
                assert.ok(!body.includes("groundedPos"), `${kind} keeps its own depth`);
            }
        }
    }
});
