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

test("a previously stretched window follows the mobile scale in both directions", () => {
    const node = settingsWindow();
    adjustMobileHudWidget(node, 512, 334, manager(true));
    assert.deepEqual([node.y, node.height], [6, 429]);
    // The Settings script rewrites the raw height for the 1150-high layout.
    Object.assign(node, { rawY: -397, rawHeight: 1129, y: -795, height: 1129 });
    adjustMobileHudWidget(node, 512, 334, manager(true, 1150));
    assert.deepEqual([node.y, node.height], [6, 1129]);
    // Going back to the short layout shrinks the stretched window again.
    Object.assign(node, { rawY: -397, rawHeight: 1129, y: -795, height: 1129 });
    adjustMobileHudWidget(node, 512, 334, manager(true));
    assert.deepEqual([node.y, node.height], [6, 429]);
});

test("a canvas-sized window is re-centred when the mobile scale changes under it", () => {
    // After Interface scaling 400% -> 175%, the Settings script has already set the
    // window to the new canvas height (1150 - 21) but still centres it in the 512x334
    // main modal, leaving y=-795 and an empty screen. The stretch must correct the
    // raw position even when the height already matches the hidden-chat space.
    const node: Node = {
        uid: uid(134, 1), x: 0, y: -795, width: 512, height: 1129,
        rawY: -397, rawHeight: 1129, heightMode: 0, yPositionMode: 1,
    };
    adjustMobileHudWidget(node, 512, 334, manager(true, 1150));
    assert.deepEqual([node.y, node.height], [6, 1129]);
    assert.equal(node.rawY, 404, "the centring offset follows the shorter parent");
});

/** The Settings window as a phone lays it out: 512x334 main modal sitting 140px down the screen. */
function phoneSettingsWindow(): Node {
    return {
        uid: uid(134, 1), x: 0, y: 72, width: 512, height: 189,
        rawY: 0, rawHeight: 189, heightMode: 0, yPositionMode: 1,
    };
}

function phoneManager(chatDisabled: boolean, canvasHeight = 503, modalTop = 140) {
    return {
        canvasHeight,
        getWidgetByUid: (id: number) => (id === uid(601, 27) ? { uid: id, y: modalTop } : undefined),
        isMobileChatDisabled: () => chatDisabled,
    };
}

test("the hidden-chat stretch is measured from the main modal, not the top of the screen", () => {
    const node = phoneSettingsWindow();
    adjustMobileHudWidget(node, 512, 334, phoneManager(true));
    assert.equal(node.height, 482);
    // 140px (modal) + y must leave the 6px gap, and the window must end inside the 503px canvas.
    assert.equal(140 + (node.y ?? 0), 6, "its top sits 6px below the screen's top");
    assert.ok(140 + (node.y ?? 0) + (node.height ?? 0) <= 503 - 15, "its bottom is not cut off");
});

test("a resize script re-centring the stretched window does not become its new original", () => {
    const node = phoneSettingsWindow();
    adjustMobileHudWidget(node, 512, 334, phoneManager(true));
    // The Settings resize script writes rawY = (parent - height) / 2 on every relayout.
    Object.assign(node, { rawY: (334 - 482) >> 1, y: ((334 - 482) >> 1) * 2 });
    adjustMobileHudWidget(node, 512, 334, phoneManager(true));
    assert.equal(140 + (node.y ?? 0), 6, "the stretch is re-applied from the screen top");
    // The chat comes back: the window gives its original size and position back.
    adjustMobileHudWidget(node, 512, 334, phoneManager(false));
    assert.deepEqual([node.rawY, node.rawHeight, node.y, node.height], [0, 189, 72, 189]);
});

function phoneModal(): Node {
    return { uid: uid(601, 27), x: 66, y: 140, width: 512, height: 334, rawY: 64, rawHeight: 334, heightMode: 0, yPositionMode: 1 };
}

function modalManager(chatDisabled: boolean, group: number) {
    return { ...phoneManager(chatDisabled), getSubInterface: () => ({ group }) };
}

test("the main modal fills the screen while a stretched All Settings window needs the room", () => {
    const modal = phoneModal();
    adjustMobileHudWidget(modal, 982, 487, modalManager(true, 134));
    assert.deepEqual([modal.y, modal.height], [0, 487], "the stretched window is no longer clipped to 334px");
    // Hiding the chat is undone: the modal is back where the cache put it.
    adjustMobileHudWidget(modal, 982, 487, modalManager(false, 134));
    assert.deepEqual([modal.rawY, modal.rawHeight, modal.y, modal.height], [64, 334, 140, 334]);
});

