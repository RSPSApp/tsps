import { quarterTurnToDirection } from "../../../common/Direction";
import { OBJECT_SPAWNS_MESSAGE, formatObjectSpawns } from "./hostProtocol/objectSpawnsMessage";
import FileSaver from "file-saver";
import {
    REGION_PACK_MESSAGE,
} from "./hostProtocol/regionPackMessage";
import { browserHostOrigin, browserHostWindow } from "./hostProtocol/origin";
import type { EditModePlugin } from "./EditModePlugin";
import { EditorPalette, type PaletteMode } from "./EditorPalette";
import {
    createCameraIcon,
    createConfigIcon,
    EditorToolbar,
    EDITOR_TOP_BAR_CLEARANCE,
    EDITOR_TOP_BAR_HEIGHT,
    showEditorTooltip,
    type EditorTool,
    createCloseIcon,
    createDuplicateIcon,
    createMoveIcon,
    createDownloadIcon,
    createLayersIcon,
    createOverlayIcon,
    createPathIcon,
    createPaintIcon,
    createPointerIcon,
    createRotateIcon,
    createRefreshIcon,
    createNpcIcon,
    createObjectIcon,
    createSaveIcon,
    createSpawnIcon,
    createTrashIcon,
    createWorldMapIcon,
    createOverlayShapeIcon,
    createRedoIcon,
    createUndoIcon,
} from "./EditorToolbar";
import { getOverlayShapeTriangles } from "../../../rs/scene/SceneTileModel";
import { OVERLAY_SHAPE_COUNT } from "./EditModePlugin";
import { regionIdOf } from "./EditorCoordinates";
import { MAX_REGION_PACK_PAYLOAD, oversizedRegionPacks } from "./RegionPack";
import type { TileCorner } from "./TerrainHeight";
import { WORLD_DEFINITION_MESSAGE } from "./hostProtocol/worldDefinitionMessage";
import { CUSTOM_NPC_SPAWNS_MESSAGE, formatCustomNpcSpawns } from "./hostProtocol/npcSpawnMessage";
import type {
    EditModeDefinitionSummary,
    EditModeOverlaySwatch,
    EditModeSearchKind,
} from "./types";
import { BUILDING_SHAPES, BUILDING_STYLES, type BuildingShape, type BuildingStyle } from "./BuildingGenerator";

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

const TOP_BAR_HEIGHT = EDITOR_TOP_BAR_HEIGHT;
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
    Object.assign(panel.style, PANEL_STYLE, { left: "62px", top: "112px", width });
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
    const close = document.createElement("button");
    close.type = "button";
    close.title = `Close ${titleText.toLowerCase()}`;
    close.setAttribute("aria-label", close.title);
    close.appendChild(createCloseIcon());
    Object.assign(close.style, {
        width: "24px",
        height: "24px",
        display: "grid",
        placeItems: "center",
        padding: "0",
        border: "0",
        color: "#aeb8c8",
        background: "transparent",
        cursor: "pointer",
    });
    close.addEventListener("click", onClose);
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

class EditorChrome {
    private readonly toolbar: EditorToolbar;
    private readonly palette: EditorPalette;
    private readonly selectionDetails: HTMLDivElement;
    private readonly topBar: HTMLDivElement;
    private readonly heightInput: HTMLInputElement;
    private readonly renderAllInput: HTMLInputElement;
    private readonly mapIconsInput: HTMLInputElement;
    private readonly saveObjectSpawnsInput: HTMLInputElement;
    private readonly settingsContent: HTMLDivElement;
    private settingsDrawer?: HTMLElement;
    private readonly pvpZonesInput: HTMLInputElement;
    private readonly duelZonesInput: HTMLInputElement;
    private readonly safeZonesInput: HTMLInputElement;
    private readonly f2pZonesInput: HTMLInputElement;
    private readonly multiCombatZonesInput: HTMLInputElement;
    private readonly unsubscribe: () => void;
    private readonly canvasShell?: HTMLElement;
    private readonly previousCanvasTop: string;
    private detailPanel?: HTMLElement;
    private overlayPalette?: HTMLElement;
    private saveButton?: HTMLButtonElement;
    private saveTooltip?: HTMLDivElement;
    /** Custom NPC spawns stay in the edit list after saving, so compare against the last save. */
    private savedNpcSpawnsKey = "";
    private overlaySwatches: readonly EditModeOverlaySwatch[] = [];
    private selectionImage?: { key: string; dataUrl: string; loading: boolean };
    private buildingStyle: BuildingStyle = "Varrock";
    private buildingShape: BuildingShape = "Rectangle";
    private heightStep = 4;
    private heightSmoothing = 2;
    private overlayShapePicker?: HTMLElement;
    private buildingFloors = 1;
    private lastVersion = -1;

