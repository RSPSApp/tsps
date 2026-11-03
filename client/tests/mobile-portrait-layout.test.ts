import assert from "node:assert/strict";
import { test } from "node:test";

import {
    adjustMobilePortraitWidget,
    setMobilePortraitLayoutActive,
} from "../game/plugins/portraitmode/PortraitLayout";
import { getForcedLandscapeRotation } from "../game/useSafariLandscapeLock";
import { layoutWidgets, setWidgetLayoutAdjuster, type WidgetLike } from "../widgets/layout/WidgetLayout";

type Node = WidgetLike & { uid: number; parentUid: number };

const uid = (child: number) => ((601 << 16) | child) >>> 0;

/** The toplevel_osm panes the portrait layout moves, with their cache sizes and modes. */
function gameframe(): { root: Node; byChild: Map<number, Node>; children: (uid: number) => Node[] } {
    const nodes: Node[] = [];
    const add = (child: number, parent: number, props: Partial<Node>): Node => {
        const node: Node = {
            uid: uid(child), parentUid: parent < 0 ? -1 : uid(parent), type: 0, isIf3: true,
            rawX: 0, rawY: 0, rawWidth: 0, rawHeight: 0,
            widthMode: 0, heightMode: 0, xPositionMode: 0, yPositionMode: 0, ...props,
        };
        nodes.push(node);
        return node;
    };
    const root = add(0, -1, { widthMode: 1, heightMode: 1, xPositionMode: 1, yPositionMode: 1 });
    // The safezone script widens it to the 680px landscape minimum.
    add(19, 0, { rawWidth: 680, rawHeight: 0, heightMode: 1 });
    add(20, 19, { widthMode: 1, heightMode: 1, xPositionMode: 1 });
    add(22, 20, { rawWidth: 234, rawHeight: 207, xPositionMode: 2 });
    add(26, 20, { rawX: 60, rawY: 30, rawWidth: 118, rawHeight: 46, widthMode: 1, heightMode: 1 });
    add(27, 26, { rawY: 64, rawWidth: 512, rawHeight: 334, xPositionMode: 1, yPositionMode: 1 });
    add(49, 20, { rawWidth: 519, rawHeight: 165 });
    add(50, 20, { rawY: 87, rawWidth: 85, rawHeight: 280, xPositionMode: 2, yPositionMode: 1 });
    add(61, 50, { rawX: 3, rawY: 3, rawWidth: 40, rawHeight: 274, xPositionMode: 2 });
    add(62, 61, { widthMode: 1, heightMode: 1, xPositionMode: 1, yPositionMode: 1 });
    for (let i = 0; i < 7; i++) {
        add(63 + i, 62, { type: 5, rawY: i * 39, rawWidth: 40, rawHeight: 40, xPositionMode: 1 });
    }
    add(87, 50, { rawX: 3, rawY: 3, rawWidth: 40, rawHeight: 274 });
    add(111, 20, { rawX: 85, rawY: 4, rawWidth: 204, rawHeight: 275, xPositionMode: 2, yPositionMode: 2 });
    const byChild = new Map(nodes.map((n) => [n.uid & 0xffff, n]));
    const children = (parent: number) => nodes.filter((n) => n.parentUid === parent);
    return { root, byChild, children };
}

const rect = (n: Node | undefined) => [n?.x, n?.y, n?.width, n?.height];

