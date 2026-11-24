import { strict as assert } from "node:assert";

import { Opcodes } from "../rs/cs2/Opcodes";
import { registerWidgetOps } from "../rs/cs2/handlers/WidgetOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";

// cc_setplayerhead_self / if_setplayerhead_self from a client script: the renderer draws the
// local player's chathead only for a widget flagged as one. Without the flag a script-set
// player head was blank (the server's own set_player_head set the flag, so dialogues worked).
const handlers: HandlerMap = new Map();
registerWidgetOps(handlers);

const make = () => ({ uid: (217 << 16) | 2, modelType: 2, modelId: 100, isNpcChathead: true, npcTypeId: 100 }) as any;
const ctx = (widget: any, ints: number[]) => ({
    intStack: Int32Array.from([...ints, 0, 0, 0, 0]), intStackSize: ints.length, activeWidget: widget, dotWidget: null,
    widgetManager: { getWidgetByUid: () => widget, getGroup: () => ({}), invalidateWidgetRender() {} },
}) as any;

for (const [opcode, ints] of [[Opcodes.CC_SETPLAYERHEAD_SELF, []], [Opcodes.IF_SETPLAYERHEAD_SELF, [(217 << 16) | 2]]] as const) {
    const widget = make();
    handlers.get(opcode)!(ctx(widget, [...ints]), 0, null);
    assert.equal(widget.modelType, 3);
    assert.equal(widget.isPlayerChathead, true, "drawn as the local player's head");
    assert.equal(widget.isNpcChathead, false, "no longer an NPC's head");
    assert.equal(widget.npcTypeId, undefined);
}
console.log("ok");