    constructor(private readonly plugin: EditModePlugin) {
        this.overlaySwatches = plugin.getOverlaySwatches();
        this.palette = new EditorPalette({
            onModeChange: (mode) => this.search(mode),
            onQueryChange: (query) => this.plugin.searchCache(query, this.currentSearchMode()),
            onPick: (id) => this.pickSearchResult(id),
            onInspect: (id) => this.showDefinition(this.currentSearchMode(), id),
        });

        const tools: EditorTool[] = [
            { id: "select", label: "Selection tool", icon: createPointerIcon },
            {
                id: "search-npcs",
                label: "NPCs",
                icon: createNpcIcon,
                action: () => this.toggleSearch("npc"),
            },
            {
                id: "search-objects",
                label: "Objects",
                icon: createObjectIcon,
                action: () => this.toggleSearch("loc"),
            },
            {
                id: "overlay",
                label: "Choose overlay",
                icon: () => this.createOverlaySwatchIcon(plugin.getConfig().overlayId),
                action: () => this.toggleOverlayPalette(),
            },
            { id: "terrain", label: "Paint tiles (R rotates the shape)", icon: createPaintIcon },
            { id: "path", label: "Draw path", icon: createPathIcon },
            {
                id: "undo",
                label: "Undo (Ctrl+Z)",
                icon: createUndoIcon,
                action: () => {
                    if (!this.plugin.undo()) this.toast("Nothing to undo");
                },
            },
            {
                id: "redo",
                label: "Redo (Ctrl+Y)",
                icon: createRedoIcon,
                action: () => {
                    if (!this.plugin.redo()) this.toast("Nothing to redo");
                },
            },
            {
                id: "world-map",
                label: "World map",
                icon: createWorldMapIcon,
                action: () => this.toggleWorldMap(),
            },
            {
                id: "refresh-map",
                label: "Refresh map",
                icon: createRefreshIcon,
                action: () => {
                    this.plugin.refreshMap();
                    this.toast("Refreshing map...");
                },
            },
            {
                id: "settings",
                label: "Editor settings",
                icon: createConfigIcon,
                action: () => this.toggleSettings(),
            },
        ];
        // Saving goes to the host via the top bar; standalone edits download as files here.
        if (!browserHostWindow()) {
            tools.push({
                id: "export-region",
                label: "Download world and map edits",
                icon: createDownloadIcon,
                dividerBefore: true,
                action: () => this.exportRegions(),
            });
        }
        this.toolbar = new EditorToolbar(
            tools,
            "select",
            (toolId) =>
                this.plugin.setConfig({
                    tool: toolId === "path" || toolId === "terrain" ? toolId : "select",
                }),
        );

        this.selectionDetails = document.createElement("div");
        this.selectionDetails.dataset.mapEditor = "selection-details";
        Object.assign(this.selectionDetails.style, PANEL_STYLE, {
            right: "12px",
            top: TOP_BAR_CLEARANCE,
            left: "auto",
            width: "270px",
            display: "none",
            borderColor: "rgba(96,165,250,0.5)",
            background: "rgba(18,20,24,0.9)",
        });
        stopClientInput(this.selectionDetails);
        document.body.appendChild(this.selectionDetails);

        this.topBar = document.createElement("div");
        this.topBar.dataset.mapEditor = "top-bar";
        Object.assign(this.topBar.style, {
            position: "absolute",
            left: "0",
            right: "0",
            top: "0",
            height: `${TOP_BAR_HEIGHT}px`,
            zIndex: "10001",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px 12px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.16)",
            color: "#eef4ff",
            background: "#121418",
            font: "13px sans-serif",
        });
        stopClientInput(this.topBar);

