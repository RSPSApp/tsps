import { strict as assert } from "node:assert";

import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { OverlayPosition } from "@runelite/client/ui/overlay/OverlayPosition";
import { OverlayRenderer } from "@runelite/client/ui/overlay/OverlayRenderer";
import type { WidgetOverlay, WidgetOverlayDrawContext } from "../game/plugins/ClientPluginManager";
import { TimersPlugin } from "../game/plugins/statustimer/TimersPlugin";
import { formatTimerSeconds, timersScale } from "../game/plugins/statustimer/TimersInfoBoxOverlay";
import { TimersPosition } from "../game/plugins/statustimer/TimersConfig";
import { ITEM_TIMER_FIRST_VARP } from "../game/plugins/statustimer/timerIcons";

// The Timers plugin's corner overlay: its options, the server's item timers, and that it stacks
// with the overlays already in its corner instead of covering them.

(globalThis as any).window = { addEventListener() {}, removeEventListener() {} };

assert.equal(formatTimerSeconds(45), "45");
assert.equal(formatTimerSeconds(60), "1:00");
assert.equal(formatTimerSeconds(299), "4:59");
assert.equal(timersScale(150), 1.5);
assert.equal(timersScale(9000), 4, "at most 400%");
assert.equal(timersScale(10), 0.5, "at least 50%");

const config = inject(ConfigManager);
const plugin = new TimersPlugin();
const setOption = (key: string, value: string) => config.setConfiguration("timers", key, value);

// The item timers: seconds and item id pairs, as BuffTimers.plugin.js sends them.
const varps = new Map<number, number>([
    [ITEM_TIMER_FIRST_VARP, 300], [ITEM_TIMER_FIRST_VARP + 1, 23685], // divine super combat, 5:00
    [ITEM_TIMER_FIRST_VARP + 2, 5], [ITEM_TIMER_FIRST_VARP + 3, 29143], // moonlight antelope's second heal
    [ITEM_TIMER_FIRST_VARP + 5, 12905], // an item id without seconds: an empty slot
    [ITEM_TIMER_FIRST_VARP + 6, 42], [ITEM_TIMER_FIRST_VARP + 7, -1305], // Mark of Darkness: minus its sprite
]);
const now = Date.now(); // the overlay draws with the real clock
plugin.syncItemTimers((id) => varps.get(id) ?? 0, now);
const entries = plugin.timerEntries(now);
assert.deepEqual(entries.map((e) => [e.item, e.sprite, e.text]), [[23685, undefined, "5:00"], [29143, undefined, "5"], [undefined, 1305, "42"]],
    "item timers in slot order; a negative icon is a sprite");
plugin.syncItemTimers(() => 0, now + 1000);
assert.equal(plugin.timerEntries(now + 1000).length, 0, "cleared slots leave no boxes");
plugin.syncItemTimers((id) => varps.get(id) ?? 0, now);

// Each corner is its own overlay position (and its own saved Alt-drag place).
const overlay = plugin.widgetOverlay;
const expected: Record<TimersPosition, string> = {
    [TimersPosition.TOP_LEFT]: OverlayPosition.TOP_LEFT,
    [TimersPosition.TOP_RIGHT]: OverlayPosition.BELOW_MINIMAP,
    [TimersPosition.BOTTOM_LEFT]: OverlayPosition.BOTTOM_LEFT,
    [TimersPosition.BOTTOM_RIGHT]: OverlayPosition.BOTTOM_RIGHT,
};
for (const [corner, position] of Object.entries(expected)) {
    setOption("position", corner);
    assert.equal(overlay.movable.position, position, corner);
    assert.equal(overlay.movable.name, `TimersOverlay_${corner}`);
}

// Resizable layout (161) on a 1000x600 canvas at one device pixel per layout unit.
const canvas = { w: 1000, h: 600 };
const widget = (x: number, y: number, w: number, h: number) => ({ _absX: x, _absY: y, _absWidth: w, _absHeight: h, width: w, height: h });
const widgets = new Map<number, any>([
    [(161 << 16) | 91, widget(0, 0, canvas.w, canvas.h)], // viewport
    [(161 << 16) | 15, widget(0, 0, canvas.w, canvas.h)], // HUD container
    [(161 << 16) | 96, widget(0, canvas.h - 165, 519, 165)], // chat container
]);
const client: any = {
    widgetManager: { rootInterface: 161, getWidgetByUid: (uid: number) => widgets.get(uid), isEffectivelyHidden: () => false },
    inputManager: { element: { width: canvas.w, height: canvas.h, getBoundingClientRect: () => ({ left: 0, top: 0, ...canvas }) }, addInputFilter: () => () => {} },
};
const renderer = new OverlayRenderer(client, config);

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** One UI pass: `first` places itself, then the timers draw; the boxes the timers covered. */
function pass(first: WidgetOverlay, firstSize: [number, number]): { first: Rect; timers: Rect[] } {
    const placed = renderer.placeOverlay(first, ...firstSize, canvas)!;
    const context = {
        renderer: { drawRect() {}, drawTexture() {} },
        fontLoader: () => undefined,
        sprite: () => undefined,
        place: (o: WidgetOverlay, w: number, h: number) => renderer.placeOverlay(o, w, h, canvas),
        canvasCssWidth: canvas.w,
    } as unknown as WidgetOverlayDrawContext;
    const timers = overlay.draw(context);
    renderer.widgetOverlay.draw(context); // ends the pass
    return { first: { x: placed.x, y: placed.y, w: firstSize[0] * placed.scaleX, h: firstSize[1] * placed.scaleY }, timers };
}

// Top left: below Opponent Information, not over it.
setOption("position", TimersPosition.TOP_LEFT);
setOption("scale", "100");
const opponent: WidgetOverlay = { signature: () => "", draw: () => [], movable: { name: "OpponentInfoOverlay", position: OverlayPosition.TOP_LEFT } };
const top = pass(opponent, [129, 38]);
assert.equal(top.timers.length, 3);
for (const box of top.timers) {
    assert.ok(!overlaps(box, top.first), "the timers don't cover Opponent Information");
    assert.ok(box.y >= top.first.y + top.first.h, "they sit below it");
}

// Bottom left: above the chatbox and beside the Slayer Tracker.
setOption("position", TimersPosition.BOTTOM_LEFT);
const slayer: WidgetOverlay = { signature: () => "", draw: () => [], movable: { name: "SlayerTrackerOverlay", position: OverlayPosition.BOTTOM_LEFT } };
const bottom = pass(slayer, [160, 90]);
const chatTop = canvas.h - 165;
for (const box of bottom.timers) {
    assert.ok(!overlaps(box, bottom.first), "the timers don't cover the Slayer Tracker");
    assert.ok(box.y + box.h <= chatTop, "they sit above the chatbox");
}

// Scale: 200% boxes are twice as big as 100% ones.
setOption("position", TimersPosition.TOP_LEFT);
const small = pass(opponent, [129, 38]).timers[0];
setOption("scale", "200");
const big = pass(opponent, [129, 38]).timers[0];
assert.equal(big.w, small.w * 2);
assert.equal(big.h, small.h * 2);

console.log("timers overlay tests passed");
