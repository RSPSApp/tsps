/**
 * Map-element metadata for custom locs whose `mapFunctionId` names a server sprite directly
 * (`>= SERVER_MAP_ICON_SPRITE_START`, matching `ServerSprites.SERVER_SPRITE_START` = 30000).
 *
 * Kept dependency-free so both the map-data Web Worker (`SdMapDataLoader`) and main-thread
 * world-map lookups (`renderWidgetTree`, `WorldMapController`) share the exact same rule.
 */
export const SERVER_MAP_ICON_SPRITE_START = 30000;

export type CustomMapElementMetadata = {
    spriteId: number;
    minimapVisible: boolean;
    worldMapVisible: boolean;
    category: number;
    name: string | undefined;
    textColor: number;
    textSize: number;
    horizontalAlignment: number;
    verticalAlignment: number;
};

/** Returns centred map-element metadata for a server-sprite map function id (>= 30000). */
export function customMapElement(elementId: number): CustomMapElementMetadata | undefined {
    const id = elementId | 0;
    if (id < SERVER_MAP_ICON_SPRITE_START) return undefined;
    return {
        spriteId: id,
        minimapVisible: true,
        worldMapVisible: true,
        category: -1,
        name: undefined,
        textColor: 0,
        textSize: 0,
        horizontalAlignment: 0,
        verticalAlignment: 0,
    };
}

/** Resolves a map element id via `customMapElement` first, falling back to the cache loader. */
export function resolveMapElement<T>(
    elementId: number,
    loadFromCache: (id: number) => T | undefined,
): CustomMapElementMetadata | T | undefined {
    const custom = customMapElement(elementId);
    if (custom) return custom;
    return loadFromCache(elementId | 0);
}
