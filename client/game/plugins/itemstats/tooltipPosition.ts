/** Place a tooltip in renderer-canvas pixels relative to the pointer. */
export function positionTooltip(
    pointerX: number,
    pointerY: number,
    canvasWidth: number,
    canvasHeight: number,
    tooltipWidth: number,
    tooltipHeight: number,
    interactionBounds: { x: number; y: number; w: number; h: number },
    scale: number | { x: number; y: number } = 1,
): { x: number; y: number } {
    const scaleX = typeof scale === "number" ? scale : scale.x;
    const scaleY = typeof scale === "number" ? scale : scale.y;
    const gapX = 8 * scaleX, gapY = 8 * scaleY;
    const bounds = { x: 2 * scaleX, y: 2 * scaleY, right: canvasWidth - 2 * scaleX, bottom: canvasHeight - 2 * scaleY };
    const clampX = (x: number) => Math.max(bounds.x, Math.min(bounds.right - tooltipWidth, x));
    const clampY = (y: number) => Math.max(bounds.y, Math.min(bounds.bottom - tooltipHeight, y));
    const overlapsInteraction = (x: number, y: number) =>
        x < interactionBounds.x + interactionBounds.w && x + tooltipWidth > interactionBounds.x &&
        y < interactionBounds.y + interactionBounds.h && y + tooltipHeight > interactionBounds.y;

    const preferredX = clampX(pointerX - tooltipWidth / 2);
    const candidates = [
        { x: preferredX, y: interactionBounds.y + interactionBounds.h + gapY },
        { x: preferredX, y: interactionBounds.y - tooltipHeight - gapY },
        { x: interactionBounds.x + interactionBounds.w + gapX, y: pointerY - tooltipHeight / 2 },
        { x: interactionBounds.x - tooltipWidth - gapX, y: pointerY - tooltipHeight / 2 },
    ];
    for (const candidate of candidates) {
        const x = clampX(candidate.x);
        const y = clampY(candidate.y);
        if (!overlapsInteraction(x, y)) return { x, y };
    }

    // If the viewport is too small to keep clear space, choose the candidate with
    // the least overlap rather than making the item tooltip disappear.
    const fallback = [
        { x: preferredX, y: interactionBounds.y + interactionBounds.h + gapY },
        { x: preferredX, y: interactionBounds.y - tooltipHeight - gapY },
        { x: interactionBounds.x + interactionBounds.w + gapX, y: pointerY - tooltipHeight / 2 },
        { x: interactionBounds.x - tooltipWidth - gapX, y: pointerY - tooltipHeight / 2 },
    ].map(({ x, y }) => ({ x: clampX(x), y: clampY(y) }));
    const overlapArea = ({ x, y }: { x: number; y: number }) => {
        const overlapW = Math.max(0, Math.min(x + tooltipWidth, interactionBounds.x + interactionBounds.w) -
            Math.max(x, interactionBounds.x));
        const overlapH = Math.max(0, Math.min(y + tooltipHeight, interactionBounds.y + interactionBounds.h) -
            Math.max(y, interactionBounds.y));
        return overlapW * overlapH;
    };
    return fallback.reduce((best, candidate) => overlapArea(candidate) < overlapArea(best) ? candidate : best);
}

/** Conservative two-line reserve based on the cache mouseover widget's observed placement. */
export function fallbackInteractionBounds(
    pointerX: number,
    pointerY: number,
    canvasWidth: number,
    canvasHeight: number,
    scale: number | { x: number; y: number } = 1,
): { x: number; y: number; w: number; h: number } {
    const scaleX = typeof scale === "number" ? scale : scale.x;
    const scaleY = typeof scale === "number" ? scale : scale.y;
    const w = Math.max(1, Math.min(240 * scaleX, canvasWidth));
    const h = Math.max(1, Math.min(52 * scaleY, canvasHeight));
    return {
        x: Math.max(0, Math.min(canvasWidth - w, pointerX - 24 * scaleX)),
        y: Math.max(0, Math.min(canvasHeight - h, pointerY + 32 * scaleY)),
        w,
        h,
    };
}

