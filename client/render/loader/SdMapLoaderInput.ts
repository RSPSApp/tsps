export type SdMapLoaderInput = {
    /** Whole overworld square with compact far geometry; ignored for partial/instance/minimap builds. */
    farOnly?: boolean;
    mapProfileEnabled?: boolean;
    /** Reuse/store this build in the browser's IndexedDB map square cache. */
    persistentCache?: boolean;
    /** Generate only this minimap floor with the foreground geometry; others are loaded on demand. */
    minimapLevel?: number;
    /** A minimap-only request builds tile/object metadata without packing render geometry. */
    minimapOnly?: boolean;
    mapX: number;
    mapY: number;

    maxLevel: number;
    loadNpcs: boolean;

    smoothTerrain: boolean;

    /** Bake keyframe scenery animations a blended frame per client cycle (Animation Smoothing). */
    smoothLocAnimations?: boolean;
    smoothLocAnimationSteps?: number;

    minimizeDrawCalls: boolean;

    /**
     * Rebuild only door geometry and the scene data required to interact with
     * it. Used for open/close updates on an already loaded map square.
     */
    doorOnly?: boolean;

    /**
     * Rebuild only non-door location geometry and the scene data required to
     * interact with it. Used for ordinary LOC_ADD_CHANGE updates.
     */
    locOnly?: boolean;

    loadedTextureIds: Set<number>;

    // Dynamic loc overrides: Map<"x,y,level,oldId", {newId,newRotation?,moveToX?,moveToY?,seqId?,seqRandomStart?,matchType?,matchRotation?}>
    locOverrides?: Map<
        string,
        {
            newId: number;
            newRotation?: number;
            moveToX?: number;
            moveToY?: number;
            seqId?: number;
            seqRandomStart?: boolean;
            matchType?: number;
            matchRotation?: number;
        }
    >;
    // Dynamic loc spawns: first key fields are "x,y,level"; extra fields may distinguish stacked spawns.
    locSpawns?: Map<string, { id: number; type: number; rotation: number }>;
    terrainOverrides?: Map<
        string,
        {
            underlay?: number;
            overlay?: number;
            shape?: number;
            rotation?: number;
            renderFlags?: number;
        }
    >;

    mapRegionReplacements?: Map<
        number,
        { terrainData: Int8Array; objectData?: Int8Array }
    >;

    /**
     * Instance mode: when present, the loader uses buildInstanceScene() instead
     * of buildScene(). The SceneBuilder loads required cache regions internally.
     */
    instance?: {
        templateChunks: number[][][];
        regionX: number;
        regionY: number;
    };

    /**
     * Extra locs to bake into the scene (normal or instance builds).
     * Sourced from LOC_ADD_CHANGE packets for dynamically spawned objects.
     */
    extraLocs?: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
        shape: number;
        rotation: number;
    }>;

    /**
     * Extra NPCs to inject into the scene (world entity overlays).
     * These are added as NPC spawns alongside any cache-defined NPCs.
     */
    extraNpcs?: Array<{
        id: number;
        x: number;
        y: number;
        level: number;
    }>;

    /**
     * Override the render position for world entity overlays.
     * When set, the scene is built at source coordinates but rendered
     * at the entity's world position via shader u_mapPos offset.
     */
    overrideRenderPos?: {
        x: number;
        y: number;
    };
};

/** Dynamic map state must match the input submitted to the geometry worker. */
export function snapshotMapInput(input: SdMapLoaderInput): SdMapLoaderInput {
    return {
        ...input,
        locOverrides: input.locOverrides && new Map([...input.locOverrides].map(([key, value]) => [key, { ...value }])),
        locSpawns: input.locSpawns && new Map([...input.locSpawns].map(([key, value]) => [key, { ...value }])),
        terrainOverrides: input.terrainOverrides && new Map([...input.terrainOverrides].map(([key, value]) => [key, { ...value }])),
        mapRegionReplacements: input.mapRegionReplacements && new Map([...input.mapRegionReplacements].map(([key, value]) => [key, { ...value }])),
        extraLocs: input.extraLocs?.map((loc) => ({ ...loc })),
    };
}
