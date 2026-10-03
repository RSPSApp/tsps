import { sendWidgetDrag } from "../../../network/ServerConnection";
import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import { resolveDynamicWidgetParentId } from "../widgetActionPayload";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";

function resolveInventoryDropTargetSlot(
    widgetManager: WidgetManager,
    dragTarget: any,
    mouseX: number,
    mouseY: number,
): number | undefined {
    const targetSlotFromWidget = dragTarget?.childIndex;
    const targetGroupId = dragTarget ? (dragTarget.uid >>> 16) & 0xffff : -1;
    if (
        typeof targetSlotFromWidget === "number" &&
        targetGroupId === 149 &&
        targetSlotFromWidget >= 0 &&
        targetSlotFromWidget < 28
    ) {
        return targetSlotFromWidget | 0;
    }

    // Fallback for inventory layouts whose dynamic slot widget was not present
    // in the drag hit result.
    const inventoryContainer = widgetManager.getWidgetByUid(9764864); // 149 << 16
    const firstSlot = inventoryContainer?.children?.[0];
    if (
        !inventoryContainer ||
        !firstSlot ||
        inventoryContainer._absX === undefined ||
        inventoryContainer._absY === undefined
    ) {
        return undefined;
    }

    const gridOriginX = inventoryContainer._absX + (firstSlot.x || 0);
    const gridOriginY = inventoryContainer._absY + (firstSlot.y || 0);
    const col = Math.floor((mouseX - gridOriginX) / 42); // 36px slot + 6px gap
    const row = Math.floor((mouseY - gridOriginY) / 36); // 32px slot + 4px gap
    if (col < 0 || col >= 4 || row < 0 || row >= 7) {
        return undefined;
    }
    return row * 4 + col;
}

