// A left-click on a widget that has both onClick and an op runs both, as OSRS does: onClick on
// the press, and the top menu entry (the widget's op) through onOp. The Demonic Pacts tree's
// Apply Changes and "Yes, Apply Changes" buttons (built by script 8190: onClick for the press,
// onOp for the action) did nothing on a left-click while their right-click menu worked.
import assert from "node:assert/strict";

import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";

const customClicks: [number, number][] = [];

function click(widget: any, beneath: any[] = []): string[] {
    const fired: string[] = [];
    const deps = {
        getCustomInterfaces: () => ({
            handleWidgetFocus: (groupId: number, childId: number) => { customClicks.push([groupId, childId]); return false; },
        }),
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

// A left-click tells the custom-interface runtime what it hit, as the menu path already did, so a
// declared search box focuses (and anything else blurs it) from a plain click too.
customClicks.length = 0;
click(button({ actions: ["Search"], eventHandlers: { onOp: {} } }));
assert.deepEqual(customClicks, [[647, 3]], "the top widget under a left-click reaches the runtime, ids as the menu path reads them");

// The resizable frame's 161:98, an empty layer over the whole screen, is the top hit of every
// click. The runtime is told of the widget the click is for, the top one offering an op: the search
// box itself (::commands' 30004:5), not that layer, or every click on the box blurred it.
const screenLayer = { uid: (161 << 16) | 98, groupId: 161, fileId: 98, childIndex: -1, type: 0, x: 0, y: 0, width: 1238, height: 705 };
const searchInput = { uid: (30004 << 16) | 5, groupId: 30004, fileId: 5, childIndex: -1, type: 4, x: 24, y: 32, width: 430, height: 24,
    actions: ["Search"], eventHandlers: { onOp: {} } };
customClicks.length = 0;
click(screenLayer, [searchInput]);
assert.deepEqual(customClicks, [[30004, 5]], "a click on the search box under the frame's layer focuses it");
// A click where nothing offers an op (the window's empty frame) still reaches the runtime as a click elsewhere.
customClicks.length = 0;
click(screenLayer, [{ uid: (30004 << 16) | 1, groupId: 30004, fileId: 1, childIndex: -1, type: 0, x: 0, y: 0, width: 494, height: 316 }]);
assert.deepEqual(customClicks, [[161, 98]], "and a click on nothing offering an op blurs it");

console.log("widget click runs op passed");
