import assert from "node:assert/strict";
import { test } from "node:test";

import { ActorDataTexture, MapActorUniforms, POSE_WIDTH } from "../render/webgpu/actors/actorGpu";
import { GPU_BUFFER_USAGE } from "../render/webgpu/bindings";

test("growing actor uniforms preserves every earlier draw's position and transform", () => {
    let uploaded = new ArrayBuffer(0);
    const device = {
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBindGroup: () => ({}),
        createBuffer: () => ({ destroy() {} }),
        queue: {
            writeTexture() {},
            writeBuffer: (_buffer: unknown, _offset: number, data: ArrayBuffer, start: number, size: number) => {
                uploaded = data.slice(start, start + size);
            },
        },
    } as unknown as GPUDevice;
    const uniforms = new MapActorUniforms(device, {} as GPUBindGroupLayout, {
        mapX: 50, mapY: 50, borderSize: 0, heightMapSize: 2,
        heightMapTextureData: new Int16Array(16),
    } as any);
    for (const count of [9, 17, 33]) {
        uniforms.reset();
        for (let i = 0; i < count; i++) {
            uniforms.addEntry(50 + i, 51, 1.5, -10, i, 0, 0, 0);
        }
        uniforms.flush();
        const floats = new Float32Array(uploaded);
        const words = new Uint32Array(uploaded);
        for (let i = 0; i < count; i++) {
            const row = i * 32;
            assert.equal(floats[row], 50 + i, `position survives growth at ${count} draws`);
            assert.equal(words[row + 4], i, "actor data index is preserved");
            assert.equal(new Int32Array(uploaded)[row + 10], -1, "CPU poses remain CPU poses");
            assert.deepEqual(Array.from(floats.subarray(row + 16, row + 32)),
                [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                "the transform must never become a zero matrix");
        }
    }
    uniforms.destroy();
});

test("WebGPU actor textures skip unchanged uploads, but upload changes and resized rows", () => {
    let uploads = 0;
    const device = {
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBindGroup: () => ({}),
        queue: { writeTexture: () => uploads++ },
    } as unknown as GPUDevice;
    const texture = new ActorDataTexture(device, {} as GPUBindGroupLayout, "test");
    const data = new Uint16Array(128);
    texture.update(device, data, 1);
    texture.update(device, data, 1);
    assert.equal(uploads, 1);
    data[0] = 1;
    texture.update(device, data, 1);
    assert.equal(uploads, 2, "in-place actor movement is uploaded");
    texture.update(device, data, 9);
    assert.equal(uploads, 3, "a newly referenced row must be uploaded even if zero");
    texture.update(device, data, 1);
    assert.equal(uploads, 4);
    texture.update(device, data, 0);
    assert.equal(uploads, 4, "no actors need no upload");
    texture.destroy();
});

test("GPU poses upload changed rows and retain previously uploaded poses across empty frames", () => {
    const writes: any[] = [];
    const device = {
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBindGroup: () => ({}),
        queue: { writeTexture: (target: any, data: Float32Array, layout: any, size: any) => {
            writes.push({ target, offset: data.byteOffset, first: data[0], layout, size });
        } },
    } as unknown as GPUDevice;
    const texture = new ActorDataTexture(device, {} as GPUBindGroupLayout, "poses");
    const data = new Float32Array(POSE_WIDTH * 4 * 2);
    data[0] = 1;
    data[POSE_WIDTH * 4] = 2;
    const idle = Float32Array.of(1), walk = Float32Array.of(2);
    let run = Float32Array.of(3);
    let poses = new Map([["idle", { row: 0, matrices: idle }], ["walk", { row: 1, matrices: walk }]]);
    texture.updatePoses(device, data, 3, poses);
    texture.updatePoses(device, data, 3, poses);
    assert.equal(writes.length, 1, "an unchanged pose table must not be uploaded again");
    assert.equal(texture.hasPose("idle", 0, idle), true);
    assert.equal(texture.hasPose("walk", 0, walk), false, "pose identity includes its texture row");

    poses = new Map([["idle", { row: 0, matrices: idle }], ["run", { row: 1, matrices: run }]]);
    data[POSE_WIDTH * 4] = 3;
    texture.updatePoses(device, data, 3, poses);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1].target.origin, { x: 0, y: 1 });
    assert.equal(writes[1].offset, POSE_WIDTH * 16);
    assert.equal(writes[1].first, 3);
    assert.equal(writes[1].layout.bytesPerRow, POSE_WIDTH * 16);
    assert.deepEqual(writes[1].size, { width: 3, height: 1, depthOrArrayLayers: 1 });

    run = Float32Array.of(4);
    poses.set("run", { row: 1, matrices: run });
    data[POSE_WIDTH * 4] = 4;
    texture.updatePoses(device, data, 3, poses);
    assert.equal(writes.length, 3, "a streamed replacement at the same pose key must reach the GPU");
    assert.equal(writes[2].first, 4);

    texture.updatePoses(device, data, 0, new Map());
    texture.updatePoses(device, data, 3, poses);
    assert.equal(writes.length, 3, "an empty frame does not erase GPU contents");
    texture.updatePoses(device, data, 3, new Map([["run", { row: 0, matrices: run }], ["idle", { row: 1, matrices: idle }]]));
    assert.equal(writes.length, 4, "reordered poses must update their new rows");
    assert.equal(writes[3].size.height, 2);
    texture.destroy();
    assert.equal(texture.hasPose("idle", 1, idle), false, "disposed texture contents cannot be reused");
});

