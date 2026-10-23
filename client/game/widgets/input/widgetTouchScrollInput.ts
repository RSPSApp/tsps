import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";

/** scrollbar_vertical's wheel handler (36): (scrollbar, layer, step), set on the layer by 31. */
const SCROLLBAR_WHEEL_SCRIPT = 36;
/** Its scroll-to (37): (scrollbar, layer, scrollY, 1) sets the layer's scroll and moves the thumb. */
const SCROLLBAR_SCROLL_TO_SCRIPT = 37;
const MAX_PARENT_DEPTH = 16;

type ScrollLayer = {
    uid: number;
    type?: number;
    height?: number;
    scrollY?: number;
    scrollHeight?: number;
    parentUid?: number;
    hidden?: boolean;
    isHidden?: boolean;
    _absHeight?: number;
    onScroll?: any[];
    eventHandlers?: { onScroll?: { scriptId: number; intArgs: number[] } };
};

// Swipe state, anchored to where the swipe started so nothing accumulates.
let touchDrag: { layerUid: number; startY: number; startScrollY: number } | null = null;

/**
 * A layer the cache wired to a scrollbar (scrollbar_vertical), with something to scroll. Only
 * those: a full-screen layer that merely reports a scroll height would take every swipe from
 * the camera.
 */
function isScrollable(widget: ScrollLayer | undefined): boolean {
    if (!widget || widget.hidden || widget.isHidden || (widget.type ?? 0) !== 0) return false;
    return (widget.scrollHeight ?? 0) > (widget.height ?? 0) && scrollbarOf(widget) !== undefined;
}

/** The scrollable layer under the finger: the topmost hit, or the nearest ancestor of one. */
function findScrollLayer(
    hits: readonly any[] | undefined,
    widgetManager: WidgetManager,
): ScrollLayer | undefined {
    if (!hits) return undefined;
    for (let i = hits.length - 1; i >= 0; i--) {
        let current: ScrollLayer | undefined = hits[i];
        for (let depth = 0; current && depth < MAX_PARENT_DEPTH; depth++) {
            if (isScrollable(current)) return current as ScrollLayer;
            const parentUid = current.parentUid;
            if (typeof parentUid !== "number" || parentUid < 0) break;
            current = widgetManager.getWidgetByUid(parentUid) as ScrollLayer | undefined;
        }
    }
    return undefined;
}

/** The scrollbar scrollbar_vertical wired to this layer, from the wheel listener it set. */
function scrollbarOf(layer: ScrollLayer): number | undefined {
    const handler = layer.eventHandlers?.onScroll;
    if (handler?.scriptId === SCROLLBAR_WHEEL_SCRIPT) return handler.intArgs[0];
    const listener = layer.onScroll;
    if (Array.isArray(listener) && listener[0] === SCROLLBAR_WHEEL_SCRIPT && typeof listener[1] === "number") {
        return listener[1];
    }
    return undefined;
}

/**
 * Touch has no held button (a one-finger drag orbits the camera), so the cache's scrollbar
 * drag never runs: a swipe that starts on a scrolling layer scrolls it instead, through its
 * scrollbar's own script so the thumb follows. Returns true while it owns the swipe.
 */
export function processWidgetTouchScroll(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
): boolean {
    const { input } = frame;
    if (!input.isTouch || !input.mouseWheelDown) {
        touchDrag = null;
        return false;
    }

    let layer: ScrollLayer | undefined;
    if (touchDrag) {
        layer = widgetManager.getWidgetByUid(touchDrag.layerUid) as ScrollLayer | undefined;
        if (!layer || !isScrollable(layer)) {
            touchDrag = null;
            return false;
        }
    } else {
        layer = findScrollLayer(frame.hits, widgetManager);
        if (!layer) return false;
    }
    widgetManager.ensureLayout(layer as never);

    // The pointer is in canvas pixels, sizes are logical (scaled UI / HiDPI).
    const height = Math.max(0, (layer.height ?? 0) | 0);
    const absHeight = layer._absHeight ?? 0;
    const scaleY = absHeight > 0 && height > 0 ? absHeight / height : 1;
    const my = frame.my / scaleY;
    if (!touchDrag) {
        touchDrag = { layerUid: layer.uid, startY: my, startScrollY: (layer.scrollY ?? 0) | 0 };
    }

    const maxScrollY = Math.max(0, ((layer.scrollHeight ?? 0) | 0) - height);
    const next = Math.min(Math.max(0, Math.round(touchDrag.startScrollY - (my - touchDrag.startY))), maxScrollY);
    if (((layer.scrollY ?? 0) | 0) !== next) {
        deps.executeScriptListener(layer, [SCROLLBAR_SCROLL_TO_SCRIPT, scrollbarOf(layer), layer.uid, next, 1]);
    }
    input.consumeCameraDrag();
    return true;
}
