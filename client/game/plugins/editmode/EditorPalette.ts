import { createConfigIcon } from "./EditorToolbar";

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
}

export class EditorPalette {
    private readonly element: HTMLDivElement;
    private readonly input: HTMLInputElement;
    private readonly results: HTMLDivElement;
    private readonly modeButtons: Record<PaletteMode, HTMLButtonElement>;
    private mode: PaletteMode = "npc";
    private selectedId = -1;

    public constructor(private readonly options: EditorPaletteOptions) {
        this.element = document.createElement("div");
        this.element.dataset.mapEditor = "search";
        Object.assign(this.element.style, {
            position: "fixed",
            left: "62px",
            top: "112px",
            zIndex: "10002",
            display: "none",
            width: "310px",
            padding: "10px",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            borderRadius: "6px",
            color: "#eef4ff",
            background: "rgba(18, 20, 24, 0.97)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.42)",
            font: "13px/1.4 sans-serif",
        });

        const modeToggle = document.createElement("div");
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

        this.element.append(modeToggle, this.input, this.results);
        this.element.addEventListener("mousedown", (event) => event.stopPropagation());
        this.element.addEventListener("click", (event) => event.stopPropagation());
        document.body.appendChild(this.element);
        this.renderModeButtons();
    }

    public setVisible(visible: boolean): void {
        this.element.style.display = visible ? "block" : "none";
        if (visible) this.input.focus();
    }

    public isVisible(): boolean {
        return this.element.style.display !== "none";
    }

    public setMode(mode: PaletteMode): void {
        this.mode = mode;
        const label = mode === "npc" ? "NPC" : mode === "loc" ? "object" : "item";
        this.input.placeholder = `Search ${label} name or ID`;
        this.renderModeButtons();
    }

    public setSelectedId(id: number): void {
        this.selectedId = id;
    }

    public renderResults(results: PaletteResult[], loading: boolean): void {
        this.results.replaceChildren();
        if (loading) {
            this.results.appendChild(this.createMessageRow("Indexing the cache…"));
            return;
        }
        if (results.length === 0) {
            const query = this.input.value.trim();
            const label = this.mode === "npc" ? "NPC" : this.mode === "loc" ? "object" : "item";
            this.results.appendChild(this.createMessageRow(query.length === 0 ? `Type an ${label} name or cache ID.` : `No matching ${label}s.`));
            return;
        }
        for (const result of results) {
            this.results.appendChild(this.createResultRow(result));
        }
    }

    public remove(): void {
        this.element.remove();
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
            minHeight: "34px",
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
            if (result.id !== this.selectedId) row.style.background = "rgba(255, 255, 255, 0.08)";
        });
        row.addEventListener("mouseleave", () => {
            if (result.id !== this.selectedId) row.style.background = "transparent";
        });
        pick.addEventListener("click", () => {
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
