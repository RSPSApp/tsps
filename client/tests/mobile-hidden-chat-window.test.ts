import assert from "node:assert/strict";
import { test } from "node:test";

import { adjustMobileHudWidget, fitAllSettingsBesideSidePanel } from "../game/widgets/MobileHudLayout";
import { setMobilePortraitLayoutActive } from "../game/plugins/portraitmode/PortraitLayout";
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
    assert.equal(node.rawY, 403, "the centring offset follows the shorter parent (centring divides toward zero)");
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

/** All Settings in the main modal, with the inventory pane (601:119) open at x 745. */
function sidePanelManager() {
    const pane = { uid: uid(601, 119), width: 190, height: 261, _absX: 745, _absWidth: 190 };
    return {
        getWidgetByUid: (id: number) => (id === pane.uid ? pane : undefined),
        getSubInterface: (id: number) => ({ group: id === uid(601, 27) ? 134 : 149 }),
        isEffectivelyHidden: () => false,
        isMobileChatDisabled: () => false,
    };
}

test("the main modal stays where the cache puts it when the interface scale goes back up", () => {
    // At 175% the cache has the modal far to the right in the wide layout.
    const modal: Node = { uid: uid(601, 27), x: 770, rawX: 770, y: 0, width: 512, height: 487 };
    // Back at 400%, a layout pass reaches the modal before the cache resize script does.
    adjustMobileHudWidget(modal, 896, 487, sidePanelManager());
    assert.deepEqual([modal.x, modal.rawX], [770, 770]);

    // The script then places it for the narrow layout, and later passes leave it there.
    Object.assign(modal, { x: 121, rawX: 121 });
    adjustMobileHudWidget(modal, 896, 487, sidePanelManager());
    assert.deepEqual([modal.x, modal.rawX], [121, 121]);
});

/** A gameframe with `group` in the main modal, and the scripts the fit check ran on it. */
function fitHarness(rootInterface = 601) {
    const state = { rootInterface, canvasWidth: 816, canvasHeight: 585, group: 134 };
    const runs: number[] = [];
    const manager = Object.assign(state, {
        getSubInterface: (id: number) => (id === uid(601, 27) && state.group ? { group: state.group } : undefined),
    });
    return { state, runs, check: () => fitAllSettingsBesideSidePanel(manager, (id) => runs.push(id)) };
}

test("All Settings runs the cache's side panel fit check as it opens and as the layout resizes", () => {
    const { state, runs, check } = fitHarness();
    check();
    check();
    assert.deepEqual(runs, [2527], "mobile_mainmodal_open once, so a reopened panel stays open");

    state.canvasWidth = 1865;
    check();
    assert.equal(runs.length, 2, "the interface scale changed under the window");

    state.group = 12;
    check();
    assert.equal(runs.length, 2, "the bank is not All Settings");
    state.group = 134;
    check();
    assert.equal(runs.length, 3, "reopened");
});

test("the fit check leaves desktop gameframes and Portrait Mode alone", () => {
    const desktop = fitHarness(161);
    desktop.check();
    assert.deepEqual(desktop.runs, []);

    const portrait = fitHarness();
    setMobilePortraitLayoutActive(true);
    try {
        portrait.check();
    } finally {
        setMobilePortraitLayoutActive(false);
    }
    assert.deepEqual(portrait.runs, [], "portrait stacks the panel under the window");
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
