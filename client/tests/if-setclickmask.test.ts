import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// if_setclickmask (2122) is the component form of 1122: it sets the alternate sprite (the
// minimap's click mask). The toplevel resize script 920 passes it sprite ids such as 3513.
test("if_setclickmask sets the alternate sprite and leaves the event flags alone", () => {
    const widget: any = { uid: (161 << 16) | 30, spriteId2: -1, targetMask: 0 };
    let flagsSet = false;
    const ctx: any = {
        intStack: [3513, widget.uid], intStackSize: 2,
        widgetManager: { getWidgetByUid: () => widget, getGroup: () => ({}), setWidgetFlagsOverride: () => { flagsSet = true; }, invalidateWidgetRender() {} },
    };
    createHandlerMap().get(Opcodes.IF_SETCLICKMASK)!(ctx, 0, null as any);
    assert.equal(widget.spriteId2, 3513);
    assert.equal(flagsSet, false);
    assert.equal(widget.targetMask, 0);
    assert.equal(ctx.intStackSize, 0);
});
