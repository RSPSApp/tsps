import assert from "node:assert/strict";
import { test } from "node:test";

import fs from "node:fs";
import path from "node:path";
import { ProjectileManager } from "../render/projectiles/ProjectileManager";
import { ProjectileRenderer } from "../render/projectiles/ProjectileRenderer";
import { WebGPUActors } from "../render/webgpu/actors/WebGPUActors";

import { HD_SCENE_SHADERS } from "../game/plugins/hd/webgpu/hdSceneShaders";
import { ActorDataWriter, packProjectileActorData } from "../render/webgpu/actors/actorPacking";
import { actorVertexEntry, createActorShaderModule } from "../render/webgpu/shaders/actor.wgsl";

const map = {
    getRenderBaseTileX: () => 3200,
    getRenderBaseTileY: () => 3200,
    getLocalTileSpan: () => 64,
};

test("projectile actor data preserves ascending and descending pitch, yaw and roll", () => {
    for (const pitch of [0, 256, 1792, 2047]) {
        const writer = new ActorDataWriter();
        packProjectileActorData({} as any, writer, map as any, {
            getPosition: () => ({ x: 3200 * 128 + 64.75, y: 3200 * 128 + 63.25 }),
            getRotation: () => ({ yaw: 1536, pitch, roll: 768 }),
            projectileId: 10,
            plane: 0,
        });
        const [x, z, b, a] = writer.data;
        assert.equal(x, 64);
        assert.equal(z, 63);
        assert.equal((b >> 2) & 0x7ff, 1536);
        assert.equal(((((b >> 13) & 7) << 4) | ((a >> 9) & 15)) << 4, pitch & ~15);
        assert.equal(((a >> 13) & 7) << 8, 768);
    }
});

test("projectile scene and shadow entries use WebGL's roll, pitch, yaw order", () => {
    for (const ext of [undefined, HD_SCENE_SHADERS]) {
        for (const alpha of [false, true]) {
            for (const depth of ext ? [false, true] : [false]) {
                let code = "";
                createActorShaderModule(
                    {
                        createShaderModule: (descriptor: GPUShaderModuleDescriptor) => {
                            code = descriptor.code;
                            return {};
                        },
                    } as GPUDevice,
                    { alpha, ext, depth },
                );
                const entry = actorVertexEntry("projectile", depth);
                const projectile = code.slice(code.indexOf(`fn ${entry}(`));
                assert.match(projectile, /decodeProjectileInfo/);
                assert.match(
                    projectile,
                    /rotationZ\(f32\(info.roll\).*rotationX\(f32\(info.pitch\).*rotationY\(f32\(actorRotation\)/s,
                );
                assert.match(code, /decodeSignedU16\(data.g\)\) \+ actorU.u_subOffset/);
                const gfx = code.slice(
                    code.indexOf(`fn ${actorVertexEntry("gfx", depth)}(`),
                    code.indexOf(`fn ${actorVertexEntry("player", depth)}(`),
                );
                assert.ok(!gfx.includes("decodeProjectileInfo"), "spot animations retain actor placement");
            }
        }
    }
});

test("nonflat projectile compensation cancels the same native actor floor in both backends", () => {
    const heights = new Int16Array(4 * 66 * 66);
    heights[67] = 16; // One raised corner: bilinear centre32, terrain diagonal64.
    const slope = { ...map, mapX: 50, mapY: 50, heightMapSize: 66, borderSize: 0, heightMapData: heights };
    const renderer: any = { osrsClient: {}, mapManager: { getMapForWorldTile: () => slope } };
    const manager = new ProjectileManager(renderer);
    const position = { x: 3200 * 128 + 64, y: 3200 * 128 + 64, z: -100 };
    const projectile = {
        projectileId: 10, plane: 0, animationFrame: 0,
        getPosition: () => position, getRotation: () => ({ yaw: 0, pitch: 0, roll: 0 }),
    };
    assert.equal((manager as any).getGroundHeight(position.x, position.y, 0), -32,
        "projectile endpoints use the native bilinear floor");
    const glOffset = (new ProjectileRenderer(renderer, manager) as any).resolveModelYOffset(projectile, position);
    assert.equal(glOffset, 68);

    const actors: any = new WebGPUActors(renderer);
    actors.gfx = { projectiles: { getProjectilesForMap: () => [projectile] },
        cache: { getFrameCount: () => 1, smoothingCycle: () => 0 } };
    const offsets: number[] = [];
    actors.pushSpotGeometry = (...args: any[]) => offsets.push(args[6]);
    actors.packMapProjectiles({}, slope);
    assert.deepEqual(offsets, [glOffset], "both real CPU upload paths compensate the same floor");
    assert.equal(-32 - glOffset, position.z, "shader floor and compensation preserve absolute projectile height");

    const glsl = fs.readFileSync(path.resolve(__dirname, "../render/shaders/projectile.vert.glsl"), "utf8");
    assert.match(glsl, /localPos.y -= getActorHeightInterp\(tilePos, projInfo.plane\)/);
    let code = "";
    createActorShaderModule({ createShaderModule: (d: GPUShaderModuleDescriptor) => {
        code = d.code; return {};
    } } as GPUDevice, { alpha: false });
    const entries = ["gfx", "player", "npc", "projectile"].map((kind) =>
        [kind, code.indexOf(`fn ${actorVertexEntry(kind as any, false)}(`)] as const);
    for (const [kind, start] of entries) {
        const next = entries.map(([, index]) => index).filter((index) => index > start).sort((a, b) => a - b)[0] ?? code.length;
        assert.match(code.slice(start, next), /localPos.y -= getActorHeightInterp\(info.tilePos, info.plane\)/,
            `${kind} uses the same floor as its CPU placement and WebGL shader`);
    }
});
