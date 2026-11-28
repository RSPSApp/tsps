import { areaPasteEdits, oversizedRegionPacks } from "./RegionPack";
import type { Camera } from "../../Camera";
import { planAreaStamp, previewAreaStamp, stampSize, type AreaStamp, type AreaStampOptions } from "./AreaStamp";
import type { GroundItemPlacement } from "./EditorGroundItems";
import type { ObjectSpawn } from "./hostProtocol/objectSpawnsMessage";
import { waterArea, generateIslandEdits } from "./IslandGenerator";
import { buildPathCorners, createPathTiles } from "./PathGenerator";
import { DEFAULT_WALL_BRUSH, planWallRun, type WallBrush } from "./EditorWallBrush";
import { fillOverlay, MAX_FILL_TILES, type OverlayFillResult } from "./OverlayFill";
import { parseEditorLocation, regionBounds, regionIdOf, WORLD_COORD_MAX } from "./EditorCoordinates";
import { adjustHeightBytes, cornerVertex, heightToByte, levelFoundation, type TileCorner } from "./TerrainHeight";
import { MAX_SCATTER_DENSITY, MIN_SCATTER_DENSITY, scatterBrushPasses, type ScatterPass } from "./ScatterBrush";
import {
    brushFootprint, brushPasses, brushTileKey, createBrushPassState, DEFAULT_TERRAIN_BRUSH, isHeightBrush,
    naturalHeightByte, sculptHeight, terrainDab,
    type BrushDab, type BrushTiming, type TerrainBrush,
} from "./TerrainBrush";
import {
    DEFAULT_PATH_OVERLAY_ID,
    LOC_SHAPE_FLOOR_DECORATION,
    LOC_SHAPE_NORMAL,
    type EditModeEdit,
    type EditModeHost,
    type EditModePlaceKind,
    type EditModePluginConfig,
    type EditModePluginPersistence,
    type EditModePluginState,
    type EditModeRegionOverlays,
    type EditModeRegionPack,
    type EditModeSearchKind,
    type EditModeSearchResult,
    type EditModeDefinitionSummary,
    type EditModeSelection,
    type EditModeTile,
    type EditModeTool,
    type EditModeWorldDefinition,
    type EditModeBoundedWorldZone,
} from "./types";

type EditModePluginListener = () => void;
type TileRange = { minX: number; maxX: number; minY: number; maxY: number; plane: number };
export type MapEdge = "west" | "east" | "south" | "north";

const DEFAULT_CONFIG: EditModePluginConfig = Object.freeze({
    enabled: false,
    active: false,
    tool: "select" as EditModeTool,
    placeKind: "loc" as EditModePlaceKind,
    locId: 0,
    npcId: 0,
    shape: LOC_SHAPE_NORMAL,
    rotation: 0,
    overlayId: DEFAULT_PATH_OVERLAY_ID,
    overlayShape: 0,
    overlayRotation: 0,
    heightLevel: 0,
    renderAllHeightLevels: true,
    showMapIcons: false,
    showUnwalkableFlags: false,
    showBridgeFlags: false,
    showRemoveRoofFlags: false,
    showLowerZFlags: false,
    showDisableRenderFlags: false,
    saveObjectSpawns: false,
    showPvpZones: false,
    showDuelZones: false,
    showSafeZones: false,
    showF2pZones: false,
    showMultiCombatZones: false,
    edits: [] as EditModeEdit[],
});

const TOOLS: ReadonlySet<string> = new Set<EditModeTool>([
    "select",
    "place",
    "delete",
    "terrain",
    "path",
    "wall",
    "fill",
    "stamp",
    "pick",
    "scatter",
]);
/** Terrain data has room for this many overlay shapes (opcodes 2-49, four rotations each). */
export const OVERLAY_SHAPE_COUNT = 12;
/** Undo history depth; each entry only holds what its action changed. */
const MAX_UNDO_ENTRIES = 200;
/** Keeps a stray drag from placing half a map square. */
const MAX_DRAW_TILES = 512;
/** Pointer travel past this is a camera drag, not a click on a tile. */
const DRAG_THRESHOLD_PX = 4;
const BRUSH_NEIGHBORS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
type ReadBrushHeight = (tile: EditModeTile) => number | undefined;
type BrushHeights = {
    values: Map<number, number>;
    targets: Map<number, { start: number; target: number }>;
};
type BrushStroke = {
    base: readonly EditModeEdit[];
    path: EditModeTile[];
    live: boolean;
    applied: number;
    weights: Map<number, number>;
    passes?: ReturnType<typeof createBrushPassState>;
    readHeight?: ReadBrushHeight;
    occupied?: Set<number>;
    scatterPass?: ScatterPass;
    scatterPreview?: { pass: ScatterPass; tiles: EditModeTile[]; applied: number };
    tileEdits: Map<number, EditModeEdit>;
    heights?: BrushHeights;
    preview?: Map<number, BrushDab>;
    rebuildOnly: boolean;
    frame?: number;
};
const EDITOR_CAMERA_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
const EDITOR_TYPING_SELECTOR = 'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type]), input:is([type="text"], [type="search"], [type="number"], [type="email"], [type="password"], [type="tel"], [type="url"])';
const EDITOR_WASD = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const PLACE_KINDS: ReadonlySet<string> = new Set<EditModePlaceKind>(["loc", "npc"]);

/** Keys spawned NPCs by the edit that created them, so undo can despawn them. */
function npcKey(edit: EditModeEdit): string {
    return `${edit.tileX},${edit.tileY},${edit.plane},${edit.locId}`;
}

/** Stable identity for deduplicating edits imported from a spawn patch. */
function editKey(edit: EditModeEdit): string {
    return JSON.stringify([
        edit.kind, edit.locId, edit.tileX, edit.tileY, edit.plane,
        edit.shape, edit.rotation, edit.wanderRadius, edit.direction, edit.leashRadius,
    ]);
}

/** The span of the edit list one action replaced, enough to put it back. */
type UndoEntry = {
    start: number;
    removed: EditModeEdit[];
    added: EditModeEdit[];
    /** Map edits reach the scene through the rebuild; NPC edits still dispatch on redo. */
    rebuildOnly?: boolean;
    scattered?: boolean;
    items?: { undo: () => void; redo: () => void };
    regions?: { before: readonly EditModeRegionPack[]; after: readonly EditModeRegionPack[] };
};

function diffEdits(before: readonly EditModeEdit[], after: readonly EditModeEdit[]): UndoEntry | undefined {
    const sameEdit = (left: EditModeEdit, right: EditModeEdit) => left === right || editKey(left) === editKey(right);
    let start = 0;
    while (start < before.length && start < after.length && sameEdit(before[start], after[start])) start++;
    let end = 0;
    while (
        end < before.length - start && end < after.length - start &&
        sameEdit(before[before.length - 1 - end], after[after.length - 1 - end])
    ) end++;
    if (start === before.length && start === after.length) return undefined;
    return {
        start,
        removed: before.slice(start, before.length - end),
        added: after.slice(start, after.length - end),
    };
}

