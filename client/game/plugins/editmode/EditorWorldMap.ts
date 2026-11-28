import type { EditModeTile, EditModeWorldZone, EditModeBoundedWorldZone } from "./types";
import { regionBounds, regionIdOf, WORLD_COORD_MAX } from "./EditorCoordinates";

type WorldMapArea = {
    id: number;
    externalName?: string;
    origin?: { x: number; y: number; plane: number };
    regionLowX: number;
    regionHighX: number;
    regionLowY: number;
    regionHighY: number;
    coord(x: number, y: number): { plane: number; x: number; y: number } | undefined;
};

type EditorWorldMapClient = {
    worldMapState: {
        currentArea?: WorldMapArea;
        areasById?: ReadonlyMap<number, WorldMapArea>;
        displayX: number;
        displayY: number;
        zoomPercentage?: number;
        targetX?: number;
        targetY?: number;
        setCurrentMapAreaId(id: number): void;
        setCurrentMapAreaAndPosition(plane: number, x: number, y: number): void;
        setDisplayPosition(x: number, y: number): void;
        setZoomPercentage?(zoom: number): void;
        setWorldMapPositionTarget?(x: number, y: number): void;
    };
    getWorldMapImageTile(
        mapX: number,
        mapY: number,
        level?: number,
        accessPriority?: number,
    ): { pixels?: Uint8Array; width: number; height: number } | undefined;
};

const MAX_TILE_CANVASES = 72;
const MAX_RAW_TILES = 384;
const MIN_MAP_ZOOM = 0.125;
const MAX_FOOTPRINT_SPAN = 8;

export type MapFootprint = { x: number; y: number; width: number; height: number; regions: readonly number[] };

function footprintBetween(start: EditModeTile, end: EditModeTile): MapFootprint {
    const left = Math.min(start.tileX, end.tileX) >> 6;
    const right = Math.max(start.tileX, end.tileX) >> 6;
    const bottom = Math.min(start.tileY, end.tileY) >> 6;
    const top = Math.max(start.tileY, end.tileY) >> 6;
    const regions: number[] = [];
    if (right - left < MAX_FOOTPRINT_SPAN && top - bottom < MAX_FOOTPRINT_SPAN) {
        for (let x = left; x <= right; x++) for (let y = bottom; y <= top; y++) regions.push((x << 8) | y);
    }
    return { x: left * 64, y: bottom * 64, width: (right - left + 1) * 64, height: (top - bottom + 1) * 64, regions };
}
function footprintFromSquares(regions: readonly number[]): MapFootprint | undefined {
    if (!regions.length) return;
    const x = regions.map((id) => id >> 8);
    const y = regions.map((id) => id & 255);
    const minX = Math.min(...x), minY = Math.min(...y);
    return { x: minX * 64, y: minY * 64, width: (Math.max(...x) - minX + 1) * 64,
        height: (Math.max(...y) - minY + 1) * 64, regions: [...regions].sort((a, b) => a - b) };
}

function connectedSquares(ids: readonly number[]): boolean {
    const remaining = new Set(ids);
    const pending = [ids[0]];
    remaining.delete(ids[0]);
    for (let i = 0; i < pending.length; i++) {
        const id = pending[i];
        for (const next of [id - 256, id + 256, id - 1, id + 1]) {
            if (remaining.delete(next)) pending.push(next);
        }
    }
    return !remaining.size;
}

const CAVE_OFFSET = 6400;
type RawMapLayer = "surface" | "caves";

function layerAt(y: number): RawMapLayer {
    return y >= CAVE_OFFSET ? "caves" : "surface";
}

const MAP_LANDMARKS = {
    surface: [
        ["Lumbridge", 3222, 3218], ["Edgeville", 3094, 3493], ["Varrock", 3212, 3424],
        ["Falador", 2965, 3380], ["Ardougne", 2662, 3306], ["Karamja", 2918, 3176], ["Mort Myre", 3450, 3333],
    ],
    caves: [
        ["Edgeville Dungeon", 3104, 9910], ["Dwarven Mine", 3022, 9806],
        ["Taverley Dungeon", 2884, 9798], ["Lumbridge Swamp Caves", 3168, 9572],
        ["Karamja Volcano Dungeon", 2847, 9568],
    ],
} as const;

type ZoneVisibility = { showPvp: boolean; showMulti: boolean; showDuel: boolean; showSafe: boolean; showF2p: boolean };

// Draw order on overlap: the first visible tag wins.
const ZONE_TYPE_LABELS = [["duel", "Duel"], ["safe", "Safe"], ["f2p", "F2P"], ["pvp", "PvP"], ["multi-combat", "Multi-combat"]] as const;
const ZONE_COLORS: Record<string, string> = {
    duel: "#c4b5fd", safe: "#86efac", f2p: "#93c5fd", pvp: "#fca5a5", "multi-combat": "#fcd34d",
};

/** The colour a zone is drawn in, or undefined while none of its tags are toggled on. */
function zoneColor(visible: ZoneVisibility, zone: EditModeWorldZone): string | undefined {
    const shown: Record<string, boolean> = {
        duel: visible.showDuel, safe: visible.showSafe, f2p: visible.showF2p, pvp: visible.showPvp, "multi-combat": visible.showMulti,
    };
    const tag = ZONE_TYPE_LABELS.find(([tag]) => shown[tag] && zone.tags.includes(tag))?.[0];
    return tag ? ZONE_COLORS[tag] : undefined;
}

/**
 * The editor map deliberately does not mount widget group 595. It reuses the
 * cached in-game map tiles, but owns its DOM and pointer events completely.
 */
export type EditorWorldMapActions = {
    mode?: "navigate" | "regions" | "zones" | "footprint";
    expand?: boolean;
    initialFootprint?: MapFootprint;
    loadOccupiedSquares?: () => Promise<readonly number[]>;
    isFootprintOccupied?: (id: number) => boolean;
    selectFootprint?: (footprint: MapFootprint) => void;
    findTravelLinks?: () => void;
    createRegion?: (tile: EditModeTile) => void;
    onClose?: () => void;
};

export class EditorWorldMap {
    private panel?: HTMLDivElement;
    private backdrop?: HTMLDivElement;
    private returnFocus?: HTMLElement;
    private onClose?: () => void;
    private canvas?: HTMLCanvasElement;
    private context?: CanvasRenderingContext2D;
    private abort?: AbortController;
    private centerX = 0;
    private centerY = 0;
    private anchorTile?: EditModeTile;
    private mode?: EditorWorldMapActions["mode"];
    private rawLayer?: RawMapLayer;
    private floor = 0;
    private rawTiles = new Map<string, HTMLImageElement | undefined>();
    private rawPending = new Set<string>();
    private pixelsPerTile = 2;
    private animationFrame?: number;
    private previousMapState?: {
        areaId: number; displayX: number; displayY: number;
        zoomPercentage?: number; targetX?: number; targetY?: number;
    };
    private readonly tileCanvases = new Map<string, HTMLCanvasElement>();
    private plotting = false;
    private plotStart?: { x: number; y: number };
    private plotEnd?: { x: number; y: number };
    private regionPreview?: { x: number; y: number };
    private footprint?: MapFootprint;
    private footprintError?: string;
    private occupiedSquares?: Set<number>;
    private selectedZoneIndex?: number;
    private newZoneButton?: HTMLButtonElement;
    private zoneTypeSelect?: HTMLSelectElement;
    private deleteZoneButton?: HTMLButtonElement;