        const heightLabel = document.createElement("span");
        heightLabel.textContent = "HL:";
        heightLabel.title = "Height/Level";
        const decrement = this.createHeightButton("−", -1);
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
        const increment = this.createHeightButton("+", 1);
        const coordinates = document.createElement("span");
        coordinates.title = "Tile under the pointer: x, y, level, and its map region";
        Object.assign(coordinates.style, { minWidth: "170px", marginLeft: "8px", color: "#cbd5e1", whiteSpace: "nowrap" });
        this.plugin.setPointerTileListener((tile) => {
            coordinates.textContent = tile
                ? `${tile.tileX}, ${tile.tileY}, ${tile.plane} · Region ${regionIdOf(tile.tileX, tile.tileY)}`
                : "";
        });
        const goTo = document.createElement("input");
        goTo.type = "text";
        goTo.placeholder = "Go to x, y or region";
        goTo.title = "Enter x, y, x, y, level or a region id, then press Enter";
        goTo.setAttribute("aria-label", "Go to coordinates or region");
        Object.assign(goTo.style, INPUT_STYLE, { width: "130px", minWidth: "0", height: "28px", padding: "3px 6px" });
        goTo.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (this.plugin.goToLocation(goTo.value)) goTo.blur();
            else this.toast("Enter x, y, x, y, level or a region id");
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
        renderAllLabel.title = "Defaults on at HL 0 and off above it. Hover inside a building at HL 0 to reveal its contents.";
        this.renderAllInput.addEventListener("change", () =>
            this.plugin.setConfig({ renderAllHeightLevels: this.renderAllInput.checked }),
        );
        renderAllLabel.prepend(this.renderAllInput);
        const mapIconsLabel = document.createElement("label");
        Object.assign(mapIconsLabel.style, {
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginLeft: "8px",
            cursor: "pointer",
        });
        mapIconsLabel.append("Show map icons");
        this.mapIconsInput = document.createElement("input");
        this.mapIconsInput.type = "checkbox";
        this.mapIconsInput.addEventListener("change", () =>
            this.plugin.setConfig({ showMapIcons: this.mapIconsInput.checked }),
        );
        mapIconsLabel.prepend(this.mapIconsInput);
        this.settingsContent = document.createElement("div");
        const saveObjectsLabel = document.createElement("label");
        this.saveObjectSpawnsInput = document.createElement("input");
        this.saveObjectSpawnsInput.type = "checkbox";
        this.saveObjectSpawnsInput.addEventListener("change", () =>
            this.plugin.setConfig({ saveObjectSpawns: this.saveObjectSpawnsInput.checked }),
        );
        saveObjectsLabel.append(this.saveObjectSpawnsInput, "Save objects to object-spawns.json");
        for (const label of [...(browserHostWindow() ? [saveObjectsLabel] : []), renderAllLabel, mapIconsLabel]) {
            Object.assign(label.style, { display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", alignItems: "start", columnGap: "12px", margin: "14px 0", lineHeight: "20px", cursor: "pointer" });
            const input = label.querySelector("input")!;
            Object.assign(input.style, { width: "16px", height: "16px", margin: "2px 0 0" });
            this.settingsContent.appendChild(label);
        }
        const zoneToggle = (
            text: string,
            color: string,
            change: (checked: boolean) => void,
        ): HTMLInputElement => {
            const label = document.createElement("label");
            Object.assign(label.style, {
                display: "grid",
                gridTemplateColumns: "16px minmax(0, 1fr)",
                alignItems: "start",
                columnGap: "12px",
                margin: "14px 0",
                lineHeight: "20px",
                color,
                cursor: "pointer",
            });
            const input = document.createElement("input");
            input.type = "checkbox";
            input.setAttribute("aria-label", `Show ${text} zones`);
            input.addEventListener("change", () => change(input.checked));
            Object.assign(input.style, { width: "16px", height: "16px", margin: "2px 0 0" });
            label.append(input, `${text} zones`);
            this.settingsContent.appendChild(label);
            return input;
        };
        this.pvpZonesInput = zoneToggle("PvP", "#fca5a5", (checked) =>
            this.plugin.setConfig({ showPvpZones: checked }),
        );
        this.multiCombatZonesInput = zoneToggle("Multi", "#fcd34d", (checked) =>
            this.plugin.setConfig({ showMultiCombatZones: checked }),
        );
        this.duelZonesInput = zoneToggle("Duel", "#c4b5fd", (checked) =>
            this.plugin.setConfig({ showDuelZones: checked }),
        );
        this.safeZonesInput = zoneToggle("Safe", "#86efac", (checked) =>
            this.plugin.setConfig({ showSafeZones: checked }),
        );
        this.f2pZonesInput = zoneToggle("F2P", "#93c5fd", (checked) =>
            this.plugin.setConfig({ showF2pZones: checked }),
        );
        this.topBar.append(
            heightLabel,
            decrement,
            this.heightInput,
            increment,
            coordinates,
            goTo,
            createCompactButton("Select region", "Select the whole 64 x 64 region", () => this.plugin.selectRegion()),
        );
        this.savedNpcSpawnsKey = this.npcSpawnsKey();
        if (browserHostWindow()) {
            const save = document.createElement("button");
            save.type = "button";
            save.setAttribute("aria-label", "Save world and map edits");
            save.replaceChildren(createSaveIcon(), document.createTextNode("Save changes"));
            Object.assign(save.style, {
                height: "28px",
                padding: "0 12px 0 16px",
                flexShrink: "0",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                border: "1px solid #8b7138",
                borderRadius: "4px",
                color: "#f3db9b",
                background: "#3c321f",
                cursor: "pointer",
                font: "13px sans-serif",
            });
            save.addEventListener("click", () => this.exportRegions());
            // A disabled button gets no mouse events, so the tooltip hangs off a wrapper.
            const saveWrapper = document.createElement("span");
            Object.assign(saveWrapper.style, { display: "inline-flex", marginRight: "16px" });
            saveWrapper.append(save);
            const showSaveTooltip = () => {
                this.saveTooltip?.remove();
                this.saveTooltip = showEditorTooltip(saveWrapper,
                    save.disabled ? "No changes to save yet" : "Save world and map edits", "below");
            };
            const hideSaveTooltip = () => {
                this.saveTooltip?.remove();
                this.saveTooltip = undefined;
            };
            saveWrapper.addEventListener("mouseenter", showSaveTooltip);
            saveWrapper.addEventListener("mouseleave", hideSaveTooltip);
            save.addEventListener("focus", showSaveTooltip);
            save.addEventListener("blur", hideSaveTooltip);
            this.saveButton = save;
            this.topBar.prepend(saveWrapper);
        }

        const viewport = document.querySelector<HTMLElement>(".game-viewport");
        this.canvasShell =
            viewport?.querySelector<HTMLElement>(".game-canvas-shell") ?? undefined;
        this.previousCanvasTop = this.canvasShell?.style.top ?? "";
        if (viewport && this.canvasShell) {
            this.canvasShell.style.top = this.topBar.style.height;
            viewport.appendChild(this.topBar);
            requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        }

        document.body.classList.add("map-editor-active");
        this.sync();
        this.unsubscribe = plugin.subscribe(() => this.sync());
        void this.importPersistedNpcSpawns();
    }

    remove(): void {
        document.body.classList.remove("map-editor-active");
        this.unsubscribe();
        this.toolbar.remove();
        this.palette.remove();
        this.selectionDetails.remove();
        this.saveTooltip?.remove();
        this.topBar.remove();
        this.closeSettings();
        if (this.canvasShell) this.canvasShell.style.top = this.previousCanvasTop;
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        this.detailPanel?.remove();
        this.overlayPalette?.remove();
    }

    private currentSearchMode(): EditModeSearchKind {
        return this.plugin.getState().search.kind;
    }

    private createHeightButton(text: string, delta: number): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.title = "Height/Level";
        button.setAttribute("aria-label", `${delta < 0 ? "Decrease" : "Increase"} Height/Level`);
        Object.assign(button.style, {
            width: "28px",
            flexShrink: "0",
            height: "28px",
            padding: "0",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "4px",
            color: "#fff",
            background: "rgba(255,255,255,0.07)",
            cursor: "pointer",
        });
        button.addEventListener("click", () =>
            this.setHeightLevel(this.plugin.getConfig().heightLevel + delta),
        );
        return button;
    }

