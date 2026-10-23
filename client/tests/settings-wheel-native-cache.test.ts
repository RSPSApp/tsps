import assert from "node:assert/strict";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";
import { processWidgetScrollWheelInput } from "../game/widgets/input/widgetScrollWheelInput";

// Decode the installed offline cache and run real Settings scripts without a game session.
const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
manager.rootInterface = 161;
manager.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent(createScriptEvent({ args: widget.onLoad, widget }), 200000);
manager.onLoadInvoker = (widget: any) => vm.invokeEventHandler(widget, "onLoad");
for (const root of manager.getAllGroupRoots(134)) manager.triggerOnLoad(root);
const list = manager.getWidgetByUid((134 << 16) | 14);
assert.equal(list.eventHandlers.onScroll.scriptId, 36, "native Settings wires scrollbar_vertical's wheel handler");
assert.ok(list.scrollHeight > list.height);
const scrollbar = manager.getWidgetByUid(list.eventHandlers.onScroll.intArgs[0]);
const thumb = scrollbar.children[1];
const before = thumb.y;
const wheel = () => {
    const input = { wheelDeltaY: 120 };
    processWidgetScrollWheelInput({ getCs2Vm: () => vm } as any, { input, mx: 30, hits: [list] } as any, manager, { isDraggingWidget: false } as any);
    assert.equal(input.wheelDeltaY, 0, "native Settings consumes camera delta");
};
assert.equal(list.scrollY, 0);
wheel();
assert.equal(list.scrollY, 45, "real cache wheel script advances Settings content");
assert.ok(thumb.y > before, "real cache scrollbar thumb follows the content");
list.scrollY = list.scrollHeight - list.height;
wheel();
assert.equal(list.scrollY, list.scrollHeight - list.height, "bottom boundary remains clamped and owns wheel");
console.log("native cache Settings wheel passed");
