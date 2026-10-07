import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import type { WidgetInputControllerDeps, WidgetInputFrame, WidgetInputState } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

export function processWidgetHoverInput(
    deps: WidgetInputControllerDeps,
    state: WidgetInputState,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): void {
    const { mx, my, hits } = frame;
        try {
            deps.getWorldMap().updateWorldMapIconHover(mx, my);
        } catch {}

        // hover state is tracked per-widget.
        // Multiple widgets (parents + children) can be hovered at once and receive onMouseRepeat.
        const nextHoveredUids = new Set<number>();
        const nextHoveredWidgetsByUid = new Map<number, any>();
        const hasHoverHandlers = (w: any): boolean => {
            // mouse listener dispatch is in the IF3 event branch.
            if (!w || w.isIf3 === false) return false;
            // If the cache/runtime explicitly marked this widget as "no listeners", skip.
            if (w.hasListeners === false) return false;
            return !!(
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
        // Uses _absX/_absY set by collectWidgetsAtPoint (canvas buffer pixels),
        // falling back to relative x/y.
        //
        // CS2 scripts (including the settings sliders' pointer->value math)
        // expect LOGICAL widget coordinates, not buffer pixels: on a high-DPI
        // screen the buffer is a scaled-up copy of the logical layout, so a raw
        // buffer-pixel offset is inflated by the UI render scale and biases the
        // value one direction (the brightness slider could only be nudged). The
        // onDrag / onDragComplete paths already divide by getUiRenderScale() to
        // produce logical coords; do the same here so every mouse event reports
        // the same space the scripts were written for.
        const [renderScaleX, renderScaleY] = widgetInteraction.getUiRenderScale();
        const invScaleX = renderScaleX > 0 ? 1 / renderScaleX : 1;
        const invScaleY = renderScaleY > 0 ? 1 / renderScaleY : 1;
        const createMouseEventContext = (widget: any): Partial<ScriptEvent> => {
            const widgetX = widget._absX ?? widget.x ?? 0;
            const widgetY = widget._absY ?? widget.y ?? 0;
            return {
                mouseX: Math.round((mx - widgetX) * invScaleX),
                mouseY: Math.round((my - widgetY) * invScaleY),
            };
        };

        // Fire mouseLeave for widgets that were hovered last cycle but aren't now.
        for (const uid of state.hoveredWidgetUids) {
            if (nextHoveredUids.has(uid)) continue;
            const old = state.hoveredWidgetsByUid.get(uid);
            if (!old) continue;
            const eventCtx = createMouseEventContext(old);
            if (old.eventHandlers?.onMouseLeave) {
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
            if (!nextHoveredUids.has(uid) || state.hoveredWidgetUids.has(uid)) continue;
            const eventCtx = createMouseEventContext(w);
            if (w.eventHandlers?.onMouseOver) {
                deps.getCs2Vm().invokeEventHandler(w, "onMouseOver", eventCtx);
            } else if (Array.isArray(w.onMouseOver) && w.onMouseOver.length > 0) {
                deps.executeScriptListener(w, w.onMouseOver, eventCtx);
            }
        }

        // onMouseRepeat fires once per client cycle while hovered AND the left
        // mouse button is held (OSRS semantics - how the settings sliders are
        // adjusted: press and move over the slider). onMouseOver/onMouseLeave
        // remain hover-only.
        const mouseDown =
            !!frame.input && typeof frame.input.isDragging === "function" && frame.input.isDragging();

        // Fire mouseRepeat for hovered widgets only while the button is held.
        if (mouseDown) {
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
        }

        state.hoveredWidgetUids = nextHoveredUids;
        state.hoveredWidgetsByUid = nextHoveredWidgetsByUid;
}
