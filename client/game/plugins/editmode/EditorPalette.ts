import { createCloseIcon, createConfigIcon, EDITOR_TOP_BAR_CLEARANCE } from "./EditorToolbar";

/**
 * Search palette ported from elvarg-web-client: NPC/object/item modes, cache
 * rows, and a separate definition inspector action.
 */

export interface PaletteResult {
    id: number;
    name: string;
}

export type PaletteMode = "npc" | "loc" | "item";

export interface EditorPaletteOptions {
    onModeChange: (mode: PaletteMode) => void;
    onQueryChange: (query: string) => void;
    onPick: (id: number) => void;
    onInspect: (id: number) => void;
    onClose: () => void;
    loadThumbnail?: (kind: PaletteMode, id: number) => Promise<string | undefined>;
}

export class EditorPalette {
    private readonly element: HTMLDivElement;
    private readonly input: HTMLInputElement;
    private readonly results: HTMLDivElement;
    private readonly objectControls: HTMLDivElement;
    private readonly modeToggle = document.createElement("div");
    private readonly ghostHeader = document.createElement("div");
    private readonly ghostTitle = document.createElement("strong");
    private readonly modeButtons: Record<PaletteMode, HTMLButtonElement>;
    private mode: PaletteMode = "npc";
    private selectedId = -1;
    private readonly recent = new Map<PaletteMode, PaletteResult[]>();
    private readonly thumbnailCache = new Map<string, string>();
    private readonly queuedThumbnails = new Set<HTMLImageElement>();
    private observer?: IntersectionObserver;
    private frame?: number;
    private rendering = false;
    private pickedForSet?: ReadonlySet<number>;
    private lastResults?: PaletteResult[];
    private lastLoading?: boolean;
    private lastMode?: PaletteMode;

