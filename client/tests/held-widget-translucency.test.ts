import assert from "node:assert/strict";

import { heldWidgetTranslucentUid } from "../game/widgets/interaction/widgetDragHelpers";
import { MAIN_INVENTORY_SLOT_FLAGS } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// Issue 6690. OSRS draws Client.clickedWidget at transparency 128, and only a draggable
// component becomes clickedWidget. A pressed side tab stone is no drag source: live shows its
// red selected stone at full strength on the press, where we showed it at half strength until
// the mouse was released, so one click looked like two.
const { vm } = require("../scripts/cache/cs2-sweep").createCacheVm();
const wm = vm.context.widgetManager;
wm.rootInterface = 161;
wm.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent({ args: widget.onLoad, widget });
wm.getGroup(161);
const root = wm.getWidgetByUid(161 << 16);
vm.runScriptEvent({ args: root.onLoad, widget: root });
assert.equal(vm.lastError, null);

// The gameframe's own stones (161:59-65), with the onOp the cache gives them (script 914).
for (let tab = 0; tab < 7; tab++) {
    const stone = wm.getWidgetByUid((161 << 16) | (59 + tab));
    assert.equal(JSON.stringify(stone.onOp), JSON.stringify([914, -2147483644, 1130, tab]));
    assert.equal(heldWidgetTranslucentUid(wm, stone), null, `a held tab ${tab} stone draws opaque`);
}

// A held inventory item still draws at 128: the server gives the slots drag depth 1.
wm.getGroup(149);
const slot = wm.getWidgetByUid(149 << 16);
wm.setWidgetFlagsByKey(slot.uid, 0, MAIN_INVENTORY_SLOT_FLAGS);
const item = { ...slot, uid: slot.uid, childIndex: 0, parentUid: slot.uid, flags: MAIN_INVENTORY_SLOT_FLAGS };
assert.equal(heldWidgetTranslucentUid(wm, item), slot.uid | 0, "a held inventory item draws translucent");

// A script-made draggable (cc_setdraggable) too.
assert.equal(heldWidgetTranslucentUid(wm, { uid: 1234, isDraggable: true }), 1234);
assert.equal(heldWidgetTranslucentUid(wm, null), null);

console.log("held-widget-translucency: ok");
