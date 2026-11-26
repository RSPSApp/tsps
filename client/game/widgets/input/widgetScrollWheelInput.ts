import { wheelNotches } from "../../InputManager";
import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import { isVisibleWidgetSurfaceAt } from "../../../widgets/menu/utils";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import { SCROLL_WHEEL_ZOOM_INCREMENT_EVENT, SCROLL_WHEEL_ZOOM_SCRIPT } from "../../../rs/cs2/zoomCallbacks";
import { CAMERA_ZOOM_BIG, CAMERA_ZOOM_SMALL } from "../../../runelite/api/gameval/VarClientID";

/**
 * The toplevels' overlay_atmosphere slots (gamevals toplevel_osrs_stretch, toplevel_pre_eoc,
 * toplevel_display and toplevel): full-screen screen effects (the Last Man Standing fog tint, cave
 * darkness, fades) mount there, and they never take the wheel from the camera.
 */
const ATMOSPHERE_SLOTS = new Set([(161 << 16) | 1, (164 << 16) | 1, (165 << 16) | 9, (548 << 16) | 27]);

function isAtmosphereEffect(widgetManager: WidgetManager, w: { uid?: number; groupId?: number }): boolean {
    const groupId = typeof w.groupId === "number" ? w.groupId | 0 : ((w.uid ?? 0) >>> 16);
    const container = widgetManager.getContainerUidForGroup?.(groupId);
    return container !== undefined && ATMOSPHERE_SLOTS.has(container);
}

export function processWidgetScrollWheelInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
): void {
    const { input, mx, my, hits } = frame;
    const wheelDelta = input.wheelDeltaY;
    const pinchDelta = input.pinchZoomDelta ?? 0;
    if ((wheelDelta !== 0 || pinchDelta !== 0) && hits.length > 0 && !widgetInteraction.isDraggingWidget) {
        let consumedWheel = false;
        let blockedByVisibleWidget = false;

        for (let i = hits.length - 1; i >= 0; i--) {
            const w = hits[i];

            // Skip effectively hidden widgets
            const wUid = (w.uid ?? 0) | 0;
            if (widgetManager.isEffectivelyHidden(wUid)) continue;

            // Camera zoom blocking is based on actual visible widget surfaces.
            // Listener-only widgets (for example buff_bar transmit children) must not block,
            // nor screen effects drawn over the scene.
            if (!blockedByVisibleWidget && isVisibleWidgetSurfaceAt(w, mx, my) && !isAtmosphereEffect(widgetManager, w)) {
                blockedByVisibleWidget = true;
            }

            const jsScroll = (w as { jsListeners?: { onScrollWheel?: (event: { mouseY: number }) => void } }).jsListeners
                ?.onScrollWheel;
            const hasScrollHandler =
                jsScroll ||
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

            const scriptId = w.eventHandlers?.onScroll?.scriptId ?? w.onScroll?.[0];
            const isViewportZoom = scriptId === SCROLL_WHEEL_ZOOM_SCRIPT;
            if (isViewportZoom && blockedByVisibleWidget) break;

            const pinchZoom = isViewportZoom &&
                (pinchDelta !== 0 || input.getCameraZoomDelta() !== wheelDelta);
            if (!pinchZoom && wheelDelta === 0) {
                if (w.noScrollThrough && w.isIf3 !== false) {
                    blockedByVisibleWidget = true;
                    break;
                }
                continue;
            }
            // A script gets the number of notches turned, not just the direction.
            const wheelStep = pinchZoom
                ? (input.getCameraZoomDelta() > 0 ? 1 : -1)
                : wheelNotches(wheelDelta);
            const scrollCtx: Partial<ScriptEvent> = {
                mouseX: mx - (w._absX ?? w.x ?? 0),
                mouseY: wheelStep,
            };

            const vm = deps.getCs2Vm();
            const getFov = vm.context.getViewportFovValues;
            // Scale after plugin callbacks so their zoom step and Control-to-zoom still apply.
            const scalePinch = (_script: unknown, name: string) => {
                if (name === SCROLL_WHEEL_ZOOM_INCREMENT_EVENT) {
                    const top = vm.intStackSize - 1;
                    vm.intStack[top] = input.consumePinchZoomIncrement(vm.intStack[top]);
                }
            };
            if (pinchZoom) {
                vm.scriptCallbackListeners.add(scalePinch);
                // Native FOV readback rounds; accumulate tiny steps from the script's exact targets.
                vm.context.getViewportFovValues = () => {
                    const low = deps.getVarManager().getVarcInt(CAMERA_ZOOM_SMALL);
                    const high = deps.getVarManager().getVarcInt(CAMERA_ZOOM_BIG);
                    return low >= 0 && high >= 0 ? { low, high } : getFov();
                };
            }
            try {
                if (jsScroll) {
                    jsScroll({ mouseY: wheelStep });
                } else if (w.eventHandlers?.onScroll) {
                    vm.invokeEventHandler(w, "onScroll", scrollCtx);
                } else if (Array.isArray(w.onScroll) && w.onScroll.length > 0) {
                    deps.executeScriptListener(w, w.onScroll, scrollCtx);
                }
            } finally {
                if (pinchZoom) {
                    vm.scriptCallbackListeners.delete(scalePinch);
                    vm.context.getViewportFovValues = getFov;
                }
            }

            consumedWheel = true;
            // Preserve the original delta only for a gesture that reached the viewport.
            // HD applies its follow-camera feel after UI dispatch; settings/list listeners
            // must never contribute to that separate camera path.
            if (isViewportZoom) input.viewportWheelDeltaY = input.getCameraZoomDelta();
            // OSRS runs every scroll listener under the cursor down to the first component that
            // stops the wheel (noscrollthrough); the viewport's zoom listener is always the last.
            if (isViewportZoom || (w.noScrollThrough && w.isIf3 !== false)) break;
        }

        // Block camera zoom if scroll was consumed or the pointer is over a zoom-blocking widget.
        if (consumedWheel || blockedByVisibleWidget) {
            input.clearWheel();
        }
    }
}