    public constructor(private readonly options: EditorPaletteOptions) {
        this.element = document.createElement("div");
        this.element.dataset.mapEditor = "search";
        Object.assign(this.element.style, {
            position: "fixed",
            left: "var(--map-editor-panel-left, 62px)",
            top: EDITOR_TOP_BAR_CLEARANCE,
            zIndex: "10002",
            display: "none",
            width: "min(310px, calc(100vw - var(--map-editor-panel-left, 62px) - 13px))",
            boxSizing: "border-box",
            maxHeight: "calc(100dvh - 80px)",
            overflowY: "auto",
            padding: "10px",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: "6px",
            color: "#eef4ff",
            colorScheme: "dark",
            background: "rgba(18, 20, 24, 0.97)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.42)",
            font: "13px/1.4 sans-serif",
        });

        const modeToggle = this.modeToggle;
        Object.assign(modeToggle.style, {
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "4px",
            marginBottom: "8px",
        });
        this.modeButtons = {
            npc: this.createModeButton("NPCs", "npc"),
            loc: this.createModeButton("Objects", "loc"),
            item: this.createModeButton("Items", "item"),
        };
        for (const mode of ["loc", "npc", "item"] as const) {
            try {
                const recent: unknown = JSON.parse(localStorage.getItem(`map-editor:recent:${mode}`) ?? "[]");
                if (Array.isArray(recent)) this.recent.set(mode, recent.filter(({ id, name } = {}) =>
                    Number.isInteger(id) && typeof name === "string").slice(0, 8));
            } catch {
                // Browsing cache definitions still works when browser storage is disabled.
            }
        }
        modeToggle.append(this.modeButtons.npc, this.modeButtons.loc, this.modeButtons.item);

        this.input = document.createElement("input");
        this.input.type = "search";
        this.input.placeholder = "Search NPC name or ID";
        this.input.setAttribute("aria-label", "Search cache");
        Object.assign(this.input.style, {
            boxSizing: "border-box",
            width: "100%",
            height: "34px",
            padding: "6px 9px",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "4px",
            outline: "none",
            color: "#ffffff",
            background: "#111318",
            font: "13px sans-serif",
        });
        this.input.addEventListener("input", () => this.options.onQueryChange(this.input.value));
        // The client reads raw key events off the window; keep typing local.
        this.input.addEventListener("keydown", (event) => event.stopPropagation());
        this.input.addEventListener("keyup", (event) => event.stopPropagation());

        this.results = document.createElement("div");
        this.results.setAttribute("role", "listbox");
        Object.assign(this.results.style, {
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            maxHeight: "320px",
            marginTop: "8px",
            overflowY: "auto",
        });
        if (options.loadThumbnail && typeof window.IntersectionObserver === "function") {
            this.observer = new window.IntersectionObserver((entries) => {
                for (const entry of entries) {
                    const image = entry.target as HTMLImageElement;
                    if (entry.isIntersecting) this.queuedThumbnails.add(image);
                    else this.queuedThumbnails.delete(image);
                }
                this.scheduleThumbnail();
            }, { root: this.results, rootMargin: "48px" });
        }

        this.objectControls = document.createElement("div");
        this.objectControls.hidden = this.mode !== "loc";
        const close = document.createElement("button");
        close.type = "button";
        close.setAttribute("aria-label", "Close asset search");
        Object.assign(close.style, {
            display: "inline-grid", placeItems: "center", padding: "4px", cursor: "pointer",
            border: "1px solid #ffffff29", borderRadius: "4px", background: "#ffffff10", color: "inherit",
        });
        close.append(createCloseIcon());
        close.onclick = options.onClose;
        this.ghostHeader.append(this.ghostTitle, close);
        this.ghostHeader.style.marginBottom = "7px";
        this.ghostHeader.style.alignItems = "center";
        this.ghostHeader.style.justifyContent = "space-between";
        this.ghostHeader.style.display = "none";
        this.element.append(this.ghostHeader, modeToggle, this.objectControls, this.input, this.results);
        this.element.addEventListener("mousedown", (event) => event.stopPropagation());
        this.element.addEventListener("click", (event) => event.stopPropagation());
        document.body.appendChild(this.element);
        this.renderModeButtons();
    }

    public setVisible(visible: boolean): void {
        this.element.style.display = visible ? "block" : "none";
        if (visible) {
            this.input.focus();
            this.scheduleThumbnail();
        }
    }

    public setGhostLayout(ghost: boolean, scattering: boolean): void {
        this.element.style.left = ghost ? "auto" : "var(--map-editor-panel-left, 62px)";
        this.element.style.right = ghost ? "12px" : "auto";
        this.modeToggle.style.display = ghost ? "none" : "grid";
        this.ghostHeader.style.display = ghost ? "flex" : "none";
        this.ghostTitle.textContent = this.mode === "loc" ? (scattering ? "Scatter scenery" : "Place objects") :
            this.mode === "npc" ? "Place NPCs" : "Place ground items";
    }

    public isVisible(): boolean {
        return this.element.style.display !== "none";
    }

    public setMode(mode: PaletteMode): void {
        this.mode = mode;
        this.objectControls.hidden = mode !== "loc";
        const label = mode === "npc" ? "NPC" : mode === "loc" ? "object" : "item";
        this.input.placeholder = `Search ${label} name or ID`;
        this.renderModeButtons();
    }

    public setObjectControls(controls: HTMLElement): void {
        this.objectControls.replaceChildren(controls);
    }

    public setSelectedId(id: number): void {
        if (this.selectedId === id) return;
        this.selectedId = id;
        this.syncResultButtons();
    }

    public editScatterMembership(selected?: ReadonlySet<number>): void {
        this.pickedForSet = selected;
        this.syncResultButtons();
    }

