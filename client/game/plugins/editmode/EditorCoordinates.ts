const WORLD_COORD_MAX = 0x3fff;
const REGION_ID_MAX = 0xffff;
const REGION_SIZE = 64;

export function regionIdOf(tileX: number, tileY: number): number {
    return ((tileX >> 6) << 8) | (tileY >> 6);
}

export function regionBounds(regionId: number): { minX: number; maxX: number; minY: number; maxY: number } {
    const minX = (regionId >> 8) << 6;
    const minY = (regionId & 0xff) << 6;
    return { minX, maxX: minX + REGION_SIZE - 1, minY, maxY: minY + REGION_SIZE - 1 };
}

/** Reads "x, y", "x, y, plane" or a lone region id. A region resolves to its centre tile. */
export function parseEditorLocation(text: string): { tileX: number; tileY: number; plane?: number } | undefined {
    const parts = text.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return undefined;
    const [first, second, plane] = parts.map(Number);
    if (parts.length === 1) {
        if (first > REGION_ID_MAX) return undefined;
        const bounds = regionBounds(first);
        return { tileX: bounds.minX + REGION_SIZE / 2, tileY: bounds.minY + REGION_SIZE / 2 };
    }
    if (first > WORLD_COORD_MAX || second > WORLD_COORD_MAX || (plane !== undefined && plane > 3)) return undefined;
    return { tileX: first, tileY: second, ...(plane === undefined ? {} : { plane }) };
}
