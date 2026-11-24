import assert from "node:assert/strict";
import { test } from "node:test";

import { BitmapFont } from "../rs/font/BitmapFont";
import {
    drawWrappedTextGL,
    lineJustificationSpace,
    spreadLinesVertically,
    wrapTextToWidth,
} from "../widgets/components/TextRenderer";
import type { GLRenderer } from "../widgets/gl/renderer";

// OSRS text layout: a line may break after a "-", x alignment 3 justifies every line but the
// last, and y alignment 3 spreads the lines over the height.

const byLength = (s: string) => s.replace(/<[^>]*>/g, "").length;

test("a line may break after a hyphen, which stays on its line", () => {
    assert.deepEqual(wrapTextToWidth("well-known fact", 8, byLength), ["well-", "known", "fact"]);
    assert.deepEqual(wrapTextToWidth("well-known fact", 10, byLength), ["well-known", "fact"], "no break while the word fits");
    assert.deepEqual(wrapTextToWidth("a self-made-man", 7, byLength), ["a self-", "made-", "man"]);
    assert.deepEqual(wrapTextToWidth("up to-day", 6, byLength), ["up to-", "day"], "the part before the hyphen joins the line");
});

test("hyphens inside tags and at a word's end are not break points", () => {
    assert.deepEqual(wrapTextToWidth("<col=-1>abcdef</col> gh", 6, byLength), ["<col=-1>abcdef</col>", "gh"]);
    assert.deepEqual(wrapTextToWidth("abc- def", 5, byLength), ["abc-", "def"]);
    assert.deepEqual(wrapTextToWidth("abcdefgh", 3, byLength), ["abcdefgh"], "a word without a hyphen is never split");
});

test("the spare width of a justified line is shared over its spaces", () => {
    assert.equal(lineJustificationSpace("ab cd ef", 13, 8), 640, "5 pixels over 2 spaces, in 256ths");
    assert.equal(lineJustificationSpace("abcdef", 13, 6), 0, "no space to widen");
    assert.equal(lineJustificationSpace("ab cd", 4, 5), 0, "an overfull line is not squeezed");
    assert.equal(lineJustificationSpace("<col=ff0000>ab cd</col>", 8, 5), 768, "a tag's own text is not counted");
});

test("lines spread over the height share the spare space", () => {
    // 61 high, three lines 12 apart, ascent 1: 36 spare over 4 gaps.
    assert.deepEqual(spreadLinesVertically(61, 3, 12, 1, 0), { firstBaseline: 10, lineHeight: 21 });
    assert.deepEqual(spreadLinesVertically(20, 3, 12, 1, 0), { firstBaseline: 1, lineHeight: 12 }, "no negative padding");
    assert.deepEqual(spreadLinesVertically(61, 1, 12, 1, 0), { firstBaseline: 31, lineHeight: 12 }, "one line is centred");
});

// The draw path, with a font whose every glyph (the space too) is one pixel wide and tall.
(globalThis as any).document = {
    createElement: () => ({ getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
    }) }),
};
const font = new BitmapFont();
font.ascent = font.maxAscent = 1;
for (let ch = 0; ch < 256; ch++) {
    font.advances[ch] = font.widths[ch] = font.heights[ch] = 1;
    font.glyphPixels[ch] = new Uint8Array([1]);
}
/** The x of every glyph drawn, grouped by the y of its line. */
function glyphs(text: string, width: number, height: number, yAlign: 0 | 1 | 2 | 3, xAlign: 0 | 1 | 2 | 3, shadow = false) {
    const lines = new Map<number, number[]>();
    const glr = {
        createTextureFromCanvas: () => ({}),
        drawTextureQuads: (_texture: unknown, data: Float32Array, count: number, _scale: number, rgb: number[]) => {
            if (shadow !== (rgb[0] + rgb[1] + rgb[2] === 0)) return;
            for (let q = 0; q < count; q++) {
                const y = data[q * 16 + 1];
                if (!lines.has(y)) lines.set(y, []);
                lines.get(y)!.push(data[q * 16]);
            }
        },
        drawRect() {},
    } as unknown as GLRenderer;
    const bounds = drawWrappedTextGL(glr, () => font, text, 0, 0, width, height, 0, 0xff981f, 12, shadow, yAlign, xAlign);
    return { lines: [...lines.entries()].sort((a, b) => a[0] - b[0]), bounds };
}

test("x alignment 3 stretches every line but the last to the full width", () => {
    const { lines, bounds } = glyphs("ab cd ef<br>gh ij", 13, 60, 0, 3);
    // 5 spare pixels over two spaces: 2 before "cd", 3 before "ef"; the last glyph ends at 13.
    assert.deepEqual(lines[0][1], [0, 1, 4, 5, 6, 10, 11, 12]);
    assert.deepEqual(lines[1][1], [0, 1, 2, 3, 4], "the last line stays left aligned");
    assert.equal(bounds?.width, 13);
});

test("a justified line's shadow follows its text", () => {
    const { lines } = glyphs("ab cd ef<br>gh", 13, 60, 0, 3, true);
    assert.deepEqual(lines[0][1], [1, 2, 5, 6, 7, 11, 12, 13], "one pixel right of each glyph");
});

test("a wrapped paragraph is justified line by line", () => {
    const { lines } = glyphs("aa bb cc dd", 7, 60, 0, 3);
    assert.deepEqual(lines.map(([, xs]) => xs), [[0, 1, 4, 5, 6], [0, 1, 2, 3, 4]]);
});

test("y alignment 3 spreads the lines, and centres a single one", () => {
    assert.deepEqual(glyphs("a<br>b<br>c", 30, 61, 3, 0).lines.map(([y]) => y), [9, 30, 51]);
    assert.deepEqual(glyphs("a", 30, 61, 3, 0).lines.map(([y]) => y), [30]);
    assert.deepEqual(glyphs("a<br>b<br>c", 30, 61, 0, 0).lines.map(([y]) => y), [0, 12, 24], "top alignment is unchanged");
});

test("a hyphenated word wraps when drawn", () => {
    const { lines } = glyphs("well-known", 6, 60, 0, 0);
    assert.deepEqual(lines.map(([, xs]) => xs.length), [5, 5]);
});
