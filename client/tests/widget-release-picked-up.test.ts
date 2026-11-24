import assert from "node:assert/strict";
import { test } from "node:test";

import { processWidgetReleaseInput } from "../game/widgets/input/widgetReleaseInput";

// OSRS: a widget picked up for a drag (it has a drag parent) is never "clicked", so letting go
// without dragging runs its menu action but not a release script. An ordinary widget's release
// script runs.
function release(dragParent: object | null): string[] {
    const ran: string[] = [];
    const widget: any = { uid: 7, _absX: 0, _absY: 0, eventHandlers: { onRelease: {} } };
    const interaction: any = {
        clickedWidget: widget, isDraggingWidget: false, clickedWidgetX: 1, clickedWidgetY: 1, pressedWidget: null, dragPassThroughWidget: null,
        isWidgetDraggable: () => dragParent !== null,
        resolveClickedWidgetParent: () => dragParent,
        clearWidgetInteractionState() { this.clickedWidget = null; },
    };
    const deps: any = {
        getCs2Vm: () => ({ invokeEventHandler: (_w: unknown, name: string) => { ran.push(name); return true; } }),
        handleWidgetAction: () => ran.push("action"), executeScriptListener: () => undefined,
    };
    processWidgetReleaseInput(deps, { mx: 2, my: 2 } as any, {} as any, interaction, () => ({ option: "Use", target: "" }), false);
    return ran;
}

test("a picked-up widget runs its action and no release script", () => {
    assert.deepEqual(release({ uid: 1 }), ["action"]);
});

test("an ordinary widget runs its release script", () => {
    assert.deepEqual(release(null), ["onRelease"]);
});
