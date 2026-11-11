import assert from "node:assert/strict";
import { test } from "node:test";

import { adjustMobileHudWidget } from "../game/widgets/MobileHudLayout";
import { alignPosition, type WidgetLike } from "../widgets/layout/WidgetLayout";

const uid = (group: number, child: number) => ((group << 16) | child) >>> 0;
const CANVAS_HEIGHT = 450;

type Node = WidgetLike & { uid: number };

/** The widget manager's view of the chat toggle (varc OSM_CHATBOX_DISABLED). */
function manager(chatDisabled: boolean | null, canvasHeight = CANVAS_HEIGHT) {
    return {
        canvasHeight,
        getWidgetByUid: () => undefined,
        isMobileChatDisabled: chatDisabled === null ? null : () => chatDisabled,
    };
}

/** All Settings window as the cache script lays it out: canvas height minus the chat's 145. */
function settingsWindow(): Node {
    return {
        uid: uid(134, 1),
        x: 126,
        y: 130,
        width: 512,
        height: CANVAS_HEIGHT - 145,
        rawY: 58,
        rawHeight: CANVAS_HEIGHT - 145,
        heightMode: 0,
        yPositionMode: 1,
    };
}

test("All Settings keeps its size while the chat is shown", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(false));
    assert.deepEqual([node.y, node.height], [130, 305]);
});

test("All Settings keeps its size when the manager cannot tell", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(null));
    assert.deepEqual([node.y, node.height], [130, 305]);
});

test("All Settings grows over the space the hidden chat leaves", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    assert.deepEqual([node.y, node.height], [6, 429], "6px above and 15px below it");
});

test("the hidden-chat height follows the canvas, not a stale parent height", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, 417, manager(true));
    assert.equal(node.height, 429);
});

test("a window already taller than the hidden-chat space is never shrunk", () => {
    const node: Node = { uid: uid(134, 1), x: 0, y: 0, width: 512, height: 440 };
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    assert.deepEqual([node.y, node.height], [0, 440]);
});

test("other windows are untouched when the chat is hidden", () => {
    const node: Node = { uid: uid(601, 27), x: 15, y: 100, width: 512, height: 334 };
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    assert.deepEqual([node.y, node.height], [100, 334]);
});

test("a position-only layout pass keeps the stretched window in place", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    alignPosition(node, 905, CANVAS_HEIGHT);
    assert.deepEqual([node.y, node.height], [6, 429], "re-centring from the raw values lands on the same spot");
});

test("showing the chat again puts the window back to its own size and place", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(false));
    assert.deepEqual([node.y, node.height, node.rawY, node.rawHeight], [130, 305, 58, 305]);
});

test("a script that resizes the window again is stretched from its new raw values", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    Object.assign(node, { rawY: 40, rawHeight: 300, height: 300, y: 112 });
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    assert.deepEqual([node.y, node.height], [6, 429]);
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(false));
    assert.deepEqual([node.rawY, node.rawHeight], [40, 300]);
});
