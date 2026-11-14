// A client plugin may pin a submenu row as an inventory item's left-click (MenuEngine's
// swapPinned): the entry keeps its op and carries the row as opSubIndex. The left-click then
// sends what choosing that row from the right-click submenu sends (op and sub-op), on the press
// path, on the release path of a draggable item, and to the onOp script.
import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { createPrimaryWidgetActionResolver } from "../game/widgets/input/widgetPrimaryAction";
import { processWidgetReleaseInput } from "../game/widgets/input/widgetReleaseInput";
import { buildWidgetActionPayload } from "../game/widgets/widgetActionPayload";
import type { SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { setMenuTransform } from "../ui/menu/menuTransforms";

const RUB = 3;
const SECOND_ROW = 2;
// An inventory item whose third op opens a submenu of two rows.
const item = {
    uid: 149 << 16, groupId: 149, fileId: -1, childIndex: 4, itemId: 1712, name: "<col=ff9040>Amulet",
    x: 0, y: 0, width: 36, height: 32,
    actions: ["Wear", null, "Rub", null, "Drop"],
    submenuActions: [null, null, ["First row", "Second row"], null, null],
};
const manager = { getWidgetFlags: () => -1, getWidgetOpMask: () => 0, getWidgetByUid: () => undefined };
const primaryAction = createPrimaryWidgetActionResolver(
    {
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        getSettings: () => ({ shiftClickEnabled: false }),
        getObjTypeLoader: () => ({ load: () => ({ shiftClickIndex: -2 }) }),
    } as any,
    { isShiftDown: () => false } as any,
    manager as any,
    {} as any,
);

/** A plugin that makes the Rub submenu's second row the item's left-click. */
function pinSecondRow(entries: SimpleMenuEntry[]): SimpleMenuEntry[] {
    const rub = entries.find((e) => e.option === "Rub") as any;
    const rows: string[] = rub?.subOptions ?? [];
    if (rows.length < SECOND_ROW) return entries;
    return [{ ...rub, option: rows[SECOND_ROW - 1], opSubIndex: SECOND_ROW, swapPinned: true }, ...entries];
}

ClientState.clearItemSelection();
ClientState.isSpellSelected = false;

let primary = primaryAction(item);
assert.equal(primary.option, "Wear", "without a plugin the left-click is the first op");
assert.equal(primary.opSubIndex, undefined);

setMenuTransform((entries) => pinSecondRow(entries));
try {
    primary = primaryAction(item);
    assert.equal(primary.option, "Second row");
    assert.equal(primary.opIndex, RUB, "the row's own op");
    assert.equal(primary.opSubIndex, SECOND_ROW, "and its row");
    const packet = buildWidgetActionPayload(manager as any, { widget: item, ...primary, source: "primary" } as any);
    assert.equal(packet?.opId, RUB);
    assert.equal(packet?.subOpId, SECOND_ROW, "the packet carries the sub-op, as the submenu row sends it");

    // An inventory item is draggable: a release without a drag runs the left-click.
    const released: any[] = [];
    const state = {
        clickedWidget: item,
        clickedWidgetParent: null,
        dragPassThroughWidget: null,
        pressedWidget: null,
        isDraggingWidget: false,
        isWidgetDraggable: () => true,
        clearWidgetInteractionState() {
            this.clickedWidget = null;
        },
    } as any;
    processWidgetReleaseInput(
        {
            handleWidgetAction: (event: any) => released.push(event),
            getCs2Vm: () => ({ invokeEventHandler: () => true }),
            executeScriptListener: () => undefined,
        } as any,
        { mx: 10, my: 10 } as any,
        {} as any,
        state,
        primaryAction,
        false,
    );
    assert.equal(released.length, 1);
    assert.equal(released[0].opIndex, RUB);
    assert.equal(released[0].opSubIndex, SECOND_ROW, "the release path keeps the sub-op");
} finally {
    setMenuTransform(undefined);
}

// A widget that is not draggable runs the left-click on the press: its onOp script sees the row,
// and the packet built for it carries the sub-op.
const button = { ...item, uid: (400 << 16) | 7, groupId: 400, fileId: 7, childIndex: -1, eventHandlers: { onOp: {} } };
let scriptEvent: any;
const built: any[] = [];
processWidgetClickInput(
    {
        getCs2Vm: () => ({
            invokeEventHandler: (_w: any, _type: string, context: any) => {
                scriptEvent = context;
                return true;
            },
        }),
        getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        handleTradeWidgetAction: () => false,
        buildWidgetActionPayload: (event: any) => {
            built.push(event);
            return null;
        },
        executeScriptListener: () => undefined,
        getTransmitCycles: () => ({ cycleCntr: 0 }),
    } as any,
    { cachedHoverHits: null } as any,
    { input: { leftClickX: 10, leftClickY: 10 }, collectFromAllRoots: () => [button], getWidgetFlags: () => 0 } as any,
    { getWidgetByUid: () => undefined, getWidgetFlags: () => 0, invalidateWidgetRender() {}, invalidateAll() {} } as any,
    {
        clickedWidget: null,
        clickedWidgetParent: null,
        clickedWidgetHandled: false,
        resolveClickedWidgetParent: () => null,
        handleTradeRequestChatClick: () => false,
        isWidgetDraggable: () => false,
    } as any,
    () => ({ option: "Second row", target: "", opIndex: RUB, opSubIndex: SECOND_ROW }),
    true,
);
assert.equal(scriptEvent?.opIndex, RUB);
assert.equal(scriptEvent?.opSubIndex, SECOND_ROW, "the onOp script sees the row");
assert.equal(built.at(-1)?.opSubIndex, SECOND_ROW, "the transmitted payload is built with the sub-op");

console.log("widget pinned sub-op passed");
