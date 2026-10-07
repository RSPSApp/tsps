import assert from "node:assert/strict";

import { applyQuestListWidgetGroups } from "../widgets/custom/questList";

const GROUP_ID = 399;
const LIST_UID = (GROUP_ID << 16) | 7;
const VIEW_UID = (GROUP_ID << 16) | 6;
const SCROLLBAR_UID = (GROUP_ID << 16) | 5;

type AnyWidget = any;

const widgets = new Map<number, AnyWidget>();
const makeRoot = (uid: number): AnyWidget => ({
    uid,
    groupId: GROUP_ID,
    parentUid: -1,
    childIndex: 0,
    children: [],
    hidden: false,
    isHidden: false,
    width: 0,
    height: 100,
    rawWidth: 0,
    rawHeight: 0,
    scrollY: 0,
    scrollHeight: 0,
});
widgets.set(LIST_UID, makeRoot(LIST_UID));
widgets.set(VIEW_UID, makeRoot(VIEW_UID));
widgets.set(SCROLLBAR_UID, makeRoot(SCROLLBAR_UID));

let nextDynamicUid = 1;
const manager = {
    getWidgetByUid: (uid: number) => widgets.get(uid),
    setServerOwnedWidget: () => {},
    registerWidget: (widget: AnyWidget) => widgets.set(widget.uid, widget),
    unregisterWidgetTree: (widget: AnyWidget) => widgets.delete(widget.uid),
    allocateDynamicUid: () => 0x40000000 + nextDynamicUid++,
    invalidateDynamicChildrenCache: () => {},
    ensureLayout: (widget: AnyWidget) => {
        widget.height = widget.height || 100;
    },
    invalidateWidget: () => {},
};

const boom = new Error("malformed group");
const malformed = Object.defineProperty({ quests: [{ slot: 2, displayName: "x", status: 0 }] }, "title", {
    get() {
        throw boom;
    },
});

applyQuestListWidgetGroups(manager as any, [
    {
        title: "<col=ff0000>Free quests",
        quests: [{ key: "cook", slot: 1, displayName: "<col=00ff00>Cook's Assistant", status: 2 }],
    },
    malformed as any,
    { title: "Empty", quests: null } as any,
    {
        title: "Members",
        quests: [
            {
                key: "long",
                slot: 2,
                displayName: "x".repeat(200),
                status: 0,
            },
        ],
    },
]);

const list = widgets.get(LIST_UID);
const textWidgets = list.children.filter(Boolean);
assert.ok(textWidgets.length >= 3, "rows from healthy groups are still rendered");

for (const widget of textWidgets) {
    assert.ok(!widget.text.includes("<"), `markup stripped from "${widget.text}"`);
    assert.ok(!widget.text.includes(">"), `markup stripped from "${widget.text}"`);
    assert.ok(widget.text.length <= 80, "row text is bounded");
    if (widget.opBase) {
        assert.ok(!widget.opBase.includes("<col=ff9040><"), "opBase uses the bounded name");
    }
}

const view = widgets.get(VIEW_UID);
const scrollbar = widgets.get(SCROLLBAR_UID);
assert.equal(scrollbar.scrollBarTargetUid, view.uid, "sizing still runs after a malformed group");
assert.ok(view.scrollHeight > 0, "content height is computed after a malformed group");
assert.ok(
    textWidgets.some((widget) => widget.text === "Members"),
    "groups after the malformed one are rendered",
);

console.log("quest-list-render.test.ts: all tests passed");