    private setHeightLevel(level: number): void {
        this.plugin.setConfig({ heightLevel: Math.max(0, Math.min(3, level | 0)) });
    }

    private search(mode: PaletteMode): void {
        if (mode !== "item") this.plugin.setConfig({ placeKind: mode });
        this.plugin.searchCache(this.plugin.getState().search.query, mode);
    }

    private pickSearchResult(id: number): void {
        const mode = this.currentSearchMode();
        if (mode === "item") {
            this.showDefinition(mode, id);
            return;
        }
        this.plugin.setConfig({ placeKind: mode });
        this.plugin.useSearchResult(id);
        this.plugin.setConfig({ tool: "place" });
        this.toolbar.select("cache-search");
        this.palette.setVisible(false);
    }

    /** NPC/Object rail buttons open the search panel on their tab; clicking the open tab's button closes it. */
    private toggleSearch(mode: PaletteMode): void {
        const sameTab = this.currentSearchMode() === mode;
        if (this.palette.isVisible() && sameTab) {
            this.palette.setVisible(false);
            return;
        }
        if (!sameTab) this.search(mode);
        this.palette.setVisible(true);
    }

    private overlayColor(id: number): number {
        return this.overlaySwatches.find((swatch) => swatch.id === id)?.colorRgb ?? 0x64748b;
    }