export function findInteractionTextBounds(
    widgets: any[],
    actionText: string,
    scale: number | { x: number; y: number } = 1,
): { x: number; y: number; w: number; h: number } | undefined {
    const scaleX = typeof scale === "number" ? scale : scale.x;
    const scaleY = typeof scale === "number" ? scale : scale.y;
    const normalizedAction = normalizeText(actionText);
    if (!normalizedAction) return undefined;
    const seen = new Set<any>();
    const candidates: { text: string; bounds: { x: number; y: number; w: number; h: number } }[] = [];
    const visit = (widget: any, inheritedHidden = false): void => {
        if (!widget || seen.has(widget)) return;
        seen.add(widget);
        const hidden = inheritedHidden || widget.hidden === true || widget.isHidden === true;
        if (!hidden) {
            const text = normalizeText(String(widget.text ?? ""));
            const x = Number(widget._absX), y = Number(widget._absY);
            const w = Number(widget._absWidth), h = Number(widget._absHeight);
            if (text && [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
                candidates.push({ text, bounds: { x, y, w, h } });
            }
        }
        for (const child of widget.children ?? []) visit(child, hidden);
    };
    for (const widget of widgets) visit(widget);
    const action = candidates.find(({ text }) => text.includes(normalizedAction));
    if (!action) return undefined;
    const related = candidates.filter(({ text, bounds }) => text.includes(normalizedAction) ||
        (text.includes("option") && Math.abs(bounds.y - action.bounds.y) <= 80 * scaleY &&
            Math.abs(bounds.x - action.bounds.x) <= 300 * scaleX));
    const left = Math.min(...related.map(({ bounds }) => bounds.x));
    const top = Math.min(...related.map(({ bounds }) => bounds.y));
    const right = Math.max(...related.map(({ bounds }) => bounds.x + bounds.w));
    const bottom = Math.max(...related.map(({ bounds }) => bounds.y + bounds.h));
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Bounds of the cache-driven mouseover widget, built by timer script 4725. */
export function findMouseoverTimerBounds(
    timerWidgets: any[],
    getStaticChildren?: (uid: number) => any[],
    scale: number | { x: number; y: number } = 1,
): { x: number; y: number; w: number; h: number } | undefined {
    const scaleX = typeof scale === "number" ? scale : scale.x;
    const scaleY = typeof scale === "number" ? scale : scale.y;
    const timerRoots = timerWidgets.filter((widget) => {
        const onTimerScript = Array.isArray(widget?.onTimer) ? widget.onTimer[0] : widget?.eventHandlers?.onTimer?.scriptId;
        return Number(onTimerScript) === 4725;
    });
    if (timerRoots.length === 0) return undefined;

    const seen = new Set<any>();
    const textBounds: { x: number; y: number; w: number; h: number }[] = [];
    const visit = (widget: any, inheritedHidden = false): void => {
        if (!widget || seen.has(widget)) return;
        seen.add(widget);
        const hidden = inheritedHidden || widget.hidden === true || widget.isHidden === true;
        if (hidden) return;
        const x = Number(widget._absX), y = Number(widget._absY);
        const w = Number(widget._absWidth), h = Number(widget._absHeight);
        if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
            const bounds = { x, y, w, h };
            if ((typeof widget.text === "string" && widget.text.trim()) ||
                (typeof widget.text2 === "string" && widget.text2.trim())) textBounds.push(bounds);
        }
        for (const child of widget.children ?? []) visit(child, hidden);
        if (typeof widget.uid === "number") {
            for (const child of getStaticChildren?.(widget.uid) ?? []) visit(child, hidden);
        }
    };
    for (const root of timerRoots) visit(root);
    // Timer roots often have zero-sized or viewport-sized layout bounds. Only trust
    // measured text children; callers reserve a small area near the pointer otherwise.
    const bounds = textBounds.filter(({ x, y, w, h }) => x >= 0 && y >= 0 && w <= 600 * scaleX && h <= 80 * scaleY);
    if (bounds.length === 0) return undefined;
    const left = Math.min(...bounds.map(({ x }) => x));
    const top = Math.min(...bounds.map(({ y }) => y));
    const right = Math.max(...bounds.map(({ x, w }) => x + w));
    const bottom = Math.max(...bounds.map(({ y, h }) => y + h));
    return { x: left, y: top, w: right - left, h: bottom - top };
}

function normalizeText(text: string): string {
    return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
