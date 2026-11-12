// An item a cache script made draggable (cc_setdraggable) drawn over a widget that offers the op:
// the bolt pouch's bolts over their slot's "Remove" (interface 433, script 4045). The press keeps
// the item so it can be dragged, and a release without a drag runs the slot's op. A draggable
// widget that is not such an item (a window's resize handle over Close) still lets the press
// through to the op beneath.
import assert from "node:assert/strict";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { processWidgetReleaseInput } from "../game/widgets/input/widgetReleaseInput";

const widget = (extra: any) => ({
    uid: (433 << 16) | 6,
    groupId: 433,
    fileId: 6,
    childIndex: -1,
    x: 0,
    y: 0,
    width: 36,
    height: 36,
    ...extra,
});

function interaction() {
    return {
        clickedWidget: null as any,
        clickedWidgetParent: null,
        clickedWidgetHandled: false,
        dragPassThroughWidget: null as any,
        pressedWidget: null,
        isDraggingWidget: false,
        resolveClickedWidgetParent: () => null,
        handleTradeRequestChatClick: () => false,
        isWidgetDraggable: (w: any) => w?.draggable === true,
        clearWidgetInteractionState() {
            this.clickedWidget = null;
            this.dragPassThroughWidget = null;
        },
    } as any;
}

const primary = (w: any) => ({ option: w.actions?.[0] ?? "", target: "", opIndex: 1 });

function press(top: any, beneath: any, state: any): string[] {
    const fired: string[] = [];
    const deps = {
        getCs2Vm: () => ({
            invokeEventHandler: (target: any, eventType: string) => {
                fired.push(`${target.name}.${eventType}`);
                return true;
            },
        }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        handleTradeWidgetAction: () => false,
        buildWidgetActionPayload: () => null,
        executeScriptListener: () => undefined,
        getTransmitCycles: () => ({ cycleCntr: 0 }),
    } as any;
    const frame = {
        input: { leftClickX: 10, leftClickY: 10 },
        collectFromAllRoots: () => [beneath, top],
        getWidgetFlags: () => 0,
    } as any;
    const widgetManager = {
        getWidgetByUid: () => undefined,
        getWidgetFlags: () => 0,
        invalidateWidgetRender: () => undefined,
        invalidateAll: () => undefined,
    } as any;
    processWidgetClickInput(deps, { cachedHoverHits: null } as any, frame, widgetManager, state, primary, true);
    return fired;
}

function release(state: any): any[] {
    const actions: any[] = [];
    const deps = {
        handleWidgetAction: (event: any) => actions.push(event),
        getCs2Vm: () => ({ invokeEventHandler: () => true }),
        executeScriptListener: () => undefined,
    } as any;
    processWidgetReleaseInput(deps, { mx: 10, my: 10 } as any, {} as any, state, primary, false);
    return actions;
}

const slot = widget({ name: "slot", actions: ["Remove <col=ff981f>Runite bolts"], eventHandlers: { onOp: {} } });

// The bolts: a dynamic child the cache script made draggable, with no op of its own.
const bolts = widget({ name: "bolts", fileId: -1, childIndex: 0, isDraggable: true, draggable: true, itemId: 9144 });
const state = interaction();
assert.deepEqual(press(bolts, slot, state), [], "the press runs nothing yet");
assert.equal(state.clickedWidget, bolts, "the bolts keep the press, so they can be dragged");
assert.equal(state.dragPassThroughWidget, slot);
const actions = release(state);
assert.equal(actions.length, 1);
assert.equal(actions[0].widget, slot, "a release without a drag runs the slot's op");
assert.equal(actions[0].option, "Remove <col=ff981f>Runite bolts");
assert.equal(state.dragPassThroughWidget, null);

// The gravestone window's resize handle: script-draggable too, but no item, over its Close button.
const close = widget({ name: "close", actions: ["Close"], eventHandlers: { onOp: {} } });
const handle = widget({ name: "handle", fileId: -1, childIndex: 1, isDraggable: true, draggable: true });
const handleState = interaction();
assert.deepEqual(press(handle, close, handleState), ["close.onOp"], "the press goes through to Close at once");
assert.equal(handleState.dragPassThroughWidget, null);

console.log("widget drag pass-through passed");