export function processWidgetReleaseInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
    getPrimaryWidgetAction: (w: any) => import("./widgetPrimaryAction").PrimaryWidgetAction,
    isHolding: boolean,
): void {
    const { mx, my } = frame;
    // Release
    if (widgetInteraction.clickedWidget && !isHolding) {
        // A short drag can be released before the drag delay expires. Never
        // reinterpret a displaced release as the item's primary action (Drop).
        if (!widgetInteraction.isDraggingWidget && widgetInteraction.isWidgetDraggable(widgetInteraction.clickedWidget)
            && Math.max(Math.abs(mx - widgetInteraction.dragClickX), Math.abs(my - widgetInteraction.dragClickY))
                > (widgetInteraction.clickedWidget.dragZoneSize ?? 0)) {
            widgetInteraction.clearWidgetInteractionState();
            return;
        }
        // Drag complete
        if (widgetInteraction.isDraggingWidget) {
            const w = widgetInteraction.clickedWidget;
            // Use draggedOnWidget tracked during drag ()
            const dragTarget = widgetInteraction.draggedOnWidget;
            // Ensure clickedWidgetParent is resolved for final clamp/coords.
            if (!widgetInteraction.clickedWidgetParent) {
                widgetInteraction.clickedWidgetParent =
                    widgetInteraction.resolveClickedWidgetParent(w);
            }
            const renderArea = widgetInteraction.clickedWidgetParent;
            const hasExplicitDragParent = renderArea !== null;

            const widgetWidth = w.width ?? 0;
            const widgetHeight = w.height ?? 0;
            const [renderScaleX, renderScaleY] = widgetInteraction.getUiRenderScale();

            let targetAbsX = mx - widgetInteraction.clickedWidgetX;
            let targetAbsY = my - widgetInteraction.clickedWidgetY;

            // Only clamp to parent bounds if there's an explicit drag parent
            let parentAbsX = 0;
            let parentAbsY = 0;
            let parentScrollX = 0;
            let parentScrollY = 0;

            if (hasExplicitDragParent) {
                parentAbsX = renderArea._absX ?? widgetInteraction.dragRenderAreaAbsX ?? 0;
                parentAbsY = renderArea._absY ?? widgetInteraction.dragRenderAreaAbsY ?? 0;
                const parentWidth = renderArea.width ?? 0;
                const parentHeight = renderArea.height ?? 0;
                parentScrollX = renderArea.scrollX ?? 0;
                parentScrollY = renderArea.scrollY ?? 0;

                // Scale logical dimensions to pixel space for consistent clamping
                const widgetPixelW = widgetWidth * renderScaleX;
                const widgetPixelH = widgetHeight * renderScaleY;
                const parentPixelW = parentWidth * renderScaleX;
                const parentPixelH = parentHeight * renderScaleY;
                if (targetAbsX < parentAbsX) targetAbsX = parentAbsX;
                if (targetAbsX + widgetPixelW > parentAbsX + parentPixelW)
                    targetAbsX = parentAbsX + parentPixelW - widgetPixelW;
                if (targetAbsY < parentAbsY) targetAbsY = parentAbsY;
                if (targetAbsY + widgetPixelH > parentAbsY + parentPixelH)
                    targetAbsY = parentAbsY + parentPixelH - widgetPixelH;
            }

            // Convert pixel-space difference to logical coordinates for CS2 scripts
            const scriptX = ((targetAbsX - parentAbsX) / renderScaleX + parentScrollX) | 0;
            const scriptY = ((targetAbsY - parentAbsY) / renderScaleY + parentScrollY) | 0;

            const dragCompleteCtx: Partial<ScriptEvent> = {
                mouseX: scriptX,
                mouseY: scriptY,
                dragTarget,
            };

            const sourceGroupId = (w.uid >>> 16) & 0xffff;
            const sourceSlot = (w as any).childIndex ?? -1;
            const inventoryTargetSlot =
                sourceGroupId === 149 && sourceSlot >= 0
                    ? resolveInventoryDropTargetSlot(widgetManager, dragTarget, mx, my)
                    : undefined;

            // The drag-complete script may swap the two widgets' items on screen
            // (the bank does), so read what was dragged onto what beforehand.
            const sourceItemId = (w as any).itemId ?? -1;
            const targetItemId = (dragTarget as any)?.itemId ?? -1;

            deps.getCs2Vm().invokeEventHandler(w, "onDragComplete", dragCompleteCtx);

            // Native drag-complete scripts read and swap the original widget
            // contents. Publish the predicted inventory only after they finish.
            if (inventoryTargetSlot !== undefined && inventoryTargetSlot !== sourceSlot) {
                deps.handleInventorySlotMove(sourceSlot, inventoryTargetSlot);
            }

            // End the visual drag after the optimistic state mutation. This invalidates
            // the dragged root with the slot model already in its predicted final state.
            widgetInteraction.clearDragWidgetVisualState(w);
            widgetInteraction.dragSourceWidget = null;
            widgetInteraction.isDraggingWidget = false;
            widgetInteraction.clickedWidget = null;

            if (sourceGroupId !== 149 && dragTarget != null) {
                // Non-inventory drag-drop - send IF_BUTTOND packet
                // For dynamically created children (fileId === -1),
                // send the PARENT container's UID, not the child's own UID.
                // The childIndex is the slot within the container.
                const resolvedSourceParent =
                    (w as any).fileId === -1
                        ? resolveDynamicWidgetParentId(widgetManager, w)
                        : undefined;
                const resolvedTargetParent =
                    (dragTarget as any).fileId === -1
                        ? resolveDynamicWidgetParentId(widgetManager, dragTarget)
                        : undefined;
                const sourceWidgetId =
                    (w as any).fileId === -1 ? (resolvedSourceParent ?? w.uid) : w.uid;
                const targetWidgetId =
                    (dragTarget as any).fileId === -1
                        ? (resolvedTargetParent ?? dragTarget.uid)
                        : dragTarget.uid;

                const targetSlot = (dragTarget as any).childIndex ?? -1;

                // Send IF_BUTTOND packet for widget drag operations (bank, etc.)
                sendWidgetDrag(
                    sourceWidgetId,
                    sourceSlot,
                    sourceItemId,
                    targetWidgetId,
                    targetSlot,
                    targetItemId,
                );
            }

            // Clear deferred action - drag completed so we don't want the "Use" action
            widgetInteraction.deferredWidgetAction = null;

            widgetInteraction.draggedOnWidget = null;
            widgetInteraction.clickedWidgetParent = null;
            delete widgetInteraction.dragRenderAreaAbsX;
            delete widgetInteraction.dragRenderAreaAbsY;
        } else {
            // Mouse button released without dragging - fire onClick (for draggable widgets) and onRelease
            const releaseCtx: Partial<ScriptEvent> = {
                mouseX:
                    mx -
                    (widgetInteraction.clickedWidget._absX ??
                        widgetInteraction.clickedWidget.x ??
                        0),
                mouseY:
                    my -
                    (widgetInteraction.clickedWidget._absY ??
                        widgetInteraction.clickedWidget.y ??
                        0),
                opIndex: 1,
            };

            // For draggable widgets, onClick fires on release (not mousedown)
            // Check if this was a draggable widget that we deferred onClick for
            if (widgetInteraction.isWidgetDraggable(widgetInteraction.clickedWidget)) {
                const { option, target, slot, itemId, opIndex } = getPrimaryWidgetAction(
                    widgetInteraction.clickedWidget,
                );
                deps.handleWidgetAction({
                    widget: widgetInteraction.clickedWidget,
                    option,
                    target,
                    source: "primary",
                    cursorX: releaseCtx.mouseX,
                    cursorY: releaseCtx.mouseY,
                    slot,
                    itemId,
                    opIndex,
                });
            }

            // Fire onRelease
            if (widgetInteraction.clickedWidget.eventHandlers?.onRelease) {
                deps.getCs2Vm().invokeEventHandler(
                    widgetInteraction.clickedWidget,
                    "onRelease",
                    releaseCtx,
                );
            } else if (widgetInteraction.clickedWidget.onRelease) {
                deps.executeScriptListener(
                    widgetInteraction.clickedWidget,
                    widgetInteraction.clickedWidget.onRelease,
                    releaseCtx,
                );
            }
        }

        // The release above already dispatched a click or a drag. Do not replay
        // an earlier deferred action, and always clear held-item visuals.
        widgetInteraction.clearWidgetInteractionState();
    }
}
