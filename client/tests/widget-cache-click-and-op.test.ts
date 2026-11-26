import assert from "node:assert/strict";
import { test } from "node:test";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";

// OSRS: a left click fires a widget's press script and runs the top menu entry, so a cache
// widget with both listeners and an op runs both. Without an op of its own, only the press runs.
function click(actions: string[] | undefined): string[] {
    const ran: string[] = [];
    const w: any = { uid: (300 << 16) | 5, groupId: 300, fileId: 5, childIndex: -1, x: 0, y: 0, width: 20, height: 20,
        actions, flags: 2, onClick: [101], onOp: [102] };
    const deps: any = {
        getCs2Vm: () => ({ invokeEventHandler: () => false }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        handleTradeWidgetAction: () => false, buildWidgetActionPayload: () => null,
        executeScriptListener: (_w: unknown, listener: number[]) => ran.push(listener[0] === 101 ? "onClick" : "onOp"),
        getTransmitCycles: () => ({ cycleCntr: 0 }),
    };
    const flagsOf = (x: any) => (x.flags ?? 0) | 0;
    const frame: any = { input: { leftClickX: 5, leftClickY: 5 }, collectFromAllRoots: () => [w], getWidgetFlags: flagsOf };
    const manager: any = { getWidgetByUid: () => undefined, getWidgetFlags: flagsOf, invalidateWidgetRender() {}, invalidateAll() {} };
    const interaction: any = { clickedWidget: null, clickedWidgetParent: null, clickedWidgetHandled: false,
        resolveClickedWidgetParent: () => null, handleTradeRequestChatClick: () => false, isWidgetDraggable: () => false };
    processWidgetClickInput(deps, { cachedHoverHits: null } as any, frame, manager, interaction, () => ({ option: "Ok", target: "", opIndex: 1 }), true);
    return ran;
}

test("a cache widget with an op runs its press script and its op script", () => {
    assert.deepEqual(click(["Toggle"]), ["onClick", "onOp"]);
});

test("without an op of its own only the press script runs", () => {
    assert.deepEqual(click(undefined), ["onClick"]);
});
