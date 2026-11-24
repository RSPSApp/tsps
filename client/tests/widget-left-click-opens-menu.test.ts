import assert from "node:assert/strict";
import { test } from "node:test";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { createPrimaryWidgetActionResolver } from "../game/widgets/input/widgetPrimaryAction";

// OSRS: a left click runs the top menu entry, except that it opens the menu when that entry is a
// low-priority op (index above the component's target priority, opcode 1007), or when "Mouse
// buttons: one" is set and there is more than one option beside Cancel.

const flagsOf = () => ~1;
const widgetManager: any = { getWidgetFlags: flagsOf, getWidgetOpMask: () => -1, getWidgetByUid: () => undefined,
    invalidateWidgetRender: () => undefined, invalidateAll: () => undefined };

function resolver(oneButton: boolean) {
    const deps: any = { getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }), getLeftClickOpensMenu: () => oneButton };
    return createPrimaryWidgetActionResolver(deps, {} as any, widgetManager, {} as any);
}
const widget = (actions: (string | null)[]) => ({ uid: (500 << 16) | 4, groupId: 500, fileId: 4, childIndex: -1, x: 0, y: 0, width: 30, height: 30, name: "Thing", actions, eventHandlers: { onOp: {} } });

test("a top entry that is a low-priority op opens the menu", () => {
    assert.equal(resolver(false)(widget([null, null, null, null, null, "Configure"])).opensMenu, true);
    assert.equal(resolver(false)(widget(["Open", null, null, null, null, "Configure"])).opensMenu, undefined);
});

test("one-button mode opens the menu only when there is a choice", () => {
    assert.equal(resolver(true)(widget(["Open", "Close"])).opensMenu, true);
    assert.equal(resolver(true)(widget(["Open"])).opensMenu, undefined);
    assert.equal(resolver(false)(widget(["Open", "Close"])).opensMenu, undefined);
});

test("the click then opens the menu where it landed and runs no op", () => {
    const ran: string[] = [];
    const opened: number[][] = [];
    const w = widget([null, null, null, null, null, "Configure"]);
    const deps: any = {
        getCs2Vm: () => ({ invokeEventHandler: (_w: any, name: string) => { ran.push(name); return true; } }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        handleTradeWidgetAction: () => false, buildWidgetActionPayload: () => { ran.push("payload"); return null; },
        executeScriptListener: () => undefined, getTransmitCycles: () => ({ cycleCntr: 0 }),
        getLeftClickOpensMenu: () => false, openWidgetMenuAt: (x: number, y: number) => opened.push([x, y]),
    };
    const frame: any = { input: { leftClickX: 12, leftClickY: 14 }, collectFromAllRoots: () => [w], getWidgetFlags: flagsOf };
    const interaction: any = { clickedWidget: null, clickedWidgetParent: null, clickedWidgetHandled: false,
        resolveClickedWidgetParent: () => null, handleTradeRequestChatClick: () => false, isWidgetDraggable: () => false };
    processWidgetClickInput(deps, { cachedHoverHits: null } as any, frame, widgetManager, interaction, resolver(false), true);
    assert.deepEqual(opened, [[12, 14]]);
    assert.deepEqual(ran, []);
    assert.equal(interaction.clickedWidget, null);
});
