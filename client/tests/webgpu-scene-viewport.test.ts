import assert from "node:assert/strict";
import fs from "node:fs";

import { Camera } from "../game/Camera";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { processWidgetScrollWheelInput } from "../game/widgets/input/widgetScrollWheelInput";

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
        clientPlugins: new ClientPluginManager(),
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
    cameraShakeEnabled: Array(5).fill(false),
    cameraShakeRandomAmplitude: Array(5).fill(0),
    cameraShakeWaveAmplitude: Array(5).fill(0),
    cameraShakeWaveSpeed: Array(5).fill(0),
    cameraShakeWavePhase: Array(5).fill(0),
    cameraShakeLastClientCycle: -1,
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

renderer.osrsClient.followPlayerCamera = false;
renderer.osrsClient.camera.setScriptedPosition(10, 0, 0, 6, 0);
renderer.render(1020, 20, false);
assert.equal(renderer.osrsClient.camera.getPosX(), 6 / 128, "WebGPU advances captured camera rates while player following is disabled");
renderer.osrsClient.camera.clearScriptedCamera();

const camera = renderer.osrsClient.camera;
camera.setScriptedPosition(10, 0, 0, 6, 0);
camera.setViewPitchOverride(200);
const beforeShake = [...camera.pos], beforeYaw = camera.yaw;
let shaken: { x: number; pitch: number } | undefined;
renderer.mapManager.visibleMaps.push({
    canRender: () => true,
    updateAnimatedLocs: noop,
    drawOpaque: () => { shaken = { x: camera.getPosX(), pitch: camera.getScenePitchAngle() }; },
    drawAlpha: noop,
});
renderer.setCameraShakeSlot(0, 0, 128, 100, 1);
renderer.setCameraShakeSlot(4, 0, 20, 100, 1);
render();
assert.ok(shaken && shaken.x > beforeShake[0], "WebGPU applies positional camera shake while drawing scenery");
assert.ok(shaken && shaken.pitch > 200, "pitch shake affects scripted view overrides");
assert.deepEqual([...camera.pos], beforeShake, "shake does not accumulate into the next frame's camera position");
assert.equal(camera.yaw, beforeYaw);
assert.equal(camera.getViewPitchOverride(), 200, "the baseline view angle is restored for overlays");
renderer.clearCameraShake();
assert.equal(renderer.computeCameraShakeOffsets(1).active, false, "camera reset can clear WebGPU shake slots");
renderer.mapManager.visibleMaps.length = 0;
camera.applySmoothing(4);
assert.equal(camera.getPosX(), beforeShake[0] + 6 / 128, "render shake leaves the unfinished movement target intact");
camera.clearScriptedCamera();
camera.setScriptedPitchUnlocked(true);
camera.setScriptedLook(camera.getPosX(), camera.getPosY() + 10, camera.getPosZ(), 232, 232);
const verticalPitch = camera.getScenePitchAngle();
assert.equal(verticalPitch, 511);
renderer.setCameraShakeSlot(4, 0, 20, 100, 1);
const restoreVertical = renderer.applyCameraShake(1);
assert.ok(restoreVertical);
assert.equal(camera.getScenePitchAngle(), 383, "rendered pitch shake keeps its OSRS clamp");
restoreVertical();
assert.equal(camera.getScenePitchAngle(), verticalPitch, "restoration preserves unlocked scripted pitch beyond the first-person clamp");
renderer.clearCameraShake();
camera.clearScriptedCamera();

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
// Exercise the actual WebGPU render ordering: Settings consumes wheel during handleInput,
// before HD follows the player. Capturing raw wheel before this boundary zooms through modals.
loggedIn = true;
renderer.mapManager.visibleMaps = [];
renderer.osrsClient.followPlayerCamera = true;
renderer.osrsClient.camera.setViewPitchOverride(undefined);
renderer.osrsClient.clientPlugins.hdEnabled = () => true;
const wheelInput: any = { wheelDeltaY: 120, viewportWheelDeltaY: 0, mouseX: 100, mouseY: 100 };
renderer.osrsClient.inputManager = wheelInput;
let handler = 36;
renderer.handleInput = () => processWidgetScrollWheelInput(
    { getCs2Vm: () => ({ invokeEventHandler: noop }) } as any,
    { input: wheelInput, mx: 100, hits: [{ uid: 2, eventHandlers: { onScroll: { scriptId: handler } } }] } as any,
    { isEffectivelyHidden: () => false } as any,
    { isDraggingWidget: false } as any,
);
renderer.followCamWheel = 0;
render();
assert.equal(wheelInput.wheelDeltaY, 0, "Settings owns the native wheel");
assert.equal(renderer.followCamWheel, 0, "WebGPU HD must not capture wheel before Settings consumes it");
handler = 39;
wheelInput.wheelDeltaY = 120;
render();
assert.equal(renderer.followCamWheel, 120, "native viewport zoom still forwards the original delta to HD");
renderer.followCamWheel = 0;
renderer.osrsClient.camera.setViewPitchOverride(200);
wheelInput.wheelDeltaY = 120;
wheelInput.viewportWheelDeltaY = 0;
render();
assert.equal(renderer.followCamWheel, 0, "close camera never accumulates a stale HD wheel delta");
console.log("WebGPU scene viewport and editor preview tests passed");
