// A left-click on a widget that has both onClick and an op runs both, as OSRS does: onClick on
// the press, and the top menu entry (the widget's op) through onOp. The Demonic Pacts tree's
// Apply Changes and "Yes, Apply Changes" buttons (built by script 8190: onClick for the press,
// onOp for the action) did nothing on a left-click while their right-click menu worked.
import assert from "node:assert/strict";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";

function click(widget: any): string[] {
    const fired: string[] = [];
    const deps = {
        getCs2Vm: () => ({
            invokeEventHandler: (_widget: any, eventType: string) => {
                fired.push(eventType);
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
        { cachedHoverHits: null } as any,
        frame,
        widgetManager,
        widgetInteraction,
        () => ({ option: widget.actions?.[0] ?? "", target: "", opIndex: 1 }),
        true,
    );
    return fired;
}

const button = (extra: any) => ({
    uid: (647 << 16) | 20,
    groupId: 647,
    fileId: -1,
    childIndex: 3,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    ...extra,
});

assert.deepEqual(
    click(button({ actions: ["Apply Changes"], eventHandlers: { onClick: {}, onOp: {} } })),
    ["onClick", "onOp"],
    "a button with an op: its onClick, then its op",
);
assert.deepEqual(
    click(button({ eventHandlers: { onClick: {}, onOp: {} } })),
    ["onClick"],
    "no op of its own: onClick alone, onOp only as the fallback",
);
assert.deepEqual(
    click(button({ eventHandlers: { onOp: {} } })),
    ["onOp"],
    "onOp alone (a tab): still runs",
);

console.log("widget click runs op passed");
