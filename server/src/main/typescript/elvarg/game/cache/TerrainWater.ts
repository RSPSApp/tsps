/** Raw terrain overlay values are cache overlay ids plus one. Ice (overlay 195) is land. */
export function isWaterOverlayId(rawOverlayId: number): boolean {
    return rawOverlayId === 6 || rawOverlayId === 7 || rawOverlayId === 442 ||
        rawOverlayId === 444 || (rawOverlayId >= 445 && rawOverlayId <= 625);
}
