/**
 * Ported from the elvarg-web-client map editor so the editor keeps its own
 * chrome: a fixed icon rail, dark panel, blue active state. Plain DOM, no React
 * or leva, which is also what keeps it out of the player-facing UI.
 */

export interface EditorTool {
    id: string;
    label: string;
    icon: () => SVGElement;
    action?: () => void;
    dividerBefore?: boolean;
}

/**
 * The editor's dark hover tooltip, beside (`right`) or under (`below`) its anchor.
 * Shared by the tool rail and the top bar; remove the returned element to hide it.
 */
export function showEditorTooltip(anchor: HTMLElement, label: string, side: "right" | "below" = "right"): HTMLDivElement {
    const bounds = anchor.getBoundingClientRect();
    const tooltip = document.createElement("div");
    tooltip.textContent = label;
    Object.assign(tooltip.style, {
        position: "fixed",
        ...(side === "right"
            ? { left: `${bounds.right + 8}px`, top: `${bounds.top + bounds.height / 2}px`, transform: "translateY(-50%)" }
            : { left: `${bounds.left + bounds.width / 2}px`, top: `${bounds.bottom + 8}px`, transform: "translateX(-50%)" }),
        zIndex: "10003",
        padding: "5px 8px",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        borderRadius: "4px",
        color: "#eef4ff",
        background: "rgba(18, 20, 24, 0.97)",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.35)",
        font: "12px sans-serif",
        whiteSpace: "nowrap",
        pointerEvents: "none",
    });
    document.body.appendChild(tooltip);
    return tooltip;
}

// Matches /host's panel headings (57px, 12px padding) so the editor sits flush in it.
export const EDITOR_TOP_BAR_HEIGHT = 56;
/** Where floating chrome starts: the top bar plus an 8px gap. The rail and right panels share it. */
export const EDITOR_TOP_BAR_CLEARANCE = `${EDITOR_TOP_BAR_HEIGHT + 8}px`;

export class EditorToolbar {
    private readonly element: HTMLDivElement;
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private activeToolId: string;
    private tooltip?: HTMLDivElement;

    public constructor(tools: EditorTool[], initialToolId: string, onToolChange: (toolId: string) => void) {
        this.activeToolId = initialToolId;
        this.element = document.createElement("div");
        this.element.dataset.mapEditor = "toolbar";
        this.element.setAttribute("role", "toolbar");
        this.element.setAttribute("aria-label", "Map editor tools");

        Object.assign(this.element.style, {
            position: "fixed",
            left: "12px",
            // Level with the right-hand panels, below the top bar.
            top: EDITOR_TOP_BAR_CLEARANCE,
            zIndex: "10001",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: "5px",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            borderRadius: "6px",
            background: "rgba(31, 34, 39, 0.96)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
        });

        for (const tool of tools) {
            if (tool.dividerBefore) {
                const divider = document.createElement("div");
                Object.assign(divider.style, {
                    height: "1px",
                    margin: "3px 2px",
                    background: "rgba(255, 255, 255, 0.18)",
                });
                this.element.appendChild(divider);
            }
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("aria-label", tool.label);
            button.appendChild(tool.icon());
            Object.assign(button.style, {
                width: "34px",
                height: "34px",
                display: "grid",
                placeItems: "center",
                padding: "0",
                border: "1px solid transparent",
                borderRadius: "4px",
                color: "#d9dde5",
                background: "transparent",
                cursor: "pointer",
            });
            button.addEventListener("mouseenter", () => this.showTooltip(button, tool.label));
            button.addEventListener("mouseleave", () => this.hideTooltip());
            button.addEventListener("focus", () => this.showTooltip(button, tool.label));
            button.addEventListener("blur", () => this.hideTooltip());
            button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                if (tool.action) {
                    tool.action();
                    return;
                }
                this.select(tool.id);
                onToolChange(tool.id);
            });
            this.buttons.set(tool.id, button);
            this.element.appendChild(button);
        }

        document.body.appendChild(this.element);
        this.renderActiveTool();
    }

    public select(toolId: string) {
        if (!this.buttons.has(toolId)) {
            return;
        }
        this.activeToolId = toolId;
        this.renderActiveTool();
    }

    public setDisabled(toolId: string, disabled: boolean) {
        const button = this.buttons.get(toolId);
        if (!button) return;
        button.disabled = disabled;
        button.style.cursor = disabled ? "wait" : "pointer";
        button.style.opacity = disabled ? "0.5" : "1";
    }

    public setIcon(toolId: string, icon: () => SVGElement) {
        const button = this.buttons.get(toolId);
        if (!button) return;
        button.replaceChildren(icon());
    }

    public remove() {
        this.hideTooltip();
        this.element.remove();
        this.buttons.clear();
    }

    private showTooltip(button: HTMLButtonElement, label: string): void {
        this.hideTooltip();
        this.tooltip = showEditorTooltip(button, label);
    }

    private hideTooltip(): void {
        this.tooltip?.remove();
        this.tooltip = undefined;
    }

    private renderActiveTool() {
        this.buttons.forEach((button, toolId) => {
            const active = toolId === this.activeToolId;
            button.setAttribute("aria-pressed", String(active));
            button.style.color = active ? "#ffffff" : "#d9dde5";
            button.style.background = active ? "#3b82f6" : "transparent";
            button.style.borderColor = active ? "#70a5ff" : "transparent";
        });
    }
}

