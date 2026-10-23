import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import { getVisibleWidgetSurfaceReason } from "../../../widgets/menu/utils";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

export function processWidgetScrollWheelInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): void {
    const { input, mx, hits } = frame;
    const wheelDelta = input.wheelDeltaY;
    if (wheelDelta !== 0 && hits.length > 0 && !widgetInteraction.isDraggingWidget) {
        let consumedWheel = false;
        let blockedByVisibleWidget = false;

        for (let i = hits.length - 1; i >= 0; i--) {
            const w = hits[i];

            // Skip effectively hidden widgets
            const wUid = (w.uid ?? 0) | 0;
            if (widgetManager.isEffectivelyHidden(wUid)) continue;

            // Camera zoom blocking is based on actual visible widget surfaces.
            // Listener-only widgets (for example buff_bar transmit children) must not block.
            if (!blockedByVisibleWidget && getVisibleWidgetSurfaceReason(w)) {
                blockedByVisibleWidget = true;
            }

            const hasScrollHandler =
                w.eventHandlers?.onScroll ||
                (Array.isArray(w.onScroll) && w.onScroll.length > 0);
            if (!hasScrollHandler) {
                // A blocker still owns the wheel when its content has no listener (or is at
                // a boundary). Otherwise the unconsumed delta reaches camera zoom below it.
                if (w.noScrollThrough && w.isIf3 !== false) {
                    blockedByVisibleWidget = true;
                    break;
                }
                continue;
            }

            const wheelStep = wheelDelta > 0 ? 1 : -1;
            const scrollCtx: Partial<ScriptEvent> = {
                mouseX: mx - (w._absX ?? w.x ?? 0),
                mouseY: wheelStep,
            };

            if (w.eventHandlers?.onScroll) {
                deps.getCs2Vm().invokeEventHandler(w, "onScroll", scrollCtx);
            } else if (Array.isArray(w.onScroll) && w.onScroll.length > 0) {
                deps.executeScriptListener(w, w.onScroll, scrollCtx);
            }

            consumedWheel = true;
            break;
        }

        // Block camera zoom if scroll was consumed or the pointer is over a zoom-blocking widget.
        if (consumedWheel || blockedByVisibleWidget) {
            input.wheelDeltaY = 0;
        }
    }
}
