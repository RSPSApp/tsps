import type { ScriptEvent } from "../../../rs/cs2/Cs2Vm";
import type { WidgetInputControllerDeps, WidgetInputFrame } from "./widgetInputTypes";
import type { WidgetInteractionController } from "../WidgetInteractionController";

export function processWidgetHoldInput(
    deps: WidgetInputControllerDeps,
    frame: WidgetInputFrame,
    widgetInteraction: WidgetInteractionController,
    isHolding: boolean,
    isNewClick: boolean,
): void {
    const { mx, my } = frame;
    // Fire onClickRepeat / onHold for ANY held widget, not just draggable ones.
    // onHold fires every tick while the widget is held (e.g., scrollbar arrows).
    // onHoldListener is processed independently of drag state.
    // hold events are suppressed while a widget drag is active.
    if (widgetInteraction.clickedWidget && isHolding && !widgetInteraction.isDraggingWidget) {
        const widget = widgetInteraction.clickedWidget;
        const eventScaleX = widget._absScaleX ?? 1;
        const eventScaleY = widget._absScaleY ?? 1;
        const holdCtx: Partial<ScriptEvent> = {
            mouseX: ((mx - (widget._absX ?? widget.x ?? 0)) / eventScaleX) | 0,
            mouseY: ((my - (widget._absY ?? widget.y ?? 0)) / eventScaleY) | 0,
        };

        // OSRS: a widget is only held while the cursor is over it. Sliding off it ends the press
        // (its release script runs, repeats stop); onHold resumes if the cursor comes back.
        const left = widget._absX ?? widget.x ?? 0;
        const top = widget._absY ?? widget.y ?? 0;
        const inside =
            mx >= left && my >= top &&
            mx < left + (widget.width ?? 0) * eventScaleX &&
            my < top + (widget.height ?? 0) * eventScaleY;
        if (!inside) {
            if (!isNewClick && !widget._pressEnded && !widgetInteraction.isWidgetDraggable?.(widget)) {
                widget._pressEnded = true;
                if (widget.eventHandlers?.onRelease) deps.getCs2Vm().invokeEventHandler(widget, "onRelease", holdCtx);
                else if (widget.onRelease) deps.executeScriptListener(widget, widget.onRelease, holdCtx);
            }
            return;
        }

        // onClickRepeat requires isClicked (set by onClick on the previous frame).
        // On the first frame of a click, onClick fires and sets isClicked — onClickRepeat
        // only starts firing from the next frame onward. Using !isNewClick as the guard
        // achieves the same one-frame delay.
        if (!isNewClick && !widget._pressEnded) {
            if (widgetInteraction.clickedWidget.eventHandlers?.onClickRepeat) {
                deps.getCs2Vm().invokeEventHandler(widgetInteraction.clickedWidget, "onClickRepeat", holdCtx);
            } else if (widgetInteraction.clickedWidget.onClickRepeat) {
                deps.executeScriptListener(
                    widgetInteraction.clickedWidget,
                    widgetInteraction.clickedWidget.onClickRepeat,
                    holdCtx,
                );
            }
        }

        if (widgetInteraction.clickedWidget.eventHandlers?.onHold) {
            deps.getCs2Vm().invokeEventHandler(widgetInteraction.clickedWidget, "onHold", holdCtx);
        } else if (widgetInteraction.clickedWidget.onHold) {
            deps.executeScriptListener(widgetInteraction.clickedWidget, widgetInteraction.clickedWidget.onHold, holdCtx);
        }
    }
}
