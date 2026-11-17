import assert from "node:assert/strict";

import { WidgetsOverlay } from "../ui/devoverlay/WidgetsOverlay";

// Partial HUD passes clear only their dirty rects, then redraw the widget tree clipped to each
// rect. Every overlay that was in a cleared rect has to come back there, clipped to it:
// - anchored overlays (Status Bars) draw from inside the tree when it reaches the side-panel
//   anchor, under the tree's scissor;
// - before-menu overlays (RuneLite tooltips, Rune Pouch, Item Rarity) draw after the tree,
//   which has turned scissoring off by then.
// Both used to draw once per pass, so a pass with two separate rects (one bar on each side of
// the panel, as when the minimap repaint pulls both bar rects in) lost the second bar.

const H = 500;
type Rect = { x: number; y: number; w: number; h: number };
const gl: any = {
    SCISSOR_TEST: 3089,
    enabled: false,
    box: undefined as Rect | undefined,
    enable(cap: number) { if (cap === this.SCISSOR_TEST) this.enabled = true; },
    disable(cap: number) { if (cap === this.SCISSOR_TEST) this.enabled = false; },
    scissor(x: number, y: number, w: number, h: number) { this.box = { x, y: H - (y + h), w, h }; },
};
const clipNow = (): Rect | undefined => (gl.enabled ? { ...gl.box } : undefined);

const LEFT_BAR = { x: 502, y: 41, w: 21, h: 253 };
const RIGHT_BAR = { x: 712, y: 135, w: 20, h: 252 };
const draws: { name: string; clip: Rect | undefined }[] = [];
const statusBars = {
    drawAtAnchor: true,
    signature: () => "bars",
    draw: () => { draws.push({ name: "bars", clip: clipNow() }); return [LEFT_BAR, RIGHT_BAR]; },
};
const opponentInfo = {
    signature: () => "opponent",
    draw: () => { draws.push({ name: "opponent", clip: clipNow() }); return [{ x: 10, y: 10, w: 100, h: 40 }]; },
};
const tooltip = {
    drawBeforeMenu: true,
    signature: () => "tip",
    draw: () => { draws.push({ name: "tooltip", clip: clipNow() }); return [{ x: 600, y: 200, w: 80, h: 30 }]; },
};

const overlay: any = new WidgetsOverlay({} as any, {
    getGameContext: () => ({ osrsClient: { clientPlugins: { placeOverlay: () => undefined } } }),
} as any);
overlay.glRenderer = { width: 800, height: H, gl, canvas: {}, flush() {} };
overlay.app = { gl: { canvas: { clientWidth: 800, clientHeight: H, getBoundingClientRect: () => ({ width: 800, height: H }) } } };
const widgetManager: any = { rootWidgetCount: 1, rootWidgetXs: [0], rootWidgetYs: [0], rootWidgetWidths: [800], rootWidgetHeights: [H] };
overlay.widgetEntries = [{
    root: { rootIndex: 0 },
    renderOpts: { widgetOverlayAnchorDrawn: () => overlay.drawWidgetOverlaysAtAnchor() },
}];
overlay.currentBeforeMenuOverlays = [tooltip];

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const inside = (inner: Rect, outer: Rect) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** Stands in for renderWidgetTreeGL: scissors to the root clip, reaches the anchor if it is in the clip, then the before-menu hook with scissoring off. */
let anchorArea: Rect = { x: 500, y: 40, w: 240, h: 360 };
const fakeTree = (_glr: unknown, _root: unknown, opts: any) => {
    const clip = { x: opts.rootClip.x0, y: opts.rootClip.y0, w: opts.rootClip.x1 - opts.rootClip.x0, h: opts.rootClip.y1 - opts.rootClip.y0 };
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(clip.x, H - (clip.y + clip.h), clip.w, clip.h);
    if (intersects(anchorArea, clip)) opts.widgetOverlayAnchorDrawn?.(1);
    gl.disable(gl.SCISSOR_TEST);
    opts.drawAboveWidgets?.();
};
const pass = (rects: Rect[], redrawOverlays: boolean) => {
    draws.length = 0;
    // As draw() passes them: below-widget and before-menu overlays are filtered out of this list.
    overlay.redrawDirtyRects(widgetManager, rects, [statusBars, opponentInfo], redrawOverlays, fakeTree);
    return draws.slice();
};

// A full pass first, so every layer has its rects.
overlay.anchorOverlayRects = [LEFT_BAR, RIGHT_BAR];
overlay.aboveOverlayRects = [{ x: 10, y: 10, w: 101, h: 41 }];
overlay.beforeMenuOverlayRects = [];
overlay.commitWidgetOverlayRects();