    private createOverlaySwatchIcon(id: number): SVGElement {
        const color = this.overlayColor(id);
        const textureId = this.overlaySwatches.find((swatch) => swatch.id === id)?.textureId;
        const texture = textureId === undefined ? undefined : this.plugin.getOverlayTexture(textureId);
        const icon = createOverlayIcon(color, texture);
        if (textureId !== undefined && !texture) {
            const retry = (): void => {
                if (!icon.isConnected) return;
                const loaded = this.plugin.getOverlayTexture(textureId);
                if (loaded) icon.replaceChildren(...createOverlayIcon(color, loaded).childNodes);
                else window.setTimeout(retry, 250);
            };
            window.setTimeout(retry, 250);
        }
        return icon;
    }

    private toggleOverlayPalette(): void {
        if (this.overlayPalette) {
            this.overlayPalette.remove();
            this.overlayPalette = undefined;
            this.overlayShapePicker = undefined;
            return;
        }
        this.palette.setVisible(false);
        this.overlaySwatches = this.plugin.getOverlaySwatches();
        const panel = createPanel("overlay-palette", "300px");
        Object.assign(panel.style, {
            top: TOP_BAR_CLEARANCE,
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            zIndex: "10004",
        });
        this.overlayPalette = panel;
        panel.appendChild(createHeader("Choose terrain overlay", () => this.toggleOverlayPalette()));
        const swatches = document.createElement("div");
        Object.assign(swatches.style, {
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "5px",
        });
        const appendSwatch = (id: number, colorRgb: number, name?: string, textureId?: number): void => {
            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.textContent = String(id);
            swatch.title = name ? `Overlay ${id} · ${name}` : `Overlay ${id}`;
            swatch.setAttribute("aria-label", swatch.title);
            Object.assign(swatch.style, {
                height: "38px",
                padding: "0",
                border: `2px solid ${id === this.plugin.getConfig().overlayId ? "#60a5fa" : "rgba(255,255,255,0.2)"}`,
                borderRadius: "4px",
                color: "#fff",
                background: `#${(colorRgb & 0xffffff).toString(16).padStart(6, "0")}`,
                cursor: "pointer",
                font: "11px sans-serif",
                textShadow: "0 1px 2px #000",
            });
            swatch.addEventListener("click", () => {
                this.plugin.setConfig({ overlayId: id });
                this.toggleOverlayPalette();
            });
            swatches.appendChild(swatch);
            if (textureId !== undefined) {
                const showTexture = (): void => {
                    const texture = this.plugin.getOverlayTexture(textureId);
                    if (texture) {
                        swatch.style.backgroundImage = `url("${texture}")`;
                        swatch.style.backgroundSize = "cover";
                    } else {
                        window.setTimeout(() => {
                            if (swatch.isConnected) showTexture();
                        }, 250);
                    }
                };
                showTexture();
            }
        };
        this.overlayShapePicker = this.createOverlayShapePicker();
        panel.appendChild(this.overlayShapePicker);
        appendSwatch(0, 0x27303a, "Clear");
        for (const swatch of this.overlaySwatches) {
            appendSwatch(swatch.id, swatch.colorRgb, swatch.name, swatch.textureId);
        }
        panel.appendChild(swatches);
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
        return JSON.stringify(this.plugin.getConfig().edits
            .filter((edit) => edit.kind === "npc" || edit.kind === "npcDelete" || edit.kind === "npcWander")
            .map((edit) => [edit.kind, edit.locId, edit.tileX, edit.tileY, edit.plane, edit.rotation, edit.wanderRadius]));
    }

