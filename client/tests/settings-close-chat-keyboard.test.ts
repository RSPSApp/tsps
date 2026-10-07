import assert from "node:assert/strict";

import { WidgetInputController } from "../game/widgets/WidgetInputController";

// A search in All Settings (134) takes the keyboard from chat (cache script 2157); closing the
// interface any way must run 2158, which gives it back, or chat stays deaf.
const chat = { uid: 162 << 16 };
const ran: Array<{ widget: unknown; listener: number[] }> = [];
const controller = new WidgetInputController({
    getWidgetManager: () => ({ findWidget: (group: number, child: number) => (group === 162 && child === 0 ? chat : undefined) }),
    getVarManager: () => ({ setVarcInt: () => undefined }),
    executeScriptListener: (widget: unknown, listener: number[]) => ran.push({ widget, listener }),
} as any);

controller.onInterfaceClosed(134);
assert.deepEqual(ran, [{ widget: chat, listener: [2158] }], "closing All Settings restores chat's keyboard");

ran.length = 0;
controller.onInterfaceClosed(12);
assert.deepEqual(ran, [], "closing an unrelated interface leaves chat alone");

console.log("settings close chat keyboard test passed");
