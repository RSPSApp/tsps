/**
 * 2048-unit angle helpers for boat headings.
 *
 * Ported from rsmod's `HeadingUtils.kt` (https://github.com/rsmod/rsmod, ISC license).
 * Angle 0 faces south and angles increase clockwise when viewed from above:
 * 512 = west, 1024 = north, 1536 = east.
 */

export const ANGLE_UNITS = 2048;
/** `SET_HEADING` sends 0-15; each step is 128 angle units. */
export const PACKED_HEADING_SCALE = 128;

const UNITS_PER_RADIAN = ANGLE_UNITS / (2 * Math.PI);

export function normalizeAngle(angle: number): number {
    return ((Math.trunc(angle) % ANGLE_UNITS) + ANGLE_UNITS) % ANGLE_UNITS;
}

export function reverseAngle(angle: number): number {
    return normalizeAngle(angle + 1024);
}

export function packedHeadingToAngle(heading: number): number {
    return normalizeAngle(Math.trunc(heading) * PACKED_HEADING_SCALE);
}

/** Maps a tile delta to an angle, keeping all 16 helm headings distinct. */
export function angleFromCoordDelta(dx: number, dy: number): number {
    if (dx === 0 && dy === 0) return 0;
    return Math.round(Math.atan2(-dx, -dy) * UNITS_PER_RADIAN) & (ANGLE_UNITS - 1);
}

/**
 * Signed turn delta while under sail. Prefers the clockwise arc when it is at most half a
 * circle, so reversing course traces a clockwise half-turn instead of spinning the long way.
 */
export function turnAngleDelta(from: number, to: number): number {
    const clockwise = (normalizeAngle(to) - normalizeAngle(from) + ANGLE_UNITS) % ANGLE_UNITS;
    if (clockwise === 0) return 0;
    return clockwise <= 1024 ? clockwise : clockwise - ANGLE_UNITS;
}

/** Fine-unit (1/128 tile) movement delta for travelling `speed` units along `angle`. */
export function angleToFineDelta(angle: number, speed: number): { dx: number; dy: number } {
    if (speed === 0) return { dx: 0, dy: 0 };
    const radians = (normalizeAngle(angle) * Math.PI) / 1024;
    // `+ 0` turns -0 into 0.
    return {
        dx: Math.round(-Math.sin(radians) * speed) + 0,
        dy: Math.round(-Math.cos(radians) * speed) + 0,
    };
}
