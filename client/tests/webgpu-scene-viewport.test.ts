import assert from "node:assert/strict";
import fs from "node:fs";

import { Camera } from "../game/Camera";

// The renderer shares the client shell; only its bundled assets need Node loaders.
require.extensions[".glsl"] = (module, file) => { module.exports = fs.readFileSync(file, "utf8"); };
for (const ext of [".png", ".jpg", ".webp"]) {
    require.extensions[ext] = (module, file) => { module.exports = file; };
}
(globalThis as any).self = globalThis;
const { WebGPURenderer } = require("../render/webgpu/WebGPURenderer");
const { WebgpuUiPresentation } = require("../render/webgpu/ui/presentation");

const noop = () => {};
const renderer = Object.create(WebGPURenderer.prototype);
let loggedIn = true;
let viewport = { x: 354, y: 4, width: 512, height: 334 };
const scissors: number[][] = [];
let scale = 1;
Object.assign(renderer, {
    canvas: { width: 1466, height: 763, style: { clipPath: "" } },
    depthView: {},
    skyColor: [0.5, 0.7, 1, 1],
    context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
    device: {
        createCommandEncoder: () => ({
            beginRenderPass: () => ({
                setScissorRect: (...args: number[]) => scissors.push(args), end: noop,
            }),
            finish: noop,
        }),
        queue: { submit: noop },
    },
    world: { selectExtension: noop, sceneData: new Float32Array(66) },
    osrsClient: {
        isLoggedIn: () => loggedIn,
        camera: new Camera(0, 0, 0, 256, 0),
        inputManager: { wheelDeltaY: 0 },
        playerEcs: { size: () => 0 },
        worldViewManager: { interpolateEntities: noop },
        widgetManager: { rootInterface: 548 },
        roofsHidden: true,
        renderDistance: 25,
        lodDistance: 0,
    },
    mapManager: {
        visibleMaps: [], worldEntityMapIds: new Set(), update: noop, getGridTileBounds: () => undefined,
        getMap: () => undefined, getMapForWorldTile: () => undefined,
    },
    stats: { frameCount: 1 },
    playerPosUni: new Float32Array(2),
    interactionHost: { getRoofPlaneLimit: () => 3 },
    editorOverlays: { draw: noop, encodeCapture: noop },
    worldEntityOverlays: new Map(),
    getSceneViewportWidgetRect: () => viewport,
    computeUiRenderMetrics: () => ({ renderScaleX: scale, renderScaleY: scale }),
    handleInput: noop,
    updateClientTickPhase: noop,
    applyReadyMaps: noop,
    updateSkyColor: noop,
    writeSceneUniforms: noop,
});

const fills: number[][] = [];
const clears: number[][] = [];
const hudCanvas = {
    style: { display: "none" },
    getContext: () => ({
        setTransform: noop,
        fillRect: (...args: number[]) => fills.push(args),
        clearRect: (...args: number[]) => clears.push(args),
    }),
};
const presentation = Object.create(WebgpuUiPresentation.prototype);
Object.assign(presentation, {
    renderer, hudFxCanvas: hudCanvas,
    loadingMessageOverlay: { update: noop, isVisible: () => false },
    systemUpdateOverlay: { update: noop, isVisible: () => false },
});

function render() {
    scissors.length = 0;
    fills.length = 0;
    clears.length = 0;
    renderer.render(1000, 16, false);
    if (loggedIn) presentation.updateHudFx(1000, 16, renderer.canvas.width, renderer.canvas.height);
}

render();
assert.deepEqual(scissors, [[354, 4, 512, 334]], "World geometry stays inside the fixed viewport");
assert.equal(renderer.osrsClient.camera.viewportWidth, 512);
assert.equal(renderer.osrsClient.camera.viewportHeight, 334);
assert.deepEqual(fills, [[0, 0, 1466, 763]], "Sky and post-processing outside the scene are black");
assert.deepEqual(clears.at(-1), [354, 4, 512, 334], "The mask leaves the scene visible");
assert.equal(hudCanvas.style.display, "");
assert.equal(renderer.canvas.style.clipPath, "", "Canvas input must still reach the gameframe controls");

// Hiding widgets still masks the world to its viewport.
renderer.uiHidden = true;
render();
assert.equal(hudCanvas.style.display, "");
renderer.uiHidden = false;

// HiDPI keeps the logical camera size while scaling the same scene/frame rectangle.
scale = 2;
renderer.canvas.width *= 2;
renderer.canvas.height *= 2;
viewport = { x: 708, y: 8, width: 1024, height: 668 };
render();
assert.deepEqual(scissors, [[708, 8, 1024, 668]]);
assert.equal(renderer.osrsClient.camera.computeViewportMetricsForSize(1024, 668).unitViewportHeight, 334);

// Small windows crop the scene without issuing an out-of-bounds WebGPU scissor.
renderer.canvas.width = 400;
renderer.canvas.height = 200;
viewport = { x: 4, y: 4, width: 512, height: 334 };
render();
assert.deepEqual(scissors, [[4, 4, 396, 196]]);

// Returning to a resizable frame fills the canvas and resets the camera's unit scale.
renderer.osrsClient.widgetManager.rootInterface = 161;
viewport = { x: 0, y: 0, width: 400, height: 200 };
render();
assert.deepEqual(scissors, [[0, 0, 400, 200]]);
assert.deepEqual(fills, [], "Resizable mode removes the gutter mask");
assert.equal(hudCanvas.style.display, "none");
assert.equal(renderer.osrsClient.camera.computeViewportMetricsForSize(400, 200).unitViewportHeight, 200);

loggedIn = false;
render();
assert.deepEqual(scissors, [], "Login has no world scissor");
// The editor streams and renders scenery without a logged-in player.
let streamed = 0, worldDraws = 0, overlayDraws = 0, inputs = 0;
renderer.osrsClient.loadedCache = {};
renderer.osrsClient.scenePreviewEnabled = true;
renderer.osrsClient.camera.snapToPosition(3090, -10, 3520);
renderer.mapManager.update = () => streamed++;
renderer.handleInput = () => inputs++;
renderer.mapManager.visibleMaps = [{ canRender: () => true, updateAnimatedLocs: noop,
    drawOpaque: (_pass: unknown, plane: number) => { assert.equal(plane, 1); worldDraws++; }, drawAlpha: noop }];
renderer.interactionHost.getRoofPlaneLimit = () => 1;
renderer.overlays = { update: noop, drawWorld: () => overlayDraws++, drawScreen: () => overlayDraws++ };
render();
assert.equal(streamed, 1, "editor streams map squares while logged out");
assert.equal(inputs, 1, "free-camera input runs during the editor preview");
assert.equal(worldDraws, 1, "WebGPU draws editor scenery at the editor's height limit");
assert.equal(overlayDraws, 2, "editor highlights draw in both overlay passes");
assert.deepEqual(Array.from(renderer.playerPosUni), [3090, 3520], "fog centres on the editor camera");
renderer.osrsClient.scenePreviewEnabled = false;
render();
assert.equal(streamed, 1, "leaving the editor stops logged-out map streaming");
assert.equal(worldDraws, 1, "leaving the editor restores the login surface");
console.log("WebGPU scene viewport and editor preview tests passed");
