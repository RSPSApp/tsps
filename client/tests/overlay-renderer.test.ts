import { strict as assert } from "node:assert";

import { TimersPlugin } from "../game/plugins/statustimer/TimersPlugin";
import { mobileCombatTimerStyle } from "../game/widgets/MobileHudLayout";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { OverlayRenderer } from "@runelite/client/ui/overlay/OverlayRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../game/plugins/ClientPluginManager";

// A window that only records the drag listeners, so the test can play the mouse.
const windowListeners = new Map<string, (event: any) => void>();
(globalThis as any).window = {
    addEventListener: (type: string, listener: (event: any) => void) => windowListeners.set(type, listener),
    removeEventListener: (type: string) => windowListeners.delete(type),
};

// Resizable layout (161) on a 1000x600 canvas at 1 device pixel per layout unit.
let canvas = { w: 1000, h: 600 };
const widget = (x: number, y: number, w: number, h: number) => ({
    _absX: x, _absY: y, _absWidth: w, _absHeight: h, width: w, height: h,
});
const widgets = new Map<number, any>();
const layoutFor = () => {
    widgets.set((161 << 16) | 91, widget(0, 0, canvas.w, canvas.h)); // viewport
    widgets.set((161 << 16) | 15, widget(0, 0, canvas.w, canvas.h)); // HUD container
    widgets.set((161 << 16) | 96, widget(0, canvas.h - 165, 519, 165)); // chat container
};
layoutFor();

let filter: ((type: string, event: any) => boolean) | undefined;
const element = {
    get width() { return canvas.w; },
    get height() { return canvas.h; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.w, height: canvas.h }),
};
const client: any = {
    widgetManager: {
        rootInterface: 161,
        getWidgetByUid: (uid: number) => widgets.get(uid),
        isEffectivelyHidden: () => false,
    },
    inputManager: {
        element,
        addInputFilter(f: (type: string, event: any) => boolean) {
            filter = f;
            return () => (filter = undefined);
        },
    },
};

const config = new ConfigManager(undefined);
const renderer = new OverlayRenderer(client, config);
renderer.start();

const panel: WidgetOverlay = {
    signature: () => "",
    draw: () => [],
    movable: { name: "OpponentInfoOverlay", position: OverlayPosition.TOP_LEFT },
};
const PANEL_W = 129;
const PANEL_H = 38;

const drawn: { x: number; y: number; w: number; h: number }[] = [];
const context = {
    renderer: { drawRect: (x: number, y: number, w: number, h: number) => drawn.push({ x, y, w, h }) },
    fontLoader: () => undefined,
    sprite: () => undefined,
    place: () => undefined,
} as unknown as WidgetOverlayDrawContext;

/** One UI pass: the panel places itself, then the renderer draws last. */
function pass() {
    const at = renderer.placeOverlay(panel, PANEL_W, PANEL_H, canvas);
    drawn.length = 0;
    renderer.widgetOverlay.draw(context);
    return at;
}
const mouse = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
    clientX: x, clientY: y, altKey: true, button: 0, ...extra,
});
const key = (type: string) => filter!(type, { key: "Alt" });
const saved = (suffix: string) => config.getConfiguration("runelite", `OpponentInfoOverlay${suffix}`);

// Default: RuneLite's TOP_LEFT, 5 in and below the mouse-over text.
assert.deepEqual(pass(), { x: 5, y: 20, scaleX: 1, scaleY: 1 });
assert.equal(drawn.length, 0, "no outlines without Alt");

// Without Alt the game gets the click.
assert.equal(filter!("mousePressed", mouse(50, 30, { altKey: false })), false);

// Alt outlines the overlay; a drag moves it and is kept from the game.
key("keyPressed");
assert.match(renderer.widgetOverlay.signature(), /^1,/);
pass();
assert.equal(drawn.length, 4, "an outline around the panel");
assert.equal(filter!("mousePressed", mouse(50, 30)), true, "the press starts a drag");
assert.equal(filter!("mouseMoved", mouse(60, 40)), true, "canvas moves are kept from the game");
windowListeners.get("mousemove")!(mouse(450, 330));
assert.deepEqual(pass(), { x: 405, y: 320, scaleX: 1, scaleY: 1 }, "follows the mouse at the grab offset");
windowListeners.get("mouseup")!(mouse(850, 230));
assert.ok(!windowListeners.has("mousemove") && !windowListeners.has("mouseup"), "drag listeners removed");
assert.equal(saved("_preferredLocation"), "-195:220", "saved from its nearest side");
assert.equal(saved("_originX"), "RIGHT");
assert.equal(saved("_originY"), "TOP");
assert.deepEqual(pass(), { x: 805, y: 220, scaleX: 1, scaleY: 1 });

