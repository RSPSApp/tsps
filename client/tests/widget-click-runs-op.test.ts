// A left-click on a widget that has both onClick and an op runs both, as OSRS does: onClick on
// the press, and the top menu entry (the widget's op) through onOp. The Demonic Pacts tree's
// Apply Changes and "Yes, Apply Changes" buttons (built by script 8190: onClick for the press,
// onOp for the action) did nothing on a left-click while their right-click menu worked.
import assert from "node:assert/strict";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";

function click(widget: any, beneath: any[] = []): string[] {
    const fired: string[] = [];
    const deps = {
        getCs2Vm: () => ({
            invokeEventHandler: (target: any, eventType: string) => {
                fired.push(target.name ? `${target.name}.${eventType}` : eventType);
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
        collectFromAllRoots: () => [...beneath, widget],
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
        (w: any) => ({ option: w.actions?.[0] ?? "", target: "", opIndex: 1 }),
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

// The tree's buttons as built: a container with the op (Apply Changes, onOp 9376) and, drawn
// over it, a face graphic with only a press script (onClick 9125). The press plays and the
// container's op runs, as OSRS's left-click (onClick, then the top menu entry) does.
const container = button({ name: "container", actions: ["Apply Changes"], eventHandlers: { onOp: {} } });
// As the live client shows it (widgets 647:34933 and 34934): the face also carries onOp (script
// 9126) and onRelease, but no op text, so it offers no menu entry.
const face = button({ name: "face", childIndex: 2, eventHandlers: { onClick: {}, onOp: {}, onRelease: {} } });
assert.deepEqual(click(face, [container]), ["face.onClick", "container.onOp"]);
assert.deepEqual(click(face), ["face.onClick"], "with nothing beneath offering an op, the press alone");
const pressOnly = button({ name: "press", childIndex: 2, eventHandlers: { onClick: {} } });
assert.deepEqual(click(pressOnly, [container]), ["press.onClick", "container.onOp"], "a face without onOp too");

console.log("widget click runs op passed");
