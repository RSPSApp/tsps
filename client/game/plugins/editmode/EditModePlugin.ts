import type { Camera } from "../../Camera";
import type { ObjectSpawn } from "./hostProtocol/objectSpawnsMessage";
import { waterArea, generateIslandEdits } from "./IslandGenerator";
import { buildPathCorners, createPathTiles } from "./PathGenerator";
import { generateBuildingEdits, type BuildingShape, type BuildingStyle } from "./BuildingGenerator";
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
    type EditModeSearchKind,
    type EditModeDefinitionSummary,
    type EditModeSelection,
    type EditModeTile,
    type EditModeTool,
    type EditModeWorldDefinition,
    type EditModeBoundedWorldZone,
} from "./types";

type EditModePluginListener = () => void;
type TileRange = { minX: number; maxX: number; minY: number; maxY: number; plane: number };

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
    heightLevel: 0,
    renderAllHeightLevels: true,
    showMapIcons: false,
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
]);
/** Keeps a stray drag from placing half a map square. */
const MAX_DRAW_TILES = 512;
const WALL_OBJECT_ID = 1902;
const WALL_SHAPE = 0;
/** Pointer travel past this is a camera drag, not a click on a tile. */
const DRAG_THRESHOLD_PX = 4;
const EDITOR_CAMERA_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"]);
const EDITOR_TYPING_SELECTOR = "input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]";
const PLACE_KINDS: ReadonlySet<string> = new Set<EditModePlaceKind>(["loc", "npc"]);

/** Keys spawned NPCs by the edit that created them, so undo can despawn them. */
function npcKey(edit: EditModeEdit): string {
    return `${edit.tileX},${edit.tileY},${edit.plane},${edit.locId}`;
}

