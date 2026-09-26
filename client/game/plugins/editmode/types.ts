import type { ObjectSpawn } from "./hostProtocol/objectSpawnsMessage";
/** Loc shape ids, mirrored from rs/config/loctype/LocModelType. */
export const LOC_SHAPE_NORMAL = 10;
export const LOC_SHAPE_FLOOR_DECORATION = 22;

export type EditModeTool = "select" | "place" | "delete" | "terrain" | "path" | "wall";

/** Reference editor fallback for a dirt path; overlay 2 is water in this cache. */
export const DEFAULT_PATH_OVERLAY_ID = 1;

/** What the place tool drops: a cache loc or a cache NPC. */
export type EditModePlaceKind = "loc" | "npc";

/** Cache categories exposed by the reference editor's search panel. */
export type EditModeSearchKind = EditModePlaceKind | "item";

export interface EditModeSearchResult {
    id: number;
    name: string;
}

export interface EditModeDefinitionSummary {
    id: number;
    kind: EditModeSearchKind;
    name: string;
    fields: Array<[string, string]>;
}

export interface EditModeOverlaySwatch {
    id: number;
    colorRgb: number;
    name?: string;
}

export interface EditModeShopStock {
    id: number;
    amount: number;
    [key: string]: unknown;
}

/** Server shop row; extra fields preserve restock and price settings on save. */
export interface EditModeShop {
    id: number;
    name: string;
    currency?: string;
    originalStock: EditModeShopStock[];
    [key: string]: unknown;
}

export interface EditModeNpcMenuOption {
    option: string;
    actionIndex: number;
    opcode: number;
    isAttack: boolean;
}

/** The on-disk npc-interactions.json object, keyed by NPC type id. */
export type EditModeNpcInteractions = Record<string, Record<string, unknown>>;

export type EditModeWorldZoneTag = string;

export interface EditModeBoundedWorldZone {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    z: number;
    tags: EditModeWorldZoneTag[];
}

// Global rules have no rectangle; keep them intact when editing and saving the world.
export type EditModeWorldZone = EditModeBoundedWorldZone | {
    minX?: never;
    maxX?: never;
    minY?: never;
    maxY?: never;
    z?: never;
    tags: EditModeWorldZoneTag[];
};

export interface EditModeWorldDefinition {
    spawn: { x: number; y: number; z: number };
    zones: EditModeWorldZone[];
    disabledPlugins: string[];
    experienceMultiplier: number;
}

export interface EditModeTile {
    tileX: number;
    tileY: number;
    plane: number;
}

export interface EditModeBuildingProfile {
    format: "elvarg-building-profile";
    version: 1;
    shape: "Rectangle" | "Irregular";
    size: { width: number; depth: number; floors: number };
    materials: {
        wallId: number | null;
        diagonalWallId: number | null;
        doorId: number | null;
        roofEdgeId: number | null;
        roofSlopeId: number | null;
        roofFillId: number | null;
    };
    footprint: Array<{ x: number; y: number }>;
    objects: Array<{
        id: number;
        name: string;
        role: "wall" | "door" | "roof" | "decoration" | "other";
        x: number;
        y: number;
        z: number;
        shape: number;
        rotation: number;
    }>;
}

export interface EditModeEdit extends EditModeTile {
    kind: "place" | "delete" | "npc" | "terrain" | "clear" | "height" | "flag" | "underlay";
    /** Loc id, NPC type id, overlay id, or explicit terrain height (0-255). */
    locId: number;
    /** Loc shape, or overlay shape for terrain; unused for NPCs. */
    shape: number;
    rotation: number;
}

export interface EditModePluginConfig {
    /** Plugin Hub on/off. */
    enabled: boolean;
    /** Whether clicks in the world are captured for editing. */
    active: boolean;
    tool: EditModeTool;
    placeKind: EditModePlaceKind;
    locId: number;
    npcId: number;
    shape: number;
    rotation: number;
    /** Floor overlay the terrain and path tools paint with. */
    overlayId: number;
    /** Height level edited by pointer, placement, and terrain tools. */
    heightLevel: number;
    /** Show every height level, or heightLevel and everything below it. */
    renderAllHeightLevels: boolean;
    saveObjectSpawns: boolean;
    /** Draw selectable map-function sprites at their floor tiles. */
    showMapIcons: boolean;
    showPvpZones: boolean;
    showDuelZones: boolean;
    showSafeZones: boolean;
    showMultiCombatZones: boolean;
    edits: EditModeEdit[];
}

export interface EditModeSelection extends EditModeTile {
    kind?: "ground" | "loc" | "npc" | "building";
    locId: number;
    locName: string;
    shape?: number;
    rotation?: number;
    tileEndX?: number;
    tileEndY?: number;
    planeEnd?: number;
    buildingWidth?: number;
    buildingDepth?: number;
    buildingFloors?: number;
    buildingTileCount?: number;
    buildingShape?: "Rectangle" | "Irregular";
    buildingObjectCount?: number;
    buildingWallCount?: number;
    buildingDoorCount?: number;
    buildingRoofCount?: number;
    buildingDecorationCount?: number;
    buildingOtherCount?: number;
    buildingWallId?: number;
    buildingProfile?: EditModeBuildingProfile;
}

export interface EditModePluginState {
    config: EditModePluginConfig;
    selection?: EditModeSelection;
    search: {
        kind: EditModeSearchKind;
        query: string;
        loading: boolean;
        results: EditModeSearchResult[];
    };
    /** First click of the path tool, waiting for its end tile. */
    pathStart?: EditModeTile;
    /** First click of the wall tool, waiting for its end tile. */
    wallStart?: EditModeTile;
    /** Camera detached from the player, flown with WASD/QE. Never persisted. */
    freeCamera: boolean;
    /** World rendered on the login screen. Never persisted. */
    scenePreview: boolean;
    world: {
        loading: boolean;
        definition?: EditModeWorldDefinition;
        error?: string;
    };
    version: number;
}

