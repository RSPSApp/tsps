import { strict as assert } from "node:assert";

import { Opcodes } from "../rs/cs2/Opcodes";
import { registerWidgetOps } from "../rs/cs2/handlers/WidgetOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

// cc_setnpcmodel / if_setnpcmodel: the widget shows the NPC's body, model type 9 with the NPC id
// as its model id (type 6 is something else, and the id is never a raw model id).
const handlers: HandlerMap = new Map();
registerWidgetOps(handlers);
const make = () => ({ uid: (900 << 16) | 3, modelType: 2, modelId: 1, isNpcChathead: true, npcTypeId: 1 }) as any;
const ctx = (widget: any, ints: number[]) => ({
    intStack: Int32Array.from([...ints, 0, 0, 0, 0]), intStackSize: ints.length, activeWidget: widget, dotWidget: null,
    widgetManager: { getWidgetByUid: () => widget, getGroup: () => ({}), invalidateWidgetRender() {} },
}) as any;

const cc = make();
handlers.get(1215)!(ctx(cc, [3105]), 0, null);
assert.deepEqual([cc.modelType, cc.modelId, cc.isNpcChathead], [9, 3105, false]);
const ifw = make();
handlers.get(Opcodes.IF_SETNPCMODEL)!(ctx(ifw, [3105, ifw.uid]), 0, null);
assert.deepEqual([ifw.modelType, ifw.modelId, ifw.isNpcChathead], [9, 3105, false]);
console.log("ok");
