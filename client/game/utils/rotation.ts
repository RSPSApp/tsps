import { RAD_TO_RS_UNITS } from "../../rs/utils/rotation";

export { RAD_TO_RS_UNITS } from "../../rs/utils/rotation";
export const FACE_MIN_DIST_SQ = 16;

export function computeFacingRotation(dx: number, dy: number): number | undefined {
    const ix = dx | 0;
    const iy = dy | 0;
    if (ix * ix + iy * iy < FACE_MIN_DIST_SQ) return undefined;
    return ((Math.atan2(ix, iy) * RAD_TO_RS_UNITS) | 0) & 2047;
}

/**
 * The angle an NPC is drawn at when it is added. One that never turns (turn speed 0) is drawn at
 * angle 0 whatever angle it comes with, as the game does: that angle only sets where it would face.
 */
export function npcAddedRotation(rotationSpeed: number, angle: number): number {
    return (rotationSpeed | 0) === 0 ? 0 : (angle | 0) & 2047;
}

export function computeFacingRotationFromPositions(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
): number | undefined {
    return computeFacingRotation(toX - fromX, toY - fromY);
}