    loadMinimap(tile: EditModeTile): Promise<Blob | undefined> {
        return this.loadRawTile?.(tile.tileX >> 6, tile.tileY >> 6, tile.plane) ?? Promise.resolve(undefined);
    }

    constructor(
        private readonly client: EditorWorldMapClient,
        private readonly onNavigate: (tile: EditModeTile) => void,
        private readonly getZones: () => (ZoneVisibility & { zones: readonly EditModeWorldZone[] }) | undefined,
        private readonly onZoneResize: (index: number, bounds: Pick<EditModeBoundedWorldZone, "minX" | "maxX" | "minY" | "maxY">) => void,
        private readonly onNewZone: (bounds: Pick<EditModeBoundedWorldZone, "minX" | "maxX" | "minY" | "maxY">, tag: EditModeWorldZone["tags"][number]) => void,
        private readonly onZoneTypeChange: (index: number, tag: EditModeWorldZone["tags"][number]) => void,
        private readonly onZoneDelete: (index: number) => void,
        private readonly loadRawTile?: (mapX: number, mapY: number, plane: number) => Promise<Blob | undefined>,
        private readonly isOccupied?: (regionId: number) => boolean,
    ) {}

    private get canEditZones(): boolean {
        return (this.mode === undefined || this.mode === "zones") && this.getZones() !== undefined;
    }

    private visibleZones() {
        const visible = this.getZones();
        if (this.mode === "zones" && visible) {
            return { ...visible, showPvp: true, showMulti: true, showDuel: true, showSafe: true, showF2p: true };
        }
        return visible;
    }

    isOpen(): boolean {
        return this.panel !== undefined;
    }

    toggle(tile: EditModeTile | undefined, actions?: EditorWorldMapActions): void {
        if (this.panel) {
            this.close();
            return;
        }
        if (!tile) return;
        const state = this.client.worldMapState;
        this.mode = actions?.mode;
        this.onClose = actions?.onClose;
        this.floor = this.mode === "footprint" ? 0 : tile.plane;
        this.rawLayer = this.mode ? layerAt(tile.tileY) : undefined;
        this.pixelsPerTile = this.mode === "footprint" ? 0.75 : this.mode === "navigate" ? 3 : 2;
        if (!this.rawLayer) {
            this.rememberMapState();
            state.setCurrentMapAreaAndPosition(tile.plane, tile.tileX, tile.tileY);
        }
        const footprint = actions?.initialFootprint;
        this.footprint = footprint;
        if (footprint) this.rawLayer = layerAt(footprint.y);
        this.centerX = footprint ? footprint.x + footprint.width / 2 : this.rawLayer ? tile.tileX : state.displayX;
        this.centerY = footprint ? footprint.y + footprint.height / 2 : this.rawLayer ? tile.tileY : state.displayY;
        this.clampRawCenter();
        this.anchorTile = { ...tile };
        this.open(actions);
    }

    close(): void {
        const restoreFocus = this.panel?.contains(document.activeElement) ? this.returnFocus : undefined;
        if (this.animationFrame !== undefined) cancelAnimationFrame(this.animationFrame);
        this.animationFrame = undefined;
        this.abort?.abort();
        this.abort = undefined;
        this.panel?.remove();
        this.panel = undefined;
        this.backdrop?.remove();
        this.backdrop = undefined;
        this.returnFocus = undefined;
        this.canvas = undefined;
        this.context = undefined;
        this.tileCanvases.clear();
        this.rawTiles.clear();
        this.rawPending = new Set();
        this.anchorTile = undefined;
        this.rawLayer = undefined;
        this.mode = undefined;
        this.plotting = false;
        this.plotStart = undefined;
        this.plotEnd = undefined;
        this.regionPreview = undefined;
        this.footprint = undefined;
        this.footprintError = undefined;
        this.occupiedSquares = undefined;
        this.selectedZoneIndex = undefined;
        this.newZoneButton = undefined;
        this.zoneTypeSelect = undefined;
        this.deleteZoneButton = undefined;
        this.restoreMapState();
        if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
        const onClose = this.onClose;
        this.onClose = undefined;
        onClose?.();
    }

    private rememberMapState(): void {
        const { currentArea, displayX, displayY, zoomPercentage, targetX, targetY } = this.client.worldMapState;
        if (currentArea && !this.previousMapState) {
            this.previousMapState = { areaId: currentArea.id, displayX, displayY, zoomPercentage, targetX, targetY };
        }
    }

    private restoreMapState(): void {
        if (!this.previousMapState) return;
        const { areaId, displayX, displayY, zoomPercentage, targetX, targetY } = this.previousMapState;
        const state = this.client.worldMapState;
        state.setCurrentMapAreaId(areaId);
        state.setDisplayPosition(displayX, displayY);
        if (zoomPercentage !== undefined) state.setZoomPercentage?.(zoomPercentage);
        if (targetX !== undefined && targetX !== -1 && targetY !== undefined && targetY !== -1) {
            state.setWorldMapPositionTarget?.(targetX, targetY);
        }
        this.previousMapState = undefined;
    }

