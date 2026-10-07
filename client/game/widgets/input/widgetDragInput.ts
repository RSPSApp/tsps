import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import { findDropTarget } from "../../../widgets/menu/utils";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";
import type { WidgetManager } from "../../../widgets/WidgetManager";

export function processWidgetDragInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetManager: WidgetManager,
    widgetInteraction: WidgetInteractionController,
    isHolding: boolean,
): void {
    const { mx, my, allRoots, visibleMap, getStaticChildren, getInterfaceParentRoots } = frame;
    // Drag handling - drag only initiates for widgets with drag capability
    if (widgetInteraction.clickedWidget && isHolding && widgetInteraction.isWidgetDraggable(widgetInteraction.clickedWidget)) {
        // OSRS counts drag dead time in 20ms client cycles, not render frames; counting
        // frames made the dead time ~40ms at 144Hz and turned fast clicks into drags.
        widgetInteraction.widgetDragDuration =
            ((deps.getTransmitCycles().cycleCntr | 0) - widgetInteraction.dragClickCycle) | 0;

        // Check for drag initiation if not yet dragging
        if (!widgetInteraction.isDraggingWidget) {
            // Dead zone is in logical UI pixels; mouse coords are canvas buffer pixels.
            const [renderScaleX, renderScaleY] = widgetInteraction.getUiRenderScale();
            const dx = (mx - widgetInteraction.dragClickX) / renderScaleX;
            const dy = (my - widgetInteraction.dragClickY) / renderScaleY;
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            const zone = widgetInteraction.clickedWidget.dragZoneSize ?? 0;
            const threshold = widgetInteraction.clickedWidget.dragThreshold ?? 0;

            if (widgetInteraction.widgetDragDuration > threshold && dist > zone) {
                widgetInteraction.isDraggingWidget = true;
                widgetInteraction.dragSourceWidget = widgetInteraction.clickedWidget;

                // Initialize offsets if needed (matches old logic)
                if ((widgetInteraction.clickedWidget as any)._dragPickupOffsetX === undefined) {
                    (widgetInteraction.clickedWidget as any)._dragPickupOffsetX =
                        widgetInteraction.dragClickX - (widgetInteraction.clickedWidget._absX ?? 0);
                }
                if ((widgetInteraction.clickedWidget as any)._dragPickupOffsetY === undefined) {
                    (widgetInteraction.clickedWidget as any)._dragPickupOffsetY =
                        widgetInteraction.dragClickY - (widgetInteraction.clickedWidget._absY ?? 0);
                }

                // clickedWidgetParent defines clamp/coordinate space.
                // Ensure it's resolved before we cache absolute coordinates for drag math.
                if (!widgetInteraction.clickedWidgetParent) {
                    widgetInteraction.clickedWidgetParent = widgetInteraction.resolveClickedWidgetParent(
                        widgetInteraction.clickedWidget,
                    );
                }
                const renderArea = widgetInteraction.clickedWidgetParent ?? widgetInteraction.clickedWidget;
                // Cache absolute position of clickedWidgetParent for coord calculations
                let renderAreaAbsX: number;
                let renderAreaAbsY: number;
                if (renderArea._absX !== undefined && renderArea._absY !== undefined) {
                    renderAreaAbsX = renderArea._absX;
                    renderAreaAbsY = renderArea._absY;
                } else if (
                    widgetInteraction.clickedWidget._absX !== undefined &&
                    widgetInteraction.clickedWidget._absY !== undefined
                ) {
                    // Derive parent's absolute position from the child's absolute position
                    renderAreaAbsX = widgetInteraction.clickedWidget._absX - (widgetInteraction.clickedWidget.x ?? 0);
                    renderAreaAbsY = widgetInteraction.clickedWidget._absY - (widgetInteraction.clickedWidget.y ?? 0);
                } else {
                    renderAreaAbsX = renderArea.x ?? 0;
                    renderAreaAbsY = renderArea.y ?? 0;
                }
                widgetInteraction.dragRenderAreaAbsX = renderAreaAbsX;
                widgetInteraction.dragRenderAreaAbsY = renderAreaAbsY;
            }
        }

        // Execute onDrag if dragging is active
        if (widgetInteraction.isDraggingWidget) {
            const w = widgetInteraction.clickedWidget;

            // clickedWidgetParent defines clamp/coordinate space.
            // If null, widget can be dragged freely without clamping (like bank items).
            if (!widgetInteraction.clickedWidgetParent) {
                widgetInteraction.clickedWidgetParent = widgetInteraction.resolveClickedWidgetParent(w);
            }
            const renderArea = widgetInteraction.clickedWidgetParent;
            const hasExplicitDragParent = renderArea !== null;

            const widgetWidth = w.width ?? 0;
            const widgetHeight = w.height ?? 0;

            // UI render scale: maps logical widget coordinates to canvas pixel coordinates.
            // All absolute positions (_absX/_absY, mouse coords) are in pixel space,
            // but widget dimensions (width/height) and CS2 script coordinates are in
            // logical space. We need the scale to convert between them.
            const [renderScaleX, renderScaleY] = widgetInteraction.getUiRenderScale();

            // Calculate target absolute position (Mouse - Offset)
            let targetAbsX = mx - widgetInteraction.clickedWidgetX;
            let targetAbsY = my - widgetInteraction.clickedWidgetY;

            // Only clamp to parent bounds if there's an explicit drag parent
            // Widgets without explicit drag parent (like bank items) can drag freely
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

                // Clamp to parent bounds (only when explicit drag parent is set)
                // parentAbsX/Y are in pixel space; widget dimensions are logical so
                // scale them to pixel space for consistent clamping.
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

            // Calculate visual position relative to the widget's ACTUAL RENDER PARENT
            // The drag render area (used for clamping and script coords) may be different
            // from the widget's parent (e.g., scrollbar dragger clamps to track but renders
            // as a child of the scrollbar container).
            //
            // OSRS uses the clamped absolute position directly for rendering.
            // Our renderer does: finalPos = parentOffset + visualPos
            // So we need visualPos relative to the actual parent, not the drag render area.
            let actualParent =
                w.parentUid !== undefined && w.parentUid !== -1
                    ? widgetManager.getWidgetByUid(w.parentUid)
                    : null;

            // Get the actual parent's absolute position (or fallback to drag render area)
            const actualParentAbsX = actualParent?._absX ?? parentAbsX;
            const actualParentAbsY = actualParent?._absY ?? parentAbsY;

            // Visual position is relative to actual parent (for renderer)
            const visualPosX = targetAbsX - actualParentAbsX;
            const visualPosY = targetAbsY - actualParentAbsY;

            // Script coordinates for CS2 event_mousex/event_mousey.
            // Position within the drag render area plus its scroll offset.
            //
            // For widgets without explicit drag parent (like bank items),
            // use the actual parent's position for script coordinates. The script
            // (e.g., bankmain_dragscroll) subtracts if_gety(container) which returns
            // position relative to parent, so event_mousey must also be relative to
            // the same coordinate space.
            //
            // The pixel-space difference is divided by renderScale to convert to logical
            // widget coordinates, which is what CS2 scripts expect. Scroll offsets are
            // already in logical space.
            const scriptParentAbsX = hasExplicitDragParent ? parentAbsX : actualParentAbsX;
            const scriptParentAbsY = hasExplicitDragParent ? parentAbsY : actualParentAbsY;
            const scriptParentScrollX = hasExplicitDragParent
                ? parentScrollX
                : (actualParent?.scrollX ?? 0);
            const scriptParentScrollY = hasExplicitDragParent
                ? parentScrollY
                : (actualParent?.scrollY ?? 0);
            const scriptX =
                ((targetAbsX - scriptParentAbsX) / renderScaleX + scriptParentScrollX) | 0;
            const scriptY =
                ((targetAbsY - scriptParentAbsY) / renderScaleY + scriptParentScrollY) | 0;

            // Store visual position for renderer to use
            // The widget's actual .x/.y stays unchanged until dragComplete
            // Visual position is parent-relative (no scroll) so renderer can do: ox + visualX
            //
            // Note: In Java client, dragRenderBehaviour (isScrollBar) only affects whether
            // the widget is rendered semi-transparent. All dragged widgets follow the cursor.
            // dragRenderBehaviour values:
            //   0 = hide during drag (but we still want to track position)
            //   1 = follow cursor (scrollbar style, opaque)
            //   other = follow cursor with transparency (inventory item style)
            //
            // We always set the visual position - the renderer decides visibility/transparency
            // Also store absolute position for deferred rendering (avoids scroll offset issues)
            (w as any)._dragAbsX = targetAbsX;
            (w as any)._dragAbsY = targetAbsY;

            // Store visual position in LOGICAL (widget-layout) coordinates so it uses
            // the same coordinate space as CS2 script positions (event_mousey, cc_setposition).
            //
            // When the drag parent differs from the actual parent (e.g.,
            // scrollbar dragger clamped to track but parented to container), scriptY and
            // the naive logicalVisualY are truncated independently from different reference
            // points. At fractional pixel offsets this causes ±1 logical pixel misalignment
            // between the dragged widget and script-positioned siblings (cap sprites).
            // Fix: derive logicalVisualY from scriptY + the drag parent's logical offset
            // from the actual parent, sharing one truncation point.
            let logicalVisualX: number;
            let logicalVisualY: number;
            if (hasExplicitDragParent && actualParent && renderArea !== actualParent) {
                const scriptParentLogicalY = (renderArea as any)?._absLogicalY ?? 0;
                const actualParentLogicalY = (actualParent as any)?._absLogicalY ?? 0;
                const scriptParentLogicalX = (renderArea as any)?._absLogicalX ?? 0;
                const actualParentLogicalX = (actualParent as any)?._absLogicalX ?? 0;
                logicalVisualX =
                    scriptX -
                    scriptParentScrollX +
                    (scriptParentLogicalX - actualParentLogicalX);
                logicalVisualY =
                    scriptY -
                    scriptParentScrollY +
                    (scriptParentLogicalY - actualParentLogicalY);
            } else {
                logicalVisualX = (visualPosX / renderScaleX) | 0;
                logicalVisualY = (visualPosY / renderScaleY) | 0;
            }

            // PERF: Only invalidate render if position actually changed
            const prevVisualX = (w as any)._dragVisualX;
            const prevVisualY = (w as any)._dragVisualY;
            const positionChanged =
                prevVisualX !== logicalVisualX || prevVisualY !== logicalVisualY;

            (w as any)._dragVisualX = logicalVisualX;
            (w as any)._dragVisualY = logicalVisualY;
            (w as any)._isDragActive = true;

            // dragged widget is invalidated every tick during drag (FaceNormal.invalidateWidget).
            // Our overlay renderer uses dirty-region tracking, so force a redraw while the cursor moves.
            // PERF: Only invalidate when position has actually changed
            if (positionChanged) {
                try {
                    widgetManager?.invalidateWidgetRender?.(w);
                } catch {}
            }

            // Track draggedOnWidget - the widget under the cursor that can receive drops.
            // This is updated every frame while dragging, checking widgets under mouse.
            //
            // PERF: Only recalculate when mouse has actually moved
            if (mx !== widgetInteraction.lastDragHitX || my !== widgetInteraction.lastDragHitY) {
                widgetInteraction.lastDragHitX = mx;
                widgetInteraction.lastDragHitY = my;

                // PERF: Use optimized findDropTarget instead of collecting all hits
                const getFlags = (widget: any) =>
                    (widgetManager?.getWidgetFlags?.(widget) ?? widget?.flags ?? 0) | 0;
                widgetInteraction.draggedOnWidget = findDropTarget(
                    allRoots,
                    mx,
                    my,
                    visibleMap,
                    getStaticChildren,
                    getFlags,
                    w.uid,
                    getInterfaceParentRoots,
                );
            }

            const dragCtx: Partial<ScriptEvent> = {
                mouseX: scriptX,
                mouseY: scriptY,
            };

            if (w.eventHandlers?.onDrag) {
                deps.getCs2Vm().invokeEventHandler(w, "onDrag", dragCtx);
            } else if (w.onDrag) {
                deps.executeScriptListener(w, w.onDrag, dragCtx);
            }
        }
    }
}
