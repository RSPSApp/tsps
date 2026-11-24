import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// Small component instruction rules from the OSRS client.
const handlers = createHandlerMap();

test("cc_delete leaves the deleted child as the active component", () => {
    const parent: any = { uid: 1, children: [] as any[] };
    const child: any = { uid: 2, parentUid: 1, childIndex: 0 };
    parent.children[0] = child;
    const ctx: any = { activeWidget: child, setActiveWidget(w: any) { this.activeWidget = w; },
        widgetManager: { getWidgetByUid: () => parent, invalidateDynamicChildrenCache() {}, unregisterWidgetTree() {}, invalidateWidgetRender() {} } };
    handlers.get(Opcodes.CC_DELETE)!(ctx, 0, null as any);
    assert.equal(parent.children[0], null);
    assert.equal(ctx.activeWidget, child);
});

test("a component's model zoom reads 100 until it is set", () => {
    const out: number[] = [];
    const run = (w: any) => handlers.get(Opcodes.CC_GETMODELZOOM)!({ activeWidget: w, pushInt: (v: number) => out.push(v) } as any, 0, null as any);
    run({ uid: 3 });
    run({ uid: 3, modelZoom: 250 });
    run(null);
    assert.deepEqual(out, [100, 250, 0]);
});
