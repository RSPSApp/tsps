import assert from "node:assert/strict";

import type { WidgetOverlay } from "../game/plugins/ClientPluginManager";
import { planWidgetOverlayRedraw } from "../ui/devoverlay/WidgetsOverlay";

// A plugin overlay whose drawing changed used to redraw the whole widget UI, and any widget
// going dirty while a below-widget overlay (ground item labels) existed did too. Both made every
// HUD repaint a full one while walking or turning the camera. An overlay that can say where it
// draws now redraws just its previous and coming rects.

type Rect = { x: number; y: number; w: number; h: number };
const clamp = (x: number, y: number, w: number, h: number): Rect | undefined => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(800, x + w), y1 = Math.min(600, y + h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
};

function overlay(signature: string, coverage?: Rect[] | (() => Rect[] | undefined)): WidgetOverlay & { sig: string } {
    const o: any = {
        sig: signature,
        signature() { return this.sig; },
        draw() { return []; },
    };
    if (coverage) o.coverage = typeof coverage === "function" ? coverage : () => coverage;
    return o;
}

const signatures = new WeakMap<WidgetOverlay, string>();
const rects = new WeakMap<WidgetOverlay, Rect[]>();

const labels = overlay("labels@1", [{ x: 100.5, y: 50.2, w: 40.3, h: 16 }]);
const bars = overlay("bars@1");
const all = [labels, bars];

// First pass: everything is new, and `bars` cannot say where it draws.
let plan = planWidgetOverlayRedraw(all, [], signatures, rects, clamp);
assert.equal(plan.setChanged, true, "no overlays were drawn before");
assert.equal(plan.needsFullRedraw, true, "an overlay without coverage redraws everything");
rects.set(labels, [{ x: 100, y: 50, w: 42, h: 17 }]);
rects.set(bars, [{ x: 700, y: 10, w: 60, h: 20 }]);

// Nothing changed: nothing to redraw.
plan = planWidgetOverlayRedraw(all, all, signatures, rects, clamp);
assert.deepEqual(plan, { setChanged: false, needsFullRedraw: false, dirtyRects: [] });

// The labels moved (the camera turned): their old rect and the new, clamped coverage.
labels.sig = "labels@2";
(labels as any).coverage = () => [{ x: 120.5, y: 48.7, w: 40.3, h: 16 }];
plan = planWidgetOverlayRedraw(all, all, signatures, rects, clamp);
assert.equal(plan.setChanged, false);
assert.equal(plan.needsFullRedraw, false, "coverage spares the full redraw");
assert.deepEqual(plan.dirtyRects, [
    { x: 100, y: 50, w: 42, h: 17 },
    { x: 120, y: 48, w: 42, h: 17 },
], "where the labels were, then where they go (floored origin, ceiled size plus one)");
assert.equal(signatures.get(labels), "labels@2", "the signature is recorded as polled");

// Polling again without a change: the move was already planned.
plan = planWidgetOverlayRedraw(all, all, signatures, rects, clamp);
assert.deepEqual(plan.dirtyRects, []);

// A changed overlay without coverage still redraws everything, and the one with coverage is
// polled (recorded) all the same so it does not re-trigger next pass.
bars.sig = "bars@2";
labels.sig = "labels@3";
plan = planWidgetOverlayRedraw(all, all, signatures, rects, clamp);
assert.equal(plan.needsFullRedraw, true);
assert.equal(signatures.get(labels), "labels@3");
plan = planWidgetOverlayRedraw(all, all, signatures, rects, clamp);
assert.deepEqual(plan, { setChanged: false, needsFullRedraw: false, dirtyRects: [] });

// Coverage that is off the canvas contributes nothing new; the old rect still clears.
labels.sig = "labels@4";
(labels as any).coverage = () => [{ x: 900, y: 50, w: 40, h: 16 }];
plan = planWidgetOverlayRedraw(all, all, signatures, rects, clamp);
assert.deepEqual(plan.dirtyRects, [{ x: 100, y: 50, w: 42, h: 17 }]);

// An overlay that cannot tell yet (no font before its first draw) falls back to a full redraw.
labels.sig = "labels@5";
(labels as any).coverage = () => undefined;
plan = planWidgetOverlayRedraw(all, all, signatures, rects, clamp);
assert.equal(plan.needsFullRedraw, true);

// A plugin toggled: a different set of overlays redraws everything.
plan = planWidgetOverlayRedraw([labels], all, signatures, rects, clamp);
assert.equal(plan.setChanged, true);
plan = planWidgetOverlayRedraw([bars, labels], all, signatures, rects, clamp);
assert.equal(plan.setChanged, true, "the same overlays in another order draw in another order");

console.log("widget overlay partial redraw test passed");