    private syncResultButtons(): void {
        for (const row of this.results.querySelectorAll<HTMLElement>("[data-object-result]")) {
            const id = Number(row.dataset.objectResult);
            const picked = this.pickedForSet ? this.pickedForSet.has(id) : this.selectedId === id;
            row.setAttribute("aria-selected", String(picked));
            row.style.background = picked ? "#3b82f6" : "transparent";
            const name = row.querySelector<HTMLButtonElement>("[data-pick-result]")!;
            name.textContent = this.pickedForSet ? `${picked ? "✓ " : "+ "}${name.dataset.pickResult}` : name.dataset.pickResult!;
            if (this.pickedForSet) name.setAttribute("aria-pressed", String(picked));
            else name.removeAttribute("aria-pressed");
        }
    }

    public renderResults(results: PaletteResult[], loading: boolean): void {
        if (this.lastResults === results && this.lastMode === this.mode && this.lastLoading === loading) return;
        this.lastResults = results;
        this.lastMode = this.mode;
        this.lastLoading = loading;
        this.observer?.disconnect();
        this.queuedThumbnails.clear();
        this.results.replaceChildren();
        if (loading) {
            this.results.appendChild(this.createMessageRow("Indexing the cache…"));
            return;
        }
        if (results.length === 0) {
            const query = this.input.value.trim();
            const recent = this.recent.get(this.mode);
            if (!query && recent?.length) {
                this.results.append(this.createMessageRow("Recently used"));
                for (const result of recent) this.results.append(this.createResultRow(result));
                this.syncResultButtons();
                this.scheduleThumbnail();
                return;
            }
            const label = this.mode === "npc" ? "NPC" : this.mode === "loc" ? "object" : "item";
            this.results.appendChild(this.createMessageRow(query.length === 0 ? `Type an ${label} name or cache ID.` : `No matching ${label}s.`));
            return;
        }
        for (const result of results) {
            this.results.appendChild(this.createResultRow(result));
        }
        this.syncResultButtons();
        this.scheduleThumbnail();
    }

    public remove(): void {
        this.observer?.disconnect();
        this.queuedThumbnails.clear();
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.element.remove();
    }

