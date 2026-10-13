import assert from "node:assert/strict";
import { Camera } from "../game/Camera";
import { computeFixedStretch, computeResizableScale } from "../game/plugins/stretchedmode/StretchedModePlugin";

// 1920x1080 at DPR 1: the fixed frame fits by height (1080 / 503 = 2.147).
const fit = computeFixedStretch(1920, 1080, 1, true, false);
assert.equal(fit.scaleX, fit.scaleY, "keeping the aspect ratio scales both axes alike");
assert.ok(Math.abs(fit.scaleY - 1080 / 503) < 1e-9, "fits the window height");
assert.equal(fit.offsetY, 0, "no bars above and below when the height fits");
assert.equal(fit.offsetX, Math.floor((1920 - 765 * fit.scaleX) / 2), "centred horizontally");

// Integer scaling rounds down to a whole number and centres both ways.
const whole = computeFixedStretch(1920, 1080, 1, true, true);
assert.deepEqual(whole, { scaleX: 2, scaleY: 2, offsetX: 195, offsetY: 37 });

// Without the aspect ratio, each axis fills the window.
const fill = computeFixedStretch(1920, 1080, 1, false, false);
assert.ok(Math.abs(fill.scaleX - 1920 / 765) < 1e-9 && Math.abs(fill.scaleY - 1080 / 503) < 1e-9);
assert.equal(fill.offsetX, 0);
assert.equal(fill.offsetY, 0);

// A window smaller than the frame never shrinks it below the unstretched scale.
assert.deepEqual(computeFixedStretch(700, 400, 1, true, true), { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
assert.equal(computeFixedStretch(1600, 1100, 2, true, true).scaleX, 2, "the device-pixel ratio is the floor");

// Resizable scaling grows the in-game interface scale (RuneLite's 50% is 1.5x)...
assert.equal(computeResizableScale(1, 1.5, 1920, 1080), 1.5);
assert.equal(computeResizableScale(1.25, 1.5, 2560, 1440), 1.875, "on top of Interface scaling");
// ...but not past where the layout would be smaller than the fixed gameframe...
assert.ok(Math.abs(computeResizableScale(1, 3, 1920, 1080) - 1080 / 503) < 1e-9);
// ...and never below the in-game scale.
assert.equal(computeResizableScale(1.5, 1.5, 800, 600), 1.5);

// The camera applies OSRS's viewport rules to fixed mode's 512x334 units: a stretched
// viewport shows the same scene, scaled, not a zoomed-out one.
function viewport(unitX: number, unitY: number) {
    const camera = new Camera(0, 0, 0, 0, 0);
    camera.setViewportUnitScale(unitX, unitY);
    camera.update(765 * unitX, 503 * unitY, 4 * unitX, 4 * unitY, 512 * unitX, 334 * unitY);
    return camera;
}
function assertSameProjection(a: Camera, b: Camera, message: string) {
    a.projectionMatrix.forEach((value, i) =>
        assert.ok(Math.abs(value - b.projectionMatrix[i]) < 1e-3, `${message} (element ${i})`),
    );
}
const base = viewport(1, 1);
const doubled = viewport(2, 2);
assert.equal(doubled.viewportWidth, base.viewportWidth * 2);
assert.equal(doubled.viewportHeight, base.viewportHeight * 2);
assert.equal(doubled.viewportZoom, base.viewportZoom * 2, "zoom scales with the viewport");
assertSameProjection(doubled, base, "same field of view");
assert.equal(
    doubled.computeViewportMetricsForSize(1024, 668).unitViewportHeight,
    334,
    "the follow camera sees fixed mode's 334-unit height",
);

// Stretched unevenly, the projection keeps the 512x334 shape and the image stretches.
const uneven = viewport(2.5, 2);
assertSameProjection(uneven, base, "same projection shape");
assert.equal(uneven.viewportWidth, 1280);

console.log("Stretched mode tests passed");
