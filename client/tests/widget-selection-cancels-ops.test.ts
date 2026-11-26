import assert from "node:assert/strict";
import { test } from "node:test";

import { ClientState } from "../game/ClientState";
import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";

// OSRS, with an item ("Use") or a spell selected: a component lists none of its own ops. One
// that is not a target offers only Cancel, and a left click on it just ends the selection.

const prayer = { uid: (541 << 16) | 9, groupId: 541, fileId: 9, childIndex: -1, x: 0, y: 0, width: 34, height: 34,
    actions: ["Activate"], flags: 2, eventHandlers: { onOp: {} } };

function select(mask: number) {
    ClientState.isSpellSelected = true;
    ClientState.selectedSpellActionName = "Cast";
    ClientState.selectedSpellName = "Wind Strike";
    ClientState.selectedSpellTargetMask = mask;
}

function click(widget: any) {
    const ran: string[] = [];
    const deps = {
        getCs2Vm: () => ({ invokeEventHandler: (_w: any, name: string) => { ran.push(name); return true; } }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0, clearSelectedSpell: () => { ran.push("clear"); ClientState.clearSpellSelection(); } }),
        handleTradeWidgetAction: () => false,
        buildWidgetActionPayload: () => { ran.push("payload"); return null; },
        executeScriptListener: () => undefined,
        getTransmitCycles: () => ({ cycleCntr: 0 }),
    } as any;
    const flagsOf = (w: any) => (w.flags ?? 0) | 0;
    const frame = { input: { leftClickX: 10, leftClickY: 10 }, collectFromAllRoots: () => [widget], getWidgetFlags: flagsOf } as any;
    const widgetManager = { getWidgetByUid: () => undefined, getWidgetFlags: flagsOf, invalidateWidgetRender: () => undefined, invalidateAll: () => undefined } as any;
    const interaction = { clickedWidget: null, clickedWidgetParent: null, clickedWidgetHandled: false,
        resolveClickedWidgetParent: () => null, handleTradeRequestChatClick: () => false, isWidgetDraggable: () => false } as any;
    processWidgetClickInput(deps, { cachedHoverHits: null } as any, frame, widgetManager, interaction,
        () => ({ option: "Activate", target: "", opIndex: 1 }), true);
    return { ran, interaction };
}

test("a component's menu is only Cancel while something is selected", () => {
    select(0x06);
    try {
        assert.deepEqual(deriveMenuEntriesForWidget(prayer, false, () => 2, () => undefined).map((e) => e.option), ["Cancel"]);
    } finally {
        ClientState.clearSpellSelection();
    }
    assert.deepEqual(deriveMenuEntriesForWidget(prayer, false, () => 2, () => undefined).map((e) => e.option), ["Activate", "Cancel"]);
});

test("a left click on it ends the selection and runs no op", () => {
    select(0x06);
    const { ran, interaction } = click(prayer);
    assert.deepEqual(ran, ["clear"]);
    assert.equal(ClientState.isSpellSelected, false);
    assert.equal(interaction.clickedWidget, null);
});

test("with nothing selected the click runs the op as before", () => {
    const { ran } = click(prayer);
    assert.ok(ran.includes("onOp"));
});
