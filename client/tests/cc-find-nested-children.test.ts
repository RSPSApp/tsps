import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// OSRS keeps one child array per component: children made inside a layer (cc_create_child,
// cc_create_sibling) are in it too. So the find-by-param instruction (210) reaches nested
// children, cc_find_child(n) is the layer's n-th child, and cc_childcount skips gaps.

const handlers = createHandlerMap();
const child = (childIndex: number, extra: object = {}): any => ({ uid: 9000 + childIndex, childIndex, type: 4, params: new Map(), ...extra });

const label = child(7, { params: new Map([[2365, 400]]) });
const icon = child(9);
const layer = child(3, { type: 0, children: [] as any[] });
layer.children[7] = label;
layer.children[9] = icon;
const top = child(1, { params: new Map([[2365, 212]]) });
const component: any = { uid: (928 << 16) | 20, type: 0, children: [] as any[] };
component.children[1] = top;
component.children[3] = layer;

function context(active: any, ints: number[]) {
    const out: number[] = [];
    const ctx: any = {
        intStack: [...ints], intStackSize: ints.length, activeWidget: active, dotWidget: null,
        popInt() { return this.intStack[--this.intStackSize]; },
        pushInt: (v: number) => out.push(v),
        setActiveWidget(w: any) { this.activeWidget = w; },
        setDotWidget(w: any) { this.dotWidget = w; },
        widgetManager: { getWidgetByUid: (uid: number) => (uid === component.uid ? component : undefined), getStaticChildrenByParentUid: () => [], getGroup: () => ({}) },
        paramTypeLoader: { load: () => ({ defaultInt: 0, isString: () => false }) },
    };
    return { ctx, out };
}
// [component, param1, value1, param2, value1Type, value2Type]: no second value when its type is -1
const findByParam = (value: number, active: any = top) => {
    const { ctx, out } = context(active, [component.uid, 2365, value, -1, 0, -1]);
    handlers.get(Opcodes.IF_FIND_CHILD)!(ctx, 0, null as any);
    return { found: out[0], active: ctx.activeWidget };
};

test("find by param reaches a child created inside a layer", () => {
    assert.deepEqual(findByParam(400), { found: 1, active: label });
    assert.deepEqual(findByParam(212), { found: 1, active: top });
});

test("a miss leaves the active component alone", () => {
    assert.deepEqual(findByParam(999, icon), { found: 0, active: icon });
});

test("cc_find_child takes the layer's n-th child, and cc_childcount counts them", () => {
    const first = context(layer, [0]);
    handlers.get(Opcodes.CC_FIND_CHILD)!(first.ctx, 0, null as any);
    assert.equal(first.ctx.activeWidget, label);
    const second = context(layer, [1]);
    handlers.get(Opcodes.CC_FIND_CHILD)!(second.ctx, 0, null as any);
    assert.equal(second.ctx.activeWidget, icon);
    const none = context(layer, [2]);
    handlers.get(Opcodes.CC_FIND_CHILD)!(none.ctx, 0, null as any);
    assert.deepEqual([none.out[0], none.ctx.activeWidget], [0, layer]);
    const count = context(layer, []);
    handlers.get(Opcodes.CC_CHILDCOUNT)!(count.ctx, 0, null as any);
    assert.deepEqual(count.out, [2], "ten slots, two children");
});
