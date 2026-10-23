import assert from "node:assert/strict";
import { test } from "node:test";

import { createMainFragmentWgsl } from "../render/webgpu/shaders/main.frag.wgsl";
import { HD_SCENE_SHADERS } from "../game/plugins/hd/webgpu/hdSceneShaders";
import { HdBloomPass } from "../game/plugins/hd/webgpu/hd-bloom";
import { HdTonemapPass } from "../game/plugins/hd/webgpu/hd-tonemap";
import { resolveWebGPULodDistance, resolveWebGPURenderDistance } from "../render/webgpu/frameConfig";

function postProcessGpu() {
    const uploads: Float32Array[] = [];
    const draws: Array<{ pipeline: any; groups: any[]; target: any }> = [];
    const device = {
        createShaderModule: () => ({}),
        createBindGroupLayout: () => ({}),
        createPipelineLayout: () => ({}),
        createRenderPipeline: (descriptor: any) => descriptor,
        createSampler: () => ({}),
        createTexture: (descriptor: any) => ({
            width: descriptor.size[0], height: descriptor.size[1],
            createView: () => ({}), destroy() {},
        }),
        createBuffer: () => ({ data: new Float32Array(0), destroy() {} }),
        createBindGroup: (descriptor: any) => descriptor,
        queue: {
            writeTexture() {},
            writeBuffer(buffer: any, _offset: number, data: Float32Array) {
                buffer.data = Float32Array.from(data);
                uploads.push(buffer.data);
            },
        },
    } as unknown as GPUDevice;
    const encoder = {
        beginRenderPass(descriptor: any) {
            const draw = { pipeline: undefined as any, groups: [] as any[], target: descriptor.colorAttachments[0] };
            return {
                setPipeline(pipeline: any) { draw.pipeline = pipeline; },
                setBindGroup(index: number, group: any) { draw.groups[index] = group; },
                draw() { draws.push(draw); },
                end() {},
            };
        },
    } as unknown as GPUCommandEncoder;
    return { device, encoder, uploads, draws };
}

test("HD bloom retains every filter pass and uploads size-dependent uniforms only on resize", () => {
    const gpu = postProcessGpu();
    const bloom = new HdBloomPass(gpu.device);
    const source = {} as GPUTextureView;
    for (const [width, height] of [[1919, 1081], [1024, 600]]) {
        bloom.ensure(width, height);
        const uploads = gpu.uploads.length;
        assert.equal(uploads, width === 1919 ? 11 : 22);
        const sizes = [[width, height]];
        for (let i = 0; i < 6; i++) sizes.push(sizes.at(-1)!.map(n => Math.max(1, Math.ceil(n / 2))));
        for (let frame = 0; frame < 3; frame++) {
            gpu.draws.length = 0;
            bloom.ensure(width, height);
            bloom.encode(gpu.encoder, source);
            assert.equal(gpu.uploads.length, uploads, "steady frames upload no bloom constants");
            assert.equal(gpu.draws.length, 11, "keep the full six-level bloom chain");
            gpu.draws.forEach((draw, i) => {
                const upsample = i >= 6;
                const src = upsample ? 12 - i : i;
                const dst = upsample ? src - 1 : src + 1;
                const [sw, sh] = sizes[src];
                const [dw, dh] = sizes[dst];
                assert.deepEqual(draw.groups[0].entries[0].resource.buffer.data,
                    Float32Array.from([sw, sh, 1 / sw, 1 / sh, dw, dh, 1 / dw, 1 / dh, 0.8, 0.5, 1, 0]));
                assert.equal(draw.pipeline.fragment.entryPoint,
                    i === 0 ? "fs_prefilter" : upsample ? "fs_upsample" : "fs_downsample");
                assert.equal(draw.target.loadOp, upsample ? "load" : "clear");
            });
        }
    }
    bloom.dispose();
});