    private scheduleThumbnail(): void {
        if (this.frame !== undefined || this.rendering || !this.isVisible() || !this.options.loadThumbnail) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            if (!this.element.isConnected || !this.isVisible()) return;
            const image = this.queuedThumbnails.values().next().value;
            if (!image) return;
            this.queuedThumbnails.delete(image);
            if (!image.isConnected) { this.scheduleThumbnail(); return; }
            this.observer?.unobserve(image);
            const id = Number(image.dataset.assetThumbnail);
            const kind = image.dataset.assetKind as PaletteMode;
            const key = `${kind}:${id}`;
            const cached = this.thumbnailCache.get(key);
            if (cached) {
                image.src = cached;
                image.style.visibility = "";
                this.scheduleThumbnail();
                return;
            }
            this.rendering = true;
            void this.options.loadThumbnail!(kind, id).then((imageUrl) => {
                if (!imageUrl) return;
                this.thumbnailCache.set(key, imageUrl);
                if (this.thumbnailCache.size > 192) this.thumbnailCache.delete(this.thumbnailCache.keys().next().value!);
                if (image.isConnected) {
                    image.src = imageUrl;
                    image.style.visibility = "";
                }
            }).catch(() => {}).finally(() => {
                this.rendering = false;
                this.scheduleThumbnail();
            });
        });
    }

    private createModeButton(label: string, mode: PaletteMode): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        Object.assign(button.style, {
            height: "27px",
            padding: "0 7px",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: "4px",
            color: "#cbd5e1",
            background: "rgba(255, 255, 255, 0.06)",
            cursor: "pointer",
            font: "12px sans-serif",
        });
        button.addEventListener("click", () => {
            this.setMode(mode);
            this.options.onModeChange(mode);
        });
        return button;
    }

    private renderModeButtons(): void {
        for (const [mode, button] of Object.entries(this.modeButtons)) {
            const active = mode === this.mode;
            button.setAttribute("aria-pressed", String(active));
            button.style.color = active ? "#ffffff" : "#cbd5e1";
            button.style.background = active ? "#3b82f6" : "rgba(255, 255, 255, 0.06)";
            button.style.borderColor = active ? "#70a5ff" : "rgba(255, 255, 255, 0.18)";
        }
    }

    private createMessageRow(text: string): HTMLDivElement {
        const row = document.createElement("div");
        row.textContent = text;
        Object.assign(row.style, { padding: "6px 8px", opacity: "0.7" });
        return row;
    }

    private createResultRow(result: PaletteResult): HTMLDivElement {
        const row = document.createElement("div");
        row.setAttribute("role", "option");
        const selected = result.id === this.selectedId;
        row.setAttribute("aria-selected", String(selected));
        Object.assign(row.style, {
            width: "100%",
            minHeight: this.options.loadThumbnail ? (this.mode === "item" ? "38px" : "48px") : "34px",
            flexShrink: "0",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            padding: "2px 4px 2px 8px",
            border: "1px solid transparent",
            borderRadius: "4px",
            color: "#e5e7eb",
            background: selected ? "#3b82f6" : "transparent",
            font: "13px sans-serif",
        });
        const pick = document.createElement("button");
        pick.type = "button";
        pick.textContent = `${result.id} · ${result.name}`;
        if (this.mode === "loc") {
            row.dataset.objectResult = String(result.id);
            pick.dataset.pickResult = pick.textContent;
        }
        if (this.options.loadThumbnail) {
            const image = document.createElement("img");
            image.dataset.assetThumbnail = String(result.id);
            image.dataset.assetKind = this.mode;
            if (this.mode === "loc") image.dataset.locThumbnail = String(result.id);
            image.alt = "";
            const size = this.mode === "item" ? "36px" : "46px";
            Object.assign(image.style, { width: size, height: size, flex: `0 0 ${size}`,
                objectFit: "contain", visibility: "hidden", borderRadius: "3px" });
            row.append(image);
            if (this.observer) this.observer.observe(image);
            else if (this.queuedThumbnails.size < 8) this.queuedThumbnails.add(image);
        }
        Object.assign(pick.style, {
            flex: "1",
            minWidth: "0",
            padding: "5px 0",
            border: "0",
            color: "inherit",
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
            textAlign: "left",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        });
        const inspect = document.createElement("button");
        inspect.type = "button";
        inspect.title = "Inspect cache definition";
        inspect.setAttribute("aria-label", `Inspect ${result.name}`);
        inspect.appendChild(createConfigIcon());
        Object.assign(inspect.style, {
            width: "24px",
            height: "24px",
            flex: "0 0 24px",
            padding: "0",
            border: "0",
            borderRadius: "3px",
            color: "#aeb8c8",
            background: "transparent",
            cursor: "pointer",
        });
        row.addEventListener("mouseenter", () => {
            if (row.getAttribute("aria-selected") !== "true") row.style.background = "rgba(255, 255, 255, 0.08)";
        });
        row.addEventListener("mouseleave", () => {
            if (row.getAttribute("aria-selected") !== "true") row.style.background = "transparent";
        });
        pick.addEventListener("click", () => {
            if (this.mode === "loc" && this.pickedForSet) { this.options.onPick(result.id); return; }
            const recent = [result, ...(this.recent.get(this.mode) ?? []).filter((item) => item.id !== result.id)].slice(0, 8);
            this.recent.set(this.mode, recent);
            this.lastResults = undefined;
            try { localStorage.setItem(`map-editor:recent:${this.mode}`, JSON.stringify(recent)); } catch {}
            this.setSelectedId(result.id);
            this.options.onPick(result.id);
        });
        inspect.addEventListener("click", (event) => {
            event.stopPropagation();
            this.options.onInspect(result.id);
        });
        row.append(pick, inspect);
        return row;
    }
}
