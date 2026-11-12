import assert from "node:assert/strict";

import { BitmapFont } from "../rs/font/BitmapFont";
import { drawWrappedTextGL, parseWrappedOsrsMarkup, wrapTextToWidth, type TextSegment } from "../widgets/components/TextRenderer";
import type { GLRenderer } from "../widgets/gl/renderer";

// The OSRS client sets a font's colour and styles once (AbstractFont.reset) and then draws every
// wrapped line (draw0) without resetting them, so a <col> opened on one line still colours the
// next. The skill guide's "Requires: ... Making Friends with My Arm" wraps inside its red tag.
const DEFAULT = 0xff981f;
const RED = 0xff0000;

const textOf = (line: TextSegment[]) => line.map((segment) => segment.text).join("");
const colourOf = (line: TextSegment[], text: string) => {
    const segment = line.find((s) => s.text.includes(text));
    assert.ok(segment, `no segment with "${text}" in "${textOf(line)}"`);
    return segment.color;
};

const guide = parseWrappedOsrsMarkup(
    [
        "Requires: <col=ff0000>Level 35 Construction</col>, <col=ff0000>Making",
        "Friends with My Arm</col>",
    ],
    DEFAULT,
);
assert.equal(colourOf(guide[0], "Requires:"), DEFAULT);
assert.equal(colourOf(guide[0], "Making"), RED);
assert.equal(colourOf(guide[1], "Friends with My Arm"), RED, "the colour carries to the next line");

// A closing tag on the next line ends it there, and later lines are back to the default.
const closed = parseWrappedOsrsMarkup(["<col=ff0000>red", "still</col> plain", "plain"], DEFAULT);
assert.equal(colourOf(closed[1], "still"), RED);
assert.equal(colourOf(closed[1], "plain"), DEFAULT);
assert.equal(colourOf(closed[2], "plain"), DEFAULT);

// Shadow, underline and strikethrough carry the same way.
const styled = parseWrappedOsrsMarkup(["<shad=00ff00><u=0000ff><str>one", "two"], DEFAULT);
assert.equal(styled[1][0].shadow, 0x00ff00);
assert.equal(styled[1][0].underline, 0x0000ff);
assert.equal(styled[1][0].strikethrough, 0x800000);

// Separate calls still start from the default: only lines of one text share styles.
assert.equal(colourOf(parseWrappedOsrsMarkup(["fresh"], DEFAULT)[0], "fresh"), DEFAULT);

// Exercise the draw path: it must distinguish explicit breaks from automatic wrapping.
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
const runs: { y: number; color: number }[] = [];
const decorations: number[] = [];
const glr = {
    createTextureFromCanvas: () => ({}),
    drawTextureQuads: (_texture: unknown, data: Float32Array, _count: number, _scale: number, rgb: number[]) => {
        runs.push({ y: data[1], color: (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255) });
    },
    drawRect: (_x: number, y: number) => decorations.push(y),
} as unknown as GLRenderer;
const render = (text: string, width = 100, height = 60) => {
    runs.length = decorations.length = 0;
    drawWrappedTextGL(glr, () => font, text, 0, 0, width, height, 0, DEFAULT, 12, false, 0, 0);
};
const styles = "<col=ff0000><shad=00ff00><u=0000ff><str>";
for (const height of [1, 60]) for (const br of ["<br>", "<br/>", "\n"]) {
    render(`${styles}one${br}two`, 100, height);
    assert.deepEqual(runs.filter((r) => r.color !== 0x00ff00).map((r) => r.color), [RED, DEFAULT], "explicit breaks reset colour in both widget layouts");
    assert.equal(runs.filter((r) => r.color === 0x00ff00).length, 1, "explicit breaks reset the shadow");
    assert.equal(decorations.length, 2, "explicit breaks reset underline and strikethrough");
}
render(`${styles}one two<br>plain`, 3);
assert.deepEqual(runs.filter((r) => r.color !== 0x00ff00).map((r) => r.color), [RED, RED, DEFAULT], "automatic wraps carry styles only inside the paragraph");
assert.equal(decorations.length, 4);
render(`${styles}one<br><br>plain`);
assert.deepEqual(runs.filter((r) => r.color !== 0x00ff00).map((r) => [r.y, r.color]), [[0, RED], [24, DEFAULT]], "empty explicit lines retain their height");

// The draw reports where the text landed: a buff timer's "11m" centred in a full-screen box.
assert.deepEqual(
    drawWrappedTextGL(glr, () => font, "11m", 10, 20, 880, 927, 0, DEFAULT, 12, false, 1, 1),
    { x: 448, y: 483, width: 3, height: 1 },
);
assert.equal(drawWrappedTextGL(glr, () => font, "", 10, 20, 880, 927, 0, DEFAULT), undefined);

// A non-breaking space keeps its two words on one line (cache text such as the league tasks'
// "level 10"), and it stays a non-breaking space in the wrapped line.
assert.deepEqual(
    wrapTextToWidth("Reach level 10 now", 11, (s) => s.length),
    ["Reach", "level 10", "now"],
);

console.log("text-wrapped-styles: ok");
