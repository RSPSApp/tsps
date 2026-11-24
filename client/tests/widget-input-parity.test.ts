import assert from "node:assert/strict";
import { test } from "node:test";

import { processWidgetHoldInput } from "../game/widgets/input/widgetHoldInput";
import { processWidgetHoverInput } from "../game/widgets/input/widgetHoverInput";
import { processWidgetIf1ScrollbarInput } from "../game/widgets/input/widgetIf1ScrollbarInput";
import { processWidgetScrollWheelInput } from "../game/widgets/input/widgetScrollWheelInput";
import { createWidgetInputState } from "../game/widgets/input/widgetInputTypes";

// Mouse behaviour of the OSRS widget pass: hover stops under an open menu and during a drag, a
// press only holds while the cursor is on the widget, an IF1 list moves 45 pixels per wheel
// notch, and scroll scripts get the notch count, every one down to the first wheel blocker.

const vm = (ran: string[]) => ({ invokeEventHandler: (w: any, name: string, ctx: any) => { ran.push(`${w.name}:${name}${name === "onScroll" ? `:${ctx.mouseY}` : ""}`); return true; },
    scriptCallbackListeners: new Set(), context: {} });

test("hover: nothing is hovered while the menu is open or a widget is dragged", () => {
    const ran: string[] = [];
    const button: any = { uid: 1, name: "button", isIf3: true, eventHandlers: { onMouseOver: {}, onMouseRepeat: {}, onMouseLeave: {} } };
    let menuOpen = false;
    const interaction: any = { clickedWidget: null, isWidgetDraggable: () => true };
    const deps: any = { getCs2Vm: () => vm(ran), getWorldMap: () => ({ updateWorldMapIconHover() {} }), getMenuOpen: () => menuOpen, getRenderer: () => undefined };
    const manager: any = { getWidgetByUid: () => button };
    const state = createWidgetInputState();
    const frame: any = { mx: 5, my: 5, hits: [button] };
    processWidgetHoverInput(deps, state, frame, manager, interaction);
    assert.deepEqual(ran, ["button:onMouseOver", "button:onMouseRepeat"]);
    ran.length = 0;
    menuOpen = true;
    processWidgetHoverInput(deps, state, frame, manager, interaction);
    assert.deepEqual(ran, ["button:onMouseLeave"], "opening the menu un-hovers");
    ran.length = 0;
    processWidgetHoverInput(deps, state, frame, manager, interaction);
    assert.deepEqual(ran, [], "and nothing repeats under it");
    menuOpen = false;
    interaction.clickedWidget = { uid: 2 };
    processWidgetHoverInput(deps, state, frame, manager, interaction);
    assert.deepEqual(ran, [], "nor while a widget is picked up");
});

test("hold: sliding off the widget releases it and stops the repeats", () => {
    const ran: string[] = [];
    const arrow: any = { uid: 3, name: "arrow", _absX: 100, _absY: 100, width: 16, height: 16,
        eventHandlers: { onClickRepeat: {}, onHold: {}, onRelease: {} } };
    const interaction: any = { clickedWidget: arrow, isDraggingWidget: false, isWidgetDraggable: () => false };
    const deps: any = { getCs2Vm: () => vm(ran) };
    processWidgetHoldInput(deps, { mx: 105, my: 105 } as any, interaction, true, false);
    assert.deepEqual(ran, ["arrow:onClickRepeat", "arrow:onHold"]);
    ran.length = 0;
    processWidgetHoldInput(deps, { mx: 200, my: 105 } as any, interaction, true, false);
    assert.deepEqual(ran, ["arrow:onRelease"]);
    ran.length = 0;
    processWidgetHoldInput(deps, { mx: 200, my: 105 } as any, interaction, true, false);
    assert.deepEqual(ran, [], "off the widget nothing runs");
    processWidgetHoldInput(deps, { mx: 105, my: 105 } as any, interaction, true, false);
    assert.deepEqual(ran, ["arrow:onHold"], "back on it the hold resumes, the click repeat does not");
});

test("IF1 list: one wheel notch scrolls 45 pixels", () => {
    const list: any = { uid: 4, type: 0, isIf3: false, x: 0, y: 0, width: 200, height: 100, scrollHeight: 1000, scrollY: 0 };
    const input: any = { clickMode2: 0, wheelDeltaY: 100, clearWheel() { this.wheelDeltaY = 0; } };
    const manager: any = { isEffectivelyHidden: () => false, invalidateScroll() {} };
    const frame: any = { input, mx: 50, my: 50, allRoots: [list], getStaticChildren: () => [] };
    processWidgetIf1ScrollbarInput({} as any, createWidgetInputState(), frame, manager, { isDraggingWidget: false } as any);
    assert.equal(list.scrollY, 45);
    input.wheelDeltaY = -300;
    list.scrollY = 500;
    processWidgetIf1ScrollbarInput({} as any, createWidgetInputState(), frame, manager, { isDraggingWidget: false } as any);
    assert.equal(list.scrollY, 500 - 3 * 45);
});

test("scroll scripts get the notch count, down to the first wheel blocker", () => {
    const ran: string[] = [];
    const widget = (name: string, extra: object = {}) => ({ uid: name.length + 10, name, isIf3: true, _absX: 0, _absY: 0, x: 0, y: 0, width: 100, height: 100, eventHandlers: { onScroll: { scriptId: 1 } }, ...extra });
    const behind = widget("behind");
    const blocker = widget("blocker", { noScrollThrough: true });
    const inner = widget("inner");
    const input: any = { wheelDeltaY: 200, pinchZoomDelta: 0, getCameraZoomDelta: () => 200, clearWheel() { this.wheelDeltaY = 0; } };
    const deps: any = { getCs2Vm: () => vm(ran), getVarManager: () => ({}) };
    const manager: any = { isEffectivelyHidden: () => false, getContainerUidForGroup: () => undefined };
    processWidgetScrollWheelInput(deps, { input, mx: 5, my: 5, hits: [behind, blocker, inner] } as any, manager, { isDraggingWidget: false } as any);
    assert.deepEqual(ran, ["inner:onScroll:2", "blocker:onScroll:2"]);
    assert.equal(input.wheelDeltaY, 0, "the wheel is spent");
});