test("the main modal keeps its size for other windows and while the chat is shown", () => {
    for (const [disabled, group] of [[true, 149], [false, 134]] as const) {
        const modal = phoneModal();
        adjustMobileHudWidget(modal, 982, 487, modalManager(disabled, group));
        assert.deepEqual([modal.y, modal.height], [140, 334], `chat hidden ${disabled}, group ${group}`);
    }
});

test("the main modal returns to its size when All Settings closes with the chat hidden", () => {
    const modal = phoneModal();
    adjustMobileHudWidget(modal, 982, 487, modalManager(true, 134));
    adjustMobileHudWidget(modal, 982, 487, modalManager(true, 149));
    assert.deepEqual([modal.y, modal.height], [140, 334]);
});

test("other windows are untouched when the chat is hidden", () => {
    const node: Node = { uid: uid(601, 27), x: 15, y: 100, width: 512, height: 334 };
    adjustMobileHudWidget(node, 905, CANVAS_HEIGHT, manager(true));
    assert.deepEqual([node.y, node.height], [100, 334]);
});

type PositionedNode = Node & { _absX?: number; _absWidth?: number };

/** A manager with All Settings in the main modal and one open right-hand side panel. */
function sidePanelManager(panelLeft: number, settingsOpen: boolean, renderScaleX = 2, paneChild = 114) {
    const pane: PositionedNode = {
        uid: uid(601, paneChild), x: 0, y: 0, width: 190, height: 261,
        _absX: panelLeft * renderScaleX, _absWidth: 190 * renderScaleX,
    };
    return {
        canvasHeight: 548,
        renderScaleX,
        getWidgetByUid: (id: number) => (id === pane.uid ? pane : undefined),
        getSubInterface: (id: number) => {
            if (id === uid(601, 27)) return settingsOpen ? { group: 134 } : { group: 149 };
            if (id === pane.uid) return { group: 149 };
            return undefined;
        },
        isEffectivelyHidden: () => false,
        isMobileChatDisabled: () => false,
    };
}

test("All Settings shifts left to clear an open right-hand side panel", () => {
    const modal: Node = { uid: uid(601, 27), x: 300, y: 140, width: 512, height: 334, rawX: 300 };
    adjustMobileHudWidget(modal, 816, 548, sidePanelManager(700, true));
    assert.equal(modal.x, 180, "ends 8px before the panel");
    assert.equal(modal.rawX, 180, "the shift survives a position-only layout pass");

    // The panel closes: the cache's own position comes back.
    adjustMobileHudWidget(modal, 816, 548, sidePanelManager(700, false));
    assert.equal(modal.x, 300);
    assert.equal(modal.rawX, 300);
});

test("the side modal and every right-hand tab pane constrain All Settings", () => {
    for (const child of [114, 116, 119, 129]) {
        const modal: Node = { uid: uid(601, 27), x: 300, y: 140, width: 512, height: 334, rawX: 300 };
        adjustMobileHudWidget(modal, 816, 548, sidePanelManager(700, true, 2, child));
        assert.equal(modal.x, 180, `601:${child} clears the window`);
    }
});

test("a tab-stone graphic is not treated as an open side panel", () => {
    const modal: Node = { uid: uid(601, 27), x: 300, y: 140, width: 512, height: 334, rawX: 300 };
    adjustMobileHudWidget(modal, 816, 548, sidePanelManager(700, true, 2, 74));
    assert.equal(modal.x, 300, "601:74 is stone7, not a panel");
});

test("the All Settings shift never pushes the modal off the left edge", () => {
    const modal: Node = { uid: uid(601, 27), x: 81, y: 140, width: 512, height: 334, rawX: 81 };
    adjustMobileHudWidget(modal, 816, 548, sidePanelManager(472, true));
    assert.equal(modal.x, 8, "clamped to the left gap when there is no room to clear");
    assert.equal(modal.rawX, 8);
});

test("the shift only applies while All Settings is in the main modal", () => {
    const modal: Node = { uid: uid(601, 27), x: 300, y: 140, width: 512, height: 334, rawX: 300 };
    adjustMobileHudWidget(modal, 816, 548, sidePanelManager(700, false));
    assert.equal(modal.x, 300, "a bank or shop is not moved");
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
