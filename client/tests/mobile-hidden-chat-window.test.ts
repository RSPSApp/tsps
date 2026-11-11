import assert from "node:assert/strict";
import { test } from "node:test";

import { adjustMobileHudWidget, isMobileChatHidden } from "../game/widgets/MobileHudLayout";
import type { WidgetLike } from "../widgets/layout/WidgetLayout";

const uid = (group: number, child: number) => ((group << 16) | child) >>> 0;
const CANVAS_HEIGHT = 450;

type Node = WidgetLike & { uid: number };

/** The mobile gameframe pieces the chat toggle moves: 601:10's raw y is offset by the chat height while shown. */
function manager(chatShown: boolean, canvasHeight = CANVAS_HEIGHT) {
    const nodes = new Map<number, WidgetLike>([
        [uid(601, 10), { rawY: chatShown ? 151 : 6 }],
        [uid(601, 49), { rawHeight: 145, height: 145 }],
    ]);
    return { canvasHeight, getWidgetByUid: (u: number) => nodes.get(u) };
}

/** All Settings window as the cache script lays it out: canvas height minus the chat's 145. */
function settingsWindow(): Node {
    return { uid: uid(134, 1), x: 126, y: 130, width: 512, height: CANVAS_HEIGHT - 145 };
}

test("the mobile chat counts as hidden once the chat toggle stops offsetting the 601:10 pane", () => {
    assert.equal(isMobileChatHidden(manager(true)), false);
    assert.equal(isMobileChatHidden(manager(false)), true);
    assert.equal(isMobileChatHidden({ getWidgetByUid: () => undefined }), false);
});

test("All Settings keeps its size while the chat is shown", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    assert.deepEqual([node.y, node.height], [130, 305]);
});

test("All Settings grows over the space the hidden chat leaves", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(false));
    assert.deepEqual([node.y, node.height], [6, 429], "6px above and 15px below it");
});

test("the hidden-chat height follows the canvas, not a stale parent height", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 905, 417, manager(false));
    assert.equal(node.height, 429);
});

test("a window already taller than the hidden-chat space is never shrunk", () => {
    const node: Node = { uid: uid(134, 1), x: 0, y: 0, width: 512, height: 440 };
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(false));
    assert.deepEqual([node.y, node.height], [0, 440]);
});

test("other windows are untouched when the chat is hidden", () => {
    const node: Node = { uid: uid(601, 27), x: 15, y: 100, width: 512, height: 334 };
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(false));
    assert.deepEqual([node.y, node.height], [100, 334]);
});
