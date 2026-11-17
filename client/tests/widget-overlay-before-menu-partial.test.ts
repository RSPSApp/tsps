import assert from "node:assert/strict";

import { WidgetsOverlay } from "../ui/devoverlay/WidgetsOverlay";

// Before-menu overlays (RuneLite tooltips, Rune Pouch, Item Rarity) draw from inside the widget
// tree after it has turned scissoring off. A partial HUD pass clears only its dirty rects, so
// there they are drawn again in each rect, clipped to it; before, any of them on screen turned
// every pass with anything dirty (the minimap, every frame) into a full repaint.
const gl: any = {
    SCISSOR_TEST: 3089,
    calls: [] as string[],
    enable(cap: number) { this.calls.push(`enable ${cap}`); },
    disable(cap: number) { this.calls.push(`disable ${cap}`); },
    scissor(x: number, y: number, w: number, h: number) { this.calls.push(`scissor ${x},${y},${w},${h}`); },
};
const drawn: string[] = [];
const overlay = {
    drawBeforeMenu: true,
    signature: () => "pouch",
    draw: () => {
        drawn.push(gl.calls.at(-1));
        return [{ x: 10, y: 20, w: 30, h: 40 }];
    },
};
const overlay2d: any = new WidgetsOverlay({} as any, {
    getGameContext: () => ({ osrsClient: { clientPlugins: { placeOverlay: () => undefined } } }),
} as any);
overlay2d.glRenderer = { width: 200, height: 100, gl, canvas: {}, flush() {} };
overlay2d.app = { gl: { canvas: { clientWidth: 200, clientHeight: 100, getBoundingClientRect: () => ({ width: 200, height: 100 }) } } };
overlay2d.widgetOverlayRects = [];
overlay2d.currentBeforeMenuOverlays = [overlay];

// Full pass: no clip, drawn once.
overlay2d.beforeMenuOverlayRects = [];
overlay2d.menuOverlayDrawnThisPass = false;
overlay2d.drawWidgetOverlaysBeforeMenu();
overlay2d.drawWidgetOverlaysBeforeMenu();
overlay2d.commitBeforeMenuOverlayRects();
assert.equal(drawn.length, 1, "a full pass draws them once");
assert.equal(gl.calls.length, 0, "a full pass draws them unclipped, as before");
assert.deepEqual(overlay2d.widgetOverlayRects, [{ x: 10, y: 20, w: 31, h: 41 }]);

// Partial pass over two dirty rects: drawn in each, scissored to it (GL's y is flipped).
drawn.length = 0;
overlay2d.beforeMenuOverlayRects = [];
for (const rect of [{ x: 0, y: 0, w: 50, h: 30 }, { x: 100, y: 60, w: 20, h: 10 }]) {
    overlay2d.beforeMenuClip = rect;
    overlay2d.menuOverlayDrawnThisPass = false;
    overlay2d.drawWidgetOverlaysBeforeMenu();
}
overlay2d.beforeMenuClip = undefined;
overlay2d.commitBeforeMenuOverlayRects();
assert.deepEqual(drawn, ["scissor 0,70,50,30", "scissor 100,30,20,10"], "drawn once per dirty rect, inside it");
assert.deepEqual(gl.calls.filter((c: string) => c.startsWith("disable")).length, 2, "scissoring is turned back off");
assert.deepEqual(overlay2d.widgetOverlayRects, [{ x: 10, y: 20, w: 31, h: 41 }],
    "a partial pass replaces the layer's rects instead of appending them again");

// Many partial passes later the bookkeeping has not grown.
for (let i = 0; i < 50; i++) {
    overlay2d.beforeMenuOverlayRects = [];
    overlay2d.beforeMenuClip = { x: 0, y: 0, w: 5, h: 5 };
    overlay2d.menuOverlayDrawnThisPass = false;
    overlay2d.drawWidgetOverlaysBeforeMenu();
    overlay2d.beforeMenuClip = undefined;
    overlay2d.commitBeforeMenuOverlayRects();
}
assert.equal(overlay2d.widgetOverlayRects.length, 1, "one rect for the one overlay");

// An overlay that stops drawing takes its rect with it.
overlay.draw = () => [];
overlay2d.beforeMenuOverlayRects = [];
overlay2d.menuOverlayDrawnThisPass = false;
overlay2d.drawWidgetOverlaysBeforeMenu();
overlay2d.commitBeforeMenuOverlayRects();
assert.deepEqual(overlay2d.widgetOverlayRects, [], "nothing drawn, nothing kept");

// Other overlay rects are left alone.
const statusBars = { x: 1, y: 1, w: 2, h: 2 };
overlay2d.widgetOverlayRects = [statusBars];
overlay.draw = () => [{ x: 10, y: 20, w: 30, h: 40 }];
overlay2d.beforeMenuOverlayRects = [];
overlay2d.menuOverlayDrawnThisPass = false;
overlay2d.drawWidgetOverlaysBeforeMenu();
overlay2d.commitBeforeMenuOverlayRects();
assert.equal(overlay2d.widgetOverlayRects[0], statusBars, "an above-widget overlay's rect stays");
assert.equal(overlay2d.widgetOverlayRects.length, 2);

console.log("widget overlay before-menu partial redraw test passed");
