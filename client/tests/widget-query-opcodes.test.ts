import assert from "node:assert/strict";

import { Cs2ArrayObject } from "../rs/cs2/Cs2ArrayObject";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

const root: any = { uid: 1 << 16, parentUid: -1, childIndex: -1, type: 0, children: [] };
const first: any = { uid: 1, parentUid: root.uid, childIndex: 0, type: 4, params: new Map([[7, 1]]) };
const container: any = {
    uid: 2,
    parentUid: root.uid,
    childIndex: 1,
    type: 0,
    params: new Map([[7, 2]]),
    children: [],
};
const nested: any = { uid: 3, parentUid: container.uid, childIndex: 2, type: 4, params: new Map([[7, 2]]) };
container.children[2] = nested;
root.children[0] = first;
root.children[1] = container;

let activeWidget: any = null;
const intStack = new Int32Array(32);
const objectStack: any[] = [];
const widgets = new Map([[root.uid, root], [container.uid, container]]);
const ctx: any = {
    intStack,
    stringStack: objectStack,
    intStackSize: 0,
    stringStackSize: 0,
    activeWidget,
    dotWidget: null,
    pushInt(value: number) { this.intStack[this.intStackSize++] = value; },
    popInt() { return this.intStack[--this.intStackSize]; },
    pushString(value: any) { this.stringStack[this.stringStackSize++] = value; },
    popString() { return this.stringStack[--this.stringStackSize]; },
    setActiveWidget(widget: any) { this.activeWidget = activeWidget = widget; },
    setDotWidget(widget: any) { this.dotWidget = widget; },
    widgetManager: {
        getGroup() {},
        getWidgetByUid(uid: number) { return widgets.get(uid) ?? null; },
        isServerOwnedWidget() { return false; },
        interfaceParents: new Map(),
        getInterfaceParentContainerUid() { return undefined; },
    },
    paramTypeLoader: { load: () => ({ defaultInt: 0, isString: () => false }) },
};
const handlers = createHandlerMap();
const run = (opcode: Opcodes) => handlers.get(opcode)!(ctx, 0, null);

ctx.pushInt(2);
ctx.pushInt(root.uid);
ctx.pushInt(-1);
run(Opcodes.WIDGET_QUERY);
assert.equal(ctx.popInt(), 3);

ctx.pushInt(7);
ctx.pushInt(2);
ctx.pushInt(0);
run(Opcodes.WIDGET_QUERY_FILTER);
assert.equal(ctx.popInt(), 2);

run(Opcodes.WIDGET_QUERY_GETINDICES);
const indices = ctx.popString() as Cs2ArrayObject;
assert.deepEqual([indices.getInt(0), indices.getInt(1)], [1, 2]);

run(Opcodes.WIDGET_QUERY_NEXT);
assert.equal(activeWidget, container);
run(Opcodes.WIDGET_QUERY_NEXTINDEX);
assert.equal(ctx.popInt(), 2);
run(Opcodes.WIDGET_QUERY_NEXTINDEX);
assert.equal(ctx.popInt(), -1);

ctx.setActiveWidget(container);
ctx.pushInt(2);
run(Opcodes.CC_WIDGET_QUERY);
assert.equal(ctx.popInt(), 1);
run(Opcodes.WIDGET_QUERY_NEXT);
assert.equal(activeWidget, nested);

// OSRS CCs live flat under their static component: a nested CC's layer is the
// static root, and cc_find(root, index) reaches it (Tutorial Island tab flash, script 8491).
ctx.setActiveWidget(nested);
run(Opcodes.CC_GETLAYER);
assert.equal(ctx.popInt(), root.uid);

ctx.pushInt(root.uid);
ctx.pushInt(2);
run(Opcodes.CC_FIND);
assert.equal(ctx.popInt(), 1);
assert.equal(activeWidget, nested);

console.log("widget query opcode tests passed");
