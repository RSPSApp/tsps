import assert from "node:assert/strict";
import { IndexedSprite } from "../rs/sprite/IndexedSprite";
import { spriteToCanvas } from "../widgets/gl/texture-cache";

let pixels: Uint8ClampedArray;
(globalThis as any).document = {
    createElement: () => ({
        getContext: () => ({
            createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            putImageData: (image: ImageData) => { pixels = image.data; },
        }),
    }),
};
const sprite = new IndexedSprite();
Object.assign(sprite, {
    width: 3, subWidth: 3, height: 1, subHeight: 1, xOffset: 0, yOffset: 0,
    pixels: new Uint8Array([0, 1, 1]), palette: new Int32Array([0, 0xaabbcc]),
    alpha: new Uint8Array([255, 96, 255]),
});
const canvas = spriteToCanvas(sprite);
assert.equal(canvas.width, 3, "preserve the source size");
assert.deepEqual([...pixels!], [0, 0, 0, 0, 170, 187, 204, 96, 170, 187, 204, 255],
    "transparent backgrounds and partially transparent smooth edges survive conversion");
sprite.alpha = new Uint8Array(3);
spriteToCanvas(sprite);
assert.equal(pixels![7], 255, "an empty alpha channel falls back to opaque palette colours");
console.log("sprite canvas alpha: ok");
