import { strict as assert } from "node:assert";

import { Opcodes } from "../rs/cs2/Opcodes";
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

// mouse_getx / mouse_gety give CS2 scripts the pointer in widget-layout space. The mouseover
// tooltip (and anything else a script draws at the pointer) is placed with them. Fixed mode
// draws the 765x503 gameframe centred and scaled in the canvas, so the canvas pointer has to
// go back through that root transform, or the tooltip lands far from the hovered object.
const handlers: HandlerMap = new Map();
registerClientOps(handlers);

function mouse(root: any, mouseX: number, mouseY: number, canvas = { width: 1600, height: 1000 }) {
    const pushed: number[] = [];
    const ctx = {
        widgetManager: {
            rootInterface: 548,
            canvasWidth: 765,
            canvasHeight: 503,
            getAllGroupRoots: () => [root],
            osrsClient: { inputManager: { mouseX, mouseY }, renderer: { canvas } },
        },
        pushInt: (value: number) => pushed.push(value),
    } as any;
    handlers.get(Opcodes.MOUSE_GETX)!(ctx);
    handlers.get(Opcodes.MOUSE_GETY)!(ctx);
    return pushed;
}

// Fixed mode, letterboxed: scaled 1.5x and centred with a 226 px margin on each side.
const letterboxed = { __widgetRenderScaleX: 1.5, __widgetRenderScaleY: 1.5, __widgetRenderOffsetX: 226, __widgetRenderOffsetY: 0 };
assert.deepEqual(mouse(letterboxed, 226 + 300 * 1.5, 200 * 1.5), [300, 200], "the letterbox offset and scale come off");
assert.deepEqual(mouse(letterboxed, 226, 0), [0, 0], "the gameframe's corner is 0,0");

// No recorded transform (resizable, or before the first draw): the buffer-to-layout ratio.
assert.deepEqual(mouse({}, 800, 500, { width: 765 * 2, height: 503 * 2 }), [400, 250]);
assert.deepEqual(mouse({}, 300, 200, { width: 765, height: 503 }), [300, 200], "unscaled stays as is");

// No pointer yet.
const none: number[] = [];
handlers.get(Opcodes.MOUSE_GETX)!({ widgetManager: {}, pushInt: (value: number) => none.push(value) } as any);
assert.deepEqual(none, [-1]);

console.log("cs2-mouse-position.test.ts: all tests passed");
