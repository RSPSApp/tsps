/**
 * What the active renderer knows about the 3D scene, for plugins that draw in 2D over it
 * (RuneLite's Perspective + Actor geometry). Set by the WebGL renderer and the WebGPU overlay
 * host; units are tiles, with height negative upwards, as the renderers use them.
 */
export interface SceneGeometry {
    /** Bridge-aware terrain height (tiles, negative up) on a server plane.
     * Polygons pass their center as the anchor so every corner samples the same height plane. */
    tileHeight(worldX: number, worldY: number, plane: number, anchorX?: number, anchorY?: number): number;
    /** Canvas device pixels for a scene point (world x, height, world y), or undefined off-screen. */
    worldToScreen(x: number, height: number, y: number): readonly [number, number] | undefined;
    /** The NPC's posed model triangles in scene units (x, height, y), for hulls and outlines. */
    npcModelPoints(ecsId: number, serverId: number): ReadonlyArray<readonly [number, number, number]> | undefined;
    /** The NPC type's default model height in fine units (RuneLite's logical height). */
    npcHeight(npcTypeId: number): number;
    /**
     * Each of a loc's models as triangles in scene units (x, height, y): one for most locs, two
     * for a wall corner or double diagonal decoration (RuneLite's convex hull and hull 2).
     */
    locModelPoints(loc: SceneLoc): ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> | undefined;
    /** The locs whose origin is this world tile on this plane: base id, shape and rotation. */
    locsAtTile(worldX: number, worldY: number, plane: number): SceneLoc[];
}

/** A loc in the scene: its base (untransformed) id, origin tile, plane, shape and rotation. */
export type SceneLoc = { id: number; tileX: number; tileY: number; plane: number; shape: number; rotation: number };

/** Where the minimap drew this frame (RuneLite's Perspective.localToMinimap). */
export interface MinimapGeometry {
    /** performance.now() when the minimap was last drawn; stale when it is hidden. */
    drawnAt: number;
    plane: number;
    /** Device pixels per minimap pixel. */
    scale: number;
    /** Canvas device pixels for a fractional world tile, or undefined beyond the minimap's reach. */
    worldToMinimap(worldX: number, worldY: number): readonly [number, number] | undefined;
}

/** Resolve the server plane at the polygon center, then sample its individual corners. */
export function sceneTileHeight(
    host: {
        getHeightSamplePlaneForTile(x: number, y: number, plane: number): number;
        getTileHeightAtPlane(x: number, y: number, plane: number): number;
    },
    x: number, y: number, plane: number, anchorX = x, anchorY = y,
): number {
    return host.getTileHeightAtPlane(
        x, y, host.getHeightSamplePlaneForTile(Math.floor(anchorX), Math.floor(anchorY), plane),
    );
}
