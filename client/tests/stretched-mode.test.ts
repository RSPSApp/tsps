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

// Saved interface scaling and Stretched Mode must leave enough layout space for the gameframe.
(globalThis as any).self = globalThis;
for (const ext of [".glsl", ".wgsl", ".css", ".png", ".jpg", ".webp", ".wasm", ".cs2"]) {
    require.extensions[ext] = (module) => { module.exports = ""; };
}
const { computeUiRenderMetrics } = require("../render/render/quality");
const { getUiScale, setUiScale } = require("../ui/UiScale");
const { GameState } = require("../game/login");
try {
    for (const [cssW, cssH] of [[1472, 763], [1089, 763], [800, 600], [1920, 1080], [700, 400]]) {
      for (const dpr of [1, 2]) for (const scale of [1, 1.5, 4]) for (const factor of [1, 1.5]) {
        setUiScale(scale);
        const host = {
            osrsClient: {
                gameState: GameState.LOGGED_IN,
                isOnLoginScreen: () => false,
                widgetManager: { rootInterface: 161 },
                clientPlugins: { resizableScale: (value: number) => value * factor, fixedStretch: () => null },
            },
            getUiSurfaceCssSize: () => ({ cssW, cssH }),
        };
        for (const root of [161, 164, 378, 548]) {
            host.osrsClient.widgetManager.rootInterface = root;
            const metrics = computeUiRenderMetrics(host, cssW * dpr, cssH * dpr);
            assert.ok(metrics.layoutW >= Math.min(765, cssW), `root ${root} leaves room for the gameframe width`);
            assert.ok(metrics.layoutH >= Math.min(503, cssH), `root ${root} leaves room for the gameframe height`);
            assert.ok(metrics.renderScaleX >= dpr, "desktop widgets never shrink below native size");
            assert.ok(metrics.renderScaleX <= scale * factor * dpr, "fitting never adds zoom");
            if (scale === 1 && factor === 1) assert.equal(metrics.renderScaleX, dpr, "default scaling stays native");
            if (cssW === 1920 && scale === 1.5 && factor === 1 && root !== 548) {
                assert.equal(metrics.renderScaleX, 1.5 * dpr, "a chosen scale is honored when it fits");
            }
        }
        assert.equal(getUiScale(), scale, "viewport fitting does not overwrite the saved setting");
      }
    }
} finally {
    setUiScale(null);
}

console.log("Stretched mode and welcome screen scaling tests passed");

// Native mobile login (4618, called by toplevel_init) replaces a scale below 175% with 400%.
const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { getOsrsInterfaceScalingPercent, setOsrsInterfaceScalingPercent } = require("../ui/UiScale");
const native = createCacheVm();
const writes: number[] = [];
native.vm.context.widgetManager.rootInterface = 601;
native.vm.context.getDeviceOption = (id: number) => id === 27
    ? getOsrsInterfaceScalingPercent(native.vm.context.widgetManager.rootInterface === 601 || native.vm.context.varManager.getVarbit(6352) === 1) : 0;
native.vm.context.setDeviceOption = (id: number, value: number) => {
    if (id !== 27) return;
    writes.push(value);
    setOsrsInterfaceScalingPercent(value);
};
try {
    for (const saved of [100, 125, 150, 175, 200, 400]) {
        setOsrsInterfaceScalingPercent(saved);
        writes.length = 0;
        native.vm.execute(native.scripts.load(4618));
        assert.deepEqual(writes, [], "mobile startup must not overwrite the saved desktop preference");
        assert.equal(getOsrsInterfaceScalingPercent(), saved);
        assert.equal(getOsrsInterfaceScalingPercent(true), Math.max(175, saved));
    }
    setOsrsInterfaceScalingPercent(400);
    native.vm.context.widgetManager.rootInterface = 161;
    native.vm.execute(native.scripts.load(3054), [0, 0]); // Settings: select the 100% dropdown entry.
    assert.equal(getOsrsInterfaceScalingPercent(), 100);
    for (const root of [161, 601, 161]) {
        native.vm.context.widgetManager.rootInterface = root;
        native.vm.execute(native.scripts.load(4618));
        assert.equal(getOsrsInterfaceScalingPercent(), 100, "the Settings choice survives desktop/mobile login initialization");
    }
} finally {
    setUiScale(null);
}