test("portrait moves the mobile gameframe's panes and turns the tab columns into rows", () => {
    setWidgetLayoutAdjuster(adjustMobilePortraitWidget);
    setMobilePortraitLayoutActive(true);
    try {
        const { root, byChild, children } = gameframe();
        layoutWidgets(root, 523, 1131, children);

        assert.deepEqual(rect(byChild.get(19)), [0, 0, 523, 1131], "the safezone fits the screen");
        assert.deepEqual(rect(byChild.get(49)), [0, 0, 523, 165], "chat across the top");
        assert.deepEqual(rect(byChild.get(111)), [523 - 204 - 2, 1131 - 275 - 2, 204, 275], "side panel bottom-right");
        assert.deepEqual(rect(byChild.get(50)), [2, 1131 - 85 - 2, 280, 85], "tab stones bottom-left");
        assert.deepEqual(rect(byChild.get(22)), [2, 1131 - 85 - 207 - 4, 234, 207], "minimap above the stones");
        const hudTop = 1131 - 85 - 207 - 4;
        assert.deepEqual(rect(byChild.get(26)), [0, 165, 523, hudTop - 165], "modal host between chat and HUD");
        assert.equal(byChild.get(27)?.x, (523 - 512) >> 1, "the bank centres in it");

        // The columns are now rows: the left column on top, the right one below it.
        assert.deepEqual(rect(byChild.get(87)), [3, 3, 274, 40]);
        assert.deepEqual(rect(byChild.get(61)), [3, 85 - 40 - 3, 274, 40]);
        for (let i = 0; i < 7; i++) {
            assert.deepEqual(rect(byChild.get(63 + i)), [i * 39, 0, 40, 40], `stone ${i} sits in the row`);
        }

        // Turning the phone sideways restores the cache layout.
        setMobilePortraitLayoutActive(false);
        layoutWidgets(root, 1055, 488, children);
        assert.deepEqual(rect(byChild.get(50)), [680 - 85, ((488 - 280) >> 1) + 87, 85, 280]);
        assert.deepEqual(rect(byChild.get(63)), [0, 0, 40, 40]);
        assert.deepEqual(rect(byChild.get(64)), [0, 39, 40, 40]);
    } finally {
        setMobilePortraitLayoutActive(false);
        setWidgetLayoutAdjuster(null);
    }
});

test("portrait mode never rotates the app, even with the chat keyboard open", () => {
    assert.equal(getForcedLandscapeRotation(false, true, true, true), false);
    assert.equal(getForcedLandscapeRotation(true, true, true, true), false);
    // Without it (?portrait=0) the forced-landscape decisions are unchanged.
    assert.equal(getForcedLandscapeRotation(false, true, true), undefined);
    assert.equal(getForcedLandscapeRotation(true, false, true), true);
});

test("on a short screen the modal covers the chat, never the bottom HUD", () => {
    setWidgetLayoutAdjuster(adjustMobilePortraitWidget);
    setMobilePortraitLayoutActive(true);
    try {
        const { root, byChild, children } = gameframe();
        layoutWidgets(root, 523, 700, children);
        const host = byChild.get(26)!;
        const modal = byChild.get(27)!;
        const hudTop = 700 - 85 - 207 - 4;
        assert.equal((host.y ?? 0) + (modal.y ?? 0) + (modal.height ?? 0) <= hudTop, true);
        assert.equal((host.y ?? 0) >= 0, true);
    } finally {
        setMobilePortraitLayoutActive(false);
        setWidgetLayoutAdjuster(null);
    }
});

test("the Portrait Mode plugin is off by default and switches the layout state", async () => {
    const { PortraitModePlugin } = await import("../game/plugins/portraitmode/PortraitModePlugin");
    const { isPortraitModeEnabled, subscribePortraitModeEnabled } = await import(
        "../game/plugins/portraitmode/PortraitLayout"
    );
    assert.equal(PortraitModePlugin.descriptor.enabledByDefault, false);
    assert.equal(isPortraitModeEnabled(), false, "nothing stored: off");

    const plugin = new PortraitModePlugin();
    let changes = 0;
    const unsubscribe = subscribePortraitModeEnabled(() => changes++);
    await plugin.start();
    assert.equal(isPortraitModeEnabled(), true);
    await plugin.stop();
    assert.equal(isPortraitModeEnabled(), false);
    unsubscribe();
    assert.equal(changes, 2, "the landscape lock hears both switches");
});
