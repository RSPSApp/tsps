import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDynamicWidgetParentId } from "../game/widgets/widgetActionPayload";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// OSRS: a child created inside a script-created layer still belongs to the layer's static
// component. Server event flags, event_com and op packets all name (component id, child index).

const handlers = createHandlerMap();
const COMPONENT = (928 << 16) | 20;
const widgets = new Map<number, any>();
let nextUid = (928 << 16) | 0x8000;
const manager: any = {
    getWidgetByUid: (uid: number) => widgets.get(uid),
    getGroup: () => ({}),
    isServerOwnedWidget: () => false,
    allocateDynamicUid: () => nextUid++,
    registerWidget: (w: any) => widgets.set(w.uid, w),
    invalidateDynamicChildrenCache() {}, invalidateWidgetRender() {}, invalidateWidget() {}, invalidateAll() {},
    interfaceParents: new Map(), getInterfaceParentContainerUid: () => undefined,
};
const component: any = { uid: COMPONENT, groupId: 928, fileId: 20, childIndex: -1, type: 0, children: [] };
widgets.set(COMPONENT, component);
const layer: any = { uid: nextUid++, id: COMPONENT, parentUid: COMPONENT, groupId: 928, fileId: -1, childIndex: 3, type: 0, children: [] };
component.children[3] = layer;
widgets.set(layer.uid, layer);

function run(opcode: number, active: any, ints: number[]) {
    const out: number[] = [];
    const ctx: any = { intStack: [...ints], intStackSize: ints.length, activeWidget: active, dotWidget: null,
        popInt() { return this.intStack[--this.intStackSize]; }, pushInt: (v: number) => out.push(v),
        setActiveWidget(w: any) { this.activeWidget = w; }, setDotWidget(w: any) { this.dotWidget = w; }, widgetManager: manager };
    handlers.get(opcode)!(ctx, 0, null as any);
    return { ctx, out };
}

test("a child created inside a layer is identified by the static component", () => {
    // cc_create_child(type, index) on the layer
    const { ctx } = run(Opcodes.CC_CREATECHILD, layer, [4, 7]);
    const child = ctx.activeWidget;
    assert.equal(child.childIndex, 7);
    assert.equal(child.id, COMPONENT, "its component id is the static component");
    assert.equal(child.parentUid, layer.uid, "its layer is still its parent for layout");
    assert.equal(resolveDynamicWidgetParentId(manager, child), COMPONENT, "op packets name the static component");
    assert.deepEqual(run(Opcodes.CC_GETPARENTLAYER, child, []).out, [COMPONENT]);
});

test("a top-level child is unchanged", () => {
    const { ctx } = run(Opcodes.CC_CREATECHILD, component, [4, 9]);
    assert.equal(ctx.activeWidget.id, COMPONENT);
    assert.equal(ctx.activeWidget.parentUid, COMPONENT);
});
