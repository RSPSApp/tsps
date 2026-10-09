import { mat4, vec3 } from "gl-matrix";

import { clamp } from "../../common/utils/MathUtil";
import { getClientCycle } from "../../network/ServerConnection";
import { RS_TO_RADIANS } from "../../rs/MathConstants";
import { ProjectionType } from "../../game/Camera";
import { sampleBridgeHeightForWorldTile } from "../../game/scene/BridgeHeightSampler";
import { BridgePlaneStrategy } from "../../game/scene/PlaneResolver";
import { LoadingRequirement } from "../../game/state/LoadingTracker";
import { projectDeckToWorld } from "../render/worldEntityMotion";
import type { WebGPURenderer } from "./WebGPURenderer";

// 117 HD follow-camera feel. The zoom multiplier is applied to the follow distance, so it is
// multiplicative: each wheel notch scales the current zoom by exp(delta * rate). Positive
// wheelDeltaY is wheel-down (zoom out), matching InputManager's pinch merge.
const FOLLOW_CAM_ZOOM_WHEEL_RATE = 0.0015;
const FOLLOW_CAM_ZOOM_MIN = 0.55;
const FOLLOW_CAM_ZOOM_MAX = 1.6;
const FOLLOW_CAM_ZOOM_EASE_RATE = 8;
const FOLLOW_CAM_ROT_EASE_RATE = 10;
/** Raw yaw movement above this in one frame is a teleport/script, not input: snap, don't ease. */
const FOLLOW_CAM_YAW_SNAP = 180;

/** Wraps RS yaw (0..2048 units) like Camera's private wrapYawInternal. */
export function wrapYaw(yaw: number): number {
    return ((yaw % 2048) + 2048) % 2048;
}

/** Signed shortest rotation from `from` to `to` in RS yaw units, in [-1024, 1024]. */
export function shortestYawDelta(to: number, from: number): number {
    const delta = wrapYaw(to - from);
    return delta > 1024 ? delta - 2048 : delta;
}

/**
 * Port of the controlled-player lookup in render/render/camera/roof.ts. Reads only
 * OsrsClient state, so it is backend-neutral.
 */
export function getControlledPlayerEcsIndex(renderer: WebGPURenderer): number | undefined {
    const playerEcs = renderer.osrsClient.playerEcs;
    const controlledServerId = renderer.osrsClient.controlledPlayerServerId | 0;

    if (controlledServerId > 0) {
        try {
            const controlledIndex = playerEcs.getIndexForServerId(controlledServerId);
            if (controlledIndex !== undefined) {
                return controlledIndex | 0;
            }
        } catch {}
    }

    try {
        const size = playerEcs.size?.() ?? 0;
        if (size > 0) {
            return 0;
        }
    } catch {}

    return undefined;
}

/**
 * The world view (boat) the controlled player stands in, or -1 (port of
 * getControlledPlayerWorldViewId in render/render/camera/roof.ts).
 */
export function getControlledPlayerWorldViewId(renderer: WebGPURenderer): number {
    const idx = getControlledPlayerEcsIndex(renderer);
    return idx !== undefined ? renderer.osrsClient.playerEcs.getWorldViewId(idx) | 0 : -1;
}

/**
 * Port of updateCameraFollow (render/render/camera2.ts), including the world-entity deck
 * projection. Terrain pitch pressure is not modelled. Follow focal smoothing and the orbit
 * are identical so the camera tracks the player the same way WebGL does.
 */
