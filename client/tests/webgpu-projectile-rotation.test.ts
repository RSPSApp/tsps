import assert from "node:assert/strict";
import { test } from "node:test";

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
