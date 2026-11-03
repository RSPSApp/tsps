import assert from "node:assert/strict";
import { test } from "node:test";

import {
    adjustMobilePortraitWidget,
    setMobilePortraitLayoutActive,
    setPortraitLeftHanded,
    setPortraitModeEnabled,
    isMobilePortraitLayoutActive,
} from "../game/plugins/portraitmode/PortraitLayout";
import { getForcedLandscapeRotation } from "../game/useSafariLandscapeLock";
import { layoutWidgets, setWidgetLayoutAdjuster, type WidgetLike } from "../widgets/layout/WidgetLayout";

type Node = WidgetLike & { uid: number; parentUid: number; spriteAngle?: number };

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
    add(96, 87, { rawWidth: 40, heightMode: 1, xPositionMode: 1, yPositionMode: 1 });
    add(110, 96, { type: 5, rawY: 235, rawWidth: 33, rawHeight: 36, xPositionMode: 1, spriteAngle: 0 });
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

        assert.equal(byChild.get(110)?.spriteAngle, 16384, "portrait turns the native arrows down/up");
        byChild.get(50)!.rawWidth = 58;
        layoutWidgets(root, 523, 1131, children);
        assert.deepEqual(rect(byChild.get(50)), [2, 1131 - 58 - 2, 280, 58], "collapsed height follows the native toggle");
        assert.deepEqual(rect(byChild.get(87)), [3, 3, 274, 40]);
        assert.deepEqual(rect(byChild.get(61)), [3, 15, 274, 40], "the top row folds over the bottom row");
        byChild.get(50)!.rawWidth = 85;
        layoutWidgets(root, 523, 1131, children);
        assert.deepEqual(rect(byChild.get(61)), [3, 42, 274, 40], "Show More restores two separated rows");

        setPortraitLeftHanded(true);
        layoutWidgets(root, 523, 1131, children);
        assert.equal(byChild.get(22)?.x, 523 - 234 - 2, "left-handed minimap on the right");
        assert.equal(byChild.get(50)?.x, 523 - 280 - 2, "left-handed tab rows on the right");
        assert.equal(byChild.get(111)?.x, 2, "left-handed inventory on the left");
        assert.deepEqual(rect(byChild.get(64)), [39, 0, 40, 40], "button order and icons are not mirrored");

        // Turning the phone sideways restores the cache layout.
        setMobilePortraitLayoutActive(false);
        layoutWidgets(root, 1055, 488, children);
        assert.deepEqual(rect(byChild.get(50)), [680 - 85, ((488 - 280) >> 1) + 87, 85, 280]);
        assert.deepEqual(rect(byChild.get(63)), [0, 0, 40, 40]);
        assert.deepEqual(rect(byChild.get(64)), [0, 39, 40, 40]);
        assert.equal(byChild.get(110)?.spriteAngle, 0, "landscape keeps the native left/right arrows");
    } finally {
        setPortraitLeftHanded(false);
        setMobilePortraitLayoutActive(false);
        setWidgetLayoutAdjuster(null);
    }
});

test("enabled Portrait Mode keeps landscape inventory and tab columns bottom-aligned", () => {
    setPortraitModeEnabled(true);
    setMobilePortraitLayoutActive(false);
    setWidgetLayoutAdjuster(adjustMobilePortraitWidget);
    try {
        for (const [width, height] of [[765, 621], [765, 684], [765, 797], [1055, 488]]) {
            const { root, byChild, children } = gameframe();
            Object.assign(byChild.get(111)!, { rawY: 87, yPositionMode: 1 });
            layoutWidgets(root, width, height, children);
            assert.equal(byChild.get(111)?.y, height - 275 - 2, "inventory stays against the bottom");
            assert.equal(byChild.get(50)?.y, height - 280 - 2, "tab columns stay against the same bottom edge");
            assert.equal(byChild.get(50)?.rawY, 87, "native raw geometry is preserved");
        }
        setPortraitModeEnabled(false);
        const { root, byChild, children } = gameframe();
        layoutWidgets(root, 765, 621, children);
        assert.equal(byChild.get(50)?.y, ((621 - 280) >> 1) + 87, "disabled plugin retains native alignment");
    } finally {
        setPortraitModeEnabled(false);
        setWidgetLayoutAdjuster(null);
    }
});

test("portrait follows the window when its bottom toolbar makes the canvas landscape", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 1320, innerHeight: 1340 } });
    setPortraitModeEnabled(true);
    try {
        const { WidgetManager } = await import("../widgets/WidgetManager");
        const manager = new WidgetManager({} as never, {} as never);
        manager.rootInterface = 601;
        manager.resize(810, 800);
        assert.equal(isMobilePortraitLayoutActive(), true, "portrait remains active in the slightly wider canvas");
        const { root, byChild, children } = gameframe();
        layoutWidgets(root, 810, 800, children);
        const panel = byChild.get(111)!;
        assert.equal(panel.x! + panel.width! <= 810, true, "inventory stays inside the canvas");
        assert.equal(byChild.get(50)?.y, 800 - 85 - 2, "tab stones stay along the bottom");
        (globalThis as any).window.innerWidth = 1360;
        manager.resize(810, 800);
        assert.equal(isMobilePortraitLayoutActive(), false, "the same canvas dimensions still update when the window turns landscape");
    } finally {
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
        else delete (globalThis as any).window;
        setPortraitModeEnabled(false);
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
        setPortraitLeftHanded(false);
        setMobilePortraitLayoutActive(false);
        setWidgetLayoutAdjuster(null);
    }
});

test("the Portrait Mode plugin is off by default and switches the layout state", async () => {
    const { PortraitModePlugin, PortraitModeConfig } = await import("../game/plugins/portraitmode/PortraitModePlugin");
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
    const { ConfigChanged } = await import("@runelite/api/events");
    const { ConfigManager } = await import("@runelite/client/config/ConfigManager");
    const { inject } = await import("@runelite/client/plugins/PluginInjector");
    const { isPortraitLeftHanded } = await import("../game/plugins/portraitmode/PortraitLayout");
    const config = inject(ConfigManager);
    assert.equal(isPortraitLeftHanded(), false, "right-handed by default");
    config.setConfigValue(PortraitModeConfig, "leftHanded", true);
    plugin.onConfigChanged(new ConfigChanged("portraitmode", "leftHanded", "false", "true"));
    assert.equal(isPortraitLeftHanded(), true, "plugin settings update handedness");
    assert.equal(config.getConfiguration("portraitmode", "leftHanded"), "true", "choice is saved");
    await plugin.stop();
    assert.equal(isPortraitModeEnabled(), false);
    unsubscribe();
    assert.equal(changes, 2, "the landscape lock hears both switches");
    setPortraitLeftHanded(false);
    const restarted = new PortraitModePlugin();
    await restarted.start();
    assert.equal(isPortraitLeftHanded(), true, "re-enabling restores the saved choice");
    await restarted.stop();
    config.setConfigValue(PortraitModeConfig, "leftHanded", false);
    setPortraitLeftHanded(false);
});