export function updateFollowCamera(
    renderer: WebGPURenderer,
    timeSec: number,
    deltaTimeMs: number = 0,
): void {
    const osrsClient = renderer.osrsClient;
    const playerEcs = osrsClient.playerEcs;
    const playerEcsIndex = getControlledPlayerEcsIndex(renderer);
    if (playerEcsIndex === undefined) return;

    let px = playerEcs.getX(playerEcsIndex) | 0;
    let py = playerEcs.getY(playerEcsIndex) | 0;
    // On a boat the player stands in deck coordinates; follow where the deck is drawn.
    const worldViewId = getControlledPlayerWorldViewId(renderer);
    if (worldViewId >= 0) {
        const projected = projectDeckToWorld(renderer, worldViewId, px, py);
        if (!projected) return; // not placed yet: keep the camera where it is
        px = Math.round(projected.x);
        py = Math.round(projected.y);
    }
    const playerX = px / 128;
    const playerZ = py / 128;

    renderer.playerPosUni[0] = playerX;
    renderer.playerPosUni[1] = playerZ;
    // Scripted camera moves (and free cameras) turn following off, as in WebGL's frame loop.
    if (!osrsClient.followPlayerCamera) return;

    const clientCycle = getClientCycle() | 0;
    const targetSubX = px;
    const targetSubZ = py;

    if (!renderer.followCamFocalInitialized || renderer.followCamFocalLastClientCycle < 0) {
        renderer.followCamFocalXSub = targetSubX;
        renderer.followCamFocalZSub = targetSubZ;
        renderer.followCamFocalLastClientCycle = clientCycle;
        renderer.followCamFocalInitialized = true;
    } else {
        const cyclesElapsed = (clientCycle - renderer.followCamFocalLastClientCycle) | 0;
        if (cyclesElapsed < 0 || cyclesElapsed > 32) {
            renderer.followCamFocalXSub = targetSubX;
            renderer.followCamFocalZSub = targetSubZ;
            renderer.followCamFocalLastClientCycle = clientCycle;
        } else if (cyclesElapsed > 0) {
            for (let i = 0; i < cyclesElapsed; i++) {
                const dxFocal = targetSubX - renderer.followCamFocalXSub;
                const dzFocal = targetSubZ - renderer.followCamFocalZSub;
                if (dxFocal < -500 || dxFocal > 500 || dzFocal < -500 || dzFocal > 500) {
                    renderer.followCamFocalXSub = targetSubX;
                    renderer.followCamFocalZSub = targetSubZ;
                } else {
                    if (dxFocal !== 0) {
                        renderer.followCamFocalXSub += (dxFocal / 16) | 0;
                    }
                    if (dzFocal !== 0) {
                        renderer.followCamFocalZSub += (dzFocal / 16) | 0;
                    }
                }
            }
            renderer.followCamFocalLastClientCycle = clientCycle;
        }
    }

    const targetX = renderer.followCamFocalXSub / 128;
    const targetZ = renderer.followCamFocalZSub / 128;
    const basePlane = playerEcs.getLevel(playerEcsIndex) | 0;

    const playerHeightSample = sampleBridgeHeightForWorldTile(
        renderer.mapManager,
        playerX,
        playerZ,
        basePlane,
        BridgePlaneStrategy.RENDER,
    );

    const camera = osrsClient.camera;
    // A plugin camera (the backquote third-person view) places the camera itself.
    if (
        osrsClient.clientPlugins.handleCameraFollow({
            camera,
            playerX,
            playerY: playerHeightSample.valid ? playerHeightSample.height : undefined,
            playerZ,
            plane: basePlane,
            groundHeightAt: (x, z) => {
                const sample = sampleBridgeHeightForWorldTile(renderer.mapManager, x, z, basePlane,
                    BridgePlaneStrategy.RENDER);
                return sample.valid ? sample.height : undefined;
            },
            collisionFlagAt: (plane, tileX, tileY) => renderer.getCollisionFlagAt(plane, tileX, tileY),
        })
    ) {
        // Leaving the plugin view must not swoop the HD camera from stale smoothed angles.
        renderer.followCamCameraFeelInitialized = false;
        renderer.followCamDistance = Math.hypot(camera.getPosX() - playerX, camera.getPosZ() - playerZ);
        if (playerHeightSample.valid) markMapDataLoaded(renderer, timeSec);
        return;
    }
    // 117 HD camera feel. Without the plugin (and in first person, whose view pitch override
    // drives the view, or in ortho) this stays exactly as before: raw pitch override, raw yaw
    // and an unscaled follow distance.
    const hdCameraFeel =
        osrsClient.hdPlugin?.isEnabled() === true &&
        camera.getViewPitchOverride() === undefined &&
        camera.projectionType === ProjectionType.PERSPECTIVE;
    const dtSec = Math.max(0, deltaTimeMs) / 1000;

    if (hdCameraFeel) {
        // Eased zoom: the wheel moves a target multiplier, the current value chases it with
        // frame-rate independent exponential smoothing. WebGPURenderer captured the wheel
        // while the pointer was over the scene, before the viewport widget consumed it.
        if (renderer.followCamWheel !== 0) {
            renderer.followCamZoomTarget = clamp(
                renderer.followCamZoomTarget *
                    Math.exp(renderer.followCamWheel * FOLLOW_CAM_ZOOM_WHEEL_RATE),
                FOLLOW_CAM_ZOOM_MIN,
                FOLLOW_CAM_ZOOM_MAX,
            );
            renderer.followCamWheel = 0;
        }
        renderer.followCamZoom +=
            (renderer.followCamZoomTarget - renderer.followCamZoom) *
            (1 - Math.exp(-dtSec * FOLLOW_CAM_ZOOM_EASE_RATE));

        // Eased rotation: pitch and yaw chase the raw control values. Mouse/keyboard deltas are
        // applied to camera.yaw/pitch before this runs, so the input delta is recovered against
        // the view value written last frame and accumulated separately; the view then lags and
        // coasts after release without scaling the input speed down.
        const rawYaw = camera.yaw;
        const rawPitch = camera.getControlPitchAngle();
        const rotEase = 1 - Math.exp(-dtSec * FOLLOW_CAM_ROT_EASE_RATE);
        if (!renderer.followCamCameraFeelInitialized) {
            // First HD frame: start on the raw values, no swoop on login or plugin toggle.
            renderer.followCamRawYaw = rawYaw;
            renderer.followCamSmoothedYaw = rawYaw;
            renderer.followCamSmoothedPitch = rawPitch;
            renderer.followCamCameraFeelInitialized = true;
        } else {
            const inputDelta = shortestYawDelta(rawYaw, renderer.followCamSmoothedYaw);
            if (Math.abs(inputDelta) > FOLLOW_CAM_YAW_SNAP) {
                // Teleport or scripted camera: snap to avoid spinning through the short way.
                renderer.followCamRawYaw = rawYaw;
                renderer.followCamSmoothedYaw = rawYaw;
            } else {
                renderer.followCamRawYaw = wrapYaw(renderer.followCamRawYaw + inputDelta);
                renderer.followCamSmoothedYaw = wrapYaw(
                    renderer.followCamSmoothedYaw +
                        shortestYawDelta(renderer.followCamRawYaw, renderer.followCamSmoothedYaw) * rotEase,
                );
            }
            renderer.followCamSmoothedPitch += (rawPitch - renderer.followCamSmoothedPitch) * rotEase;
        }
        // update() reads camera.yaw, and updateYaw derives from targetYaw, so both must carry
        // the smoothed value (setTargetYaw is the public writer for the private targetYaw).
        camera.yaw = renderer.followCamSmoothedYaw;
        camera.setTargetYaw(renderer.followCamSmoothedYaw);
        camera.setScenePitchOverride(renderer.followCamSmoothedPitch);
    } else {
        renderer.followCamZoom = 1;
        renderer.followCamZoomTarget = 1;
        renderer.followCamWheel = 0;
        renderer.followCamCameraFeelInitialized = false;
        camera.setScenePitchOverride(camera.getControlPitchAngle());
    }

    const viewportWidth = renderer.canvas.width || 1;
    const viewportHeight = renderer.canvas.height || 1;
    const { viewportHeight: effectiveViewportHeight } = camera.computeViewportMetricsForSize(
        viewportWidth,
        viewportHeight,
    );

    const v = clamp(effectiveViewportHeight - 334, 0, 100);
    const zoom =
        (osrsClient.zoomWidth - osrsClient.zoomHeight) * (v / 100) + osrsClient.zoomHeight;
    const camAngleX = hdCameraFeel ? camera.getScenePitchAngle() : camera.getControlPitchAngle();

    const yawRad = (camera.yaw - 1024) * RS_TO_RADIANS;
    const pitchRad = -camAngleX * RS_TO_RADIANS;

    const rot = renderer.followCamRot;
    mat4.identity(rot);
    mat4.rotateY(rot, rot, yawRad);
    mat4.rotateZ(rot, rot, Math.PI);
    mat4.rotateX(rot, rot, pitchRad);

    const forward = renderer.followCamForward;
    vec3.transformMat4(forward, renderer.followCamForwardAxis, rot);
    vec3.normalize(forward, forward);

    const baseRadius = 600 + 3 * camAngleX;
    const radius = (baseRadius * zoom * renderer.followCamZoom) / 256;
    const dist = radius / 128;
    // The DOF pass focuses on this camera-to-focal distance.
    renderer.followCamDistance = dist;
    let desiredPosX = targetX - forward[0] * dist;
    let desiredPosZ = targetZ - forward[2] * dist;
    desiredPosX = Math.round(desiredPosX * 128) / 128;
    desiredPosZ = Math.round(desiredPosZ * 128) / 128;
    camera.snapToPosition(desiredPosX, undefined, desiredPosZ);

    if (!playerHeightSample.valid) {
        return;
    }

    markMapDataLoaded(renderer, timeSec);

    const focusHeightTiles = (osrsClient.camFollowHeight | 0) / 128.0;
    const targetY = playerHeightSample.height - focusHeightTiles;
    const desiredPosY = Math.round((targetY - forward[1] * dist) * 128) / 128;
    camera.snapToPosition(undefined, desiredPosY, undefined);
}

/** Map data counts as loaded once the player's ground height has been valid for a second. */
function markMapDataLoaded(renderer: WebGPURenderer, timeSec: number): void {
    if (renderer.mapDataLoadedNotified) return;
    if (renderer.heightValidAtTime === undefined) {
        renderer.heightValidAtTime = timeSec;
    } else if (timeSec - renderer.heightValidAtTime >= 1.0) {
        renderer.mapDataLoadedNotified = true;
        renderer.osrsClient.loadingTracker.markComplete(LoadingRequirement.MAP_DATA_LOADED);
    }
}
