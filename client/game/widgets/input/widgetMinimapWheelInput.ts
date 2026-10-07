import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

export function processWidgetMinimapWheelInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): void {
    const { input, mx, my, hits } = frame;
    if (
        input.wheelDeltaY !== 0 &&
        deps.getMinimapZoomEnabled() &&
        !deps.getMenuOpen() &&
        !(deps.getRenderer()?.canvas as any)?.__ui?.menu?.open
    ) {
        if (widgetInteraction.isPointerOverMinimapClickTarget(mx, my)) {
            deps.applyMinimapWheelZoom(input.wheelDeltaY);
            input.wheelDeltaY = 0;
        } else {
            for (let i = hits.length - 1; i >= 0; i--) {
                const w = hits[i];
                if (((w?.contentType ?? 0) | 0) !== 1338) continue;
                const uid = (w?.uid ?? 0) | 0;
                if (uid !== 0 && widgetManager.isEffectivelyHidden(uid)) continue;
                deps.applyMinimapWheelZoom(input.wheelDeltaY);
                input.wheelDeltaY = 0;
                break;
            }
        }
    }
}
