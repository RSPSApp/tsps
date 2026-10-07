import { strict as assert } from "node:assert";

import { processWidgetDragInput } from "../game/widgets/input/widgetDragInput";

/**
 * A drag starts after the widget's dead time in 20 ms client cycles, not in rendered frames
 * (OSRS: the inventory's items take 6 cycles and 5 pixels). Counting frames made quick clicks
 * on a high refresh rate screen turn into drags.
 */
function harness(renderScale = 1) {
    const transmit = { cycleCntr: 100 };
    const item = { uid: (149 << 16) | 0, dragZoneSize: 5, dragThreshold: 6, width: 36, height: 32, _absX: 0, _absY: 0 };
    const interaction: any = {
        clickedWidget: item,
        clickedWidgetParent: null,
        clickedWidgetX: 0,
        clickedWidgetY: 0,
        widgetDragDuration: 0,
        dragClickCycle: transmit.cycleCntr,
        isDraggingWidget: false,
        dragClickX: 10,
        dragClickY: 10,
        isWidgetDraggable: () => true,
        resolveClickedWidgetParent: () => null,
        getUiRenderScale: () => [renderScale, renderScale],
    };
    const deps: any = {
        getTransmitCycles: () => transmit,
        getCs2Vm: () => ({ invokeEventHandler: () => false }),
    };
    const frame: any = { mx: 30, my: 10, allRoots: [], visibleMap: new Map(), getStaticChildren: () => [], getInterfaceParentRoots: () => [] };
    const widgetManager: any = { getWidgetByUid: () => null };
    const frameTick = () => processWidgetDragInput(deps, frame, widgetManager, interaction, true);
    return { transmit, interaction, frameTick };
}

// 240 frames a second: twelve frames inside the same 2-3 cycles are no drag.
{
    const { transmit, interaction, frameTick } = harness();
    for (let i = 0; i < 12; i++) {
        if (i % 5 === 4) transmit.cycleCntr++;
        frameTick();
    }
    assert.equal(interaction.isDraggingWidget, false, "a quick click held for a few cycles stays a click");
    assert.equal(interaction.widgetDragDuration, 2);
}

// Past the dead time (more than 6 cycles) and the dead zone, it drags.
{
    const { transmit, interaction, frameTick } = harness();
    transmit.cycleCntr += 6;
    frameTick();
    assert.equal(interaction.isDraggingWidget, false, "6 cycles is not yet more than the dead time");
    transmit.cycleCntr += 1;
    frameTick();
    assert.equal(interaction.isDraggingWidget, true);
}

// The dead zone is in UI pixels: at a render scale of 2, 8 canvas pixels are 4 UI pixels.
{
    const { transmit, interaction, frameTick } = harness(2);
    interaction.dragClickX = 22;
    transmit.cycleCntr += 10;
    frameTick();
    assert.equal(interaction.isDraggingWidget, false, "inside the 5 pixel dead zone");
}

console.log("widget drag cycles: ok");
