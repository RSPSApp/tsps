import assert from "node:assert/strict";
import { test } from "node:test";

import { drawScrollBar } from "../widgets/gl/widgetsGl/scrollbarDraw";
import {
    formatIf1Text,
    formatItemQuantity,
    heldWidgetTransparency,
    hiddenWidgetSkipped,
    itemWidgetText,
    lineWidgetEndpoints,
    rotatedSpriteRect,
    scrollbarThumb,
    spriteMaskRows,
} from "../widgets/gl/widgetsGl/widgetDrawRules";

// Small OSRS interface drawing rules, each checked against the rule it implements.

test("a hidden compass fills the rows of its sprite mask", () => {
    // A 4-row disc: 2 wide, 4 wide, 4 wide, 2 wide. Equal neighbouring rows merge.
    assert.deepEqual(spriteMaskRows([1, 0, 0, 1], [2, 4, 4, 2]), [
        { x: 1, y: 0, w: 2, h: 1 },
        { x: 0, y: 1, w: 4, h: 2 },
        { x: 1, y: 3, w: 2, h: 1 },
    ]);
    assert.deepEqual(spriteMaskRows([0, 0, 0], [3, 0, 3]), [
        { x: 0, y: 0, w: 3, h: 1 },
        { x: 0, y: 2, w: 3, h: 1 },
    ], "an empty row draws nothing and splits the rows around it");
});

test("legacy text fills %1..%5 with client script values", () => {
    const values = [42, 999999999, -3, 0, 1000000000];
    const at = (i: number) => values[i];
    assert.equal(formatIf1Text("Level %1 of %1", at), "Level 42 of 42");
    assert.equal(formatIf1Text("%2/%5", at), "*/*", "999999999 or more is shown as a star");
    assert.equal(formatIf1Text("%3 and %4", at), "-3 and 0");
    assert.equal(formatIf1Text("100% of %6 and %0", at), "100% of %6 and %0", "only 1 to 5 are placeholders");
    let calls = 0;
    assert.equal(formatIf1Text("plain", () => calls++), "plain");
    assert.equal(calls, 0, "text without a percent sign is not evaluated");
});

test("a hidden legacy layer is still drawn while it is the moused-over layer", () => {
    assert.equal(hiddenWidgetSkipped(false, 0, true), false);
    assert.equal(hiddenWidgetSkipped(false, 11, true), false);
    assert.equal(hiddenWidgetSkipped(false, 0, false), true);
    assert.equal(hiddenWidgetSkipped(false, 4, true), true, "only layers are revealed");
    assert.equal(hiddenWidgetSkipped(true, 0, true), true, "a modern component stays hidden");
});

test("a modern text component with an item shows the item's name", () => {
    assert.equal(itemWidgetText("Abyssal whip", false, 1), "Abyssal whip");
    assert.equal(itemWidgetText("Abyssal whip", false, 3), "<col=ff9040>Abyssal whip</col> x <col=ffff00>3</col>");
    assert.equal(itemWidgetText("Coins", true, 1), "<col=ff9040>Coins</col> x <col=ffff00>1</col>", "a stackable item always shows its quantity");
    assert.equal(itemWidgetText("Coins", true, -1), "Coins", "quantity -1 shows the bare name");
    assert.equal(itemWidgetText(null, false, 1), "null");
    // The form goes by the length of the grouped digits: over 6 characters is K, over 9 is M.
    assert.equal(formatItemQuantity(99999), " <col=ffff00>99,999</col>");
    assert.equal(formatItemQuantity(123456), " <col=ffffff>123K  (123,456)</col>");
    assert.equal(formatItemQuantity(1234567), " <col=ffffff>1,234K  (1,234,567)</col>");
    assert.equal(formatItemQuantity(12345678), " <col=00ff80>12M  (12,345,678)</col>");
});

test("a line keeps zero and negative width and height", () => {
    assert.deepEqual(lineWidgetEndpoints(10, 20, 0, 30, false), { x1: 10, y1: 20, x2: 10, y2: 50 }, "zero width is a vertical line");
    assert.deepEqual(lineWidgetEndpoints(10, 20, 30, 0, false), { x1: 10, y1: 20, x2: 40, y2: 20 }, "zero height is a horizontal line");
    assert.deepEqual(lineWidgetEndpoints(10, 20, -5, -7, false), { x1: 10, y1: 20, x2: 5, y2: 13 }, "negative sizes run backwards");
    assert.deepEqual(lineWidgetEndpoints(10, 20, 30, 40, true), { x1: 10, y1: 60, x2: 40, y2: 20 }, "the direction flag runs bottom left to top right");
});

test("a rotated sprite is scaled by its width alone and centred", () => {
    assert.deepEqual(rotatedSpriteRect(100, 100, 32, 32, 32, 32), { x: 100, y: 100, w: 32, h: 32 });
    // Twice as wide, but the same height: both axes double, the height does not stretch it.
    assert.deepEqual(rotatedSpriteRect(100, 100, 64, 32, 32, 32), { x: 100, y: 84, w: 64, h: 64 });
    // A tall component does not stretch a square sprite either.
    assert.deepEqual(rotatedSpriteRect(0, 0, 20, 100, 20, 20), { x: 0, y: 40, w: 20, h: 20 });
});

test("the held component is drawn at transparency 128 unless it renders in place", () => {
    assert.equal(heldWidgetTransparency(0, true, false), 128);
    assert.equal(heldWidgetTransparency(200, true, false), 128);
    assert.equal(heldWidgetTransparency(0, true, true), 0, "a scrollbar handle keeps its own");
    assert.equal(heldWidgetTransparency(40, false, false), 40);
});

test("the scrollbar handle is drawn even when it is as tall as the track", () => {
    assert.deepEqual(scrollbarThumb(100, 0, 200, 16, 8), { height: 34, offset: 0 });
    assert.deepEqual(scrollbarThumb(100, 100, 200, 16, 8), { height: 34, offset: 34 });
    // A 40 pixel bar has an 8 pixel track: the 8 pixel minimum handle fills it.
    assert.deepEqual(scrollbarThumb(40, 5, 400, 16, 8), { height: 8, offset: 0 });

    const rects: number[][] = [];
    const glr: any = { drawRect: (...args: any[]) => rects.push(args.slice(0, 4)), drawTexture() {} };
    drawScrollBar(glr, 0, 0, 5, 40, 400, {} as any, {} as any);
    const fullTrack = rects.filter(([x, y, w, h]) => x === 0 && y === 16 && w === 16 && h === 8);
    assert.equal(fullTrack.length, 2, "the track and, over it, a handle of the same size");
    assert.ok(rects.length > 2, "the handle and its edges are drawn, not the track alone");
});