    /** Cheap check run on every editor update; the save itself builds the exports. */
    private hasUnsavedChanges(): boolean {
        return             this.plugin.getWorldDefinitionForSave() !== undefined ||
            this.plugin.getConfig().edits.some((edit) =>
                edit.kind !== "npc" && edit.kind !== "npcDelete" && edit.kind !== "npcWander") ||
            this.npcSpawnsKey() !== this.savedNpcSpawnsKey;
    }

    private syncSaveButton(): void {
        const save = this.saveButton;
        if (!save) return;
        const disabled = !this.hasUnsavedChanges();
        if (save.disabled === disabled) return;
        save.disabled = disabled;
        Object.assign(save.style, disabled
            ? { opacity: "0.45", cursor: "default", pointerEvents: "none" }
            : { opacity: "", cursor: "pointer", pointerEvents: "" });
    }

    private sync(): void {
        this.syncSaveButton();
        const state = this.plugin.getState();
        this.pvpZonesInput.disabled = !state.world.definition;
        this.safeZonesInput.disabled = !state.world.definition;
        this.duelZonesInput.checked = state.config.showDuelZones;
        this.safeZonesInput.checked = state.config.showSafeZones;
        this.f2pZonesInput.disabled = !state.world.definition;
        this.f2pZonesInput.checked = state.config.showF2pZones;
        this.multiCombatZonesInput.disabled = !state.world.definition;
        this.heightInput.value = String(state.config.heightLevel);
        this.renderAllInput.checked = state.config.renderAllHeightLevels;
        this.mapIconsInput.checked = state.config.showMapIcons;
        this.saveObjectSpawnsInput.checked = state.config.saveObjectSpawns;
        this.pvpZonesInput.checked = state.config.showPvpZones;
        this.multiCombatZonesInput.checked = state.config.showMultiCombatZones;
        this.toolbar.setIcon("overlay", () => this.createOverlaySwatchIcon(state.config.overlayId));
        if (this.overlayShapePicker) this.fillOverlayShapePicker(this.overlayShapePicker);
        this.toolbar.select(
            state.config.tool === "place"
                ? "cache-search"
                  : state.config.tool === "path"
                  ? "path"
                  : state.config.tool === "terrain"
                  ? "terrain"
                  : state.config.tool === "wall"
                    ? "wall"
                  : "select",
        );
        this.palette.setMode(state.search.kind);
        this.palette.setSelectedId(
            state.search.kind === "npc" ? state.config.npcId : state.config.locId,
        );
        if (state.version !== this.lastVersion) {
            this.lastVersion = state.version;
            this.palette.renderResults(state.search.results, state.search.loading);
        }

        this.renderSelection();
    }

