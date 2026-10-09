import { mat4, vec3 } from "gl-matrix";

import type { OsrsClient } from "../../game/OsrsClient";
import type { WorldEntityAnimator } from "../WorldEntityAnimator";
import type { WebGLOsrsRendererHost } from "./hostInterface";

const FINE_UNITS_PER_TILE = 128;

/**
 * The host surface these helpers need, shared by the WebGL and WebGPU renderers: the animator
 * placing decks and the overlay records keyed by entity index (see WebGLOsrsRenderer for the
 * WebGL host, client/render/webgpu/worldEntity.ts for the WebGPU one).
 */
export interface WorldEntityMotionHost {
    worldEntityAnimator?: WorldEntityAnimator;
    worldEntityOverlays: Map<number, { configId: number; regionX: number; regionY: number; sizeX: number; sizeZ: number }>;
    osrsClient: OsrsClient;
}
const RS_ANGLE_TO_RADIANS = Math.PI / 1024;
const scratchTranslation = vec3.create();
const scratchPoint = vec3.create();

/**
 * Places each world entity's deck scene in the world for this frame.
 *
 * A deck scene is built in its own coordinates (the server gives each boat a deck region).
 * The entity's synced position is where the deck centre sits in the world, and its angle
 * rotates the deck about that centre (0 = template orientation, 512 = a quarter turn
 * clockwise seen from above). Call after `WorldViewManager.interpolateEntities`.
 */
export function updateWorldEntityMotion(host: WorldEntityMotionHost): void {
    const animator = host.worldEntityAnimator;
    if (!animator) return;
    const worldViews = host.osrsClient.worldViewManager;
    for (const [entityIndex, overlay] of host.worldEntityOverlays) {
        const entity = worldViews.getWorldEntity(entityIndex);
        if (!entity?.hasPosition) {
            animator.setMovement(entityIndex, undefined);
            continue;
        }
        const type =
            overlay.configId >= 0
                ? host.osrsClient.worldEntityTypeLoader?.load(overlay.configId)
                : undefined;
        const centreX =
            overlay.regionX * 8 + (overlay.sizeX * 64 + (type?.baseXOffset ?? 0)) / FINE_UNITS_PER_TILE;
        const centreY =
            overlay.regionY * 8 + (overlay.sizeZ * 64 + (type?.baseYOffset ?? 0)) / FINE_UNITS_PER_TILE;

        const m = animator.getMovement(entityIndex) ?? (mat4.create() as Float32Array);
        const { x, z, orientation } = entity.position;
        mat4.fromTranslation(
            m,
            vec3.set(scratchTranslation, x / FINE_UNITS_PER_TILE, 0, z / FINE_UNITS_PER_TILE),
        );
        // World x = tile x, world z = tile y; rotateY maps (x, z) to
        // (x cos + z sin, z cos - x sin), matching the server's heading convention.
        mat4.rotateY(m, m, (orientation & 2047) * RS_ANGLE_TO_RADIANS);
        mat4.translate(m, m, vec3.set(scratchTranslation, -centreX, 0, -centreY));
        animator.setMovement(entityIndex, m);
    }
}

/**
 * Maps a fine position in an entity's deck scene to world fine units, or undefined when the
 * entity isn't placed yet.
 */
export function projectDeckToWorld(
    host: Pick<WorldEntityMotionHost, "worldEntityAnimator">,
    entityIndex: number,
    fineX: number,
    fineY: number,
): { x: number; y: number } | undefined {
    const m = host.worldEntityAnimator?.getMovement(entityIndex);
    if (!m) return undefined;
    vec3.set(scratchPoint, fineX / FINE_UNITS_PER_TILE, 0, fineY / FINE_UNITS_PER_TILE);
    vec3.transformMat4(scratchPoint, scratchPoint, m);
    return { x: scratchPoint[0] * FINE_UNITS_PER_TILE, y: scratchPoint[2] * FINE_UNITS_PER_TILE };
}

/**
 * Where a screen position points on the sea around a boat, in world fine units. Intersects
 * the mouse ray with the water surface at the boat's position, so it doesn't depend on
 * picking tiles in the boat's deck scene.
 */
export function pickSeaPoint(
    host: WebGLOsrsRendererHost,
    entityIndex: number,
    mouseX: number,
    mouseY: number,
): { x: number; y: number } | undefined {
    const entity = host.osrsClient.worldViewManager.getWorldEntity(entityIndex);
    if (!entity?.hasPosition) return undefined;
    const ray = host.screenToRay(mouseX, mouseY);
    if (!ray) return undefined;
    const boatX = entity.position.x / FINE_UNITS_PER_TILE;
    const boatZ = entity.position.z / FINE_UNITS_PER_TILE;
    const seaHeight = host.sampleHeightAtExactPlane(boatX, boatZ, 0);
    const dy = ray.direction[1];
    if (Math.abs(dy) < 1e-6) return undefined;
    const t = (seaHeight - ray.origin[1]) / dy;
    if (!(t > 0)) return undefined;
    return {
        x: (ray.origin[0] + ray.direction[0] * t) * FINE_UNITS_PER_TILE,
        y: (ray.origin[2] + ray.direction[2] * t) * FINE_UNITS_PER_TILE,
    };
}
