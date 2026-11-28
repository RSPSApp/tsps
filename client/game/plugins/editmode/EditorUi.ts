import { quarterTurnToDirection } from "../../../common/Direction";
import { OBJECT_SPAWNS_MESSAGE, formatObjectSpawns } from "./hostProtocol/objectSpawnsMessage";
import FileSaver from "file-saver";
import {
    REGION_PACK_MESSAGE,
} from "./hostProtocol/regionPackMessage";
import { browserHostOrigin, browserHostWindow } from "./hostProtocol/origin";
import type { EditModePlugin, MapEdge } from "./EditModePlugin";
import { parseAreaStamp, stampSize, type AreaStamp, type AreaStampOptions } from "./AreaStamp";
import type { TerrainBrush, TerrainBrushAction } from "./TerrainBrush";
import { EditorTravel } from "./EditorTravel";
import { fetchContent } from "../../../network/serverConnection/contentApi";
import { EditorMapFiles, mapEditLayerId } from "./EditorMapFiles";
import { attachLandscapeEditor, loadOccupiedMapSquares, loadBiomeScenery, type LandscapeDraft } from "./EditorLandscape";
import { attachEditorHelp } from "./EditorHelp";
import type { MapFootprint } from "./EditorWorldMap";
import { EditorGroundItems } from "./EditorGroundItems";
import { EditorObjectSwatches, type ObjectSwatch } from "./EditorObjectSwatches";
import { EditorPalette, type PaletteMode } from "./EditorPalette";
import { RspsiEditorLayout } from "./RspsiEditorLayout";
import { editorChangeAreas } from "./EditorChangeAreas";
import { readScatterSets, writeScatterSets, type EditorScatterSet } from "./EditorScatterSets";
import { MAX_SCATTER_DENSITY, MIN_SCATTER_DENSITY } from "./ScatterBrush";
import {
    createCameraIcon,
    EDITOR_TOP_BAR_CLEARANCE,
    createEditorCloseButton,
    createDuplicateIcon,
    createMoveIcon,
    createLayersIcon,
    createHammerIcon,
    createOverlayIcon,
    createPaintIcon,
    createRotateIcon,
    createRefreshIcon,
    createSaveIcon,
    createTrashIcon,
    createOverlayShapeIcon,
    createRedoIcon,
    createReviewIcon,
    createUndoIcon,
} from "./EditorToolbar";
import { getOverlayShapeTriangles } from "../../../rs/scene/SceneTileModel";
import { OVERLAY_SHAPE_COUNT } from "./EditModePlugin";
import { parseEditorLocation, regionBounds, regionIdOf, WORLD_COORD_MAX } from "./EditorCoordinates";
import { MAX_REGION_PACK_PAYLOAD, oversizedRegionPacks } from "./RegionPack";
import type { TileCorner } from "./TerrainHeight";
import { WORLD_DEFINITION_MESSAGE } from "./hostProtocol/worldDefinitionMessage";
import { CUSTOM_NPC_SPAWNS_MESSAGE, formatCustomNpcSpawns } from "./hostProtocol/npcSpawnMessage";
import type {
    EditModeDefinitionSummary,
    EditModeEdit,
    EditModeOverlaySwatch,
    EditModeRegionPack,
    EditModeSearchKind,
    EditModeSelection,
    EditModeTile,
} from "./types";

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
    position: "fixed",
    zIndex: "10002",
    boxSizing: "border-box",
    padding: "10px",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: "6px",
    color: "#eef4ff",
    background: "rgba(18,20,24,0.97)",
    boxShadow: "0 12px 32px rgba(0,0,0,0.42)",
    font: "13px/1.4 sans-serif",
};

const INPUT_STYLE: Partial<CSSStyleDeclaration> = {
    boxSizing: "border-box",
    width: "100%",
    height: "34px",
    padding: "6px 9px",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: "4px",
    outline: "none",
    color: "#fff",
    background: "#111318",
    font: "13px sans-serif",
};

const TERRAIN_LABELS: Record<TerrainBrushAction, string> = {
    overlay: "Paint overlay", underlay: "Paint base ground", raise: "Raise land", lower: "Lower land",
    smooth: "Smooth bumps", flatten: "Flatten to start height", ramp: "Grade ramp", natural: "Reset height",
    block: "Set flags", unblock: "Clear flags",
};

/** Gap below the top bar where floating panels and toasts start. */
const TOP_BAR_CLEARANCE = EDITOR_TOP_BAR_CLEARANCE;
/** The saved spawn patch only needs importing once per page, not per UI mount. */
let persistedNpcSpawnsRequested = false;

function stopClientInput(element: HTMLElement): void {
    for (const eventName of ["mousedown", "click", "keydown", "keyup"] as const) {
        element.addEventListener(eventName, (event) => event.stopPropagation());
    }
}

function createPanel(name: string, width = "360px"): HTMLDivElement {
    const panel = document.createElement("div");
    panel.dataset.mapEditor = name;
    panel.dataset.rspsiPanel = "";
    Object.assign(panel.style, PANEL_STYLE, { left: "var(--map-editor-panel-left, 62px)", top: "112px", width });
    stopClientInput(panel);
    document.body.appendChild(panel);
    return panel;
}

function createHeader(titleText: string, onClose: () => void): HTMLDivElement {
    const header = document.createElement("div");
    Object.assign(header.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "8px",
    });
    const title = document.createElement("strong");
    title.textContent = titleText;
    const close = createEditorCloseButton(`Close ${titleText.toLowerCase()}`, onClose);
    header.append(title, close);
    return header;
}

function createCompactButton(text: string, title: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", title);
    Object.assign(button.style, {
        minHeight: "28px",
        padding: "2px 8px",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: "4px",
        color: "#cbd5e1",
        background: "rgba(255,255,255,0.06)",
        cursor: "pointer",
        font: "12px sans-serif",
        whiteSpace: "nowrap",
    });
    button.addEventListener("click", action);
    return button;
}

function createActionButton(
    title: string,
    icon: () => SVGElement,
    action: () => void,
    shortcut?: string,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(icon());
    Object.assign(button.style, {
        width: "100%",
        minHeight: "32px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 8px",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: "4px",
        color: "#cbd5e1",
        background: "rgba(255,255,255,0.06)",
        cursor: "pointer",
        font: "13px sans-serif",
        textAlign: "left",
    });
    button.append(" ", title);
    if (shortcut) {
        const hint = document.createElement("kbd");
        hint.textContent = shortcut;
        Object.assign(hint.style, { marginLeft: "auto", color: "#94a3b8", font: "12px sans-serif" });
        button.appendChild(hint);
        button.title = `${title} (${shortcut})`;
        button.setAttribute("aria-keyshortcuts", shortcut.toLowerCase());
    }
    button.addEventListener("click", action);
    return button;
}

type EditorSession = {
    travel: EditorTravel;
    groundItems: EditorGroundItems;
    structure: { kind: string; style: string; drafts: Map<string, Record<string, string>> };
    changed?: () => void;
    notify?: (message: string) => void;
    files?: EditorMapFiles;
    savedNpcSpawnsKey?: string;
    landscapeSettings: WeakMap<Uint8Array, LandscapeDraft>;
    recentLandscapeSquare?: number;
    lastSaveStatus?: string;
    publication?: { location?: EditModeTile; regions: readonly number[]; restart: boolean };
};
const editorSessions = new WeakMap<EditModePlugin, EditorSession>();

function editorSession(plugin: EditModePlugin): EditorSession {
    const existing = editorSessions.get(plugin);
    if (existing) return existing;
    const session: EditorSession = {
        travel: new EditorTravel(plugin, createCompactButton, INPUT_STYLE, () => session.changed?.(), (message) => session.notify?.(message)),
        groundItems: new EditorGroundItems(plugin, createCompactButton, INPUT_STYLE, () => session.changed?.(), (message) => session.notify?.(message)),
        landscapeSettings: new WeakMap(),
        structure: { kind: "furnished-house", style: "", drafts: new Map() },
    };
    editorSessions.set(plugin, session);
    window.addEventListener("beforeunload", (event) => {
        if (!session.travel.dirty && !session.groundItems.dirty && !plugin.getWorldDefinitionForSave() &&
            !plugin.getNewMapSquares().length &&
            !plugin.getConfig().edits.some((edit) => !isNpcEdit(edit)) &&
            npcSpawnsKey(plugin) === (session.savedNpcSpawnsKey ?? "[]")) return;
        event.preventDefault();
        event.returnValue = "";
    });
    return session;
}

function isNpcEdit(edit: { kind: string }): boolean {
    return edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander";
}

function npcSpawnsKey(plugin: EditModePlugin): string {
    return JSON.stringify(plugin.getConfig().edits.filter(isNpcEdit)
        .map((edit) => [edit.kind, edit.locId, edit.tileX, edit.tileY, edit.plane, edit.rotation,
        edit.wanderRadius, edit.leashRadius, edit.direction]));
}

function changedNpcTiles(current: string, saved: string): EditModeTile[] {
    type SpawnChange = [kind: string, id: number, x: number, y: number, plane: number, ...details: unknown[]];
    const rows = (text: string) => new Map((JSON.parse(text) as SpawnChange[]).map((row) => [JSON.stringify(row), row]));
    const before = rows(saved), after = rows(current);
    const tiles = new Map<string, EditModeTile>();
    for (const [key, row] of new Map([...before, ...after])) {
        if (before.has(key) && after.has(key)) continue;
        const [, , tileX, tileY, plane] = row;
        tiles.set(`${tileX}:${tileY}:${plane}`, { tileX, tileY, plane });
    }
    return [...tiles.values()];
}

class EditorChrome {
    private readonly layout: RspsiEditorLayout;
    private readonly renderDistanceInput: HTMLInputElement;
    private readonly renderDistanceLabel: HTMLOutputElement;
    private readonly selectionModeInput: HTMLSelectElement;
    private readonly palette: EditorPalette;
    private readonly objectSwatches: EditorObjectSwatches;
    private swatchSelection?: EditModeSelection;
    private readonly selectionDetails: HTMLDivElement;
    private readonly mapButton: HTMLButtonElement;
    private readonly jumpButton: HTMLButtonElement;
    private jumpPanel?: HTMLDivElement;
    private worldMapMode?: "navigate" | "zones";
    private review?: {
        body: HTMLElement;
        save: HTMLButtonElement;
        download: HTMLButtonElement;
        load: HTMLButtonElement;
        play: HTMLButtonElement;
        test: HTMLButtonElement;
        status: HTMLElement;
        destination: HTMLElement;
        edits?: readonly EditModeEdit[];
        extra?: string;
        changed?: boolean;
    };
    private swatchRequest = 0;
    private minimapUrl?: string;
    private syncSwatches?: () => void;
    private syncBrushInputs?: () => void;
    private syncScatterInputs?: () => void;
    private readonly heightInput: HTMLInputElement;
    private readonly renderAllInput: HTMLInputElement;
    private readonly floorViewInput: HTMLSelectElement;
    private readonly saveObjectSpawnsInput: HTMLInputElement;
    private readonly settingsContent: HTMLDivElement;
    private settingsDrawer?: HTMLElement;
    private readonly unsubscribe: () => void;
    private readonly canvasShell?: HTMLElement;
    private readonly previousCanvasStyle: string | null;
    private detailPanel?: HTMLElement;
    private areaPanel?: HTMLElement;
    private brushPanel?: HTMLElement;
    private landscapePanel?: HTMLElement;
    private lastBrushActions: Record<"Paint" | "Sculpt" | "Flags", TerrainBrushAction> = {
        Paint: "overlay", Sculpt: "raise", Flags: "block",
    };
    private travelPanel?: HTMLElement;
    private travelSelection?: EditModeSelection;
    private regionPanel?: HTMLElement;
    private filesPanel?: HTMLElement;
    private readonly session: EditorSession;
    private itemsPanel?: HTMLElement;
    private scattering = false;
    private activateScatter?: () => void;
    private pickScatterSetMember?: (id: number) => boolean;
    private scatterRequest = 0;
    private updateScatterAsset?: (id?: number) => void;
    private placementOptions?: HTMLElement;
    private buildPanel?: HTMLElement;
    private wallPanel?: HTMLElement;
    private inspectorToolPanel?: HTMLElement;
    private readonly toolCue: HTMLElement;
    private areaAction: "Stamp area" | "Duplicate area" | "Place structure" = "Stamp area";
    private scatterSettings = { set: "forest", radius: 3, density: 24 };
    private fileStatus?: HTMLElement;
    private saving = false;
    private areaContents?: string;
    private areaSummary?: HTMLElement;
    private areaOptions: AreaStampOptions = { terrain: "floors", turns: 0, interactive: false };
    private saveButton?: HTMLButtonElement;
    private overlaySwatches: readonly EditModeOverlaySwatch[] = [];
    private selectionImage?: { key: string; dataUrl: string; loading: boolean };
    private heightStep = 4;
    private heightSmoothing = 2;
    private lastVersion = -1;

