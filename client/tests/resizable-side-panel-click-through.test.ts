import assert from "node:assert/strict";

import { isMouseInUIRegion } from "../render/render/interact/menu2";

// In the resizable layouts the world shows around the side panel and its tab stones, and a click
// there reaches the world (walk, interact). Whether a point is on the panel is the widgets' call
// (isPointOverWidget); the renderer's static UI region must not swallow the gaps around it.

function resizableHost(root: number, width: number, height: number): any {
    return {
        canvas: { width, height },
        osrsClient: {
            widgetManager: { rootInterface: root },
            getWidgetInteractionState: () => ({ isPointerOverMinimapClickTarget: () => false }),
            camera: { containsScreenPoint: () => true },
        },
    };
}

const cases: Array<{ name: string; root: number; width: number; height: number; x: number; y: number }> = [
    // Modern layout, tabs in one row under the panel: the strip left of the panel and the strip
    // above it.
    { name: "left of the side panel (wide)", root: 161, width: 1874, height: 950, x: 1874 - 215, y: 800 },
    { name: "above the side panel (wide)", root: 161, width: 1874, height: 950, x: 1874 - 100, y: 950 - 37 - 270 },
    // Classic layout, tab stones stacked: the world left of the bottom row of stones.
    { name: "left of the bottom tab row (wide)", root: 164, width: 1274, height: 560, x: 1274 - 300, y: 560 - 12 },
    // Narrow screens put the old box further left and higher.
    { name: "left of the side panel (narrow)", root: 161, width: 874, height: 620, x: 874 - 221, y: 400 },
    { name: "left of the tab rows (narrow)", root: 164, width: 874, height: 620, x: 874 - 235, y: 620 - 40 },
];

for (const c of cases) {
    const host = resizableHost(c.root, c.width, c.height);
    assert.equal(
        isMouseInUIRegion(host, c.x, c.y),
        false,
        `${c.name}: a click at ${c.x},${c.y} on a ${c.width}x${c.height} ${c.root} frame must reach the world`,
    );
}

// The minimap corner keeps its static region in the resizable layouts.
assert.equal(isMouseInUIRegion(resizableHost(161, 1274, 560), 1274 - 100, 80), true);

console.log("Resizable side panel click-through passed:", cases.length, "points");
