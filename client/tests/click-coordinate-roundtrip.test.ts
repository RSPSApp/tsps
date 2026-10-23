import assert from "node:assert/strict";

import { getMousePos } from "../game/InputManager";
import { toCssEvent } from "../render/render/interact/menu2";

(globalThis as any).document = { documentElement: { dataset: {} } };

const rect = {
    left: 50,
    top: 25,
    width: 1000,
    height: 500,
};
const canvas = {
    width: 2000,
    height: 1000,
    clientWidth: 1000,
    clientHeight: 500,
    getBoundingClientRect: () => rect,
};
const host = {
    canvas,
    cachedCanvasRect: null,
    cachedCanvasRectFrame: -1,
    cachedCssEventResult: { clientX: 0, clientY: 0 },
};

const event = toCssEvent(host as any, 1500, 750, 1);
assert.ok(event);
assert.deepEqual(getMousePos(canvas as any, event as MouseEvent), [1500, 750]);

// Forced-landscape portrait (useSafariLandscapeLock): the root is rotated 90deg, so the
// bounding rect is the rotated one (500 x 1000) while clientWidth/Height stay unrotated.
const dataset = (globalThis as any).document.documentElement.dataset;
dataset.iosSafariForceLandscape = "1";
dataset.iosSafariForceLandscapeRotated = "1";
const rotatedRect = { left: 30, top: 10, width: 500, height: 1000 };
const rotatedCanvas = { ...canvas, getBoundingClientRect: () => rotatedRect };
const rotatedHost = { ...host, canvas: rotatedCanvas, cachedCanvasRect: null, cachedCanvasRectFrame: -1 };
for (const [gx, gy] of [[1500, 750], [0, 0], [1999, 999], [300, 900]] as const) {
    const rotated = toCssEvent(rotatedHost as any, gx, gy, 1);
    assert.ok(rotated);
    assert.deepEqual(getMousePos(rotatedCanvas as any, rotated as MouseEvent), [gx, gy]);
}

console.log("Click coordinate round-trip regression test passed");
