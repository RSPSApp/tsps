/**
 * Regression test: mouse events fired by the hover pipeline (onMouseOver /
 * onMouseLeave / onMouseRepeat) must report LOGICAL widget coordinates, not
 * canvas buffer pixels.
 *
 * Background: on a high-DPI screen (or with UI zoom) the canvas buffer is a
 * scaled-up copy of the logical interface layout (render scale S = buffer/
 * logical > 1). The hover path used to hand scripts `mouseX = mx - widget
 * ._absX` with both terms in buffer pixels, while onDrag/onDragComplete
 * divide by getUiRenderScale() to report logical coordinates. The settings
 * sliders' cache scripts (written for the real client, where buffer ==
 * logical) divide event_mousex by the track's logical width, so the inflated
 * buffer-pixel offset biased the pointer->value math and pinned the
 * brightness slider to one direction (it could only be nudged a little).
 *
 * processWidgetHoverInput has no runtime imports of browser-only code, so it
 * can be driven directly with fakes.
 */
import assert from "node:assert/strict";

const { processWidgetHoverInput } = require("../game/widgets/input/widgetHoverInput");

function runHover({ mx, my, widget, scale }: {
    mx: number;
    my: number;
    widget: any;
    scale: [number, number];
}): { mouseX: number; mouseY: number } {
    let captured: any = null;
    const deps: any = {
        getCs2Vm: () => ({ invokeEventHandler: () => {} }),
        executeScriptListener: (_w: any, _listener: any[], ctx: any) => {
            captured = ctx;
        },
        getWorldMap: () => ({ updateWorldMapIconHover: () => {} }),
    };
    const state: any = {
        hoveredWidgetUids: new Set<number>(),
        hoveredWidgetsByUid: new Map<number, any>(),
        if1ScrollbarDragging: false,
        if1AlternativeScrollbarWidth: 0,
        lastHoverHitX: -1,
        lastHoverHitY: -1,
        cachedHoverHits: null,
        lastHoverListenerCycle: -1,
    };
    const frame: any = {
        input: { isDragging: () => true },
        mx,
        my,
        allRoots: [],
        visibleMap: new Map(),
        hits: [widget],
        getStaticChildren: () => [],
        getInterfaceParentRoots: () => [],
        isInputCaptureWidget: () => false,
        getWidgetFlags: (w: any) => w.flags ?? 0,
        collectFromAllRoots: () => [],
        invalidateHoverCache: () => {},
    };
    const widgetInteraction: any = { getUiRenderScale: () => scale };
    processWidgetHoverInput(deps, state, frame, {} as any, widgetInteraction);
    assert.ok(captured, "onMouseRepeat listener must fire while the button is held");
    return { mouseX: captured.mouseX, mouseY: captured.mouseY };
}

// A slider widget: buffer-space absolute position (as written by
// collectWidgetsAtPointAcrossRoots -> applyScreenTransformToWidgetAbs).
const widget: any = {
    uid: 116 << 16,
    isIf3: true,
    _absX: 400, // buffer pixels
    _absY: 200, // buffer pixels
    x: 100,
    y: 50,
    onMouseRepeat: [7],
};

// ── Test 1: at a 2x UI render scale the event reports logical coords ──
{
    // Pointer at buffer (1200, 300); widget origin at buffer (400, 200).
    // Buffer offset = (800, 100); logical offset at scale 2 = (400, 50).
    const ctx = runHover({ mx: 1200, my: 300, widget, scale: [2, 2] });
    assert.equal(ctx.mouseX, 400, "mouseX must be divided by the render scale");
    assert.equal(ctx.mouseY, 50, "mouseY must be divided by the render scale");
}
console.log("hover coord test 1 passed: 2x scale reports logical coordinates");

// ── Test 2: at 1x the behavior is unchanged (buffer == logical) ──
{
    const ctx = runHover({ mx: 1200, my: 300, widget, scale: [1, 1] });
    assert.equal(ctx.mouseX, 800, "1x scale must keep the raw offset");
    assert.equal(ctx.mouseY, 100, "1x scale must keep the raw offset");
}
console.log("hover coord test 2 passed: 1x scale is unchanged");

// ── Test 3: fractional scale (e.g. UI zoom 1.5) rounds to logical pixels ──
{
    // Buffer offset 800 / 1.5 = 533.33 -> 533.
    const ctx = runHover({ mx: 1200, my: 300, widget, scale: [1.5, 1.5] });
    assert.equal(ctx.mouseX, 533, "fractional scale must round to logical pixels");
    assert.equal(ctx.mouseY, 67, "fractional scale must round to logical pixels");
}
console.log("hover coord test 3 passed: fractional scale maps to logical pixels");

console.log("All mouse-event coordinate-space regression tests passed");
