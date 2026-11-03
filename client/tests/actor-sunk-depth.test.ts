import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

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

function shaderSource(name: string): string {
    return fs.readFileSync(path.resolve(__dirname, "../render/shaders", name), "utf8");
}

test("WebGL actor shaders take sunk vertices' depth from where their line of sight meets the floor", () => {
    for (const [name, step, plane] of [
        ["npc.vert.glsl", "-=", "npcInfo.plane, -u_modelYOffset"],
        ["player.vert.glsl", "+=", "playerInfo.plane, u_modelYOffset"],
    ]) {
        const source = shaderSource(name).replace(/\r\n/g, "\n");
        // Measured against the floor under the vertex, after the tile height and ground offset.
        assert.ok(source.includes(`localPos.y ${step} u_modelYOffset;\n    float sunkTiles = actorSunkTiles(localPos, ${plane});`), name);
        assert.ok(source.includes("actorFloorViewPos(viewPos, sunkTiles, u_worldEntityTransform * u_viewMatrix, u_projectionMatrix)"), name);
        // Only depth is replaced, so the vertex keeps its screen position.
        assert.match(source, /gl_Position = u_projectionMatrix \* viewPos;\s*gl_Position\.z = /, name);
    }
    assert.match(shaderSource("includes/height-map.glsl"), /float floorY = -getHeightInterp\(localPos\.xz, plane\) \+ groundOffset;/);
    assert.match(shaderSource("includes/priority-depth.glsl"), /vec3 towardEye = ortho \? vec3\(0\.0, 0\.0, 1\.0\) : -viewPos\.xyz;/);
});

test("WebGPU npc and player entries take sunk vertices' depth from where their line of sight meets the floor", () => {
    for (const ext of [undefined, HD_SCENE_SHADERS]) {
        let code = "";
        createActorShaderModule({
            createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
                code = descriptor.code;
                return {};
            },
        } as GPUDevice, { alpha: false, ext });
        assert.match(code, /fn actorSunkTiles\(localPos: vec4<f32>, plane: u32, groundOffset: f32\)/);
        assert.match(code, /fn actorFloorViewPos\(/);
        const entries = ["gfx", "player", "npc", "projectile"].map((kind) => [kind, code.indexOf(`fn ${actorVertexEntry(kind as any, false)}(`)] as const);
        for (const [kind, start] of entries) {
            assert.ok(start >= 0, kind);
            const next = entries.map(([, s]) => s).filter((s) => s > start).sort((a, b) => a - b)[0] ?? code.length;
            const body = code.slice(start, next);
            if (kind === "npc" || kind === "player") {
                const offset = kind === "npc" ? "-actorU.u_modelYOffset" : "actorU.u_modelYOffset";
                assert.ok(body.includes(`let sunkTiles = actorSunkTiles(localPos, info.plane, ${offset});`), kind);
                assert.ok(body.includes("actorFloorViewPos(viewPos, sunkTiles, actorU.u_worldEntityTransform * scene.u_viewMatrix, scene.u_projectionMatrix)"), kind);
                assert.match(body, /clipPosition = vec4<f32>\(clip\.x, clip\.y, \((floorZ|playerZ) \+ clip\.w\)/, kind);
            } else {
                assert.ok(!body.includes("sunkTiles"), `${kind} keeps its own depth`);
            }
        }
    }
});
