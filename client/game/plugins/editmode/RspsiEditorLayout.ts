import "./RspsiEditorLayout.css";
import type { EditModePlugin } from "./EditModePlugin";
import { createPointerIcon, createEraserIcon, createHeightIcon, createOverlayBrushIcon, createUnderlayBrushIcon, createFlagIcon, showEditorTooltip } from "./EditorToolbar";

type ViewToggleKey = "showUnwalkableFlags" | "showBridgeFlags" | "showRemoveRoofFlags" | "showLowerZFlags" | "showDisableRenderFlags" | "showMapIcons" | "showPvpZones" | "showMultiCombatZones" | "showDuelZones" | "showSafeZones" | "showF2pZones";

type Action = { label: string; run: () => void };
type Task = Action & { id: string; description: string; keywords?: string };
type Group = { tasks: Task[] };
type Workspace = { label: string; groups: Group[] };

/** Matches RSPSi MainWindow's main_test4.fxml: 55px rail, 41px menu,
 * Resizable swatches with bottom tabs, and 43px controls below the scene. */
export class RspsiEditorLayout {
    private readonly sidebarToggle = document.createElement("button");
    private readonly sidebarResizer = document.createElement("div");
    private sidebarWidth = 280;
    private resizingSidebar = false;
    private sidebarResizeFrame?: number;
    private bottomObserver?: ResizeObserver;
    private bottomResizeFrame?: number;
    private sidebarCollapsed = false;
    private readonly bar = document.createElement("div");
    private readonly rail = document.createElement("div");
    private readonly dock = document.createElement("aside");
    readonly paletteContent = document.createElement("div");
    readonly status = document.createElement("div");
    readonly bottom = document.createElement("div");
    private readonly finder = document.createElement("div");
    private readonly search = document.createElement("input");
    private readonly results = document.createElement("div");
    private readonly taskButtons = new Map<string, HTMLButtonElement>();
    private readonly actions: { workspace?: number; task: Task }[];
    private readonly reviewButton: HTMLButtonElement;
    private returnFocus?: HTMLElement;
    private workspace = 0;
    private highlighted = 0;
    private matches: typeof this.actions = [];
    private resultButtons: HTMLButtonElement[] = [];
    private readonly tabButtons = new Map<string, HTMLButtonElement>();
    private readonly radius = document.createElement("input");
    private readonly shape = document.createElement("select");
    private toolTooltip?: HTMLElement;
    private toolTooltipTimer?: number;
    private readonly allHeightsButton: HTMLButtonElement;
    private readonly viewToggles = new Map<ViewToggleKey, HTMLButtonElement>();

    private readonly radiusLabel = document.createElement("output");
    selectedPalette = "Objects";
    onPalette?: (tab: string) => void;
    onPaletteChange?: (tab: string) => void;
    private onWorkspaceChange: (label: string) => void;

