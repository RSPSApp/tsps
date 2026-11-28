/**
 * Shared map-editor icons, tooltips and menu clearance.
 */

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

// RSPSi menu height.
export const EDITOR_TOP_BAR_HEIGHT = 41;
/** Where floating chrome starts: the top bar plus an 8px gap. The rail and right panels share it. */
export const EDITOR_TOP_BAR_CLEARANCE = `${EDITOR_TOP_BAR_HEIGHT + 8}px`;

export const createPointerIcon = (): SVGElement =>
    createActionIcon("M3.5 3.5 20.5 10.6 13.1 13.1 10.6 20.5 3.5 3.5Z");

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
// circles drawn as arcs.
export const createConfigIcon = (): SVGElement =>
    createActionIcon(
        "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    );

export const createHammerIcon = (): SVGElement =>
    createActionIcon("m15 12-8.4 8.4a2.12 2.12 0 0 1-3-3L12 9m6 6 4-4M14 3l7 7-4 4-7-7 4-4ZM9 8l3-3");

const createCloseIcon = (): SVGElement => createActionIcon("M6 6l12 12M18 6 6 18");

export function createEditorCloseButton(label: string, onClose: () => void): HTMLButtonElement {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "rspsi-panel-close";
    close.title = label;
    close.setAttribute("aria-label", label);
    close.appendChild(createCloseIcon());
    Object.assign(close.style, {
        width: "24px", height: "24px", display: "grid", placeItems: "center", padding: "0",
        border: "0", color: "#aeb8c8", background: "transparent", cursor: "pointer",
    });
    close.addEventListener("click", onClose);
    return close;
}

export const createCameraIcon = (): SVGElement =>
    createActionIcon("M4 8h3l1.5-2h7L17 8h3v11H4V8Zm8 8a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z");

export const createSaveIcon = (): SVGElement =>
    createActionIcon("M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8V3");

export const createRefreshIcon = (): SVGElement =>
    createActionIcon("M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16M16 16h5v5");

export const createUndoIcon = (): SVGElement =>
    createActionIcon("M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11");

export const createRedoIcon = (): SVGElement =>
    createActionIcon("M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13");

export const createRotateIcon = (): SVGElement =>
    createActionIcon("M20 11a8 8 0 0 0-14.8-4L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.8 4L21 15m0 0v5m0-5h-5");

export const createMoveIcon = (): SVGElement =>
    createActionIcon("M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4");

export const createDuplicateIcon = (): SVGElement =>
    createActionIcon("M8 8h11v11H8zM5 16H4V4h12v1", "none");

export const createLayersIcon = (): SVGElement =>
    createActionIcon("M4 7l8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4");

export const createEraserIcon = (): SVGElement => {
    const icon = createActionIcon("m9 20-6-6L14 3a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3L11 20H9ZM7 10l7 7M11 20h10");
    const tip = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tip.setAttribute("d", "m7 10 7 7-3 3H9l-6-6 4-4Z");
    tip.setAttribute("fill", "currentColor");
    tip.setAttribute("opacity", "0.3");
    icon.prepend(tip);
    return icon;
};

export const createHeightIcon = (): SVGElement =>
    createActionIcon("M2 20c4 0 4-9 9-9s5 9 11 9M16 10V2m-3 3 3-3 3 3");

export const createFlagIcon = (): SVGElement =>
    createActionIcon("M4 22V3m0 0c6-4 10 4 16 0v11c-6 4-10-4-16 0");

const createPaintBrushIcon = (paint: string, color: string): SVGElement => {
    const icon = createActionIcon("m10 12 8-9a2.1 2.1 0 0 1 3 3l-9 8M9 11l4 4M10 13c-5-2-4 6-8 7 7 3 11-2 10-5");
    const pigment = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pigment.setAttribute("d", paint);
    pigment.setAttribute("fill", color);
    pigment.setAttribute("stroke", color);
    pigment.setAttribute("stroke-width", "1.2");
    pigment.setAttribute("stroke-linejoin", "round");
    icon.append(pigment);
    return icon;
};

export const createOverlayBrushIcon = (): SVGElement =>
    createPaintBrushIcon("M19 13c-1 2-3 4-3 6a3 3 0 0 0 6 0c0-2-2-4-3-6Z", "#71b8ed");

export const createUnderlayBrushIcon = (): SVGElement =>
    createPaintBrushIcon("M16 17h6v5h-6Z", "#e8b75d");

export const createPaintIcon = (): SVGElement =>
    createActionIcon("M14 4.5 19.5 10l-9.8 9.8a3 3 0 0 1-4.2-4.2L15.3 5.8M4 20h5");

// Lucide paint-bucket (ISC, https://lucide.dev/icons/paint-bucket).
let overlayShapeClipCount = 0;

/**
 * One tile from above, north up. The part of the tile a shape's overlay covers shows the paint;
 * the pale rest stands in for the underlay, so a shape reads even in a dark paint.
 */
export const createOverlayShapeIcon = (
    triangles: readonly (readonly [number, number])[][],
    color: string,
    texture?: string,
): SVGElement => {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("width", "26");
    svg.setAttribute("height", "26");
    svg.setAttribute("aria-hidden", "true");
    const tile = document.createElementNS(namespace, "rect");
    tile.setAttribute("width", "1");
    tile.setAttribute("height", "1");
    tile.setAttribute("fill", "#cbd5e1");
    tile.setAttribute("fill-opacity", "0.35");
    svg.appendChild(tile);
    const clipPath = document.createElementNS(namespace, "clipPath");
    clipPath.id = `overlay-shape-clip-${overlayShapeClipCount++}`;
    for (const triangle of triangles) {
        const polygon = document.createElementNS(namespace, "polygon");
        polygon.setAttribute("points", triangle.map(([x, y]) => `${x},${1 - y}`).join(" "));
        clipPath.appendChild(polygon);
    }
    svg.appendChild(clipPath);
    const paint = document.createElementNS(namespace, texture ? "image" : "rect");
    paint.setAttribute("width", "1");
    paint.setAttribute("height", "1");
    paint.setAttribute("clip-path", `url(#${clipPath.id})`);
    if (texture) {
        paint.setAttribute("href", texture);
        paint.setAttribute("preserveAspectRatio", "none");
    } else {
        paint.setAttribute("fill", color);
    }
    svg.appendChild(paint);
    return svg;
};

export const createOverlayIcon = (colorRgb = 0x64748b, texture?: string): SVGElement => {
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
    if (texture) {
        const image = document.createElementNS(namespace, "image");
        image.setAttribute("x", "4");
        image.setAttribute("y", "4");
        image.setAttribute("width", "16");
        image.setAttribute("height", "16");
        image.setAttribute("href", texture);
        svg.appendChild(image);
        rect.setAttribute("fill", "none");
    }
    svg.appendChild(rect);
    return svg;
};

export const createTrashIcon = (): SVGElement => createActionIcon("M5 7h14M10 11v6m4-6v6M9 7V4h6v3m-9 0 1 14h10l1-14", "none");

export const createReviewIcon = (): SVGElement =>
    createActionIcon("M7 3h7l5 5v13H5V3h2m7 0v5h5M8 12h8m-8 4h8");
