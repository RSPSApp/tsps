import assert from "node:assert/strict";
import { test } from "node:test";

import { BitmapFont } from "../rs/font/BitmapFont";
import { drawWrappedTextGL, widgetTextAlpha } from "../widgets/components/TextRenderer";
import type { GLRenderer } from "../widgets/gl/renderer";

// OSRS draws a text component at 255 minus its transparency, so text a script fades (a popup
// fading out) fades with its background instead of staying solid.

(globalThis as any).document = {
    createElement: () => ({ getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
    }) }),
};

test("a text component's alpha follows its transparency", () => {
    assert.equal(widgetTextAlpha({}), 1);
    assert.equal(widgetTextAlpha({ opacity: 255 }), 0);
    assert.equal(widgetTextAlpha({ transparency: 51, opacity: 0 }), 0.8, "the script value wins over the cache's");
});

test("wrapped text is drawn with the alpha it is given", () => {
    const font = new BitmapFont();
    font.ascent = font.maxAscent = 1;
    for (let ch = 0; ch < 256; ch++) {
        font.advances[ch] = font.widths[ch] = font.heights[ch] = 1;
        font.glyphPixels[ch] = new Uint8Array([1]);
    }
    const alphas: number[] = [];
    const glr = {
        createTextureFromCanvas: () => ({}),
        drawTextureQuads: (_t: unknown, _d: Float32Array, _c: number, _s: number, _rgb: number[], alpha: number) => alphas.push(alpha),
        drawRect: () => undefined,
    } as unknown as GLRenderer;
    drawWrappedTextGL(glr, () => font, "fade", 0, 0, 100, 20, 0, 0xffffff, 12, false, 0, 0, undefined, 1, 1, 0.25);
    drawWrappedTextGL(glr, () => font, "solid", 0, 0, 100, 20, 0, 0xffffff, 12, false, 0, 0);
    assert.deepEqual([...new Set(alphas)], [0.25, 1]);
});
