// The Fishing cape emote's pool (spot animation 819) was cut off and flickered: most of its
// water is drawn exactly on the floor or under it, and a depth-tested floor hides that. OSRS paints
// a graphic over the floor whatever lies under it, so the actor shaders give a spot animation's
// parts on or under the floor the depth of a plane just above it (actor.wgsl.ts gfxGroundOffset,
// npc.vert.glsl floorOffset), as NPCs and players already had for parts that sink.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { HD_SCENE_SHADERS } from "../game/plugins/hd/webgpu/hdSceneShaders";
import { GfxCache } from "../render/gfx/GfxCache";
import { actorVertexEntry, createActorShaderModule } from "../render/webgpu/shaders/actor.wgsl";
import { CacheSystem } from "../rs/cache/CacheSystem";
import { getCacheLoaderFactory } from "../rs/cache/loader/CacheLoaderFactory";
import { loadCache, loadCacheInfos, loadCacheList } from "../scripts/cache/load-util";

const FISHING_CAPE_POOL = 819;
/** The pool's blue faces, by their colour in the cache's model. */
const WATER_COLOURS = new Set([38821, 39390, 39492, 32999]);

const info = loadCacheList(loadCacheInfos()).latest;
const cache = loadCache(info);
const factory: any = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, cache.files));
const osrsClient = {
    spotAnimTypeLoader: factory.getSpotAnimTypeLoader(),
    modelLoader: factory.getModelLoader(),
    textureLoader: factory.getTextureLoader(),
    seqTypeLoader: factory.getSeqTypeLoader(),
    seqFrameLoader: factory.getSeqFrameLoader(),
    skeletalSeqLoader: factory.getSkeletalSeqLoader?.(),
};

function wgsl(ext?: typeof HD_SCENE_SHADERS): string {
    let code = "";
    createActorShaderModule({
        createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
            code = descriptor.code;
            return {};
        },
    } as GPUDevice, { alpha: false, ext });
    return code;
}

function entryBody(code: string, kind: string, depth: boolean): string {
    const start = code.indexOf(`fn ${actorVertexEntry(kind as any, depth)}(`);
    assert.ok(start >= 0, `${kind} entry`);
    const end = code.indexOf("\n@vertex", start);
    return code.slice(start, end < 0 ? code.length : end);
}

test("the pool is mostly on the floor or under it, in the frames it shows", () => {
    const gfx = new GfxCache({ osrsClient } as any);
    const source = osrsClient.modelLoader.getModel(osrsClient.spotAnimTypeLoader.load(FISHING_CAPE_POOL).modelId);
    assert.equal(gfx.getFrameCount(FISHING_CAPE_POOL), 89);
    const count = (frame: number) => {
        const model: any = gfx.getModel(FISHING_CAPE_POOL, frame, 0);
        const y = model.verticesY;
        let onFloor = 0, under = 0, water = 0;
        for (let face = 0; face < model.faceCount; face++) {
            if (!WATER_COLOURS.has(source.faceColors[face])) continue;
            water++;
            const ys = [y[model.indices1[face]], y[model.indices2[face]], y[model.indices3[face]]];
            if (ys.every((v) => v === 0)) onFloor++;
            else if (ys.every((v) => v > 0)) under++; // y is down
        }
        return { water, onFloor, under };
    };
    // Frame 12, the pool open: 50 faces lie in the terrain's own plane and 72 are below it.
    assert.deepEqual(count(12), { water: 134, onFloor: 50, under: 72 });
    // The base model, which the earlier fix read its water faces from, has 18 of those 50.
    const base = gfx.ensureBase(FISHING_CAPE_POOL)!;
    let biased = 0;
    for (let face = 0; face < base.faceCount; face++) if (base.faceRenderLayers![face] !== (base.faceRenderPriorities?.[face] ?? 0)) biased++;
    assert.equal(biased, 18);
});

test("WebGPU: a spot animation's parts on or under the floor take the floor's depth, with a clearance", () => {
    for (const ext of [undefined, HD_SCENE_SHADERS]) {
        const code = wgsl(ext);
        assert.ok(code.includes("const GFX_FLOOR_CLEARANCE: f32 = 10.0;"));
        assert.match(code, /fn gfxGroundOffset\(modelYOffset: f32\) -> f32 \{\s*if \(modelYOffset < 0\.0\) \{\s*return -modelYOffset;\s*\}\s*return -max\(modelYOffset, GFX_FLOOR_CLEARANCE\);\s*\}/);
        // The scene entries; the depth entries (shadow passes) are built from the same placement.
        for (const depth of [false]) {
            const gfx = entryBody(code, "gfx", depth);
            assert.ok(gfx.includes("actorU.u_modelYOffset;\n    let groundedPos = localPos;"), "taken after the tile height and offset");
            assert.ok(gfx.includes("actorFloorViewPos(viewPos, groundedPos, info.plane, gfxGroundOffset(actorU.u_modelYOffset),"));
            // Only depth is replaced, so the graphic keeps its place on the screen.
            assert.match(gfx, /let clip = scene\.u_projectionMatrix \* viewPos;\s*let floorClip = /);
            assert.match(gfx, /clipPosition = vec4<f32>\(clip\.x, clip\.y, \(floorZ \+ clip\.w\)/);
            // The face layers still separate the pool's own faces from each other.
            assert.ok(gfx.includes("viewPos = applyPriorityDepthBias(viewPos, vertex.priority);"));
            // NPCs are as they were; a projectile flies, and keeps its own depth.
            assert.ok(entryBody(code, "npc", depth).includes("actorFloorViewPos(viewPos, groundedPos, info.plane, -actorU.u_modelYOffset,"));
            assert.ok(!entryBody(code, "projectile", depth).includes("groundedPos"));
        }
    }
});

/** gfxGroundOffset, as the shader spells it: the floor's offset from the terrain (negative is up). */
function gfxGroundOffset(modelYOffset: number): number {
    return modelYOffset < 0 ? -modelYOffset : -Math.max(modelYOffset, 10);
}

test("the clearance: a graphic on the floor gets ten units, a raised one its own height", () => {
    assert.equal(gfxGroundOffset(0), -10, "attached to a player, on the floor");
    assert.equal(gfxGroundOffset(8), -10, "a tile graphic's small lift");
    assert.equal(gfxGroundOffset(92), -92, "raised to head height: its own plane");
    assert.equal(gfxGroundOffset(-20), 20, "lowered on purpose: unchanged");
});

test("WebGL: the program that draws spot animations gives one on the floor the same clearance", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../render/shaders/npc.vert.glsl"), "utf8").replace(/\r\n/g, "\n");
    assert.ok(source.includes("const float GFX_FLOOR_CLEARANCE = 10.0;"));
    // NPCs carry their own clearance in the offset (10) and are not touched.
    assert.ok(source.includes("float floorOffset = u_modelYOffset == 0.0 ? -GFX_FLOOR_CLEARANCE : -u_modelYOffset;"));
    assert.ok(source.includes("actorFloorViewPos(viewPos, groundedPos, npcInfo.plane, floorOffset,"));
});
