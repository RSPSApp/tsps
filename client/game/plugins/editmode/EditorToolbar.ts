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
            // Clear the editor's top bar (48px) with an 8px gap.
            top: "56px",
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
        const bounds = button.getBoundingClientRect();
        const tooltip = document.createElement("div");
        tooltip.textContent = label;
        Object.assign(tooltip.style, {
            position: "fixed",
            left: `${bounds.right + 8}px`,
            top: `${bounds.top + bounds.height / 2}px`,
            transform: "translateY(-50%)",
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
        this.tooltip = tooltip;
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

export const createSearchIcon = (): SVGElement => createActionIcon("M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm4.5 10.5L20 20");

export const createConfigIcon = (): SVGElement =>
    createActionIcon(
        "M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Zm8 3.3-2-.7a6.2 6.2 0 0 0-.5-1.2l.9-1.9-1.7-1.7-1.9.9a6.2 6.2 0 0 0-1.2-.5L13 5h-2l-.6 1.9a6.2 6.2 0 0 0-1.2.5l-1.9-.9-1.7 1.7.9 1.9a6.2 6.2 0 0 0-.5 1.2l-2 .7v2.4l2 .7a6.2 6.2 0 0 0 .5 1.2l-.9 1.9 1.7 1.7 1.9-.9a6.2 6.2 0 0 0 1.2.5L11 21h2l.6-1.9a6.2 6.2 0 0 0 1.2-.5l1.9.9 1.7-1.7-.9-1.9a6.2 6.2 0 0 0 .5-1.2l2-.7v-2.4Z",
    );

export const createCloseIcon = (): SVGElement => createActionIcon("M6 6l12 12M18 6 6 18");

export const createWorldMapIcon = (): SVGElement =>
    createActionIcon(
        "M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16",
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
    createActionIcon("M20 11a8 8 0 0 0-14.7-4L3 10m0 0V4m0 6h6M4 13a8 8 0 0 0 14.7 4L21 14m0 0v6m0-6h-6");

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
    createActionIcon("M5 10v10h14V10M4 10h16l-2-6H6l-2 6Zm5 10v-6h6v6M7 10v2m5-2v2m5-2v2");

export const createTrashIcon = (): SVGElement => createActionIcon("M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 14h10l1-14", "none");