    private open(actions?: EditorWorldMapActions): void {
        const panel = document.createElement("div");
        const canvas = document.createElement("canvas");
        const heading = document.createElement("strong");
        const close = document.createElement("button");
        this.panel = panel;
        this.canvas = canvas;
        this.context = canvas.getContext("2d") ?? undefined;
        this.abort = new AbortController();
        const signal = this.abort.signal;

        panel.dataset.mapEditor = "world-map";
        Object.assign(panel.style, {
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: "10006",
            width: "min(900px, calc(100vw - 32px))",
            height: "min(720px, calc(100vh - 32px))",
            display: "flex",
            flexDirection: "column",
            padding: "12px",
            boxSizing: "border-box",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: "7px",
            color: "#e5e7eb",
            background: "rgba(18,20,24,0.98)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.58)",
            font: "12px/1.4 sans-serif",
        });
        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "9px",
        });
        heading.textContent = this.mode === "footprint" ? `${actions?.expand ? "Expand map portion" : "Create new map"} · Choose map squares` : this.mode === "regions" ? "Choose a map square" : this.mode === "zones" ? "Gameplay zones" : "World map";
        close.type = "button";
        close.textContent = "×";
        close.title = "Close world map";
        close.setAttribute("aria-label", close.title);
        Object.assign(close.style, {
            width: "25px",
            height: "25px",
            padding: "0",
            border: "0",
            color: "#aeb8c8",
            background: "transparent",
            cursor: "pointer",
            font: "22px/22px sans-serif",
        });
        close.addEventListener("click", () => this.close(), { signal });
        const newZone = this.newZoneButton = document.createElement("button");
        newZone.type = "button";
        newZone.textContent = "⤢  New zone";
        newZone.style.display = this.canEditZones ? "inline-block" : "none";
        newZone.title = "Plot a new zone by dragging a rectangle on the map";
        Object.assign(newZone.style, {
            height: "25px", padding: "0 9px", border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "4px", color: "#e5e7eb", background: "#1b1e25", cursor: "pointer",
        });
        newZone.addEventListener("click", () => {
            this.setSelectedZone(undefined);
            this.plotting = !this.plotting;
            newZone.style.background = this.plotting ? "#374151" : "#1b1e25";
            canvas.style.cursor = this.plotting ? "crosshair" : "grab";
        }, { signal });
        const zoneType = document.createElement("select");
        zoneType.title = "Zone type";
        zoneType.setAttribute("aria-label", zoneType.title);
        for (const [tag, label] of ZONE_TYPE_LABELS) zoneType.add(new Option(label, tag));
        Object.assign(zoneType.style, {
            display: "none", height: "25px", padding: "0 5px", border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "4px", color: "#e5e7eb", background: "#303640", font: "inherit",
        });
        zoneType.addEventListener("change", () => {
            if (this.selectedZoneIndex !== undefined) this.onZoneTypeChange(this.selectedZoneIndex, zoneType.value as EditModeWorldZone["tags"][number]);
        }, { signal });
        const deleteZone = document.createElement("button");
        deleteZone.type = "button";
        deleteZone.textContent = "Delete zone";
        deleteZone.title = "Delete selected zone";
        Object.assign(deleteZone.style, {
            display: "none", height: "25px", padding: "0 9px", border: "1px solid rgba(248,113,113,0.45)",
            borderRadius: "4px", color: "#fca5a5", background: "rgba(127,29,29,0.22)", cursor: "pointer",
        });
        deleteZone.addEventListener("click", () => {
            if (this.selectedZoneIndex === undefined) return;
            this.onZoneDelete(this.selectedZoneIndex);
            this.setSelectedZone(undefined);
        }, { signal });
        this.zoneTypeSelect = zoneType;
        this.deleteZoneButton = deleteZone;
        const zoneControl = document.createElement("div");
        Object.assign(zoneControl.style, { display: "inline-flex", gap: "0" });
        Object.assign(zoneType.style, { borderRadius: "4px 0 0 4px", margin: "0", boxSizing: "border-box" });
        Object.assign(newZone.style, { borderRadius: "0 4px 4px 0", borderLeft: "0", margin: "0", boxSizing: "border-box" });
        zoneControl.append(zoneType, newZone);
        header.append(heading, zoneControl, deleteZone, close);
        Object.assign(canvas.style, {
            flex: "1 1 auto",
            minHeight: "0",
            width: "100%",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "4px",
            background: "#090b0f",
            cursor: "grab",
            touchAction: "none",
        });
        panel.append(header);
        let onViewChange: (() => void) | undefined;
        if (this.mode) panel.append(this.createNavigation(signal, () => onViewChange?.()));
        if (this.mode === "zones" && !this.canEditZones) {
            const status = document.createElement("p");
            status.textContent = "Connect to the development world to edit gameplay zones.";
            panel.append(status);
        }
        panel.append(canvas);
        if (this.mode === "navigate") {
            const hint = document.createElement("div");
            hint.textContent = "Click to move the editor camera. Drag to pan. Scroll to zoom.";
            Object.assign(hint.style, { color: "#aeb8c8", marginTop: "6px" });
            panel.append(hint);
            canvas.tabIndex = 0;
            canvas.setAttribute("aria-label", "World map. Use the arrow keys to pan, plus and minus to zoom, and Enter to go to the center.");
        }
        const choosingFootprint = this.mode === "footprint";
        let panFootprint = false;
        let combineFootprint = false;
        let combiningDrag = false;
        let footprintStart: EditModeTile | undefined;
        let selectionAnchor: EditModeTile | undefined;
        let lastSelection: MapFootprint | undefined;
        let occupancyStatus = actions?.loadOccupiedSquares ? "Checking which map squares are in use…" : "";
        const updateFootprint = (footprint = this.footprint) => {
            this.footprint = footprint;
            const occupied = footprint?.regions.filter((id) => this.occupiedSquares?.has(id) || (actions?.isFootprintOccupied ?? this.isOccupied)?.(id));
            const adjacent = footprint?.regions.some((id) => [id - 256, id + 256, id - 1, id + 1].some((near) =>
                near >= 0 && near <= 0xffff && layerAt((near & 255) * 64) === layerAt(footprint.y) &&
                (this.occupiedSquares?.has(near) || this.isOccupied?.(near))));
            this.footprintError = !footprint ? undefined
                : !footprint.regions.length || footprint.width > 512 || footprint.height > 512 ? "Choose a footprint up to 8 × 8 squares."
                : occupied?.length ? `Already in use: ${occupied.join(", ")}.`
                : !connectedSquares(footprint.regions) ? "Connect the selected squares along their edges."
                : actions?.expand && !adjacent ? "Include a square next to existing terrain." : undefined;
            if (!choosingFootprint) return;
            selectionStatus.textContent = occupancyStatus || (footprint
                ? this.footprintError ?? `${footprint.regions.length} selected · ${footprint.regions.join(", ")}`
                : actions?.expand ? "Choose empty squares next to the map you want to extend."
                    : "Click an empty square or drag across several.");
            continueButton.disabled = !footprint || !!this.footprintError || !!occupancyStatus;
        };
        const selectionStatus = document.createElement("span");
        const continueButton = document.createElement("button");
        if (choosingFootprint) {
            const footer = document.createElement("div");
            Object.assign(footer.style, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", paddingTop: "8px" });
            Object.assign(selectionStatus.style, { flex: "1 1 230px", overflowWrap: "anywhere" });
            selectionStatus.setAttribute("role", "status");
            const pan = document.createElement("button");
            const combine = document.createElement("button");
            for (const control of [pan, combine, continueButton]) {
                control.type = "button";
                Object.assign(control.style, { color: "#e5e7eb", background: "#1b1e25", border: "1px solid #ffffff40",
                    borderRadius: "4px", padding: "4px 9px", font: "inherit" });
            }
            pan.textContent = "Pan map";
            pan.title = "Switch between dragging to pan and dragging to select";
            pan.setAttribute("aria-pressed", "false");
            pan.onclick = () => {
                panFootprint = !panFootprint;
                pan.setAttribute("aria-pressed", String(panFootprint));
                pan.textContent = panFootprint ? "Select squares" : "Pan map";
                canvas.style.cursor = panFootprint ? "grab" : "crosshair";
            };
            combine.textContent = "Add or remove squares";
            combine.title = "Add or remove squares from the selection to make a custom shape";
            combine.setAttribute("aria-pressed", "false");
            combine.onclick = () => {
                combineFootprint = !combineFootprint;
                combine.setAttribute("aria-pressed", String(combineFootprint));
                if (panFootprint) pan.click();
                combine.style.borderColor = combineFootprint ? "#86efac" : "#ffffff40";
            };
            continueButton.textContent = "Choose terrain";
            continueButton.onclick = () => {
                updateFootprint();
                const footprint = this.footprint;
                if (!footprint || this.footprintError || occupancyStatus) return;
                this.close();
                actions?.selectFootprint?.(footprint);
            };
            footer.append(selectionStatus, pan, combine, continueButton);
            panel.append(footer);
            canvas.tabIndex = 0;
            canvas.setAttribute("aria-label", "Use the arrow keys to pan and Enter to select the center square. Shift + Enter extends a selection.");
            onViewChange = () => {
                if (this.footprint && layerAt(this.footprint.y) !== this.rawLayer) {
                    this.footprint = undefined;
                    selectionAnchor = undefined;
                    updateFootprint();
                }
            };
            updateFootprint();
            void actions?.loadOccupiedSquares?.().then((regions) => {
                if (signal.aborted) return;
                this.occupiedSquares = new Set(regions);
                occupancyStatus = "";
                updateFootprint();
            }, () => {
                if (signal.aborted) return;
                occupancyStatus = "Could not check map squares. Reopen Create new map to try again.";
                updateFootprint();
            });
        }
        let chooseRegion = this.mode === "regions";
        canvas.style.cursor = chooseRegion || choosingFootprint ? "crosshair" : "grab";
        const reference = this.client.worldMapState.currentArea?.coord(Math.floor(this.centerX), Math.floor(this.centerY));
        const regionOffsetX = reference ? reference.x - Math.floor(this.centerX) : 0;
        const regionOffsetY = reference ? reference.y - Math.floor(this.centerY) : 0;
        const regionTarget = (screenX: number, screenY: number) => {
            const tile = this.worldTileAt(screenX, screenY);
            const anchor = this.anchorTile;
            if (!tile || !anchor) return;
            if (this.rawLayer && layerAt(tile.y) !== this.rawLayer) return;
            const coord = this.client.worldMapState.currentArea?.coord(tile.x, tile.y);
            // Empty map squares can sit beyond the edge of the labelled map area.
            const target = this.rawLayer ? { tileX: tile.x, tileY: tile.y, plane: this.floor } :
                coord ? { tileX: coord.x, tileY: coord.y, plane: coord.plane } : {
                tileX: tile.x + regionOffsetX, tileY: tile.y + regionOffsetY, plane: anchor.plane,
            };
            return { tile, target };
        };
        const footprintTile = (x: number, y: number) => {
            const target = regionTarget(x, y)?.target;
            if (!target || target.tileX < 0 || target.tileY < 0 ||
                target.tileX > WORLD_COORD_MAX || target.tileY > WORLD_COORD_MAX) return;
            return target;
        };
        const selectionTo = (start: EditModeTile, end: EditModeTile, combine: boolean) => {
            const rect = footprintBetween(start, end);
            if (!combine || !rect.regions.length || !lastSelection || layerAt(lastSelection.y) !== layerAt(rect.y)) return rect;
            const ids = new Set(lastSelection.regions);
            const remove = rect.regions.every((id) => ids.has(id));
            for (const id of rect.regions) {
                if (remove) ids.delete(id);
                else ids.add(id);
            }
            return footprintFromSquares([...ids]);
        };
        const hoverRegion = (x: number, y: number) => {
            const pick = regionTarget(x, y);
            this.regionPreview = undefined;
            if (!pick || pick.target.tileX < 0 || pick.target.tileX > WORLD_COORD_MAX ||
                pick.target.tileY < 0 || pick.target.tileY > WORLD_COORD_MAX) return;
            const { minX, minY } = regionBounds(regionIdOf(pick.target.tileX, pick.target.tileY));
            this.regionPreview = { x: minX + pick.tile.x - pick.target.tileX, y: minY + pick.tile.y - pick.target.tileY };
        };
        if (actions?.findTravelLinks || actions?.createRegion) {
            const tools = document.createElement("div");
            Object.assign(tools.style, { display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginTop: "8px" });
            const add = (label: string, click: () => void) => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                button.style.cssText = newZone.style.cssText;
                Object.assign(button.style, { display: "", borderRadius: "4px", borderLeft: "1px solid rgba(255,255,255,0.18)" });
                button.addEventListener("click", click, { signal });
                tools.append(button);
                return button;
            };
            const prompt = document.createElement("span");
            prompt.setAttribute("role", "status");
            if (this.mode === "regions") prompt.textContent = "Click a square to inspect or create it. Drag to pan, scroll to zoom.";
            else if (actions.createRegion) {
                const create = add("New region", () => {
                    if (this.plotting) newZone.click();
                    chooseRegion = !chooseRegion;
                    this.regionPreview = undefined;
                    create.setAttribute("aria-pressed", String(chooseRegion));
                    create.style.borderColor = chooseRegion ? "#60a5fa" : "";
                    canvas.style.cursor = chooseRegion ? "crosshair" : "grab";
                    prompt.textContent = chooseRegion ? "Click the map square to create. Drag to pan." : "";
                });
                create.setAttribute("aria-pressed", "false");
                newZone.addEventListener("click", () => {
                    chooseRegion = false;
                    this.regionPreview = undefined;
                    create.setAttribute("aria-pressed", "false");
                    create.style.borderColor = "";
                    prompt.textContent = "";
                }, { signal });
            }
            if (actions.findTravelLinks) add("Find travel links", () => {
                this.close();
                actions.findTravelLinks?.();
            });
            tools.append(prompt);
            panel.append(tools);
        }
        for (const type of ["mousedown", "click", "keydown", "keyup"]) {
            panel.addEventListener(type, (event) => event.stopPropagation(), { signal });
        }
        if (this.mode) {
            const backdrop = this.backdrop = document.createElement("div");
            Object.assign(backdrop.style, { position: "fixed", inset: "0", zIndex: "10006", background: "rgba(0,0,0,0.18)" });
            panel.setAttribute("role", "dialog");
            panel.setAttribute("aria-label", heading.textContent);
            panel.setAttribute("aria-modal", "true");
            backdrop.addEventListener("mousedown", (event) => event.stopPropagation(), { signal });
            backdrop.addEventListener("click", (event) => {
                event.stopPropagation();
                if (event.target === backdrop) this.close();
            }, { signal });
            panel.addEventListener("keydown", (event) => {
                if (event.key !== "Tab") return;
                const controls = [...panel.querySelectorAll<HTMLElement>("button, select, canvas[tabindex]")]
                    .filter((control) => !control.closest("[hidden]") && control.style.display !== "none");
                const first = controls[0], last = controls.at(-1);
                if (event.target !== (event.shiftKey ? first : last)) return;
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
            }, { signal });
            this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
            backdrop.append(panel);
            document.body.append(backdrop);
            close.focus();
        } else document.body.appendChild(panel);

        let dragging = false;
        let moved = false;
        let startX = 0;
        let startY = 0;
        let originX = 0;
        let originY = 0;
        let zoneDrag: { index: number; corner: "nw" | "ne" | "sw" | "se" | "n" | "e" | "s" | "w" } | undefined;
        canvas.addEventListener("pointerleave", () => { this.regionPreview = undefined; }, { signal });
        canvas.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 && !(choosingFootprint && event.button === 1)) return;
            event.preventDefault();
            event.stopPropagation();
            this.regionPreview = undefined;
            if (choosingFootprint && event.button === 0 && !panFootprint) {
                const tile = footprintTile(event.offsetX, event.offsetY);
                if (!tile) return;
                lastSelection = this.footprint;
                combiningDrag = combineFootprint || event.ctrlKey || event.metaKey;
                if (!event.shiftKey || !selectionAnchor || layerAt(selectionAnchor.tileY) !== layerAt(tile.tileY)) selectionAnchor = tile;
                footprintStart = selectionAnchor;
                dragging = true;
                canvas.setPointerCapture(event.pointerId);
                this.footprint = selectionTo(footprintStart, tile, combiningDrag);
                updateFootprint();
                return;
            }
            if (this.plotting) {
                this.plotStart = this.worldTileAt(event.offsetX, event.offsetY);
                this.plotEnd = this.plotStart;
                moved = false;
                dragging = true;
                canvas.setPointerCapture(event.pointerId);
                return;
            }
            zoneDrag = chooseRegion ? undefined : this.zoneHandleAt(event.offsetX, event.offsetY);
            if (zoneDrag) this.setSelectedZone(zoneDrag.index);
            dragging = true;
            moved = false;
            startX = event.clientX;
            startY = event.clientY;
            originX = this.centerX;
            originY = this.centerY;
            canvas.setPointerCapture(event.pointerId);
            canvas.style.cursor = "grabbing";
        }, { signal });
        canvas.addEventListener("pointermove", (event) => {
            if (!dragging) {
                hoverRegion(event.offsetX, event.offsetY);
                canvas.style.cursor = this.plotting || chooseRegion || (choosingFootprint && !panFootprint)
                    ? "crosshair" : this.zoneCursorAt(event.offsetX, event.offsetY);
                return;
            }
            if (footprintStart) {
                const end = footprintTile(event.offsetX, event.offsetY);
                if (end) {
                    this.footprint = selectionTo(footprintStart, end, combiningDrag);
                    updateFootprint();
                }
                return;
            }
            if (this.plotting && this.plotStart) {
                this.plotEnd = this.worldTileAt(event.offsetX, event.offsetY);
                moved = true;
                return;
            }
            if (!zoneDrag && !this.mode) canvas.style.cursor = this.zoneCursorAt(event.offsetX, event.offsetY);
            if (zoneDrag) {
                const zone = this.getZones()?.zones[zoneDrag.index];
                const next = this.worldTileAt(event.offsetX, event.offsetY);
                if (zone && zone.minX !== undefined && next) {
                    const bounds = {
                        minX: zoneDrag.corner.includes("w") ? Math.min(next.x, zone.maxX - 1) : zone.minX,
                        maxX: zoneDrag.corner.includes("e") ? Math.max(next.x, zone.minX + 1) : zone.maxX,
                        minY: zoneDrag.corner.includes("s") ? Math.min(next.y, zone.maxY - 1) : zone.minY,
                        maxY: zoneDrag.corner.includes("n") ? Math.max(next.y, zone.minY + 1) : zone.maxY,
                    };
                    this.onZoneResize(zoneDrag.index, bounds);
                    moved = true;
                }
                return;
            }
            const deltaX = event.clientX - startX;
            const deltaY = event.clientY - startY;
            moved ||= Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4;
            this.centerX = originX - deltaX / this.pixelsPerTile;
            this.centerY = originY + deltaY / this.pixelsPerTile;
            this.clampRawCenter();
        }, { signal });
        const release = (event: PointerEvent) => {
            if (!dragging) return;
            dragging = false;
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
            if (choosingFootprint) {
                if (footprintStart) {
                    const end = footprintTile(event.offsetX, event.offsetY);
                    this.footprint = event.type === "pointerup" && end ? selectionTo(footprintStart, end, combiningDrag) : lastSelection;
                    updateFootprint();
                }
                footprintStart = undefined;
                hoverRegion(event.offsetX, event.offsetY);
                canvas.style.cursor = panFootprint ? "grab" : "crosshair";
                return;
            }
            if (this.plotting && this.plotStart && this.plotEnd) {
                if (event.type === "pointerup" && moved) this.onNewZone({
                    minX: Math.max(0, Math.min(this.plotStart.x, this.plotEnd.x)),
                    maxX: Math.min(WORLD_COORD_MAX, Math.max(this.plotStart.x, this.plotEnd.x)),
                    minY: Math.max(0, Math.min(this.plotStart.y, this.plotEnd.y)),
                    maxY: Math.min(WORLD_COORD_MAX, Math.max(this.plotStart.y, this.plotEnd.y)),
                }, zoneType.value as EditModeWorldZone["tags"][number]);
                moved = true;
                this.plotStart = undefined;
                this.plotEnd = undefined;
                this.plotting = false;
                newZone.style.background = "#1b1e25";
                canvas.style.cursor = "grab";
            }
            const selected = zoneDrag?.index ?? this.zoneAt(event.offsetX, event.offsetY);
            zoneDrag = undefined;
            canvas.style.cursor = this.plotting || chooseRegion ? "crosshair" : this.zoneCursorAt(event.offsetX, event.offsetY);
            if (event.type !== "pointerup") return;
            if (!moved && chooseRegion) {
                const pick = regionTarget(event.offsetX, event.offsetY);
                if (!pick) return;
                this.close();
                actions?.createRegion?.(pick.target);
            } else if (!moved && (selected !== undefined || this.mode === "zones")) this.setSelectedZone(selected);
            else if (!moved) this.navigate(event.offsetX, event.offsetY);
        };
        canvas.addEventListener("pointerup", release, { signal });
        canvas.addEventListener("pointercancel", release, { signal });
        const zoomAt = (factor: number, x: number, y: number) => {
            const zoom = Math.max(MIN_MAP_ZOOM, Math.min(8, this.pixelsPerTile * factor));
            const scaleDelta = 1 / this.pixelsPerTile - 1 / zoom;
            this.centerX += (x - canvas.width / 2) * scaleDelta;
            this.centerY -= (y - canvas.height / 2) * scaleDelta;
            this.pixelsPerTile = zoom;
            this.clampRawCenter();
        };
        canvas.addEventListener("wheel", (event) => {
            event.preventDefault();
            zoomAt(event.deltaY < 0 ? 1.25 : 0.8, event.offsetX, event.offsetY);
            hoverRegion(event.offsetX, event.offsetY);
        }, { passive: false, signal });
        if (this.mode === "navigate" || choosingFootprint) canvas.addEventListener("keydown", (event) => {
            const step = 48 / this.pixelsPerTile;
            const x = canvas.width / 2, y = canvas.height / 2;
            switch (event.key) {
                case "ArrowLeft": this.centerX -= step; break;
                case "ArrowRight": this.centerX += step; break;
                case "ArrowUp": this.centerY += step; break;
                case "ArrowDown": this.centerY -= step; break;
                case "+": case "=": zoomAt(1.25, x, y); break;
                case "-": zoomAt(0.8, x, y); break;
                case "Enter": {
                    if (!choosingFootprint) this.navigate(x, y);
                    else {
                        const tile = footprintTile(x, y);
                        if (tile) {
                            if (!event.shiftKey || !selectionAnchor || layerAt(selectionAnchor.tileY) !== layerAt(tile.tileY)) selectionAnchor = tile;
                            lastSelection = this.footprint;
                            this.footprint = selectionTo(selectionAnchor, tile, combineFootprint || event.ctrlKey || event.metaKey);
                            updateFootprint();
                        }
                    }
                    break;
                }
                default: return;
            }
            this.clampRawCenter();
            if (choosingFootprint) hoverRegion(x, y);
            event.preventDefault();
        }, { signal });
        panel.addEventListener("keydown", (event) => {
            if (event.ctrlKey || event.metaKey || event.altKey ||
                (event.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
            const step = 48 / this.pixelsPerTile;
            switch (event.code) {
                case "KeyA": this.centerX -= step; break;
                case "KeyD": this.centerX += step; break;
                case "KeyW": this.centerY += step; break;
                case "KeyS": this.centerY -= step; break;
                default: return;
            }
            this.clampRawCenter();
            this.regionPreview = undefined;
            event.preventDefault();
        }, { signal });
        window.addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            const target = event.target as HTMLElement | null;
            if (this.mode && (event.defaultPrevented || target?.closest?.('[data-map-editor="tool-finder"]'))) return;
            event.preventDefault();
            if (this.mode) event.stopPropagation();
            this.close();
        }, { capture: true, signal });
        this.draw();
    }

    private clampRawCenter(): void {
        if (!this.rawLayer) return;
        this.centerX = Math.max(0, Math.min(WORLD_COORD_MAX, this.centerX));
        this.centerY = this.rawLayer === "surface"
            ? Math.max(0, Math.min(CAVE_OFFSET - 1, this.centerY))
            : Math.max(CAVE_OFFSET, Math.min(WORLD_COORD_MAX, this.centerY));
    }

    private createNavigation(signal: AbortSignal, onViewChange: () => void): HTMLElement {
        const row = document.createElement("div");
        Object.assign(row.style, { display: "flex", flexWrap: "wrap", gap: "6px 12px", marginBottom: "9px" });
        const layer = document.createElement("select");
        const places = document.createElement("select");
        const floor = document.createElement("select");
        const rawCenters = new Map<RawMapLayer, { x: number; y: number }>();
        const controlStyle = {
            color: "#e5e7eb", background: "#1b1e25", border: "1px solid #ffffff33",
            borderRadius: "4px", padding: "4px 6px", font: "inherit",
        };
        const field = (title: string, control: HTMLSelectElement) => {
            const label = document.createElement("label");
            control.setAttribute("aria-label", title);
            label.append(`${title} `, control);
            Object.assign(control.style, controlStyle, { marginLeft: "2px", maxWidth: "min(220px, 48vw)" });
            return label;
        };
        const layerField = field("Map layer", layer);
        const landmarksField = field("Landmark", places);
        const floorField = field("Floor", floor);
        layer.add(new Option("Overworld", "surface"));
        layer.add(new Option("Caves and dungeons", "caves"));
        if (this.mode === "navigate") {
            const areas = [...(this.client.worldMapState.areasById?.values() ?? [])].filter((area) => area.externalName)
                .sort((a, b) => a.externalName!.localeCompare(b.externalName!));
            const named = document.createElement("optgroup");
            named.label = "Named map areas";
            for (const area of areas) named.append(new Option(area.externalName, String(area.id)));
            if (areas.length) layer.append(named);
        }
        const updateLandmarks = () => {
            places.replaceChildren(new Option("Choose a landmark", ""));
            if (this.rawLayer) {
                for (const [name, x, y] of MAP_LANDMARKS[this.rawLayer]) places.add(new Option(name, `${x},${y}`));
            }
            landmarksField.hidden = !this.rawLayer;
            floorField.hidden = !this.rawLayer || this.mode === "footprint";
        };
        const updateView = () => {
            this.clampRawCenter();
            this.regionPreview = undefined;
            this.plotStart = this.plotEnd = undefined;
            this.setSelectedZone(undefined);
            updateLandmarks();
            onViewChange();
        };
        layer.value = this.rawLayer ?? "";
        layer.addEventListener("change", () => {
            const previousLayer = this.rawLayer;
            const previousCenter = { x: this.centerX, y: this.centerY };
            if (previousLayer) rawCenters.set(previousLayer, previousCenter);
            if (layer.value === "surface" || layer.value === "caves") {
                this.restoreMapState();
                const reference = previousLayer ? previousCenter : this.anchorTile && {
                    x: this.anchorTile.tileX, y: this.anchorTile.tileY,
                };
                const saved = rawCenters.get(layer.value);
                const referenceY = reference?.y ?? 3218;
                const offset = layerAt(referenceY) === layer.value ? 0 : layer.value === "caves" ? CAVE_OFFSET : -CAVE_OFFSET;
                this.centerX = saved?.x ?? reference?.x ?? 3222;
                this.centerY = saved?.y ?? referenceY + offset;
                this.rawLayer = layer.value;
            } else {
                const state = this.client.worldMapState;
                this.rememberMapState();
                this.rawLayer = undefined;
                state.setCurrentMapAreaId(Number(layer.value));
                this.centerX = state.displayX;
                this.centerY = state.displayY;
            }
            updateView();
        }, { signal });
        places.addEventListener("change", () => {
            if (!places.value) return;
            [this.centerX, this.centerY] = places.value.split(",").map(Number);
            places.value = "";
            this.regionPreview = undefined;
            this.setSelectedZone(undefined);
        }, { signal });
        for (let plane = 0; plane < 4; plane++) floor.add(new Option(plane === 0 ? "Ground" : String(plane), String(plane)));
        floor.value = String(this.floor);
        floor.addEventListener("change", () => { this.floor = Number(floor.value); }, { signal });
        const center = document.createElement("button");
        center.type = "button";
        center.textContent = "Center on editor";
        Object.assign(center.style, controlStyle, { cursor: "pointer" });
        center.addEventListener("click", () => {
            const anchor = this.anchorTile;
            if (!anchor) return;
            this.restoreMapState();
            this.rawLayer = layerAt(anchor.tileY);
            this.centerX = anchor.tileX;
            this.centerY = anchor.tileY;
            this.floor = this.mode === "footprint" ? 0 : anchor.plane;
            layer.value = this.rawLayer;
            floor.value = String(this.floor);
            updateView();
        }, { signal });
        row.append(layerField, landmarksField, floorField, center);
        updateView();
        return row;
    }

    private navigate(screenX: number, screenY: number): void {
        const tile = this.worldTileAt(screenX, screenY);
        if (!tile) return;
        if (this.rawLayer && layerAt(tile.y) !== this.rawLayer) return;
        const coord = this.rawLayer ? { ...tile, plane: this.floor } : this.client.worldMapState.currentArea?.coord(tile.x, tile.y);
        if (!coord || coord.x < 0 || coord.y < 0 || coord.x > WORLD_COORD_MAX || coord.y > WORLD_COORD_MAX) return;
        this.close();
        this.onNavigate({ tileX: coord.x, tileY: coord.y, plane: coord.plane });
    }

    private worldTileAt(screenX: number, screenY: number): { x: number; y: number } | undefined {
        const canvas = this.canvas;
        if (!canvas) return undefined;
        return {
            x: Math.floor(this.centerX + (screenX - canvas.width / 2) / this.pixelsPerTile),
            y: Math.floor(this.centerY - (screenY - canvas.height / 2) / this.pixelsPerTile),
        };
    }

    private zoneHandleAt(screenX: number, screenY: number): { index: number; corner: "nw" | "ne" | "sw" | "se" } | undefined {
        if (!this.canEditZones) return undefined;
        const canvas = this.canvas;
        const visible = this.visibleZones();
        if (!canvas || !visible) return undefined;
        const corners = (zone: EditModeBoundedWorldZone) => [
            ["nw", zone.minX, zone.maxY + 1], ["ne", zone.maxX + 1, zone.maxY + 1],
            ["sw", zone.minX, zone.minY], ["se", zone.maxX + 1, zone.minY],
        ] as const;
        for (let index = 0; index < visible.zones.length; index++) {
            const zone = visible.zones[index];
            if (zone.minX === undefined) continue;
            if (!zoneColor(visible, zone)) continue;
            for (const [corner, x, y] of corners(zone)) {
                const px = canvas.width / 2 + (x - this.centerX) * this.pixelsPerTile;
                const py = canvas.height / 2 - (y - this.centerY) * this.pixelsPerTile;
                if (Math.hypot(screenX - px, screenY - py) <= 9) return { index, corner };
            }
        }
        return undefined;
    }

    private zoneAt(screenX: number, screenY: number): number | undefined {
        if (!this.canEditZones) return undefined;
        const tile = this.worldTileAt(screenX, screenY);
        const visible = this.visibleZones();
        if (!tile || !visible) return undefined;
        for (let index = visible.zones.length - 1; index >= 0; index--) {
            const zone = visible.zones[index];
            if (zone.minX === undefined) continue;
            if (zoneColor(visible, zone) && tile.x >= zone.minX && tile.x <= zone.maxX && tile.y >= zone.minY && tile.y <= zone.maxY) return index;
        }
        return undefined;
    }

    private setSelectedZone(index: number | undefined): void {
        this.selectedZoneIndex = index;
        const zone = index === undefined ? undefined : this.getZones()?.zones[index];
        if (this.zoneTypeSelect) {
            this.zoneTypeSelect.style.display = this.canEditZones ? "inline-block" : "none";
            if (zone) this.zoneTypeSelect.value = ZONE_TYPE_LABELS.find(([tag]) => zone.tags.includes(tag))?.[0] ?? "pvp";
        }
        if (this.deleteZoneButton) this.deleteZoneButton.style.display = zone ? "inline-block" : "none";
    }

    private zoneCursorAt(screenX: number, screenY: number): string {
        if (this.mode) {
            const handle = this.zoneHandleAt(screenX, screenY);
            if (!handle) return "grab";
            return handle.corner === "nw" || handle.corner === "se" ? "nwse-resize" : "nesw-resize";
        }
        const canvas = this.canvas;
        const visible = this.visibleZones();
        if (!canvas || !visible) return "grab";
        for (const zone of visible.zones) {
            if (zone.minX === undefined) continue;
            if (!zoneColor(visible, zone)) continue;
            const left = canvas.width / 2 + (zone.minX - this.centerX) * this.pixelsPerTile;
            const right = canvas.width / 2 + (zone.maxX + 1 - this.centerX) * this.pixelsPerTile;
            const top = canvas.height / 2 - (zone.maxY + 1 - this.centerY) * this.pixelsPerTile;
            const bottom = canvas.height / 2 - (zone.minY - this.centerY) * this.pixelsPerTile;
            const edge = 8;
            const nearLeft = Math.abs(screenX - left) <= edge;
            const nearRight = Math.abs(screenX - right) <= edge;
            const nearTop = Math.abs(screenY - top) <= edge;
            const nearBottom = Math.abs(screenY - bottom) <= edge;
            const onVertical = (nearLeft || nearRight) && screenY >= top - edge && screenY <= bottom + edge;
            const onHorizontal = (nearTop || nearBottom) && screenX >= left - edge && screenX <= right + edge;
            if (onVertical && onHorizontal) {
                return (nearLeft && nearTop) || (nearRight && nearBottom) ? "nwse-resize" : "nesw-resize";
            }
            if (onVertical) return "ew-resize";
            if (onHorizontal) return "ns-resize";
        }
        return "grab";
    }

    private draw = (): void => {
        const canEditZones = this.canEditZones;
        if (this.newZoneButton) this.newZoneButton.style.display = canEditZones ? "inline-block" : "none";
        if (this.zoneTypeSelect) this.zoneTypeSelect.style.display = canEditZones ? "inline-block" : "none";
        const canvas = this.canvas;
        const context = this.context;
        const area = this.client.worldMapState.currentArea;
        if (!canvas || !context || (!area && !this.rawLayer)) return;
        const bounds = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(bounds.width));
        const height = Math.max(1, Math.floor(bounds.height));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        context.fillStyle = "#090b0f";
        context.fillRect(0, 0, width, height);
        const layer = this.rawLayer;
        const minMapY = layer === "caves" ? CAVE_OFFSET / 64 : 0;
        const maxMapY = layer === "surface" ? CAVE_OFFSET / 64 - 1 : WORLD_COORD_MAX >> 6;
        const minX = Math.max(layer ? 0 : area!.regionLowX, Math.floor((this.centerX - width / this.pixelsPerTile / 2) / 64));
        const maxX = Math.min(layer ? WORLD_COORD_MAX >> 6 : area!.regionHighX, Math.floor((this.centerX + width / this.pixelsPerTile / 2) / 64));
        const minY = Math.max(layer ? minMapY : area!.regionLowY, Math.floor((this.centerY - height / this.pixelsPerTile / 2) / 64));
        const maxY = Math.min(layer ? maxMapY : area!.regionHighY, Math.floor((this.centerY + height / this.pixelsPerTile / 2) / 64));
        const size = 64 * this.pixelsPerTile;
        const loading: { mapX: number; mapY: number }[] = [];
        const overview = this.pixelsPerTile < 0.30;
        const visibleRawTiles = new Set<string>();
        for (let mapX = minX; mapX <= maxX; mapX++) {
            for (let mapY = minY; mapY <= maxY; mapY++) {
                const x = Math.round(width / 2 + (mapX * 64 - this.centerX) * this.pixelsPerTile);
                const y = Math.round(height / 2 - ((mapY + 1) * 64 - this.centerY) * this.pixelsPerTile);
                if (layer) {
                    const key = `${mapX}:${mapY}:${this.floor}`;
                    visibleRawTiles.add(key);
                    const image = this.rawTiles.get(key);
                    if (image) context.drawImage(image, x, y, size, size);
                    else {
                        const id = (mapX << 8) | mapY;
                        const hasTerrain = this.isOccupied?.(id) ?? true;
                        const occupied = hasTerrain || this.occupiedSquares?.has(id);
                        if (hasTerrain && !overview && !this.rawTiles.has(key) && !this.rawPending.has(key)) loading.push({ mapX, mapY });
                        if (occupied && (overview || this.mode === "footprint")) {
                            context.fillStyle = "#374151";
                            context.fillRect(x, y, size, size);
                        }
                        context.strokeStyle = "rgba(148,163,184,0.13)";
                        context.strokeRect(x, y, size, size);
                    }
                    continue;
                }
                const tile = this.client.getWorldMapImageTile(mapX, mapY, 0, 1);
                const key = `${area!.id}:${mapX}:${mapY}`;
                const cachedCanvas = this.tileCanvases.get(key);
                const pixels = tile?.pixels;
                // The shared world-map cache may release pixel buffers after the
                // normal map renderer uploads them. Keep the editor's canvas
                // snapshot visible while that happens (and while a tile reloads).
                if (!tile || !pixels) {
                    if (cachedCanvas) {
                        context.drawImage(cachedCanvas, x, y, 64 * this.pixelsPerTile, 64 * this.pixelsPerTile);
                        continue;
                    }
                    context.strokeStyle = "rgba(148,163,184,0.13)";
                    context.strokeRect(x, y, 64 * this.pixelsPerTile, 64 * this.pixelsPerTile);
                    continue;
                }
                context.drawImage(this.getTileCanvas(key, { ...tile, pixels }), x, y, 64 * this.pixelsPerTile, 64 * this.pixelsPerTile);
            }
        }
        const distance = ({ mapX, mapY }: { mapX: number; mapY: number }) =>
            Math.abs(mapX * 64 + 32 - this.centerX) + Math.abs(mapY * 64 + 32 - this.centerY);
        loading.sort((a, b) => distance(a) - distance(b));
        if (loading.length) {
            for (const key of this.rawTiles.keys()) {
                if (this.rawTiles.size + this.rawPending.size < MAX_RAW_TILES) break;
                if (!visibleRawTiles.has(key)) this.rawTiles.delete(key);
            }
            const slots = Math.min(3 - this.rawPending.size, MAX_RAW_TILES - this.rawTiles.size - this.rawPending.size);
            for (const { mapX, mapY } of loading.slice(0, Math.max(0, slots))) this.requestRawTile(mapX, mapY, this.floor);
        }
        const visible = layer || !this.mode ? this.visibleZones() : undefined;
        if (visible) {
            for (let index = 0; index < visible.zones.length; index++) {
                const zone = visible.zones[index];
                if (zone.minX === undefined) continue;
                const color = zoneColor(visible, zone);
                if (!color) continue;
                const x = width / 2 + (zone.minX - this.centerX) * this.pixelsPerTile;
                const y = height / 2 - (zone.maxY + 1 - this.centerY) * this.pixelsPerTile;
                const w = (zone.maxX - zone.minX + 1) * this.pixelsPerTile;
                const h = (zone.maxY - zone.minY + 1) * this.pixelsPerTile;
                context.fillStyle = `${color}33`;
                context.fillRect(x, y, w, h);
                context.strokeStyle = color;
                context.lineWidth = index === this.selectedZoneIndex ? 4 : 2;
                context.strokeRect(x, y, w, h);
                if (canEditZones) {
                    for (const [cornerX, cornerY] of [[zone.minX, zone.maxY + 1], [zone.maxX + 1, zone.maxY + 1], [zone.minX, zone.minY], [zone.maxX + 1, zone.minY]]) {
                        context.fillRect(width / 2 + (cornerX - this.centerX) * this.pixelsPerTile - 3, height / 2 - (cornerY - this.centerY) * this.pixelsPerTile - 3, 6, 6);
                    }
                }
            }
        }
        if (this.anchorTile && (layer ? this.anchorTile.plane === this.floor : !this.mode)) {
            context.fillStyle = "#a855f7";
            context.beginPath();
            context.arc(width / 2 + (this.anchorTile.tileX + 0.5 - this.centerX) * this.pixelsPerTile, height / 2 - (this.anchorTile.tileY + 0.5 - this.centerY) * this.pixelsPerTile, 5, 0, Math.PI * 2);
            context.fill();
        }
        if (this.plotStart && this.plotEnd) {
            const x = width / 2 + (Math.min(this.plotStart.x, this.plotEnd.x) - this.centerX) * this.pixelsPerTile;
            const y = height / 2 - (Math.max(this.plotStart.y, this.plotEnd.y) + 1 - this.centerY) * this.pixelsPerTile;
            context.strokeStyle = ZONE_COLORS[this.zoneTypeSelect?.value ?? ""] ?? ZONE_COLORS["multi-combat"];
            context.setLineDash([5, 4]);
            context.strokeRect(x, y, (Math.abs(this.plotEnd.x - this.plotStart.x) + 1) * this.pixelsPerTile, (Math.abs(this.plotEnd.y - this.plotStart.y) + 1) * this.pixelsPerTile);
            context.setLineDash([]);
        }
        if (this.footprint && layerAt(this.footprint.y) === layer) {
            const { x: left, y: bottom, width: spanX, height: spanY, regions } = this.footprint;
            const rect = (x: number, y: number, w: number, h: number) => {
                const screenX = width / 2 + (x - this.centerX) * this.pixelsPerTile;
                const screenY = height / 2 - (y + h - this.centerY) * this.pixelsPerTile;
                context.fillRect(screenX, screenY, w * this.pixelsPerTile, h * this.pixelsPerTile);
                context.strokeRect(screenX, screenY, w * this.pixelsPerTile, h * this.pixelsPerTile);
            };
            context.fillStyle = this.footprintError ? "#ef444444" : "#4ade8044";
            context.strokeStyle = this.footprintError ? "#f87171" : "#86efac";
            context.lineWidth = 2;
            if (regions.length) {
                for (const id of regions) rect((id >> 8) * 64, (id & 255) * 64, 64, 64);
            } else rect(left, bottom, spanX, spanY);
            context.lineWidth = 1;
        }
        if (this.regionPreview) {
            const size = 64 * this.pixelsPerTile;
            const x = width / 2 + (this.regionPreview.x - this.centerX) * this.pixelsPerTile;
            const y = height / 2 - (this.regionPreview.y + 64 - this.centerY) * this.pixelsPerTile;
            context.fillStyle = "rgba(96,165,250,0.2)";
            context.fillRect(x, y, size, size);
            context.strokeStyle = "#60a5fa";
            context.lineWidth = 2;
            context.strokeRect(x, y, size, size);
            context.lineWidth = 1;
        }
        if ((this.mode === "navigate" || this.mode === "footprint") && document.activeElement === canvas) {
            context.fillStyle = "#e5e7eb";
            context.fillRect(width / 2 - 5, height / 2 - 0.5, 10, 1);
            context.fillRect(width / 2 - 0.5, height / 2 - 5, 1, 10);
        }
        this.animationFrame = requestAnimationFrame(this.draw);
    };

    private requestRawTile(mapX: number, mapY: number, plane: number): void {
        if (!this.loadRawTile) return;
        const key = `${mapX}:${mapY}:${plane}`;
        const pending = this.rawPending;
        pending.add(key);
        void this.loadRawTile(mapX, mapY, plane).then(async (blob) => {
            if (!blob || pending !== this.rawPending) return undefined;
            const image = new Image();
            const url = URL.createObjectURL(blob);
            try {
                image.src = url;
                await image.decode();
                return image;
            } finally {
                URL.revokeObjectURL(url);
            }
        }).catch(() => undefined).then((image) => {
            if (pending !== this.rawPending) return;
            this.rawTiles.set(key, image);
        }).finally(() => pending.delete(key));
    }

    private getTileCanvas(key: string, tile: { pixels: Uint8Array; width: number; height: number }): HTMLCanvasElement {
        const cached = this.tileCanvases.get(key);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = tile.width;
        canvas.height = tile.height;
        canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(tile.pixels), tile.width, tile.height), 0, 0);
        this.tileCanvases.set(key, canvas);
        while (this.tileCanvases.size > MAX_TILE_CANVASES) this.tileCanvases.delete(this.tileCanvases.keys().next().value!);
        return canvas;
    }
}
