import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import type { WidgetInputControllerDeps, WidgetInputFrame, WidgetInputState } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

/** A widget's TS mouse listener (RuneLite's JavaScriptCallback), isolated from the input loop. */
function runJsListener(listener: () => void): void {
    try {
        listener();
    } catch (error) {
        console.warn("[widgets] mouse listener failed", error);
    }
}

export function processWidgetHoverInput(
    deps: WidgetInputControllerDeps,
    state: WidgetInputState,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): void {
    const { mx, my } = frame;
    // OSRS: while the Choose Option menu is open or a widget is picked up for a drag, nothing is
    // hovered. Hovered widgets get their mouse-leave, and no mouse-over or repeat runs.
    const uiMenu = (deps.getRenderer?.()?.canvas as any)?.__ui?.menu;
    const held = widgetInteraction?.clickedWidget;
    const hoverSuppressed =
        deps.getMenuOpen?.() === true ||
        uiMenu?.open === true ||
        (!!held && widgetInteraction.isWidgetDraggable?.(held) === true);
    const hits = hoverSuppressed ? [] : frame.hits;
        try {
            deps.getWorldMap().updateWorldMapIconHover(mx, my);
        } catch {}

        // hover state is tracked per-widget.
        // Multiple widgets (parents + children) can be hovered at once and receive onMouseRepeat.
        const nextHoveredUids = new Set<number>();
        const nextHoveredWidgetsByUid = new Map<number, any>();
        const hasHoverHandlers = (w: any): boolean => {
            // mouse listener dispatch is in the IF3 event branch.
            if (!w || w.isIf3 === false || widgetManager.getWidgetByUid(w.uid) !== w) return false;
            // If the cache/runtime explicitly marked this widget as "no listeners", skip.
            if (w.hasListeners === false) return false;
            return !!(
                w.jsListeners?.onMouseOver ||
                w.jsListeners?.onMouseLeave ||
                w.eventHandlers?.onMouseOver ||
                w.eventHandlers?.onMouseLeave ||
                w.eventHandlers?.onMouseRepeat ||
                (Array.isArray(w.onMouseOver) && w.onMouseOver.length > 0) ||
                (Array.isArray(w.onMouseLeave) && w.onMouseLeave.length > 0) ||
                (Array.isArray(w.onMouseRepeat) && w.onMouseRepeat.length > 0)
            );
        };
        for (let i = 0; i < hits.length; i++) {
            const w = hits[i];
            if (!hasHoverHandlers(w)) continue;
            const uid = (w.uid ?? 0) | 0;
            if (uid === 0) continue;
            nextHoveredUids.add(uid);
            nextHoveredWidgetsByUid.set(uid, w);
        }

        // Create mouse event context - relative to widget's absolute screen position
        // Uses _absX/_absY set by collectWidgetsAtPoint, falls back to relative x/y.
        const createMouseEventContext = (widget: any): Partial<ScriptEvent> => {
            const widgetX = widget._absX ?? widget.x ?? 0;
            const widgetY = widget._absY ?? widget.y ?? 0;
            return {
                mouseX: mx - widgetX,
                mouseY: my - widgetY,
            };
        };

        // Fire mouseLeave for widgets that were hovered last cycle but aren't now.
        for (const uid of state.hoveredWidgetUids) {
            if (nextHoveredUids.has(uid)) continue;
            const old = state.hoveredWidgetsByUid.get(uid);
            // CC_DELETEALL/rebuild can leave last frame's hover reference detached. Its
            // listener arguments belong to that old child, not the newly created UI.
            if (!old || widgetManager.getWidgetByUid(uid) !== old) continue;
            const eventCtx = createMouseEventContext(old);
            if (old.jsListeners?.onMouseLeave) {
                runJsListener(old.jsListeners.onMouseLeave);
            } else if (old.eventHandlers?.onMouseLeave) {
                deps.getCs2Vm().invokeEventHandler(old, "onMouseLeave", eventCtx);
            } else if (Array.isArray(old.onMouseLeave) && old.onMouseLeave.length > 0) {
                deps.executeScriptListener(old, old.onMouseLeave, eventCtx);
            }
        }

        // Fire mouseOver for newly hovered widgets (in draw order: parent before child).
        for (let i = 0; i < hits.length; i++) {
            const w = hits[i];
            if (!hasHoverHandlers(w)) continue;
            const uid = (w.uid ?? 0) | 0;
            if (uid === 0) continue;
            if (!nextHoveredUids.has(uid) || state.hoveredWidgetsByUid.get(uid) === w) continue;
            const eventCtx = createMouseEventContext(w);
            if (w.jsListeners?.onMouseOver) {
                runJsListener(w.jsListeners.onMouseOver);
            } else if (w.eventHandlers?.onMouseOver) {
                deps.getCs2Vm().invokeEventHandler(w, "onMouseOver", eventCtx);
            } else if (Array.isArray(w.onMouseOver) && w.onMouseOver.length > 0) {
                deps.executeScriptListener(w, w.onMouseOver, eventCtx);
            }
        }

        // onMouseRepeat fires once per client cycle while hovered.
        for (let i = 0; i < hits.length; i++) {
            const w = hits[i];
            if (!hasHoverHandlers(w)) continue;
            const uid = (w.uid ?? 0) | 0;
            if (uid === 0) continue;
            if (!nextHoveredUids.has(uid)) continue;
            const eventCtx = createMouseEventContext(w);
            if (w.eventHandlers?.onMouseRepeat) {
                deps.getCs2Vm().invokeEventHandler(w, "onMouseRepeat", eventCtx);
            } else if (Array.isArray(w.onMouseRepeat) && w.onMouseRepeat.length > 0) {
                deps.executeScriptListener(w, w.onMouseRepeat, eventCtx);
            }
        }

        state.hoveredWidgetUids = nextHoveredUids;
        state.hoveredWidgetsByUid = nextHoveredWidgetsByUid;
}
