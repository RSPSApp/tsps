import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { App } from "picogl";

// PicoGL expects a browser global; the HD material table imports its texture files, which
// resolve to their paths outside webpack.
(globalThis as any).self = globalThis;
require.extensions[".glsl"] = (module, file) => { module.exports = readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) require.extensions[ext] = (module, file) => { module.exports = file; };
const { HD_DETAIL_TEXTURES } = require("../game/plugins/hd/HdMaterialData") as typeof import("../game/plugins/hd/HdMaterialData");
const { HD_TEXTURE_FILES, HdMaterials } = require("../game/plugins/hd/HdMaterials") as typeof import("../game/plugins/hd/HdMaterials");
const { HdMaterialsGpu } = require("../game/plugins/hd/webgpu/HdWebGPU") as typeof import("../game/plugins/hd/webgpu/HdWebGPU");

/**
 * Stands in for the DOM while an HD texture loader runs: images load as soon as they get a src,
 * and every 2D context the loader asks for is recorded with its options.
 */
function withFakeDom(run: (contexts: Array<{ options: unknown }>) => void): void {
    const contexts: Array<{ options: unknown }> = [];
    const previous = { document: globalThis.document, Image: globalThis.Image };
    const createCanvas = () => {
        const canvas = {
            width: 0,
            height: 0,
            getContext(type: string, options?: unknown) {
                assert.equal(type, "2d");
                contexts.push({ options });
                return {
                    canvas,
                    imageSmoothingQuality: "low",
                    drawImage() {},
                    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
                };
            },
        };
        return canvas;
    };
    class FakeImage {
        onload?: () => void;
        onerror?: () => void;
        set src(_file: string) { this.onload?.(); }
    }
    (globalThis as any).document = { createElement: (tag: string) => { assert.equal(tag, "canvas"); return createCanvas(); } };
    (globalThis as any).Image = FakeImage;
    try {
        run(contexts);
    } finally {
        (globalThis as any).document = previous.document;
        (globalThis as any).Image = previous.Image;
    }
}

const fakeTexture = () => ({ data() { return this; }, delete() {} });

test("117 HD (WebGL) reads its texture images back through CPU-backed canvases", () => {
    withFakeDom((contexts) => {
        const app = {
            createTexture2D: fakeTexture,
            createTextureArray: fakeTexture,
        } as unknown as App;
        const materials = new HdMaterials(app);
        materials.update(new Map());
        const expected = new Set([...HD_TEXTURE_FILES, ...HD_DETAIL_TEXTURES]).size;
        assert.equal(contexts.length, expected);
        for (const { options } of contexts) assert.deepEqual(options, { willReadFrequently: true });
        materials.dispose();
    });
});

test("117 HD (WebGPU) reads its texture images back through CPU-backed canvases", () => {
    withFakeDom((contexts) => {
        const device = {
            createTexture: (descriptor: any) => ({
                width: descriptor.size[0], mipLevelCount: descriptor.mipLevelCount ?? 1, destroy() {},
            }),
            queue: { writeTexture() {} },
        } as unknown as GPUDevice;
        const materials = new HdMaterialsGpu(device);
        materials.update(new Map(), true);
        assert.equal(contexts.length, HD_TEXTURE_FILES.length);
        for (const { options } of contexts) assert.deepEqual(options, { willReadFrequently: true });
        materials.dispose();
    });
});