// The reviewer's case: both bar rects are dirty, as separate rects.
{
    const d = pass([LEFT_BAR, RIGHT_BAR], true);
    const bars = d.filter((x) => x.name === "bars");
    assert.equal(bars.length, 2, "the bars are drawn in both cleared rects, not only the first");
    assert.deepEqual(bars[0].clip, LEFT_BAR, "first inside the left rect");
    assert.deepEqual(bars[1].clip, RIGHT_BAR, "then inside the right rect");
    const tips = d.filter((x) => x.name === "tooltip");
    assert.deepEqual(tips.map((t) => t.clip), [LEFT_BAR, RIGHT_BAR], "before-menu overlays: once per rect, clipped to it");
    const order = d.map((x) => x.name);
    assert.ok(order.indexOf("bars") < order.indexOf("tooltip"), "bars stay under the tooltip");
    const opp = d.filter((x) => x.name === "opponent");
    assert.equal(opp.length, 1, "above-tree overlays draw once, after the tree");
    assert.equal(opp[0].clip, undefined, "whole (their rects were merged into the cleared rects)");
    assert.equal(gl.enabled, false, "scissoring is off afterwards");
}

// Bookkeeping: one set of rects per layer, however many partial passes run.
{
    for (let i = 0; i < 30; i++) pass([LEFT_BAR, RIGHT_BAR], true);
    for (let i = 0; i < 30; i++) pass([{ x: 600, y: 300, w: 20, h: 20 }], false);
    const rects = overlay.widgetOverlayRects as Rect[];
    assert.equal(rects.length, 4, "two bar rects, one opponent rect, one tooltip rect");
    assert.ok(rects.some((r) => r.x === LEFT_BAR.x) && rects.some((r) => r.x === RIGHT_BAR.x), "both bars kept");
    assert.ok(rects.some((r) => r.x === 10), "the above-tree rect is kept when that layer is not redrawn");
}

// The tree reaches the anchor in the left rect only: the right rect still gets its bar back,
// clipped to it, with the tooltip over it again.
{
    anchorArea = { x: 500, y: 40, w: 30, h: 100 };
    const d = pass([LEFT_BAR, RIGHT_BAR], true);
    const bars = d.filter((x) => x.name === "bars");
    assert.equal(bars.length, 2, "bar drawn at the anchor, then in the missed rect");
    assert.deepEqual(bars[0].clip, LEFT_BAR);
    assert.deepEqual(bars[1].clip, RIGHT_BAR, "the missed rect, clipped to it");
    const afterFallback = d.slice(d.indexOf(bars[1]) + 1).filter((x) => x.name === "tooltip");
    assert.equal(afterFallback.length, 1, "the tooltip is drawn over the fallback bar again");
    assert.deepEqual(afterFallback[0].clip, RIGHT_BAR);
    assert.equal(d.filter((x) => x.name === "opponent").length, 1, "above-tree overlays still once");
}

// A dirty rect that misses the bars does not redraw them.
{
    anchorArea = { x: 500, y: 40, w: 30, h: 100 };
    const d = pass([LEFT_BAR, { x: 300, y: 450, w: 10, h: 10 }], false);
    assert.equal(d.filter((x) => x.name === "bars").length, 1, "only where the anchor was reached");
}

// The anchor is reached nowhere: the whole overlay layer is drawn once after the tree, as before.
{
    anchorArea = { x: 0, y: 0, w: 1, h: 1 };
    const d = pass([LEFT_BAR, RIGHT_BAR], true);
    const bars = d.filter((x) => x.name === "bars");
    assert.equal(bars.length, 1, "drawn once, whole");
    assert.equal(bars[0].clip, undefined);
    assert.ok(inside(LEFT_BAR, LEFT_BAR) && inside(RIGHT_BAR, RIGHT_BAR));
    assert.equal(overlay.widgetOverlayRects.length, 4, "rects split back into their layers");
}

// Full pass (no clip): before-menu overlays draw once, unclipped.
{
    draws.length = 0;
    overlay.beforeMenuClip = undefined;
    overlay.menuOverlayDrawnThisPass = false;
    overlay.drawWidgetOverlaysBeforeMenu();
    overlay.drawWidgetOverlaysBeforeMenu();
    assert.equal(draws.length, 1, "once per full pass");
    assert.equal(draws[0].clip, undefined, "unclipped in a full pass, as before");
}

console.log("widget overlay partial redraw (anchored + before-menu) test passed");