export interface EditModePluginPersistence {
    load(): Partial<EditModePluginConfig> | undefined;
    save(config: EditModePluginConfig): void;
}

/** Everything the plugin needs from the client, kept structural so tests can fake it. */
export interface EditModeHost {
    getCanvas(): HTMLCanvasElement | undefined;
    /** Temporary audio mute for the editor session. */
    setAudioMuted?(muted: boolean): void;
    /** Tile under the pointer, in world coordinates. */
    getPointerTile(): EditModeTile | undefined;
    getCameraTile?(): EditModeTile | undefined;
    /** Menu entries for the current hover, used to identify the loc being pointed at. */
    getPointerLoc(): { locId: number; locName: string } | undefined;
    /** Selects and visually marks the topmost entity, or the ground tile. */
    selectPointer?(tile: EditModeTile): EditModeSelection;
    /** One-off transparent PNG of the currently selected loc or NPC. */
    captureSelectionImage?(): Promise<string | undefined>;
    previewPointer?(tile: EditModeTile): void;
    previewBuilding?(tile: EditModeTile): void;
    selectBuilding?(tile: EditModeTile): EditModeSelection | undefined;
    clearPointerPreview?(): void;
    selectTileRange?(start: EditModeTile, end: EditModeTile): EditModeSelection;
    afterNextSceneFrame?(callback: () => void): void;
    clearSelectionHighlight?(): void;
    rotateCamera?(deltaX: number, deltaY: number): void;
    /** Shows the currently armed loc/NPC at the tile under the pointer. */
    setPlacementPreview?(
        kind: EditModePlaceKind,
        id: number,
        tile: EditModeTile,
        shape: number,
        rotation: number,
    ): void;
    /** Shows a run of identical wall locs without touching map-square state. */
    setWallPreview?(walls: readonly EditModeEdit[], height?: number): void;
    clearPlacementPreview?(): void;
    onLocAddChange(
        locId: number,
        tile: { x: number; y: number },
        level: number,
        shape: number,
        rotation: number,
    ): void;
    onLocDel(tile: { x: number; y: number }, level: number, shape: number, rotation: number): void;
    getLocPlacementShape?(locId: number): number;
    getLocName(locId: number): string;
    getNpcName(npcTypeId: number): string;
    /** Name/id search over the cache; the index is built on first use. */
    search(kind: EditModeSearchKind, query: string): Promise<EditModeSearchResult[]>;
    describeDefinition?(kind: EditModeSearchKind, id: number): EditModeDefinitionSummary | undefined;
    loadShops?(): Promise<EditModeShop[]>;
    loadNpcInteractions?(): Promise<EditModeNpcInteractions>;
    getNpcMenuOptions?(npcTypeId: number): readonly EditModeNpcMenuOption[];
    /** Cache-backed overlay colours for the terrain palette. */
    isWaterOverlay?(id: number): boolean;
    getOverlaySwatches?(): readonly EditModeOverlaySwatch[];
    loadWorldDefinition?(): Promise<EditModeWorldDefinition>;
    /** Spawns a cache NPC client-side. Returns the synthetic server id used. */
    spawnNpc(npcTypeId: number, tile: EditModeTile, rotation: number): number | undefined;
    despawnNpc(serverId: number): void;
    /** Paints a floor overlay on a tile and reloads the map square. */
    setTerrainOverlay(tile: EditModeTile, overlay: number, shape: number, rotation: number): void;
    clearTerrainOverride(tile: EditModeTile): void;
    /** Temporary path-tile highlights used by the hover preview. */
    setTerrainPreview?(edits: readonly EditModeEdit[]): void;
    clearTerrainPreview?(): void;
    /** Samples terrain at an exact tile vertex; undefined when its map is unavailable. */
    getTerrainHeight?(tile: EditModeTile): number | undefined;
    /** Rebuilds edited map squares from their persisted base data. */
    refreshEditedRegions?(regionIds: readonly number[], edits: readonly EditModeEdit[]): void;
    setFreeCamera(enabled: boolean): void;
    /** Renders the world instead of the login screen while logged out. */
    setScenePreview(enabled: boolean, spawn?: EditModeTile): void;
    setHeightLevel?(level: number): void;
    setRenderAllHeightLevels?(enabled: boolean): void;
    isLoggedIn(): boolean;
    /** Moves the camera over a world tile, for navigating while flying. */
    jumpCameraToTile(tile: EditModeTile): void;
    /** Serializes the map square under the camera for data/regions/{regionId}.pack. */
    markMapEditsSaved?(packs: readonly { regionId: number; data: Uint8Array }[], spawns?: ObjectSpawn[]): void;
    exportObjectSpawns?(edits: readonly EditModeEdit[]): ObjectSpawn[] | undefined;
    exportRegionPack?(
        tile: EditModeTile,
        edits: readonly EditModeEdit[],
    ): { regionId: number; data: Uint8Array };
    copyArea?(
        bounds: { minX: number; maxX: number; minY: number; maxY: number },
        edits: readonly EditModeEdit[],
    ): string;
    /** Drops the click the client has queued, so a tool press does not also
     *  walk the player or open a menu. */
    cancelPendingClick(): void;
    /** Re-frames the camera north-up at the editor's working angle. */
    levelCamera(): void;
    /** Opens the editor-owned world map surface. */
    toggleWorldMap?(): void;
    /** Editor modal surface currently owns keyboard input. */
    isEditorModalOpen?(): boolean;
}
