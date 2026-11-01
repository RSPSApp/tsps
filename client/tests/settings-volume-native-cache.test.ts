import assert from "node:assert/strict";
import { TRANSMIT_VARPS } from "../common/vars";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";

const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
const vars = vm.context.varManager;
const errors: string[] = [];
vm.logError = (error: any) => errors.push(String(error?.message ?? error));
const transmitted: number[][] = [];
const released: any[][] = [];
vm.context.onIfTriggerOpLocal = (uid: number, _slot: number, _item: number, _op: number, args: any[]) => released.push([uid, args]);
manager.rootInterface = 161;
manager.getGroup(116);
manager.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent(createScriptEvent({ args: widget.onLoad, widget }), 200000);

// Real cache listeners change the volume before the button's server op is sent.
for (const [container, slider, mute, varp, volume] of [
    [83, 95, 96, 3796, 60],
    [97, 109, 110, 168, 35],
    [111, 123, 124, 169, 65],
    [125, 137, 138, 872, 80],
]) {
    vars.onVarpChange = undefined;
    vars.setServerVarp(varp, volume);
    manager.triggerOnLoad(manager.getWidgetByUid((116 << 16) | container));
    vars.onVarpChange = (id: number, _old: number, value: number) => {
        if (TRANSMIT_VARPS.has(id)) transmitted.push([id, value]);
    };
    const button = manager.getWidgetByUid((116 << 16) | mute);
    assert.equal(vm.invokeEventHandler(button, "onOp", { opIndex: 1 }), true);
    assert.equal(vars.getVarp(varp), 0, `mute ${varp} silences locally`);
    assert.deepEqual(transmitted, [], "the server button handler must see the previous volume");
    assert.equal(vm.invokeEventHandler(button, "onOp", { opIndex: 1 }), true);
    assert.equal(vars.getVarp(varp), volume, `unmute ${varp} restores the saved level`);
    assert.deepEqual(transmitted, [], "unmute is also owned by the server button handler");

    // Sliders still persist through their explicit trigger, without a generic varp packet.
    released.length = 0;
    const sliderWidget = manager.getWidgetByUid((116 << 16) | slider);
    assert.equal(vm.invokeEventHandler(sliderWidget, "onDragComplete", { mouseX: 32 }), true);
    assert.deepEqual(released, [[sliderWidget.uid, [vars.getVarp(varp)]]]);
    assert.deepEqual(transmitted, []);
}
assert.deepEqual(errors, []);
console.log("native cache Settings mute and slider persistence passed");
