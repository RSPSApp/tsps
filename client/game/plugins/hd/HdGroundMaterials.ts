// Default floor recipes from 117HD/RLHD scene/tile_overrides.json (38d4082).
// Untextured terrain stores its material ID in the otherwise unused U coordinate.
export enum HdGroundMaterial {
    NONE, GRASS, DIRT, SAND, GRAVEL, ROCK, SNOW, WOOD, CARPET, BRICK,
    BRICK_BROWN, MARBLE, TILES, STONE, CONCRETE, SAND_BRICK, WORN_TILES, PAVING, COBBLE,
}

const overlays = new Map<number, HdGroundMaterial>();
for (const [material, ids] of [
    [HdGroundMaterial.GRAVEL, [2, 3, 4, 8, 9, 10, 11, 119, 127, 180]],
    [HdGroundMaterial.WOOD, [5, 35, 52]],
    [HdGroundMaterial.SNOW, [30, 33, 254]],
    [HdGroundMaterial.GRASS, [29]],
    [HdGroundMaterial.DIRT, [14, 15, 16, 21, 22, 23, 36, 49, 60, 77, 80, 81, 82, 83, 85, 88, 89, 90, 91, 101, 102, 106, 107, 108, 110, 115, 123, 131, 132, 162, 172, 173, 216, 227]],
    [HdGroundMaterial.ROCK, [48, 120, 185, 198]],
    [HdGroundMaterial.SAND, [25, 26, 76]],
    [HdGroundMaterial.CARPET, [13, 163]],
    [HdGroundMaterial.BRICK, [28]],
    [HdGroundMaterial.BRICK_BROWN, [27, 46]],
    [HdGroundMaterial.MARBLE, [20]],
    [HdGroundMaterial.TILES, [134, 174]],
    [HdGroundMaterial.STONE, [12]],
    [HdGroundMaterial.CONCRETE, [32]],
    [HdGroundMaterial.SAND_BRICK, [84, 207]],
    [HdGroundMaterial.PAVING, [137]],
    [HdGroundMaterial.COBBLE, [117, 171, 179]],
] as const) for (const id of ids) overlays.set(id, material);

const grass = new Set([7, 33, 34, 40, 99, 100, 103, 114, 115, 126, 203]);
const dirt = new Set([19, 80, 111, 118, 121, 122, 139, 145, 146, 149, 150]);
// These IDs include both grass and soil; ID 64 is the olive grass by the ditch.
const complex = new Set([5, 8, 10, 12, 13, 17, 25, 26, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 75, 77, 92, 93, 94, 96, 97, 98, 112, 113, 125, 141, 143, 144]);

/** IDs are the cache's one-based scene IDs, before loader indexing. */
export function hdGroundMaterial(id: number, overlay: boolean, hsl: number): HdGroundMaterial {
    if (overlay) return overlays.get(id) ?? HdGroundMaterial.NONE;
    if (id <= 0 || hsl < 0) return HdGroundMaterial.NONE;
    if (grass.has(id)) return HdGroundMaterial.GRASS;
    if (dirt.has(id) || id === 15) return HdGroundMaterial.DIRT;
    if (id === 129 || id === 138) return HdGroundMaterial.SAND;
    if (!complex.has(id) && ![16, 59, 60].includes(id)) return HdGroundMaterial.NONE;
    const h = (hsl >> 10) & 63, s = (hsl >> 7) & 7, l = hsl & 127;
    if ([16, 58, 59, 60, 92].includes(id) && s === 0 && l > 70) return HdGroundMaterial.SNOW;
    if (s === 0 || (h <= 10 && s < 2)) return HdGroundMaterial.ROCK;
    if (h === 8 && ((s === 4 && l >= 71) || (s === 3 && l >= 48))) return HdGroundMaterial.SAND;
    if ((h >= 11 && s === 1) || (h === 9 && s === 2) || (h === 9 && s === 3 && l >= 49) ||
        (h >= 9 && s >= 4) || (h === 9 && l <= 38) || (h >= 10 && s >= 2) || (h === 8 && s >= 5 && l >= 20)) return HdGroundMaterial.GRASS;
    return HdGroundMaterial.DIRT;
}