// It keeps its distance from the right edge when the canvas grows.
canvas = { w: 1200, h: 600 };
layoutFor();
assert.deepEqual(pass(), { x: 1005, y: 220, scaleX: 1, scaleY: 1 });

// Dropped on a snap corner it locks there: TOP_RIGHT is 5 in from the HUD's right edge.
assert.equal(filter!("mousePressed", mouse(1010, 225)), true);
windowListeners.get("mouseup")!(mouse(1180, 20));
assert.equal(saved("_preferredPosition"), "TOP_RIGHT");
assert.equal(saved("_preferredLocation"), undefined, "a snapped overlay has no location");
assert.deepEqual(pass(), { x: 1200 - 5 - PANEL_W, y: 5, scaleX: 1, scaleY: 1 });

// Letting go of Alt hides the outlines; Alt + right-click resets it.
key("keyReleased");
pass();
assert.equal(drawn.length, 0);
key("keyPressed");
pass();
assert.equal(filter!("mousePressed", mouse(1100, 10, { button: 2 })), true);
assert.equal(saved("_preferredPosition"), undefined);
assert.deepEqual(pass(), { x: 5, y: 20, scaleX: 1, scaleY: 1 }, "back at TOP_LEFT");

// Positions come back from config in a new session.
config.setConfiguration("runelite", "OpponentInfoOverlay_preferredPosition", "BOTTOM_LEFT");
const next = new OverlayRenderer(client, config);
const at = next.placeOverlay(panel, PANEL_W, PANEL_H, canvas)!;
assert.deepEqual([at.x, at.y], [5, 600 - 165 - 5 - PANEL_H], "above the chatbox, 5 in");

renderer.stop();

// Boosts/defence share the combat-status anchor below the minimap, independent of DPR.
const boost: WidgetOverlay = { signature: () => "", draw: () => [],
    movable: { name: "BoostsInfoBoxOverlay", position: OverlayPosition.BELOW_MINIMAP } };
const timers = new TimersPlugin();
timers.poison.sync(300, 1);
timers.freeze.sync(300, 1);
client.runeLite = { pluginManager: { getPlugin: () => timers } };
for (const [width, height, dpr] of [[848, 720, 1], [640, 385, 2], [1200, 800, 1]]) {
    canvas = { w: width * dpr, h: height * dpr };
    layoutFor();
    client.renderer = { canvas: { width: canvas.w, height: canvas.h, clientWidth: width, clientHeight: height } };
    client.widgetManager.minimapWidget = widget((width - 185) * dpr, 5 * dpr, 170 * dpr, 160 * dpr);
    client.widgetManager.minimapWidget.width = 170;
    const placed = new OverlayRenderer(client, config).placeOverlay(boost, 28, 28, canvas)!;
    assert.equal(placed.y, (173 + 58) * dpr, "Boosts always sit below the Wilderness and timer row");
    assert.equal(placed.x + 28 * placed.scaleX, (width - 15) * dpr, "Boosts align with the full combat-status row");
}
// Mobile Boosts always start below the full native Wilderness panel, regardless of active timers.
for (const [width, dpr] of [[844, 1], [375, 2], [708, 2]]) {
    canvas = { w: width * dpr, h: 812 * dpr };
    client.renderer.canvas = { width: canvas.w, height: canvas.h, clientWidth: width, clientHeight: 812 };
    Object.assign(client.widgetManager, { rootInterface: 601, canvasWidth: width, canvasHeight: 812 });
    widgets.set((601 << 16) | 1, widget(0, 0, canvas.w, canvas.h));
    const mobile = new OverlayRenderer(client, config);
    const at = mobile.placeOverlay(boost, 28, 28, canvas)!;
    assert.equal(at.x, 8 * dpr, "Boosts align with the Wilderness indicator on their own row");
    assert.equal(at.y, (173 + 54 + 4 * 1.25) * dpr);
    assert.equal(at.scaleX, dpr * 1.25, "Boosts follow the same growth as mobile CSS timers");
    mobile.widgetOverlay.draw(context);
    const wrap = mobile.placeOverlay(boost, width / 1.25 - 16, 88, canvas)!;
    assert.equal(wrap.x, 8 * dpr);
    assert.equal(wrap.y, (173 + 54 + 4 * 1.25) * dpr, "wrapped Boosts clear the Wilderness level and range");
    mobile.widgetOverlay.draw(context);
    timers.setEnabledState(false);
    const disabled = mobile.placeOverlay(boost, 28, 28, canvas)!;
    assert.equal(disabled.x, at.x, "disabling timers keeps Boosts on their own row");
    timers.setEnabledState(true);
    assert.equal(disabled.y, at.y);
    assert.ok(at.y >= (Number(mobileCombatTimerStyle(client, 0)!.top) + 28 * 1.25) * dpr,
        "even a single Boosts counter clears the timers above");
}
console.log("overlay renderer test passed");