    constructor(private readonly workspaces: Workspace[], undo: Action, redo: Action, settings: Action,
        review: Action, help: Action, icons: {
            undo: () => SVGElement; redo: () => SVGElement;
            review: () => SVGElement
        },
        onWorkspaceChange: (label: string) => void, navigationTasks: Task[],
        private readonly plugin: EditModePlugin,
    ) {
        this.onWorkspaceChange = onWorkspaceChange;
        this.actions = [...workspaces.flatMap(({ groups }, workspace) =>
            groups.flatMap(({ tasks }) => tasks.map(task => ({ task, workspace })))),
        ...navigationTasks.map(task => ({ task }))];
        this.bar.className = "rspsi-menu";
        this.bar.dataset.mapEditor = "menu-bar";
        this.bar.setAttribute("role", "menubar");
        const ids = (list: string[]) => list.map(id => this.actions.find(a => a.task.id === id)?.task).filter((t): t is Task => !!t);
        this.menu("File", [
            ...ids(["new-region", "new-square", "expand-region", "edit-draft"]), null,
            ...ids(["world-map", "jump", "refresh"]), null,
            ...ids(["map-files"]), review, ...ids(["validate"]),
        ]);
        this.menu("Edit", [undo, redo, null, ...ids(["select-entity", "select-ground", "select-building", "region"]), null, ...ids(["stamp"])]);
        const view = this.menu("View", ids(["camera"]));
        this.allHeightsButton = this.button("Show all height levels", () => {
            const show = this.allHeightsButton.getAttribute("aria-checked") !== "true";
            this.plugin.setConfig({ floorView: show ? "all" : "up-to", renderAllHeightLevels: show });
            view.open = false;
        });
        this.allHeightsButton.setAttribute("role", "menuitemcheckbox");
        this.allHeightsButton.title = "Show every height level, including roofs";
        view.querySelector('[role="menu"]')!.prepend(this.allHeightsButton);
        const viewItems = view.querySelector('[role="menu"]')!;
        const addViewToggle = (label: string, key: ViewToggleKey) => {
            const button = this.button(label, () => {
                this.plugin.setConfig({ [key]: !this.plugin.getConfig()[key] });
                view.open = false;
            });
            button.setAttribute("role", "menuitemcheckbox");
            this.viewToggles.set(key, button);
            viewItems.append(button);
            return button;
        };
        this.allHeightsButton.after(addViewToggle("Show map icons", "showMapIcons"));
        viewItems.append(this.menuSeparator());
        addViewToggle("Show unwalkable flags", "showUnwalkableFlags");
        addViewToggle("Show bridge flags", "showBridgeFlags");
        addViewToggle("Show remove roof flags", "showRemoveRoofFlags");
        addViewToggle("Show render on Z − 1 flag", "showLowerZFlags");
        addViewToggle("Show disable render flags", "showDisableRenderFlags");
        viewItems.append(this.menuSeparator());
        addViewToggle("Show PvP zones", "showPvpZones");
        addViewToggle("Show Multi zones", "showMultiCombatZones");
        addViewToggle("Show Duel zones", "showDuelZones");
        addViewToggle("Show Safe zones", "showSafeZones");
        addViewToggle("Show F2P zones", "showF2pZones");
        this.menu("Tiles", [...ids(["overlay", "underlay", "path", "fill"]), null,
            ...ids(["raise", "lower", "smooth", "flatten", "ramp", "natural"]), null, ...ids(["block", "unblock"])]);
        this.menu("Tools", [...ids(["structure", "wall"]), null,
            ...ids(["place-object", "scatter", "place-npc", "place-item"]), null, ...ids(["travel", "travel-source", "zones"])]);
        this.menu("Settings", [...ids(["brush-settings"]), settings]);
        this.menu("Help", [help, { label: "Find a tool (Ctrl+K)", run: () => this.openFinder() }]);
        const quick = document.createElement("div"); quick.className = "rspsi-quick";
        for (const [action, icon] of [[undo, icons.undo], [redo, icons.redo]] as const) quick.append(this.iconButton(action.label, action.run, icon));
        this.reviewButton = this.iconButton(review.label, review.run, icons.review);
        quick.append(this.reviewButton); this.bar.append(quick);
        this.rail.className = "rspsi-rail"; this.rail.dataset.mapEditor = "tool-rail";
        this.rail.setAttribute("role", "toolbar"); this.rail.setAttribute("aria-label", "Map editor tools");
        const logo = document.createElement("span"); logo.className = "rspsi-logo"; logo.setAttribute("role", "img"); logo.setAttribute("aria-label", "TSPS"); logo.textContent = "TS\nPS"; logo.title = "TSPS Map editor"; this.rail.append(logo);
        for (const [id, label, icon] of [
            ["select-entity", "Select", createPointerIcon],
            ["delete", "Delete Object", createEraserIcon], ["raise", "Modify Height", createHeightIcon],
            ["overlay", "Paint Overlays", createOverlayBrushIcon], ["underlay", "Paint Underlays", createUnderlayBrushIcon],
            ["block", "Set Tile Flags", createFlagIcon],
        ] as const) {
            const button = this.iconButton(label, () => id === "delete" ? this.selectDeleteTool() : this.runTask(id), icon);
            button.removeAttribute("title");
            const showTooltip = () => {
                this.hideToolTooltip();
                this.toolTooltipTimer = window.setTimeout(() => {
                    this.toolTooltip = showEditorTooltip(button, label);
                    this.toolTooltip.setAttribute("role", "tooltip");
                    this.toolTooltip.id = "map-editor-tool-tooltip";
                    button.setAttribute("aria-describedby", this.toolTooltip.id);
                }, 120);
            };
            button.addEventListener("mouseenter", showTooltip);
            button.addEventListener("mouseleave", this.hideToolTooltip);
            button.addEventListener("focus", showTooltip);
            button.addEventListener("blur", this.hideToolTooltip);
            button.addEventListener("click", this.hideToolTooltip);
            button.dataset.tool = id; this.taskButtons.set(id, button); this.rail.append(button);
        }
        this.dock.className = "rspsi-dock"; this.dock.dataset.mapEditor = "swatch-dock";
        this.paletteContent.className = "rspsi-swatch-content"; this.paletteContent.dataset.mapEditor = "swatches";
        const tabs = document.createElement("div"); tabs.className = "rspsi-swatch-tabs"; tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Swatches");
        for (const label of ["Objects", "Overlays", "Underlays", "Settlements", "Misc"]) {
            const button = this.button(label, () => this.selectPalette(label)); button.setAttribute("role", "tab");
            button.setAttribute("aria-selected", String(label === "Objects")); this.tabButtons.set(label, button); tabs.append(button);
        }
        this.dock.append(this.paletteContent, tabs);
        this.status.className = "rspsi-status"; document.body.append(this.status);
        this.bottom.className = "rspsi-bottom"; this.bottom.dataset.mapEditor = "brush-controls";
        this.radius.type = "range"; this.radius.min = "0"; this.radius.max = "15"; this.radius.setAttribute("aria-label", "Brush size");
        this.radius.oninput = () => this.plugin.setTerrainBrush({ radius: this.radius.valueAsNumber });
        this.shape.setAttribute("aria-label", "Brush shape");
        this.shape.add(new window.Option("Circle", "round")); this.shape.add(new window.Option("Square", "square"));
        this.shape.onchange = () => this.plugin.setTerrainBrush({ shape: this.shape.value as "round" | "square" });
        this.bottom.append(this.field("Brush", this.field("Size", this.button("−", () => this.resizeBrush(-1)), this.radius, this.radiusLabel, this.button("+", () => this.resizeBrush(1))), this.field("Shape", this.shape)),
            this.field("Tile Height", this.heightControls()));
        this.finder.className = "rspsi-finder"; this.finder.dataset.mapEditor = "tool-finder"; this.finder.hidden = true;
        const dialog = document.createElement("section"); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-label", "Find a map tool");
        const header = document.createElement("header"); header.append("Find a tool", this.button("Close", () => this.closeFinder()));
        this.search.type = "search"; this.search.setAttribute("aria-label", "Search map tools"); this.search.placeholder = "Find a tool…";
        this.search.oninput = () => this.renderResults(); this.results.className = "rspsi-results";
        dialog.append(header, this.search, this.results); this.finder.append(dialog);
        this.finder.addEventListener("click", event => { if (event.target === this.finder) this.closeFinder() });
        this.finder.addEventListener("keydown", this.onFinderKey);
        for (const element of [this.bar, this.rail, this.dock, this.bottom, this.finder]) for (const type of ["mousedown", "click", "keydown", "keyup"]) element.addEventListener(type, event => event.stopPropagation());
        this.sidebarToggle.type = "button"; this.sidebarToggle.className = "rspsi-sidebar-toggle";
        this.sidebarToggle.setAttribute("aria-controls", "rspsi-sidebar"); this.dock.id = "rspsi-sidebar";
        this.sidebarToggle.onclick = () => this.setSidebarCollapsed(!this.sidebarCollapsed);
        for (const type of ["mousedown", "click", "keydown", "keyup"]) this.sidebarToggle.addEventListener(type, event => event.stopPropagation());
        this.sidebarResizer.className = "rspsi-sidebar-resizer";
        this.sidebarResizer.setAttribute("role", "separator");
        this.sidebarResizer.setAttribute("aria-label", "Resize right sidebar");
        this.sidebarResizer.setAttribute("aria-orientation", "vertical");
        this.sidebarResizer.setAttribute("aria-controls", "rspsi-sidebar");
        this.sidebarResizer.tabIndex = 0;
        this.sidebarResizer.addEventListener("mousedown", event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.resizingSidebar = true;
            document.body.classList.add("map-editor-sidebar-resizing");
        });
        this.sidebarResizer.addEventListener("keydown", event => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            event.stopPropagation();
            this.setSidebarWidth(this.sidebarWidth + (event.key === "ArrowLeft" ? 16 : -16));
        });
        window.addEventListener("mousemove", this.resizeSidebar, true);
        window.addEventListener("mouseup", this.finishSidebarResize, true);
        window.addEventListener("blur", this.finishSidebarResize);
        window.addEventListener("resize", this.clampSidebarWidth);
        this.setSidebarWidth(this.sidebarWidth);
        document.body.append(this.bar, this.rail, this.dock, this.bottom, this.finder, this.sidebarToggle, this.sidebarResizer);
        this.setSidebarCollapsed(false);
        if (typeof window.ResizeObserver === "function") {
            this.bottomObserver = new window.ResizeObserver(() => {
                if (this.bottomResizeFrame !== undefined) return;
                this.bottomResizeFrame = requestAnimationFrame(() => {
                    this.bottomResizeFrame = undefined;
                    this.resizeBottom();
                });
            });
            this.bottomObserver.observe(this.bottom);
        }
        document.body.classList.add("map-editor-rspsi");
        window.addEventListener("keydown", this.onFinderShortcut, true);
        document.addEventListener("mousedown", this.closeMenus);
    }

    private setSidebarWidth(width: number): void {
        const maximum = Math.max(160, Math.min(600, window.innerWidth - 215));
        const minimum = Math.min(240, maximum);
        const next = Math.round(Math.max(minimum, Math.min(maximum, width)));
        this.sidebarResizer.setAttribute("aria-valuemin", String(minimum));
        this.sidebarResizer.setAttribute("aria-valuemax", String(maximum));
        this.sidebarResizer.setAttribute("aria-valuenow", String(next));
        if (document.body.style.getPropertyValue("--rspsi-dock-width") === `${next}px`) return;
        this.sidebarWidth = next;
        document.body.style.setProperty("--rspsi-dock-width", `${next}px`);
        if (this.sidebarResizeFrame !== undefined) return;
        this.sidebarResizeFrame = requestAnimationFrame(() => {
            this.sidebarResizeFrame = undefined;
            this.resizeBottom();
            window.dispatchEvent(new Event("resize"));
        });
    }
    private readonly clampSidebarWidth = (): void => this.setSidebarWidth(this.sidebarWidth);
    private readonly resizeSidebar = (event: MouseEvent): void => {
        if (!this.resizingSidebar) return;
        event.preventDefault();
        event.stopPropagation();
        this.setSidebarWidth(window.innerWidth - event.clientX);
    };
    private readonly finishSidebarResize = (event?: Event): void => {
        if (!this.resizingSidebar) return;
        event?.preventDefault();
        event?.stopPropagation();
        this.resizingSidebar = false;
        document.body.classList.remove("map-editor-sidebar-resizing");
    };

    private readonly hideToolTooltip = (): void => {
        window.clearTimeout(this.toolTooltipTimer);
        this.toolTooltipTimer = undefined;
        this.toolTooltip?.remove();
        this.toolTooltip = undefined;
        this.rail.querySelector('[aria-describedby="map-editor-tool-tooltip"]')?.removeAttribute("aria-describedby");
    };

    private selectDeleteTool(): void {
        this.activatePalette("Objects");
        this.onWorkspaceChange("Select");
        this.plugin.setSelectionMode("entity");
        this.plugin.setConfig({ tool: "delete" });
    }
    private heightControls(): HTMLElement {
        const group = document.createElement("span"); group.className = "rspsi-height";
        const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = "255"; slider.value = "50"; slider.setAttribute("aria-label", "Tile height");
        const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.max = "2040"; input.step = "8"; input.value = "400"; input.setAttribute("aria-label", "Tile height value");
        const absolute = document.createElement("input"); absolute.type = "checkbox"; absolute.setAttribute("aria-label", "Absolute tile height");
        slider.oninput = () => input.value = String(slider.valueAsNumber * 8);
        const apply = () => { const value = input.valueAsNumber; if (!Number.isFinite(value) || value < 0 || value > 2040) return; slider.value = String(Math.round(value / 8)); this.plugin.setSelectedTileHeight(Math.round(value / 8), absolute.checked); };
        input.onchange = () => { if (Number.isFinite(input.valueAsNumber)) slider.value = String(Math.round(input.valueAsNumber / 8)); };
        group.append(slider, input, this.button("SET", apply), this.absoluteControl(absolute)); return group;
    }
    private absoluteControl(input: HTMLInputElement): HTMLElement {
        const label = document.createElement("label"); label.className = "rspsi-absolute";
        label.append(input, "Absolute"); return label;
    }
    private field(label: string, ...children: HTMLElement[]): HTMLElement {
        const group = document.createElement("div"); group.className = "rspsi-control";
        const caption = document.createElement("span"); caption.className = "rspsi-control-label"; caption.textContent = label;
        group.append(caption, ...children); return group;
    }
    addSelectionControls(filter: HTMLSelectElement, floor: HTMLInputElement): void {
        // These are shared with the editor; reset the floating-panel dimensions before docking them.
        filter.removeAttribute("style"); floor.removeAttribute("style");
        this.bottom.append(this.field("Select filter", filter), this.field("Z Pos", floor));
        this.resizeBottom();
    }
    openSidebar(): void { this.setSidebarCollapsed(false); }
    private setSidebarCollapsed(collapsed: boolean): void {
        this.sidebarCollapsed = collapsed;
        document.body.classList.toggle("map-editor-sidebar-collapsed", collapsed);
        this.sidebarToggle.textContent = collapsed ? "‹" : "›";
        this.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
        this.sidebarToggle.setAttribute("aria-label", collapsed ? "Open right sidebar" : "Close right sidebar");
        this.sidebarToggle.title = collapsed ? "Open right sidebar" : "Close right sidebar";
        this.resizeBottom();
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
    private resizeBottom(): void {
        const width = this.bottom.getBoundingClientRect().width || window.innerWidth - 55 - (this.sidebarCollapsed ? 0 : this.sidebarWidth);
        const rows = width >= 900 ? 1 : width >= 480 ? 2 : 4;
        if (this.bottom.dataset.rows === String(rows)) return;
        this.bottom.dataset.rows = String(rows);
        document.body.style.setProperty("--rspsi-bottom-height", `${rows === 1 ? 43 : rows * 36}px`);
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
    private resizeBrush(delta: number): void { this.plugin.setTerrainBrush({ radius: Math.max(0, Math.min(15, this.plugin.getTerrainBrush().radius + delta)) }); }
    private iconButton(label: string, run: () => void, icon: () => SVGElement): HTMLButtonElement {
        const button = this.button(label, run); button.replaceChildren(icon()); return button;
    }
    private menuSeparator(): HTMLElement {
        const separator = document.createElement("hr");
        separator.setAttribute("role", "separator");
        return separator;
    }
    private menu(label: string, actions: (Action | null)[]): HTMLDetailsElement {
        const menu = document.createElement("details"); menu.className = "rspsi-menu-group";
        const summary = document.createElement("summary"); summary.textContent = label;
        const list = document.createElement("div"); list.setAttribute("role", "menu");
        for (const action of actions) {
            if (!action) { list.append(this.menuSeparator()); continue; }
            const button = this.button(action.label, () => {
                menu.open = false;
                const entry = this.actions.find(a => a.task === action);
                if (entry?.workspace !== undefined) this.workspace = entry.workspace;
                action.run();
            });
            button.setAttribute("role", "menuitem");
            list.append(button);
        }
        menu.append(summary, list); this.bar.append(menu);
        menu.addEventListener("toggle", () => { if (menu.open) for (const other of this.bar.querySelectorAll("details")) if (other !== menu) other.open = false });
        return menu;
    }
    addFileAction(label: string, run: () => void): HTMLButtonElement {
        const menu = this.bar.querySelector("details")!;
        const list = menu.querySelector("div")!;
        const button = this.button(label, () => { menu.open = false; run(); });
        button.setAttribute("role", "menuitem"); list.prepend(button, this.menuSeparator()); return button;
    }
    getTaskButton(id: string): HTMLButtonElement {
        const task = this.actions.find(a => a.task.id === id)!.task;
        return [...this.bar.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === task.label)!;
    }
    private readonly closeMenus = (event: Event): void => { if (!this.bar.contains(event.target as Node)) for (const menu of this.bar.querySelectorAll("details")) menu.open = false };
    runTask(id: string): void {
        const entry = this.actions.find(a => a.task.id === id); if (!entry) return;
        if (entry.workspace !== undefined) { this.workspace = entry.workspace; this.onWorkspaceChange(this.getWorkspace()) }
        entry.task.run();
    }
    activatePalette(label: string): void {
        if (this.selectedPalette === label) return;
        this.selectedPalette = label;
        this.tabButtons.forEach((button, name) => button.setAttribute("aria-selected", String(name === label)));
        this.onPaletteChange?.(label);
    }
    selectPalette(label: string): void {
        this.activatePalette(label);
        this.openSidebar();
        this.onPalette?.(label);
    }
    getWorkspace(): string { return this.workspaces[this.workspace].label; }
    revealTask(id: string): void { const entry = this.actions.find(a => a.task.id === id); if (entry?.workspace !== undefined) this.workspace = entry.workspace; }
    setActiveTask(id?: string): void {
        for (const [key, button] of this.viewToggles) button.setAttribute("aria-checked", String(this.plugin.getConfig()[key]));
        if (id === "select-ground" || id === "build-select-entity") id = "select-entity";
        this.allHeightsButton.setAttribute("aria-checked", String(this.plugin.getConfig().floorView === "all" ||
            (!this.plugin.getConfig().floorView && this.plugin.getConfig().renderAllHeightLevels)));
        for (const [task, button] of this.taskButtons) button.setAttribute("aria-pressed", String(task === id || task === "raise" && ["lower", "smooth", "flatten", "ramp", "natural"].includes(id ?? "") || task === "block" && id === "unblock"));
        const brush = this.plugin.getTerrainBrush(); this.radius.value = String(brush.radius); this.radiusLabel.value = String(brush.radius * 2 + 1); this.shape.value = brush.shape;

    }
    setChanged(changed: boolean): void { this.reviewButton.dataset.changed = String(changed); this.reviewButton.title = changed ? "Review unsaved changes" : "Review changes"; }
    remove(): void {
        this.hideToolTooltip();
        this.finishSidebarResize();
        window.removeEventListener("mousemove", this.resizeSidebar, true);
        window.removeEventListener("mouseup", this.finishSidebarResize, true);
        window.removeEventListener("blur", this.finishSidebarResize);
        window.removeEventListener("resize", this.clampSidebarWidth);
        if (this.sidebarResizeFrame !== undefined) cancelAnimationFrame(this.sidebarResizeFrame);
        document.body.style.removeProperty("--rspsi-dock-width");
        window.removeEventListener("keydown", this.onFinderShortcut, true); document.removeEventListener("mousedown", this.closeMenus);
        this.bottomObserver?.disconnect();
        if (this.bottomResizeFrame !== undefined) cancelAnimationFrame(this.bottomResizeFrame);
        document.body.style.removeProperty("--rspsi-bottom-height");
        for (const element of [this.bar, this.rail, this.dock, this.bottom, this.status, this.finder, this.sidebarToggle, this.sidebarResizer]) element.remove();
        document.body.classList.remove("map-editor-rspsi", "map-editor-sidebar-collapsed");
    }
    private button(label: string, run: () => void, icon?: () => SVGElement, labelClass = ""): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.title = label;
        const text = document.createElement("span");
        text.className = labelClass;
        text.textContent = label;
        if (icon) button.append(icon());
        button.append(text);
        button.onclick = run;
        return button;
    }

    private openFinder(): void {
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        this.finder.hidden = false;
        this.search.value = "";
        this.renderResults();
        this.search.focus();
    }

    private closeFinder(restoreFocus = true): void {
        if (this.finder.hidden) return;
        this.finder.hidden = true;
        if (restoreFocus) this.returnFocus?.focus({ preventScroll: true });
        this.returnFocus = undefined;
    }

    private runMatch(index: number): void {
        const match = this.matches[index];
        if (!match) return;
        this.closeFinder();
        if (match.workspace !== undefined) this.workspace = match.workspace;
        match.task.run();
    }

    private renderResults(): void {
        const terms = this.search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        this.matches = this.actions.filter(({ task, workspace }) => {
            const context = workspace === undefined ? "Navigation" : this.workspaces[workspace].label;
            const searchable = `${task.label} ${task.description} ${task.keywords ?? ""} ${context}`.toLowerCase();
            return terms.every((term) => searchable.includes(term));
        }).sort((a, b) => {
            const query = terms.join(" ");
            return Number(b.task.label.toLowerCase().startsWith(query)) - Number(a.task.label.toLowerCase().startsWith(query));
        });
        this.results.replaceChildren();
        this.resultButtons = this.matches.map(({ task, workspace }, index) => {
            const button = this.button(task.label, () => this.runMatch(index));
            const context = document.createElement("small");
            const workspaceLabel = workspace === undefined ? "Navigation" : this.workspaces[workspace].label;
            context.textContent = `${workspaceLabel} · ${task.description}`;
            button.append(context);
            this.results.append(button);
            return button;
        });
        if (!this.matches.length) {
            const empty = document.createElement("p");
            empty.textContent = "No matching tools.";
            this.results.append(empty);
        }
        this.highlight(0);
    }

    private highlight(index: number): void {
        this.highlighted = index;
        this.resultButtons.forEach((button, i) => { button.dataset.highlighted = String(i === index); });
    }

    private readonly onFinderKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
            event.preventDefault();
            this.closeFinder();
        } else if (event.target === this.search && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const next = this.highlighted + (event.key === "ArrowDown" ? 1 : -1);
            this.highlight(Math.max(0, Math.min(this.matches.length - 1, next)));
            this.resultButtons[this.highlighted]?.scrollIntoView?.({ block: "nearest" });
        } else if (event.target === this.search && event.key === "Enter") {
            event.preventDefault();
            this.runMatch(this.highlighted);
        } else if (event.key === "Tab") {
            const focusable = [...this.finder.querySelectorAll<HTMLElement>("input, button")];
            const boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
            if (event.target === boundary) {
                event.preventDefault();
                (event.shiftKey ? focusable.at(-1) : focusable[0])?.focus();
            }
        }
    };

    private readonly onFinderShortcut = (event: KeyboardEvent): void => {
        if (!this.bar.isConnected || event.defaultPrevented || !(event.ctrlKey || event.metaKey) ||
            event.altKey || event.key.toLowerCase() !== "k") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (this.finder.hidden) this.openFinder();
        else this.closeFinder();
    };

}

