import assert from "node:assert/strict";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { isWidgetDraggable } from "../game/widgets/interaction/widgetDragHelpers";

// The worn equipment tab: the bolt pouch slot (387:30) lies over Dizana's quiver slot (387:28).
// Script 4039 empties the pouch slot's op when no pouch is carried, but its op1 transmit flag
// stays. OSRS lists no op without text, so a left-click falls through to the quiver's Fill.
const quiverSlot = {
    uid: (387 << 16) | 28,
    groupId: 387,
    fileId: 28,
    childIndex: -1,
    x: 0,
    y: 0,
    width: 36,
    height: 36,
    actions: [null, "Fill"],
    eventHandlers: { onOp: {} },
};
const boltPouchSlot = {
    uid: (387 << 16) | 30,
    groupId: 387,
    fileId: 30,
    childIndex: -1,
    x: 0,
    y: 0,
    width: 36,
    height: 36,
    actions: [""],
    flags: 2097154,
};

function click(hits: any[]) {
    const clicked: any[] = [];
    const deps = {
        getCs2Vm: () => ({ invokeEventHandler: () => true }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        handleTradeWidgetAction: () => false,
        buildWidgetActionPayload: (event: any) => {
            clicked.push(event.widget);
            return null;
        },
        executeScriptListener: () => undefined,
        getTransmitCycles: () => ({ cycleCntr: 0 }),
    } as any;
    const flagsOf = (w: any) => (w.flags ?? 0) | 0;
    const frame = {
        input: { leftClickX: 10, leftClickY: 10 },
        collectFromAllRoots: () => hits,
        getWidgetFlags: flagsOf,
    } as any;
    const widgetManager = {
        getWidgetByUid: () => undefined,
        getWidgetFlags: flagsOf,
        invalidateWidgetRender: () => undefined,
        invalidateAll: () => undefined,
    } as any;
    const widgetInteraction = {
        clickedWidget: null,
        clickedWidgetParent: null,
        clickedWidgetHandled: false,
        resolveClickedWidgetParent: () => null,
        handleTradeRequestChatClick: () => false,
        isWidgetDraggable: (widget: any) => isWidgetDraggable(widgetManager, widget),
    } as any;
    processWidgetClickInput(
        { ...deps },
        { cachedHoverHits: null } as any,
        frame,
        widgetManager,
        widgetInteraction,
        (w: any) => ({ option: w === quiverSlot ? "Fill" : "Ok", target: "", opIndex: w === quiverSlot ? 2 : undefined }),
        true,
    );
    return { actions: clicked, interaction: widgetInteraction };
}

// Hits run bottom to top: the pouch slot is drawn last, over the quiver slot.
const { actions: clicked } = click([quiverSlot, boltPouchSlot]);
assert.ok(clicked.length > 0, "the click went to a widget");
assert.equal(clicked[0], quiverSlot, "the emptied pouch slot doesn't take the click");

// A component with op text still takes it, flags or not.
const withOp = { ...boltPouchSlot, actions: ["Remove"] };
assert.equal(click([quiverSlot, withOp]).actions[0], withOp);

// A component with no ops list at all keeps clicking through its transmit flags alone.
const flagsOnly = { ...boltPouchSlot, actions: undefined };
assert.equal(click([quiverSlot, flagsOnly]).actions[0], flagsOnly);

// An op needs its transmit flag or an onOp handler, as in the right-click menu. The Slayer Rewards
// Tasks tab's view_tasks layer (426:36) gets "View List" by script but no flag for its own slot,
// and lies over the Cancel button (a script-run dynamic child of 426:29): Cancel takes the click.
const cancelButton = {
    uid: (426 << 16) | 29, groupId: 426, fileId: -1, childIndex: 12,
    x: 0, y: 0, width: 57, height: 22, actions: ["Cancel"], eventHandlers: { onOp: {} },
};
const viewTasksLayer = {
    uid: (426 << 16) | 36, groupId: 426, fileId: 36, childIndex: -1,
    x: 0, y: 0, width: 468, height: 200, actions: ["View List"],
};
assert.equal(click([cancelButton, viewTasksLayer]).actions[0], cancelButton);
// With its flag, the same op takes the click.
assert.equal(click([cancelButton, { ...viewTasksLayer, flags: 2 }]).actions[0].fileId, 36);

// A widget that is only draggable offers no op, so the click runs the op beneath it: the
// gravestone window (672) puts invisible resize handles (draggable script children of 672:0)
// over its corners, and the top-right one lies over the Close button (672:3).
const closeButton = {
    uid: (672 << 16) | 3, groupId: 672, fileId: 3, childIndex: -1,
    x: 0, y: 0, width: 26, height: 23, actions: ["Close"], flags: 2, eventHandlers: { onOp: {} },
};
const resizeHandle = {
    uid: 672 << 16, groupId: 672, fileId: -1, childIndex: 2,
    x: 0, y: 0, width: 40, height: 40, isDraggable: true,
};
assert.equal(click([closeButton, resizeHandle]).actions[0], closeButton, "the resize handle doesn't take Close's click");
// With nothing beneath offering an op, the handle still takes the click (to be dragged).
assert.equal(click([{ ...closeButton, actions: undefined, flags: 0, eventHandlers: undefined }, resizeHandle]).interaction.clickedWidget, resizeHandle);

// The Beekeeper's native model parts use drag-depth flags, with no click, hold or onDrag
// listener. A drop-complete listener doesn't make them clickable by itself.
{
    const { createCacheVm } = require('../scripts/cache/cs2-sweep');
    const { vm } = createCacheVm();
    const manager = vm.context.widgetManager;
    manager.getGroup(420);
    const piece = manager.getWidgetByUid((420 << 16) | 10);
    assert.equal(piece.flags, 0x120000, 'cache enables a one-parent drag and receiving drops');
    assert.equal(click([piece]).interaction.clickedWidget, piece, 'a native flag-only drag source is picked up');
    assert.equal(click([manager.getWidgetByUid((420 << 16) | 8)]).interaction.clickedWidget, null, 'an inert model is still ignored');
}

console.log("widget click cleared ops test passed");
