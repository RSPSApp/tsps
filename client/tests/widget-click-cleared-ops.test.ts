import assert from "node:assert/strict";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";

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

function click(hits: any[]): any[] {
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
        isWidgetDraggable: () => false,
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
    return clicked;
}

// Hits run bottom to top: the pouch slot is drawn last, over the quiver slot.
const clicked = click([quiverSlot, boltPouchSlot]);
assert.ok(clicked.length > 0, "the click went to a widget");
assert.equal(clicked[0], quiverSlot, "the emptied pouch slot doesn't take the click");

// A component with op text still takes it, flags or not.
const withOp = { ...boltPouchSlot, actions: ["Remove"] };
assert.equal(click([quiverSlot, withOp])[0], withOp);

// A component with no ops list at all keeps clicking through its transmit flags alone.
const flagsOnly = { ...boltPouchSlot, actions: undefined };
assert.equal(click([quiverSlot, flagsOnly])[0], flagsOnly);

console.log("widget click cleared ops test passed");
