// Floor water texture ids, verified against the OSRS cache:
// - 1: classic water (overlays 5, 441, 443)
// - 25: swamp water (overlay 6)
// - 91: ice (overlay 195)
// - 130-189: water colour bank (overlays 444-623)
// - 208: dark water (overlay 624)
// Texture 24 is water on loc models only (fountains, waterfalls) and never
// appears on floors; it keeps the vanilla scrolling texture animation.
export const KNOWN_WATER_TEXTURE_IDS = new Set<number>([
    1,
    25,
    91,
    208,
    ...Array.from({ length: 60 }, (_, index) => 130 + index),
]);

export function isKnownWaterTextureId(textureId: number): boolean {
    return KNOWN_WATER_TEXTURE_IDS.has(textureId);
}
