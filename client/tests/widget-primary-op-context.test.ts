import assert from "node:assert/strict";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";

const friendName = "Test Friend";
const widget = {
    uid: 429 << 16,
    groupId: 429,
    fileId: 0,
    childIndex: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    eventHandlers: { onOp: {} },
};

let eventContext: any;
const deps = {
    getCs2Vm: () => ({
        invokeEventHandler: (_widget: any, eventType: string, context: any) => {
            assert.equal(eventType, "onOp");
            eventContext = context;
            return true;
        },
    }),
    getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
    handleTradeWidgetAction: () => false,
    buildWidgetActionPayload: () => null,
    executeScriptListener: () => undefined,
    getTransmitCycles: () => ({ cycleCntr: 0 }),
} as any;
const state = { cachedHoverHits: null } as any;
const frame = {
    input: { leftClickX: 10, leftClickY: 10 },
    collectFromAllRoots: () => [widget],
    getWidgetFlags: () => 0,
} as any;
const widgetManager = {
    getWidgetByUid: () => undefined,
    getWidgetFlags: () => 0,
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
    deps,
    state,
    frame,
    widgetManager,
    widgetInteraction,
    () => ({ option: "Message", target: friendName, opIndex: 2 }),
    true,
);

assert.equal(eventContext?.targetName, friendName);
assert.equal(eventContext?.opIndex, 2);
assert.equal(widgetInteraction.clickedWidgetHandled, true);

console.log("widget primary operation context test passed");
