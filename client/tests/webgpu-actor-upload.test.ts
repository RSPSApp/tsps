import assert from "node:assert/strict";
import { test } from "node:test";

import { ActorDataTexture } from "../render/webgpu/actors/actorGpu";

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