export const createPointerIcon = (): SVGElement => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "19");
    svg.setAttribute("height", "19");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", "M5 3.8v14.7l4.1-3.8 2.7 5.5 2.3-1.1-2.7-5.4h5.6L5 3.8Z");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "#15171a");
    path.setAttribute("stroke-width", "1.15");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);

    return svg;
};

const createActionIcon = (pathData: string, fill = "none"): SVGElement => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "17");
    svg.setAttribute("height", "17");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", fill);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.9");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
};

// Lucide icons (ISC, https://lucide.dev/icons/<name>), each element joined into one path with
// circles drawn as arcs: person-standing, box, settings, map, refresh-ccw, store.
export const createNpcIcon = (): SVGElement =>
    createActionIcon("M13 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 20l3-6 3 6M6 8l6 2 6-2M12 10v4");

export const createObjectIcon = (): SVGElement =>
    createActionIcon(
        "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12",
    );

export const createConfigIcon = (): SVGElement =>
    createActionIcon(
        "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    );

export const createCloseIcon = (): SVGElement => createActionIcon("M6 6l12 12M18 6 6 18");

export const createWorldMapIcon = (): SVGElement =>
    createActionIcon(
        "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0zM15 5.764v15M9 3.236v15",
    );

export const createSpawnIcon = (): SVGElement =>
    createActionIcon("M12 21s7-5.2 7-11A7 7 0 1 0 5 10c0 5.8 7 11 7 11Zm0-8a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z");

export const createCameraIcon = (): SVGElement =>
    createActionIcon("M4 8h3l1.5-2h7L17 8h3v11H4V8Zm8 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z");

export const createDownloadIcon = (): SVGElement =>
    createActionIcon("M12 3v11m0 0-4-4m4 4 4-4M5 17v4h14v-4");

export const createSaveIcon = (): SVGElement =>
    createActionIcon("M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8V3");

export const createRefreshIcon = (): SVGElement =>
    createActionIcon("M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M16 16h5v5");

export const createRotateIcon = (): SVGElement =>
    createActionIcon("M20 11a8 8 0 0 0-14.8-4L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.8 4L21 15m0 0v5m0-5h-5");

export const createDuplicateIcon = (): SVGElement =>
    createActionIcon("M8 8h11v11H8zM5 16H4V4h12v1", "none");

export const createLayersIcon = (): SVGElement =>
    createActionIcon("M4 7l8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4");

export const createPaintIcon = (): SVGElement =>
    createActionIcon("M14 4.5 19.5 10l-9.8 9.8a3 3 0 0 1-4.2-4.2L15.3 5.8M4 20h5");

export const createOverlayIcon = (colorRgb = 0x64748b): SVGElement => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "19");
    svg.setAttribute("height", "19");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS(namespace, "rect");
    rect.setAttribute("x", "4");
    rect.setAttribute("y", "4");
    rect.setAttribute("width", "16");
    rect.setAttribute("height", "16");
    rect.setAttribute("rx", "2");
    rect.setAttribute("fill", `#${(colorRgb & 0xffffff).toString(16).padStart(6, "0")}`);
    rect.setAttribute("stroke", "currentColor");
    rect.setAttribute("stroke-width", "1.5");
    svg.appendChild(rect);
    return svg;
};

export const createPathIcon = (): SVGElement => createActionIcon("M5 19c2.5-6 5-9 9-9 2.2 0 3.8-1.7 5-5M5 19h5m-5 0v-5M19 5h-5m5 0v5");

export const createShopIcon = (): SVGElement =>
    createActionIcon(
        "M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05",
    );

export const createTrashIcon = (): SVGElement => createActionIcon("M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 14h10l1-14", "none");