test("actor uniforms skip unchanged frames and refresh data after a buffer grows", () => {
    const writes: ArrayBuffer[] = [];
    const device = {
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBindGroup: () => ({}), createBuffer: () => ({ destroy() {} }),
        queue: { writeTexture() {}, writeBuffer: (_buffer: unknown, _offset: number,
            data: ArrayBuffer, start: number, size: number) => writes.push(data.slice(start, start + size)) },
    } as unknown as GPUDevice;
    const uniforms = new MapActorUniforms(device, {} as GPUBindGroupLayout,
        { mapX: 50, mapY: 50, borderSize: 0 } as any);
    const frame = (count: number, offset = 0) => {
        uniforms.reset();
        for (let i = 0; i < count; i++) uniforms.addEntry(50 + offset, 50, -1, 10, i, 0, 0, 0);
        uniforms.flush();
    };
    frame(1);
    frame(1);
    assert.equal(writes.length, 1, "unchanged uniforms should stay on the GPU");
    frame(1, 1);
    assert.equal(writes.length, 2, "moving decks and draw offsets must update");
    assert.equal(new Float32Array(writes[1])[0], 51);
    frame(9, 1);
    assert.equal(writes.length, 3, "a grown buffer receives its complete contents");
    assert.equal(writes[2].byteLength, 9 * 128);
    frame(0);
    frame(1);
    assert.equal(writes.length, 4, "reappearing draws receive their current uniforms");
    uniforms.destroy();
});

test("packed actor records keep independent poses, offsets and deck transforms", () => {
    let descriptor: any, binding: any, uploaded = new ArrayBuffer(0);
    const device = {
        createTexture: () => ({ createView: () => ({}), destroy() {} }),
        createBuffer: (desc: any) => { descriptor = desc; return { destroy() {} }; },
        createBindGroup: (desc: any) => { binding = desc.entries[0].resource; return {}; },
        queue: { writeTexture() {}, writeBuffer: (_b: unknown, _o: number, data: ArrayBuffer, start: number, size: number) => {
            uploaded = data.slice(start, start + size);
        } },
    } as unknown as GPUDevice;
    const uniforms = new MapActorUniforms(device, {} as GPUBindGroupLayout, { mapX: 50, mapY: 51, borderSize: 6 } as any);
    const deck = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1]);
    uniforms.setWorldEntityTransform(deck);
    uniforms.addEntry(50, 51, -1, 10, 7, 0, 0.25, 0.75, 13);
    uniforms.setWorldEntityTransform(undefined);
    uniforms.addEntry(52, 53, -1, -10, 8, 1, 0.5, 0.125, 14);
    uniforms.flush();
    assert.equal(uploaded.byteLength, 256, "two complete actor records need 256 bytes, without dynamic-offset padding");
    assert.ok(descriptor.usage & GPU_BUFFER_USAGE.STORAGE);
    assert.equal(binding.size, descriptor.size, "every instance can read its own record from the bound array");
    const words = new Int32Array(uploaded), floats = new Float32Array(uploaded);
    assert.deepEqual([words[4], words[10], words[11]], [7, 13, 1]);
    assert.deepEqual(Array.from(floats.subarray(16, 32)), Array.from(deck));
    assert.deepEqual([words[32 + 4], words[32 + 10], words[32 + 11]], [8, 14, 0]);
    assert.deepEqual(Array.from(floats.subarray(32, 36)), [52, 53, -1, -10]);
    assert.equal(words[32 + 5], 1);
    assert.deepEqual(Array.from(floats.subarray(32 + 6, 32 + 8)), [0.5, 0.125]);
    uniforms.destroy();
});
