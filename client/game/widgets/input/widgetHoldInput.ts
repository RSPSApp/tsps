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
        const holdCtx: Partial<ScriptEvent> = {
            mouseX: mx - (widgetInteraction.clickedWidget._absX ?? widgetInteraction.clickedWidget.x ?? 0),
            mouseY: my - (widgetInteraction.clickedWidget._absY ?? widgetInteraction.clickedWidget.y ?? 0),
        };

        // onClickRepeat requires isClicked (set by onClick on the previous frame).
        // On the first frame of a click, onClick fires and sets isClicked — onClickRepeat
        // only starts firing from the next frame onward. Using !isNewClick as the guard
        // achieves the same one-frame delay.
        if (!isNewClick) {
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
