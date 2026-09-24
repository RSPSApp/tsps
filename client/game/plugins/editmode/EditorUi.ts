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
    type EditorTool,
    createCloseIcon,
    createDuplicateIcon,
    createDownloadIcon,
    createLayersIcon,
    createOverlayIcon,
    createPathIcon,
    createPaintIcon,
    createPointerIcon,
    createRotateIcon,
    createRefreshIcon,
    createSearchIcon,
    createSaveIcon,
    createShopIcon,
    createSpawnIcon,
    createTrashIcon,
    createWorldMapIcon,
} from "./EditorToolbar";
import { WORLD_DEFINITION_MESSAGE } from "./hostProtocol/worldDefinitionMessage";
import { CUSTOM_NPC_SPAWNS_MESSAGE, formatCustomNpcSpawns } from "./hostProtocol/npcSpawnMessage";
import { SHOP_DEFINITIONS_MESSAGE } from "./hostProtocol/shopsMessage";
import { NPC_INTERACTIONS_MESSAGE } from "./hostProtocol/npcInteractionsMessage";
import { MenuOpcode } from "../../../ui/menu/MenuState";
import type {
    EditModeDefinitionSummary,
    EditModeOverlaySwatch,
    EditModeSearchKind,
    EditModeNpcInteractions,
    EditModeShop,
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

const TOP_BAR_HEIGHT = 48;
/** Gap below the top bar where floating panels and toasts start. */
const TOP_BAR_CLEARANCE = `${TOP_BAR_HEIGHT + 8}px`;

function npcClickKey(opcode: number): "first_click" | "second_click" | "third_click" | "fourth_click" | undefined {
    switch (opcode) {
        case MenuOpcode.NpcFirstOption: return "first_click";
        case MenuOpcode.NpcSecondOption: return "second_click";
        case MenuOpcode.NpcThirdOption: return "third_click";
        case MenuOpcode.NpcFourthOption: return "fourth_click";
    }
}

function camelNpcClickKey(key: string): string {
    return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

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

function createActionButton(
    title: string,
    icon: () => SVGElement,
    action: () => void,
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
    private readonly multiCombatZonesInput: HTMLInputElement;
    private readonly unsubscribe: () => void;
    private readonly canvasShell?: HTMLElement;
    private readonly previousCanvasTop: string;
    private detailPanel?: HTMLElement;
    private overlayPalette?: HTMLElement;
    private shopBrowser?: HTMLElement;
    private shopBrowserResults?: HTMLElement;
    private shopEditor?: HTMLElement;
    private activeShop?: EditModeShop;
    private shops: EditModeShop[] = [];
    private shopsLoaded = false;
    private shopsLoading = false;
    private shopsDirty = false;
    private npcInteractions: EditModeNpcInteractions = {};
    private npcInteractionsLoaded = false;
    private npcInteractionsLoading = false;
    private npcInteractionsDirty = false;
    private npcInteractionError?: string;
    private npcShopPickTarget?: { npcId: number; clickKey: "first_click" | "second_click" | "third_click" | "fourth_click" };
    private shopError?: string;
    private shopSearchToken = 0;
    private shopIconRetryTimer?: number;
    private shopIconRetryCount = 0;
    private shopPreviewScrollTop = 0;
    private overlaySwatches: readonly EditModeOverlaySwatch[] = [];
    private selectionImage?: { key: string; dataUrl: string; loading: boolean };
    private buildingStyle: BuildingStyle = "Varrock";
    private buildingShape: BuildingShape = "Rectangle";
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
                id: "cache-search",
                label: "Search NPCs / Objects / Items",
                icon: createSearchIcon,
                action: () => this.togglePalette(),
            },
            {
                id: "overlay",
                label: "Choose overlay",
                icon: () => createOverlayIcon(this.overlayColor(plugin.getConfig().overlayId)),
                action: () => this.toggleOverlayPalette(),
            },
            { id: "path", label: "Draw path", icon: createPathIcon },
            {
                id: "shops",
                label: "Browse shops",
                icon: createShopIcon,
                action: () => this.toggleShopBrowser(),
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
                    tool: toolId === "path" ? toolId : "select",
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
            padding: "10px 12px 10px 20px",
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
        this.topBar.append(
            heightLabel,
            decrement,
            this.heightInput,
            increment,
        );
        if (browserHostWindow()) {
            const save = document.createElement("button");
            save.type = "button";
            save.title = "Save world and map edits";
            save.setAttribute("aria-label", save.title);
            save.replaceChildren(createSaveIcon(), document.createTextNode("Save changes"));
            Object.assign(save.style, {
                height: "28px",
                marginRight: "16px",
                padding: "0 12px 0 16px",
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
            this.topBar.prepend(save);
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
    }

    remove(): void {
        document.body.classList.remove("map-editor-active");
        this.unsubscribe();
        this.toolbar.remove();
        this.palette.remove();
        this.selectionDetails.remove();
        this.topBar.remove();
        this.closeSettings();
        if (this.canvasShell) this.canvasShell.style.top = this.previousCanvasTop;
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
        this.detailPanel?.remove();
        this.overlayPalette?.remove();
        this.closeShopBrowser();
        this.closeShopEditor();
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

    private togglePalette(): void {
        this.palette.toggle();
    }

    private overlayColor(id: number): number {
        return this.overlaySwatches.find((swatch) => swatch.id === id)?.colorRgb ?? 0x64748b;
    }

    private toggleOverlayPalette(): void {
        if (this.overlayPalette) {
            this.overlayPalette.remove();
            this.overlayPalette = undefined;
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
        const appendSwatch = (id: number, colorRgb: number, name?: string): void => {
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
        };
        appendSwatch(0, 0x27303a, "Clear");
        for (const swatch of this.overlaySwatches) {
            appendSwatch(swatch.id, swatch.colorRgb, swatch.name);
        }
        panel.appendChild(swatches);
    }

    private sync(): void {
        const state = this.plugin.getState();
        this.toolbar.setDisabled("shops", !state.world.definition);
        this.pvpZonesInput.disabled = !state.world.definition;
        this.safeZonesInput.disabled = !state.world.definition;
        this.duelZonesInput.checked = state.config.showDuelZones;
        this.safeZonesInput.checked = state.config.showSafeZones;
        this.multiCombatZonesInput.disabled = !state.world.definition;
        this.heightInput.value = String(state.config.heightLevel);
        this.renderAllInput.checked = state.config.renderAllHeightLevels;
        this.mapIconsInput.checked = state.config.showMapIcons;
        this.saveObjectSpawnsInput.checked = state.config.saveObjectSpawns;
        this.pvpZonesInput.checked = state.config.showPvpZones;
        this.multiCombatZonesInput.checked = state.config.showMultiCombatZones;
        this.toolbar.setIcon("overlay", () => createOverlayIcon(this.overlayColor(state.config.overlayId)));
        this.toolbar.select(
            state.config.tool === "place"
                ? "cache-search"
                  : state.config.tool === "path"
                  ? "path"
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
            actions.append(
                createActionButton("Paint overlay", createPaintIcon, () =>
                    this.plugin.paintSelection(),
                ),
            );
        }
        if (selection.kind === "loc") {
            actions.append(
                createActionButton("Rotate object", createRotateIcon, () => this.plugin.rotateSelection()),
                createActionButton("Duplicate object", createDuplicateIcon, () =>
                    this.plugin.duplicateSelection(),
                ),
                createActionButton("Delete object", createTrashIcon, () =>
                    this.plugin.deleteSelection(),
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
        if (definition && selection.kind === "npc") {
            const menu = document.createElement("table");
            Object.assign(menu.style, {
                width: "100%", marginTop: "6px", borderCollapse: "collapse", color: "#fff",
                background: "#5d5447", font: "bold 12px Arial, Helvetica, sans-serif", textShadow: "1px 1px #000",
            });
            for (const option of this.plugin.getNpcMenuOptions(selection.locId)) {
                const clickKey = !option.isAttack ? npcClickKey(option.opcode) : undefined;
                if (!clickKey) continue;
                const row = menu.insertRow();
                const action = row.insertCell();
                action.textContent = option.option;
                Object.assign(action.style, { padding: "2px 4px", color: "#ffff00" });
                const binding = this.npcInteractions[String(selection.locId)] ?? {};
                const bindingKey = Object.hasOwn(binding, camelNpcClickKey(clickKey)) ? camelNpcClickKey(clickKey) : clickKey;
                const current = binding[bindingKey] as Record<string, unknown> | undefined;
                const shopId = current?.method === "core.shops.open" ? Number((current.args as Record<string, unknown> | undefined)?.shopId) : undefined;
                const shop = row.insertCell();
                shop.textContent = Number.isInteger(shopId) ? `Shop ${shopId}` : "No shop";
                Object.assign(shop.style, { padding: "2px 4px", color: Number.isInteger(shopId) ? "#00ffff" : "#d6d3d1" });
                const pick = row.insertCell();
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = "Select shop";
                button.disabled = !this.plugin.getState().world.definition;
                button.title = this.plugin.getState().world.definition ? `Assign a shop to ${option.option}` : "Load a world definition to edit shop actions";
                Object.assign(button.style, { padding: "2px 5px", border: "1px solid rgba(255,255,255,0.18)", borderRadius: "3px", color: "#fff", background: "rgba(0,0,0,0.22)", cursor: button.disabled ? "not-allowed" : "pointer", font: "inherit" });
                button.addEventListener("click", () => this.openNpcShopPicker(selection.locId, clickKey));
                pick.appendChild(button);
            }
            if (menu.rows.length) this.selectionDetails.appendChild(menu);
            if (this.plugin.getState().world.definition && !this.npcInteractionsLoaded && !this.npcInteractionsLoading) {
                void this.loadNpcInteractions();
            }
        } else if (definition) {
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
        this.closeShopBrowser();
        this.closeShopEditor();
        const panel = createPanel("settings", "340px");
        this.settingsDrawer = panel;
        panel.append(createHeader("Settings", () => this.closeSettings()), this.settingsContent);
        (browserHostWindow() ? this.saveObjectSpawnsInput : this.renderAllInput).focus();
    }

    private closeSettings(): void {
        this.settingsDrawer?.remove();
        this.settingsDrawer = undefined;
    }

    private toggleShopBrowser(): void {
        this.closeSettings();
        if (this.shopBrowser) {
            this.closeShopBrowser();
            return;
        }
        this.palette.setVisible(false);
        const panel = createPanel("shop-browser");
        this.shopBrowser = panel;
        panel.appendChild(createHeader(this.npcShopPickTarget ? "Select shop" : "Shops", () => this.closeShopBrowser()));
        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Search shop name or ID";
        input.setAttribute("aria-label", "Search shops");
        Object.assign(input.style, INPUT_STYLE);
        const results = document.createElement("div");
        Object.assign(results.style, {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            maxHeight: "390px",
            marginTop: "8px",
            overflowY: "auto",
        });
        input.addEventListener("input", () => this.renderShopBrowser(input.value));
        panel.append(input, results);
        this.shopBrowserResults = results;
        this.renderShopBrowser(input.value);
        void this.loadShops().then(() => this.renderShopBrowser(input.value));
        input.focus();
    }

    private closeShopBrowser(): void {
        this.shopBrowser?.remove();
        this.shopBrowser = undefined;
        this.shopBrowserResults = undefined;
        this.npcShopPickTarget = undefined;
    }

    private closeShopEditor(): void {
        if (this.shopIconRetryTimer !== undefined) window.clearTimeout(this.shopIconRetryTimer);
        this.shopIconRetryTimer = undefined;
        this.shopEditor?.remove();
        this.shopEditor = undefined;
        this.activeShop = undefined;
    }

    private async loadShops(): Promise<void> {
        if (this.shopsLoaded || this.shopsLoading) return;
        this.shopsLoading = true;
        this.shopError = undefined;
        try {
            this.shops = await this.plugin.loadShops();
            this.shopsLoaded = true;
        } catch (error) {
            this.shopError = error instanceof Error ? error.message : String(error);
        } finally {
            this.shopsLoading = false;
        }
    }

    private renderShopBrowser(query: string): void {
        const results = this.shopBrowserResults;
        if (!results) return;
        results.replaceChildren();
        if (this.shopsLoading) {
            results.textContent = "Loading shops…";
            return;
        }
        if (this.shopError) {
            results.textContent = `Could not load shops: ${this.shopError}`;
            return;
        }
        const needle = query.trim().toLowerCase();
        const shops = this.shops
            .filter((shop) => !needle || String(shop.id).startsWith(needle) || shop.name.toLowerCase().includes(needle))
            .sort((left, right) => left.id - right.id);
        for (const shop of shops) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${shop.id} · ${shop.name} (${shop.originalStock.length} item${shop.originalStock.length === 1 ? "" : "s"})`;
            Object.assign(button.style, {
                minHeight: "38px", padding: "6px 8px", border: "1px solid transparent", borderRadius: "4px",
                color: "#e5e7eb", background: "transparent", cursor: "pointer", font: "13px sans-serif", textAlign: "left",
            });
            button.addEventListener("mouseenter", () => { button.style.background = "rgba(59,130,246,0.22)"; });
            button.addEventListener("mouseleave", () => { button.style.background = "transparent"; });
            button.addEventListener("click", () => {
                const target = this.npcShopPickTarget;
                if (target) {
                    this.setNpcShop(target.npcId, target.clickKey, shop.id);
                    this.closeShopBrowser();
                    this.renderSelection();
                } else this.openShopEditor(shop);
            });
            results.appendChild(button);
        }
        if (!shops.length) results.textContent = this.shopsLoaded ? "No matching shops." : "No shop definitions were loaded.";
    }

    private openShopEditor(shop: EditModeShop): void {
        this.closeShopEditor();
        this.activeShop = shop;
        this.shopIconRetryCount = 0;
        this.shopPreviewScrollTop = 0;
        const panel = createPanel("shop-editor", "560px");
        Object.assign(panel.style, {
            right: "12px", top: TOP_BAR_CLEARANCE, left: "auto", maxWidth: "calc(100vw - 32px)",
            maxHeight: "calc(100vh - 24px)", overflowY: "auto", zIndex: "10005",
        });
        this.shopEditor = panel;
        this.renderShopEditor();
    }

    private openNpcShopPicker(npcId: number, clickKey: "first_click" | "second_click" | "third_click" | "fourth_click"): void {
        this.npcShopPickTarget = { npcId, clickKey };
        if (!this.shopBrowser) this.toggleShopBrowser();
    }

    private async loadNpcInteractions(): Promise<void> {
        this.npcInteractionsLoading = true;
        this.npcInteractionError = undefined;
        try {
            this.npcInteractions = await this.plugin.loadNpcInteractions();
            this.npcInteractionsLoaded = true;
        } catch (error) {
            this.npcInteractionError = error instanceof Error ? error.message : String(error);
        } finally {
            this.npcInteractionsLoading = false;
            this.renderSelection();
        }
    }

    private setNpcShop(npcId: number, clickKey: "first_click" | "second_click" | "third_click" | "fourth_click", shopId: number): void {
        const bindings = this.npcInteractions[String(npcId)] ?? (this.npcInteractions[String(npcId)] = {});
        const key = Object.hasOwn(bindings, camelNpcClickKey(clickKey)) ? camelNpcClickKey(clickKey) : clickKey;
        bindings[key] = { method: "core.shops.open", args: { shopId } };
        this.npcInteractionsDirty = true;
    }

    private itemName(id: number): string {
        return this.plugin.describeDefinition("item", id)?.name ?? `Item ${id}`;
    }

    private itemIcon(id: number, amount: number): HTMLCanvasElement | undefined {
        return window.osrsClient?.renderer?.itemIconRenderer?.renderToCanvas(id, amount, {
            outline: 1,
            quantityMode: 2,
        });
    }

    private retryShopIcons(): void {
        if (this.shopIconRetryTimer !== undefined || this.shopIconRetryCount >= 30) return;
        this.shopIconRetryTimer = window.setTimeout(() => {
            this.shopIconRetryTimer = undefined;
            this.shopIconRetryCount++;
            this.renderShopEditor(false);
        }, 100);
    }

    private renderShopEditor(focusSearch = true): void {
        const panel = this.shopEditor;
        const shop = this.activeShop;
        if (!panel || !shop) return;
        panel.replaceChildren();
        panel.appendChild(createHeader(`${shop.name} · ${shop.id}`, () => this.closeShopEditor()));
        const metadata = document.createElement("div");
        metadata.textContent = `Currency: ${shop.currency || "COINS"}`;
        Object.assign(metadata.style, { marginBottom: "8px", color: "#94a3b8", fontSize: "12px" });
        const preview = document.createElement("div");
        preview.setAttribute("aria-label", "Shop preview");
        Object.assign(preview.style, {
            display: "grid", gridTemplateColumns: "repeat(8, 40px)", columnGap: "9px", rowGap: "6px", padding: "8px",
            marginBottom: "10px", maxHeight: "220px", overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable",
            border: "0", background: "#494034",
        });
        preview.scrollTop = this.shopPreviewScrollTop;
        preview.addEventListener("scroll", () => { this.shopPreviewScrollTop = preview.scrollTop; });
        let missingIcon = false;
        for (let slot = 0; slot < Math.max(40, shop.originalStock.length); slot++) {
            const entry = shop.originalStock[slot];
            const cell = document.createElement("div");
            cell.title = entry ? `${this.itemName(entry.id)} · ${entry.amount}` : "Empty slot";
            Object.assign(cell.style, {
                width: "40px", height: "36px", display: "grid", placeItems: "center", overflow: "hidden",
            });
            if (entry) {
                const icon = this.itemIcon(entry.id, entry.amount);
                if (icon) {
                    icon.style.imageRendering = "pixelated";
                    cell.appendChild(icon);
                } else missingIcon = true;
            }
            preview.appendChild(cell);
        }
        if (missingIcon) this.retryShopIcons();
        const searchLabel = document.createElement("strong");
        searchLabel.textContent = "Add item";
        const input = document.createElement("input");
        input.type = "search";
        input.placeholder = "Search current-cache item name or ID";
        input.setAttribute("aria-label", `Search items to add to ${shop.name}`);
        Object.assign(input.style, INPUT_STYLE, { marginTop: "5px" });
        const matches = document.createElement("div");
        Object.assign(matches.style, { display: "grid", gap: "2px", maxHeight: "130px", marginTop: "4px", overflowY: "auto" });
        input.addEventListener("input", () => {
            const token = ++this.shopSearchToken;
            const query = input.value.trim();
            matches.replaceChildren();
            if (!query) return;
            void this.plugin.searchItems(query).then((items) => {
                if (token !== this.shopSearchToken || !this.shopEditor) return;
                for (const item of items.slice(0, 25)) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.textContent = `${item.id} · ${item.name}`;
                    Object.assign(button.style, {
                        padding: "4px 6px", border: "0", borderRadius: "3px", color: "#cbd5e1", background: "rgba(255,255,255,0.06)",
                        cursor: "pointer", font: "12px sans-serif", textAlign: "left",
                    });
                    button.addEventListener("click", () => this.addShopItem(item.id));
                    matches.appendChild(button);
                }
                if (!items.length) matches.textContent = "No matching items.";
            });
        });
        const divider = document.createElement("hr");
        Object.assign(divider.style, { margin: "10px 0 6px", border: "0", borderTop: "1px solid rgba(255,255,255,0.12)" });
        const stock = document.createElement("div");
        Object.assign(stock.style, { display: "grid", gap: "3px" });
        for (const entry of shop.originalStock) {
            const row = document.createElement("div");
            Object.assign(row.style, { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 88px 28px", gap: "6px", alignItems: "center" });
            const name = document.createElement("span");
            name.textContent = `${entry.id} · ${this.itemName(entry.id)}`;
            name.title = name.textContent;
            Object.assign(name.style, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
            const amount = document.createElement("input");
            amount.type = "number";
            amount.min = "1";
            amount.max = String(0x7fffffff);
            amount.value = String(entry.amount);
            amount.setAttribute("aria-label", `Amount of ${this.itemName(entry.id)}`);
            Object.assign(amount.style, INPUT_STYLE, { height: "28px", padding: "3px 5px" });
            amount.addEventListener("change", () => this.setShopItemAmount(entry, Number(amount.value)));
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "×";
            remove.title = `Remove ${this.itemName(entry.id)}`;
            Object.assign(remove.style, { height: "28px", border: "0", borderRadius: "3px", color: "#fecaca", background: "rgba(239,68,68,0.18)", cursor: "pointer", fontSize: "18px" });
            remove.addEventListener("click", () => this.removeShopItem(entry));
            row.append(name, amount, remove);
            stock.appendChild(row);
        }
        if (!shop.originalStock.length) stock.textContent = "No stock. Add an item above.";
        panel.append(metadata, preview, searchLabel, input, matches, divider, stock);
        if (focusSearch) input.focus();
    }

    private addShopItem(id: number): void {
        const shop = this.activeShop;
        if (!shop) return;
        const existing = shop.originalStock.find((entry) => entry.id === id);
        if (existing) existing.amount = Math.min(0x7fffffff, existing.amount + 1);
        else shop.originalStock.push({ id, amount: 1 });
        this.shopsDirty = true;
        this.renderShopEditor();
    }

    private setShopItemAmount(entry: EditModeShop["originalStock"][number], amount: number): void {
        if (!Number.isInteger(amount) || amount < 1 || amount > 0x7fffffff) return;
        entry.amount = amount;
        this.shopsDirty = true;
        this.renderShopEditor();
    }

    private removeShopItem(entry: EditModeShop["originalStock"][number]): void {
        const shop = this.activeShop;
        if (!shop) return;
        shop.originalStock.splice(shop.originalStock.indexOf(entry), 1);
        this.shopsDirty = true;
        this.renderShopEditor();
    }

    private exportRegions(): void {
        try {
            if (!browserHostWindow()) this.plugin.setConfig({ saveObjectSpawns: false });
            const objectSpawns = this.plugin.exportObjectSpawns();
            const exported = this.plugin.exportModifiedRegionPacks();
            const world = this.plugin.getWorldDefinitionForSave();
            const shopsDirty = this.shopsDirty;
            const npcInteractionsDirty = this.npcInteractionsDirty;
            const customNpcs = this.plugin.getConfig().edits
                .filter((edit) => edit.kind === "npc")
                .map((edit) => ({ id: edit.locId, tileX: edit.tileX, tileY: edit.tileY, plane: edit.plane, direction: quarterTurnToDirection(edit.rotation) }));
            if (objectSpawns === undefined && exported.length === 0 && !world && customNpcs.length === 0 && !shopsDirty && !npcInteractionsDirty) {
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
                if (customNpcs.length) host.postMessage({ type: CUSTOM_NPC_SPAWNS_MESSAGE, spawns: customNpcs }, hostOrigin);
                if (shopsDirty) {
                    host.postMessage(
                        { type: SHOP_DEFINITIONS_MESSAGE, contents: JSON.stringify(this.shops, null, 2) + "\n" },
                        hostOrigin,
                    );
                    this.shopsDirty = false;
                }
                if (npcInteractionsDirty) {
                    host.postMessage(
                        { type: NPC_INTERACTIONS_MESSAGE, contents: JSON.stringify(this.npcInteractions, null, 2) + "\n" },
                        hostOrigin,
                    );
                    this.npcInteractionsDirty = false;
                }
                const saved = [
                    objectSpawns !== undefined ? "object additions/deletions" : "",
                    exported.length ? `${exported.length} edited region pack${exported.length === 1 ? "" : "s"}` : "",
                    world ? "world spawn" : "",
                    customNpcs.length ? `${customNpcs.length} custom NPC spawn${customNpcs.length === 1 ? "" : "s"}` : "",
                    shopsDirty ? "shops" : "",
                    npcInteractionsDirty ? "NPC shop actions" : "",
                ].filter(Boolean).join(" and ");
                this.plugin.markMapEditsSaved(exported, objectSpawns);
                this.toast(`Saved ${saved}`);
                return;
            }
            if (objectSpawns !== undefined) {
                FileSaver.saveAs(new Blob([formatObjectSpawns(objectSpawns)], { type: "application/json" }), "object-spawns.json");
            }
            if (shopsDirty) {
                FileSaver.saveAs(new Blob([JSON.stringify(this.shops, null, 2) + "\n"], { type: "application/json" }), "shops.json");
                this.shopsDirty = false;
            }
            if (npcInteractionsDirty) {
                FileSaver.saveAs(new Blob([JSON.stringify(this.npcInteractions, null, 2) + "\n"], { type: "application/json" }), "npc_interactions.json");
                this.npcInteractionsDirty = false;
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
            if (customNpcs.length) {
                FileSaver.saveAs(
                    new Blob([formatCustomNpcSpawns(customNpcs.map(({ id, tileX: x, tileY: y, plane: level, direction }) => ({ id, x, y, level, direction })))], { type: "application/json" }),
                    "npc-spawns-custom.json",
                );
            }
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
