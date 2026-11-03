import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { mat3, mat4, vec2, vec3, vec4 } from "gl-matrix";

import { Camera } from "../game/Camera";
import { HD_SCENE_SHADERS } from "../game/plugins/hd/webgpu/hdSceneShaders";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { NpcModelLoader } from "../rs/config/npctype/NpcModelLoader";
import { VarManager } from "../rs/config/vartype/VarManager";
import { actorVertexEntry, createActorShaderModule } from "../render/webgpu/shaders/actor.wgsl";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

const GIANT_SPIDER = 3017;
const GIANT_SPIDER_DEATH = 5329;

// Issue 2016: the Giant spider's death folds its legs under the floor. OSRS still shows them, so
// the actor shaders must not let the floor's depth hide anything below the actor's ground plane.
test("the Giant spider's death sinks its legs below the floor", () => {
    const info = loadCacheList(loadCacheInfos()).latest;
    const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
    const npcs = factory.getNpcTypeLoader();
    const loader = new NpcModelLoader(npcs, factory.getModelLoader(), factory.getTextureLoader(),
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader?.(),
        new VarManager(factory.getVarBitTypeLoader()));
    const spider = npcs.load(GIANT_SPIDER);
    const lowest = (seqId: number, frame: number) => {
        const model = loader.getModel(spider, seqId, frame)!;
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
    const slopeStep = 16 / Math.max(vec2.length([ray[0], ray[2]]), 0.001);
    const maxT = ortho ? 1e6 : 0.999;
    let t = 0;
    for (let i = 0; i < 4; i++) {
        const p = vec3.scaleAndAdd(vec3.create(), localPos, ray, t);
        const floor = floorY(p[0], p[2]);
        const floorRise = (floorY(p[0] + ray[0] * slopeStep, p[2] + ray[2] * slopeStep) - floor) / slopeStep;
        const rate = ray[1] - floorRise;
        if (rate >= 0) break;
        t = Math.min(Math.max(t - (p[1] - floor) / rate, 0), maxT);
    }
    return vec4.fromValues(viewPos[0] + towardEye[0] * t, viewPos[1] + towardEye[1] * t, viewPos[2] + towardEye[2] * t, viewPos[3]);
}

/** The first version: the flat floor level under the vertex, which the review showed misses slopes. */
function flatFloorViewPos(viewPos: vec4, below: number, worldToView: mat4): vec4 {
    const up = vec4.transformMat4(vec4.create(), [0, -1, 0, 0], worldToView);
    const towardEye = vec3.fromValues(-viewPos[0], -viewPos[1], -viewPos[2]);
    const along = Math.min(below / 128 / vec3.dot(towardEye, [up[0], up[1], up[2]]), 0.999);
    return vec4.fromValues(viewPos[0] + towardEye[0] * along, viewPos[1] + towardEye[1] * along, viewPos[2] + towardEye[2] * along, 1);
}

// Review of PR 2034: on ground falling toward the camera, a wall between the camera and a sunk
// vertex must still hide it. Production camera at pitch 171, its eye 20 degrees above the actor
// (10 tiles out, 3.64 up); local units, y down, map square 0.
test("a sunk vertex on a slope down toward the camera stays behind a wall in front of it", () => {
    const camera = new Camera(30, -10 * Math.tan((20 * Math.PI) / 180), 30, 171, 0);
    camera.update(800, 600);
    const view = camera.viewMatrix;
    const projection = camera.projectionMatrix;
    const eye = mat4.getTranslation(vec3.create(), mat4.invert(mat4.create(), view));
    const forward = vec3.transformMat4(vec3.create(), [0, 0, -1], mat4.invert(mat4.create(), view));
    vec3.sub(forward, forward, eye);
    // The actor stands on the floor 10 tiles along the view, at the camera's x/z direction.
    const actorTiles = vec3.scaleAndAdd(vec3.create(), eye, forward, 10 / Math.hypot(forward[0], forward[2]));
    const toEye = vec2.normalize(vec2.create(), [eye[0] - actorTiles[0], eye[2] - actorTiles[2]]);
    const actor = vec2.fromValues(actorTiles[0] * 128, actorTiles[2] * 128);
    // Falls 64 units a tile toward the camera; the floor includes the 10-unit ground clearance.
    const floorY: FloorY = (x, z) => -10 + 0.5 * vec2.dot([x - actor[0], z - actor[1]], toEye);
    // Frame 10's vertex 57 is 32 units below its floor once the clearance is taken.
    const vertex = vec3.fromValues(actor[0], floorY(actor[0], actor[1]) + 32, actor[1]);

    const toView = (local: vec3) => vec4.transformMat4(vec4.create(), [local[0] / 128, local[1] / 128, local[2] / 128, 1], view);
    const ndcZ = (v: vec4) => {
        const clip = vec4.transformMat4(vec4.create(), v, projection);
        return clip[2] / clip[3];
    };
    const viewPos = toView(vertex);
    const fixed = actorFloorViewPos(viewPos, vertex, floorY, view, projection);

    // It lands on the floor, on the vertex's own line of sight.
    const ray = vec3.sub(vec3.create(), vec3.scale(vec3.create(), eye, 128), vertex);
    const t = (fixed[2] - viewPos[2]) / -viewPos[2];
    const landed = vec3.scaleAndAdd(vec3.create(), vertex, ray, t);
    assert.ok(Math.abs(landed[1] - floorY(landed[0], landed[2])) < 0.5, "on the sloped floor");
    for (const i of [0, 1]) assert.ok(Math.abs(fixed[i] / fixed[2] - viewPos[i] / viewPos[2]) < 1e-6, "same screen position");

    // A wall face on the next tile boundary toward the camera, from its floor up a tile.
    const wallDistance = 64;
    const along = wallDistance / vec2.dot([ray[0], ray[2]], toEye);
    const hit = vec3.scaleAndAdd(vec3.create(), vertex, ray, along);
    const wallFloor = floorY(hit[0], hit[2]);
    assert.ok(hit[1] < wallFloor && hit[1] > wallFloor - 128, "the line of sight passes through the wall");
    const wallZ = ndcZ(toView(hit));

    assert.ok(ndcZ(fixed) > wallZ, "the wall still covers the sunk vertex");
    assert.ok(ndcZ(fixed) < ndcZ(viewPos), "but it comes up out of the floor");
    // The flat floor level came up past the wall: the regression the review found.
    assert.ok(ndcZ(flatFloorViewPos(viewPos, 32, view)) < wallZ, "the flat level would draw it over the wall");
});

test("on flat ground the line of sight meets the floor where the flat level does", () => {
    const camera = new Camera(30, -8, 30, 300, 700);
    camera.update(800, 600);
    const view = camera.viewMatrix;
    const eye = mat4.getTranslation(vec3.create(), mat4.invert(mat4.create(), view));
    const vertex = vec3.fromValues(eye[0] * 128 + 300, 40, eye[2] * 128 - 900);
    const viewPos = vec4.transformMat4(vec4.create(), [vertex[0] / 128, vertex[1] / 128, vertex[2] / 128, 1], view);
    const fixed = actorFloorViewPos(viewPos, vertex, () => -10, view, camera.projectionMatrix);
    const flat = flatFloorViewPos(viewPos, 50, view);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(fixed[i] - flat[i]) < 1e-4);
    // Above the floor nothing moves.
    const standing = vec3.fromValues(vertex[0], -30, vertex[2]);
    const standingView = vec4.transformMat4(vec4.create(), [standing[0] / 128, standing[1] / 128, standing[2] / 128, 1], view);
    assert.deepEqual(actorFloorViewPos(standingView, standing, () => -10, view, camera.projectionMatrix), standingView);
});

/** The steps the twin above copies, as the GLSL and WGSL helpers spell them. */
const NEWTON_STEPS = [
    "16.0 / max(length(ray.xz), 0.001)",
    "i < 4",
    "(actorFloorY(p.xz + ray.xz * slopeStep, plane, groundOffset) - floorY) / slopeStep",
    "rate = ray.y - floorRise",
    "if (rate >= 0.0)",
    "t = clamp(t - (p.y - floorY) / rate, 0.0, maxT)",
    "viewPos.xyz + towardEye * t",
];

function shaderSource(name: string): string {
    return fs.readFileSync(path.resolve(__dirname, "../render/shaders", name), "utf8").replace(/\r\n/g, "\n");
}

test("WebGL actor shaders take sunk vertices' depth from actorFloorViewPos", () => {
    const helper = shaderSource("includes/height-map.glsl");
    for (const step of NEWTON_STEPS) assert.ok(helper.includes(step), step);
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
        for (const step of NEWTON_STEPS) assert.ok(code.includes(step), step);
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
