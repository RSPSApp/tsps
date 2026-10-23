import assert from "node:assert/strict";

import { Camera } from "../game/Camera";
import { computeRoofPlaneLimit } from "../game/roof/RoofVisibility";
import { TILE_FLAG_UNDER_ROOF } from "../game/scene/TileRenderFlags";
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";
import { Opcodes } from "../rs/cs2/Opcodes";

const camera = new Camera(0, 0, 0, 256, 512);
camera.move(0, 0, -1);
assert.ok(camera.getPosX() > 0.99, "forward should follow the viewed direction");

camera.snapToPosition(0, 0, 0);
camera.move(0, 0, 1, true);
assert.ok(camera.getPosY() < 0, "zooming out should move the camera upward");

camera.snapToPitch(0);
assert.equal(camera.getControlPitchAngle(), 128, "control pitch should retain the player's angle");
camera.setScenePitchOverride(300);
assert.equal(camera.getScenePitchAngle(), 300, "terrain pressure should drive the rendered pitch");
assert.equal(camera.getControlPitchAngle(), 128, "terrain pressure must not alter camera controls");
camera.setScenePitchOverride(undefined);
assert.equal(camera.getScenePitchAngle(), 128, "clearing terrain pressure should restore control pitch");

camera.setViewPitchOverride(-256);
assert.equal(camera.getScenePitchAngle(), -256, "view plugins must support looking upward");
camera.setViewPitchOverride(-0.25);
assert.equal(camera.getScenePitchAngle(), -0.25, "small mouse deltas must accumulate without truncation");
camera.setViewPitchOverride(-600);
assert.equal(camera.getScenePitchAngle(), -480, "close camera can look nearly vertically upward");
camera.setViewPitchOverride(600);
assert.equal(camera.getScenePitchAngle(), 480, "close camera can look nearly vertically downward");
camera.setViewPitchOverride(undefined);
assert.equal(camera.getScenePitchAngle(), 128, "clearing a view override should restore camera controls");

camera.setScenePitchOverride(300.25);
assert.equal(camera.getScenePitchAngle(), 300.25, "terrain pressure and smoothing retain fractional render angles");
camera.setScenePitchOverride(600);
assert.equal(camera.getScenePitchAngle(), 512, "render override limits still apply");
camera.setScenePitchOverride(undefined);

const handlers: HandlerMap = new Map();
registerClientOps(handlers);
const scriptAngles: number[] = [];
const ctx: any = { widgetManager: { osrsClient: { camera } }, pushInt: (value: number) => scriptAngles.push(value) };
camera.snapToPitch(210);
for (let i = 0; i < 20; i++) {
    camera.updatePitch(camera.pitch, 0.2);
    handlers.get(Opcodes.CAM_GETANGLE_XA)!(ctx, 0 as any);
}
assert.ok(scriptAngles.every(Number.isInteger), "native CS2 camera-angle reads remain integers");
assert.equal(new Set(scriptAngles).size, 3, "render precision must not change native angle quantization");

const roofMap = { mapX: 0, mapY: 0, getTileRenderFlag: (_plane: number, x: number, y: number) => x === 0 && y === 0 ? TILE_FLAG_UNDER_ROOF : 0 };
const roofMaps: any = { getMap: () => roofMap, getMapForWorldTile: () => roofMap };
const roofInput = { playerRawPlane: 0, roofsHidden: false,
    cameraTile: { x: 0, y: 0 }, playerTile: { x: 2, y: 2 }, targetTile: { x: 2, y: 2 } };
assert.equal(computeRoofPlaneLimit(roofMaps, 3, { ...roofInput, cameraPitch: 309.75 }), 0);
assert.equal(computeRoofPlaneLimit(roofMaps, 3, { ...roofInput, cameraPitch: 310 }), 3,
    "fractional render angles retain the native roof-hiding threshold");

console.log("camera control orientation ok");
