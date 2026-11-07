import type { WorldPoint } from "@runelite/api/coords/WorldPoint";

/**
 * The keys RuneLite saves clue notes under are Java hash codes (`text.hashCode()`,
 * `location.hashCode()`), so the same clue keeps the same note here.
 */

/** java.lang.String.hashCode: 31 * h + char, as a signed 32-bit int. */
export function javaStringHashCode(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
    return hash;
}

/** Lombok's @Value hashCode for WorldPoint(x, y, plane): prime 59 over the three ints. */
export function worldPointHashCode(point: WorldPoint): number {
    let result = 1;
    for (const value of [point.getX(), point.getY(), point.getPlane()]) result = (Math.imul(result, 59) + value) | 0;
    return result;
}