    constructor(private readonly plugin: EditModePlugin) {
        this.session = editorSession(plugin);
        this.session.changed = () => this.syncSaveButton();
        this.session.notify = (message) => this.toast(message);
        this.plugin.setStampItemHistory((items) => this.groundItems.stamp(items));
        this.groundItems.resumePreview();
        this.overlaySwatches = plugin.getOverlaySwatches();
        this.palette = new EditorPalette({
            onModeChange: (mode) => this.search(mode),
            onQueryChange: (query) => this.plugin.searchCache(query, this.currentSearchMode()),
            onPick: (id) => this.pickSearchResult(id),
            onClose: () => this.dismissToolPanel(),
            onInspect: (id) => this.showDefinition(this.currentSearchMode(), id),
            onAddSwatch: (id, name) => {
                const shapes = this.plugin.getLocPlacementShapes(id);
                this.objectSwatches.add({ id, name, type: shapes.includes(10) ? 10 : shapes[0] ?? 10, turn: 0 });
            },
            loadThumbnail: (kind, id) => this.plugin.loadAssetThumbnail(kind, id),
        });
        this.objectSwatches = new EditorObjectSwatches({
            pick: (swatch) => {
                this.dismissToolPanel(true);
                this.plugin.setConfig({ tool: "place", placeKind: "loc", locId: swatch.id, shape: swatch.type, rotation: swatch.turn });
            },
            selected: () => this.selectedObjectSwatch(),
            browse: () => this.toggleSearch("loc", true),
            thumbnail: (id) => this.plugin.loadAssetThumbnail("loc", id),
            notify: (message) => this.toast(message),
        });
        this.updateObjectControls();

        const selectionMode = (mode: ReturnType<EditModePlugin["getSelectionMode"]>) => {
            this.dismissToolPanel();
            this.swatchSelection = undefined;
            this.layout.activatePalette(mode === "ground" ? "Misc" : mode === "building" ? "Settlements" : "Objects");
            this.plugin.setSelectionMode(mode);
        };
        const groundTool = (tool: "path" | "fill") => {
            this.dismissToolPanel();
            this.plugin.setConfig({ tool });
        };
        const brushTask = (group: "Paint" | "Sculpt" | "Flags", action: TerrainBrushAction, description: string, keywords?: string) =>
        ({
            id: action, label: TERRAIN_LABELS[action], description, keywords, run: () => {
                if (action === "overlay" || action === "underlay") {
                    this.dismissToolPanel();
                    this.layout.selectPalette(action === "overlay" ? "Overlays" : "Underlays");
                } else this.toggleBrushPanel(group, action);
            }
        });
        const worldMapTask = { id: "world-map", label: "World map", description: "Browse the overworld, dungeons and named map areas.", keywords: "open caves surface", run: () => this.toggleWorldMap() };
        const jumpTask = { id: "jump", label: "Jump to location", description: "Go directly to coordinates or a region ID.", keywords: "teleport go to", run: () => this.showJumpToLocation() };
        const cameraTask = { id: "camera", label: "Reset camera angle", description: "Face north at the default editor angle.", run: () => this.plugin.levelCamera() };
        this.layout = new RspsiEditorLayout([
            {
                label: "Select", groups: [
                    {
                        tasks: [
                            { id: "select-entity", label: "Select", description: "Click a tile, object or NPC, or drag to select an area.", run: () => selectionMode("entity") },
                            { id: "select-ground", label: "Tiles only", description: "Click a tile or drag a rectangle across the map.", run: () => selectionMode("ground") },
                            { id: "select-building", label: "Buildings", description: "Select a whole building with one click.", run: () => selectionMode("building") },
                            {
                                id: "region", label: "Select map square", description: "Select the entire 64 × 64 map square.", keywords: "region", run: () => {
                                    selectionMode("ground");
                                    this.plugin.selectRegion();
                                }
                            },
                        ]
                    },
                ]
            },
            {
                label: "Terrain", groups: [
                    {
                        tasks: [
                            brushTask("Paint", "overlay", "Paint roads, floors, and water with a shaped overlay.", "material"),
                            brushTask("Paint", "underlay", "Choose a base ground material and paint beneath overlays.", "grass sand dirt"),
                            { id: "path", label: "Draw path", description: "Connect two points with the selected overlay.", keywords: "road", run: () => this.openTerrainLineTool("path") },
                            { id: "fill", label: "Fill connected overlay", description: "Repaint a connected surface and keep its shape.", run: () => this.openTerrainLineTool("fill") },
                        ]
                    },
                    {
                        tasks: [
                            brushTask("Sculpt", "raise", "Build up hills and ridges.", "height hill elevation"),
                            brushTask("Sculpt", "lower", "Carve valleys and depressions.", "height elevation"),
                            brushTask("Sculpt", "smooth", "Blend bumps with nearby heights.", "soften"),
                            brushTask("Sculpt", "flatten", "Level the surface to the height where the drag starts.", "height foundation"),
                            brushTask("Sculpt", "ramp", "Drag between two tiles to blend their heights into a slope.", "grade stairs elevation"),
                            brushTask("Sculpt", "natural", "Restore the map format’s procedural terrain heights.", "reset height"),
                        ]
                    },
                    {
                        tasks: [
                            brushTask("Flags", "block", "Paint the checked tile flags.", "collision pathing bridge roof"),
                            brushTask("Flags", "unblock", "Clear the checked tile flags.", "collision pathing bridge roof"),
                        ]
                    },
                ]
            },
            {
                label: "Build & Place", groups: [
                    {
                        tasks: [
                            { id: "wall", label: "Draw walls", description: "Connect two tiles with a wall or fence and choose the material or opening.", run: () => this.openWallPanel() },
                            { id: "structure", label: "Generate structure", description: "Build houses, guilds, ruins, farms and settlements.", keywords: "building house", run: () => this.openBuildPanel() },
                            { id: "stamp", label: "Stamp area", description: "Copy an existing area or place a saved template.", keywords: "duplicate paste prefab", run: () => this.openAreaPanel() },
                        ]
                    },
                    {
                        tasks: [
                            { id: "build-select-entity", label: "Select objects and NPCs", description: "Click an existing object or NPC to inspect, move or duplicate it.", run: () => selectionMode("entity") },
                            { id: "place-object", label: "Place objects", description: "Search and preview cache models before placing them.", run: () => { this.updateScatterAsset?.(); this.toggleSearch("loc", true); } },
                            {
                                id: "scatter", label: "Scatter scenery", description: "Paint a preset or your own mix of scenery.", keywords: "trees rocks plants brush set", run: () => {
                                    this.toggleSearch("loc", true);
                                    this.activateScatter?.();
                                }
                            },
                            { id: "place-npc", label: "Place NPCs", description: "Find a creature or character and choose a spawn tile.", keywords: "spawn monsters", run: () => this.toggleSearch("npc", true) },
                            { id: "place-item", label: "Place ground items", description: "Choose items and set how they spawn.", keywords: "drops loot", run: () => this.toggleSearch("item", true) },
                        ]
                    },
                ]
            },
            {
                label: "Travel & Warps", groups: [
                    {
                        tasks: [
                            {
                                id: "travel", label: "Browse nearby links", description: "Find portals, stairs, ladders and other travel objects near the editor camera.", keywords: "warp teleport destination", run: () => {
                                    this.openTravelPanel();
                                    this.travel.browse();
                                }
                            },
                            {
                                id: "travel-source", label: "Pick source object", description: "Inspect an object’s actions and destinations, or add a travel action.", run: () => {
                                    this.openTravelPanel();
                                    this.travel.pickSource();
                                }
                            },
                        ]
                    },
                ]
            },
            {
                label: "Maps", groups: [
                    {
                        tasks: [
                            { id: "new-square", label: "Create map square", description: "Create one square from coordinates, base ground or copied terrain.", run: () => this.openRegionPanel() },
                            { id: "new-region", label: "Create new map", description: "Select empty map squares, then preview and generate their terrain.", keywords: "landscape generator island new region expand world", run: () => this.openNewMapWizard() },
                            { id: "expand-region", label: "Expand map portion", description: "Generate more terrain beside an existing map and blend the shared edges.", run: () => this.openNewMapWizard(true) },
                            { id: "edit-draft", label: "Reroll map draft", description: "Adjust the terrain of a generated draft before saving it.", run: () => this.openCurrentLandscapeDraft() },
                        ]
                    },
                    {
                        tasks: [
                            { id: "zones", label: "Edit gameplay zones", description: "Draw, resize or change the type of PvP, multi-combat and other gameplay zones.", keywords: "create zone pvp safe duel", run: () => this.toggleWorldMap("zones") },
                        ]
                    },
                    {
                        tasks: [
                            {
                                id: "refresh", label: "Refresh world data", description: "Load map updates saved by the server or an agent.", run: () => {
                                    this.plugin.refreshMap();
                                    this.travel.refresh();
                                    this.groundItems.refresh();
                                    this.toast("Refreshing map…");
                                }
                            },
                        ]
                    },
                    {
                        tasks: [
                            ...(!browserHostWindow() ? [{
                                id: "map-files", label: "Manage map files", description: "Connect the server folder, manage backups or download edits.",
                                keywords: "save export import", run: () => this.toggleFilesPanel()
                            }] : []),
                            { id: "validate", label: "Validate map edits", description: "Check edited regions for errors before saving.", run: () => this.showValidation() },
                        ]
                    },
                ]
            },
        ], { label: "Undo", run: () => { if (!plugin.undo()) this.toast("Nothing to undo"); } },
            { label: "Redo", run: () => { if (!plugin.redo()) this.toast("Nothing to redo"); } },
            { label: "Editor settings", run: () => this.toggleSettings() },
            { label: "Review changes", run: () => this.showReview() },
            { label: "Help", run: () => this.openEditorHelp() },
            { undo: createUndoIcon, redo: createRedoIcon, review: createReviewIcon },
            () => {
                this.plugin.closeWorldMap();
                this.dismissToolPanel();
                this.syncToolCue();
                this.renderSelection();
            }, [worldMapTask, jumpTask, cameraTask, { id: "brush-settings", label: "Brush settings", description: "Adjust brush action, strength, timing and edges.", run: () => this.toggleBrushPanel() }], plugin);

        this.selectionDetails = document.createElement("div");
        this.selectionDetails.dataset.mapEditor = "selection-details";
        Object.assign(this.selectionDetails.style, PANEL_STYLE, {
            right: "12px",
            top: TOP_BAR_CLEARANCE,
            left: "auto",
            width: "min(270px, calc(100vw - var(--map-editor-panel-left, 62px) - 13px))",
            maxHeight: "calc(100dvh - 125px)",
            overflowY: "auto",
            display: "none",
            borderColor: "rgba(96,165,250,0.5)",
            background: "rgba(18,20,24,0.9)",
        });
        stopClientInput(this.selectionDetails);
        document.body.appendChild(this.selectionDetails);

        this.heightInput = document.createElement("input");
        this.heightInput.type = "number";
        this.heightInput.min = "0";
        this.heightInput.max = "3";
        this.heightInput.step = "1";
        this.heightInput.title = "Height/Level";
        this.heightInput.setAttribute("aria-label", "Height/Level");
        Object.assign(this.heightInput.style, INPUT_STYLE, {
            width: "48px",
            height: "28px",
            padding: "3px 5px",
            textAlign: "center",
        });
        this.heightInput.addEventListener("change", () =>
            this.setHeightLevel(Number(this.heightInput.value)),
        );
        const selectMode = this.selectionModeInput = document.createElement("select");
        selectMode.setAttribute("aria-label", "Selection target");
        Object.assign(selectMode.style, INPUT_STYLE, { width: "auto", height: "28px", padding: "3px 5px" });
        for (const [value, label] of [["entity", "All"], ["ground", "Tiles only"], ["building", "Buildings"]]) {
            selectMode.add(new window.Option(label, value));
        }
        selectMode.value = plugin.getSelectionMode();
        selectMode.onchange = () => {
            this.dismissToolPanel();
            this.plugin.setSelectionMode(selectMode.value as ReturnType<EditModePlugin["getSelectionMode"]>);
        };
        const coordinates = document.createElement("span");
        coordinates.title = "Tile under the pointer: x, y, level, and its map region";
        Object.assign(coordinates.style, { minWidth: "170px", marginLeft: "8px", color: "#cbd5e1", whiteSpace: "nowrap" });
        this.mapButton = this.layout.getTaskButton("world-map");
        this.jumpButton = this.layout.getTaskButton("jump");
        this.plugin.setNoticeListener((message) => this.toast(message));
        this.layout.status.append(coordinates);
        this.plugin.setPointerTileListener((tile) => {
            const region = tile && regionIdOf(tile.tileX, tile.tileY);
            coordinates.textContent = tile ? `${tile.tileX}, ${tile.tileY}, ${tile.plane} · Region ${region}` : "";
        });
        const renderAllLabel = document.createElement("label");
        Object.assign(renderAllLabel.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginLeft: "8px",
            cursor: "pointer",
        });
        renderAllLabel.append("Render all Height Levels");
        this.renderAllInput = document.createElement("input");
        this.renderAllInput.type = "checkbox";
        renderAllLabel.title = "Defaults on at HL 0 and off above it. Hover inside or along the walls of a building at HL 0 to reveal its contents.";
        this.renderAllInput.addEventListener("change", () =>
            this.plugin.setConfig({ renderAllHeightLevels: this.renderAllInput.checked, floorView: undefined }),
        );
        renderAllLabel.prepend(this.renderAllInput);
        this.settingsContent = document.createElement("div");
        this.floorViewInput = document.createElement("select");
        Object.assign(this.floorViewInput.style, INPUT_STYLE);
        const floorViewLabel = document.createElement("label");
        for (const [value, label] of [["", "Automatic"], ["up-to", "Editing floor and below"],
        ["one-above", "One floor above"], ["all", "All floors including roofs"]]) {
            this.floorViewInput.add(new window.Option(label, value));
        }
        this.floorViewInput.onchange = () => {
            const value = this.floorViewInput.value;
            this.plugin.setConfig({ floorView: value === "up-to" || value === "one-above" || value === "all" ? value : undefined });
        };
        floorViewLabel.append("Visible floors", this.floorViewInput);
        this.settingsContent.append(floorViewLabel);
        this.renderDistanceInput = document.createElement("input");
        this.renderDistanceInput.type = "range";
        this.renderDistanceInput.min = "25";
        this.renderDistanceInput.max = "160";
        this.renderDistanceInput.id = "map-editor-render-distance";
        this.renderDistanceInput.style.width = "100%";
        this.renderDistanceInput.oninput = () => this.plugin.setConfig({ renderDistance: this.renderDistanceInput.valueAsNumber });
        const distance = document.createElement("label");
        distance.htmlFor = this.renderDistanceInput.id;
        distance.textContent = "Render distance";
        this.renderDistanceLabel = document.createElement("output");
        this.renderDistanceLabel.style.marginLeft = "7px";
        this.settingsContent.append(distance, this.renderDistanceLabel, this.renderDistanceInput,
            createCompactButton("Use game default", "Reset editor render distance", () => this.plugin.setConfig({ renderDistance: undefined })));
        const saveObjectsLabel = document.createElement("label");
        this.saveObjectSpawnsInput = document.createElement("input");
        this.saveObjectSpawnsInput.type = "checkbox";
        this.saveObjectSpawnsInput.addEventListener("change", () =>
            this.plugin.setConfig({ saveObjectSpawns: this.saveObjectSpawnsInput.checked }),
        );
        saveObjectsLabel.append(this.saveObjectSpawnsInput, "Save objects to object-spawns.json");
        for (const label of [...(browserHostWindow() ? [saveObjectsLabel] : []), renderAllLabel]) {
            Object.assign(label.style, { display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", alignItems: "start", columnGap: "12px", margin: "14px 0", lineHeight: "20px", cursor: "pointer" });
            const input = label.querySelector("input")!;
            Object.assign(input.style, { width: "16px", height: "16px", margin: "2px 0 0" });
            this.settingsContent.appendChild(label);
        }
        this.settingsContent.prepend(floorViewLabel);

        this.toolCue = document.createElement("div");
        this.toolCue.dataset.mapEditor = "tool-cue";
        this.toolCue.setAttribute("role", "status");
        Object.assign(this.toolCue.style, PANEL_STYLE, {
            bottom: "12px", left: "50%", transform: "translateX(-50%)", pointerEvents: "none",
            padding: "6px 12px", maxWidth: "min(440px, calc(100vw - 100px))", textAlign: "center",
        });
        document.body.appendChild(this.toolCue);
        this.session.savedNpcSpawnsKey ??= this.npcSpawnsKey();
        this.fileStatus = document.createElement("span");
        this.fileStatus.setAttribute("role", "status");
        Object.assign(this.fileStatus.style, { color: "#cbd5e1", marginLeft: "8px", whiteSpace: "nowrap" });
        this.layout.status.append(this.fileStatus);

        const viewport = document.querySelector<HTMLElement>(".game-viewport");
        this.canvasShell =
            viewport?.querySelector<HTMLElement>(".game-canvas-shell") ?? undefined;
        this.previousCanvasStyle = this.canvasShell?.getAttribute("style") ?? null;
        if (this.canvasShell) {
            Object.assign(this.canvasShell.style, { top: "41px", left: "55px", right: "var(--rspsi-right, 300px)", bottom: "var(--rspsi-bottom-height, 43px)", width: "auto", height: "auto" });
            requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        }

        this.layout.onPaletteChange = (tab) => this.renderSwatches(tab);
        this.layout.onPalette = (tab) => this.showSwatches(tab);
        this.layout.addSelectionControls(selectMode, this.heightInput);
        this.saveButton = this.layout.addFileAction("Save", () => this.saveCurrentChanges());
        this.layout.onPalette("Objects");
        document.body.classList.add("map-editor-active");
        window.addEventListener("paste", this.onAreaPaste);
        window.addEventListener("keydown", this.onSaveShortcut);
        window.addEventListener("keydown", this.onToolEscape, true);
        this.sync();
        this.unsubscribe = plugin.subscribe(() => this.sync());
        void this.importPersistedNpcSpawns();
    }

    remove(): void {
        this.scatterRequest++;
        this.swatchRequest++;
        if (this.minimapUrl) URL.revokeObjectURL(this.minimapUrl);
        document.body.classList.remove("map-editor-active", "map-editor-rspsi");
        this.unsubscribe();
        this.inspectorToolPanel?.remove();
        this.inspectorToolPanel = undefined;
        this.objectSwatches.unmount();
        this.layout.remove();
        this.plugin.setPointerTileListener(undefined);
        this.plugin.setNoticeListener(undefined);
        document.body.style.removeProperty("--map-editor-panel-left");
        this.palette.remove();
        this.selectionDetails.remove();
        this.closeSettings();
        if (this.canvasShell) {
            if (this.previousCanvasStyle === null) this.canvasShell.removeAttribute("style");
            else this.canvasShell.setAttribute("style", this.previousCanvasStyle);
        }
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        this.detailPanel?.remove();
        this.areaPanel?.remove();
        this.brushPanel?.remove();
        this.closeLandscapePanel();
        this.plugin.clearTileFlagOverlays();
        this.travelPanel?.remove();
        this.travel.detach();
        this.regionPanel?.remove();
        this.plugin.closeWorldMap();
        this.itemsPanel?.remove();
        this.plugin.setStampItemHistory();
        this.session.changed = undefined;
        this.session.notify = undefined;

        this.placementOptions?.remove();
        this.buildPanel?.remove();
        this.wallPanel?.remove();
        this.toolCue.remove();
        this.plugin.previewGroundItems([]);
        this.filesPanel?.remove();
        window.removeEventListener("paste", this.onAreaPaste);
        window.removeEventListener("keydown", this.onSaveShortcut);
        window.removeEventListener("keydown", this.onToolEscape, true);
    }

    private get travel(): EditorTravel { return this.session.travel; }
    private get groundItems(): EditorGroundItems { return this.session.groundItems; }
    private get mapFiles(): EditorMapFiles | undefined { return this.session.files; }
    private set mapFiles(files: EditorMapFiles | undefined) { this.session.files = files; }
    private get savedNpcSpawnsKey(): string { return this.session.savedNpcSpawnsKey ?? "[]"; }
    private set savedNpcSpawnsKey(key: string) { this.session.savedNpcSpawnsKey = key; }

    private dismissToolPanel(keepTool = false): void {
        this.closeJumpToLocation();
        this.plugin.closeWorldMap();
        if (this.scattering) this.updateScatterAsset?.();
        if (this.areaPanel?.isConnected) this.closeAreaPanel();
        if (this.brushPanel?.isConnected) this.closeBrushPanel();
        if (this.travelPanel?.isConnected) this.closeTravelPanel();
        this.regionPanel?.remove();
        this.palette.setVisible(false);
        this.itemsPanel?.remove();

        this.placementOptions?.remove();
        this.buildPanel?.remove();
        this.wallPanel?.remove();
        this.filesPanel?.remove();
        this.closeLandscapePanel();
        this.closeSettings();
        this.closeDetailPanel();
        this.inspectorToolPanel?.remove();
        if (!keepTool && this.plugin.getConfig().tool !== "select") {
            this.plugin.setConfig({ tool: "select" });
        }
    }

    private inspectorPanel(name: string, keepTool = false): HTMLElement {
        this.dismissToolPanel(keepTool);
        return this.attachInspectorPanel(name);
    }

    private attachInspectorPanel(name: string): HTMLElement {
        this.layout.openSidebar();
        this.layout.activatePalette(["build-presets", "area-stamps", "draw-wall"].includes(name) ? "Settlements" :
            ["placement-variant", "object-placement", "ground-items"].includes(name) ? "Objects" :
                name === "terrain-line-tool" ? "Overlays" : "Misc");
        const panel = createPanel(name, "min(330px, calc(100vw - var(--map-editor-panel-left, 62px) - 13px))");
        Object.assign(panel.style, {
            right: "12px", left: "auto", top: TOP_BAR_CLEARANCE,
            maxHeight: "calc(100dvh - 125px)", overflowY: "auto",
        });
        const observer = new window.MutationObserver(() => {
            if (panel.isConnected) return;
            observer.disconnect();
            if (this.inspectorToolPanel === panel) {
                this.inspectorToolPanel = undefined;
                this.syncToolCue();
                this.renderSelection();
            }
        });
        observer.observe(document.body, { childList: true });
        this.inspectorToolPanel = panel;
        this.renderSelection();
        return panel;
    }

    private buildChoices(current: "wall" | "structure" | "stamp"): HTMLElement {
        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", gap: "5px", marginBottom: "8px" });

        for (const [id, label, action] of [
            ["wall", "Wall", () => this.openWallPanel()],
            ["structure", "Structure", () => this.openBuildPanel()],
            ["stamp", "Stamp", () => this.openAreaPanel()],
        ] as const) {
            const button = createCompactButton(label, label, action);
            button.setAttribute("aria-pressed", String(current === id));
            if (current === id) {
                button.style.borderColor = "#60a5fa";
                button.style.color = "#eef4ff";
            }
            button.disabled = current === id;
            row.append(button);
        }
        return row;
    }

    private openWallPanel(): void {
        const panel = this.inspectorPanel("draw-wall");
        this.wallPanel = panel;
        panel.append(createHeader("Draw walls", () => {
            panel.remove();
            if (this.plugin.getConfig().tool === "wall") this.plugin.setConfig({ tool: "select" });
        }), this.buildChoices("wall"));
        const body = document.createElement("div");
        Object.assign(body.style, { display: "grid", gap: "7px" });
        const current = this.plugin.getWallBrush();
        const material = this.choice([["", `Wall #${current.wall}`]]);
        material.disabled = true;
        const shape = this.choice([["straight", "Follow tile edges"], ["diagonal", "Use diagonal pieces"]]);
        const opening = this.choice([["none", "Continuous wall"], ["gap", "Open passage"], ["gate", "Door or gate"]]);
        const flatten = document.createElement("input");
        flatten.type = "checkbox";
        const ground = document.createElement("label");
        ground.append(flatten, " Level the ground under the wall");
        const preview = this.assetPreview("loc");
        shape.value = current.mode;
        opening.value = current.opening;
        flatten.checked = current.flatten;
        const openingHint = document.createElement("small");
        openingHint.textContent = "Openings need a run of at least three tiles.";
        const status = document.createElement("span");
        status.setAttribute("role", "status");
        let available: Awaited<ReturnType<EditModePlugin["loadMapPlans"]>>["styles"] = [];
        let styleStatus = "Loading wall styles…";
        const update = () => {
            const entry = available.find(({ name }) => name === material.value);
            const brush = entry ?? current;
            shape.options[1].disabled = brush.diagonal === null;
            if (shape.options[1].disabled) shape.value = "straight";
            opening.options[2].disabled = shape.value === "diagonal" || brush.gate === null;
            const movedOpening = opening.value === "gate" && opening.options[2].disabled;
            if (movedOpening) opening.value = "gap";
            openingHint.hidden = opening.value === "none";
            this.plugin.setWallBrush({
                wall: brush.wall, diagonal: brush.diagonal, diagonalJoin: brush.diagonalJoin ?? null, gate: brush.gate,
                variants: brush.variants ?? [], mode: shape.value === "diagonal" ? "diagonal" : "straight",
                opening: opening.value as "none" | "gap" | "gate", flatten: flatten.checked,
            });
            preview.update((shape.value === "diagonal" ? brush.diagonal : brush.wall) ?? undefined);
            status.textContent = movedOpening ? "Door or gate unavailable. Using an open passage." : entry?.about ?? styleStatus;
        };
        for (const field of [material, shape, opening, flatten]) field.onchange = update;
        body.append("Click a start tile, then preview the run. Click the end tile to build. Press R to rotate.",
            this.labeledField("Wall style", material), preview.image,
            this.labeledField("Alignment", shape), this.labeledField("Opening at centre", opening), openingHint, ground, status);
        panel.append(body);
        update();
        this.plugin.setConfig({ tool: "wall" });
        void this.plugin.loadMapPlans().then(({ styles }) => {
            if (!panel.isConnected) return;
            available = styles.filter(({ roles }) => roles.includes("wall"));
            const matchingStyle = available.find(({ wall }) => wall === current.wall);
            if (matchingStyle) material.replaceChildren();
            for (const { name, label } of available) material.add(new window.Option(label, name));
            material.value = matchingStyle?.name ?? "";
            material.disabled = available.length === 0;
            styleStatus = available.length === 0 ? "Additional wall styles are unavailable." : "";
            update();
        }).catch(() => {
            if (!panel.isConnected) return;
            styleStatus = "Additional wall styles are unavailable.";
            status.textContent = styleStatus;
        });
    }

    private openEditorHelp(): void {
        if (this.inspectorToolPanel?.dataset.mapEditor === "editor-help") {
            this.inspectorToolPanel.remove();
            return;
        }
        const trigger = document.activeElement as HTMLElement | null;
        const panel = this.inspectorPanel("editor-help", true);
        panel.style.width = "min(390px, calc(100vw - var(--map-editor-panel-left, 62px) - 13px))";
        panel.append(createHeader("Map editor help", () => {
            panel.remove();
            trigger?.focus({ preventScroll: true });
        }));
        attachEditorHelp(panel);
    }

    private readonly onToolEscape = (event: KeyboardEvent): void => {
        if (event.key !== "Escape" || event.repeat) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('[data-map-editor="tool-finder"]')) return;
        if (this.plugin.isWorldMapOpen()) return;
        if (this.inspectorToolPanel?.dataset.mapEditor === "editor-help" && this.inspectorToolPanel.isConnected) {
            this.inspectorToolPanel.querySelector<HTMLButtonElement>("button")?.click();
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (this.landscapePanel?.isConnected) {
            this.closeLandscapePanel();
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (this.jumpPanel) {
            this.closeJumpToLocation(true);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (this.plugin.cancelBrushStroke()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const { tool: activeTool } = this.plugin.getConfig();
        if (this.brushPanel?.isConnected && (!event.defaultPrevented || activeTool === "select")) {
            this.closeBrushPanel(true);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (activeTool === "terrain" && !event.defaultPrevented) {
            this.plugin.setConfig({ tool: "select" });
            event.preventDefault(); event.stopPropagation(); return;
        }
        if (this.detailPanel?.dataset.mapEditor === "review-changes") {
            this.closeDetailPanel();
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.defaultPrevented && this.plugin.getConfig().tool === "scatter") return;
        if (this.selectionDetails.style.display === "block") {
            this.plugin.clearSelection();
            return;
        }
        if (this.scattering) this.updateScatterAsset?.();
        const tool = this.plugin.getConfig().tool;
        if (tool === "pick") {
            event.preventDefault();
            event.stopPropagation();
            this.plugin.setConfig({ tool: "select" });
            return;
        }
        if (this.areaPanel?.isConnected || this.buildPanel?.isConnected || this.wallPanel?.isConnected) {
            const cancelledEndpoint = tool === "wall" && (event.defaultPrevented || this.plugin.cancelLineStart());
            event.preventDefault();
            event.stopPropagation();
            if (!cancelledEndpoint) this.dismissToolPanel();
        }
    };

    private readonly onSaveShortcut = (event: KeyboardEvent): void => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
        event.preventDefault();
        this.saveCurrentChanges();
    };

    private async saveCurrentChanges(): Promise<void> {
        if (this.saving || !this.hasUnsavedChanges()) return;
        if (browserHostWindow() || this.mapFiles) {
            await this.exportRegions();
            return;
        }
        if (!EditorMapFiles.supported()) {
            if (!this.review) this.showReview();
            this.review?.download.focus();
            return;
        }
        this.saving = true;
        try {
            this.mapFiles = await EditorMapFiles.open();
        } catch (error) {
            if ((error as DOMException)?.name !== "AbortError") {
                this.toast(error instanceof Error ? error.message : String(error));
            }
        } finally {
            this.saving = false;
        }
        if (this.mapFiles) await this.exportRegions();
    }

    private openTravelPanel(from?: EditModeSelection): void {
        this.layout.revealTask("travel");
        if (this.travelPanel?.isConnected) {
            if (from) this.travel.useObject(from);
            return;
        }
        const panel = this.inspectorPanel("travel-links");
        if (this.plugin.getSelectionMode() !== "entity") this.plugin.setSelectionMode("entity");
        this.travelPanel = panel;
        const nearby = document.createElement("div");
        nearby.dataset.mapEditor = "travel-nearby";
        panel.append(createHeader("Travel & Warps", () => this.closeTravelPanel()), nearby);
        this.travel.attach(panel, from, nearby);
        this.syncToolCue();
    }

    private closeTravelPanel(): void {
        this.travelPanel?.remove();
        this.travelPanel = undefined;
        this.travel.detach();
        if (this.plugin.getConfig().tool === "pick") this.plugin.setConfig({ tool: "select" });
    }

    private inspectTravelObject(selection: EditModeSelection | undefined): void {
        if (selection === this.travelSelection) return;
        this.travelSelection = selection;
        const config = this.plugin.getConfig();
        if (selection?.kind !== "loc" || config.tool !== "select" ||
            this.palette.isVisible() || (this.inspectorToolPanel?.isConnected && !this.travelPanel?.isConnected)) return;
        const open = () => {
            if (!this.selectionDetails.isConnected || this.plugin.getState().selection !== selection || this.plugin.getConfig().tool !== "select" ||
                (!this.travelPanel?.isConnected && this.layout.getWorkspace() !== "Select") ||
                !this.travel.hasObject(selection)) return;
            this.openTravelPanel(selection);
        };
        if (this.travel.hasObject(selection)) open();
        else void this.travel.load().then(open);
    }

    private openGroundItems(itemId?: number): void {
        if (this.itemsPanel?.isConnected) {
            if (itemId !== undefined) this.groundItems.useItem(itemId);
            return;
        }
        const panel = this.inspectorPanel("ground-items");
        this.itemsPanel = panel;
        Object.assign(panel.style, { maxHeight: "calc(100dvh - 125px)", overflowY: "auto" });
        panel.append(createHeader("Ground items", () => panel.remove()));
        if (itemId !== undefined) {
            const preview = this.assetPreview("item");
            panel.append(preview.image);
            preview.update(itemId);
        }
        this.groundItems.attach(panel, itemId);
    }

    private updateObjectControls(): void {
        const controls = document.createElement("div");
        controls.dataset.mapEditor = "object-placement";
        const modes = document.createElement("div");
        Object.assign(modes.style, { display: "flex", gap: "5px", marginTop: "8px" });
        const body = document.createElement("div");
        const fields = document.createElement("div");
        Object.assign(fields.style, { display: "grid", gap: "6px", marginTop: "6px" });
        body.append(fields);
        const set = document.createElement("select");
        set.setAttribute("aria-label", "Scenery set");
        Object.assign(set.style, INPUT_STYLE);
        const fallback: Record<string, string[]> = {
            forest: ["Tree", "Oak", "Willow", "Fern"],
            desert: ["Cactus", "Palm tree", "Rocks"],
            swamp: ["Swamp tree", "Dead tree", "Reeds", "Mushroom"],
            tropical: ["Palm tree", "Jungle tree", "Teak", "Fern"],
            alpine: ["Evergreen", "Pine tree", "Boulder", "Rocks"],
        };
        for (const [id, name] of [
            ["forest", "Temperate forest"], ["desert", "Desert"], ["swamp", "Swamp (Mort Myre)"],
            ["tropical", "Tropical (Karamja)"], ["alpine", "Alpine"], ["", "Selected search result"],
        ]) set.add(new window.Option(name, id));
        let savedSets = readScatterSets();
        const savedGroup = document.createElement("optgroup");
        savedGroup.label = "My scatter sets";
        const savedKey = (set: EditorScatterSet) => `saved:${set.name}`;
        const refreshSets = (selection: string) => {
            savedGroup.replaceChildren(...savedSets.map((saved) => new window.Option(saved.name, savedKey(saved))));
            savedGroup.hidden = !savedSets.length;
            set.value = [...set.options].some((option) => option.value === selection) ? selection : "forest";
            this.scatterSettings.set = set.value;
        };
        set.append(savedGroup);
        refreshSets(this.scatterSettings.set);
        const chosenSet = () => savedSets.find((saved) => savedKey(saved) === set.value);
        let draft: { original?: EditorScatterSet; ids: Set<number> } | undefined;
        const draftPanel = document.createElement("div");
        draftPanel.hidden = true;
        const draftName = document.createElement("input");
        draftName.placeholder = "e.g. Ruined garden";
        draftName.setAttribute("aria-label", "Scatter set name");
        draftName.maxLength = 48;
        Object.assign(draftName.style, INPUT_STYLE);
        const members = document.createElement("div");
        Object.assign(members.style, {
            display: "flex", flexWrap: "wrap", gap: "4px", marginBlock: "6px",
            maxHeight: "105px", overflowY: "auto"
        });
        const status = document.createElement("div");
        status.role = "status";
        const radius = document.createElement("input");
        const density = document.createElement("input");
        for (const [input, min, max, value] of [
            [radius, 0, 10, this.scatterSettings.radius],
            [density, MIN_SCATTER_DENSITY * 100, MAX_SCATTER_DENSITY * 100, this.scatterSettings.density],
        ] as const) {
            Object.assign(input.style, { width: "100%" });
            input.type = "range";
            input.min = String(min);
            input.max = String(max);
            input.value = String(value);
        }
        density.step = "0.1";
        const sizeLabel = document.createElement("label");
        const densityLabel = document.createElement("label");
        sizeLabel.append(document.createTextNode(""), radius);
        densityLabel.append(document.createTextNode(""), density);
        const labels = () => {
            sizeLabel.firstChild!.textContent = radius.value === "0" ? "Radius: one tile" : `Radius: ${radius.value} tiles`;
            densityLabel.firstChild!.textContent = `Density: ${density.value}%`;
        };
        let cachedSet: string | undefined;
        let cachedIds: readonly number[] = [];
        const enable = async () => {
            const request = ++this.scatterRequest;
            if (draft) {
                this.plugin.prepareScatter();
                status.textContent = "Click search results to add or remove objects from the set.";
                return;
            }
            const selected = set.value;
            const id = this.plugin.getConfig().locId;
            const apply = (ids: readonly number[]) => {
                if (request !== this.scatterRequest) return;
                this.plugin.armScatter(ids, radius.valueAsNumber, density.valueAsNumber / 100);
                status.textContent = selected ? `${new Set(ids).size} scenery types in this set`
                    : this.plugin.getLocName(id) || "Selected object";
            };
            try {
                if (!selected) { apply([id]); return; }
                const saved = chosenSet();
                if (saved) { apply(saved.ids); return; }
                if (cachedSet === selected) { apply(cachedIds); return; }
                this.plugin.prepareScatter();
                status.textContent = "Loading scenery…";
                let ids = await loadBiomeScenery((part) => this.plugin.landscapeData(part), selected).then((assets) => assets.map((asset) => asset.id), () => []);
                if (!ids.length && request === this.scatterRequest) {
                    ids = (await Promise.all(fallback[selected].map(async (name) =>
                        (await this.plugin.searchScenery(name)).filter((entry) => entry.name.toLowerCase().includes(name.toLowerCase()))
                            .slice(0, 4).map((entry) => entry.id),
                    ))).flat();
                }
                if (request !== this.scatterRequest) return;
                apply(ids);
                cachedSet = selected;
                cachedIds = ids;
            } catch (error) {
                if (request !== this.scatterRequest) return;
                this.plugin.prepareScatter();
                status.textContent = error instanceof Error ? error.message : String(error);
            }
        };
        const choose = (scatter: boolean) => {
            this.scattering = scatter;
            body.hidden = !scatter;
            single.setAttribute("aria-pressed", String(!scatter));
            spread.setAttribute("aria-pressed", String(scatter));
            single.style.borderColor = scatter ? "" : "#60a5fa";
            spread.style.borderColor = scatter ? "#60a5fa" : "";
            this.palette.editScatterMembership(scatter ? draft?.ids : undefined);
            if (scatter) void enable();
            else {
                this.scatterRequest++;
                if (this.plugin.getConfig().tool === "scatter") this.plugin.setConfig({ tool: "select" });
            }
        };
        const single = createCompactButton("Single", "Place one object at a time", () => choose(false));
        const spread = createCompactButton("Scatter", "Place scenery with a brush", () => choose(true));
        modes.append(single, spread);
        const setActions = document.createElement("div");
        Object.assign(setActions.style, { display: "flex", flexWrap: "wrap", gap: "4px" });
        const refreshDraft = () => {
            draftPanel.hidden = !draft;
            setActions.style.display = draft ? "none" : "flex";
            set.disabled = !!draft;
            editSet.hidden = !chosenSet();
            removeSet.hidden = !draft?.original;
            this.palette.editScatterMembership(this.scattering ? draft?.ids : undefined);
            members.replaceChildren();
            for (const id of draft?.ids ?? []) {
                const name = this.plugin.getLocName(id) || `Object ${id}`;
                members.append(createCompactButton(`${name} ×`, `Remove ${name} from set`, () => {
                    draft?.ids.delete(id);
                    refreshDraft();
                }));
            }
            if (draft && !draft.ids.size) members.append("Choose objects from the search results.");
        };
        const startDraft = (original?: EditorScatterSet) => {
            draft = { original, ids: new Set(original?.ids) };
            draftName.value = original?.name ?? "";
            refreshDraft();
            void enable();
            draftName.focus();
        };
        const finish = (selection: string) => {
            draft = undefined;
            refreshSets(selection);
            refreshDraft();
            void enable();
        };
        const persist = (sets: EditorScatterSet[], selection: string) => {
            try { writeScatterSets(sets); }
            catch { status.textContent = "Browser storage could not save this scatter set."; return; }
            savedSets = sets;
            finish(selection);
        };
        const editSet = createCompactButton("Edit set", "Edit selected scatter set", () => startDraft(chosenSet()));
        const removeSet = createCompactButton("Delete set", "Delete this saved scatter set", () => {
            if (draft?.original) persist(savedSets.filter((saved) => saved !== draft?.original), "forest");
        });
        setActions.append(createCompactButton("New set", "Create a scatter set", () => startDraft()), editSet);
        const draftActions = document.createElement("div");
        Object.assign(draftActions.style, { display: "flex", flexWrap: "wrap", gap: "4px" });
        draftActions.append(createCompactButton("Save set", "Save this scatter set", () => {
            const name = draftName.value.trim();
            if (!name || !draft?.ids.size) { status.textContent = "Name the set and choose at least one object."; return; }
            const others = savedSets.filter((saved) => saved !== draft?.original);
            if (others.some((saved) => saved.name.toLowerCase() === name.toLowerCase())) {
                status.textContent = "A scatter set already has that name.";
                return;
            }
            const next = { name, ids: [...draft.ids] };
            persist([...others, next], savedKey(next));
        }), createCompactButton("Cancel", "Cancel editing this set", () => finish(set.value)), removeSet);
        draftPanel.append(draftName, members, draftActions);
        this.pickScatterSetMember = (id) => {
            if (!draft || !this.scattering) return false;
            if (!draft.ids.delete(id)) {
                if (!this.plugin.canScatter(id)) { status.textContent = "Choose scenery that can be placed with a scatter brush."; return true; }
                draft.ids.add(id);
            }
            refreshDraft();
            return true;
        };
        set.onchange = () => { this.scatterSettings.set = set.value; refreshDraft(); void enable(); };
        for (const input of [radius, density]) {
            input.oninput = labels;
            input.onchange = () => {
                this.scatterSettings.radius = radius.valueAsNumber;
                this.scatterSettings.density = density.valueAsNumber;
                void enable();
            };
        }
        this.updateScatterAsset = (id) => {
            if (id === undefined) choose(false);
            else {
                set.value = "";
                this.scatterSettings.set = "";
                void enable();
            }
        };
        this.activateScatter = () => choose(true);
        labels();
        const timing = this.createBrushTimingControl();
        const setLabel = document.createElement("label");
        setLabel.append("Scenery set", set);
        status.setAttribute("aria-live", "polite");
        fields.append(setLabel, setActions, draftPanel, sizeLabel, densityLabel, timing.element, status);
        this.syncScatterInputs = () => {
            const current = this.plugin.getConfig().tool === "scatter" ? this.plugin.getBrushRadius() : undefined;
            if (current !== undefined) {
                this.scatterSettings.radius = current;
                radius.value = String(current);
                labels();
            }
            timing.sync();
        };
        refreshDraft();
        controls.append(modes, body);
        choose(false);
        this.palette.setObjectControls(controls);
    }

    private labeledField(text: string, control: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
        const label = document.createElement("label");
        Object.assign(label.style, { display: "grid", gap: "3px", minWidth: "0" });
        Object.assign(control.style, INPUT_STYLE, { minWidth: "0" });
        label.append(text, control);
        return label;
    }

    private choice(options: readonly (readonly [string, string])[]): HTMLSelectElement {
        const select = document.createElement("select");
        for (const [value, label] of options) select.add(new window.Option(label, value));
        return select;
    }

    private assetPreview(kind: EditModeSearchKind, size = "58px") {
        const image = document.createElement("img");
        image.alt = "";
        image.hidden = true;
        Object.assign(image.style, {
            width: size, height: size, objectFit: "contain",
            background: "#111318", borderRadius: "4px"
        });
        let selected: number | undefined;
        return {
            image,
            update: (id?: number) => {
                if (id === selected) return;
                selected = id;
                image.hidden = true;
                if (id === undefined) return;
                void this.plugin.loadAssetThumbnail(kind, id).then((url) => {
                    if (id !== selected || !image.isConnected || !url) return;
                    image.src = url;
                    image.hidden = false;
                }).catch(() => { });
            },
        };
    }

    private openBuildPanel(from?: EditModeSelection): void {
        const panel = this.inspectorPanel("build-presets");
        this.buildPanel = panel;
        panel.append(createHeader("Generate structure", () => panel.remove()), this.buildChoices("structure"));
        this.syncToolCue();
        const body = document.createElement("div");
        Object.assign(body.style, { display: "grid", gap: "7px" });
        body.append("Loading construction presets…");
        panel.append(body);
        const defaults = this.session.structure;
        void this.plugin.loadMapPlans().then(({ presets, styles, generators, interiors, exteriors }) => {
            if (!panel.isConnected) return;
            body.replaceChildren();
            const kind = this.choice([
                ...generators.map(({ name, label }) => [name, label] as const),
                ...presets.map(({ name }) => [name, name.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase())] as const),
            ]);
            if (!kind.options.length) { body.textContent = "No structure designs are available."; return; }
            if ([...kind.options].some(({ value }) => value === defaults.kind)) kind.value = defaults.kind;
            const style = document.createElement("select");
            const entrance = this.choice([["south", "South"], ["north", "North"], ["east", "East"], ["west", "West"]]);
            const crop = this.choice([["wheat", "Wheat"], ["cabbage", "Cabbage"], ["potato", "Potato"]]);
            const levels = this.choice([["1", "One storey"], ["2", "Two storeys"]]);
            const interior = this.choice(interiors.map(({ name, label }) => [name, label]));
            const exterior = this.choice(exteriors.map(({ name, label }) => [name, label]));
            const width = document.createElement("input");
            const depth = document.createElement("input");
            const seed = document.createElement("input");
            for (const input of [width, depth, seed]) {
                input.type = "number";
                input.step = "1";
            }
            seed.min = "0";
            seed.max = String(0x7fffffff);
            const about = document.createElement("div");
            about.style.color = "#bbc9dc";
            const fields = document.createElement("div");
            Object.assign(fields.style, { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "7px" });
            const material = this.assetPreview("loc");
            const styleField = this.labeledField("Material style", style);
            const styleDescription = document.createElement("small");
            styleDescription.style.color = "#bbc9dc";
            styleField.append(styleDescription, material.image);
            styleField.style.gridColumn = "span 2";
            const optional = [
                ["Entrance", entrance, "entrance"], ["Storeys", levels, "storeys"], ["Crop", crop, "crop"],
                ["Interior", interior, "interior"], ["Exterior", exterior, "exterior"],
            ] as const;
            const extraFields = optional.map(([label, input, key]) => ({ field: this.labeledField(label, input), key }));
            const seedField = this.labeledField("Design seed", seed);
            seedField.style.gridColumn = "span 2";
            const roll = createCompactButton("Random seed", "Generate another repeatable design", () => {
                const next = Math.floor(Math.random() * 0x80000000);
                seed.value = String(next === Number(seed.value) ? (next + 1) % 0x80000000 : next);
                saveDraft();
                preview.click();
            });
            roll.replaceChildren(createRefreshIcon());
            roll.className = "rspsi-seed-roll";
            const seedControls = document.createElement("div");
            seedControls.className = "rspsi-seed-controls";
            seed.replaceWith(seedControls);
            seedControls.append(seed, roll);
            fields.append(styleField, this.labeledField("Width in tiles", width), this.labeledField("Depth in tiles", depth),
                ...extraFields.map(({ field }) => field), seedField);
            const result = document.createElement("div");
            Object.assign(result.style, { display: "grid", gap: "6px" });
            const status = document.createElement("div");
            status.setAttribute("role", "status");
            const selectedArea = from && from.tileEndX !== undefined && from.tileEndY !== undefined &&
                (from.tileEndX !== from.tileX || from.tileEndY !== from.tileY) ? {
                    tileX: Math.min(from.tileX, from.tileEndX), tileY: Math.min(from.tileY, from.tileEndY), plane: from.plane,
                } : undefined;
            type PreparedStructure = { contents: string; name: string };
            let readyPlan: PreparedStructure | undefined;
            const place = createCompactButton(selectedArea ? "Place on area" : "Place on map",
                selectedArea ? "Place this design in the selected area" : "Place this design on the map", async () => {
                    const plan = readyPlan ?? await generatePreview();
                    if (!plan || !panel.isConnected) return;
                    this.areaOptions = { terrain: "floors", interactive: true, turns: 0 };
                    this.openAreaPanel("Place structure");
                    this.stageArea(plan.contents, plan.name);
                    if (selectedArea) this.plugin.placeStamp(selectedArea, () => this.closeAreaPanel());
                });
            const recipe = () => generators.find(({ name }) => name === kind.value);
            const values = { width, height: depth, entrance, crop, storeys: levels, interior, exterior, seed };
            const validNumber = (input: HTMLInputElement) => input.value !== "" && input.validity.valid;
            let request = 0;
            const showMaterial = () => {
                const entry = styles.find(({ name }) => name === (style.value || recipe()?.defaultStyle));
                styleDescription.textContent = entry?.about ?? "";
                material.update(entry?.wall);
            };
            const invalidatePreview = () => {
                request++;
                result.replaceChildren();
                readyPlan = undefined;
                place.disabled = false;
                status.textContent = "";
                preview.disabled = false;
            };
            const saveDraft = () => {
                if (recipe()) {
                    const draft = defaults.drafts.get(kind.value) ?? {};
                    for (const [key, input] of Object.entries(values)) {
                        if (input instanceof window.HTMLInputElement && !validNumber(input)) continue;
                        if (input.value) draft[key] = input.value;
                    }
                    defaults.drafts.set(kind.value, draft);
                }
                showMaterial();
                invalidatePreview();
            };
            const selectedDimensions = (first: number, last: number | undefined) => Math.abs((last ?? first) - first) + 1;
            const update = (selection?: EditModeSelection) => {
                const entry = recipe();
                const draft = defaults.drafts.get(kind.value) ?? {};
                about.textContent = entry?.about ?? presets.find(({ name }) => name === kind.value)?.about ?? "";
                fields.style.display = entry ? "grid" : "none";
                if (entry) {
                    const compatible = styles.filter(({ roles }) => roles.includes(entry.styleRole));
                    const defaultLabel = compatible.find(({ name }) => name === entry.defaultStyle)?.label;
                    style.replaceChildren(new window.Option(defaultLabel ? `Automatic (${defaultLabel})` : "Automatic", ""),
                        ...compatible.map(({ name, label }) => new window.Option(label, name)));
                    style.value = compatible.some(({ name }) => name === defaults.style) ? defaults.style : "";
                    const sizes = [
                        [width, draft.width, entry.defaultWidth, selection && selectedDimensions(selection.tileX, selection.tileEndX)],
                        [depth, draft.height, entry.defaultHeight, selection && selectedDimensions(selection.tileY, selection.tileEndY)],
                    ] as const;
                    for (const [input, previous, defaultSize, selectedSize] of sizes) {
                        input.min = String(entry.minSize);
                        input.max = String(entry.maxSize);
                        input.value = selectedSize ? String(Math.max(entry.minSize, Math.min(entry.maxSize, selectedSize))) :
                            previous ?? String(defaultSize);
                    }
                    entrance.value = draft.entrance ?? "south";
                    levels.value = draft.storeys ?? "1";
                    crop.value = draft.crop ?? "wheat";
                    interior.value = draft.interior ?? entry.interior ?? "auto";
                    exterior.value = draft.exterior ?? entry.exterior ?? "auto";
                    seed.value = draft.seed || "1";
                    for (const { key, field } of extraFields) field.style.display = entry[key] ? "grid" : "none";
                    seedField.style.display = entry.seeded ? "grid" : "none";
                    roll.hidden = !entry.seeded;
                }
                saveDraft();
            };
            kind.onchange = () => { defaults.kind = kind.value; update(); };
            style.onchange = () => { defaults.style = style.value; };
            for (const input of [width, depth, seed]) input.addEventListener("input", invalidatePreview);
            fields.addEventListener("change", saveDraft);
            const preview = createCompactButton("Generate preview", "Preview this structure before placing it", () => void generatePreview());
            const generatePreview = async (): Promise<PreparedStructure | undefined> => {
                const entry = recipe();
                if (entry) {
                    const invalid = [width, depth, ...(entry.seeded ? [seed] : [])].find((input) => !validNumber(input));
                    if (invalid) {
                        status.textContent = invalid === seed ? `Use a whole-number seed from 0 to ${Number(seed.max).toLocaleString()}.` :
                            `Use a whole-number ${invalid === width ? "width" : "depth"} from ${entry.minSize} to ${entry.maxSize} tiles.`;
                        invalid.focus();
                        return;
                    }
                }
                const selected = ++request;
                const name = kind.selectedOptions[0].textContent ?? kind.value;
                preview.disabled = true;
                readyPlan = undefined;
                place.disabled = true;
                result.replaceChildren();
                status.textContent = "Generating structure…";
                const query = new URLSearchParams({ name: kind.value });
                if (entry) {
                    query.set("width", width.value);
                    query.set("height", depth.value);
                    if (style.value) query.set("style", style.value);
                    for (const { key } of extraFields) if (entry[key]) query.set(key, values[key].value);
                    if (entry.seeded) query.set("seed", seed.value);
                }
                try {
                    const plan = await this.plugin.previewMapPlan(query);
                    if (!panel.isConnected || request !== selected) return;
                    const stamp = parseAreaStamp(plan);
                    status.textContent = `${stamp.width} × ${stamp.height} tiles · ${stamp.objects.length} objects`;
                    readyPlan = { contents: JSON.stringify(plan), name };
                    place.disabled = false;
                    result.append(this.buildPlanPreview(stamp));
                    return readyPlan;
                } catch (error) {
                    if (request === selected) status.textContent = error instanceof Error ? error.message : String(error);
                } finally {
                    if (request === selected) {
                        preview.disabled = false;
                        place.disabled = false;
                    }
                }
            };
            const placementActions = document.createElement("div");
            placementActions.className = "rspsi-build-actions";
            placementActions.append(preview, place);
            body.append(this.labeledField("Structure", kind), about, fields, placementActions, status, result);
            update(from);
        }).catch((error) => {
            if (panel.isConnected) body.textContent = error instanceof Error ? error.message : String(error);
        });
    }

    private buildPlanPreview(stamp: AreaStamp): HTMLElement {
        const view = document.createElement("div");
        const canvas = document.createElement("canvas");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "Top-down preview of the generated structure");
        Object.assign(canvas.style, {
            display: "block", width: "100%", maxHeight: "230px", objectFit: "contain",
            background: "#111318", imageRendering: "pixelated", borderRadius: "4px"
        });
        const scale = 8;
        canvas.width = stamp.width * scale;
        canvas.height = stamp.height * scale;
        const draw = (plane: number) => {
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            const yAt = (y: number) => canvas.height - (y + 1) * scale;
            ctx.fillStyle = "#111824";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            for (const tile of stamp.floors) {
                if (tile.plane !== plane || tile.overlay === undefined) continue;
                ctx.fillStyle = `#${this.overlayColor(tile.overlay.id).toString(16).padStart(6, "0")}`;
                ctx.fillRect(tile.x * scale, yAt(tile.y), scale, scale);
            }
            for (const object of stamp.objects) {
                if (object.plane !== plane || (object.shape >= 4 && object.shape <= 8) || (object.shape >= 12 && object.shape <= 21)) continue;
                const x = object.x * scale, y = yAt(object.y);
                if (object.shape <= 3 || object.shape === 9) {
                    ctx.fillStyle = "#d6dbdf";
                    const ends = [
                        [x, y, 2, scale], [x, y, scale, 2],
                        [x + scale - 2, y, 2, scale], [x, y + scale - 2, scale, 2],
                    ];
                    const [left, top, w, h] = ends[object.rotation];
                    ctx.fillRect(left, top, w, h);
                } else {
                    ctx.fillStyle = object.shape === 22 ? "#97b587" : "#e3b975";
                    ctx.fillRect(x + 2, y + 2, scale - 4, scale - 4);
                }
            }
        };
        const planes = [...new Set([...stamp.floors, ...stamp.objects].map(({ plane }) => plane))].sort();
        if (planes.length > 1) {
            const floor = this.choice(planes.map((plane) => [String(plane), plane ? `Floor ${plane}` : "Ground floor"]));
            floor.onchange = () => draw(Number(floor.value));
            view.append(this.labeledField("Preview floor", floor));
        }
        view.append(canvas);
        draw(planes[0] ?? 0);
        return view;
    }

    private toggleFilesPanel(regionToCreate?: number): void {
        if (this.filesPanel?.isConnected && regionToCreate === undefined) {
            this.filesPanel.remove();
            return;
        }
        this.dismissToolPanel();
        const panel = createPanel("map-files", "min(350px, calc(100vw - var(--map-editor-panel-left, 62px) - 13px))");
        this.layout.activatePalette("Misc");
        this.filesPanel = panel;
        Object.assign(panel.style, { left: "var(--map-editor-panel-left, 12px)", top: TOP_BAR_CLEARANCE, maxHeight: "calc(100dvh - 85px)", overflowY: "auto" });
        const body = document.createElement("div");
        Object.assign(body.style, { display: "grid", gap: "7px" });
        panel.append(createHeader(regionToCreate === undefined ? "Map files" : "New region", () => panel.remove()), body);
        const render = () => {
            const files = this.mapFiles;
            body.replaceChildren();
            if (!files) {
                body.append("Connect your server’s data folder to save map edits as new layers.");
                if (EditorMapFiles.supported()) body.append(createCompactButton("Connect server folder", "Choose the server or data folder", () => {
                    void EditorMapFiles.open().then((opened) => {
                        this.mapFiles = opened;
                        this.syncSaveButton();
                        render();
                    }).catch((error) => {
                        if ((error as DOMException)?.name !== "AbortError") this.toast(String(error));
                    });
                }));
            } else {
                body.append("Restore a backup to add a layer that puts those files back. Restart the server to apply it.");
                body.append(
                    createCompactButton("Disconnect folder", "Stop saving to the connected server folder", () => {
                        this.mapFiles = undefined;
                        this.session.publication = undefined;
                        this.session.lastSaveStatus = undefined;
                        this.syncSaveButton();
                        render();
                    }),
                );
                const snapshots = document.createElement("select");
                snapshots.setAttribute("aria-label", "Map backup");
                Object.assign(snapshots.style, INPUT_STYLE);
                snapshots.add(new window.Option("Loading backups…", ""));
                body.append(snapshots, createCompactButton("Restore backup", "Restore the files in the selected backup", () => {
                    if (this.saving || !snapshots.value) return;
                    if (this.hasUnsavedChanges()) return this.toast("Save or undo pending edits before restoring");
                    if (!window.confirm("Restore this backup? The current files will be backed up first.")) return;
                    void this.withFileProgress("Restoring map backup…", () => files.restore(snapshots.value)).then(() => {
                        this.session.lastSaveStatus = "Backup restored. Restart the server and reopen the editor.";
                        this.session.publication = undefined;
                        this.syncSaveButton();
                        this.toast("Backup restored. Restart the world and reopen the editor.");
                        render();
                    }).catch((error) => this.toast(String(error)));
                }));
                void files.listBackups().then((names) => {
                    snapshots.replaceChildren(new window.Option(names.length ? "Choose a backup" : "No backups yet", ""));
                    for (const name of names) snapshots.add(new window.Option(name.slice(0, 19).replace("T", " "), name));
                }).catch((error) => this.toast(String(error)));
                const originals = document.createElement("select");
                Object.assign(originals.style, INPUT_STYLE);
                originals.setAttribute("aria-label", "Original map file");
                originals.add(new window.Option("Loading original files…", ""));
                void files.listOriginals().then((paths) => {
                    originals.replaceChildren(new window.Option(paths.length ? "Choose an original file" : "No originals saved yet", ""));
                    for (const path of paths) originals.add(new window.Option(path, path));
                }).catch((error) => this.toast(String(error)));
                const originalFiles = document.createElement("details");
                const originalSummary = document.createElement("summary");
                originalSummary.textContent = "Original files";
                originalFiles.append(originalSummary, originals, createCompactButton("Restore original", "Restore this file to its state before the first editor save", () => {
                    if (this.saving || !originals.value) return;
                    if (this.hasUnsavedChanges()) return this.toast("Save or undo pending edits before restoring");
                    if (!window.confirm(`Restore ${originals.value}? Its current version will be backed up first.`)) return;
                    void this.withFileProgress("Restoring original file…", () => files.restoreOriginal(originals.value)).then(() => {
                        this.session.lastSaveStatus = "Original restored. Restart the server and reopen the editor.";
                        this.session.publication = undefined;
                        this.syncSaveButton();
                        this.toast("Original restored. Restart the world and reopen the editor.");
                        render();
                    }).catch((error) => this.toast(String(error)));
                }));
                body.append(originalFiles);
            }
            if (regionToCreate === undefined) {
                body.append(createCompactButton("Review changes", "Review and save pending map changes", () => this.showReview()));
                return;
            }
            this.attachRegionCreation(body, regionToCreate);
        };
        render();
    }

    private openRegionPanel(region?: number): void {
        this.layout.revealTask("new-region");
        const panel = this.inspectorPanel("new-region");
        this.regionPanel = panel;
        const body = document.createElement("div");
        Object.assign(body.style, { display: "grid", gap: "8px" });
        panel.append(createHeader("Create map square", () => panel.remove()), body);
        const render = () => {
            body.replaceChildren();
            this.attachRegionCreation(body, region);
        };
        render();
        this.syncToolCue();
    }

    private attachRegionCreation(body: HTMLElement, regionId: number | undefined): void {
        const form = document.createElement("form");
        Object.assign(form.style, { display: "grid", gap: "8px" });
        const position = document.createElement("input");
        position.placeholder = "Region ID or x, y";
        position.value = regionId === undefined ? "" : String(regionId);
        position.setAttribute("aria-label", "New map square region ID");
        const source = document.createElement("input");
        source.placeholder = "Region ID or x, y";
        source.setAttribute("aria-label", "Source region ID");
        const ground = document.createElement("select");
        ground.setAttribute("aria-label", "New map base ground");
        const terrain = document.createElement("select");
        terrain.setAttribute("aria-label", "New map terrain");
        for (const [value, label] of [["land", "Rolling land"], ["cave", "Flat cave floor"], ["copy", "Copy existing terrain"]]) {
            terrain.add(new window.Option(label, value));
        }
        if (regionId !== undefined && (regionId & 255) >= 100) terrain.value = "cave";
        const materials = this.plugin.getUnderlaySwatches();
        for (const { id, colorRgb, name } of materials) {
            ground.add(new window.Option(name ?? `Ground ${id} (#${colorRgb.toString(16).padStart(6, "0")})`, String(id)));
        }
        if (materials.some(({ id }) => id === 48)) ground.value = "48";
        const parseRegion = (text: string) => {
            const tile = parseEditorLocation(text);
            return tile && regionIdOf(tile.tileX, tile.tileY);
        };
        const sourceField = this.labeledField("Terrain source", source);
        const groundField = this.labeledField("Base ground", ground);
        const materialSample = document.createElement("div");
        Object.assign(materialSample.style, { height: "14px", borderRadius: "3px", border: "1px solid #ffffff30" });
        groundField.append(materialSample);
        const caveBelow = document.createElement("input");
        caveBelow.type = "checkbox";
        const caveLabel = document.createElement("label");
        caveLabel.append(caveBelow, " Also create a matching cave square");
        const status = document.createElement("div");
        status.setAttribute("role", "status");
        status.style.color = "#bdcde1";
        const editExisting = createCompactButton("Edit this square", "Move to the selected existing square", () => {
            const id = parseRegion(position.value);
            if (id !== undefined) this.plugin.goToLocation(String(id));
        });
        editExisting.hidden = true;
        const create = createCompactButton("Create in editor", "Open the new square as an unsaved draft", () => { });
        create.type = "submit";
        const update = () => {
            const id = parseRegion(position.value);
            sourceField.style.display = terrain.value === "copy" ? "grid" : "none";
            groundField.style.display = terrain.value === "copy" ? "none" : "grid";
            caveLabel.hidden = terrain.value !== "land" || id === undefined || (id & 255) >= 100;
            const color = materials.find(({ id }) => id === Number(ground.value))?.colorRgb;
            materialSample.style.background = color === undefined ? "" : `#${color.toString(16).padStart(6, "0")}`;
            const occupied = id !== undefined && this.plugin.hasMapSquareData(id);
            const caveOccupied = id !== undefined && !caveLabel.hidden && caveBelow.checked && this.plugin.hasMapSquareData(id + 100);
            editExisting.hidden = !occupied;
            create.disabled = id === undefined || occupied || caveOccupied ||
                (terrain.value === "copy" && parseRegion(source.value) === undefined);
            if (id === undefined) status.textContent = "Choose a location or enter coordinates for an empty square.";
            else {
                const { minX, minY, maxX, maxY } = regionBounds(id);
                const condition = occupied ? "Map square already exists. Edit it or choose an empty square." :
                    caveOccupied ? "The matching cave square already exists." : "";
                status.textContent = `Region ${id} · 64 × 64 tiles · (${minX}, ${minY}) to (${maxX}, ${maxY})${condition ? `. ${condition}` : ""}`;
            }
        };
        position.oninput = source.oninput = terrain.onchange = ground.onchange = caveBelow.onchange = update;
        form.append(this.labeledField("Location", position));
        form.append(createCompactButton("Choose on world map", "Pick a map square visually", () => this.pickRegionFromMap()));
        form.append(status, editExisting, this.labeledField("Starting terrain", terrain), groundField, sourceField, caveLabel, create);
        const openLandscape = createCompactButton("Generate multi-square landscape", "Create terrain from a landform and biome", () =>
            this.openLandscapePanel(parseRegion(position.value)));
        body.append(form, openLandscape);
        update();
        form.onsubmit = (event) => {
            event.preventDefault();
            const id = parseRegion(position.value);
            const copy = terrain.value === "copy" ? parseRegion(source.value) : undefined;
            if (id === undefined || create.disabled || (terrain.value === "copy" && copy === undefined) || this.saving) return;
            const withCave = !caveLabel.hidden && caveBelow.checked;
            create.disabled = true;
            void this.withFileProgress("Creating map square…", async () => {
                const pack = await this.plugin.prepareNewRegion(id, Number(ground.value), terrain.value === "cave", copy);
                const packs = [{ regionId: id, data: pack }];
                if (withCave) packs.push({
                    regionId: id + 100, data: await this.plugin.prepareNewRegion(id + 100, Number(ground.value), true),
                });
                if (!form.isConnected) return;
                const { minX, minY } = regionBounds(id);
                this.stageMapSquares(packs, { tileX: minX + 32, tileY: minY + 32, plane: 0 });
                this.toast("New square is open. Use Review changes to save it.");
                this.filesPanel?.remove();
                this.regionPanel?.remove();
            }).catch((error) => {
                if (body.isConnected) status.textContent = error instanceof Error ? error.message : String(error);
            }).finally(() => {
                if (form.isConnected) {
                    const selected = parseRegion(position.value);
                    create.disabled = selected === undefined || this.plugin.hasMapSquareData(selected) ||
                        (!caveLabel.hidden && caveBelow.checked && this.plugin.hasMapSquareData(selected + 100));
                }
            });
        };
    }

    private stageMapSquares(packs: readonly EditModeRegionPack[], origin: EditModeTile, replace = false, keepView = false): void {
        if (oversizedRegionPacks(packs).length) throw new Error("This terrain is too large for a map packet. Try less scenery.");
        if (replace && this.hasDraftEdits(packs.map(({ regionId }) => regionId))) {
            throw new Error("This draft has edits. Undo them or find another site to try this layout.");
        }
        this.plugin.stageMapSquares(packs, origin, replace, keepView);
    }

    private hasDraftEdits(regions: readonly number[]): boolean {
        const ids = new Set(regions);
        const inside = (tile: EditModeTile) => ids.has(regionIdOf(tile.tileX, tile.tileY));
        return this.plugin.getConfig().edits.some(inside) || this.travel.changedSources.some(inside) ||
            this.groundItems.changedTiles.some(inside);
    }

    private async withFileProgress<T>(message: string, work: () => Promise<T>): Promise<T> {
        this.saving = true;
        const progress = document.createElement("dialog");
        progress.textContent = message;
        Object.assign(progress.style, { background: "#121418", color: "#eef4ff", border: "1px solid #607080", borderRadius: "6px" });
        progress.addEventListener("cancel", (event) => event.preventDefault());
        document.body.appendChild(progress);
        progress.showModal();
        try {
            return await work();
        } finally {
            progress.remove();
            this.saving = false;
        }
    }

    private openCurrentLandscapeDraft(): void {
        const tile = this.plugin.getCameraTile();
        const atCamera = tile && this.plugin.getNewMapSquare(regionIdOf(tile.tileX, tile.tileY));
        const pack = atCamera && this.session.landscapeSettings.has(atCamera.data) ? atCamera
            : this.plugin.getNewMapSquare(this.session.recentLandscapeSquare ?? -1);
        const draft = pack && this.session.landscapeSettings.get(pack.data);
        if (!pack || !draft) {
            this.toast("Move the editor to an unsaved generated map to reroll it.");
            return;
        }
        const query = new URLSearchParams(draft.query);
        this.openLandscapePanel(pack.regionId, {
            x: Number(query.get("x")), y: Number(query.get("y")),
            width: Number(query.get("width")), height: Number(query.get("height")), regions: draft.regions,
        }, query.get("extend") === "true", query.get("source") ?? undefined);
    }

    private openNewMapWizard(expand = false, initialFootprint?: MapFootprint): void {
        this.dismissToolPanel();
        this.plugin.closeWorldMap();
        this.plugin.toggleWorldMap({
            mode: "footprint",
            expand,
            initialFootprint,
            isFootprintOccupied: (id) => this.plugin.hasMapSquareData(id),
            loadOccupiedSquares: () => loadOccupiedMapSquares((part) => this.plugin.landscapeData(part)),
            selectFootprint: (footprint) => {
                const source = expand ? footprint.regions.flatMap((id) => [id - 256, id + 256, id - 1, id + 1])
                    .map((id) => this.plugin.getNewMapSquare(id)).find((pack) => pack && this.session.landscapeSettings.has(pack.data)) : undefined;
                const draft = source && this.session.landscapeSettings.get(source.data);
                this.openLandscapePanel(footprint.regions[0], footprint, expand, draft?.query);
            },
        });
    }

    private closeLandscapePanel(restoreCamera = true): void {
        this.landscapePanel?.remove();
        this.landscapePanel = undefined;
        this.plugin.clearTerrainPreview(restoreCamera);
    }

    private openLandscapePanel(region?: number, footprint?: MapFootprint, expand = false, source?: string): void {
        const current = this.plugin.getCameraTile();
        const id = region ?? regionIdOf(current?.tileX ?? 3200, current?.tileY ?? 3200);
        const { minX, minY } = regionBounds(id);
        const pack = this.plugin.getNewMapSquare(id);
        const draft = pack && this.session.landscapeSettings.get(pack.data);
        const panel = this.inspectorPanel("landscape");
        this.landscapePanel = panel;
        panel.dataset.landscapeTask = draft ? "edit-draft" : expand ? "expand-region" : "new-region";
        panel.append(createHeader(expand ? "Expand map portion · Shape terrain" : footprint ? "Create new map · Shape terrain" : "Generate landscape", () => this.closeLandscapePanel()));
        void attachLandscapeEditor(panel, { tileX: footprint?.x ?? minX, tileY: footprint?.y ?? minY, plane: 0 }, INPUT_STYLE, createCompactButton, {
            landscapeData: (part) => this.plugin.landscapeData(part),
            footprint,
            expand,
            source,
            changeFootprint: footprint && (() => {
                this.closeLandscapePanel();
                this.openNewMapWizard(expand, footprint);
            }),
            draft: draft?.regions.includes(id) && draft.regions.every((regionId) => this.plugin.isNewMapSquare(regionId)) ? draft : undefined,
            showScene: footprint && ((packs, location, span) => {
                if (oversizedRegionPacks(packs).length) throw new Error("This terrain is too large. Try less scenery.");
                this.plugin.showTerrainPreview(packs, location, span);
            }),
            focusScene: (tile, span) => this.plugin.focusTerrainPreview(tile, span),
            cancelScene: () => this.closeLandscapePanel(),
            pendingSquares: () => this.plugin.getNewMapSquares(),
            hasDraftEdits: (ids) => this.hasDraftEdits(ids),
            autoFindSite: region === undefined && !draft && this.plugin.hasMapSquareData(id),
            stage: (packs, origin, generated, replace) => {
                if (this.saving) throw new Error("Wait for the current map save to finish");
                this.stageMapSquares(packs, origin, replace, !!footprint);
                for (const pack of packs) this.session.landscapeSettings.set(pack.data, generated);
                this.session.recentLandscapeSquare = packs[0]?.regionId;
                if (footprint) {
                    this.closeLandscapePanel(false);
                    this.toast("Terrain kept as a draft. Open Review changes when you’re ready to save.");
                }
            },
        });
    }

    private readonly onAreaPaste = (event: ClipboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (target?.closest?.("input, textarea, select, [contenteditable]") ||
            !this.plugin.handlesCanvasInput() || this.plugin.isWorldMapOpen()) return;
        const contents = event.clipboardData?.getData("text/plain");
        if (contents?.slice(0, 180).includes("elvarg-map-area")) {
            event.preventDefault();
            this.openAreaPanel();
            this.stageArea(contents);
        }
    };

    private stageArea(contents: string, name?: string): void {
        try {
            if (contents.length > 4_000_000) throw new Error("The area file is too large");
            const area = parseAreaStamp(JSON.parse(contents));
            this.areaContents = contents;
            this.areaOptions = { ...this.areaOptions, foundation: area.foundation };
            this.plugin.armStamp({ ...area, name: name ?? area.name }, this.areaOptions);
        } catch (error) {
            this.toast(error instanceof Error ? error.message : String(error));
        }
    }

    private duplicateArea(): void {
        try {
            const contents = this.areaForClipboard();
            if (this.areaPanel?.isConnected) this.closeAreaPanel();
            this.areaOptions = { ...this.areaOptions, turns: 0 };
            this.openAreaPanel("Duplicate area");
            this.stageArea(contents);
        } catch (error) {
            this.toast(error instanceof Error ? error.message : String(error));
        }
    }

    private saveSelectionAsPreset(): void {
        try {
            const contents = this.areaForClipboard();
            this.openAreaPanel();
            this.areaContents = contents;
            this.syncAreaSummary();
            const library = this.areaPanel?.querySelector<HTMLDetailsElement>("details");
            if (library) library.open = true;
            this.areaPanel?.querySelector<HTMLInputElement>('[aria-label="Preset name"]')?.focus();
        } catch (error) {
            this.toast(error instanceof Error ? error.message : String(error));
        }
    }

    private areaForClipboard(): string {
        const contents = this.plugin.copyArea(true);
        const area = JSON.parse(contents) as { origin: { x: number; y: number }; width: number; height: number };
        const items = this.groundItems.capture(area.origin.x, area.origin.y, area.width, area.height);
        const building = this.plugin.getState().selection?.kind === "building";
        return items.length || building ? JSON.stringify({
            ...area,
            ...(items.length ? { items } : {}), ...(building ? { foundation: true } : {}),
        }) : contents;
    }

    private closeAreaPanel(): void {
        const stamp = this.plugin.getStamp();
        if (stamp) this.areaOptions = { ...stamp.options };
        this.areaPanel?.remove();
        this.areaSummary = undefined;
        if (stamp) this.plugin.setConfig({ tool: "select" });
    }

    private openAreaPanel(action: typeof this.areaAction = "Stamp area"): void {
        if (this.areaPanel?.isConnected && this.areaAction === action) return;
        void this.groundItems.ensureLoaded();
        const panel = this.inspectorPanel("area-stamps");
        this.areaAction = action;
        this.areaPanel = panel;
        panel.append(createHeader(action, () => this.closeAreaPanel()), this.buildChoices("stamp"));
        const presets = document.createElement("select");
        const savedGroup = document.createElement("optgroup");
        savedGroup.label = "Saved presets";
        const bundledGroup = document.createElement("optgroup");
        bundledGroup.label = "Built-in templates";
        const name = document.createElement("input");
        const terrain = document.createElement("select");
        for (const input of [presets, name, terrain]) Object.assign(input.style, INPUT_STYLE);
        name.placeholder = "Name for this preset";
        name.setAttribute("aria-label", "Preset name");
        name.maxLength = 48;
        presets.setAttribute("aria-label", "Area preset");
        presets.append(new window.Option("Choose a preset…", ""), savedGroup, bundledGroup);
        terrain.setAttribute("aria-label", "Terrain to stamp");
        const loadingOption = new window.Option("Loading templates…", "");
        loadingOption.disabled = true;
        bundledGroup.append(loadingOption);
        for (const [value, label] of [["objects", "Objects only"], ["floors", "Objects and building floors"], ["all", "Objects and all terrain"]]) {
            terrain.add(new window.Option(label, value));
        }
        terrain.value = this.areaOptions.terrain;
        const interactive = document.createElement("input");
        interactive.type = "checkbox";
        interactive.checked = this.areaOptions.interactive;
        const interactiveLabel = document.createElement("label");
        interactiveLabel.append(interactive, " Include objects with gameplay actions");
        const foundation = document.createElement("input");
        foundation.type = "checkbox";
        foundation.dataset.mapEditor = "stamp-foundation";
        const foundationLabel = document.createElement("label");
        foundationLabel.append(foundation, " Level ground under the structure");
        foundation.onchange = () => updateStamp({ foundation: foundation.checked });
        const entities = document.createElement("input");
        entities.type = "checkbox";
        entities.checked = this.areaOptions.entities ?? false;
        const entitiesLabel = document.createElement("label");
        entitiesLabel.append(entities, " Include NPC and ground item spawns");
        entities.onchange = () => {
            if (entities.checked) void this.groundItems.ensureLoaded();
            updateStamp({ entities: entities.checked });
        };
        this.areaSummary = document.createElement("div");
        this.areaSummary.setAttribute("aria-live", "polite");
        this.syncAreaSummary();
        const updateStamp = (options: Partial<AreaStampOptions>) => {
            this.areaOptions = { ...(this.plugin.getStamp()?.options ?? this.areaOptions), ...options };
            const stamp = this.plugin.getStamp();
            if (stamp) this.plugin.armStamp(stamp.area, this.areaOptions);
        };
        terrain.onchange = () => updateStamp({ terrain: terrain.value as AreaStampOptions["terrain"] });
        interactive.onchange = () => updateStamp({ interactive: interactive.checked });
        const chain = (run: () => Promise<void>) => void run().catch((error) =>
            this.toast(error instanceof Error ? error.message : String(error)),
        );
        const presetPrefix = "map-editor:area-preset:";
        const refreshPresets = () => {
            savedGroup.replaceChildren();
            try {
                Object.keys(window.localStorage).filter((key) => key.startsWith(presetPrefix)).sort()
                    .forEach((key) => savedGroup.append(new window.Option(key.slice(presetPrefix.length), key)));
            } catch {
                this.toast("This browser profile cannot access saved presets");
            }
            savedGroup.hidden = savedGroup.childElementCount === 0;
        };
        refreshPresets();
        void this.plugin.loadTemplateCatalog().then((entries) => {
            bundledGroup.replaceChildren();
            for (const entry of entries) bundledGroup.append(new window.Option(
                `${entry.name} (${entry.width} × ${entry.height})`, `builtin:${entry.name}`,
            ));
            bundledGroup.hidden = bundledGroup.childElementCount === 0;
        }).catch(() => {
            loadingOption.textContent = "Built-in templates unavailable";
        });
        presets.onchange = () => {
            const selected = presets.value;
            if (!selected) return;
            chain(async () => {
                if (selected.startsWith(presetPrefix)) {
                    const saved = window.localStorage.getItem(selected);
                    if (saved) this.stageArea(saved, selected.slice(presetPrefix.length));
                } else {
                    const name = selected.slice("builtin:".length);
                    const template = await this.plugin.loadTemplate(name);
                    if (panel.isConnected && presets.value === selected) this.stageArea(JSON.stringify(template), name);
                }
            });
        };
        const file = document.createElement("input");
        file.type = "file";
        file.accept = ".json,application/json";
        file.hidden = true;
        file.onchange = () => {
            const selected = file.files?.[0];
            file.value = "";
            if (selected) chain(async () => {
                if (selected.size > 8_000_000) throw new Error("The area file is too large");
                const contents = await selected.text();
                if (panel.isConnected) this.stageArea(contents);
            });
        };
        const tools = document.createElement("div");
        Object.assign(tools.style, { display: "flex", flexWrap: "wrap", gap: "5px" });
        tools.append(
            createCompactButton("Import file", "Open an area or template JSON file", () => file.click()),
            createCompactButton("Paste", "Read a copied map area from the clipboard", () => chain(async () => {
                const contents = await navigator.clipboard.readText();
                if (panel.isConnected) this.stageArea(contents);
            })),
            createCompactButton("Rotate", "Rotate the stamp clockwise (R)", () =>
                updateStamp({ turns: ((this.plugin.getStamp()?.options.turns ?? this.areaOptions.turns) + 1) & 3 })),
            createCompactButton("Done", "Stop stamping (Esc)", () => this.closeAreaPanel()),
        );
        const savePreset = document.createElement("div");
        Object.assign(savePreset.style, { display: "flex", gap: "5px" });
        savePreset.append(name, createCompactButton("Save preset", "Save the current stamp to this browser", () => {
            const label = name.value.trim();
            if (!label || !this.areaContents) return this.toast("Load an area and give the preset a name");
            try {
                const key = presetPrefix + label;
                if (window.localStorage.getItem(key) !== null) return this.toast("A preset already has that name");
                window.localStorage.setItem(key, this.areaContents);
                refreshPresets();
                presets.value = key;
                this.toast(`Saved preset ${label}`);
            } catch {
                this.toast("Browser storage could not save this preset. Export the area to keep a copy.");
            }
        }));
        const body = document.createElement("div");
        Object.assign(body.style, { display: "grid", gap: "7px" });
        const library = document.createElement("details");
        library.dataset.mapEditor = "stamp-library";
        library.open = action === "Stamp area";
        const libraryLabel = document.createElement("summary");
        libraryLabel.textContent = "Presets and files";
        const libraryControls = document.createElement("div");
        Object.assign(libraryControls.style, { display: "grid", gap: "6px", marginTop: "6px" });
        libraryControls.append(presets, file, savePreset,
            createCompactButton("Remove saved preset", "Remove the selected preset from this browser", () => {
                if (!presets.value.startsWith(presetPrefix)) return;
                window.localStorage.removeItem(presets.value);
                refreshPresets();
            }),
            createCompactButton("Export area", "Download the loaded area as JSON", () => {
                if (!this.areaContents) return this.toast("Load an area to export first");
                FileSaver.saveAs(new Blob([this.areaContents], { type: "application/json" }), "map-area.json");
            }),
        );
        libraryControls.append(...Array.from(tools.children).slice(0, 2));
        library.append(libraryLabel, libraryControls);
        body.append(this.areaSummary, terrain, foundationLabel, interactiveLabel, entitiesLabel, tools, library);
        panel.append(body);
        document.body.appendChild(panel);
    }

    private syncAreaSummary(): void {
        if (!this.areaSummary) return;
        const stamp = this.plugin.getStamp();
        const foundation = this.areaPanel?.querySelector<HTMLInputElement>('[data-map-editor="stamp-foundation"]');
        if (foundation) {
            foundation.checked = stamp?.options.foundation ?? stamp?.area.foundation ?? false;
            foundation.disabled = !stamp || stamp.options.terrain === "all";
        }
        if (!stamp) {
            this.areaSummary.textContent = this.areaContents
                ? "Enter a name to save the captured area as a preset, or choose a template to place."
                : "Choose a preset to preview it on the map.";
            return;
        }
        const [width, height] = stampSize(stamp.area, stamp.options.turns);
        this.areaSummary.textContent = `${stamp.area.name ?? "Map area"} · ${width} × ${height} · ${stamp.options.turns * 90}°`;
    }

    private syncToolCue(): void {
        const { config, pathStart, wallStart } = this.plugin.getState();
        let text = "";
        switch (config.tool) {
            case "pick": {
                text = `${this.plugin.getTilePickPrompt() ?? "Pick a tile"} · Esc cancels`;
                break;
            }
            case "place":
                text = "Click to place · R rotates · Esc stops";
                break;
            case "delete":
                text = "Click an object to delete it · Ctrl+Z undoes · Esc stops";
                break;
            case "wall":
                text = wallStart ? "Draw wall · Click to build the preview · Esc cancels" : "Draw wall · Click the start tile";
                break;
            case "stamp":
                text = `${this.areaAction} · Click to place · R rotates · Esc stops`;
                break;
            case "scatter":
                text = this.plugin.hasScatterBrush() ? `Scatter scenery · ${this.brushGestureHint()} · Esc cancels`
                    : "Scatter scenery · Choose a scenery set or search result";
                break;
            case "terrain": {
                const { action, underlay } = this.plugin.getTerrainBrush();
                text = action === "ramp" ? "Grade ramp · Drag from the starting height to the ending height" :
                    action === "underlay" && underlay === undefined ? "Paint base ground · Choose a material" :
                        `${TERRAIN_LABELS[action]} · ${this.brushGestureHint()}${action === "overlay" ? " · R rotates shape" : ""}`;
                break;
            }
            case "path":
                text = pathStart ? "Draw path · Click the end tile · Esc cancels" : "Draw path · Click the start tile";
                break;
            case "fill":
                text = "Fill overlay · Click a connected floor to repaint it";
                break;
            default:
                if (!this.inspectorToolPanel?.isConnected && !this.palette.isVisible() &&
                    !this.settingsDrawer?.isConnected && !this.plugin.getState().selection) {
                    const mode = this.plugin.getSelectionMode();
                    text = mode === "ground" ? "Click a tile or drag to select an area" :
                        mode === "building" ? "Click part of a building to select it" : "Click a tile, object or NPC · Drag to select an area · Shift-click a building";
                }
                break;
        }
        this.syncActiveTask();
        if (this.toolCue.textContent !== text) this.toolCue.textContent = text;
        this.toolCue.hidden = !text || !!this.jumpPanel || !!this.worldMapMode;
    }

    private syncActiveTask(): void {
        const { config } = this.plugin.getState();

        const panel = this.inspectorToolPanel?.isConnected ? this.inspectorToolPanel.dataset.mapEditor : undefined;
        let task: string | undefined;
        if (this.palette.isVisible()) {
            task = this.scattering ? "scatter" :
                this.currentSearchMode() === "loc" ? "place-object" :
                    this.currentSearchMode() === "npc" ? "place-npc" : "place-item";
        } else if (config.tool === "terrain") task = this.plugin.getTerrainBrush().action;
        else if (config.tool === "place") task = config.placeKind === "npc" ? "place-npc" : "place-object";
        else if (["path", "fill", "scatter", "stamp", "wall", "delete"].includes(config.tool)) task = config.tool;
        else if (panel === "landscape") task = this.inspectorToolPanel?.dataset.landscapeTask;
        else if (panel === "new-region") task = "new-region";
        else if (panel === "area-stamps") task = "stamp";
        else if (panel === "build-presets") task = "structure";
        else if (panel === "ground-items") task = "place-item";
        else if (panel === "travel-links") task = "travel";
        else if (this.worldMapMode === "zones") task = "zones";
        else if (panel === "map-validation") task = "validate";
        else if (this.filesPanel?.isConnected) task = "map-files";
        else if (config.tool === "select" && !panel) {
            const mode = this.plugin.getSelectionMode();
            task = mode === "entity" && this.layout.getWorkspace() === "Build & Place"
                ? "build-select-entity" : `select-${mode}`;
        }
        this.layout.setActiveTask(task);
    }

    private brushGestureHint(): string {
        return this.plugin.getBrushTiming() === "live" ? "Applies as you drag" : "Click or drag, then release to apply";
    }

    private createBrushTimingControl(): { element: HTMLLabelElement; sync: () => void } {
        const element = document.createElement("label");
        Object.assign(element.style, { display: "grid", gap: "3px" });
        const input = document.createElement("select");
        Object.assign(input.style, INPUT_STYLE);
        input.add(new window.Option("On release · preview first", "release"));
        input.add(new window.Option("Live · paint as you drag", "live"));
        input.setAttribute("aria-label", "Apply brush");
        input.title = "Applies to sculpting, terrain paint, walkability, and scenery brushes";
        const sync = () => { input.value = this.plugin.getBrushTiming(); };
        input.onchange = () => this.plugin.setConfig({ brushTiming: input.value === "live" ? "live" : "release" });
        sync();
        element.append("Apply brush", input);
        return { element, sync };
    }

    private showSwatches(tab: string): void {
        const lineTool = tab === "Overlays" && ["path", "fill"].includes(this.plugin.getConfig().tool);
        this.dismissToolPanel(lineTool);
        this.swatchSelection = this.plugin.getState().selection;
        if ((tab === "Overlays" || tab === "Underlays") && !lineTool) {
            this.plugin.setTerrainBrush({ action: tab === "Overlays" ? "overlay" : "underlay" });
        }
        this.renderSwatches(tab);
        this.renderSelection();
        if (tab === "Settlements") this.openBuildPanel();
    }

    private renderSwatches(tab: string): void {
        this.objectSwatches.unmount();
        const content = this.layout.paletteContent;
        this.syncSwatches = undefined;
        const request = ++this.swatchRequest;
        if (this.minimapUrl) { URL.revokeObjectURL(this.minimapUrl); this.minimapUrl = undefined; }
        content.replaceChildren();
        if (tab === "Objects") {
            this.objectSwatches.mount(content);
            return;
        }
        if (tab === "Settlements") {
            const title = document.createElement("h3"); title.textContent = "Settlements";
            content.append(title,
                createCompactButton("Generate structure", "Generate a structure", () => this.openBuildPanel()),
                createCompactButton("Stamp area", "Open area stamps", () => this.openAreaPanel()),
                createCompactButton("Draw walls", "Open wall brush", () => this.openWallPanel()));
            return;
        }
        if (tab === "Misc") {
            const title = document.createElement("h3"); title.textContent = "Minimap";
            const map = document.createElement("img"); map.alt = "Current map square"; map.className = "rspsi-minimap";
            const mapButton = createCompactButton("World map", "Open world map", () => this.toggleWorldMap());
            const refresh = () => void this.plugin.loadMinimap().then(blob => {
                if (request !== this.swatchRequest || !blob) return;
                if (this.minimapUrl) URL.revokeObjectURL(this.minimapUrl);
                map.src = this.minimapUrl = URL.createObjectURL(blob);
            }).catch(() => this.toast("Could not load minimap"));
            content.append(title, map, mapButton, createCompactButton("Refresh", "Refresh minimap", refresh),
                document.createElement("hr"),
                createCompactButton("Terrain flags", "Open terrain flag brush", () => this.toggleBrushPanel("Flags", "block")),
                createCompactButton("Zones", "Edit gameplay zones", () => this.toggleWorldMap("zones")),
                createCompactButton("Travel links", "Edit travel links", () => this.openTravelPanel()));
            refresh(); return;
        }
        if (tab === "Overlays") {
            const title = document.createElement("h3"); title.textContent = "Paint overlay";
            const picker = this.createOverlayPicker();
            content.append(title, picker.element);
            this.syncSwatches = picker.sync;
            return;
        }
        const title = document.createElement("h3"); title.textContent = tab;
        const selected = document.createElement("output"); selected.dataset.mapEditor = "selected-material";
        const search = document.createElement("input"); search.type = "search";
        search.placeholder = `Search ${tab.toLowerCase()}…`; search.setAttribute("aria-label", `Search ${tab.toLowerCase()}`);
        const grid = document.createElement("div"); grid.className = "rspsi-swatch-grid";
        const swatches = this.plugin.getUnderlaySwatches();
        const update = () => {
            const id = this.plugin.getTerrainBrush().underlay;
            selected.textContent = `${swatches.find(s => s.id === id)?.name ?? (id === 0 ? "Clear" : tab.slice(0, -1))} #${id ?? "—"}`;
            for (const button of grid.querySelectorAll("button")) button.setAttribute("aria-pressed", String(Number(button.dataset.material) === id));
        };
        const add = (id: number, colorRgb: number, name?: string) => {
            const button = document.createElement("button"); button.type = "button";
            const number = document.createElement("span"); number.className = "rspsi-material-id"; number.textContent = String(id);
            button.append(number);
            button.dataset.material = String(id); button.title = `${name ?? (id === 0 ? "Clear" : tab.slice(0, -1))} #${id}`;
            button.setAttribute("aria-label", button.title);
            button.style.background = `#${(colorRgb & 0xffffff).toString(16).padStart(6, "0")}`;
            button.onclick = () => {
                this.plugin.setTerrainBrush({ action: "underlay", underlay: id });
                update();
            };
            grid.append(button);
        };
        add(0, 0x202020, "Clear");
        for (const swatch of swatches) add(swatch.id, swatch.colorRgb, swatch.name);
        search.oninput = () => { const terms = search.value.toLowerCase().split(/\s+/); for (const button of grid.querySelectorAll("button")) button.hidden = !terms.every(t => button.title.toLowerCase().includes(t)); };
        content.append(title, selected);
        content.append(search, grid); this.syncSwatches = update; update();
    }

    private createOverlayMaterialButton(): HTMLButtonElement {
        const button = createCompactButton("Overlays", "Choose overlay in the swatch dock", () => this.layout.selectPalette("Overlays"));
        Object.assign(button.style, { display: "flex", alignItems: "center", gap: "7px" });
        this.updateOverlayMaterialButton(button);
        return button;
    }

    private updateOverlayMaterialButton(button: HTMLButtonElement): void {
        const { overlayId } = this.plugin.getConfig();
        if (button.dataset.overlayId === String(overlayId)) return;
        button.dataset.overlayId = String(overlayId);
        const name = this.overlaySwatches.find(({ id }) => id === overlayId)?.name;
        button.replaceChildren(this.createOverlaySwatchIcon(overlayId),
            document.createTextNode(name ? `Change overlay · ${name}` : `Choose overlay · #${overlayId}`));
    }

    private openTerrainLineTool(tool: "path" | "fill"): void {
        const panel = this.inspectorPanel("terrain-line-tool");
        panel.dataset.activeTool = tool;
        const material = this.createOverlayMaterialButton();
        panel.append(createHeader(tool === "path" ? "Draw path" : "Fill connected overlay", () => {
            panel.remove();
            if (this.plugin.getConfig().tool === tool) this.plugin.setConfig({ tool: "select" });
        }), material, tool === "path" ? "Click a start and end tile to draw a path." :
            "Click a surface to change all tiles connected to it that use the same overlay.");
        this.syncBrushInputs = () => {
            if (!panel.isConnected) { this.syncBrushInputs = undefined; return; }
            this.updateOverlayMaterialButton(material);
        };
        this.plugin.setConfig({ tool });
    }

    private showJumpToLocation(): void {
        if (this.jumpPanel) {
            this.jumpPanel.querySelector("input")?.focus();
            return;
        }
        this.plugin.closeWorldMap();
        const panel = this.jumpPanel = document.createElement("div");
        panel.dataset.mapEditor = "jump-to-location";
        Object.assign(panel.style, PANEL_STYLE, {
            position: "absolute", left: "0", bottom: "calc(100% + 6px)", width: "min(290px, calc(100vw - 24px))",
        });
        const form = document.createElement("form");
        Object.assign(form.style, { display: "grid", gap: "6px" });
        const input = document.createElement("input");
        Object.assign(input.style, INPUT_STYLE);
        input.placeholder = "3222, 3218 or 12850";
        input.setAttribute("aria-label", "Coordinates or region ID");
        const submit = createCompactButton("Jump", "Jump to the entered location", () => { });
        submit.type = "submit";
        const status = document.createElement("span");
        status.setAttribute("role", "status");
        form.onsubmit = (event) => {
            event.preventDefault();
            if (this.plugin.goToLocation(input.value)) this.closeJumpToLocation(true);
            else {
                input.setAttribute("aria-invalid", "true");
                status.textContent = "Enter x, y with an optional floor, or a region ID.";
                input.focus();
            }
        };
        input.oninput = () => {
            input.removeAttribute("aria-invalid");
            status.textContent = "";
        };
        form.append(input, submit, createCompactButton("Choose on world map", "Choose on world map", () => this.toggleWorldMap()), status);
        panel.append(createHeader("Jump to location", () => this.closeJumpToLocation(true)), form);
        panel.dataset.rspsiPanel = "";
        document.body.append(panel);
        this.jumpButton.setAttribute("aria-expanded", "true");
        this.syncToolCue();
        input.focus();
    }

    private closeJumpToLocation(restoreFocus = false): void {
        if (!this.jumpPanel) return;
        this.jumpPanel.remove();
        this.jumpPanel = undefined;
        this.jumpButton.setAttribute("aria-expanded", "false");
        this.syncToolCue();
        if (restoreFocus) this.jumpButton.focus({ preventScroll: true });
    }

    private showReview(): void {
        this.plugin.finishActiveBrush();
        const panel = this.inspectorPanel("review-changes");
        this.detailPanel = panel;
        const body = document.createElement("div");
        const save = createCompactButton("Save to server", "Save reviewed map edits", () => void this.saveCurrentChanges());
        const download = createCompactButton("Export ZIP", "Download map overrides as a ZIP", () => void this.exportRegions(true));
        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" });
        actions.append(save, download, createCompactButton("Validate", "Check these edits for errors", () => this.showValidation()));
        if (!browserHostWindow()) actions.append(createCompactButton("Server folder & backups", "Manage the server folder and saved backups", () => this.toggleFilesPanel()));
        const destination = document.createElement("div");
        Object.assign(destination.style, { marginTop: "6px", color: "#aebdce" });
        const status = document.createElement("div");
        status.setAttribute("role", "status");
        Object.assign(status.style, { marginTop: "6px", color: "#b5c8df" });
        const load = createCompactButton("Load in game", "Load the saved squares into the running world", () => {
            const regionIds = this.session.publication?.regions;
            if (!regionIds?.length) return;
            if (!this.plugin.requestSavedRegionReload(regionIds)) {
                this.copyCommand(`::reloadmap ${regionIds.join(" ")}`);
                return;
            }
            this.session.lastSaveStatus = "Load requested. Check game chat for the result.";
            this.syncSaveButton();
        });
        const play = createCompactButton("Open game", "Open the game in a new tab", () => {
            const url = new URL(window.location.href);
            for (const key of ["edit", "editor", "at"]) url.searchParams.delete(key);
            window.open(url, "_blank", "noopener");
        });
        const test = createCompactButton("Copy test command", "Copy the staff teleport command for this map", () => {
            const at = this.session.publication?.location;
            if (!at) return;
            this.copyCommand(`::tele ${at.tileX} ${at.tileY} ${at.plane}`);
        });
        const next = document.createElement("div");
        Object.assign(next.style, { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" });
        next.append(load, play, test);
        panel.append(createHeader("Review changes", () => this.closeDetailPanel()), body, actions, destination, status, next);
        this.review = { body, save, download, load, play, test, status, destination };
        this.syncSaveButton();
    }

    private copyCommand(command: string): void {
        if (navigator.clipboard) void navigator.clipboard.writeText(command)
            .then(() => this.toast(`Copied ${command}`), () => this.toast(command));
        else this.toast(command);
    }

    private syncReview(changed: boolean): void {
        const review = this.review;
        if (!review) return;
        const host = browserHostWindow();
        const canSave = !!host || !!this.mapFiles || EditorMapFiles.supported();
        review.save.hidden = !canSave;
        review.save.textContent = host ? "Send to host" : "Save to server";
        review.save.disabled = !changed || this.saving;
        review.save.style.opacity = changed ? "" : "0.45";
        review.download.disabled = !changed || this.saving;
        review.destination.hidden = !changed;
        review.destination.textContent = host ? "Save to the host, then restart it."
            : this.mapFiles ? "Adds a new map layer to the connected server."
                : canSave ? "Choose the server’s data folder to save your changes as a map layer."
                    : "Export a map layer, then extract it into your server’s data folder.";
        review.status.textContent = this.session.lastSaveStatus ?? "";
        review.status.hidden = !review.status.textContent;
        const publication = this.session.publication;
        const canLoad = !!publication && this.plugin.canReloadSavedRegions(publication.regions);
        review.load.textContent = canLoad ? "Load in game" : "Copy load command";
        review.load.setAttribute("aria-label", canLoad ? "Load the saved squares into the running world" : "Copy the owner command to load the saved map");
        review.load.title = review.load.getAttribute("aria-label")!;
        review.load.hidden = !publication || publication.restart || !publication.regions.length;
        review.play.hidden = !publication || !!host;
        review.test.hidden = !publication?.location;
        const edits = this.plugin.getConfig().edits;
        const squares = this.plugin.getNewMapSquares();
        const npcKey = this.npcSpawnsKey();
        const extra = this.plugin.getWorldDefinitionForSave() !== undefined ? "World settings" : "";
        const summaryKey = `${extra}:${squares.join(",")}:${npcKey}`;
        if (review.edits === edits && review.extra === summaryKey && review.changed === changed && !this.travel.dirty && !this.groundItems.dirty) return;
        review.edits = edits;
        review.extra = summaryKey;
        review.changed = changed;
        review.body.replaceChildren();
        if (!changed) {
            review.body.textContent = "No unsaved changes.";
            return;
        }
        const areas = editorChangeAreas(edits);
        const npcs = changedNpcTiles(npcKey, this.savedNpcSpawnsKey);
        if (squares.length || areas.length || npcs.length || this.travel.dirty || this.groundItems.dirty) {
            const list = document.createElement("ul");
            Object.assign(list.style, { margin: "0", paddingLeft: "17px" });
            const addLocation = (tile: EditModeTile, label: string, summary?: string) => {
                const row = document.createElement("li");
                row.style.marginBottom = "7px";
                const address = `${tile.tileX}, ${tile.tileY}, ${tile.plane}`;
                row.append(createCompactButton(label, `Jump to changes at ${address}`, () => this.plugin.goToLocation(address)));
                if (summary) row.append(document.createElement("br"), summary);
                list.append(row);
            };
            if (squares.length) {
                const { minX, minY } = regionBounds(squares[0]);
                const label = squares.length === 1 ? "New map square" : `${squares.length} new map squares`;
                addLocation({ tileX: minX + 32, tileY: minY + 32, plane: 0 }, label, "Terrain draft");
            }
            for (const { region, target, ground, objects } of areas) {
                const summary = [
                    ground ? `${ground} edited ground point${ground === 1 ? "" : "s"}` : "",
                    objects ? `${objects} object edit${objects === 1 ? "" : "s"}` : "",
                ].filter(Boolean).join(" · ");
                addLocation(target, `${target.tileX}, ${target.tileY} · Floor ${target.plane}`, `Region ${region} · ${summary}`);
            }
            for (const tile of npcs) addLocation(tile, "NPC spawn", `${tile.tileX}, ${tile.tileY} · Floor ${tile.plane}`);
            for (const tile of this.travel.changedSources) addLocation(tile, "Travel link", `${tile.tileX}, ${tile.tileY} · Floor ${tile.plane}`);
            for (const tile of this.groundItems.changedTiles) addLocation(tile, "Ground item spawns", `${tile.tileX}, ${tile.tileY} · Floor ${tile.plane}`);
            review.body.append(list);
        }
        if (extra) review.body.append(extra);
    }

    private currentSearchMode(): EditModeSearchKind {
        return this.plugin.getState().search.kind;
    }

    private toggleBrushPanel(group?: "Paint" | "Sculpt" | "Flags", selected?: TerrainBrushAction): void {
        if (this.brushPanel?.isConnected && !group) {
            this.closeBrushPanel();
            return;
        }
        const panel = this.inspectorPanel("terrain-brush", this.plugin.getConfig().tool === "terrain");
        panel.style.maxHeight = "calc(100dvh - 125px)";
        panel.style.overflowY = "auto";
        this.brushPanel = panel;
        const brush = this.plugin.getTerrainBrush();
        const controls = document.createElement("div");
        Object.assign(controls.style, { display: "grid", gap: "8px" });
        const action = document.createElement("select");
        const groups = {
            Paint: ["overlay", "underlay"],
            Sculpt: ["raise", "lower", "smooth", "flatten", "ramp", "natural"],
            Flags: ["block", "unblock"],
        } as const satisfies Record<string, readonly TerrainBrushAction[]>;
        const modes = document.createElement("div");

        Object.assign(modes.style, { display: "flex", gap: "5px" });
        const modeButtons = new Map<string, HTMLButtonElement>();
        const showGroup = (name: keyof typeof groups, activeAction?: TerrainBrushAction) => {
            action.replaceChildren(...groups[name].map((value) => new window.Option(TERRAIN_LABELS[value], value)));
            if (activeAction && action.querySelector(`option[value="${activeAction}"]`)) action.value = activeAction;
            for (const [group, button] of modeButtons) {
                button.setAttribute("aria-pressed", String(group === name));
                button.style.borderColor = group === name ? "#60a5fa" : "";
            }
        };
        for (const name of Object.keys(groups) as (keyof typeof groups)[]) {
            const button = createCompactButton(name, `${name} tools`, () => {
                showGroup(name, this.lastBrushActions[name]);
                update();
            });
            modes.append(button);
            modeButtons.set(name, button);
        }
        const activeGroup = (Object.keys(groups) as (keyof typeof groups)[])
            .find((name) => (groups[name] as readonly TerrainBrushAction[]).includes(brush.action)) ?? "Paint";
        showGroup(group ?? activeGroup, selected ?? (group ? this.lastBrushActions[group] : brush.action));
        const actionField = this.labeledField("Action", action);

        const walkActions = document.createElement("div");

        Object.assign(walkActions.style, { gap: "5px" });
        const walkButtons = groups.Flags.map((mode) => {
            const button = createCompactButton(TERRAIN_LABELS[mode], TERRAIN_LABELS[mode], () => {
                action.value = mode;
                update();
            });
            walkActions.append(button);
            return { button, mode };
        });
        let flagMask = brush.flagMask ?? 1;
        const flags = document.createElement("div"); flags.className = "rspsi-tile-flags";
        const flagInputs = new Map<number, HTMLInputElement>();
        for (const [bit, label, description] of [
            [1, "Unwalkable", "Block walking on painted tiles."],
            [2, "Bridge", "Mark painted tiles as a bridge."],
            [4, "Remove roof", "Mark painted tiles for roof removal."],
            [8, "Render one level lower", "Draw painted tiles on the level below."],
            [16, "Disable tile rendering", "Set the disable-render flag on painted tiles."],
        ] as const) {
            const checkbox = document.createElement("input"); checkbox.type = "checkbox";
            checkbox.setAttribute("aria-label", label);
            checkbox.checked = !!(flagMask & bit);
            const text = document.createElement("span"); text.append(label);
            const help = document.createElement("small"); help.textContent = description;
            text.append(help);
            const row = document.createElement("label"); row.append(checkbox, text); flags.append(row);
            flagInputs.set(bit, checkbox);
            checkbox.onchange = () => {
                flagMask = checkbox.checked ? flagMask | bit : flagMask & ~bit;
                update();
            };
        }
        const shape = document.createElement("select");
        shape.add(new window.Option("Round", "round"));
        shape.add(new window.Option("Square", "square"));
        shape.value = brush.shape;
        const radius = document.createElement("input");
        radius.type = "range";
        radius.min = "0";
        radius.max = "10";
        radius.value = String(brush.radius);
        const radiusLabel = this.labeledField(`Brush radius (${brush.radius} tiles)`, radius);
        const slider = (min: number, max: number, value: number) => {
            const input = document.createElement("input");
            input.type = "range";
            input.min = String(min);
            input.max = String(max);
            input.value = String(value);
            return input;
        };
        const step = slider(1, 64, brush.step);
        const blend = slider(1, 100, brush.blend);
        const strength = document.createElement("div");
        strength.style.display = "grid";
        strength.style.gap = "4px";
        const stepLabel = this.labeledField("", step);
        const blendLabel = this.labeledField("", blend);
        const presets = document.createElement("div");
        Object.assign(presets.style, { display: "flex", gap: "4px", flexWrap: "wrap" });
        const strengthButtons = ([["Light", 1, 25], ["Medium", 4, 50], ["Strong", 12, 100]] as const).map(
            ([label, stepValue, blendValue]) => {
                const button = createCompactButton(label, `${label} brush strength`, () => {
                    if (usesBlend()) blend.value = String(blendValue);
                    else step.value = String(stepValue);
                    update();
                });
                presets.append(button);
                return { button, stepValue, blendValue };
            },
        );
        const usesBlend = () => ["smooth", "flatten"].includes(action.value);
        strength.append(stepLabel, blendLabel, presets);
        const timing = this.createBrushTimingControl();
        const soft = document.createElement("input");
        soft.type = "checkbox";
        soft.checked = brush.soft;
        const softLabel = document.createElement("label");
        softLabel.append(soft, " Blend sculpting at the brush edge");
        const underlay = document.createElement("select");
        underlay.add(new window.Option("Choose a material", ""));
        const ground = this.plugin.getUnderlaySwatches();
        for (const swatch of ground) {
            const hex = swatch.colorRgb.toString(16).padStart(6, "0");
            const option = new window.Option(swatch.name ?? `Ground ${swatch.id} (#${hex})`, String(swatch.id));
            underlay.add(option);
        }
        if (brush.underlay && !ground.some(({ id }) => id === brush.underlay)) {
            underlay.add(new window.Option(`Ground ${brush.underlay}`, String(brush.underlay)));
        }
        underlay.add(new window.Option("Clear base ground", "0"));
        underlay.value = brush.underlay?.toString() ?? "";
        const groundColor = document.createElement("span");
        Object.assign(groundColor.style, { display: "block", height: "8px", borderRadius: "3px" });
        const underlayLabel = this.labeledField("Base ground", underlay);
        underlayLabel.append(groundColor);
        const hint = document.createElement("div");
        hint.style.color = "#cbd5e1";
        const updateLabels = () => {
            radiusLabel.firstChild!.textContent = radius.value === "0" ? "Brush size: one tile" : `Brush radius: ${radius.value} tile${radius.value === "1" ? "" : "s"}`;
            stepLabel.firstChild!.textContent = `Strength: ${step.value} × 1/16 tile`;
            blendLabel.firstChild!.textContent = `Strength: ${blend.value}% blend`;
            for (const { button, stepValue, blendValue } of strengthButtons) {
                const active = usesBlend() ? blend.valueAsNumber === blendValue : step.valueAsNumber === stepValue;
                button.setAttribute("aria-pressed", String(active));
                button.style.borderColor = active ? "#60a5fa" : "";
            }
        };
        const update = (activate = true) => {
            const mode = action.value as TerrainBrushAction;
            this.layout.activatePalette(mode === "overlay" ? "Overlays" : mode === "underlay" ? "Underlays" : "Misc");
            const color = ground.find((swatch) => swatch.id === Number(underlay.value))?.colorRgb;
            groundColor.style.display = color === undefined ? "none" : "block";
            if (color !== undefined) groundColor.style.backgroundColor = `#${color.toString(16).padStart(6, "0")}`;
            underlayLabel.style.display = mode === "underlay" ? "grid" : "none";
            const movesHeight = mode === "raise" || mode === "lower";
            strength.style.display = movesHeight || usesBlend() ? "grid" : "none";
            stepLabel.style.display = movesHeight ? "grid" : "none";
            blendLabel.style.display = usesBlend() ? "grid" : "none";
            softLabel.hidden = ["overlay", "underlay", "natural", "block", "unblock"].includes(mode);
            timing.element.style.display = mode === "ramp" ? "none" : "grid";
            overlayMaterial.element.style.display = mode === "overlay" ? "grid" : "none";
            hint.textContent = mode === "ramp" ? "Drag between two heights. The slope is applied on release." :
                mode === "flatten" ? "Start on a tile at the height you want, then drag across the area to level." :
                    mode === "block" || mode === "unblock" ? flagMask
                        ? "Paint to set or clear the checked flags. Other flags stay unchanged. View controls highlighting."
                        : "Choose at least one flag to paint." :
                        "[ and ] change brush size. Esc cancels the active stroke.";
            updateLabels();
            const group = (Object.keys(groups) as (keyof typeof groups)[])
                .find((name) => (groups[name] as readonly TerrainBrushAction[]).includes(mode));
            if (group) this.lastBrushActions[group] = mode;
            flags.hidden = group !== "Flags";
            walkActions.style.display = group === "Flags" ? "flex" : "none";
            actionField.style.display = group === "Flags" ? "none" : "grid";
            for (const { button, mode: buttonMode } of walkButtons) {
                const active = mode === buttonMode;
                button.setAttribute("aria-pressed", String(active));
                button.style.borderColor = active ? "#60a5fa" : "";
            }
            if (activate) this.plugin.setTerrainBrush({
                action: mode, flagMask, shape: shape.value as TerrainBrush["shape"], radius: Number(radius.value),
                step: step.valueAsNumber, blend: blend.valueAsNumber, soft: soft.checked,
                underlay: underlay.value ? Number(underlay.value) : undefined,
            });
        };
        const overlayMaterial = this.createOverlayPicker();
        radius.title = "[ and ] change the brush size on the map";
        controls.append(modes, actionField, walkActions, flags, overlayMaterial.element, timing.element, radiusLabel,
            this.labeledField("Brush shape", shape), strength, underlayLabel, softLabel, hint);
        for (const control of [action, shape, radius, step, blend, underlay, soft]) {
            control.addEventListener("change", () => update());
        }
        for (const input of [radius, step, blend]) input.addEventListener("input", updateLabels);
        this.syncBrushInputs = () => {
            if (!panel.isConnected) { this.syncBrushInputs = undefined; return; }
            radius.value = String(this.plugin.getTerrainBrush().radius);
            timing.sync();
            flagMask = this.plugin.getTerrainBrush().flagMask ?? 1;
            flagInputs.forEach((input, bit) => { input.checked = !!(flagMask & bit); });
            overlayMaterial.sync();
            updateLabels();
        };
        const generate = createCompactButton("Generate landscape", "Create a landscape from a landform and biome", () => this.openLandscapePanel());

        controls.append(generate);
        const header = createHeader("Terrain brush", () => this.closeBrushPanel(true));
        panel.append(header, controls);
        update(!!group);
        this.syncToolCue();
    }

    private createRegionEdgeControls(): HTMLElement {
        const edges = document.createElement("details");
        const title = document.createElement("summary");
        title.textContent = "Region edges";
        const edgeList = document.createElement("div");
        const inspect = () => {
            edgeList.replaceChildren();
            for (const edge of ["west", "east", "south", "north"] as MapEdge[]) {
                const report = this.plugin.edgeReport(edge);
                const row = document.createElement("div");
                Object.assign(row.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px", marginBlock: "4px" });
                row.append(report.sampled ? `${edge}: ${report.steep} steep steps` : `${edge}: neighbour unavailable`);
                if (report.steep) row.append(createCompactButton("Align", `Blend the ${edge} edge into its neighbour`, () => {
                    const count = this.plugin.alignEdge(edge);
                    this.toast(`Adjusted ${count} vertices on the ${edge} edge`);
                }));
                edgeList.append(row);
            }
        };
        edges.addEventListener("toggle", () => { if (edges.open) inspect(); });
        edges.append(title, createCompactButton("Check edges", "Check the current region and level", inspect), edgeList);
        return edges;
    }

    private closeBrushPanel(stopTool = false): void {
        this.brushPanel?.remove();
        if (stopTool && this.plugin.getConfig().tool === "terrain") this.plugin.setConfig({ tool: "select" });
    }

    private showValidation(): void {
        this.closeDetailPanel();
        const panel = this.inspectorPanel("map-validation");
        this.detailPanel = panel;
        Object.assign(panel.style, { maxHeight: "calc(100dvh - 125px)", overflowY: "auto" });
        panel.append(createHeader("Map validation", () => this.closeDetailPanel()));
        const issues = this.plugin.validateMapEdits();
        try {
            const saveToJson = !!browserHostWindow() && this.plugin.getConfig().saveObjectSpawns;
            const packs = this.plugin.exportModifiedRegionPacks(saveToJson);
            for (const { regionId } of oversizedRegionPacks(packs)) {
                issues.push({ regionId, message: "Exceeds the server’s compressed packet limit." });
            }
        } catch (error) {
            issues.push({ message: error instanceof Error ? error.message : String(error) });
        }
        if (!issues.length) panel.append("No problems found in pending edits or the current region’s edges.");
        else {
            const regions = new Map<number | undefined, HTMLUListElement>();
            for (const issue of issues) {
                let list = regions.get(issue.regionId);
                if (!list) {
                    const heading = document.createElement("strong");
                    heading.textContent = issue.regionId === undefined ? "Map files" : `Region ${issue.regionId}`;
                    list = document.createElement("ul");
                    Object.assign(list.style, { marginBlock: "4px 10px", paddingInlineStart: "18px" });
                    regions.set(issue.regionId, list);
                    panel.append(heading, list);
                }
                const row = document.createElement("li");
                row.textContent = issue.message;
                const { tile, regionId } = issue;
                if (tile || regionId !== undefined) {
                    const target = tile ? `${tile.tileX}, ${tile.tileY}, ${tile.plane}` : String(regionId);
                    row.append(" ", createCompactButton("Go to", `Go to ${target}`, () => this.plugin.goToLocation(target)));
                }
                list.append(row);
            }
        }
    }

    private setHeightLevel(level: number): void {
        this.plugin.setConfig({ heightLevel: Math.max(0, Math.min(3, level | 0)) });
    }

    private search(mode: PaletteMode): void {
        if (mode !== "loc" && this.scattering) this.updateScatterAsset?.();
        this.closeDetailPanel();
        if (mode !== "item") this.plugin.setConfig({ placeKind: mode });
        this.plugin.searchCache(this.plugin.getState().search.query, mode);
    }

    private pickSearchResult(id: number): void {
        this.closeDetailPanel();
        const mode = this.currentSearchMode();
        if (mode === "loc" && this.pickScatterSetMember?.(id)) return;
        if (mode === "item") {
            this.palette.setVisible(false);
            this.openGroundItems(id);
            return;
        }
        this.plugin.setConfig({ placeKind: mode });
        this.plugin.useSearchResult(id);
        if (mode === "loc" && this.scattering) {
            this.updateScatterAsset?.(id);
            return;
        }
        this.plugin.setConfig({ tool: "place" });
        this.palette.setVisible(false);
        this.showPlacementOptions(id, mode);
    }

    private selectedObjectSwatch(): ObjectSwatch | undefined {
        const selected = this.plugin.getState().selection;
        if (selected?.kind !== "loc") return;
        return {
            id: selected.locId, type: selected.shape ?? 10, turn: selected.rotation ?? 0,
            name: selected.locName || this.plugin.getLocName(selected.locId) || `Object ${selected.locId}`
        };
    }

    private addObjectSwatch(swatch: ObjectSwatch): void {
        this.objectSwatches.add(swatch);
        this.layout.selectPalette("Objects");
    }

    private showPlacementOptions(id: number, mode: "loc" | "npc"): void {
        this.placementOptions?.remove();
        const shapes = mode === "loc" ? this.plugin.getLocPlacementShapes(id) : [];

        const panel = this.inspectorPanel("placement-variant", true);
        this.placementOptions = panel;
        const name = (mode === "loc" ? this.plugin.getLocName(id) : this.plugin.getNpcName(id)) ||
            `${mode === "loc" ? "Object" : "NPC"} ${id}`;
        panel.append(createHeader(name, () => {
            panel.remove();
            this.plugin.setConfig({ tool: "select" });
        }));

        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", gap: "5px", flexWrap: "wrap", marginBlock: "7px" });
        actions.append(createCompactButton("Choose another", "Open asset search", () => this.toggleSearch(mode, true)),
            createCompactButton("Rotate", "Rotate the placement preview (R)", () => this.plugin.rotate()));
        const hint = document.createElement("p");
        hint.style.marginBlock = "3px 5px";
        hint.textContent = "Click a tile to place. Keep clicking to place more.";
        panel.append(hint, actions);

        if (mode === "loc") panel.append(createCompactButton("Add to swatches", "Add placement object to swatches", () => {
            const config = this.plugin.getConfig();
            this.addObjectSwatch({ id, name, type: config.shape, turn: config.rotation });
        }));
        if (shapes.length < 2) return;
        const variants = document.createElement("select");
        variants.setAttribute("aria-label", "Object variant");
        Object.assign(variants.style, INPUT_STYLE);
        const labels: Record<number, string> = {
            0: "Straight wall", 1: "Wall corner", 2: "Joined walls", 3: "Square corner", 4: "Wall decoration",
            9: "Diagonal wall", 10: "Scenery", 11: "Diagonal scenery", 12: "Roof slope",
            17: "Flat roof", 18: "Roof edge", 22: "Ground decoration",
        };
        for (const shape of shapes) variants.add(new window.Option(labels[shape] ?? `Shape ${shape}`, String(shape)));
        variants.value = String(this.plugin.getConfig().shape);
        variants.onchange = () => this.plugin.setConfig({ shape: Number(variants.value) });
        const label = document.createElement("label");
        label.append("Object variant", variants);
        panel.append(label);
    }

    /** NPC/Object rail buttons open the search panel on their tab; clicking the open tab's button closes it. */
    private toggleSearch(mode: PaletteMode, open = false): void {
        const sameTab = this.currentSearchMode() === mode;
        if (!open && this.palette.isVisible() && sameTab) {
            this.palette.setVisible(false);
            this.closeDetailPanel();
            return;
        }
        if (!(mode === "loc" && this.plugin.getConfig().tool === "scatter")) this.dismissToolPanel();
        if (!sameTab) this.search(mode);
        this.layout.activatePalette("Objects");
        this.layout.openSidebar();
        this.palette.setVisible(true);
        this.syncToolCue();
    }

    private overlayColor(id: number): number {
        return this.overlaySwatches.find((swatch) => swatch.id === id)?.colorRgb ?? 0x64748b;
    }

    private createOverlaySwatchIcon(id: number, fullTile = false): SVGElement {
        const color = this.overlayColor(id);
        const textureId = this.overlaySwatches.find((swatch) => swatch.id === id)?.textureId;
        const texture = textureId === undefined ? undefined : this.plugin.getOverlayTexture(textureId);
        const render = (source?: string) => fullTile
            ? createOverlayShapeIcon(getOverlayShapeTriangles(0, 0), `#${(color & 0xffffff).toString(16).padStart(6, "0")}`, source)
            : createOverlayIcon(color, source);
        const icon = render(texture);
        if (fullTile) icon.setAttribute("preserveAspectRatio", "none");
        if (textureId !== undefined && !texture) {
            const retry = (): void => {
                if (!icon.isConnected) return;
                const loaded = this.plugin.getOverlayTexture(textureId);
                if (loaded) icon.replaceChildren(...render(loaded).childNodes);
                else window.setTimeout(retry, 250);
            };
            window.setTimeout(retry, 250);
        }
        return icon;
    }

    private createOverlayPicker(onPick?: () => void): { element: HTMLElement; sync: () => void } {
        const element = document.createElement("div");
        element.dataset.mapEditor = "overlay-picker";
        Object.assign(element.style, { display: "grid", gap: "5px" });
        const dropdown = document.createElement("div");
        dropdown.dataset.mapEditor = "overlay-dropdown";
        dropdown.hidden = true;
        const useOverlay = createActionButton("Use overlay",
            () => this.createOverlaySwatchIcon(this.plugin.getConfig().overlayId), () => {
                dropdown.hidden = !dropdown.hidden;
                useOverlay.setAttribute("aria-expanded", String(!dropdown.hidden));
                if (!dropdown.hidden) {
                    if (!dropdown.childElementCount) populate();
                    sync();
                    search.focus();
                }
            });
        useOverlay.setAttribute("aria-expanded", "false");
        const search = document.createElement("input");
        search.type = "search";
        search.placeholder = "Search overlays…";
        search.setAttribute("aria-label", "Search overlays");
        const grid = document.createElement("div");
        grid.className = "rspsi-swatch-grid";
        const shapes = this.createOverlayShapePicker();
        const sync = () => {
            const { overlayId } = this.plugin.getConfig();
            if (useOverlay.dataset.overlayId !== String(overlayId)) {
                useOverlay.dataset.overlayId = String(overlayId);
                useOverlay.replaceChild(this.createOverlaySwatchIcon(overlayId), useOverlay.firstChild!);
            }
            for (const button of grid.querySelectorAll("button")) {
                button.setAttribute("aria-pressed", String(Number(button.dataset.material) === overlayId));
            }
            this.fillOverlayShapePicker(shapes);
        };
        const populate = () => {
            for (const swatch of [{ id: 0, colorRgb: 0x202020, name: "Clear" }, ...this.overlaySwatches]) {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.material = String(swatch.id);
                button.title = `${swatch.name ?? "Overlay"} #${swatch.id}`;
                button.setAttribute("aria-label", button.title);
                const icon = this.createOverlaySwatchIcon(swatch.id, true);
                icon.classList.add("rspsi-material-preview");
                const number = document.createElement("span");
                number.className = "rspsi-material-id";
                number.textContent = String(swatch.id);
                button.append(icon, number);
                button.onclick = () => {
                    dropdown.hidden = true;
                    useOverlay.setAttribute("aria-expanded", "false");
                    this.plugin.setConfig({ overlayId: swatch.id });
                    onPick?.();
                    sync();
                    if (useOverlay.isConnected) useOverlay.focus();
                };
                grid.append(button);
            }
            search.oninput = () => {
                const terms = search.value.toLowerCase().split(/\s+/);
                for (const button of grid.querySelectorAll("button")) {
                    button.hidden = !terms.every(term => button.title.toLowerCase().includes(term));
                }
            };
            dropdown.append(search, grid);
        };
        element.append(useOverlay, dropdown, shapes);
        sync();
        return { element, sync };
    }

    /** The twelve overlay shapes at the current rotation; a repeat click rotates the picked one. */
    private createOverlayShapePicker(): HTMLElement {
        const picker = document.createElement("div");
        picker.dataset.mapEditor = "overlay-shapes";
        Object.assign(picker.style, { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px", margin: "0 0 8px" });
        this.fillOverlayShapePicker(picker);
        return picker;
    }

    private fillOverlayShapePicker(picker: HTMLElement): void {
        const { overlayId, overlayShape, overlayRotation } = this.plugin.getConfig();
        const color = `#${(this.overlayColor(overlayId) & 0xffffff).toString(16).padStart(6, "0")}`;
        const textureId = this.overlaySwatches.find((swatch) => swatch.id === overlayId)?.textureId;
        const texture = textureId === undefined ? undefined : this.plugin.getOverlayTexture(textureId);
        if (textureId !== undefined && !texture) {
            window.setTimeout(() => {
                if (picker.isConnected) this.fillOverlayShapePicker(picker);
            }, 250);
        }
        const buttons = Array.from({ length: OVERLAY_SHAPE_COUNT }, (_, shape) => {
            const button = document.createElement("button");
            button.type = "button";
            button.title = shape === 0 ? "Full tile" : `Tile shape ${shape} (click again or press R to rotate)`;
            button.setAttribute("aria-label", button.title);
            button.setAttribute("aria-pressed", String(shape === overlayShape));
            Object.assign(button.style, {
                display: "grid",
                placeItems: "center",
                padding: "2px",
                border: `2px solid ${shape === overlayShape ? "#60a5fa" : "rgba(255,255,255,0.2)"}`,
                borderRadius: "4px",
                background: "transparent",
                cursor: "pointer",
            });
            button.appendChild(createOverlayShapeIcon(getOverlayShapeTriangles(shape, overlayRotation), color, texture));
            button.addEventListener("click", () => {
                this.plugin.setConfig(shape === overlayShape
                    ? { overlayRotation: (overlayRotation + 1) & 3 }
                    : { overlayShape: shape });
            });
            return button;
        });
        picker.replaceChildren(...buttons);
    }

    private createHeightControls(isSingleTile: boolean): HTMLElement {
        const controls = document.createElement("div");
        Object.assign(controls.style, { display: "grid", gap: "5px" });
        const field = (label: string, title: string, value: number, max: number, onChange: (value: number) => void) => {
            const row = document.createElement("label");
            row.title = title;
            Object.assign(row.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", color: "#cbd5e1" });
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.max = String(max);
            input.value = String(value);
            Object.assign(input.style, INPUT_STYLE, { width: "52px", padding: "3px 5px" });
            input.addEventListener("change", () => {
                const next = Math.max(0, Math.min(max, Math.trunc(Number(input.value)) || 0));
                input.value = String(next);
                onChange(next);
            });
            row.append(label, input);
            return row;
        };
        const fields = document.createElement("div");
        Object.assign(fields.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
        fields.append(
            field("Step", "Height change per click, in 1/16ths of a tile", this.heightStep, 64, (value) => { this.heightStep = value; }),
            field("Smooth", "Rings of surrounding tiles that slope to meet the change", this.heightSmoothing, 8, (value) => { this.heightSmoothing = value; }),
        );
        const adjust = (direction: number, corner?: TileCorner) => this.plugin.adjustHeight(
            direction * this.heightStep,
            corner ? 0 : this.heightSmoothing,
            corner,
        );
        const buttons = document.createElement("div");
        Object.assign(buttons.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" });
        buttons.append(
            createCompactButton("Raise", "Raise the selection", () => adjust(1)),
            createCompactButton("Lower", "Lower the selection", () => adjust(-1)),
        );
        controls.append(fields, buttons);
        if (isSingleTile) {
            // Laid out as seen from above, north at the top.
            const corners = document.createElement("div");
            Object.assign(corners.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" });
            for (const [corner, name] of [["nw", "NW"], ["ne", "NE"], ["sw", "SW"], ["se", "SE"]] as const) {
                const pair = document.createElement("div");
                Object.assign(pair.style, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" });
                pair.append(
                    createCompactButton(`${name} ▲`, `Raise only the ${name} corner`, () => adjust(1, corner)),
                    createCompactButton(`${name} ▼`, `Lower only the ${name} corner`, () => adjust(-1, corner)),
                );
                corners.appendChild(pair);
            }
            controls.appendChild(corners);
        }
        return controls;
    }

    private npcSpawnsKey(): string {
        return npcSpawnsKey(this.plugin);
    }

    /** Cheap check run on every editor update; the save itself builds the exports. */
    private hasUnsavedChanges(): boolean {
        return this.travel.dirty || this.groundItems.dirty || this.plugin.getWorldDefinitionForSave() !== undefined ||
            this.plugin.getNewMapSquares().length > 0 ||
            this.plugin.getConfig().edits.some((edit) =>
                edit.kind !== "npc" && edit.kind !== "npcDelete" && edit.kind !== "npcWander") ||
            this.npcSpawnsKey() !== this.savedNpcSpawnsKey;
    }

    private syncSaveButton(): void {
        const changed = this.hasUnsavedChanges();
        this.layout?.setChanged(changed);
        this.syncReview(changed);
        if (this.fileStatus) {
            this.fileStatus.textContent = changed ? "Unsaved changes" : this.session.lastSaveStatus ?? "";
        }
        const save = this.saveButton;
        if (!save) return;
        const disabled = !changed;
        if (save.disabled === disabled) return;
        save.disabled = disabled;
        Object.assign(save.style, disabled
            ? { opacity: "0.45", cursor: "default", pointerEvents: "none" }
            : { opacity: "", cursor: "pointer", pointerEvents: "" });
    }

    private sync(): void {
        this.syncSaveButton();
        this.syncAreaSummary();
        const state = this.plugin.getState();
        const panelTool = this.inspectorToolPanel?.dataset.activeTool;
        if (panelTool && panelTool !== state.config.tool) this.inspectorToolPanel?.remove();

        this.syncSwatches?.();
        this.syncBrushInputs?.();
        this.syncScatterInputs?.();

        this.renderDistanceInput.value = String(state.config.renderDistance ?? 25);
        this.renderDistanceLabel.value = state.config.renderDistance === undefined ? "Game default" : `${state.config.renderDistance} tiles`;
        this.selectionModeInput.value = this.plugin.getSelectionMode();
        if (state.config.tool !== "place") this.placementOptions?.remove();
        this.heightInput.value = String(state.config.heightLevel);
        this.renderAllInput.checked = state.config.renderAllHeightLevels;
        this.floorViewInput.value = state.config.floorView ?? "";
        this.saveObjectSpawnsInput.checked = state.config.saveObjectSpawns;
        this.syncToolCue();
        this.palette.setMode(state.search.kind);
        this.palette.setLayout(this.scattering);
        this.palette.setSelectedId(
            state.search.kind === "npc" ? state.config.npcId : state.config.locId,
        );
        if (state.version !== this.lastVersion) {
            this.lastVersion = state.version;
            this.palette.renderResults(state.search.results, state.search.loading);
        }

        this.renderSelection();
        this.inspectTravelObject(state.selection);
    }

    private renderSelection(): void {
        const { selection, config } = this.plugin.getState();
        const mode = this.plugin.getSelectionMode();
        const isEntity = selection?.kind === "loc" || selection?.kind === "npc";
        const isBuilding = selection?.kind === "building";
        const inContext = selection !== this.swatchSelection && config.tool === "select" && (mode !== "building" || isBuilding) && (mode !== "ground" || !isEntity);
        if (!selection || !inContext || this.inspectorToolPanel?.isConnected || this.palette.isVisible()) {
            if (!selection) this.selectionImage = undefined;
            this.selectionDetails.style.display = "none";
            return;
        }
        this.layout.activatePalette(isEntity ? "Objects" : isBuilding ? "Settlements" : "Misc");
        const imageKey = `${selection.kind}:${selection.locId}:${selection.tileX}:${selection.tileY}:${selection.plane}`;
        if (this.selectionImage && this.selectionImage.key !== imageKey) this.selectionImage = undefined;
        this.selectionDetails.replaceChildren();
        if (selection.kind === "building") {
            const title = document.createElement("div");
            title.textContent = "Building";
            const location = document.createElement("div");
            location.textContent =
                `World ${selection.tileX}, ${selection.tileY} → ${selection.tileEndX}, ${selection.tileEndY}` +
                ` · planes ${selection.plane}–${selection.planeEnd ?? selection.plane}`;
            const dimensions = document.createElement("div");
            dimensions.textContent =
                `${selection.buildingShape ?? "Building"} · ${selection.buildingWidth} × ${selection.buildingDepth} tiles` +
                ` · ${selection.buildingFloors} floor${selection.buildingFloors === 1 ? "" : "s"}` +
                ` · ${selection.buildingTileCount} selected tiles`;
            const objects = document.createElement("div");
            objects.textContent =
                `${selection.buildingObjectCount} objects` +
                ` · ${selection.buildingWallCount} walls/corners` +
                ` · ${selection.buildingDoorCount} doors` +
                ` · ${selection.buildingRoofCount} roof pieces` +
                ` · ${selection.buildingDecorationCount} wall decorations` +
                ` · ${selection.buildingOtherCount} other`;
            const wall = document.createElement("div");
            wall.textContent =
                selection.buildingWallId === undefined
                    ? "Wall type: mixed/unknown"
                    : `Primary wall ID ${selection.buildingWallId}`;
            const actions = document.createElement("div");
            Object.assign(actions.style, { display: "grid", gap: "5px", marginTop: "8px" });
            const copy = createActionButton("Copy building", createDuplicateIcon, () => {
                if (!selection.buildingProfile) return;
                void navigator.clipboard.writeText(`${JSON.stringify(selection.buildingProfile, null, 2)}\n`).then(
                    () => { copy.lastChild!.textContent = " Copied"; },
                    () => { copy.lastChild!.textContent = " Copy failed"; },
                );
            });
            actions.append(copy,
                createActionButton("Duplicate building", createDuplicateIcon, () => this.duplicateArea()),
                createActionButton("Save as preset", createSaveIcon, () => this.saveSelectionAsPreset()),
            );
            this.selectionDetails.append(title, location, dimensions, objects, wall, actions);
            this.selectionDetails.style.display = "block";
            return;
        }
        const title = document.createElement("div");
        const hasTileRange =
            selection.tileEndX !== undefined &&
            selection.tileEndY !== undefined &&
            (selection.tileEndX !== selection.tileX || selection.tileEndY !== selection.tileY);
        const isGroundSelection = selection.kind !== "loc" && selection.kind !== "npc";
        title.textContent =
            selection.locId >= 0
                ? `${selection.locName || (selection.kind === "npc" ? "Unknown NPC" : "Unknown object")} · ${selection.kind === "npc" ? "NPC" : "ID"} ${selection.locId}`
                : hasTileRange
                    ? "Ground tiles"
                    : "Ground tile";
        const location = document.createElement("div");
        location.textContent =
            !hasTileRange
                ? `World ${selection.tileX}, ${selection.tileY}, ${selection.plane}`
                : `World ${selection.tileX}, ${selection.tileY} → ${selection.tileEndX}, ${selection.tileEndY}, ${selection.plane}`;
        const rotation = document.createElement("div");
        rotation.textContent =
            selection.kind === "loc" && selection.rotation !== undefined
                ? `Object rotation ${selection.rotation}`
                : `Placement rotation ${this.plugin.getConfig().rotation}`;
        const definition =
            selection.kind === "loc" || selection.kind === "npc"
                ? this.plugin.describeDefinition(selection.kind, selection.locId)
                : undefined;
        const gameActions = definition?.fields.find(([name]) => name === "actions")?.[1];
        const divider = document.createElement("div");
        Object.assign(divider.style, {
            height: "1px",
            margin: "8px 0",
            background: "rgba(255,255,255,0.1)",
        });
        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "grid", gap: "5px" });
        if (isGroundSelection) {
            if (!hasTileRange) {
                const overlay = this.plugin.getSelectionOverlay();
                const current = document.createElement("div");
                current.className = "rspsi-current-overlay";
                current.dataset.mapEditor = "current-overlay";
                const preview = this.createOverlaySwatchIcon(overlay ?? 0);
                preview.setAttribute("role", "img");
                preview.setAttribute("aria-label", overlay === undefined ? "Overlay unavailable" :
                    overlay === 0 ? "No overlay" : `Current overlay #${overlay}`);
                const label = document.createElement("span");
                label.textContent = overlay === 0 ? "Current overlay · None" : "Current overlay";
                const use = createCompactButton("Use", "Use current tile overlay", () => this.plugin.useSelectionOverlay());
                use.disabled = overlay === undefined;
                current.append(preview, label, use);
                actions.append(current);
            }
            actions.append(
                this.createOverlayPicker(() => this.plugin.paintSelection()).element,
                createActionButton("Paint overlay", createPaintIcon, () =>
                    this.plugin.paintSelection(),
                ),
                this.createHeightControls(!hasTileRange),
            );
        }
        if (selection.kind === "loc") {
            actions.append(
                createActionButton("Add to swatches", createSaveIcon, () => {
                    const swatch = this.selectedObjectSwatch();
                    if (swatch) this.addObjectSwatch(swatch);
                }),
                createActionButton("Rotate object", createRotateIcon, () => this.plugin.rotateSelection(), "R"),
                createActionButton("Duplicate object", createDuplicateIcon, () =>
                    this.plugin.duplicateSelection(), "C",
                ),
                createActionButton("Move object", createMoveIcon, () => this.plugin.moveSelection(), "M"),
                createActionButton("Delete object", createTrashIcon, () =>
                    this.plugin.deleteSelection(), "Del",
                ),
                createActionButton("Edit travel link", createMoveIcon, () => this.openTravelPanel(selection)),
            );
        }
        if (selection.kind === "loc") actions.append(this.createHeightControls(true));
        if (selection.kind === "npc") {
            actions.append(
                createActionButton("Duplicate NPC", createDuplicateIcon, () =>
                    this.plugin.duplicateSelection(), "C",
                ),
                createActionButton("Move NPC", createMoveIcon, () => this.plugin.moveSelection(), "M"),
                createActionButton("Delete NPC", createTrashIcon, () =>
                    this.plugin.deleteSelection(), "Del",
                ),
            );
        }
        if (selection.kind === "loc" || selection.kind === "npc") {
            actions.append(
                createActionButton("Capture image", createCameraIcon, () =>
                    this.captureSelectionImage(imageKey),
                ),
            );
            if (this.selectionImage?.key === imageKey && this.selectionImage.loading) {
                const status = document.createElement("div");
                status.textContent = "Capturing image…";
                status.style.color = "#94a3b8";
                actions.appendChild(status);
            } else if (this.selectionImage?.key === imageKey) {
                const image = document.createElement("img");
                image.src = this.selectionImage.dataUrl;
                image.alt = `Captured ${selection.kind === "npc" ? "NPC" : "object"} image`;
                Object.assign(image.style, {
                    display: "block",
                    width: "100%",
                    maxHeight: "240px",
                    objectFit: "contain",
                    borderRadius: "4px",
                    background: "rgba(0,0,0,0.22)",
                });
                actions.appendChild(image);
            }
        }
        if (selection.kind !== "npc") {
            const copy = createActionButton("Copy area", createDuplicateIcon, () => {
                try {
                    const contents = this.areaForClipboard();
                    void navigator.clipboard.writeText(contents).then(
                        () => { copy.lastChild!.textContent = " Copied"; },
                        (error) => this.toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`),
                    );
                } catch (error) {
                    this.toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
            actions.append(copy);
            if (!hasTileRange) {
                const destination = { tileX: selection.tileX, tileY: selection.tileY, plane: selection.plane };
                const paste = createActionButton("Paste area", createDuplicateIcon, () => {
                    void Promise.resolve().then(() => navigator.clipboard.readText()).then(contents => {
                        this.plugin.pasteArea(contents, destination);
                        this.toast("Area pasted. Undo takes it back; Save keeps it.");
                    }).catch(error => this.toast(`Paste failed: ${error instanceof Error ? error.message : String(error)}`));
                });
                paste.title = "Paste at this southwest tile on all four levels. Replaces terrain and objects; adds copied NPCs.";
                actions.append(paste);
            }
        }
        if (hasTileRange) {
            actions.append(
                createActionButton("Duplicate area", createDuplicateIcon, () => this.duplicateArea()),
                createActionButton("Save as preset", createSaveIcon, () => this.saveSelectionAsPreset()),
                createActionButton("Build here", createHammerIcon, () => this.openBuildPanel(selection)),

                createActionButton("Clear area", createTrashIcon, () => this.plugin.clearArea()),
                createActionButton("Flatten area", createLayersIcon, () => this.plugin.flattenArea()),
            );
            if (this.plugin.canGenerateIsland()) {
                actions.append(createActionButton("Generate island", createLayersIcon, () => this.plugin.generateIsland()));
            }
            const width = Math.abs(selection.tileEndX! - selection.tileX) + 1;
            const depth = Math.abs(selection.tileEndY! - selection.tileY) + 1;
            const bounds = regionBounds(regionIdOf(selection.tileX, selection.tileY));
            if (width === 64 && depth === 64 && Math.min(selection.tileX, selection.tileEndX!) === bounds.minX &&
                Math.min(selection.tileY, selection.tileEndY!) === bounds.minY) {
                actions.append(this.createRegionEdgeControls());
            }

        }
        this.selectionDetails.append(createHeader(title.textContent ?? "Selection", () => this.plugin.clearSelection()), location);
        if (isEntity) this.selectionDetails.append(rotation);
        if (selection.kind === "npc") {
            const source = document.createElement("div");
            source.textContent = selection.npcSource === "custom"
                ? "Editor spawn"
                : selection.npcSource === "spawn" ? "Game spawn" : "Live NPC";
            source.style.color = "#94a3b8";
            const row = document.createElement("label");
            Object.assign(row.style, {
                display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", color: "#cbd5e1",
            });
            const label = document.createElement("span");
            label.textContent = "Wander range";
            const input = document.createElement("input");
            input.type = "number";
            input.min = "0";
            input.max = "255";
            input.step = "1";
            input.value = String(selection.npcWanderRadius ?? 5);
            input.title = "Tiles the NPC may wander from its spawn; 0 anchors it";
            input.disabled = selection.npcSource === undefined;
            Object.assign(input.style, {
                width: "64px", height: "26px", padding: "2px 5px", color: "#fff", background: "#111318",
                border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px", font: "12px sans-serif",
            });
            const hint = document.createElement("span");
            hint.textContent = "0 = anchored";
            hint.style.color = "#94a3b8";
            const commit = () => {
                this.plugin.setSelectionWanderRadius(Number(input.value));
                input.value = String(this.plugin.getState().selection?.npcWanderRadius ?? 5);
            };
            input.addEventListener("change", commit);
            row.append(label, input, hint);
            this.selectionDetails.append(source, row);
            const leashLabel = document.createElement("label");
            Object.assign(leashLabel.style, { display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" });
            const leash = document.createElement("input");
            Object.assign(leash.style, INPUT_STYLE, { width: "90px" });
            leash.type = "number";
            leash.min = "0";
            leash.max = "255";
            leash.placeholder = "Default";
            leash.value = selection.npcLeashRadius == null ? "" : String(selection.npcLeashRadius);
            leash.onchange = () => this.plugin.setSelectionWanderRadius(
                selection.npcWanderRadius ?? 5, leash.value === "" ? null : Number(leash.value),
            );
            leashLabel.append("Combat leash", leash);
            this.selectionDetails.append(leashLabel);
        }
        if (definition) {
            const menuActions = gameActions && gameActions !== "—" ? gameActions.split(", ") : [];
            menuActions.push("Examine");
            const menu = document.createElement("table");
            Object.assign(menu.style, {
                width: "100%",
                marginTop: "6px",
                borderCollapse: "collapse",
                color: "#fff",
                background: "#5d5447",
                font: "bold 12px Arial, Helvetica, sans-serif",
                textShadow: "1px 1px #000",
            });
            const targetColor = selection.kind === "npc" ? "#ffff00" : "#00ffff";
            for (const option of menuActions) {
                const row = menu.insertRow();
                const action = row.insertCell();
                const target = row.insertCell();
                action.textContent = option;
                target.textContent = selection.locName;
                Object.assign(action.style, { padding: "2px 4px" });
                Object.assign(target.style, { padding: "2px 4px", color: targetColor });
            }
            this.selectionDetails.appendChild(menu);
        }
        this.selectionDetails.append(divider, actions);
        this.selectionDetails.style.display = "block";
    }

    private captureSelectionImage(key: string): void {
        this.selectionImage = { key, dataUrl: "", loading: true };
        this.renderSelection();
        void this.plugin.captureSelectionImage().then((dataUrl) => {
            if (this.selectionImage?.key !== key) return;
            this.selectionImage = dataUrl ? { key, dataUrl, loading: false } : undefined;
            this.renderSelection();
        });
    }

    private showDefinition(kind: EditModeSearchKind, id: number): void {
        const definition = this.plugin.describeDefinition(kind, id);
        if (!definition) return;
        this.closeDetailPanel();
        const kindTitle = kind === "npc" ? "NPC" : kind === "loc" ? "Object" : "Item";
        const panel = this.attachInspectorPanel("definition-panel");
        this.detailPanel = panel;
        panel.appendChild(
            createHeader(`${kindTitle} ${id} · ${definition.name}`, () => this.closeDetailPanel()),
        );
        const preview = this.assetPreview(kind);
        panel.append(preview.image);
        preview.update(id);
        this.appendDefinitionFields(panel, definition);
    }

    private appendDefinitionFields(
        panel: HTMLElement,
        definition: EditModeDefinitionSummary,
    ): void {
        for (const [label, value] of definition.fields) {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "grid",
                gridTemplateColumns: "112px 1fr",
                gap: "8px",
                padding: "4px 0",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
            });
            const key = document.createElement("span");
            key.textContent = label;
            key.style.color = "#94a3b8";
            const val = document.createElement("span");
            val.textContent = value;
            val.style.wordBreak = "break-word";
            row.append(key, val);
            panel.appendChild(row);
        }
    }

    private toggleWorldMap(mode?: "zones"): void {

        const nextMode = mode ?? "navigate";
        const alreadyOpen = this.worldMapMode === nextMode;
        if (mode) this.dismissToolPanel();
        else {
            this.closeJumpToLocation();
            this.plugin.closeWorldMap();
        }
        if (alreadyOpen) return;
        this.plugin.finishActiveBrush();
        this.plugin.toggleWorldMap({
            mode: nextMode,
            onClose: () => this.syncWorldMap(),
        });
        if (this.plugin.isWorldMapOpen()) this.syncWorldMap(nextMode);
    }

    private syncWorldMap(mode?: "navigate" | "zones"): void {
        this.worldMapMode = mode;
        this.mapButton.setAttribute("aria-pressed", String(mode === "navigate"));
        if (!this.mapButton.isConnected) return;
        this.syncToolCue();
        this.renderSelection();
    }

    private pickRegionFromMap(): void {
        this.plugin.closeWorldMap();
        this.plugin.toggleWorldMap({
            mode: "regions",
            createRegion: (tile) => {
                if (tile.tileX < 0 || tile.tileX > WORLD_COORD_MAX || tile.tileY < 0 || tile.tileY > WORLD_COORD_MAX) {
                    this.toast("Choose a map square inside the world.");
                    return;
                }
                this.openRegionPanel(regionIdOf(tile.tileX, tile.tileY));
            },
        });
    }

    private toggleSettings(): void {
        this.layout.openSidebar();
        if (this.settingsDrawer) {
            this.closeSettings();
            return;
        }
        this.dismissToolPanel();
        const panel = createPanel("settings", "min(340px, calc(100vw - var(--map-editor-panel-left, 62px) - 13px))");
        this.layout.activatePalette("Misc");
        this.settingsDrawer = panel;
        panel.append(createHeader("Settings", () => this.closeSettings()), this.settingsContent);
        this.renderDistanceInput.focus();
    }

    private closeSettings(): void {
        this.settingsDrawer?.remove();
        this.settingsDrawer = undefined;
    }

    /**
     * Pulls the server's saved spawn patch into this profile's edit list so a
     * fresh profile can see and preserve the changes already in the file.
     */
    private async importPersistedNpcSpawns(): Promise<void> {
        if (persistedNpcSpawnsRequested) return;
        persistedNpcSpawnsRequested = true;
        try {
            const edits = await this.plugin.loadPersistedNpcSpawnEdits();
            if (edits.length === 0) return;
            if (this.plugin.importNpcSpawnEdits(edits)) {
                this.savedNpcSpawnsKey = this.npcSpawnsKey();
                this.syncSaveButton();
            }
        } catch (error) {
            // Leave the one-shot open so a later mount can retry.
            persistedNpcSpawnsRequested = false;
            console.warn("[edit-mode] failed to import saved NPC spawns", error);
        }
    }

    private async exportRegions(downloadOnly = false): Promise<void> {
        if (this.saving) return;
        this.plugin.finishActiveBrush();
        try {
            const host = downloadOnly ? undefined : browserHostWindow();
            // Region packs can hot-reload. Browser hosts also support their separate object-spawn mode.
            const saveToJson = !!host && this.plugin.getConfig().saveObjectSpawns;
            const objectSpawns = this.plugin.exportObjectSpawns(saveToJson);
            const exported = this.plugin.exportModifiedRegionPacks(saveToJson);
            const newSquares = this.plugin.getNewMapSquares();
            const draftPack = this.plugin.getNewMapSquare(newSquares.at(-1) ?? -1);
            const draft = draftPack && this.session.landscapeSettings.get(draftPack.data);
            const origin = draft?.regions.every((regionId) => newSquares.includes(regionId)) ? draft.location : undefined;
            const newArea = newSquares.length ? regionBounds(newSquares[0]) : undefined;
            const location = origin ?? (newArea ? { tileX: newArea.minX + 32, tileY: newArea.minY + 32, plane: 0 } :
                editorChangeAreas(this.plugin.getConfig().edits)[0]?.target ?? this.travel.changedSources[0] ?? this.groundItems.changedTiles[0]);
            // Saving only the regions that fit would leave the map half edited, so save none.
            const oversized = oversizedRegionPacks(exported);
            if (oversized.length > 0) {
                const regions = oversized.map(({ regionId, payload }) => `${regionId} (${payload.toLocaleString()} bytes)`).join(", ");
                this.toast(`Not saved: the map data does not fit the ${MAX_REGION_PACK_PAYLOAD.toLocaleString()} byte region packet even compressed: ${regions}. Undo or edit fewer tiles.`);
                return;
            }
            const world = this.plugin.getWorldDefinitionForSave();
            const customNpcs = this.plugin.getConfig().edits
                .filter((edit) => edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander")
                .map((edit) => ({
                    id: edit.locId,
                    tileX: edit.tileX,
                    tileY: edit.tileY,
                    plane: edit.plane,
                    ...(edit.kind === "npc"
                        ? { direction: edit.direction ?? quarterTurnToDirection(edit.rotation) }
                        : edit.direction === undefined ? {} : { direction: edit.direction }),
                    ...(edit.wanderRadius === undefined ? {} : { wanderRadius: edit.wanderRadius }),
                    ...(edit.leashRadius === undefined ? {} : { leashRadius: edit.leashRadius }),
                    ...(edit.kind === "npcDelete" ? { remove: true } : {}),
                }));
            const npcSpawnsDirty = this.npcSpawnsKey() !== this.savedNpcSpawnsKey;
            if (objectSpawns === undefined && exported.length === 0 && !world && !npcSpawnsDirty && !this.travel.dirty && !this.groundItems.dirty) {
                this.toast("No world or map edits to save");
                return;
            }
            // Opened from /host: hand the pack to the host tab instead of the
            // download folder, so Restart there streams the edited region.
            if (host && !host.closed) {
                const hostOrigin = browserHostOrigin();
                if (objectSpawns !== undefined) host.postMessage(
                    { type: OBJECT_SPAWNS_MESSAGE, contents: formatObjectSpawns(objectSpawns) }, hostOrigin,
                );
                for (const pack of exported) {
                    const message = { type: REGION_PACK_MESSAGE, ...pack } as const;
                    host.postMessage(message, hostOrigin);
                }
                if (world) {
                    host.postMessage(
                        { type: WORLD_DEFINITION_MESSAGE, contents: JSON.stringify(world, null, 2) + "\n" },
                        hostOrigin,
                    );
                    this.plugin.markWorldDefinitionSaved();
                }
                if (npcSpawnsDirty || customNpcs.length) {
                    host.postMessage({ type: CUSTOM_NPC_SPAWNS_MESSAGE, spawns: customNpcs }, hostOrigin);
                }
                const exportSeparately = this.travel.dirty || this.groundItems.dirty;
                if (!exported.length && objectSpawns === undefined && !world && !npcSpawnsDirty) {
                    this.session.lastSaveStatus = "Use Export ZIP for travel links and ground items.";
                    this.syncSaveButton();
                    return;
                }
                this.savedNpcSpawnsKey = this.npcSpawnsKey();
                this.session.publication = { location, regions: [], restart: true };
                this.session.lastSaveStatus = exportSeparately
                    ? "Map sent. Restart the host to play. Use Export ZIP for travel links or ground items."
                    : "Map sent. Restart from the host tab to play.";
                this.plugin.markMapEditsSaved(exported, objectSpawns);
                this.syncSaveButton();
                this.toast(this.session.lastSaveStatus);
                return;
            }
            const files = new Map<string, Blob>();
            const json = (name: string, contents: string) => files.set(`definitions/${name}`, new Blob([contents], { type: "application/json" }));
            if (objectSpawns !== undefined) json("object-spawns.json", formatObjectSpawns(objectSpawns));
            for (const pack of exported) {
                files.set(`regions/${pack.regionId}.pack`, new Blob([pack.data.slice().buffer], {
                    type: "application/octet-stream",
                }));
            }
            if (npcSpawnsDirty) {
                json("npc-spawns-custom.json", formatCustomNpcSpawns(customNpcs.map(({ id, tileX: x, tileY: y, plane: level, direction, wanderRadius, leashRadius, remove }) => ({
                    id, x, y, level,
                    ...(direction === undefined ? {} : { direction }),
                    ...(wanderRadius === undefined ? {} : { wanderRadius }),
                    ...(leashRadius === undefined ? {} : { leashRadius }),
                    ...(remove ? { remove: true } : {}),
                }))));
            }
            if (this.travel.dirty) json("map-warps.json", this.travel.contents());
            if (this.groundItems.dirty) json("ground-items-custom.json", this.groundItems.contents());
            const connected = downloadOnly ? undefined : this.mapFiles;
            const overrides = this.plugin.worldOverridesForSave();
            for (const key of ["zones"] as const) {
                if (key in overrides) json(`map-${key}.json`, JSON.stringify(overrides[key], null, 2) + "\n");
            }
            await this.withFileProgress(connected ? "Saving map edit layer…" : "Preparing map ZIP…", async () => {
                if (connected) {
                    if (this.travel.dirty) await connected.checkLoadedDefinition("map-warps.json", this.travel.savedContents());
                    if (this.groundItems.dirty) await connected.checkLoadedDefinition("ground-items-custom.json", this.groundItems.savedContents());
                    for (const key of ["zones"] as const) {
                        if (key in overrides) await connected.checkLoadedWorld(`map-${key}.json`, this.plugin.getLoadedWorldSetting(key));
                    }
                    const additions = new Set(newSquares.map((regionId) => `regions/${regionId}.pack`));
                    for (const { regionId } of exported) {
                        if (!this.plugin.isNewMapSquare(regionId)) await connected.checkLoadedRegion(regionId, this.plugin.getLoadedMapData(regionId));
                    }
                    await connected.save(files, additions);
                } else {
                    const base = await fetchContent("/api/world/map-save-base")
                        .catch(() => undefined) as { latest?: string } | undefined;
                    const { default: JSZip } = await import("jszip");
                    const zip = new JSZip();
                    const folder = zip.folder(`map-edits/${mapEditLayerId(base?.latest)}`)!;
                    for (const [path, blob] of files) folder.file(path, await blob.arrayBuffer());
                    folder.file("manifest.json", JSON.stringify([...files.keys()].map((path) => ({ path, exists: true }))));
                    FileSaver.saveAs(await zip.generateAsync({ type: "blob" }), "map-overrides.zip");
                }
            });
            if (!connected) {
                this.session.publication ??= { location, regions: [], restart: false };
                this.session.lastSaveStatus = "ZIP downloaded. Extract into your server’s data folder, then restart the server.";
                this.syncSaveButton();
                this.toast(this.session.lastSaveStatus);
                return;
            }
            const previous = this.session.publication;
            const regions = [...new Set([...(previous?.regions ?? []), ...exported.map(({ regionId }) => regionId)])];
            const restart = previous?.restart === true || regions.length > 12 || [...files.keys()].some((path) => path.startsWith("definitions/"));
            this.session.publication = { location, regions, restart };
            this.session.lastSaveStatus = restart ? "Saved. Restart the server to play. You can keep editing here."
                : this.plugin.canReloadSavedRegions(regions) ? "Saved. Load in game as world owner, or restart the server."
                    : "Saved. Restart the server to play, or use the load command in game as owner.";
            if (world) this.plugin.markWorldDefinitionSaved();
            this.travel.markSaved();
            this.groundItems.markSaved();
            this.savedNpcSpawnsKey = this.npcSpawnsKey();
            this.plugin.markMapEditsSaved(exported, objectSpawns);
            this.syncSaveButton();
            this.toast(this.session.lastSaveStatus);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[edit-mode] Region export failed", error);
            this.toast(`Could not save map edits. ${message}`);
        }
    }

    /** Transient confirmation; the editor chrome has no status bar of its own. */
    private toast(message: string): void {
        const element = document.createElement("div");
        element.textContent = message;
        Object.assign(element.style, PANEL_STYLE, {
            left: "60px",
            top: TOP_BAR_CLEARANCE,
            width: "auto",
            padding: "8px 12px",
        });
        document.body.appendChild(element);
        window.setTimeout(() => element.remove(), 4000);
    }

    private closeDetailPanel(): void {
        this.detailPanel?.remove();
        this.detailPanel = undefined;
        this.review = undefined;
    }
}

/** Mounts the reference editor chrome and returns its complete teardown. */
export function mountEditorUi(plugin: EditModePlugin): () => void {
    const editor = new EditorChrome(plugin);
    return () => editor.remove();
}