test("HD tonemap reuses bindings but refreshes changed sources, dimensions and HDR mode", () => {
    const gpu = postProcessGpu();
    const tonemap = new HdTonemapPass(gpu.device, "bgra8unorm");
    let scene = {} as GPUTextureView;
    let bloom: GPUTextureView | undefined = {} as GPUTextureView;
    let ao: GPUTextureView | undefined = {} as GPUTextureView;
    const encode = (width = 800, hdr = true) => {
        const canvas = {} as GPUTextureView;
        tonemap.encode(gpu.encoder, canvas, scene, bloom, ao, width, 600, hdr);
        const draw = gpu.draws.at(-1)!;
        assert.equal(draw.target.view, canvas, "always draw to the current canvas texture");
        return draw.groups[1];
    };
    const original = encode();
    for (let frame = 0; frame < 100; frame++) assert.equal(encode(), original);
    assert.equal(gpu.uploads.length, 1);
    assert.deepEqual(gpu.uploads[0], Float32Array.from([0.6, 1.12, 1, 0.35, 0.75, 1, 0, 0, 800, 600, 1 / 800, 1 / 600]));
    bloom = undefined;
    const withoutBloom = encode();
    assert.notEqual(withoutBloom, original);
    assert.equal(encode(), withoutBloom);
    ao = undefined;
    const withoutAo = encode();
    assert.notEqual(withoutAo, withoutBloom);
    assert.equal(encode(), withoutAo);
    scene = {} as GPUTextureView;
    bloom = {} as GPUTextureView;
    ao = {} as GPUTextureView;
    const resized = encode(1024, false);
    assert.deepEqual(resized.entries.slice(0, 3).map((entry: any) => entry.resource), [scene, bloom, ao]);
    assert.equal(gpu.uploads.length, 2, "resizing or toggling HDR refreshes the grade uniforms");
    assert.equal(gpu.uploads.at(-1)![0], 1);
    assert.equal(gpu.uploads.at(-1)![5], 0);
    assert.equal(gpu.uploads.at(-1)![8], 1024);
    encode(1024, true);
    assert.equal(gpu.uploads.length, 3, "an HDR toggle alone must update exposure");
    assert.equal(gpu.uploads.at(-1)![5], 1);
    tonemap.dispose();
});

test("extended world shader writes unclamped linear HDR into the offscreen target", () => {
    const base = createMainFragmentWgsl(false);
    const extended = createMainFragmentWgsl(false, HD_SCENE_SHADERS);

    assert.match(base, /clamp\(finalRgb/, "base pipeline must keep clipping to the canvas");
    assert.ok(
        !extended.includes("clamp(finalRgb"),
        "extended pipeline writes HDR; the tonemap pass owns the display transform",
    );
    assert.match(base, /return clamp\(baseColor/, "base water highlights clip");
    assert.match(
        extended,
        /return max\(baseColor/,
        "extended water keeps specular headroom above 1 for bloom",
    );
});

test("117HD shade returns linear HDR, not the old display-referred grade", () => {
    const wgsl = HD_SCENE_SHADERS.world.declarations;

    assert.match(wgsl, /HD_EMISSIVE_GAIN/, "unlit HD materials must be emissive for bloom");
    assert.ok(
        !wgsl.includes("1.0 / 2.2"),
        "hdShade must not gamma-encode into the HDR target",
    );
    assert.match(
        HD_SCENE_SHADERS.world.shade,
        /pow\(max\(surface/,
        "skipped surfaces (floor water) are linearised to match the HDR target",
    );
});

test("117HD metadata.y is read as the HdMaterials.ts bitfield", () => {
    // Bit 0 = unlit, bit 1 = worldUv (castle/red brick walls use world-aligned masonry).
    assert.match(
        HD_SCENE_SHADERS.world.declarations,
        /\(i32\(metadata\.y\) & 1\) != 0/,
        "hdShade must test the unlit bit, not metadata.y > 0.5",
    );
    assert.match(
        HD_SCENE_SHADERS.world.textureSample,
        /i32\(hdMetadata\.y\) & 2/,
        "world shaders must apply the worldUv masonry mapping to wall materials",
    );
});

test("lamp and torch source faces survive the untextured vertex path and emit HDR", () => {
    assert.match(HD_SCENE_SHADERS.world.textureSample, /hdMetadata\.y = 5\.0/);
    assert.match(HD_SCENE_SHADERS.world.declarations, /\(i32\(metadata\.y\) & 4\) != 0/);
});

test("WebGPU HD long views retain WebGL's 160-tile range and 48-tile detail cap", () => {
    let enabled = true;
    const renderer = { osrsClient: { renderDistance: 160, lodDistance: 160,
        clientPlugins: { hdEnabled: () => enabled, gpuSettings: () => undefined } } } as any;
    assert.equal(resolveWebGPURenderDistance(renderer), 160);
    assert.equal(resolveWebGPULodDistance(renderer), 48);
    enabled = false;
    assert.equal(resolveWebGPURenderDistance(renderer), 90);
    assert.equal(resolveWebGPULodDistance(renderer), 90);
    renderer.osrsClient.lodDistance = 0;
    assert.equal(resolveWebGPULodDistance(renderer), 0);
});

test("WebGPU HD discards obscured fragments after gradients and before texture samples", () => {
    for (const slots of [HD_SCENE_SHADERS.world, HD_SCENE_SHADERS.actor]) {
        const setup = slots.textureSample;
        assert.ok(setup.indexOf("dpdy(hdUv)") < setup.indexOf("discard;"));
        assert.ok(setup.indexOf("discard;") < setup.indexOf("hdSampleTexture(hdLayer"));
        assert.match(setup, /else \{\s*textureColor = sampleModelTexture/);
        assert.ok(!slots.declarations.includes("dpdx(position)"), "shade uses pre-discard gradients");
        assert.match(slots.declarations, /detail <= 0.0/);
    }
});