    private renderSelection(): void {
        const selection = this.plugin.getState().selection;
        if (!selection) {
            this.selectionImage = undefined;
            this.selectionDetails.style.display = "none";
            return;
        }
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
            actions.appendChild(copy);
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
                const useOverlay = createActionButton("Use overlay",
                    () => this.createOverlaySwatchIcon(overlay ?? 0),
                    () => this.plugin.useSelectionOverlay());
                useOverlay.disabled = overlay === undefined;
                if (useOverlay.disabled) {
                    useOverlay.style.opacity = "0.45";
                    useOverlay.style.cursor = "not-allowed";
                }
                actions.appendChild(useOverlay);
            }
            actions.append(
                this.createOverlayShapePicker(),
                createActionButton("Paint overlay", createPaintIcon, () =>
                    this.plugin.paintSelection(),
                ),
                this.createHeightControls(!hasTileRange),
            );
        }
        if (selection.kind === "loc") {
            actions.append(
                createActionButton("Rotate object", createRotateIcon, () => this.plugin.rotateSelection(), "R"),
                createActionButton("Duplicate object", createDuplicateIcon, () =>
                    this.plugin.duplicateSelection(), "C",
                ),
                createActionButton("Move object", createMoveIcon, () => this.plugin.moveSelection(), "M"),
                createActionButton("Delete object", createTrashIcon, () =>
                    this.plugin.deleteSelection(), "Del",
                ),
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
        if (isGroundSelection && !hasTileRange && this.plugin.getState().world.definition) {
            actions.append(
                createActionButton("Set spawn point", createSpawnIcon, () => this.plugin.setSpawnPoint()),
            );
        }
        if (hasTileRange) {
            const copy = createActionButton("Copy", createDuplicateIcon, () => {
                try {
                    const contents = this.plugin.copyArea();
                    void navigator.clipboard.writeText(contents).then(
                        () => { copy.lastChild!.textContent = " Copied"; },
                        (error) => this.toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`),
                    );
                } catch (error) {
                    this.toast(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
            actions.append(copy,

                createActionButton("Clear area", createTrashIcon, () => this.plugin.clearArea()),
                createActionButton("Flatten area", createLayersIcon, () => this.plugin.flattenArea()),
            );
            if (this.plugin.canGenerateIsland()) {
                actions.append(createActionButton("Generate island", createLayersIcon, () => this.plugin.generateIsland()));
            }
            const width = Math.abs(selection.tileEndX! - selection.tileX) + 1;
            const depth = Math.abs(selection.tileEndY! - selection.tileY) + 1;
            if (width > 2 && depth > 2 && selection.plane === 0) {
                const options = document.createElement("div");
                Object.assign(options.style, { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "5px" });
                const style = document.createElement("select");
                for (const name of BUILDING_STYLES) style.add(new Option(name, name, name === this.buildingStyle, name === this.buildingStyle));
                style.addEventListener("change", () => { this.buildingStyle = style.value as BuildingStyle; });
                const floors = document.createElement("select");
                for (let count = 1; count <= 3; count++) floors.add(new Option(`${count} floor${count === 1 ? "" : "s"}`, String(count), count === this.buildingFloors, count === this.buildingFloors));
                floors.addEventListener("change", () => { this.buildingFloors = Number(floors.value); });
                const shape = document.createElement("select");
                for (const name of BUILDING_SHAPES) shape.add(new Option(name, name, name === this.buildingShape, name === this.buildingShape));
                shape.addEventListener("change", () => { this.buildingShape = shape.value as BuildingShape; });
                for (const select of [style, floors, shape]) Object.assign(select.style, { minWidth: "0", padding: "5px", color: "#cbd5e1", background: "#20242b", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "4px" });
                options.append(style, floors, shape);
                actions.append(options, createActionButton("Generate building", createLayersIcon, () =>
                    this.plugin.generateBuilding(this.buildingStyle, this.buildingFloors, this.buildingShape),
                ));
            }
        }
        this.selectionDetails.append(title, location, rotation);
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
        this.detailPanel?.remove();
        const kindTitle = kind === "npc" ? "NPC" : kind === "loc" ? "Object" : "Item";
        const panel = createPanel("definition-panel", "320px");
        this.detailPanel = panel;
        Object.assign(panel.style, {
            right: "12px",
            top: TOP_BAR_CLEARANCE,
            left: "auto",
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            zIndex: "10004",
        });
        panel.appendChild(
            createHeader(`${kindTitle} ${id} · ${definition.name}`, () => this.closeDetailPanel()),
        );
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

    private toggleWorldMap(): void {
        this.plugin.toggleWorldMap();
    }

    private toggleSettings(): void {
        if (this.settingsDrawer) {
            this.closeSettings();
            return;
        }
        this.palette.setVisible(false);
        const panel = createPanel("settings", "340px");
        this.settingsDrawer = panel;
        panel.append(createHeader("Settings", () => this.closeSettings()), this.settingsContent);
        (browserHostWindow() ? this.saveObjectSpawnsInput : this.renderAllInput).focus();
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

    private exportRegions(): void {
        try {
            if (!browserHostWindow()) this.plugin.setConfig({ saveObjectSpawns: false });
            const objectSpawns = this.plugin.exportObjectSpawns();
            const exported = this.plugin.exportModifiedRegionPacks();
            // Saving only the regions that fit would leave the map half edited, so save none.
            const oversized = oversizedRegionPacks(exported);
            if (oversized.length > 0) {
                const regions = oversized.map(({ regionId, payload }) => `${regionId} (${payload.toLocaleString()} bytes)`).join(", ");
                this.toast(`Not saved: over the ${MAX_REGION_PACK_PAYLOAD.toLocaleString()} byte region limit: ${regions}. Undo or edit fewer tiles.`);
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
                    ...(edit.kind === "npcDelete" ? { remove: true } : {}),
                }));
            const npcSpawnsDirty = this.npcSpawnsKey() !== this.savedNpcSpawnsKey;
            if (objectSpawns === undefined && exported.length === 0 && !world && !npcSpawnsDirty) {
                this.toast("No world or map edits to save");
                return;
            }
            // Opened from /host: hand the pack to the host tab instead of the
            // download folder, so Restart there streams the edited region.
            const host = browserHostWindow();
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
                const saved = [
                    objectSpawns !== undefined ? "object additions/deletions" : "",
                    exported.length ? `${exported.length} edited region pack${exported.length === 1 ? "" : "s"}` : "",
                    world ? "world spawn" : "",
                    customNpcs.length || npcSpawnsDirty ? "NPC spawn edits" : "",
                ].filter(Boolean).join(" and ");
                this.savedNpcSpawnsKey = this.npcSpawnsKey();
                this.plugin.markMapEditsSaved(exported, objectSpawns);
                this.toast(`Saved ${saved}`);
                return;
            }
            if (objectSpawns !== undefined) {
                FileSaver.saveAs(new Blob([formatObjectSpawns(objectSpawns)], { type: "application/json" }), "object-spawns.json");
            }
            for (const pack of exported) {
                const blob = new Blob([pack.data.slice().buffer], {
                    type: "application/octet-stream",
                });
                FileSaver.saveAs(blob, `${pack.regionId}.pack`);
            }
            if (world) {
                FileSaver.saveAs(
                    new Blob([JSON.stringify(world, null, 2) + "\n"], { type: "application/json" }),
                    "world.json",
                );
                this.plugin.markWorldDefinitionSaved();
            }
            if (npcSpawnsDirty || customNpcs.length) {
                FileSaver.saveAs(
                    new Blob([formatCustomNpcSpawns(customNpcs.map(({ id, tileX: x, tileY: y, plane: level, direction, wanderRadius, remove }) => ({
                        id,
                        x,
                        y,
                        level,
                        ...(direction === undefined ? {} : { direction }),
                        ...(wanderRadius === undefined ? {} : { wanderRadius }),
                        ...(remove ? { remove: true } : {}),
                    })))], { type: "application/json" }),
                    "npc-spawns-custom.json",
                );
            }
            this.savedNpcSpawnsKey = this.npcSpawnsKey();
            this.plugin.markMapEditsSaved(exported, objectSpawns);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[edit-mode] Region export failed", error);
            window.alert(`Region export failed: ${message}`);
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
    }
}

/** Mounts the reference editor chrome and returns its complete teardown. */
export function mountEditorUi(plugin: EditModePlugin): () => void {
    const editor = new EditorChrome(plugin);
    return () => editor.remove();
}