function isTileEdit(edit: EditModeEdit): boolean {
    return edit.kind === "terrain" || edit.kind === "place" || edit.kind === "delete";
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Math.floor(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function clearAreaEdits(range: TileRange): EditModeEdit[] {
    const edits: EditModeEdit[] = [];
    for (let tileX = range.minX; tileX <= range.maxX; tileX++) {
        for (let tileY = range.minY; tileY <= range.maxY; tileY++) {
            edits.push({ kind: "clear", locId: 0, tileX, tileY, plane: range.plane, shape: 0, rotation: 0 });
        }
    }
    return edits;
}


export class EditModePlugin {
    private readonly listeners = new Set<EditModePluginListener>();
    private readonly persistence?: EditModePluginPersistence;
    private host?: EditModeHost;
    private capturing = false;
    private config: EditModePluginConfig;
    private state: EditModePluginState;
    private selection?: EditModeSelection;
    private movingSelection?: EditModeSelection;
    private stamp?: { area: AreaStamp; options: AreaStampOptions };
    private stampPreviewTile?: EditModeTile;
    private stampItemHistory?: (items: readonly GroundItemPlacement[]) => NonNullable<UndoEntry["items"]>;
    private stampPlacementPending = false;
    private tilePick?: (tile: EditModeTile, object?: EditModeSelection) => void;
    private tilePickPrompt?: string;
    private tilePickObjectsOnly = false;
    private terrainBrush: TerrainBrush = { ...DEFAULT_TERRAIN_BRUSH };
    private brushStroke?: BrushStroke;
    private scatter?: { assets: readonly { id: number; shape: number }[]; radius: number; density: number };
    private scatterPreviewFrame?: number;
    private scatterPreviewKey = "";
    private tileFlagRegionKey = "";
    private selectionMode: "entity" | "ground" | "building" = "entity";
    private search: EditModePluginState["search"] = {
        kind: "loc",
        query: "",
        loading: false,
        results: [],
    };
    private pathStart?: EditModeTile;
    private wallStart?: EditModeTile;
    private wallRotationOverride?: number;
    private wallBrush: WallBrush = { ...DEFAULT_WALL_BRUSH };
    private undoStack: UndoEntry[] = [];
    private redoStack: UndoEntry[] = [];
    private undoGroupBase?: readonly EditModeEdit[];
    private undoRestoring = false;
    private readonly rebuiltRegions = new Set<number>();
    private terrainPreview?: { returnTo?: EditModeTile };
    private readonly newMapSquares = new Map<number, EditModeRegionPack>();
    private pointerTileListener?: (tile: EditModeTile | undefined) => void;
    private freeCamera = false;
    private readonly cameraKeys = new Set<string>();
    private cameraVelocityX = 0;
    private cameraVelocityZ = 0;
    private pointer?: {
        x: number;
        y: number;
        travelled: number;
        startTile?: EditModeTile;
        dragSelection?: EditModeSelection;
    };
    private cameraPointer?: { x: number; y: number };
    private buildingSelect = false;
    private preview?: EditModeEdit;
    private scenePreview = false;
    private world: EditModePluginState["world"] = { loading: false };
    private worldDefinitionDirty = false;
    private savedWorldDefinition?: EditModeWorldDefinition;
    private searchToken = 0;
    private worldLoadToken = 0;
    private readonly spawnedNpcs = new Map<string, number>();
    /** Decoded overlays per region, valid for one edit list; the fill preview reads them on every move. */
    private regionOverlays = new Map<number, EditModeRegionOverlays | undefined>();
    private regionOverlaysEdits?: readonly EditModeEdit[];
    private noticeListener?: (message: string) => void;
    private version = 0;

    constructor(persistence?: EditModePluginPersistence) {
        this.persistence = persistence;
        // Never restore an armed session: a plugin that eats clicks from the
        // first frame is impossible to diagnose from the UI.
        // Placement choices are session state, not world settings. Starting
        // clean also prevents an old NPC selection from being armed silently.
        this.config = this.sanitizeConfig({
            ...persistence?.load(),
            active: false,
            tool: "select",
            placeKind: "loc",
            locId: 0,
            npcId: 0,
            shape: LOC_SHAPE_NORMAL,
            rotation: 0,
            heightLevel: 0,
            renderAllHeightLevels: true,
        });
        this.state = {
            config: this.config,
            search: this.search,
            freeCamera: this.freeCamera,
            scenePreview: this.scenePreview,
            world: this.world,
            version: this.version,
        };
    }

    subscribe(listener: EditModePluginListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getState(): EditModePluginState {
        return this.state;
    }

    getConfig(): EditModePluginConfig {
        return this.state.config;
    }

    getCameraTile(): EditModeTile | undefined {
        return this.host?.getCameraTile?.();
    }

    projectObject(object: EditModeSelection): { x: number; y: number } | undefined {
        return this.host?.projectObject?.(object);
    }

    getOverlaySwatches() {
        return this.host?.getOverlaySwatches?.() ?? [];
    }

    getOverlayTexture(textureId: number): string | undefined {
        return this.host?.getOverlayTexture?.(textureId);
    }

    getWorldDefinitionForSave(): EditModeWorldDefinition | undefined {
        return Object.keys(this.worldOverridesForSave()).length ? this.world.definition : undefined;
    }

    markWorldDefinitionSaved(): void {
        this.savedWorldDefinition = this.world.definition;
        this.worldDefinitionDirty = false;
    }

    getLoadedWorldSetting(key: "zones"): unknown {
        return this.savedWorldDefinition?.[key];
    }

    worldOverridesForSave(): Record<string, unknown> {
        const definition = this.worldDefinitionDirty ? this.world.definition : undefined;
        return definition && JSON.stringify(definition.zones) !== JSON.stringify(this.savedWorldDefinition?.zones)
            ? { zones: definition.zones } : {};
    }

    resizeWorldZone(index: number, bounds: Pick<EditModeBoundedWorldZone, "minX" | "maxX" | "minY" | "maxY">): void {
        const definition = this.world.definition;
        if (!definition || index < 0 || index >= definition.zones.length) return;
        const zones = [...definition.zones];
        const zone = zones[index];
        if (zone.minX === undefined) return;
        zones[index] = { ...zone, ...bounds };
        this.world = { ...this.world, definition: { ...definition, zones } };
        this.worldDefinitionDirty = true;
        this.commit();
    }

    addWorldZone(bounds: Pick<EditModeBoundedWorldZone, "minX" | "maxX" | "minY" | "maxY">, tag: EditModeWorldDefinition["zones"][number]["tags"][number] = "pvp"): void {
        const definition = this.world.definition;
        if (!definition) return;
        this.world = { ...this.world, definition: { ...definition, zones: [...definition.zones, { ...bounds, z: this.config.heightLevel, tags: [tag] }] } };
        this.worldDefinitionDirty = true;
        this.setConfig({ [tag === "duel" ? "showDuelZones" : tag === "safe" ? "showSafeZones" : tag === "f2p" ? "showF2pZones" : tag === "pvp" ? "showPvpZones" : "showMultiCombatZones"]: true });
    }

    setWorldZoneType(index: number, tag: EditModeWorldDefinition["zones"][number]["tags"][number]): void {
        const definition = this.world.definition;
        if (!definition || index < 0 || index >= definition.zones.length) return;
        const zones = [...definition.zones];
        zones[index] = { ...zones[index], tags: [tag] };
        this.world = { ...this.world, definition: { ...definition, zones } };
        this.worldDefinitionDirty = true;
        this.setConfig({ [tag === "duel" ? "showDuelZones" : tag === "safe" ? "showSafeZones" : tag === "f2p" ? "showF2pZones" : tag === "pvp" ? "showPvpZones" : "showMultiCombatZones"]: true });
    }

    deleteWorldZone(index: number): void {
        const definition = this.world.definition;
        if (!definition || index < 0 || index >= definition.zones.length) return;
        this.world = { ...this.world, definition: { ...definition, zones: definition.zones.filter((_, i) => i !== index) } };
        this.worldDefinitionDirty = true;
        this.commit();
    }

    getLoadedMapData(id: number): { terrainData: Uint8Array; objectData?: Uint8Array } | undefined {
        return this.host?.getLoadedMapData?.(id);
    }

    markMapEditsSaved(packs: readonly EditModeRegionPack[], spawns?: ObjectSpawn[]): void {
        this.finishBrushStroke(false);
        this.host?.markMapEditsSaved?.(packs, spawns);
        for (const pack of packs) this.newMapSquares.delete(pack.regionId);
        // Saved edits are part of the base map now; there is nothing left to take back.
        this.undoStack = [];
        this.redoStack = [];
        this.undoRestoring = true;
        try {
            this.setConfig({ edits: this.config.edits.filter((edit) =>
                edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander") });
        } finally {
            this.undoRestoring = false;
        }
    }

    exportObjectSpawns(saveToJson = this.config.saveObjectSpawns) {
        if (!this.config.edits.some((edit) =>
            edit.kind !== "npc" && edit.kind !== "npcDelete" && edit.kind !== "npcWander")) return undefined;
        return this.host?.exportObjectSpawns?.(this.config.edits, saveToJson);
    }

    /** JSON mode keeps object changes out of exported region packs. */
    exportModifiedRegionPacks(saveToJson = this.config.saveObjectSpawns): EditModeRegionPack[] {
        const packs = new Map(this.newMapSquares);
        const exportRegionPack = this.host?.exportRegionPack;
        if (!exportRegionPack) return [...packs.values()];
        const tiles = new Map<number, EditModeTile>();
        for (const edit of this.config.edits) {
            if (edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander" ||
                (saveToJson && (edit.kind === "place" || edit.kind === "delete"))) continue;
            tiles.set(((edit.tileX >> 6) << 8) | (edit.tileY >> 6), edit);
        }
        for (const [regionId, tile] of tiles) {
            const pack = exportRegionPack(tile, this.config.edits, saveToJson);
            if (!pack) throw new Error(`Region ${regionId} is not ready`);
            packs.set(regionId, pack);
        }
        return [...packs.values()];
    }

    attach(host: EditModeHost): void {
        this.host = host;
        host.setHeightLevel?.(this.config.heightLevel);
        host.setRenderAllHeightLevels?.(this.config.renderAllHeightLevels);
        if (typeof window !== "undefined") {
            window.addEventListener("keydown", this.onShortcut, true);
        }
        this.syncListeners();
        this.refreshWorldDefinition();
    }

    refreshWorldDefinition(): void {
        const load = this.host?.loadWorldDefinition;
        if (!load) return;
        const token = ++this.worldLoadToken;
        const previousDefinition = this.world.definition;
        this.world = { loading: true, definition: previousDefinition };
        this.commit();
        void load.call(this.host).then(
            (definition) => {
                if (token !== this.worldLoadToken) return;
                if (this.worldDefinitionDirty) {
                    this.world = { ...this.world, loading: false };
                    this.commit();
                    return;
                }
                this.savedWorldDefinition = definition;
                this.world = { loading: false, definition };
                this.commit();
            },
            (error) => {
                if (token !== this.worldLoadToken) return;
                this.world = {
                    loading: false,
                    definition: previousDefinition,
                    error: error instanceof Error ? error.message : String(error),
                };
                this.commit();
            },
        );
    }

    /** Ctrl+E arms or disarms the tools; the only in-game way in. */
    private readonly onShortcut = (event: KeyboardEvent): void => {
        if (!event.ctrlKey || (event.key !== "e" && event.key !== "E")) return;
        if (!this.config.enabled) return;
        event.preventDefault();
        event.stopPropagation();
        this.setConfig({ active: !this.config.active });
    };

    setConfig(nextConfig: Partial<EditModePluginConfig>): void {
        if (this.brushStroke && [
            "active", "enabled", "edits", "tool", "heightLevel", "brushTiming", "overlayId", "overlayShape", "overlayRotation",
        ].some((key) => key in nextConfig)) {
            // An external edit list may have been built from the current list. Commit
            // the already visible part before replacing it.
            this.finishBrushStroke(nextConfig.edits === undefined && this.brushStroke.live);
        }
        const wasActive = this.config.active;
        const previousTool = this.config.tool;
        if (nextConfig.tool !== undefined || nextConfig.locId !== undefined || nextConfig.placeKind !== undefined) {
            this.cancelMove();
        }
        const previousEdits = this.config.edits;
        this.config = this.sanitizeConfig({ ...this.config, ...nextConfig });
        if (nextConfig.edits !== undefined && this.undoGroupBase === undefined) this.recordUndo(previousEdits);
        if (nextConfig.heightLevel !== undefined && nextConfig.renderAllHeightLevels === undefined) {
            this.config.renderAllHeightLevels = this.config.heightLevel === 0;
        }
        if (nextConfig.tool !== undefined && this.config.tool !== previousTool) {
            if (previousTool === "stamp") this.stamp = undefined;
            if (previousTool === "pick") {
                this.tilePick = undefined;
                this.tilePickPrompt = undefined;
                this.tilePickObjectsOnly = false;
            }
            this.pathStart = undefined;
            this.wallStart = undefined;
            this.clearPlacementPreview();
            if (this.config.tool === "scatter") this.host?.clearPointerPreview?.();
        }
        if (nextConfig.heightLevel !== undefined) {
            this.host?.setHeightLevel?.(this.config.heightLevel);
        }
        if (nextConfig.heightLevel !== undefined || nextConfig.renderAllHeightLevels !== undefined) {
            this.host?.setRenderAllHeightLevels?.(this.config.renderAllHeightLevels);
        }
        this.syncListeners();
        if (Object.keys(nextConfig).some((key) => key !== "edits")) {
            this.refreshPlacementPreview();
        }
        this.commit();
        // Search results held focus; camera keys are listened for on the canvas.
        if (nextConfig.tool !== undefined) this.host?.getCanvas?.()?.focus({ preventScroll: true });
        if (!wasActive && this.config.active && !this.world.loading) {
            this.refreshWorldDefinition();
        }
    }

    /** Cache name for a loc id, "" when the cache is not loaded yet. */
    getLocName(locId: number): string {
        try {
            return this.host?.getLocName(locId) ?? "";
        } catch {
            return "";
        }
    }

    /** Cache name for an NPC type id, "" when the cache is not loaded yet. */
    getNpcName(npcTypeId: number): string {
        try {
            return this.host?.getNpcName(npcTypeId) ?? "";
        } catch {
            return "";
        }
    }

    /** Runs a cache name/id search for the current place kind. */
    searchCache(query: string, kind: EditModeSearchKind = this.config.placeKind): void {
        const host = this.host;
        this.search = {
            kind,
            query,
            loading: host !== undefined && query.trim().length > 0,
            results: [],
        };
        this.commit();
        if (!host || !this.search.loading) return;

        const token = ++this.searchToken;
        void host
            .search(kind, query)
            .then((results) => {
                if (token !== this.searchToken) return;
                this.search = { kind, query, loading: false, results };
                this.commit();
            })
            .catch(() => {
                if (token !== this.searchToken) return;
                this.search = { kind, query, loading: false, results: [] };
                this.commit();
            });
    }

    /** Selects a search result as the id the place tool will drop. */
    useSearchResult(id: number): void {
        if (this.search.kind === "item") return;
        this.setConfig(this.search.kind === "npc"
            ? { npcId: id }
            : { locId: id, shape: this.host?.getLocPlacementShape?.(id) ?? LOC_SHAPE_NORMAL, rotation: 0 });
    }

    describeDefinition(kind: EditModeSearchKind, id: number): EditModeDefinitionSummary | undefined {
        return this.host?.describeDefinition?.(kind, id);
    }

    loadPersistedNpcSpawnEdits(): Promise<EditModeEdit[]> {
        return this.host?.loadPersistedNpcSpawnEdits?.() ?? Promise.resolve([]);
    }

    /** Merges imported spawn edits once, replaying them into the preview. */
    importNpcSpawnEdits(edits: readonly EditModeEdit[]): boolean {
        const seen = new Set(this.config.edits.map(editKey));
        const fresh = edits.filter((edit) => {
            const key = editKey(edit);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        if (fresh.length === 0) return false;
        this.commitEdits(fresh);
        // Loaded from the host, not something the user did.
        this.undoStack.pop();
        return true;
    }

    /** Detaches or reattaches the camera from the player. */
    setFreeCamera(enabled: boolean): void {
        this.host?.setFreeCamera(enabled);
        this.freeCamera = enabled;
        this.resetCameraInput();
        this.commit();
    }

    /**
     * Renders the world on the login screen. There is no player to orbit, so
     * the camera is detached at the same time and the scene streams around it.
     */
    setScenePreview(enabled: boolean, target?: EditModeTile): void {
        const host = this.host;
        if (!host) return;
        const spawn = this.world.definition?.spawn;
        // A missing definition (world data has not loaded)
        // only costs the spawn framing, so it must not block the editor.
        if (enabled && host.loadWorldDefinition && this.world.loading) return;
        host.setScenePreview(
            enabled,
            target ?? (spawn && { tileX: spawn.x, tileY: spawn.y, plane: spawn.z }),
        );
        this.scenePreview = enabled;
        if (enabled) {
            if (!this.freeCamera) {
                host.setFreeCamera(true);
                this.freeCamera = true;
            }
            if (!this.config.active || target) {
                // The preview needs the editor's tools and camera input.
                this.setConfig({ active: true, ...(target ? { heightLevel: target.plane } : {}) });
                return;
            }
        }
        this.commit();
    }

    /** Puts the camera back to north-up at the editor's working angle. */
    levelCamera(): void {
        this.host?.levelCamera();
    }

    /** Moves the camera over a tile; handy once the camera is detached. */
    jumpToTile(tileX: number, tileY: number, plane = 0): void {
        this.host?.jumpCameraToTile({ tileX: tileX | 0, tileY: tileY | 0, plane: plane & 0x3 });
    }

    /** Opens the editor-owned world map. */
    toggleWorldMap(actions?: import("./EditorWorldMap").EditorWorldMapActions): void {
        this.host?.toggleWorldMap?.(actions);
    }

    isWorldMapOpen(): boolean {
        return this.host?.isEditorModalOpen?.() ?? false;
    }

    closeWorldMap(): void {
        if (this.isWorldMapOpen()) this.host?.closeEditorWorldMap?.();
    }

    /** Captures the selected visible model; the host owns the renderer work. */
    captureSelectionImage(): Promise<string | undefined> {
        if (!this.selection || (this.selection.kind !== "loc" && this.selection.kind !== "npc")) {
            return Promise.resolve(undefined);
        }
        return this.host?.captureSelectionImage?.() ?? Promise.resolve(undefined);
    }

    rotate(): void {
        if (this.config.tool === "wall") {
            const end = this.host?.getPointerTile();
            const start = this.wallStart ?? end;
            const diagonal = this.wallBrush.mode === "diagonal" && this.wallBrush.diagonal !== null;
            const base = diagonal ? 0 : start && end
                ? planWallRun(start, end, { ...this.wallBrush, opening: "none" }, 1)[0]?.rotation : 1;
            this.wallRotationOverride = ((this.wallRotationOverride ?? base ?? 1) + (diagonal ? 2 : 1)) & 0x3;
            this.refreshPlacementPreview();
            this.commit();
            return;
        }
        if (this.config.tool === "terrain" || (this.config.tool === "select" && this.isGroundSelection())) {
            this.setConfig({ overlayRotation: (this.config.overlayRotation + 1) & 0x3 });
            return;
        }
        this.setConfig({ rotation: (this.config.rotation + 1) & 0x3 });
    }

    duplicateSelection(): void {
        this.cancelMove();
        const selection = this.selection;
        if (!selection || selection.locId < 0) return;
        if (selection.kind === "npc") {
            this.setConfig({ tool: "place", placeKind: "npc", npcId: selection.locId });
            return;
        }
        if (selection.kind !== "loc") return;
        this.setConfig({
            tool: "place",
            placeKind: "loc",
            locId: selection.locId,
            shape: selection.shape ?? this.config.shape,
            rotation: selection.rotation ?? this.config.rotation,
        });
    }

    moveSelection(): void {
        const selection = this.selection;
        if (!selection || selection.locId < 0) return;
        if (selection.kind === "npc") {
            this.setConfig({ tool: "place", placeKind: "npc", npcId: selection.locId });
            // The source NPC stays put until the destination click is applied.
            this.movingSelection = { ...selection };
            return;
        }
        if (selection.kind !== "loc") return;
        this.duplicateSelection();
        this.movingSelection = { ...selection, shape: this.config.shape, rotation: this.config.rotation };
        this.host?.onLocDel(
            { x: selection.tileX, y: selection.tileY }, selection.plane,
            selection.shape ?? this.config.shape, selection.rotation ?? this.config.rotation,
        );
    }

    private cancelMove(): void {
        const moving = this.movingSelection;
        if (!moving) return;
        this.movingSelection = undefined;
        // NPC moves leave the source in place until the destination click, so
        // there is nothing to restore. Loc previews removed it up front.
        if (moving.kind !== "loc") return;
        // Preview removal never enters saved edits; cancellation restores the source.
        this.host?.onLocAddChange(moving.locId,
            { x: moving.tileX, y: moving.tileY }, moving.plane,
            moving.shape ?? this.config.shape, moving.rotation ?? this.config.rotation);
    }

    rotateSelection(): void {
        if (this.movingSelection) {
            this.rotate();
            return;
        }
        const selection = this.selection;
        if (!selection || selection.kind !== "loc" || selection.locId < 0) return;
        const shape = selection.shape ?? this.config.shape;
        const rotation = selection.rotation ?? this.config.rotation;
        const nextRotation = (rotation + 1) & 0x3;
        this.commitEdits([
            {
                kind: "delete",
                locId: 0,
                tileX: selection.tileX,
                tileY: selection.tileY,
                plane: selection.plane,
                shape,
                rotation,
            },
            {
                kind: "place",
                locId: selection.locId,
                tileX: selection.tileX,
                tileY: selection.tileY,
                plane: selection.plane,
                shape,
                rotation: nextRotation,
            },
        ]);
        this.selection = { ...selection, rotation: nextRotation };
        this.commit();
    }

    deleteSelection(): void {
        const selection = this.selection;
        if (!selection) return;
        if (this.movingSelection) this.setConfig({ tool: "select" });
        if (selection.kind === "npc") {
            this.deleteNpcSelection(selection);
            return;
        }
        if (selection.kind !== "loc" || selection.locId < 0) return;
        this.commitEdits([
            {
                kind: "delete",
                locId: 0,
                tileX: selection.tileX,
                tileY: selection.tileY,
                plane: selection.plane,
                shape: selection.shape ?? this.config.shape,
                rotation: selection.rotation ?? this.config.rotation,
            },
        ]);
        this.selection = undefined;
        this.host?.clearSelectionHighlight?.();
        this.commit();
    }

    /**
     * Editor-placed NPCs lose their edits; persisted game spawns get a removal
     * marker so saving keeps them gone.
     */
    private deleteNpcSelection(selection: EditModeSelection): void {
        if (selection.npcSource === undefined) {
            // A live server NPC (logged-in editing): hide it for this session only.
            if (selection.npcServerId !== undefined) this.host?.despawnNpc(selection.npcServerId);
            this.selection = undefined;
            this.host?.clearSelectionHighlight?.();
            this.commit();
            return;
        }
        if (this.customNpcEditIndex(selection) >= 0) {
            // A saved patch can hold a removal marker beside the replacement at
            // this tile (a canonical spawn moved away and back). Keep the marker:
            // it is what suppresses the canonical spawn, so dropping it would
            // bring the original back as soon as the patch reloads.
            this.removeEdits(this.npcReplacementIndicesAt(selection));
        } else {
            this.undoGroup(() => {
                // Keep the removal markers already at this tile: each hides one of its stacked spawns, so
                // this one is added beside them (the server drops one spawn per marker).
                this.removeEdits(this.spawnEditsLeavingTile(selection));
                const spawn = this.spawnOf(selection);
                this.commitEdits([{
                    kind: "npcDelete",
                    locId: spawn.id,
                    tileX: spawn.tileX,
                    tileY: spawn.tileY,
                    plane: spawn.plane,
                    shape: 0,
                    rotation: 0,
                }], true, this.npcMarkerIndexAt(selection));
            });
        }
        this.selection = undefined;
        this.host?.clearSelectionHighlight?.();
        this.commit();
    }

    /**
     * The edits to drop when one persisted spawn leaves its tile (deleted or moved away). A wander range is the
     * whole stack's (setSelectionWanderRadius), so the identical spawns still there keep theirs: only one
     * override, the one paired with the leaving spawn, goes. Without a host count, every override goes.
     */
    private spawnEditsLeavingTile(selection: EditModeSelection): number[] {
        const replacement = this.npcReplacementIndicesAt(selection);
        const stacked = this.host?.countNpcSpawns?.(this.spawnOf(selection));
        if (stacked === undefined) return replacement;
        const wanders = replacement.filter((index) => this.config.edits[index].kind === "npcWander");
        const kept = new Set(wanders.slice(0, Math.max(0, stacked - 1)));
        return replacement.filter((index) => !kept.has(index));
    }

    /** The persisted game spawn a selection stands for. */
    private spawnOf(selection: EditModeSelection): { id: number; tileX: number; tileY: number; plane: number } {
        return selection.npcSpawn ?? {
            id: selection.locId,
            tileX: selection.tileX,
            tileY: selection.tileY,
            plane: selection.plane,
        };
    }

    /**
     * Changes a spawn's wandering range; 0 keeps it anchored. Editor-placed
     * NPCs carry it on the spawn edit, persisted spawns on a small override.
     * Identical persisted spawns stacked on one tile have no identity of their
     * own (the patch pairs records with them by order), so the range goes to
     * every one of them still standing: one override each.
     */
    setSelectionWanderRadius(radius: number, leash = this.selection?.npcLeashRadius): void {
        const selection = this.selection;
        if (!selection || selection.kind !== "npc" || selection.locId < 0) return;
        if (selection.npcSource === undefined) return;
        const wanderRadius = Math.max(0, Math.min(255, Math.trunc(radius)));
        if (!Number.isFinite(wanderRadius)) return;
        const leashRadius = typeof leash === "number" ? toInt(leash, wanderRadius, wanderRadius, 255) : leash;
        const customIndex = this.customNpcEditIndex(selection);
        if (customIndex >= 0) {
            const edits = this.config.edits.map((edit, index) =>
                index === customIndex ? { ...edit, wanderRadius, leashRadius } : edit,
            );
            this.setConfig({ edits });
        } else {
            const indices = this.npcEditIndicesAt(selection).filter((index) =>
                this.config.edits[index].kind === "npcWander",
            );
            this.undoGroup(() => {
                this.removeEdits(indices);
                // Before the tile's removal markers: the server's loader reads [override, remove] as this spawn's
                // wander plus one stacked spawn removed, but [remove, override] as a moved-back spawn filling the
                // removed one's slot, which would load two spawns.
                const firstMarker = this.npcEditIndicesAt(selection).find((index) =>
                    this.config.edits[index].kind === "npcDelete");
                const stacked = Math.max(1, this.host?.countNpcSpawns?.(this.spawnOf(selection)) ?? 1);
                this.commitEdits(Array.from({ length: stacked }, () => ({
                    kind: "npcWander" as const,
                    locId: selection.locId,
                    tileX: selection.tileX,
                    tileY: selection.tileY,
                    plane: selection.plane,
                    shape: 0,
                    rotation: 0,
                    wanderRadius,
                    ...(leashRadius === undefined ? {} : { leashRadius }),
                    ...(selection.npcSpawn?.direction === undefined
                        ? {}
                        : { direction: selection.npcSpawn.direction }),
                })), true, firstMarker);
            });
        }
        this.selection = { ...selection, npcWanderRadius: wanderRadius, npcLeashRadius: leashRadius };
        this.commit();
    }

    /**
     * Index of the editor-placed NPC edit a selection points at, if any. A selected game spawn never points
     * at one, even when an editor-placed copy of that NPC shares its tile.
     */
    private customNpcEditIndex(selection: EditModeSelection): number {
        if (selection.npcSource === "spawn") return -1;
        return this.config.edits.findIndex((edit) =>
            edit.kind === "npc" &&
            edit.locId === selection.locId &&
            edit.tileX === selection.tileX &&
            edit.tileY === selection.tileY &&
            edit.plane === selection.plane,
        );
    }

    /** Every NPC edit (spawn, removal or wander override) at the selected tile. */
    private npcEditIndicesAt(selection: EditModeSelection): number[] {
        return this.config.edits.flatMap((edit, index) =>
            (edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander") &&
            edit.locId === selection.locId &&
            edit.tileX === selection.tileX &&
            edit.tileY === selection.tileY &&
            edit.plane === selection.plane
                ? [index]
                : [],
        );
    }

    /**
     * The edits that make up an editor-placed NPC at the selected tile: its
     * spawn and wander override, never a removal marker. A marker with the same
     * type and tile suppresses the canonical spawn the replacement stands in
     * for, so removing the replacement has to leave it behind.
     */
    private npcReplacementIndicesAt(selection: EditModeSelection): number[] {
        return this.npcEditIndicesAt(selection).filter((index) => {
            const kind = this.config.edits[index].kind;
            // A game spawn's own edit is its wander override; an editor-placed copy on its tile is not its.
            return kind !== "npcDelete" && !(selection.npcSource === "spawn" && kind === "npc");
        });
    }

    /**
     * Where a game spawn's removal marker goes: before the first editor-placed copy of that NPC on its tile,
     * so the saved patch reads [remove, add] (the copy stays) rather than the copy replacing the spawn and the
     * marker then finding nothing to remove.
     */
    private npcMarkerIndexAt(selection: EditModeSelection): number {
        const copy = this.npcEditIndicesAt(selection).find((index) => this.config.edits[index].kind === "npc");
        return copy ?? this.config.edits.length;
    }

    private removeEdits(indices: readonly number[]): void {
        if (indices.length === 0) return;
        const removed = new Set(indices);
        const removedEdits = this.config.edits.filter((_, index) => removed.has(index));
        for (const edit of removedEdits) this.revert(edit);
        const next = this.config.edits.filter((_, index) => !removed.has(index));
        this.setConfig({ edits: next });
        this.refreshSpecialRegions(removedEdits, next);
    }

    getSelectionOverlay(): number | undefined {
        const selection = this.selection;
        if (!selection || selection.kind === "building" || selection.kind === "loc" || selection.kind === "npc" ||
            (selection.tileEndX ?? selection.tileX) !== selection.tileX ||
            (selection.tileEndY ?? selection.tileY) !== selection.tileY) return undefined;
        const overlay = this.host?.getTerrainOverlay?.(selection);
        return overlay !== undefined && overlay >= 0 ? overlay : undefined;
    }

    useSelectionOverlay(): void {
        const overlayId = this.getSelectionOverlay();
        if (overlayId !== undefined) this.setConfig({ overlayId });
    }

    paintSelection(): void {
        if (!this.selection || this.selection.kind === "building" || this.selection.kind === "loc" || this.selection.kind === "npc") return;
        const range = this.getSelectionRange();
        if (!range) {
            this.commitEdits([this.paintEdit(this.selection)]);
            return;
        }
        const edits: EditModeEdit[] = [];
        for (let tileX = range.minX; tileX <= range.maxX; tileX++) {
            for (let tileY = range.minY; tileY <= range.maxY; tileY++) {
                edits.push(this.paintEdit({ tileX, tileY, plane: range.plane }));
            }
        }
        this.commitEdits(edits);
    }

    copyArea(includeNpcs = false): string {
        const selection = this.selection;
        const range = this.getSelectionRange() ?? (selection && selection.kind !== "npc" ? {
            minX: selection.tileX, maxX: selection.tileX, minY: selection.tileY, maxY: selection.tileY,
        } : undefined);
        if (!range) throw new Error("Select a tile or area to copy");
        if (!this.host?.copyArea) throw new Error("Map data is unavailable");
        const contents = this.host.copyArea(range, this.config.edits);
        if (!includeNpcs || !this.host.getAreaNpcs) return contents;
        const npcs = this.host.getAreaNpcs(range).map(({ tileX, tileY, ...spawn }) => ({
            ...spawn, x: tileX - range.minX, y: tileY - range.minY,
        }));
        return JSON.stringify({ ...JSON.parse(contents), npcs });
    }

    landscapeData(part = ""): Promise<any> {
        if (!this.host?.landscapeData) return Promise.reject(new Error("Landscape generation needs the editor cache to be loaded"));
        return this.host.landscapeData(part);
    }

    loadTemplateCatalog() {
        return this.host?.loadTemplateCatalog?.() ?? Promise.resolve([]);
    }

    loadTemplate(name: string): Promise<unknown> {
        if (!this.host?.loadTemplate) return Promise.reject(new Error("The editor template library is unavailable"));
        return this.host.loadTemplate(name);
    }

    loadMapPlans() {
        if (!this.host?.loadMapPlans) return Promise.reject(new Error("Construction generation needs the editor cache to be loaded"));
        return this.host.loadMapPlans();
    }

    previewMapPlan(query: URLSearchParams): Promise<unknown> {
        if (!this.host?.previewMapPlan) return Promise.reject(new Error("Construction generation needs the editor cache to be loaded"));
        return this.host.previewMapPlan(query);
    }

    loadTravel(kind: "game-warps" | "map-warps"): Promise<unknown> {
        return this.host?.loadTravel?.(kind) ?? Promise.resolve([]);
    }

    loadObjectTravel(object: EditModeSelection): Promise<unknown> {
        return this.host?.loadObjectTravel?.(object) ?? Promise.resolve([]);
    }

    getLocActions(id: number): readonly (string | undefined)[] {
        return this.host?.getLocActions?.(id) ?? [];
    }

    showTravelMarkers(sources: readonly EditModeTile[], arrivals: readonly EditModeTile[]): void {
        this.host?.showTravelMarkers?.(sources, arrivals);
    }

    getLocPlacementShapes(id: number): readonly number[] {
        return this.host?.getLocPlacementShapes?.(id) ?? [];
    }

    searchScenery(query: string): Promise<EditModeSearchResult[]> {
        return this.host?.search("loc", query) ?? Promise.resolve([]);
    }

    loadAssetThumbnail(kind: EditModeSearchKind, id: number): Promise<string | undefined> {
        const host = this.host;
        const preview = kind === "loc" ? host?.loadObjectThumbnail :
            kind === "npc" ? host?.loadNpcThumbnail : host?.loadItemThumbnail;
        return preview?.call(host, id) ?? Promise.resolve(undefined);
    }

    prepareScatter(): void {
        this.finishActiveBrush();
        this.scatter = undefined;
        this.setConfig({ tool: "scatter" });
    }

    hasScatterBrush(): boolean {
        return this.scatter !== undefined;
    }

    private scatterShape(id: number): number | undefined {
        const shape = this.host?.getLocPlacementShape?.(id);
        return (shape === 10 || shape === 11 || shape === 22) && this.host?.getStampObjectInfo?.(id) ? shape : undefined;
    }

    canScatter(id: number): boolean {
        return this.scatterShape(id) !== undefined;
    }

    armScatter(ids: readonly number[], radius: number, density: number): void {
        const assets = [...new Set(ids)].flatMap((id) => {
            const shape = this.scatterShape(id);
            return shape === undefined ? [] : [{ id, shape }];
        });
        if (!assets.length) throw new Error("Choose a placeable tree, plant, rock or ground decoration.");
        this.finishActiveBrush();
        this.scatter = {
            assets,
            radius: toInt(radius, 3, 0, 10),
            density: Number.isFinite(density) ? Math.max(MIN_SCATTER_DENSITY, Math.min(MAX_SCATTER_DENSITY, density)) : 0.24,
        };
        if (this.config.tool !== "scatter") this.setConfig({ tool: "scatter" });
        else {
            this.refreshPlacementPreview();
            this.commit();
        }
    }

    getSelectionMode(): "entity" | "ground" | "building" {
        return this.selectionMode;
    }

    isSelectingBuilding(shift = this.buildingSelect): boolean {
        return this.config.tool === "select" && (shift || this.selectionMode === "building");
    }

    clearSelection(): void {
        if (!this.selection) return;
        this.selection = undefined;
        this.host?.clearSelectionHighlight?.();
        this.commit();
    }

    setSelectionMode(mode: "entity" | "ground" | "building"): void {
        this.selectionMode = mode;
        this.setConfig({ tool: "select" });
    }

    private scatterEdits(path: readonly EditModeTile[], stroke?: BrushStroke): EditModeEdit[] {
        const scatter = this.scatter;
        if (!scatter || !path.length) return [];
        const { assets, radius, density } = scatter;
        const first = path[0];
        const occupied = stroke?.occupied ?? this.scatterOccupancy(first.plane);
        if (stroke) stroke.occupied = occupied;
        const edits: EditModeEdit[] = [];
        const click = path.length === 1 && (stroke?.applied ?? 0) === 0;
        const place = (tile: EditModeTile): void => {
            const asset = assets[Math.floor(Math.random() * assets.length)];
            const rotation = Math.floor(Math.random() * 4);
            const edit: EditModeEdit = { kind: "place", ...tile, locId: asset.id, shape: asset.shape, rotation };
            const covered = this.scatterFootprint(edit);
            if (!covered.length || covered.some((at) => {
                if (at.tileX >= 16384 || at.tileY >= 16384 || occupied.has(brushTileKey(at)) ||
                    this.host?.hasLocAt?.(at) || ((this.host?.getTerrainFlags?.(at) ?? 0) & 1)) return true;
                const overlay = this.host?.getTerrainOverlay?.(at);
                return !!overlay && this.host?.isWaterOverlay?.(overlay);
            })) return;
            for (const at of covered) occupied.add(brushTileKey(at));
            edits.push(edit);
        };
        if (click && !occupied.has(brushTileKey(first))) place(first);
        const pass = stroke && (stroke.scatterPass ??= { visited: new Set() });
        for (const tile of scatterBrushPasses(path, radius, pass)) {
            if (click && tile.tileX === first.tileX && tile.tileY === first.tileY) continue;
            if (!occupied.has(brushTileKey(tile)) && Math.random() < density) place(tile);
        }
        return edits;
    }

    private scatterFootprint(edit: EditModeEdit): EditModeTile[] {
        const info = this.host?.getStampObjectInfo?.(edit.locId);
        if (!info) return [];
        const [width, height] = edit.rotation & 1 ? [info.sizeY, info.sizeX] : [info.sizeX, info.sizeY];
        const covered: EditModeTile[] = [];
        for (let dx = 0; dx < width; dx++) {
            for (let dy = 0; dy < height; dy++) {
                covered.push({ tileX: edit.tileX + dx, tileY: edit.tileY + dy, plane: edit.plane });
            }
        }
        return covered;
    }

    private scatterOccupancy(plane: number): Set<number> {
        const occupied = new Set<number>();
        for (const edit of this.config.edits) {
            if (edit.kind !== "place" || edit.plane !== plane) continue;
            const footprint = this.scatterFootprint(edit);
            for (const tile of footprint.length ? footprint : [edit]) occupied.add(brushTileKey(tile));
        }
        return occupied;
    }

    private applyScatter(path: readonly EditModeTile[]): void {
        const edits = this.scatterEdits(path);
        this.host?.previewScatteredLocs?.(edits);
        this.commitEdits(edits, false);
        const entry = this.undoStack.at(-1);
        if (edits.length && entry) entry.scattered = true;
        if (this.scatter) this.noticeListener?.(edits.length ? `Scattered ${edits.length} objects` : "No clear tiles received scenery");
    }

    loadGroundItems(): Promise<unknown> {
        return this.host?.loadGroundItems?.() ?? Promise.resolve([]);
    }

    previewGroundItems(items: readonly import("./EditorGroundItems").GroundItemPlacement[]): void {
        this.host?.previewGroundItems?.(items);
    }

    testTile(tile: EditModeTile): boolean {
        if (!this.host?.isLoggedIn() || !this.host.testTile) return false;
        this.host.testTile(tile);
        return true;
    }

    canReloadSavedRegions(regionIds: readonly number[]): boolean {
        return this.host?.isLoggedIn() === true && !!this.host.reloadSavedRegions && regionIds.length > 0 && regionIds.length <= 12;
    }

    requestSavedRegionReload(regionIds: readonly number[]): boolean {
        if (!this.canReloadSavedRegions(regionIds)) return false;
        this.host?.reloadSavedRegions?.(regionIds);
        return true;
    }

    prepareNewRegion(regionId: number, underlay: number, cave: boolean, from?: number): Promise<Uint8Array> {
        if (!this.host?.prepareNewRegion) return Promise.reject(new Error("Load an OSRS cache before creating a map"));
        return this.host.prepareNewRegion(regionId, underlay, cave, from);
    }

    getNewMapSquares(): number[] {
        return [...this.newMapSquares.keys()];
    }

    getNewMapSquare(id: number): EditModeRegionPack | undefined {
        return this.newMapSquares.get(id);
    }

    isNewMapSquare(id: number): boolean {
        return this.newMapSquares.has(id);
    }

    hasMapSquareData(id: number): boolean {
        return this.isNewMapSquare(id) || this.host?.isRegionOccupied?.(id) === true ||
            this.config.edits.some(({ tileX, tileY }) => regionIdOf(tileX, tileY) === id);
    }

    showTerrainPreview(packs: readonly EditModeRegionPack[], focus: EditModeTile, span: number): void {
        this.finishActiveBrush();
        const first = !this.terrainPreview;
        this.terrainPreview ??= { returnTo: this.host?.getCameraTile?.() };
        this.host?.showLandscapePreview?.(packs);
        if (first) this.focusTerrainPreview(focus, span);
    }

    focusTerrainPreview(tile: EditModeTile, span: number): void {
        if (!this.freeCamera) this.setFreeCamera(true);
        if (this.config.heightLevel !== tile.plane) this.setConfig({ heightLevel: tile.plane });
        if (this.host?.frameLandscape) this.host.frameLandscape(tile, span);
        else this.goToLocation(`${tile.tileX}, ${tile.tileY}, ${tile.plane}`);
    }

    clearTerrainPreview(restoreCamera = false): void {
        const preview = this.terrainPreview;
        if (!preview) return;
        this.terrainPreview = undefined;
        this.host?.showLandscapePreview?.([]);
        if (restoreCamera && preview.returnTo) {
            const { tileX, tileY, plane } = preview.returnTo;
            this.goToLocation(`${tileX}, ${tileY}, ${plane}`);
        }
    }

    stageMapSquares(packs: readonly EditModeRegionPack[], origin: EditModeTile, replacing = false, keepView = false): void {
        this.clearTerrainPreview();
        this.finishActiveBrush();
        if (!packs.length || new Set(packs.map(({ regionId }) => regionId)).size !== packs.length) {
            throw new Error("The draft must contain one pack per new map square.");
        }
        const edited = new Set(this.config.edits.map((edit) => regionIdOf(edit.tileX, edit.tileY)));
        const before: EditModeRegionPack[] = [];
        for (const pack of packs) {
            const id = pack.regionId;
            const draft = this.newMapSquares.get(id);
            if (replacing && draft && !edited.has(id)) before.push(draft);
            else if (edited.has(id) || this.hasMapSquareData(id) || replacing) {
                throw new Error(replacing ? "Undo edits to the draft before rerolling it."
                    : `Map square ${id} already has terrain or edits in this editor.`);
            }
        }
        this.undoStack.push({ start: this.config.edits.length, added: [], removed: [], regions: { before, after: packs } });
        if (this.undoStack.length > MAX_UNDO_ENTRIES) this.undoStack.shift();
        this.redoStack = [];
        this.swapMapSquares(before, packs);
        if (!keepView) this.goToLocation(`${origin.tileX}, ${origin.tileY}, ${origin.plane}`);
    }

    private swapMapSquares(outgoing: readonly EditModeRegionPack[], incoming: readonly EditModeRegionPack[]): void {
        const next = new Set(incoming.map(({ regionId }) => regionId));
        for (const { regionId } of outgoing) {
            if (next.has(regionId)) continue;
            this.newMapSquares.delete(regionId);
            this.host?.removeNewRegion?.(regionId);
        }
        for (const pack of incoming) {
            this.newMapSquares.set(pack.regionId, pack);
            this.host?.previewNewRegion?.(pack.data);
        }
        this.commit();
    }

    pickTile(pick: (tile: EditModeTile, object?: EditModeSelection) => void, prompt = "Pick a tile", onlyObjects = false): void {
        this.tilePick = pick;
        this.tilePickPrompt = prompt;
        this.tilePickObjectsOnly = onlyObjects;
        this.setConfig({ tool: "pick" });
    }

    arrivalBeside(object: EditModeSelection, preferred: EditModeTile = object): EditModeTile {
        const { tileX: x, tileY: y, plane } = object;
        const sized = object.shape === 10 || object.shape === 11 || object.shape === 22;
        const definition = sized ? this.host?.getStampObjectInfo?.(object.locId) : undefined;
        let width = definition?.sizeX ?? 1;
        let depth = definition?.sizeY ?? 1;
        if ((object.rotation ?? 0) & 1) [width, depth] = [depth, width];
        const sides: EditModeTile[] = [];
        for (let dx = 0; dx < width; dx++) sides.push({ tileX: x + dx, tileY: y - 1, plane }, { tileX: x + dx, tileY: y + depth, plane });
        for (let dy = 0; dy < depth; dy++) sides.push({ tileX: x - 1, tileY: y + dy, plane }, { tileX: x + width, tileY: y + dy, plane });
        const distance = (tile: EditModeTile) => Math.abs(tile.tileX - preferred.tileX) + Math.abs(tile.tileY - preferred.tileY);
        const candidates = sides.filter((tile) => tile.tileX >= 0 && tile.tileY >= 0 && tile.tileX <= 16383 && tile.tileY <= 16383)
            .sort((a, b) => distance(a) - distance(b));
        const clear = (tile: EditModeTile) => {
            const flags = this.host?.getTerrainFlags?.(tile);
            const overlay = this.host?.getTerrainOverlay?.(tile) ?? 0;
            return flags !== undefined && !(flags & 1) && !this.host?.isWaterOverlay?.(overlay) && !this.host?.hasLocAt?.(tile);
        };
        return candidates.find(clear) ?? candidates[0] ?? object;
    }

    getTilePickPrompt(): string | undefined {
        return this.tilePickPrompt;
    }

    armStamp(area: AreaStamp, options: AreaStampOptions): void {
        this.stamp = { area, options };
        this.stampPreviewTile = undefined;
        this.setConfig({ tool: "stamp" });
    }

    setStampItemHistory(handler?: typeof this.stampItemHistory): void {
        this.stampItemHistory = handler;
    }

    getStamp() {
        return this.stamp;
    }

    private makeStampPlan(tile: EditModeTile) {
        const stamp = this.stamp;
        if (!stamp) return;
        const plan = planAreaStamp(stamp.area, tile, stamp.options, (id) =>
            this.host?.getStampObjectInfo?.(id),
        );
        // Clear existing grass before placing the template's own floor decorations.
        plan.edits.unshift(...plan.edits.filter(edit => edit.kind === "terrain" && edit.locId > 0)
            .flatMap(edit => this.groundDecorationDeletes(edit)));
        const [width, depth] = stampSize(stamp.area, stamp.options.turns);
        const mapped = new Map<number, boolean>();
        const isMapped = ({ tileX, tileY }: EditModeTile): boolean => {
            const regionId = regionIdOf(tileX, tileY);
            const available = mapped.get(regionId) ?? this.host?.isEditableMapRegion?.(regionId) ?? true;
            mapped.set(regionId, available);
            return available;
        };
        for (let x = tile.tileX >> 6; x <= (tile.tileX + width - 1) >> 6; x++) {
            for (let y = tile.tileY >> 6; y <= (tile.tileY + depth - 1) >> 6; y++) {
                if (!isMapped({ tileX: x << 6, tileY: y << 6, plane: tile.plane })) {
                    throw new Error(`The stamp extends outside the mapped area into region ${(x << 8) | y}. Move it onto mapped ground.`);
                }
            }
        }
        // Heights on the outer north and east edges belong to the next tile.
        // At the edge of the map there is no tile there to store those heights.
        plan.edits = plan.edits.filter((edit) => edit.kind !== "height" || isMapped(edit));
        if (stamp.options.terrain === "all" || !(stamp.options.foundation ?? stamp.area.foundation)) return plan;
        const pendingHeights = new Map<string, number>();
        const pendingFlags = new Map<string, number>();
        const key = (at: EditModeTile) => `${at.tileX}:${at.tileY}:${at.plane}`;
        for (const edit of this.config.edits) {
            if (edit.kind === "height") pendingHeights.set(key(edit), edit.locId);
            if (edit.kind === "flag") pendingFlags.set(key(edit), edit.locId);
        }
        const readHeight = (at: EditModeTile): number | undefined => {
            const value = pendingHeights.get(key(at));
            if (value === undefined) return this.host?.getTerrainHeight?.(at);
            const below = at.plane === 0 ? 0 : readHeight({ ...at, plane: at.plane - 1 });
            return below === undefined ? undefined : below - (value === 1 ? 0 : value) / 16;
        };
        const nearBuilding = (at: EditModeTile): boolean => {
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const vertex = { ...at, tileX: at.tileX + dx, tileY: at.tileY + dy };
                if ((pendingFlags.get(key(vertex)) ?? this.host?.getTerrainFlags?.(vertex) ?? 0) & 4) return true;
            }
            return false;
        };
        const foundation = levelFoundation(tile, width, depth, readHeight, nearBuilding, isMapped);
        plan.edits.unshift(...foundation.map(({ tile: at, height }): EditModeEdit => ({
            ...at, kind: "height", locId: height, shape: 0, rotation: 0,
        })));
        return plan;
    }

    getTerrainBrush(): Readonly<TerrainBrush> {
        return this.terrainBrush;
    }

    private get needsBaseGroundMaterial(): boolean {
        return this.terrainBrush.action === "underlay" && this.terrainBrush.underlay === undefined;
    }

    setTerrainBrush(brush: Partial<TerrainBrush>): void {
        this.finishActiveBrush();
        this.terrainBrush = {
            ...this.terrainBrush,
            ...brush,
            radius: toInt(brush.radius, this.terrainBrush.radius, 0, 10),
            step: toInt(brush.step, this.terrainBrush.step, 1, 64),
            blend: toInt(brush.blend, this.terrainBrush.blend, 1, 100),
            flagMask: toInt(brush.flagMask, this.terrainBrush.flagMask ?? 1, 0, 31),
        };
        if (this.config.tool === "terrain") {
            this.refreshPlacementPreview();
            this.commit();
        } else {
            this.setConfig({ tool: "terrain" });
        }
    }

    getUnderlaySwatches(): readonly import("./types").EditModeOverlaySwatch[] {
        return this.host?.getUnderlaySwatches?.() ?? [];
    }

    private editorRegion() {
        const tile = this.selection ?? this.host?.getCameraTile?.();
        if (!tile) return;
        return { ...regionBounds(regionIdOf(tile.tileX, tile.tileY)), plane: this.config.heightLevel };
    }

    private *regionEdge(edge: MapEdge) {
        const region = this.editorRegion();
        if (!region) return;
        const axisX = edge === "west" || edge === "east";
        const direction = edge === "west" || edge === "south" ? -1 : 1;
        for (let index = 0; index < 64; index++) {
            const tileX = axisX ? (direction < 0 ? region.minX : region.maxX) : region.minX + index;
            const tileY = axisX ? region.minY + index : (direction < 0 ? region.minY : region.maxY);
            yield { tileX, tileY, plane: region.plane, dx: axisX ? direction : 0, dy: axisX ? 0 : direction };
        }
    }

    edgeReport(edge: MapEdge): { sampled: number; steep: number; worst: number } {
        let sampled = 0;
        let steep = 0;
        let worst = 0;
        for (const { dx, dy, ...tile } of this.regionEdge(edge)) {
            const current = this.host?.getTerrainHeight?.(tile);
            const nearby = this.host?.getTerrainHeight?.({ ...tile, tileX: tile.tileX + dx, tileY: tile.tileY + dy });
            if (current === undefined || nearby === undefined) continue;
            sampled++;
            const step = Math.abs(current - nearby);
            if (step >= 0.5) steep++;
            worst = Math.max(step, worst);
        }
        return { sampled, steep, worst };
    }

    alignEdge(edge: MapEdge, blend = 3): number {
        const edits: EditModeEdit[] = [];
        for (const { dx, dy, ...tile } of this.regionEdge(edge)) {
            const outside = this.host?.getTerrainHeight?.({ ...tile, tileX: tile.tileX + dx, tileY: tile.tileY + dy });
            if (outside === undefined) continue;
            for (let index = 0; index <= blend; index++) {
                const inside = { ...tile, tileX: tile.tileX - dx * index, tileY: tile.tileY - dy * index };
                const current = this.host?.getTerrainHeight?.(inside);
                const below = inside.plane === 0 ? 0 : this.host?.getTerrainHeight?.({ ...inside, plane: inside.plane - 1 });
                if (current === undefined || below === undefined) continue;
                const before = heightToByte(current, below);
                const next = sculptHeight(before, heightToByte(outside, below), (blend + 1 - index) / (blend + 1));
                if (next !== before) edits.push({ kind: "height", ...inside, locId: next, shape: 0, rotation: 0 });
            }
        }
        this.commitEdits(edits, false);
        return edits.length;
    }

    clearTileFlagOverlays(): void {
        for (const flag of [1, 2, 4, 8, 16]) this.host?.showTileFlagTiles?.(flag, []);
        this.tileFlagRegionKey = "";
    }

    private get isFlagBrush(): boolean {
        return this.config.tool === "terrain" &&
            (this.terrainBrush.action === "block" || this.terrainBrush.action === "unblock");
    }

    refreshTileFlagOverlays(force = false): void {
        const host = this.host;
        if (!host?.showTileFlagTiles) return;
        const visible = [this.config.showUnwalkableFlags, this.config.showBridgeFlags,
            this.config.showRemoveRoofFlags, this.config.showLowerZFlags, this.config.showDisableRenderFlags];
        const mask = visible.reduce((mask, show, index) => mask | (show ? 1 << index : 0), 0);
        const tile = mask && this.config.active
            ? host.getPointerTile() ?? host.getCameraTile?.() ?? this.selection : undefined;
        const visibleRegions = host.getVisibleRegionIds?.();
        const regions = tile ? visibleRegions?.length ? visibleRegions : [regionIdOf(tile.tileX, tile.tileY)] : [];
        const key = regions.length ? `${regions.join(",")}:${this.config.heightLevel}:${mask}` : "";
        if (!force && this.tileFlagRegionKey === key) return;
        if (!key && !this.tileFlagRegionKey) return;
        this.tileFlagRegionKey = key;
        const tilesByFlag = [1, 2, 4, 8, 16].map(() => [] as EditModeTile[]);
        for (const id of regions) {
            const region = regionBounds(id);
            const plane = this.config.heightLevel;
            const base = host.getBaseRegionFlags?.(id);
            const pending = new Map(this.config.edits.filter((edit) => edit.kind === "flag" && edit.plane === plane &&
                regionIdOf(edit.tileX, edit.tileY) === id)
                .map((edit) => [edit.tileX * 16384 + edit.tileY, edit.locId]));
            for (let tileX = region.minX; tileX <= region.maxX; tileX++) {
                for (let tileY = region.minY; tileY <= region.maxY; tileY++) {
                    const tile = { tileX, tileY, plane };
                    const flags = pending.get(tileX * 16384 + tileY) ??
                        base?.[(plane * 64 + (tileX & 63)) * 64 + (tileY & 63)] ?? host.getTerrainFlags?.(tile) ?? 0;
                    for (let index = 0; index < visible.length; index++) {
                        if (flags & mask & (1 << index)) tilesByFlag[index].push(tile);
                    }
                }
            }
        }
        tilesByFlag.forEach((tiles, index) => host.showTileFlagTiles!(1 << index, tiles));
    }

    validateMapEdits(): { message: string; regionId?: number; tile?: EditModeTile }[] {
        const issues: { message: string; regionId?: number; tile?: EditModeTile }[] = [];
        const badObjects = new Set<string>();
        for (const edit of this.config.edits) {
            if (edit.kind !== "place") continue;
            const shapes = this.host?.getLocPlacementShapes?.(edit.locId);
            if (shapes?.length && !shapes.includes(edit.shape) && edit.shape !== 11) {
                const regionId = regionIdOf(edit.tileX, edit.tileY);
                const key = `${regionId}:${edit.locId}:${edit.shape}`;
                if (badObjects.has(key)) continue;
                badObjects.add(key);
                issues.push({ message: `Object ${edit.locId} has no cache model for shape ${edit.shape}.`, regionId, tile: edit });
            }
        }
        const bounds = this.editorRegion();
        for (const edge of ["west", "east", "south", "north"] as const) {
            const { steep } = this.edgeReport(edge);
            if (steep && bounds) {
                const tileX = edge === "west" ? bounds.minX : edge === "east" ? bounds.maxX : bounds.minX + 32;
                const tileY = edge === "south" ? bounds.minY : edge === "north" ? bounds.maxY : bounds.minY + 32;
                issues.push({
                    message: `The ${edge} edge has ${steep} height steps of at least half a tile.`,
                    regionId: regionIdOf(bounds.minX, bounds.minY),
                    tile: { tileX, tileY, plane: bounds.plane },
                });
            }
        }
        return issues;
    }

    getBrushTiming(): BrushTiming {
        return this.config.brushTiming ?? "release";
    }

    getBrushRadius(): number | undefined {
        if (this.config.tool === "terrain") return this.terrainBrush.radius;
        if (this.config.tool === "scatter") return this.scatter?.radius;
    }

    private resizeBrush(delta: number): boolean {
        const radius = this.getBrushRadius();
        if (radius === undefined) return false;
        const next = Math.max(0, Math.min(10, radius + delta));
        if (next === radius) return true;
        if (this.config.tool === "terrain") this.setTerrainBrush({ radius: next });
        else if (this.scatter) {
            this.finishActiveBrush();
            this.scatter.radius = next;
            this.refreshPlacementPreview();
            this.commit();
        }
        this.noticeListener?.(next === 0 ? "Brush size: one tile" : `Brush radius: ${next} tile${next === 1 ? "" : "s"}`);
        return true;
    }

    private createBrushHeightReader(plane: number, base: readonly EditModeEdit[]): ReadBrushHeight {
        const samples = new Map<number, number>();
        for (const edit of base) {
            if (edit.plane === plane && edit.kind === "height") {
                samples.set(brushTileKey(edit), edit.locId === 1 ? 0 : edit.locId);
            }
        }
        return (tile) => {
            if (tile.tileX < 0 || tile.tileY < 0 || tile.tileX >= 16384 || tile.tileY >= 16384) return;
            const key = brushTileKey(tile);
            const original = samples.get(key);
            if (original !== undefined) return original;
            const height = this.host?.getTerrainHeight?.(tile);
            const below = tile.plane === 0 ? 0 : this.host?.getTerrainHeight?.({ ...tile, plane: tile.plane - 1 });
            if (height === undefined || below === undefined) return;
            const value = heightToByte(height, below);
            samples.set(key, value);
            return value;
        };
    }

    private terrainStrokeEdits(path: readonly EditModeTile[], stroke?: BrushStroke): EditModeEdit[] {
        if (!path.length) return [];
        const brush = this.terrainBrush;
        const first = stroke?.path[0] ?? path[0];
        const last = path[path.length - 1];
        const readHeight = isHeightBrush(brush.action)
            ? stroke?.readHeight ?? this.createBrushHeightReader(first.plane, stroke?.base ?? this.config.edits)
            : undefined;
        if (stroke) stroke.readHeight = readHeight;
        if (readHeight && brush.action !== "natural" && brush.action !== "ramp") {
            return this.sculptStrokeEdits(path, first, readHeight, stroke);
        }
        const pendingFlags = new Map<number, number>();
        if (this.isFlagBrush) {
            for (const edit of this.config.edits) {
                if (edit.plane === first.plane && edit.kind === "flag") pendingFlags.set(brushTileKey(edit), edit.locId);
            }
        }
        const dabs = brushFootprint(brush.action === "ramp" ? [first, last] : path,
            brush.action === "natural" || !readHeight ? { ...brush, soft: false } : brush, stroke?.weights);
        const edits: EditModeEdit[] = [];
        const startHeight = readHeight?.(first);
        const endHeight = brush.action === "ramp" ? readHeight?.(last) : undefined;
        const dx = last.tileX - first.tileX;
        const dy = last.tileY - first.tileY;
        const lengthSquared = dx * dx + dy * dy;
        for (const { weight, ...tile } of dabs) {
            const add = (kind: EditModeEdit["kind"], locId: number) =>
                edits.push({ kind, ...tile, locId, shape: 0, rotation: 0 });
            if (brush.action === "overlay") edits.push(this.paintEdit(tile));
            else if (brush.action === "underlay" && brush.underlay !== undefined) add("underlay", brush.underlay);
            else if (brush.action === "block" || brush.action === "unblock") {
                const flags = pendingFlags.get(brushTileKey(tile)) ?? this.getBaseTileFlags(tile);
                if (flags !== undefined) {
                    const mask = brush.flagMask ?? 1;
                    const next = brush.action === "block" ? flags | mask : flags & ~mask;
                    if (next !== flags && next <= 32) add("flag", next);
                }
            } else if (readHeight) {
                const current = readHeight(tile);
                if (current === undefined) continue;
                let target = brush.action === "natural" ? naturalHeightByte(tile) : current;
                if (brush.action === "ramp" && startHeight !== undefined && endHeight !== undefined && lengthSquared > 0) {
                    const distance = ((tile.tileX - first.tileX) * dx + (tile.tileY - first.tileY) * dy) / lengthSquared;
                    target = startHeight + (endHeight - startHeight) * Math.max(0, Math.min(1, distance));
                }
                const next = sculptHeight(current, target, weight);
                if (next !== current) add("height", next);
            }
        }
        return edits;
    }

    private sculptStrokeEdits(
        path: readonly EditModeTile[], first: EditModeTile, readHeight: ReadBrushHeight, stroke?: BrushStroke,
    ): EditModeEdit[] {
        const brush = this.terrainBrush;
        const heights: BrushHeights = stroke?.heights ?? { values: new Map(), targets: new Map() };
        if (stroke) stroke.heights = heights;
        const readCurrent = (tile: EditModeTile) => heights.values.get(brushTileKey(tile)) ?? readHeight(tile);
        const flattenHeight = brush.action === "flatten" ? readHeight(first) : undefined;
        const blend = brush.action === "smooth" || brush.action === "flatten" ? brush.blend / 100 : 1;
        const edits = new Map<number, EditModeEdit>();
        for (const dabs of brushPasses(path, brush, stroke && (stroke.passes ??= createBrushPassState()))) {
            // Read neighbours before changing any vertex in this dab so smoothing
            // is independent of the order the footprint is visited in.
            const changed: EditModeEdit[] = [];
            for (const { weight, entered, ...tile } of dabs) {
                const key = brushTileKey(tile);
                let pass = entered ? undefined : heights.targets.get(key);
                if (!pass) {
                    const start = readCurrent(tile);
                    if (start === undefined) continue;
                    let target = flattenHeight ?? start;
                    if (brush.action === "raise") target += brush.step;
                    else if (brush.action === "lower") target -= brush.step;
                    else if (brush.action === "smooth") {
                        let sum = start;
                        for (const [dx, dy] of BRUSH_NEIGHBORS) {
                            const x = tile.tileX + dx, y = tile.tileY + dy;
                            if (x < 0 || y < 0 || x >= 16384 || y >= 16384) sum += start;
                            else sum += readCurrent({ ...tile, tileX: x, tileY: y }) ?? start;
                        }
                        target = sum / 5;
                    }
                    heights.targets.set(key, pass = { start, target });
                }
                const next = sculptHeight(pass.start, pass.target, weight * blend);
                if (next !== (heights.values.get(key) ?? pass.start)) {
                    changed.push({ kind: "height", ...tile, locId: next, shape: 0, rotation: 0 });
                }
            }
            for (const edit of changed) {
                const key = brushTileKey(edit);
                heights.values.set(key, edit.locId);
                edits.set(key, edit);
            }
        }
        return [...edits.values()];
    }

    private applyTerrainStroke(stroke: readonly EditModeTile[]): void {
        if (this.needsBaseGroundMaterial) {
            this.noticeListener?.("Choose a base ground material before painting.");
            return;
        }
        const start = stroke[0];
        const end = stroke.at(-1);
        if (this.terrainBrush.action === "ramp" &&
            (!start || !end || (start.tileX === end.tileX && start.tileY === end.tileY))) {
            this.noticeListener?.("Drag to a second tile to grade a ramp.");
            return;
        }
        const edits = this.terrainStrokeEdits(stroke);
        this.commitEdits(edits, edits.every(isTileEdit));
    }

    /** Place the armed stamp at the pointer or a captured Build here area origin. */
    placeStamp(tile: EditModeTile, onPlaced?: () => void): void {
        const stamp = this.stamp;
        if (!stamp || this.stampPlacementPending) return;
        const reportError = (error: unknown) => this.noticeListener?.(error instanceof Error ? error.message : String(error));
        try {
            const plan = this.makeStampPlan(tile);
            if (!plan) return;
            if (!plan.edits.length && !plan.items.length) throw new Error("No contents fit on this level with the selected stamp options");
            const options = stamp.options;
            const priorEdits = this.config.edits;
            const commit = () => {
                if (this.stamp !== stamp || stamp.options !== options || !this.handlesCanvasInput()) return;
                if (this.config.edits !== priorEdits) {
                    this.placeStamp(tile, onPlaced);
                    return;
                }
                const items = plan.items.length ? this.stampItemHistory?.(plan.items) : undefined;
                if (plan.items.length && !items) throw new Error("Open Ground items before stamping item spawns");
                this.commitEdits(plan.edits, false);
                if (items) {
                    if (!plan.edits.length) this.recordItemUndo(items);
                    else {
                        const entry = this.undoStack.at(-1);
                        if (entry) entry.items = items;
                    }
                    items.redo();
                }
                onPlaced?.();
                this.noticeListener?.(`Stamped ${stamp.area.name}${plan.skipped ? ` (${plan.skipped} objects skipped)` : ""}`);
            };
            const regions = new Set(plan.edits.map((edit) => regionIdOf(edit.tileX, edit.tileY)));
            for (const item of plan.items) regions.add(regionIdOf(item.location.x, item.location.y));
            const pending = this.host?.validateStampRegions?.([...regions]);
            if (pending) {
                this.stampPlacementPending = true;
                this.noticeListener?.("Loading map data for the stamp…");
                void pending.finally(() => { this.stampPlacementPending = false; }).then(commit).catch(reportError);
            } else {
                commit();
            }
        } catch (error) {
            reportError(error);
        }
    }

    /** The selected southwest tile is captured by the UI before its asynchronous clipboard read. */
    pasteArea(contents: string, destination: EditModeTile | undefined = this.selection): void {
        if (!destination || !this.host?.exportRegionPack) throw new Error("Select a destination tile with loaded map data");
        const edits = areaPasteEdits(contents, destination, this.host.hasWideTerrain?.() ?? true);
        const combined = [...this.config.edits, ...edits];
        const regions = new Map<number, EditModeTile>();
        for (const edit of edits) if (edit.kind !== "npc") regions.set(regionIdOf(edit.tileX, edit.tileY), edit);
        // Prepare every destination pack before changing edits, NPCs or undo history.
        const packs = [...regions.values()].map(tile => this.host!.exportRegionPack!(tile, combined));
        if (oversizedRegionPacks(packs).length) throw new Error("Pasted area exceeds the region packet limit");
        this.commitEdits(edits, false);
    }

    private islandArea() {
        const range = this.getSelectionRange();
        if (!range || range.plane !== 0 || range.maxX - range.minX < 2 || range.maxY - range.minY < 2 || !this.host?.isWaterOverlay || !this.host.getTerrainHeight) return;
        try {
            return waterArea(this.copyArea(), this.host.isWaterOverlay);
        } catch {
            return undefined;
        }
    }

    canGenerateIsland(): boolean {
        return this.islandArea() !== undefined;
    }

    generateIsland(): void {
        const area = this.islandArea();
        if (!area) return;
        const sample = this.host?.getTerrainHeight;
        if (!sample) return;
        const heights = new Map<string, number>();
        for (let x = 1; x < area.width; x++) {
            for (let y = 1; y < area.height; y++) {
                const tileX = area.origin.x + x, tileY = area.origin.y + y;
                const height = sample({ tileX, tileY, plane: 0 });
                if (height === undefined) return;
                heights.set(`${tileX}:${tileY}`, height);
            }
        }
        this.commitEdits(generateIslandEdits(area, Math.random, (x, y) => heights.get(`${x}:${y}`)!), false);
    }

    clearArea(): void {
        const range = this.getSelectionRange();
        if (!range) return;
        this.commitEdits(clearAreaEdits(range));
    }

    flattenArea(): void {
        const range = this.getSelectionRange();
        const sample = this.host?.getTerrainHeight;
        if (!range || !sample) return;
        const circumference: number[] = [];
        for (let tileX = range.minX - 1; tileX <= range.maxX + 1; tileX++) {
            for (let tileY = range.minY - 1; tileY <= range.maxY + 1; tileY++) {
                if (tileX !== range.minX - 1 && tileX !== range.maxX + 1 && tileY !== range.minY - 1 && tileY !== range.maxY + 1) continue;
                const height = sample({ tileX, tileY, plane: range.plane });
                if (height !== undefined) circumference.push(height);
            }
        }
        if (circumference.length === 0) return;
        circumference.sort((a, b) => a - b);
        const targetHeight = circumference[Math.floor(circumference.length / 2)];
        const edits: EditModeEdit[] = [];
        for (let tileX = range.minX; tileX <= range.maxX + 1; tileX++) {
            for (let tileY = range.minY; tileY <= range.maxY + 1; tileY++) {
                const below = range.plane === 0
                    ? 0
                    : sample({ tileX, tileY, plane: range.plane - 1 });
                if (below === undefined) continue;
                edits.push({
                    kind: "height",
                    locId: Math.max(0, Math.min(255, Math.round((below - targetHeight) * 16))),
                    tileX,
                    tileY,
                    plane: range.plane,
                    shape: 0,
                    rotation: 0,
                });
            }
        }
        this.commitEdits(edits);
    }

    /**
     * Raises (positive) or lowers the selected tiles by delta height bytes, sloping `smoothing`
     * rings of the surrounding ground to meet them. A corner moves that one vertex of a selected
     * tile instead.
     */
    adjustHeight(delta: number, smoothing: number, corner?: TileCorner): void {
        // An object's tile counts: most ground has decoration on it that a click selects first.
        const tile = this.isGroundSelection() || this.selection?.kind === "loc" ? this.selection : undefined;
        const sample = this.host?.getTerrainHeight;
        if (!tile || !sample || delta === 0) return;
        const range = this.getSelectionRange();
        const vertices = range
            ? { minX: range.minX, maxX: range.maxX + 1, minY: range.minY, maxY: range.maxY + 1 }
            : corner
              ? cornerVertex(tile, corner)
              : { minX: tile.tileX, maxX: tile.tileX + 1, minY: tile.tileY, maxY: tile.tileY + 1 };
        // The scene rebuild is async: pending edits are the truth, or repeat clicks would not add up.
        const plane = tile.plane;
        const pending = new Map<string, number>();
        for (const edit of this.config.edits) {
            if (edit.kind === "height" && edit.plane === plane) pending.set(`${edit.tileX}:${edit.tileY}`, edit.locId);
        }
        const changed = adjustHeightBytes(vertices, delta, Math.max(0, smoothing), (tileX, tileY) => {
            const known = pending.get(`${tileX}:${tileY}`);
            if (known !== undefined) return known;
            const height = sample({ tileX, tileY, plane });
            const below = plane === 0 ? 0 : sample({ tileX, tileY, plane: plane - 1 });
            return height === undefined || below === undefined ? undefined : heightToByte(height, below);
        });
        this.commitEdits(changed.map(({ tileX, tileY, height }) => ({
            kind: "height" as const,
            locId: height,
            tileX,
            tileY,
            plane,
            shape: 0,
            rotation: 0,
        })));
    }

    loadMinimap(): Promise<Blob | undefined> {
        const tile = this.getCameraTile() ?? this.selection;
        return tile ? this.host?.loadMinimap?.(tile) ?? Promise.resolve(undefined) : Promise.resolve(undefined);
    }

    private getBaseTileFlags(tile: EditModeTile): number | undefined {
        const base = this.host?.getBaseRegionFlags?.(regionIdOf(tile.tileX, tile.tileY));
        return base?.[(tile.plane * 64 + (tile.tileX & 63)) * 64 + (tile.tileY & 63)] ?? this.host?.getTerrainFlags?.(tile);
    }

    /** RSPSi's Tile Height SET control edits the selected vertices in one undo step. */
    setSelectedTileHeight(height: number, absolute: boolean): void {
        const tile = this.isGroundSelection() || this.selection?.kind === "loc" ? this.selection : undefined;
        if (!tile || !Number.isInteger(height) || height < 0 || height > 255) return;
        this.finishActiveBrush();
        const range = this.getSelectionRange();
        const minX = range?.minX ?? tile.tileX;
        const maxX = (range?.maxX ?? tile.tileX) + 1;
        const minY = range?.minY ?? tile.tileY;
        const maxY = (range?.maxY ?? tile.tileY) + 1;
        const pending = new Map(this.config.edits.filter(edit => edit.kind === "height" && edit.plane === tile.plane)
            .map(edit => [`${edit.tileX}:${edit.tileY}`, edit.locId]));
        const edits: EditModeEdit[] = [];
        for (let tileX = minX; tileX <= maxX; tileX++) for (let tileY = minY; tileY <= maxY; tileY++) {
            const at = { tileX, tileY, plane: tile.plane };
            const current = this.host?.getTerrainHeight?.(at);
            const below = at.plane === 0 ? 0 : this.host?.getTerrainHeight?.({ ...at, plane: at.plane - 1 });
            if (current === undefined || below === undefined) continue;
            const previous = pending.get(`${tileX}:${tileY}`) ?? heightToByte(current, below);
            const requested = absolute ? height : Math.min(255, height + previous);
            const value = requested === 1 ? 2 : requested;
            edits.push({ ...at, kind: "height", locId: value, shape: 0, rotation: 0 });
        }
        if (edits.length) this.commitEdits(edits);
    }

    /** Selects the whole map region the selection (or else the camera) is in. */
    selectRegion(): void {
        const tile = this.selection ?? this.host?.getCameraTile?.();
        if (!tile || !this.host?.selectTileRange) return;
        const bounds = regionBounds(regionIdOf(tile.tileX, tile.tileY));
        this.selection = this.host.selectTileRange(
            { tileX: bounds.minX, tileY: bounds.minY, plane: tile.plane },
            { tileX: bounds.maxX, tileY: bounds.maxY, plane: tile.plane },
        );
        this.commit();
    }

    /** Moves the camera to "x, y", "x, y, plane" or a region id. False when the text is neither. */
    goToLocation(text: string): boolean {
        const location = parseEditorLocation(text);
        if (!location) return false;
        this.finishActiveBrush();
        this.cancelLineStart();
        this.jumpToTile(location.tileX, location.tileY, location.plane ?? this.config.heightLevel);
        // A selection left behind would otherwise still be what Select region acts on.
        this.selection = undefined;
        this.host?.clearSelectionHighlight?.();
        if (location.plane !== undefined && location.plane !== this.config.heightLevel) this.setConfig({ heightLevel: location.plane });
        else this.commit();
        return true;
    }

    /** Told the tile under the pointer as it moves; too frequent for the state listeners. */
    setPointerTileListener(listener: ((tile: EditModeTile | undefined) => void) | undefined): void {
        this.pointerTileListener = listener;
    }

    /** Told why a click did nothing, e.g. a fill on a tile with no overlay. */
    setNoticeListener(listener: ((message: string) => void) | undefined): void {
        this.noticeListener = listener;
    }

    /** The fill tool's work at a tile: the overlay there and everything joined to it, repainted. */
    private overlayFill(tile: EditModeTile): OverlayFillResult {
        const host = this.host;
        if (!host?.getRegionOverlays) return { error: "unloaded" };
        if (this.regionOverlaysEdits !== this.config.edits) {
            this.regionOverlays.clear();
            this.regionOverlaysEdits = this.config.edits;
        }
        return fillOverlay(tile, this.config.overlayId, (regionId) => {
            if (!this.regionOverlays.has(regionId)) {
                this.regionOverlays.set(regionId, host.getRegionOverlays!(regionId, this.config.edits));
            }
            return this.regionOverlays.get(regionId);
        });
    }

    private fillAt(tile: EditModeTile): void {
        this.host?.clearTerrainPreview?.();
        const fill = this.overlayFill(tile);
        if ("edits" in fill) {
            this.commitEdits(fill.edits);
            return;
        }
        this.noticeListener?.({
            "unloaded": "That tile's map region has not loaded",
            "no-overlay": "Nothing to fill: this tile has no overlay",
            "same-overlay": "This area already has the chosen overlay",
            "too-large": `Too big to fill: the area is over ${MAX_FILL_TILES.toLocaleString()} tiles`,
        }[fill.error]);
    }

    refreshMap(): void {
        this.refreshWorldDefinition();
        // Region replacements carry clearing and height changes; rebuilding them
        // is the only refresh that cannot race the generated locs. Pull server state
        // first so agent edits show up in the logged-out preview, then always rebuild
        // this session's own edits: the sync is a no-op in browser-host mode and when
        // the server has no replacements, and it only covers regions it touched.
        const sync = this.host?.syncServerReplacements;
        if (!sync) {
            this.refreshSpecialRegions(this.config.edits);
            return;
        }
        void sync.call(this.host).finally(() => this.refreshSpecialRegions(this.config.edits));
    }

    /** Re-applies every stored edit to the scene, e.g. after a login or map reload. */
    reapply(): void {
        for (const edit of this.config.edits) {
            this.dispatch(edit);
        }
        this.refreshSpecialRegions(this.config.edits);
    }

    /** Recreate only editor-placed NPCs after their map square is rebuilt. */
    reapplyNpcsForMap(mapX: number, mapY: number): void {
        const host = this.host;
        if (!host) return;
        for (const edit of this.config.edits) {
            if (edit.kind !== "npc" || (edit.tileX >> 6) !== mapX || (edit.tileY >> 6) !== mapY) {
                continue;
            }
            const key = npcKey(edit);
            const previousId = this.spawnedNpcs.get(key);
            if (previousId !== undefined) host.despawnNpc(previousId);
            const serverId = host.spawnNpc(
                edit.locId,
                { tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane },
                edit.rotation,
                edit.direction,
            );
            if (serverId !== undefined) this.spawnedNpcs.set(key, serverId);
        }
    }

    /** Takes back the last action as a whole, however many tiles it touched. */
    undo(): boolean {
        if (this.terrainPreview) return false;
        this.finishActiveBrush();
        if (this.movingSelection) this.setConfig({ tool: "select" });
        const entry = this.undoStack.pop();
        if (!entry) return false;
        this.redoStack.push(entry);
        if (entry.regions) this.swapMapSquares(entry.regions.after, entry.regions.before);
        else {
            this.swapEdits(entry.start, entry.added, entry.removed, entry.rebuildOnly);
            entry.items?.undo();
        }
        return true;
    }

    /** Puts back the last action undo took, until a new edit starts a different history. */
    redo(): boolean {
        if (this.terrainPreview) return false;
        this.finishActiveBrush();
        if (this.movingSelection) this.setConfig({ tool: "select" });
        const entry = this.redoStack.pop();
        if (!entry) return false;
        this.undoStack.push(entry);
        if (entry.regions) this.swapMapSquares(entry.regions.before, entry.regions.after);
        else {
            if (entry.scattered) this.host?.previewScatteredLocs?.(entry.added);
            this.swapEdits(entry.start, entry.removed, entry.added, entry.rebuildOnly);
            entry.items?.redo();
        }
        return true;
    }

    /** Replaces one span of the edit list and brings the scene into line with the result. */
    private swapEdits(
        start: number,
        outgoing: readonly EditModeEdit[],
        incoming: readonly EditModeEdit[],
        rebuildOnly = false,
    ): void {
        for (const edit of outgoing) {
            if (!rebuildOnly || !isTileEdit(edit)) this.revert(edit);
        }

        const next = [...this.config.edits];
        next.splice(start, outgoing.length, ...incoming);
        this.undoRestoring = true;
        try {
            this.setConfig({ edits: next });
        } finally {
            this.undoRestoring = false;
        }

        // Whatever was underneath on the same tiles shows again, restored edits among it.
        const tileKey = (edit: EditModeEdit) => `${edit.tileX},${edit.tileY},${edit.plane}`;
        const changed = [...outgoing, ...incoming];
        const touched = new Set(rebuildOnly ? [] : changed.filter(isTileEdit).map(tileKey));
        for (const edit of this.config.edits) {
            if (isTileEdit(edit) && touched.has(tileKey(edit))) this.dispatch(edit);
        }
        for (const edit of incoming) {
            if (!isTileEdit(edit) && (!rebuildOnly || edit.kind === "npc")) this.dispatch(edit);
        }
        this.refreshSpecialRegions(changed, this.config.edits, true);
    }

    /** Counts everything fn does to the edit list as one undo step. */
    private undoGroup(fn: () => void): void {
        if (this.undoGroupBase !== undefined) {
            fn();
            return;
        }
        const base = this.config.edits;
        this.undoGroupBase = base;
        try {
            fn();
        } finally {
            this.undoGroupBase = undefined;
            this.recordUndo(base);
        }
    }

    private recordUndo(before: readonly EditModeEdit[], rebuildOnly = false, scattered = false): void {
        if (this.undoRestoring) return;
        const entry = diffEdits(before, this.config.edits);
        if (!entry) return;
        if (rebuildOnly) entry.rebuildOnly = true;
        if (scattered) entry.scattered = true;
        this.undoStack.push(entry);
        this.redoStack = [];
        if (this.undoStack.length > MAX_UNDO_ENTRIES) this.undoStack.shift();
    }

    clearEdits(): void {
        this.finishBrushStroke(false);
        if (this.movingSelection) this.setConfig({ tool: "select" });
        const edits = this.config.edits;
        for (const edit of edits) {
            if (edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "terrain") this.revert(edit);
        }
        this.setConfig({ edits: [] });
        this.refreshSpecialRegions(edits, []);
    }

    private revert(edit: EditModeEdit): void {
        if (edit.kind === "npc") {
            const key = npcKey(edit);
            const serverId = this.spawnedNpcs.get(key);
            if (serverId !== undefined) {
                this.host?.despawnNpc(serverId);
                this.spawnedNpcs.delete(key);
            }
            return;
        }
        if (edit.kind === "npcDelete") {
            this.host?.showNpcSpawn?.({
                id: edit.locId,
                tileX: edit.tileX,
                tileY: edit.tileY,
                plane: edit.plane,
            });
            return;
        }
        if (edit.kind === "terrain") {
            this.host?.clearTerrainOverride({
                tileX: edit.tileX,
                tileY: edit.tileY,
                plane: edit.plane,
            });
            return;
        }
        if (edit.kind === "place") {
            const tile = { x: edit.tileX, y: edit.tileY };
            this.host?.onLocDel(tile, edit.plane, edit.shape, edit.rotation);
            // A loc that only exists in a rebuilt region pack leaves with the pack, not an override.
            this.host?.restoreLoc?.(tile, edit.plane, edit.shape, edit.rotation);
            return;
        }
        if (edit.kind === "delete") {
            this.host?.restoreLoc?.({ x: edit.tileX, y: edit.tileY }, edit.plane, edit.shape, edit.rotation);
        }
    }

    private isGroundSelection(): boolean {
        const kind = this.selection?.kind;
        return this.selection !== undefined && kind !== "loc" && kind !== "npc" && kind !== "building";
    }

    /** Applies the active tool at the tile under the pointer. */
    applyAtPointer(buildingSelect = this.buildingSelect): void {
        const host = this.host;
        const tile = host?.getPointerTile();
        if (!host) return;
        if (this.isSelectingBuilding(buildingSelect) && host.selectBuilding) {
            this.selection = host.selectBuilding(tile);
            this.commit();
            return;
        }
        if (!tile) return;
        if (this.config.tool === "pick") {
            const pick = this.tilePick;
            const selection = host.selectPointer?.(tile, this.tilePickObjectsOnly);
            this.setConfig({ tool: "select" });
            host.clearSelectionHighlight?.();
            pick?.(tile, selection?.kind === "loc" ? selection : undefined);
            return;
        }

        if (this.config.tool === "select") {
            if (this.selectionMode === "ground") {
                this.selection = host.selectTileRange?.(tile, tile) ?? { ...tile, kind: "ground", locId: -1, locName: "" };
                this.commit();
                return;
            }
            const loc = host.getPointerLoc();
            this.selection =
                host.selectPointer?.(tile) ??
                (loc ? { ...tile, ...loc } : { ...tile, locId: -1, locName: "" });
            this.commit();
            return;
        }

        if (this.config.tool === "delete" && host.selectPointer) {
            const selected = host.selectPointer(tile, true);
            if (selected?.kind === "loc") {
                this.selection = selected;
                this.deleteSelection();
            } else {
                this.selection = undefined;
                host.clearSelectionHighlight?.();
                this.commit();
            }
            return;
        }

        if (this.config.tool === "terrain") {
            this.applyTerrainStroke([tile]);
            return;
        }
        if (this.config.tool === "scatter") {
            this.applyScatter([tile]);
            return;
        }

        if (this.config.tool === "path") {
            this.extendPath(tile);
            return;
        }

        if (this.config.tool === "wall") {
            this.extendWall(tile);
            return;
        }

        if (this.config.tool === "fill") {
            this.fillAt(tile);
            return;
        }

        if (this.config.tool === "stamp") {
            this.placeStamp(tile);
            return;
        }

        const placingNpc = this.config.tool === "place" && this.config.placeKind === "npc";
        if (this.config.tool === "place") this.clearPlacementPreview();
        const edit: EditModeEdit = {
            kind: this.config.tool !== "place" ? "delete" : placingNpc ? "npc" : "place",
            locId: placingNpc
                ? this.config.npcId
                : this.config.tool === "place"
                  ? this.config.locId
                  : 0,
            tileX: tile.tileX,
            tileY: tile.tileY,
            plane: tile.plane,
            shape: this.config.shape,
            rotation: this.config.rotation,
        };
        const moving = this.movingSelection;
        if (moving && placingNpc && moving.kind === "npc") {
            this.movingSelection = undefined;
            this.selection = undefined;
            host.clearSelectionHighlight?.();
            const customIndex = this.customNpcEditIndex(moving);
            // Moving a spawn away leaves the tile's removal markers in place, exactly as deleting it does: a
            // replacement's marker suppresses the canonical spawn (otherwise the original returns beside the
            // moved copy), and a stacked sibling's marker keeps that one deleted.
            this.undoGroup(() => {
                this.removeEdits(customIndex < 0 && moving.npcSource === "spawn"
                    ? this.spawnEditsLeavingTile(moving)
                    : this.npcReplacementIndicesAt(moving));
                if (moving.npcWanderRadius !== undefined) edit.wanderRadius = moving.npcWanderRadius;
                if (moving.npcLeashRadius !== undefined) edit.leashRadius = moving.npcLeashRadius;
                if (moving.npcSpawn?.direction !== undefined) edit.direction = moving.npcSpawn.direction;
                if (customIndex < 0) {
                    if (moving.npcSource === "spawn") {
                        this.commitEdits([{
                            kind: "npcDelete",
                            locId: moving.locId,
                            tileX: moving.tileX,
                            tileY: moving.tileY,
                            plane: moving.plane,
                            shape: 0,
                            rotation: 0,
                        }], true, this.npcMarkerIndexAt(moving));
                    } else if (moving.npcServerId !== undefined) {
                        this.host?.despawnNpc(moving.npcServerId);
                    }
                }
                this.commitEdits([edit]);
            });
            this.setConfig({ tool: "select" });
        } else if (moving && edit.kind === "place") {
            this.movingSelection = undefined;
            this.selection = undefined;
            host.clearSelectionHighlight?.();
            this.commitEdits([{
                kind: "delete", locId: 0,
                tileX: moving.tileX, tileY: moving.tileY, plane: moving.plane,
                shape: moving.shape ?? this.config.shape,
                rotation: moving.rotation ?? this.config.rotation,
            }, edit]);
            this.setConfig({ tool: "select" });
        } else {
            this.commitEdits([edit]);
        }
    }

    /**
     * First click sets the path start, second click paints the run between
     * them, without altering adjacent tiles.
     */
    private extendPath(tile: EditModeTile): void {
        const start = this.pathStart;
        if (!start || start.plane !== tile.plane) {
            this.pathStart = tile;
            this.commit();
            return;
        }

        this.host?.clearTerrainPreview?.();
        this.pathStart = undefined;
        this.commitEdits(this.pathEdits(start, tile));
    }

    private pathEdits(start: EditModeTile, end: EditModeTile): EditModeEdit[] {
        const tiles = createPathTiles(
            { x: start.tileX, y: start.tileY },
            { x: end.tileX, y: end.tileY },
        ).slice(0, MAX_DRAW_TILES);
        const editable = new Set(tiles.map((tile) => `${tile.x}:${tile.y}`));
        const path = new Set(
            this.config.edits
                .filter(
                    (edit) =>
                        edit.kind === "terrain" &&
                        edit.locId === this.config.overlayId &&
                        edit.plane === end.plane &&
                        (edit.shape === 0 || edit.shape === 5),
                )
                .map((edit) => `${edit.tileX}:${edit.tileY}`),
        );
        for (const tile of tiles) path.add(`${tile.x}:${tile.y}`);
        return buildPathCorners(path, editable).flatMap((tile) => [
            ...this.groundDecorationDeletes({ tileX: tile.x, tileY: tile.y, plane: end.plane }),
            this.terrainEdit(
                { tileX: tile.x, tileY: tile.y, plane: end.plane },
                tile.overlayShape,
                tile.overlayRotation,
            ),
        ]);
    }

    /** LOC_DEL matches rotation, so clear every floor-decoration variant. */
    private groundDecorationDeletes(tile: EditModeTile): EditModeEdit[] {
        return [0, 1, 2, 3].map((rotation) => ({
            kind: "delete" as const,
            locId: 0,
            tileX: tile.tileX,
            tileY: tile.tileY,
            plane: tile.plane,
            shape: LOC_SHAPE_FLOOR_DECORATION,
            rotation,
        }));
    }

    private extendWall(tile: EditModeTile): void {
        const start = this.wallStart;
        if (!start) {
            this.wallStart = tile;
            this.commit();
            return;
        }
        if (start.plane !== tile.plane) {
            this.noticeListener?.(`Choose an end tile on floor ${start.plane}, or press Esc to start over.`);
            return;
        }
        const walls = this.wallLocEdits(start, tile, this.wallBrush);
        if (!walls.length) {
            this.noticeListener?.("Wall openings need at least three tiles. Choose a farther end tile.");
            return;
        }
        this.wallStart = undefined;
        this.clearPlacementPreview();
        this.commitEdits([...walls, ...this.wallHeightEdits(walls)]);
    }

    private paintEdit(tile: EditModeTile): EditModeEdit {
        return this.terrainEdit(tile, this.config.overlayShape, this.config.overlayRotation);
    }

    private terrainEdit(
        tile: EditModeTile,
        shape: number,
        rotation: number,
        overlayId = this.config.overlayId,
    ): EditModeEdit {
        return {
            kind: "terrain",
            locId: overlayId,
            tileX: tile.tileX,
            tileY: tile.tileY,
            plane: tile.plane,
            shape,
            rotation,
        };
    }

    getWallBrush(): Readonly<WallBrush> {
        return this.wallBrush;
    }

    setWallBrush(options: Partial<WallBrush>): void {
        if (options.mode !== undefined && options.mode !== this.wallBrush.mode) this.wallRotationOverride = undefined;
        if (options.diagonal !== undefined && options.diagonal !== this.wallBrush.diagonal) this.wallBrush.diagonalJoin = null;
        this.wallBrush = { ...this.wallBrush, ...options };
        this.refreshPlacementPreview();
        this.commit();
    }

    private wallLocEdits(start: EditModeTile, end: EditModeTile, brush: WallBrush): EditModeEdit[] {
        return planWallRun(start, end, brush, MAX_DRAW_TILES, this.wallRotationOverride).filter((wall) =>
            wall.shape !== 1 || this.host?.isEditableMapRegion?.(regionIdOf(wall.tileX, wall.tileY)) !== false,
        );
    }

    /** Levels the edge beneath each wall segment without flattening adjacent terrain. */
    private wallHeightEdits(walls: readonly EditModeEdit[]): EditModeEdit[] {
        const sample = this.host?.getTerrainHeight;
        const target = this.wallTargetHeight(walls);
        if (!sample || target === undefined) return [];
        return this.wallVertices(walls).flatMap((tile) => {
            const below = tile.plane === 0 ? 0 : sample({ ...tile, plane: tile.plane - 1 });
            if (below === undefined) return [];
            return [{
                kind: "height" as const,
                locId: Math.max(0, Math.min(255, Math.round((below - target) * 16))),
                ...tile,
                shape: 0,
                rotation: 0,
            }];
        });
    }

    private wallTargetHeight(walls: readonly EditModeEdit[]): number | undefined {
        const sample = this.host?.getTerrainHeight;
        if (!this.wallBrush.flatten || !sample || walls.length === 0) return undefined;
        const heights = this.wallVertices(walls)
            .map(sample)
            .filter((height): height is number => height !== undefined)
            .sort((a, b) => a - b);
        return heights.length === 0 ? undefined : heights[Math.floor(heights.length / 2)];
    }

    private wallVertices(walls: readonly EditModeEdit[]): EditModeTile[] {
        const vertices = new Map<string, EditModeTile>();
        for (const wall of walls) {
            for (const [x, y] of [
                [wall.tileX, wall.tileY],
                [wall.tileX + 1, wall.tileY],
                [wall.tileX + 1, wall.tileY + 1],
                [wall.tileX, wall.tileY + 1],
            ]) {
                if (x > WORLD_COORD_MAX || y > WORLD_COORD_MAX || this.host?.isEditableMapRegion?.(regionIdOf(x, y)) === false) continue;
                const tile = { tileX: x, tileY: y, plane: wall.plane };
                vertices.set(`${x}:${y}:${tile.plane}`, tile);
            }
        }
        return [...vertices.values()];
    }

    /** `index`: where the edits go in the list (and so in the saved patch); the end by default. */
    private commitEdits(edits: EditModeEdit[], applyImmediately = true, index = this.config.edits.length): void {
        if (edits.length === 0) return;
        for (const edit of edits) {
            if (applyImmediately || edit.kind === "npc") this.dispatch(edit);
        }
        const next = [...this.config.edits.slice(0, index), ...edits, ...this.config.edits.slice(index)];
        this.setConfig({ edits: next });
        if (!applyImmediately && this.undoGroupBase === undefined) {
            const entry = this.undoStack.at(-1);
            if (entry) entry.rebuildOnly = true;
        }
        this.refreshSpecialRegions(edits, next, false, !applyImmediately);
    }

    private recordItemUndo(items: NonNullable<UndoEntry["items"]>): void {
        this.undoStack.push({ start: 0, added: [], removed: [], items });
        if (this.undoStack.length > MAX_UNDO_ENTRIES) this.undoStack.shift();
        this.redoStack = [];
    }

    private dispatch(edit: EditModeEdit): void {
        const host = this.host;
        if (!host) return;

        if (edit.kind === "npc") {
            const key = npcKey(edit);
            const existing = this.spawnedNpcs.get(key);
            if (existing !== undefined) host.despawnNpc(existing);
            const serverId = host.spawnNpc(
                edit.locId,
                { tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane },
                edit.rotation,
                edit.direction,
            );
            if (serverId !== undefined) this.spawnedNpcs.set(key, serverId);
            return;
        }

        if (edit.kind === "npcDelete") {
            host.hideNpcSpawn?.({
                id: edit.locId,
                tileX: edit.tileX,
                tileY: edit.tileY,
                plane: edit.plane,
            });
            return;
        }

        if (edit.kind === "npcWander") return;

        if (edit.kind === "terrain") {
            host.setTerrainOverlay(
                { tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane },
                edit.locId,
                edit.shape,
                edit.rotation,
            );
            return;
        }

        if (edit.kind === "clear" || edit.kind === "height" || edit.kind === "flag" || edit.kind === "underlay") return;

        const tile = { x: edit.tileX, y: edit.tileY };
        if (edit.kind === "place") {
            host.onLocAddChange(edit.locId, tile, edit.plane, edit.shape, edit.rotation);
        } else {
            host.onLocDel(tile, edit.plane, edit.shape, edit.rotation);
        }
    }

    private getSelectionRange(): TileRange | undefined {
        const selection = this.selection;
        if (
            !selection ||
            selection.tileEndX === undefined ||
            selection.tileEndY === undefined ||
            (selection.tileEndX === selection.tileX && selection.tileEndY === selection.tileY)
        ) {
            return undefined;
        }
        return {
            minX: Math.min(selection.tileX, selection.tileEndX),
            maxX: Math.max(selection.tileX, selection.tileEndX),
            minY: Math.min(selection.tileY, selection.tileEndY),
            maxY: Math.max(selection.tileY, selection.tileEndY),
            plane: selection.plane,
        };
    }

    private refreshSpecialRegions(
        edits: readonly EditModeEdit[],
        allEdits: readonly EditModeEdit[] = this.config.edits,
        includeBakedEdits = false,
        rebuildTileEdits = false,
    ): void {
        const regions = new Set<number>();
        for (const edit of edits) {
            const region = regionIdOf(edit.tileX, edit.tileY);
            if (edit.kind === "clear" || edit.kind === "height" || edit.kind === "flag" || edit.kind === "underlay" ||
                (isTileEdit(edit) && (rebuildTileEdits || (includeBakedEdits && this.rebuiltRegions.has(region))))) {
                regions.add(region);
            }
        }
        // A rebuilt region's pack holds its loc and overlay edits too, so taking one back needs another.
        for (const region of regions) this.rebuiltRegions.add(region);
        if (regions.size > 0) this.host?.refreshEditedRegions?.([...regions], allEdits);
    }

    /** Whether canvas clicks and shortcuts are being intercepted right now. */
    handlesCanvasInput(): boolean {
        return this.capturing && this.hasEditableScene();
    }

    /**
     * There is only something to edit once a scene is on screen. Without this
     * the armed plugin swallows every canvas click, which on the login screen
     * means the buttons and form stop responding entirely.
     */
    private hasEditableScene(): boolean {
        return this.scenePreview || this.host?.isLoggedIn() === true;
    }

    private flushLiveBrush(stroke: BrushStroke): void {
        if (stroke.frame !== undefined) cancelAnimationFrame(stroke.frame);
        stroke.frame = undefined;
        if (stroke.applied >= stroke.path.length) return;
        const path = stroke.path.slice(Math.max(0, stroke.applied - 1));
        const scatter = this.config.tool === "scatter";
        const edits = scatter ? this.scatterEdits(path, stroke) : this.terrainStrokeEdits(path, stroke);
        stroke.applied = stroke.path.length;
        if (!edits.length) return;
        stroke.rebuildOnly = scatter || this.terrainBrush.action !== "overlay";
        for (const edit of edits) stroke.tileEdits.set(brushTileKey(edit), edit);
        if (!stroke.rebuildOnly) {
            for (const edit of edits) this.dispatch(edit);
        }
        const next = [...stroke.base, ...stroke.tileEdits.values()];
        this.config = { ...this.config, edits: next };
        if (scatter && this.host?.previewScatteredLocs) {
            // The scenery overlay supplies live feedback; update the workspace once when the stroke ends.
            this.state = { ...this.state, config: this.config };
            this.host.previewScatteredLocs(edits);
            return;
        }
        this.commit(false);
        this.refreshSpecialRegions(edits, next, false, stroke.rebuildOnly);
    }

    finishActiveBrush(): void {
        this.finishBrushStroke(this.brushStroke?.live === true);
    }

    private finishBrushStroke(applyPending: boolean): void {
        const stroke = this.brushStroke;
        if (!stroke) return;
        this.brushStroke = undefined;
        this.pointer = undefined;
        if (stroke.live) {
            if (applyPending) this.flushLiveBrush(stroke);
            else if (stroke.frame !== undefined) cancelAnimationFrame(stroke.frame);
            const scatter = this.config.tool === "scatter";
            this.recordUndo(stroke.base, stroke.rebuildOnly, scatter);
            if (scatter && this.host?.previewScatteredLocs && stroke.tileEdits.size) {
                this.commit(false);
                this.refreshSpecialRegions([...stroke.tileEdits.values()], this.config.edits, false, true);
            }
            if (applyPending && this.config.tool === "scatter" && this.scatter) {
                const count = stroke.tileEdits.size;
                this.noticeListener?.(count ? `Scattered ${count} objects` : "No clear tiles received scenery");
            }
        } else if (applyPending) {
            if (this.config.tool === "terrain") this.applyTerrainStroke(stroke.path);
            else if (this.config.tool === "scatter") this.applyScatter(stroke.path);
        }
    }

    cancelBrushStroke(): boolean {
        const stroke = this.brushStroke;
        if (!stroke) return false;
        this.brushStroke = undefined;
        this.pointer = undefined;
        if (stroke.frame !== undefined) cancelAnimationFrame(stroke.frame);
        if (stroke.tileEdits.size) this.swapEdits(stroke.base.length, [...stroke.tileEdits.values()], [], stroke.rebuildOnly);
        this.refreshPlacementPreview();
        return true;
    }

    private extendBrushStroke(tile: EditModeTile | undefined): void {
        const stroke = this.brushStroke;
        const last = stroke?.path.at(-1);
        if (!stroke || !last || !tile || tile.plane !== last.plane || stroke.path.length >= MAX_DRAW_TILES ||
            (tile.tileX === last.tileX && tile.tileY === last.tileY)) return;
        stroke.path.push(tile);
        if (this.config.tool !== "scatter") this.updateBrushPreview(stroke, [last, tile]);
        if (stroke.live && stroke.frame === undefined) {
            if (typeof requestAnimationFrame === "function") stroke.frame = requestAnimationFrame(() => this.flushLiveBrush(stroke));
            else this.flushLiveBrush(stroke);
        }
    }

    private readonly onWindowBlur = (): void => {
        this.finishActiveBrush();
        this.pointer = undefined;
        this.cameraPointer = undefined;
        this.buildingSelect = false;
        this.resetCameraInput();
        this.clearPlacementPreview();
    };

    private readonly preventMiddlePaste = (event: MouseEvent): void => {
        if (event.button !== 1 || !this.handlesCanvasInput()) return;
        const target = event.target as HTMLElement | null;
        if (target === this.host?.getCanvas() ||
            (target?.closest?.("[data-map-editor]") && !target.closest("a[href], input, textarea, [contenteditable]"))) {
            // Chromium can paste the X11 primary selection on mouseup and
            // Firefox can paste it on auxclick. Leave camera drag handling intact.
            event.preventDefault();
        }
    };

    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.target !== this.host?.getCanvas()) return;
        if (!this.handlesCanvasInput() || (event.button !== 0 && event.button !== 2)) return;
        this.host.cancelPendingClick();
        if (this.host.isEditorModalOpen?.()) return;
        if (event.button === 2) {
            event.preventDefault();
            this.finishActiveBrush();
            this.pointer = undefined;
            this.cameraPointer = { x: event.clientX, y: event.clientY };
            return;
        }
        if (this.cameraPointer || this.terrainPreview) return;
        if (this.config.tool === "terrain" && this.needsBaseGroundMaterial) {
            event.preventDefault();
            this.noticeListener?.("Choose a base ground material before painting.");
            return;
        }
        if (this.config.tool === "terrain" || this.config.tool === "scatter") {
            const tile = this.host.getPointerTile();
            if (tile) {
                this.finishActiveBrush();
                const live = this.getBrushTiming() === "live" &&
                    (this.config.tool === "scatter" || this.terrainBrush.action !== "ramp");
                const stroke: BrushStroke = {
                    base: this.config.edits, path: [tile], live, applied: 0,
                    tileEdits: new Map(), weights: new Map(), rebuildOnly: false,
                };
                this.brushStroke = stroke;
                if (this.config.tool === "scatter") {
                    this.scatterPreviewKey = "";
                    this.queueScatterBrushPreview();
                } else {
                    this.updateBrushPreview(stroke, [tile]);
                }
                if (live) this.flushLiveBrush(stroke);
            }
        }
        const startTile = this.config.tool === "select" && !this.isSelectingBuilding(event.shiftKey ?? this.buildingSelect)
            ? this.host?.getPointerTile() : undefined;
        this.pointer = {
            x: event.clientX,
            y: event.clientY,
            travelled: 0,
            startTile,
        };
    };

    private readonly onMouseMove = (event: MouseEvent): void => {
        this.buildingSelect = event.shiftKey;
        const cameraPointer = this.cameraPointer;
        if (cameraPointer) {
            const deltaX = event.clientX - cameraPointer.x;
            const deltaY = event.clientY - cameraPointer.y;
            cameraPointer.x = event.clientX;
            cameraPointer.y = event.clientY;
            this.host?.rotateCamera?.(deltaX, deltaY);
            return;
        }
        if (event.target === this.host?.getCanvas()) {
            if (this.config.tool === "scatter") {
                if (this.brushStroke) this.extendBrushStroke(this.host?.getPointerTile());
                this.queueScatterBrushPreview();
            } else {
                const tile = this.host?.getPointerTile();
                this.pointerTileListener?.(tile);
                this.refreshTileFlagOverlays();
                this.extendBrushStroke(tile);
                this.refreshPlacementPreview();
                this.refreshPointerPreview();
            }
        } else {
            this.pointerTileListener?.(undefined);
            this.clearPlacementPreview();
            this.host?.clearPointerPreview?.();
        }
        const pointer = this.pointer;
        if (!pointer) return;
        pointer.travelled += Math.abs(event.clientX - pointer.x) + Math.abs(event.clientY - pointer.y);
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (
            pointer.travelled > DRAG_THRESHOLD_PX &&
            pointer.startTile &&
            this.config.tool === "select" &&
            event.target === this.host?.getCanvas() &&
            !this.isSelectingBuilding()
        ) {
            const tile = this.host?.getPointerTile();
            if (
                tile &&
                (pointer.dragSelection?.tileEndX !== tile.tileX ||
                    pointer.dragSelection?.tileEndY !== tile.tileY)
            ) {
                pointer.dragSelection = this.host?.selectTileRange?.(pointer.startTile, tile);
            }
        }
    };

    private readonly onMouseUp = (event: MouseEvent): void => {
        if (event.button === 2) {
            if (!this.cameraPointer) return;
            this.cameraPointer = undefined;
            this.host?.cancelPendingClick();
            if (event.target !== this.host?.getCanvas()) return;
            const refresh = (): void => {
                if (!this.handlesCanvasInput()) return;
                this.refreshPlacementPreview();
                this.refreshPointerPreview();
            };
            if (this.host?.afterNextSceneFrame) this.host.afterNextSceneFrame(refresh);
            else refresh();
            return;
        }
        if (event.button !== 0) return;
        // Clicks in release mode use the post-frame pick, just like object placement.
        if (this.brushStroke && (this.brushStroke.live || (this.pointer?.travelled ?? 0) > DRAG_THRESHOLD_PX)) {
            if (event.target === this.host?.getCanvas()) this.extendBrushStroke(this.host?.getPointerTile());
            this.finishBrushStroke(true);
            this.refreshPlacementPreview();
            return;
        }
        const pointer = this.pointer;
        this.pointer = undefined;
        this.brushStroke = undefined;
        if (!pointer) return;
        const buildingSelect = event.shiftKey ?? this.buildingSelect;
        const selectingBuilding = this.isSelectingBuilding(buildingSelect);
        if (pointer.travelled > DRAG_THRESHOLD_PX && !selectingBuilding) {
            if (pointer.dragSelection) {
                this.selection = pointer.dragSelection;
                this.commit();
            }
            return;
        }
        if (event.target !== this.host?.getCanvas()) return;
        this.host?.cancelPendingClick();
        const tool = this.config.tool;
        const apply = (): void => {
            if (this.handlesCanvasInput() && !this.host?.isEditorModalOpen?.() && this.config.tool === tool) {
                this.applyAtPointer(buildingSelect);
            }
        };
        if (this.host?.afterNextSceneFrame) this.host.afterNextSceneFrame(apply);
        else apply();
    };

    cancelLineStart(): boolean {
        if (!this.pathStart && !this.wallStart) return false;
        this.pathStart = undefined;
        this.wallStart = undefined;
        this.clearPlacementPreview();
        this.commit();
        return true;
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (!this.handlesCanvasInput() || this.host?.isEditorModalOpen?.() ||
            target?.closest?.(EDITOR_TYPING_SELECTOR)) return;
        const plainKey = !event.ctrlKey && !event.metaKey && !event.altKey;
        if (plainKey && EDITOR_WASD.has(event.code)) {
            this.host?.getCanvas()?.focus({ preventScroll: true });
            this.cameraKeys.add(event.code);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        // Leave native arrow navigation and other actions on form controls.
        if (target?.closest?.('input, select, [data-map-editor="tool-finder"], [data-map-editor="jump-to-location"], [data-map-editor="editor-help"]')) {
            if (plainKey && event.key === "Shift") this.cameraKeys.add(event.code);
            return;
        }
        if (this.terrainPreview && !EDITOR_CAMERA_KEYS.has(event.code)) return;
        const key = event.key.toLowerCase();
        if (target === this.host?.getCanvas() && !event.altKey &&
            (((event.ctrlKey || event.metaKey) && ["c", "x", "v"].includes(key)) ||
                (event.shiftKey && key === "insert"))) {
            // InputManager prevents the default action of canvas key presses.
            // Let the browser dispatch clipboard events for these shortcuts.
            event.stopPropagation();
            return;
        }
        if ((key === "[" || key === "]") && plainKey &&
            this.resizeBrush(key === "[" ? -1 : 1)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if ((key === "z" || key === "y") && (event.ctrlKey || event.metaKey) && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            if (key === "y" || event.shiftKey) this.redo();
            else this.undo();
            return;
        }
        const objectSelection = this.config.tool === "select" && this.selectionMode === "entity" &&
            (this.selection?.kind === "loc" || this.selection?.kind === "npc");
        if (objectSelection && (key === "c" || key === "m") && plainKey) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) {
                if (key === "c") this.duplicateSelection();
                else this.moveSelection();
            }
            return;
        }
        if (event.key === "Delete" && objectSelection && plainKey) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) this.deleteSelection();
            return;
        }
        if (EDITOR_CAMERA_KEYS.has(event.code) && plainKey) {
            this.cameraKeys.add(event.code);
            this.host?.getCanvas()?.focus({ preventScroll: true });
            // Editor keys never reach InputManager or first-person walking.
            event.preventDefault();
            event.stopPropagation();
            if (event.key !== "Shift") return;
        }
        if (plainKey && ["e", "r", "f", "q", "c"].includes(key)) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (event.key === "Shift") {
            this.buildingSelect = true;
            this.refreshPointerPreview();
            return;
        }
        if (key === "r" && plainKey) {
            event.preventDefault();
            if (event.repeat) return;
            if (this.config.tool === "stamp" && this.stamp) {
                this.stamp.options = { ...this.stamp.options, turns: (this.stamp.options.turns + 1) & 3 };
                this.stampPreviewTile = undefined;
                this.refreshPlacementPreview();
                this.commit();
            } else if (objectSelection && this.selection?.kind === "loc") {
                this.rotateSelection();
            } else {
                this.rotate();
            }
        } else if (event.key === "Escape") {
            if (event.defaultPrevented) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.repeat) return;
            if (this.movingSelection) {
                this.setConfig({ tool: "select" });
                return;
            }
            if (this.cancelBrushStroke() || this.cancelLineStart()) return;
            this.setConfig({ tool: "select" });
        }
    };

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        if (this.cameraKeys.delete(event.code)) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (event.key !== "Shift") return;
        this.buildingSelect = false;
        this.refreshPointerPreview();
    };

    /** Separate from the normal camera and first-person walking controls. */
    handleCameraInput(camera: Camera, deltaTime: number): boolean {
        if (!this.handlesCanvasInput()) return false;
        if (!this.freeCamera || this.host?.isEditorModalOpen?.() ||
            document.activeElement?.closest(EDITOR_TYPING_SELECTOR)) {
            this.resetCameraInput();
            return true;
        }
        // Ignore long gaps after a stalled or backgrounded frame.
        const dt = Math.max(0, Math.min(deltaTime, 50)) / 1000;
        const speed = this.cameraKeys.has("ShiftLeft") || this.cameraKeys.has("ShiftRight") ? 192 : 48;
        const x = Number(this.cameraKeys.has("KeyA")) - Number(this.cameraKeys.has("KeyD"));
        const z = Number(this.cameraKeys.has("KeyS")) - Number(this.cameraKeys.has("KeyW"));
        const length = Math.hypot(x, z) || 1;
        const targetX = x / length * speed, targetZ = z / length * speed;
        const blend = -Math.expm1(-12 * dt);
        // Integrate the eased velocity so acceleration feels the same at different frame rates.
        const dx = targetX * dt + (this.cameraVelocityX - targetX) * blend / 12;
        const dz = targetZ * dt + (this.cameraVelocityZ - targetZ) * blend / 12;
        this.cameraVelocityX += (targetX - this.cameraVelocityX) * blend;
        this.cameraVelocityZ += (targetZ - this.cameraVelocityZ) * blend;
        if (Math.abs(dx) + Math.abs(dz) > 1e-5) camera.move(dx, 0, dz);
        const pitch = Number(this.cameraKeys.has("ArrowUp")) - Number(this.cameraKeys.has("ArrowDown"));
        const yaw = Number(this.cameraKeys.has("ArrowLeft")) - Number(this.cameraKeys.has("ArrowRight"));
        if (pitch) camera.updatePitch(camera.pitch, pitch * 512 * dt);
        if (yaw) camera.updateYaw(camera.yaw, yaw * 512 * dt);
        return true;
    }

    private readonly resetCameraInput = (): void => {
        this.cameraKeys.clear();
        this.cameraVelocityX = 0;
        this.cameraVelocityZ = 0;
    };

    private syncListeners(): void {
        const shouldCapture = this.config.enabled && this.config.active && this.host !== undefined;
        this.host?.setAudioMuted?.(shouldCapture);
        this.host?.setEditorRenderDistance?.(shouldCapture ? this.config.renderDistance : undefined);

        // Checked before the change guard: switching the plugin off entirely
        // never toggles capture, and would otherwise strand the camera off the
        // player with the panel gone.
        if (!shouldCapture && this.scenePreview) {
            this.host?.setScenePreview(false);
            this.scenePreview = false;
        }
        if (!shouldCapture && this.freeCamera) {
            // Logging in re-attaches the camera itself; only give it back when
            // the preview is not the thing holding it.
            this.host?.setFreeCamera(false);
            this.freeCamera = false;
        }
        if (!shouldCapture) this.cancelMove();
        if (!shouldCapture) this.clearTerrainPreview();
        if (!shouldCapture) this.resetCameraInput();
        if (!shouldCapture) this.clearPlacementPreview();
        if (!shouldCapture) this.host?.clearSelectionHighlight?.();

        if (shouldCapture === this.capturing) return;
        this.capturing = shouldCapture;
        if (shouldCapture) this.host?.getCanvas?.()?.focus?.({ preventScroll: true });

        if (typeof window === "undefined") return;
        if (shouldCapture) {
            // Bubble after InputManager's canvas hooks, then remove the click
            // pulse before the next frame can treat an editor click as Walk here.
            window.addEventListener("mousedown", this.onMouseDown);
            window.addEventListener("mousemove", this.onMouseMove);
            window.addEventListener("mouseup", this.onMouseUp);
            window.addEventListener("mouseup", this.preventMiddlePaste, true);
            window.addEventListener("auxclick", this.preventMiddlePaste, true);
            window.addEventListener("blur", this.onWindowBlur);
            window.addEventListener("keydown", this.onKeyDown, true);
            window.addEventListener("keyup", this.onKeyUp, true);
        } else {
            this.pointer = undefined;
            this.cameraPointer = undefined;
            this.buildingSelect = false;
            window.removeEventListener("mousedown", this.onMouseDown);
            window.removeEventListener("mousemove", this.onMouseMove);
            window.removeEventListener("mouseup", this.onMouseUp);
            window.removeEventListener("mouseup", this.preventMiddlePaste, true);
            window.removeEventListener("auxclick", this.preventMiddlePaste, true);
            window.removeEventListener("blur", this.onWindowBlur);
            window.removeEventListener("keydown", this.onKeyDown, true);
            window.removeEventListener("keyup", this.onKeyUp, true);
        }
    }

    private brushPreviewSettings(): TerrainBrush {
        // The outline marks the tiles under the brush. Sculpting samples
        // their corners, which are vertices rather than extra target tiles.
        return { ...this.terrainBrush, action: "overlay", soft: false };
    }

    private updateBrushPreview(stroke: BrushStroke, path: readonly EditModeTile[]): void {
        if (stroke.live || (this.config.tool === "terrain" && this.terrainBrush.action === "ramp")) return;
        const preview = stroke.preview ??= new Map();
        for (const dab of brushFootprint(path, this.brushPreviewSettings(), stroke.weights)) {
            preview.set(brushTileKey(dab), dab);
        }
    }

    private queueScatterBrushPreview(): void {
        if (this.scatterPreviewFrame !== undefined) return;
        const draw = () => {
            this.scatterPreviewFrame = undefined;
            const host = this.host;
            const tile = host?.getPointerTile();
            this.pointerTileListener?.(tile);
            const radius = this.scatter?.radius;
            if (!host || !tile || radius === undefined || !this.handlesCanvasInput()) {
                this.scatterPreviewKey = "";
                host?.clearTerrainPreview?.();
                return;
            }
            const stroke = this.brushStroke;
            let tiles: EditModeTile[];
            if (stroke && !stroke.live) {
                const preview = stroke.scatterPreview ??= { pass: { visited: new Set() }, tiles: [], applied: 0 };
                const path = stroke.path.slice(Math.max(0, preview.applied - 1));
                preview.tiles.push(...scatterBrushPasses(path, radius, preview.pass, false));
                preview.applied = stroke.path.length;
                const key = `stroke:${preview.tiles.length}`;
                if (this.scatterPreviewKey === key) return;
                this.scatterPreviewKey = key;
                tiles = preview.tiles;
            } else {
                const key = `${tile.tileX},${tile.tileY},${tile.plane},${radius}`;
                if (this.scatterPreviewKey === key) return;
                this.scatterPreviewKey = key;
                tiles = [...scatterBrushPasses([tile], radius)];
            }
            if (host.setScatterBrushPreview) host.setScatterBrushPreview(tiles);
            else host.setTerrainPreview?.(tiles);
        };
        if (typeof requestAnimationFrame === "function") this.scatterPreviewFrame = requestAnimationFrame(draw);
        else draw();
    }

    private refreshPlacementPreview(): void {
        if (this.config.tool === "scatter") {
            this.queueScatterBrushPreview();
            return;
        }
        const host = this.host;
        const id = this.config.placeKind === "npc" ? this.config.npcId : this.config.locId;
        const tile = host?.getPointerTile();
        const stroke = this.brushStroke;
        const tool = this.config.tool;
        if (tool === "terrain") {
            if (!tile || !this.handlesCanvasInput() || this.needsBaseGroundMaterial) {
                host?.clearTerrainPreview?.();
                return;
            }
            const color = this.isFlagBrush ? (this.terrainBrush.action === "block" ? 0xf87171 : 0x4ade80) : undefined;
            const brush = this.brushPreviewSettings();
            const footprint = stroke?.preview ? [...stroke.preview.values()] :
                stroke && !stroke.live ? brushFootprint([stroke.path[0], stroke.path[stroke.path.length - 1]], brush) :
                    [...terrainDab(tile, brush)];
            host?.setTerrainPreview?.(footprint, color);
            return;
        }
        if (this.config.tool === "stamp") {
            const stamp = this.stamp;
            if (!this.handlesCanvasInput() || !tile || !stamp) {
                this.clearPlacementPreview();
                host?.clearTerrainPreview?.();
                host?.clearPointerPreview?.();
                return;
            }
            const old = this.stampPreviewTile;
            if (old && old.tileX === tile.tileX && old.tileY === tile.tileY && old.plane === tile.plane) return;
            const [width, height] = stampSize(stamp.area, stamp.options.turns);
            const edge: EditModeEdit[] = [];
            for (let x = 0; x < width; x++) {
                edge.push(this.paintEdit({ ...tile, tileX: tile.tileX + x }));
                if (height > 1) edge.push(this.paintEdit({ ...tile, tileX: tile.tileX + x, tileY: tile.tileY + height - 1 }));
            }
            for (let y = 1; y < height - 1; y++) {
                edge.push(this.paintEdit({ ...tile, tileY: tile.tileY + y }));
                if (width > 1) edge.push(this.paintEdit({ ...tile, tileX: tile.tileX + width - 1, tileY: tile.tileY + y }));
            }
            try {
                const plan = this.makeStampPlan(tile);
                if (!plan) return;
                const { objects, floors } = previewAreaStamp(plan.edits, tile.plane,
                    (at) => host?.getTerrainHeight?.(at), (id) => host?.getStampObjectInfo?.(id));
                if (objects.length || floors.length) host?.setWallPreview?.(objects, undefined, floors);
                else this.clearPlacementPreview();
                host?.setTerrainPreview?.(edge);
                this.stampPreviewTile = tile;
            } catch {
                this.clearPlacementPreview();
                host?.setTerrainPreview?.(edge.filter((at) => at.tileX <= WORLD_COORD_MAX && at.tileY <= WORLD_COORD_MAX), 0xf87171);
                host?.clearPointerPreview?.();
            }
            return;
        }
        if (this.config.tool === "path") {
            const start = this.pathStart ?? tile;
            if (this.handlesCanvasInput() && start && tile && start.plane === tile.plane) {
                host?.setTerrainPreview?.(this.pathEdits(start, tile).filter((edit) => edit.kind === "terrain"));
                return;
            }
            host?.clearTerrainPreview?.();
            return;
        }
        if (this.config.tool === "fill") {
            const fill = this.handlesCanvasInput() && tile ? this.overlayFill(tile) : undefined;
            if (fill && "edits" in fill) host?.setTerrainPreview?.(fill.edits);
            else host?.clearTerrainPreview?.();
            return;
        }
        if (this.config.tool === "wall") {
            const start = this.wallStart ?? tile;
            const end = tile;
            const walls =
                this.handlesCanvasInput() && start && end && start.plane === end.plane
                    ? this.wallLocEdits(start, end, this.wallStart ? this.wallBrush : { ...this.wallBrush, opening: "none" })
                    : [];
            if (walls.length === 0 || !host?.setWallPreview) {
                this.clearPlacementPreview();
                return;
            }
            host.setWallPreview(walls, this.wallTargetHeight(walls));
            this.preview = walls[0];
            return;
        }
        if (
            !host?.setPlacementPreview ||
            !this.handlesCanvasInput() ||
            this.config.tool !== "place" ||
            id <= 0 ||
            !tile
        ) {
            this.clearPlacementPreview();
            return;
        }

        const next: EditModeEdit = {
            kind: this.config.placeKind === "npc" ? "npc" : "place",
            locId: id,
            ...tile,
            shape: this.config.shape,
            rotation: this.config.rotation,
        };
        host.setPlacementPreview(this.config.placeKind, id, tile, next.shape, next.rotation);
        this.preview = next;
    }

    private refreshPointerPreview(): void {
        const host = this.host;
        const tile = host?.getPointerTile();
        if (this.config.tool === "stamp") return;
        if (this.isSelectingBuilding() && host?.previewBuilding) {
            host.previewBuilding(tile);
            return;
        }
        if (!host?.previewPointer || (this.config.tool !== "select" && this.config.tool !== "pick" && this.config.tool !== "delete") || !tile) {
            host?.clearPointerPreview?.();
            return;
        }
        host.previewPointer(tile);
    }

    private clearPlacementPreview(): void {
        if (this.scatterPreviewFrame !== undefined) cancelAnimationFrame(this.scatterPreviewFrame);
        this.scatterPreviewFrame = undefined;
        this.scatterPreviewKey = "";
        this.stampPreviewTile = undefined;
        this.host?.clearTerrainPreview?.();
        this.host?.clearPlacementPreview?.();
        this.preview = undefined;
    }

    private sanitizeConfig(
        input: Partial<EditModePluginConfig> | undefined,
    ): EditModePluginConfig {
        const edits = Array.isArray(input?.edits) ? input.edits : DEFAULT_CONFIG.edits;
        return {
            enabled: input?.enabled ?? DEFAULT_CONFIG.enabled,
            active: (input?.enabled ?? DEFAULT_CONFIG.enabled) && (input?.active ?? false),
            tool: TOOLS.has(input?.tool as string) ? (input?.tool as EditModeTool) : "select",
            placeKind: PLACE_KINDS.has(input?.placeKind as string)
                ? (input?.placeKind as EditModePlaceKind)
                : DEFAULT_CONFIG.placeKind,
            locId: toInt(input?.locId, DEFAULT_CONFIG.locId, 0, 0xffff),
            npcId: toInt(input?.npcId, DEFAULT_CONFIG.npcId, 0, 0xffff),
            overlayId: toInt(input?.overlayId, DEFAULT_CONFIG.overlayId, 0, 0xffff),
            overlayShape: toInt(input?.overlayShape, DEFAULT_CONFIG.overlayShape, 0, OVERLAY_SHAPE_COUNT - 1),
            overlayRotation: toInt(input?.overlayRotation, DEFAULT_CONFIG.overlayRotation, 0, 3),
            shape: toInt(input?.shape, DEFAULT_CONFIG.shape, 0, 22),
            rotation: toInt(input?.rotation, DEFAULT_CONFIG.rotation, 0, 3),
            heightLevel: toInt(input?.heightLevel, DEFAULT_CONFIG.heightLevel, 0, 3),
            renderAllHeightLevels:
                input?.renderAllHeightLevels ?? DEFAULT_CONFIG.renderAllHeightLevels,
            floorView: input?.floorView === "up-to" || input?.floorView === "one-above" || input?.floorView === "all"
                ? input.floorView : undefined,
            brushTiming: input?.brushTiming === "live" ? "live" : undefined,
            renderDistance: input?.renderDistance === undefined ? undefined : toInt(input.renderDistance, 25, 25, 160),
            showMapIcons: input?.showMapIcons ?? DEFAULT_CONFIG.showMapIcons,
            showUnwalkableFlags: input?.showUnwalkableFlags ?? DEFAULT_CONFIG.showUnwalkableFlags,
            showBridgeFlags: input?.showBridgeFlags ?? DEFAULT_CONFIG.showBridgeFlags,
            showRemoveRoofFlags: input?.showRemoveRoofFlags ?? DEFAULT_CONFIG.showRemoveRoofFlags,
            showLowerZFlags: input?.showLowerZFlags ?? DEFAULT_CONFIG.showLowerZFlags,
            showDisableRenderFlags: input?.showDisableRenderFlags ?? DEFAULT_CONFIG.showDisableRenderFlags,
            saveObjectSpawns: input?.saveObjectSpawns === true,
            showPvpZones: input?.showPvpZones ?? DEFAULT_CONFIG.showPvpZones,
            showDuelZones: input?.showDuelZones ?? DEFAULT_CONFIG.showDuelZones,
            showSafeZones: input?.showSafeZones ?? DEFAULT_CONFIG.showSafeZones,
            showF2pZones: input?.showF2pZones ?? DEFAULT_CONFIG.showF2pZones,
            showMultiCombatZones:
                input?.showMultiCombatZones ?? DEFAULT_CONFIG.showMultiCombatZones,
            edits: edits
                .filter(
                    (edit) =>
                        edit &&
                        (edit.kind === "place" ||
                            edit.kind === "delete" ||
                            edit.kind === "npc" ||
                            edit.kind === "npcDelete" ||
                            edit.kind === "npcWander" ||
                            edit.kind === "terrain" ||
                            edit.kind === "clear" ||
                            edit.kind === "height" ||
                            edit.kind === "flag" ||
                            edit.kind === "underlay"),
                )
                .map((edit) => ({
                    kind: edit.kind,
                    locId: toInt(edit.locId, 0, 0, edit.kind === "height" || edit.kind === "flag" ? 0xff :
                        edit.kind === "terrain" || edit.kind === "underlay" ? 0xffff : 0x7fffffff),
                    tileX: toInt(edit.tileX, 0, 0, 0xffff),
                    tileY: toInt(edit.tileY, 0, 0, 0xffff),
                    plane: toInt(edit.plane, 0, 0, 3),
                    shape: toInt(edit.shape, LOC_SHAPE_NORMAL, 0, 22),
                    rotation: toInt(edit.rotation, 0, 0, 3),
                    ...(edit.wanderRadius === undefined
                        ? {}
                        : { wanderRadius: toInt(edit.wanderRadius, 0, 0, 255) }),
                    ...(edit.direction === undefined
                        ? {}
                        : { direction: toInt(edit.direction, 0, 0, 7) }),
                    ...(edit.leashRadius === undefined ? {} : {
                        leashRadius: edit.leashRadius === null ? null : toInt(edit.leashRadius, 0, 0, 255),
                    }),
                })),
        };
    }

    private commit(persist = true): void {
        this.version++;
        this.refreshTileFlagOverlays(true);
        this.state = {
            config: this.config,
            selection: this.selection,
            search: this.search,
            pathStart: this.pathStart,
            wallStart: this.wallStart,
            freeCamera: this.freeCamera,
            scenePreview: this.scenePreview,
            world: this.world,
            version: this.version,
        };
        if (persist) this.persistence?.save(this.config);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[edit-mode-plugin] listener failed", err);
            }
        }
    }
}
