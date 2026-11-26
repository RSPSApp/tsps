/**
 * Backend-neutral frame configuration for the WebGPU renderer: the effective
 * render distance and the roof plane limit the WebGL renderer computes once per
 * frame before drawing the scene.
 */
import { syncSceneryDetail } from "../SceneryPolicy";
import { getPerformancePolicy } from "../../game/performance/PerformancePolicy";
import { clamp } from "../../common/utils/MathUtil";
import { ClientState } from "../../game/ClientState";
import { MapManager } from "../../game/MapManager";
import { computeRoofPlaneLimit } from "../../game/roof/RoofVisibility";
import { resolveBridgePromotedPlane } from "../../game/scene/PlaneResolver";
import { Scene } from "../../rs/scene/Scene";
import { getControlledPlayerEcsIndex, getControlledPlayerWorldViewId } from "./camera";
import { projectDeckToWorld } from "../render/worldEntityMotion";
import type { WebGPURenderer } from "./WebGPURenderer";

interface TilePoint {
    x: number;
    y: number;
}

/** Match WebGL's authoritative scene window; orbiting the camera must not reload scenery. */
export function updateWebGPUMapStreaming(renderer: WebGPURenderer, frameCount: number): void {
    const client = renderer.osrsClient;
    const preview = !client.isLoggedIn() && client.scenePreviewEnabled;
    if (!preview && !ClientState.scenePositionReady) return;
    const streamAroundPlayer = preview || getControlledPlayerWorldViewId(renderer) >= 0;
    const distance = resolveWebGPURenderDistance(renderer);
    const padding = MapManager.getSceneryPadding(distance);
    renderer.mapManager.update(
        preview ? client.camera.getPosX() : renderer.playerPosUni[0],
        preview ? client.camera.getPosZ() : renderer.playerPosUni[1],
        client.camera,
        frameCount,
        Math.max(client.mapRadius, Math.ceil((distance + 32) / 64)),
        streamAroundPlayer ? -1 : ClientState.baseX | 0,
        streamAroundPlayer ? -1 : ClientState.baseY | 0,
        Math.max(client.expandedMapLoading | 0, padding),
        distance,
    );
    syncSceneryDetail(renderer);
}

/**
 * Port of resolveEffectiveRenderDistanceTiles (render/render/draw2.ts), which
 * WebGLOsrsRenderer.resolveEffectiveRenderDistanceTiles calls every frame.
 *
 * The WebGL version caches per frame id only to avoid re-running
 * syncBrowserQualityProfile's WebGL scene side effects (activeQualityProfile,
 * fxaa). The tile count itself is a pure function of osrsClient.renderDistance
 * and the saved Performance preset / explicit overrides.
 */
export function resolveWebGPURenderDistance(renderer: WebGPURenderer): number {
    const editorDistance = renderer.osrsClient.editorRenderDistance;
    if (editorDistance !== undefined) return editorDistance;
    const scenery = renderer.osrsClient.clientPlugins.scenerySettings?.();
    if (scenery) return clamp(scenery.drawDistance | 0, 25, 1024);
    const gpu = renderer.osrsClient.clientPlugins.gpuSettings();
    const base = clamp((gpu?.drawDistance ?? renderer.osrsClient.renderDistance) | 0, 25,
        renderer.osrsClient.clientPlugins.hdEnabled() ? 160 : 90);
    const policy = getPerformancePolicy();
    if (policy.explicitDrawDistance !== null) {
        return clamp(policy.explicitDrawDistance, 25,
            renderer.osrsClient.clientPlugins.hdEnabled() ? 160 : 90);
    }
    const capToProfile = gpu ? gpu.overrideDeviceCaps === false : true;
    const target = capToProfile ? Math.min(base, policy.drawDistanceCap) : base;
    return Math.max(0, target | 0);
}

/** Same full-detail radius and device caps as WebGL's resolveEffectiveLodThresholdTiles. */
export function resolveWebGPULodDistance(renderer: WebGPURenderer): number {
    const distance = resolveWebGPURenderDistance(renderer);
    const scenery = renderer.osrsClient.clientPlugins.scenerySettings?.();
    if (scenery) return Math.min(distance, scenery.detailDistance);
    const gpu = renderer.osrsClient.clientPlugins.gpuSettings();
    const base = clamp(gpu ? gpu.drawDistance - 2 : renderer.osrsClient.lodDistance | 0, 0,
        Math.min(distance, renderer.osrsClient.clientPlugins.hdEnabled() ? 48 : distance));
    const policy = getPerformancePolicy();
    if (policy.explicitDrawDistance !== null) {
        const hdCap = renderer.osrsClient.clientPlugins.hdEnabled() ? 48 : distance;
        return Math.max(0, Math.min(distance, hdCap, policy.explicitDrawDistance - 2));
    }
    const capToProfile = gpu ? gpu.overrideDeviceCaps === false : true;
    return capToProfile ? Math.min(base, policy.lodThresholdCap) : base;
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
    const playerTile = roofPlayerTile(renderer, getPlayerTileXY(renderer));

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

    // A plugin camera far from the player (Isometric Camera) can steady the roof line.
    const roofCameraTile =
        renderer.osrsClient.clientPlugins?.roofCameraTile?.(cameraTile, playerTile) ?? cameraTile;
    return computeRoofPlaneLimit(renderer.mapManager, Scene.MAX_LEVELS - 1, {
        playerRawPlane: playerPlane,
        cameraPitch: renderer.osrsClient.camera.getScenePitchAngle(),
        roofsHidden: renderer.osrsClient.roofsHidden,
        cameraTile: roofCameraTile,
        playerTile,
        targetTile: renderer.osrsClient.followPlayerCamera ? playerTile : cameraTile,
    });
}

/**
 * The player's tile for the roof checks: aboard a boat, where the deck is drawn in the world.
 * The deck tile itself is thousands of tiles from the camera, and the line between them
 * looked up every tile's roof flag in every loaded map, every frame.
 */
function roofPlayerTile(renderer: WebGPURenderer, playerTile: TilePoint): TilePoint {
    const worldViewId = getControlledPlayerWorldViewId(renderer);
    const index = getControlledPlayerEcsIndex(renderer);
    if (worldViewId < 0 || index === undefined || renderer.osrsClient.getCameraTargetPosition()) return playerTile;
    const projected = projectDeckToWorld(renderer, worldViewId,
        renderer.osrsClient.playerEcs.getX(index), renderer.osrsClient.playerEcs.getY(index));
    return projected ? { x: (projected.x / 128) | 0, y: (projected.y / 128) | 0 } : playerTile;
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
    // A camera target (a spectator's) stands in for the player.
    const cameraTarget = renderer.osrsClient.getCameraTargetPosition();
    if (cameraTarget) return { x: (cameraTarget.x / 128) | 0, y: (cameraTarget.y / 128) | 0 };
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
    const cameraTarget = renderer.osrsClient.getCameraTargetPosition();
    if (cameraTarget) {
        rawPlane = cameraTarget.level;
    } else if (idx !== undefined) {
        rawPlane = renderer.osrsClient.playerEcs.getLevel(idx) | 0;
    }
    return resolveBridgePromotedPlane(renderer.mapManager, rawPlane, getPlayerTileXY(renderer));
}
