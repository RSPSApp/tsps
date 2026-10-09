/**
 * Backend-neutral frame configuration for the WebGPU renderer: the effective
 * render distance and the roof plane limit the WebGL renderer computes once per
 * frame before drawing the scene.
 */
import { clamp } from "../../common/utils/MathUtil";
import { isIos, isLowEndDevice, isMobileMode, isTouchDevice } from "../../common/utils/DeviceUtil";
import { computeRoofPlaneLimit } from "../../game/roof/RoofVisibility";
import { resolveBridgePromotedPlane } from "../../game/scene/PlaneResolver";
import { Scene } from "../../rs/scene/Scene";
import {
    DESKTOP_QUALITY_PROFILE,
    IOS_SAFARI_QUALITY_PROFILE,
    MOBILE_TOUCH_QUALITY_PROFILE,
    type BrowserQualityProfile,
} from "../render/constants";
import { getControlledPlayerEcsIndex, getControlledPlayerWorldViewId } from "./camera";
import type { WebGPURenderer } from "./WebGPURenderer";

interface TilePoint {
    x: number;
    y: number;
}

/**
 * Port of resolveEffectiveRenderDistanceTiles (render/render/draw2.ts), which
 * WebGLOsrsRenderer.resolveEffectiveRenderDistanceTiles calls every frame.
 *
 * The WebGL version caches per frame id only to avoid re-running
 * syncBrowserQualityProfile's WebGL scene side effects (activeQualityProfile,
 * fxaa). The tile count itself is a pure function of osrsClient.renderDistance
 * and the platform profile, so this port recomputes it with the same inputs
 * resolveBrowserQualityProfile selects from.
 */
export function resolveWebGPURenderDistance(renderer: WebGPURenderer): number {
    const base = clamp(renderer.osrsClient.renderDistance | 0, 25, 90);
    const profile = resolveQualityProfile();
    const target = isTouchDevice || isLowEndDevice ? Math.min(base, profile.renderDistanceCap | 0) : base;
    return Math.max(0, target | 0);
}

function resolveQualityProfile(): BrowserQualityProfile {
    // Mirrors resolveBrowserQualityProfile (render/render/quality.ts).
    if (!isMobileMode && !isLowEndDevice) {
        return DESKTOP_QUALITY_PROFILE;
    }
    if (isIos) {
        return IOS_SAFARI_QUALITY_PROFILE;
    }
    return MOBILE_TOUCH_QUALITY_PROFILE;
}

/**
 * Port of computeFrameRoofPlaneLimit (render/render/camera/roof.ts).
 *
 * Field substitutions while WebGPURenderer lacks the WebGL host state:
 * - `host.maxLevel` -> Scene.MAX_LEVELS - 1. WebGPU never changes maxLevel and
 *   its map loader builds every square at Scene.MAX_LEVELS - 1.
 * - The deck plane comes from the world view's entity rather than a WebGL overlay record.
 *   The WebGL deck plane is `overlay.basePlane || worldEntityTypeLoader.load(overlay.configId)?.basePlane`,
 *   and the REBUILD_WORLDENTITY payload never carries basePlane (the client
 *   reads `payload.basePlane ?? 0`), so the effective input is the type loader's
 *   basePlane; this port reads that directly.
 */
export function computeWebGPURoofPlaneLimit(renderer: WebGPURenderer): number {
    const cameraTile = getCameraTileXY(renderer);
    const playerTile = getPlayerTileXY(renderer);

    let playerPlane = getPlayerBasePlane(renderer) | 0;
    const worldViewId = getControlledPlayerWorldViewId(renderer);
    if (worldViewId >= 0) {
        const entity = renderer.osrsClient.worldViewManager.getWorldEntity(worldViewId);
        const deckPlane =
            entity && entity.configId >= 0
                ? renderer.osrsClient.worldEntityTypeLoader?.load(entity.configId)?.basePlane
                : 0;
        playerPlane = Math.max(playerPlane, deckPlane || 0);
    }

    return computeRoofPlaneLimit(renderer.mapManager, Scene.MAX_LEVELS - 1, {
        playerRawPlane: playerPlane,
        cameraPitch: renderer.osrsClient.camera.getScenePitchAngle(),
        roofsHidden: renderer.osrsClient.roofsHidden,
        cameraTile,
        playerTile,
        targetTile: renderer.osrsClient.followPlayerCamera ? playerTile : cameraTile,
    });
}

/** Port of getCameraTileXY (render/render/camera/roof.ts). */
function getCameraTileXY(renderer: WebGPURenderer): TilePoint {
    return {
        x: Math.floor(renderer.osrsClient.camera.getPosX()),
        y: Math.floor(renderer.osrsClient.camera.getPosZ()),
    };
}

/** Port of getPlayerTileXY (render/render/camera/roof.ts); camera tile if no player. */
function getPlayerTileXY(renderer: WebGPURenderer): TilePoint {
    const controlledIndex = getControlledPlayerEcsIndex(renderer);
    if (controlledIndex !== undefined) {
        return {
            x: (renderer.osrsClient.playerEcs.getX(controlledIndex) / 128) | 0,
            y: (renderer.osrsClient.playerEcs.getY(controlledIndex) / 128) | 0,
        };
    }
    return getCameraTileXY(renderer);
}

/** Port of getPlayerBasePlane (render/render/camera/roof.ts). */
function getPlayerBasePlane(renderer: WebGPURenderer): number {
    let rawPlane = 0;
    const idx = getControlledPlayerEcsIndex(renderer);
    if (idx !== undefined) {
        rawPlane = renderer.osrsClient.playerEcs.getLevel(idx) | 0;
    }
    return resolveBridgePromotedPlane(renderer.mapManager, rawPlane, getPlayerTileXY(renderer));
}
