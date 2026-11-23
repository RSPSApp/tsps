/**
 * Where each hitsplat slot sits around an actor's hitsplat anchor, in screen pixels: x, y per
 * slot (r241 HitsplatLayout.hitsplatOffsets). Slot 0 is centred, slots 1-3 make the familiar
 * diamond above, left and right, and the rest spiral outwards.
 *
 * Copied value for value from the client, including slot 77's (0, 120) where the spiral
 * suggests -120.
 */
// prettier-ignore
const HITSPLAT_OFFSETS: readonly number[] = [
    0, 0, 0, -20, -15, -10, 15, -10, 15, 10, 0, 20, -15, 10, -30, -10,
    -15, -30, 0, -40, 15, -30, 30, -10, 30, 10, 15, 30, 0, 40, -15, 30,
    -30, 10, -45, -10, -30, -30, -15, -50, 0, -60, 15, -50, 30, -30, 45, -10,
    45, 10, 30, 30, 15, 50, 0, 60, -15, 50, -30, 30, -45, 10, -60, -10,
    -45, -30, -30, -50, -15, -70, 0, -80, 15, -70, 30, -50, 45, -30, 60, -10,
    60, 10, 45, 30, 30, 50, 15, 70, 0, 80, -15, 70, -30, 50, -45, 30,
    -60, 10, -75, -10, -60, -30, -45, -50, -30, -70, -15, -90, 0, -100, 15, -90,
    30, -70, 45, -50, 60, -30, 75, -10, 75, 10, 60, 30, 45, 50, 30, 70,
    15, 90, 0, 100, -15, 90, -30, 70, -45, 50, -60, 30, -75, 10, -90, -10,
    -75, -30, -60, -50, -45, -70, -30, -90, -15, -110, 0, 120, 15, -110, 30, -90,
    45, -70, 60, -50, 75, -30, 90, -10, 90, 10, 75, 30, 60, 50, 45, 70,
    30, 90, 15, 110, 0, 120, -15, 110, -30, 90, -45, 70, -60, 50, -75, 30,
    -90, 10, -105, -10, -90, -30, -75, -50,
];

/**
 * The per-hit slot limit when a hit carries none. Every hit in the rsprox captures carries 8,
 * and the server sends 8 too.
 */
export const DEFAULT_HITSPLAT_LIMIT = 8;

/** How many slots the layout has offsets for (100). */
export const HITSPLAT_LAYOUT_SLOTS = HITSPLAT_OFFSETS.length >> 1;

/** Slot `index`'s x offset (r241 HitsplatLayout.getHitsplatOffsetX). */
export function getHitsplatOffsetX(index: number): number {
    return HITSPLAT_OFFSETS[(index | 0) << 1] ?? 0;
}

/** Slot `index`'s y offset (r241 HitsplatLayout.getHitsplatOffsetY). */
export function getHitsplatOffsetY(index: number): number {
    return HITSPLAT_OFFSETS[((index | 0) << 1) | 1] ?? 0;
}