/** Stable identity for deduplicating edits imported from a spawn patch. */
function editKey(edit: EditModeEdit): string {
    return JSON.stringify([
        edit.kind, edit.locId, edit.tileX, edit.tileY, edit.plane,
        edit.shape, edit.rotation, edit.wanderRadius, edit.direction,
    ]);
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

function expandTileRange(range: TileRange, tiles: number): TileRange {
    return {
        ...range,
        minX: range.minX - tiles,
        maxX: range.maxX + tiles,
        minY: range.minY - tiles,
        maxY: range.maxY + tiles,
    };
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
    private search: EditModePluginState["search"] = {
        kind: "loc",
        query: "",
        loading: false,
        results: [],
    };
    private pathStart?: EditModeTile;
    private wallStart?: EditModeTile;
    private wallRotationOverride?: number;
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
    private searchToken = 0;
    private worldLoadToken = 0;
    private readonly spawnedNpcs = new Map<string, number>();
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

    getOverlaySwatches() {
        return this.host?.getOverlaySwatches?.() ?? [];
    }

    getOverlayTexture(textureId: number): string | undefined {
        return this.host?.getOverlayTexture?.(textureId);
    }

    /** Updates the world spawn from one selected tile; Save persists it to world.json. */
    setSpawnPoint(): void {
        const selection = this.selection;
        const definition = this.world.definition;
        if (
            !selection ||
            selection.kind === "loc" ||
            selection.kind === "npc" ||
            !definition ||
            (selection.tileEndX !== undefined && selection.tileEndX !== selection.tileX) ||
            (selection.tileEndY !== undefined && selection.tileEndY !== selection.tileY)
        ) {
            return;
        }
        this.world = {
            ...this.world,
            definition: {
                ...definition,
                spawn: { x: selection.tileX, y: selection.tileY, z: selection.plane },
            },
        };
        this.worldDefinitionDirty = true;
        this.commit();
    }

    getWorldDefinitionForSave(): EditModeWorldDefinition | undefined {
        return this.worldDefinitionDirty ? this.world.definition : undefined;
    }

    markWorldDefinitionSaved(): void {
        this.worldDefinitionDirty = false;
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

    markMapEditsSaved(packs: readonly { regionId: number; data: Uint8Array }[], spawns?: ObjectSpawn[]): void {
        this.host?.markMapEditsSaved?.(packs, spawns);
        // Saved map/object data is the new base for subsequent edits and export-mode changes.
        this.setConfig({ edits: this.config.edits.filter((edit) =>
            edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander") });
    }

    exportObjectSpawns() {
        if (!this.config.edits.some((edit) =>
            edit.kind !== "npc" && edit.kind !== "npcDelete" && edit.kind !== "npcWander")) return undefined;
        return this.host?.exportObjectSpawns?.(this.config.edits);
    }

    /** JSON mode keeps object changes out of exported region packs. */
    exportModifiedRegionPacks(): Array<{ regionId: number; data: Uint8Array }> {
        const exportRegionPack = this.host?.exportRegionPack;
        if (!exportRegionPack) return [];
        const tiles = new Map<number, EditModeTile>();
        for (const edit of this.config.edits) {
            if (edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander" ||
                (this.config.saveObjectSpawns && (edit.kind === "place" || edit.kind === "delete"))) continue;
            tiles.set(((edit.tileX >> 6) << 8) | (edit.tileY >> 6), edit);
        }
        const packs: Array<{ regionId: number; data: Uint8Array }> = [];
        for (const [regionId, tile] of tiles) {
            const pack = exportRegionPack(tile, this.config.edits);
            if (!pack) throw new Error(`Region ${regionId} is not ready`);
            packs.push(pack);
        }
        return packs;
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
        const wasActive = this.config.active;
        const previousTool = this.config.tool;
        if (nextConfig.tool !== undefined || nextConfig.locId !== undefined || nextConfig.placeKind !== undefined) {
            this.cancelMove();
        }
        this.config = this.sanitizeConfig({ ...this.config, ...nextConfig });
        if (nextConfig.heightLevel !== undefined && nextConfig.renderAllHeightLevels === undefined) {
            this.config.renderAllHeightLevels = this.config.heightLevel === 0;
        }
        if (nextConfig.tool !== undefined && this.config.tool !== previousTool) {
            this.pathStart = undefined;
            this.wallStart = undefined;
            this.clearPlacementPreview();
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
    setScenePreview(enabled: boolean): void {
        const host = this.host;
        if (!host) return;
        const spawn = this.world.definition?.spawn;
        // A missing definition (world data has not loaded)
        // only costs the spawn framing, so it must not block the editor.
        if (enabled && host.loadWorldDefinition && this.world.loading) return;
        host.setScenePreview(
            enabled,
            spawn && { tileX: spawn.x, tileY: spawn.y, plane: spawn.z },
        );
        this.scenePreview = enabled;
        if (enabled) {
            if (!this.freeCamera) {
                host.setFreeCamera(true);
                this.freeCamera = true;
            }
            if (!this.config.active) {
                // Arm the tools so Esc leaves the preview, which is the only way
                // back to the login screen when entering from its button.
                this.setConfig({ active: true });
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
    toggleWorldMap(): void {
        this.host?.toggleWorldMap?.();
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
            const horizontal =
                !start || !end || Math.abs(end.tileX - start.tileX) >= Math.abs(end.tileY - start.tileY);
            this.wallRotationOverride = ((this.wallRotationOverride ?? (horizontal ? 1 : 0)) + 1) & 0x3;
            this.refreshPlacementPreview();
            this.commit();
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
            this.removeEdits(this.npcEditIndicesAt(selection));
            const spawn = selection.npcSpawn ?? {
                id: selection.locId,
                tileX: selection.tileX,
                tileY: selection.tileY,
                plane: selection.plane,
            };
            this.commitEdits([{
                kind: "npcDelete",
                locId: spawn.id,
                tileX: spawn.tileX,
                tileY: spawn.tileY,
                plane: spawn.plane,
                shape: 0,
                rotation: 0,
            }]);
        }
        this.selection = undefined;
        this.host?.clearSelectionHighlight?.();
        this.commit();
    }

    /**
     * Changes a spawn's wandering range; 0 keeps it anchored. Editor-placed
     * NPCs carry it on the spawn edit, persisted spawns on a small override.
     */
    setSelectionWanderRadius(radius: number): void {
        const selection = this.selection;
        if (!selection || selection.kind !== "npc" || selection.locId < 0) return;
        if (selection.npcSource === undefined) return;
        const wanderRadius = Math.max(0, Math.min(255, Math.trunc(radius)));
        if (!Number.isFinite(wanderRadius)) return;
        const customIndex = this.customNpcEditIndex(selection);
        if (customIndex >= 0) {
            const edits = this.config.edits.map((edit, index) =>
                index === customIndex ? { ...edit, wanderRadius } : edit,
            );
            this.setConfig({ edits });
        } else {
            const indices = this.npcEditIndicesAt(selection).filter((index) =>
                this.config.edits[index].kind === "npcWander",
            );
            this.removeEdits(indices);
            this.commitEdits([{
                kind: "npcWander",
                locId: selection.locId,
                tileX: selection.tileX,
                tileY: selection.tileY,
                plane: selection.plane,
                shape: 0,
                rotation: 0,
                wanderRadius,
                ...(selection.npcSpawn?.direction === undefined
                    ? {}
                    : { direction: selection.npcSpawn.direction }),
            }]);
        }
        this.selection = { ...selection, npcWanderRadius: wanderRadius };
        this.commit();
    }

    /** Index of the editor-placed NPC edit a selection points at, if any. */
    private customNpcEditIndex(selection: EditModeSelection): number {
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
        return this.npcEditIndicesAt(selection).filter((index) =>
            this.config.edits[index].kind !== "npcDelete");
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
        return overlay !== undefined && overlay > 0 ? overlay : undefined;
    }

    useSelectionOverlay(): void {
        const overlayId = this.getSelectionOverlay();
        if (overlayId !== undefined) this.setConfig({ overlayId });
    }

    paintSelection(): void {
        if (!this.selection || this.selection.kind === "building" || this.selection.kind === "loc" || this.selection.kind === "npc") return;
        const range = this.getSelectionRange();
        if (!range) {
            this.commitEdits([this.terrainEdit(this.selection, 0, 0)]);
            return;
        }
        const edits: EditModeEdit[] = [];
        for (let tileX = range.minX; tileX <= range.maxX; tileX++) {
            for (let tileY = range.minY; tileY <= range.maxY; tileY++) {
                edits.push(this.terrainEdit({ tileX, tileY, plane: range.plane }, 0, 0));
            }
        }
        this.commitEdits(edits);
    }

    copyArea(): string {
        const range = this.getSelectionRange();
        if (!range) throw new Error("Select an area to copy");
        if (!this.host?.copyArea) throw new Error("Map data is unavailable");
        return this.host.copyArea(range, this.config.edits);
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

    generateBuilding(style: BuildingStyle, floors: number, shape: BuildingShape): void {
        const range = this.getSelectionRange();
        if (!range || range.maxX - range.minX < 2 || range.maxY - range.minY < 2) return;
        this.commitEdits([
            // Walls and roof edges occupy the one-tile perimeter around the selection.
            ...clearAreaEdits(expandTileRange(range, 1)),
            ...generateBuildingEdits(range, style, floors, this.host?.getCameraTile?.(), this.host?.getTerrainHeight, shape),
        ], false);
    }

    refreshMap(): void {
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
            );
            if (serverId !== undefined) this.spawnedNpcs.set(key, serverId);
        }
    }

    /**
     * Reverts the most recent loc placement or NPC spawn. Deletes are not
     * revertible - the loc suppression lives in the renderer's override map
     * until the page reloads.
     * ponytail: undo skips deletes, wire a real override-clear if that bites.
     */
    undo(): boolean {
        if (this.movingSelection) this.setConfig({ tool: "select" });
        const edits = this.config.edits;
        let index = -1;
        for (let i = edits.length - 1; i >= 0; i--) {
            if (edits[i].kind !== "delete") {
                index = i;
                break;
            }
        }
        if (index === -1) return false;

        const edit = edits[index];
        this.revert(edit);
        const next = edits.filter((_, i) => i !== index);
        this.setConfig({ edits: next });
        this.refreshSpecialRegions([edit], next);
        return true;
    }

    clearEdits(): void {
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
            this.host?.onLocDel(
                { x: edit.tileX, y: edit.tileY },
                edit.plane,
                edit.shape,
                edit.rotation,
            );
        }
    }

    /** Applies the active tool at the tile under the pointer. */
    applyAtPointer(buildingSelect = this.buildingSelect): void {
        const host = this.host;
        const tile = host?.getPointerTile();
        if (!host || !tile) return;

        if (this.config.tool === "select") {
            if (buildingSelect && host.selectBuilding) {
                this.selection = host.selectBuilding(tile);
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

        if (this.config.tool === "terrain") {
            this.commitEdits([this.terrainEdit(tile, 0, 0)]);
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
            // Moving a replacement away leaves the canonical spawn's removal
            // marker in place, exactly as deleting it does; otherwise the
            // original returns beside the moved copy.
            this.removeEdits(customIndex >= 0
                ? this.npcReplacementIndicesAt(moving)
                : this.npcEditIndicesAt(moving));
            if (moving.npcWanderRadius !== undefined) edit.wanderRadius = moving.npcWanderRadius;
            if (moving.npcSpawn?.direction !== undefined) edit.direction = moving.npcSpawn.direction;
            const edits: EditModeEdit[] = [];
            if (customIndex < 0) {
                if (moving.npcSource === "spawn") {
                    edits.push({
                        kind: "npcDelete",
                        locId: moving.locId,
                        tileX: moving.tileX,
                        tileY: moving.tileY,
                        plane: moving.plane,
                        shape: 0,
                        rotation: 0,
                    });
                } else if (moving.npcServerId !== undefined) {
                    this.host?.despawnNpc(moving.npcServerId);
                }
            }
            this.commitEdits([...edits, edit]);
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
        if (!start || start.plane !== tile.plane) {
            this.wallStart = tile;
            this.commit();
            return;
        }
        this.wallStart = undefined;
        this.clearPlacementPreview();
        this.commitEdits(this.wallEdits(start, tile));
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

    /** A run locks to its dominant axis, like a basic build-mode wall tool. */
    private wallEdits(start: EditModeTile, end: EditModeTile): EditModeEdit[] {
        const walls = this.wallLocEdits(start, end);
        return [...walls, ...this.wallHeightEdits(walls)];
    }

    private wallLocEdits(start: EditModeTile, end: EditModeTile): EditModeEdit[] {
        if (start.plane !== end.plane) return [];
        const horizontal = Math.abs(end.tileX - start.tileX) >= Math.abs(end.tileY - start.tileY);
        const from = horizontal ? Math.min(start.tileX, end.tileX) : Math.min(start.tileY, end.tileY);
        const to = horizontal ? Math.max(start.tileX, end.tileX) : Math.max(start.tileY, end.tileY);
        const rotation = this.wallRotationOverride ?? (horizontal ? 1 : 0);
        const walls: EditModeEdit[] = [];
        for (let coordinate = from; coordinate <= to && walls.length < MAX_DRAW_TILES; coordinate++) {
            walls.push({
                kind: "place",
                locId: WALL_OBJECT_ID,
                tileX: horizontal ? coordinate : start.tileX,
                tileY: horizontal ? start.tileY : coordinate,
                plane: start.plane,
                shape: WALL_SHAPE,
                rotation,
            });
        }
        return walls;
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
        if (!sample || walls.length === 0) return undefined;
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
                const tile = { tileX: x, tileY: y, plane: wall.plane };
                vertices.set(`${x}:${y}:${tile.plane}`, tile);
            }
        }
        return [...vertices.values()];
    }

    private commitEdits(edits: EditModeEdit[], applyImmediately = true): void {
        if (edits.length === 0) return;
        if (applyImmediately) {
            for (const edit of edits) {
                this.dispatch(edit);
            }
        }
        const next = [...this.config.edits, ...edits];
        this.setConfig({ edits: next });
        this.refreshSpecialRegions(edits, next);
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
    ): void {
        const regions = new Set<number>();
        for (const edit of edits) {
            if (edit.kind === "clear" || edit.kind === "height" || edit.kind === "flag" || edit.kind === "underlay") {
                regions.add(((edit.tileX >> 6) << 8) | (edit.tileY >> 6));
            }
        }
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

    /** Captures editor presses before the game can drag-look, walk, or draw its click cross. */
    private readonly onMouseDown = (event: MouseEvent): void => {
        if (event.target !== this.host?.getCanvas()) return;
        if (!this.handlesCanvasInput()) return;
        if (event.button === 2) {
            event.preventDefault();
            this.cameraPointer = { x: event.clientX, y: event.clientY };
            this.host?.cancelPendingClick();
            return;
        }
        if (event.button !== 0) return;
        const startTile = this.config.tool === "select" ? this.host?.getPointerTile() : undefined;
        this.pointer = {
            x: event.clientX,
            y: event.clientY,
            travelled: 0,
            startTile,
        };
        this.host.cancelPendingClick();
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
            this.refreshPlacementPreview();
            this.refreshPointerPreview();
        } else {
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
            this.config.tool === "select"
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
            this.cameraPointer = undefined;
            this.host?.cancelPendingClick();
            const refresh = (): void => {
                if (!this.handlesCanvasInput()) return;
                this.refreshPlacementPreview();
                this.refreshPointerPreview();
            };
            if (this.host?.afterNextSceneFrame) this.host.afterNextSceneFrame(refresh);
            else refresh();
            return;
        }
        const pointer = this.pointer;
        this.pointer = undefined;
        if (!pointer || event.button !== 0) return;
        if (pointer.travelled > DRAG_THRESHOLD_PX) {
            if (pointer.dragSelection) {
                this.selection = pointer.dragSelection;
                this.commit();
            }
            return;
        }
        this.host?.cancelPendingClick();
        const buildingSelect = this.buildingSelect;
        const apply = (): void => {
            if (this.handlesCanvasInput()) this.applyAtPointer(buildingSelect);
        };
        if (this.host?.afterNextSceneFrame) this.host.afterNextSceneFrame(apply);
        else apply();
    };

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.(EDITOR_TYPING_SELECTOR)) return;
        if (this.host?.isEditorModalOpen?.()) return;
        // The login form is drawn on the canvas, so its typing would otherwise
        // lose every "r" to the rotate shortcut.
        if (!this.handlesCanvasInput()) return;
        const key = event.key.toLowerCase();
        const moveableSelection = this.selection?.kind === "loc" || this.selection?.kind === "npc";
        if (moveableSelection && (key === "c" || key === "m") &&
            !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) {
                if (key === "c") this.duplicateSelection();
                else this.moveSelection();
            }
            return;
        }
        if (event.key === "Delete" && moveableSelection &&
            !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) this.deleteSelection();
            return;
        }
        if (EDITOR_CAMERA_KEYS.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this.cameraKeys.add(event.code);
            this.host?.getCanvas()?.focus({ preventScroll: true });
            // Editor keys never reach InputManager or first-person walking.
            event.preventDefault();
            event.stopPropagation();
            if (event.key !== "Shift") return;
        }
        if (["e", "r", "f", "q", "c"].includes(event.key.toLowerCase())) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (event.key === "Shift") {
            this.buildingSelect = true;
            this.refreshPointerPreview();
            return;
        }
        if (key === "r" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            if (event.repeat) return;
            if (this.config.tool === "select" && this.selection?.kind === "loc") {
                this.rotateSelection();
            } else {
                this.rotate();
            }
        } else if (event.key === "Escape") {
            if (this.movingSelection) {
                this.setConfig({ tool: "select" });
                return;
            }
            if (this.pathStart || this.wallStart) {
                this.pathStart = undefined;
                this.wallStart = undefined;
                this.clearPlacementPreview();
                this.commit();
                return;
            }
            this.setConfig({ active: false });
        }
    };

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        if (this.cameraKeys.delete(event.code)) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (["e", "r", "f", "q", "c"].includes(event.key.toLowerCase())) {
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
            window.addEventListener("blur", this.resetCameraInput);
            window.addEventListener("keydown", this.onKeyDown, true);
            window.addEventListener("keyup", this.onKeyUp, true);
        } else {
            this.pointer = undefined;
            this.cameraPointer = undefined;
            this.buildingSelect = false;
            window.removeEventListener("mousedown", this.onMouseDown);
            window.removeEventListener("mousemove", this.onMouseMove);
            window.removeEventListener("mouseup", this.onMouseUp);
            window.removeEventListener("blur", this.resetCameraInput);
            window.removeEventListener("keydown", this.onKeyDown, true);
            window.removeEventListener("keyup", this.onKeyUp, true);
        }
    }

    private refreshPlacementPreview(): void {
        const host = this.host;
        const id = this.config.placeKind === "npc" ? this.config.npcId : this.config.locId;
        const tile = host?.getPointerTile();
        if (this.config.tool === "path") {
            const start = this.pathStart ?? tile;
            if (this.handlesCanvasInput() && start && tile && start.plane === tile.plane) {
                host?.setTerrainPreview?.(this.pathEdits(start, tile).filter((edit) => edit.kind === "terrain"));
                return;
            }
            host?.clearTerrainPreview?.();
            return;
        }
        if (this.config.tool === "wall") {
            const start = this.wallStart ?? tile;
            const end = tile;
            const walls =
                this.handlesCanvasInput() && start && end && start.plane === end.plane
                    ? this.wallLocEdits(start, end)
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
        if (!host?.previewPointer || this.config.tool !== "select" || !tile) {
            host?.clearPointerPreview?.();
            return;
        }
        if (this.buildingSelect && host.previewBuilding) {
            host.previewBuilding(tile);
            return;
        }
        host.previewPointer(tile);
    }

    private clearPlacementPreview(): void {
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
            shape: toInt(input?.shape, DEFAULT_CONFIG.shape, 0, 22),
            rotation: toInt(input?.rotation, DEFAULT_CONFIG.rotation, 0, 3),
            heightLevel: toInt(input?.heightLevel, DEFAULT_CONFIG.heightLevel, 0, 3),
            renderAllHeightLevels:
                input?.renderAllHeightLevels ?? DEFAULT_CONFIG.renderAllHeightLevels,
            showMapIcons: input?.showMapIcons ?? DEFAULT_CONFIG.showMapIcons,
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
                    locId: toInt(edit.locId, 0, 0, edit.kind === "height" || edit.kind === "flag" ? 0xff : 0xffff),
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
                })),
        };
    }

    private commit(): void {
        this.version++;
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
        this.persistence?.save(this.config);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (err) {
                console.log("[edit-mode-plugin] listener failed", err);
            }
        }
    }
}
