import assert from "node:assert/strict";

import { HeldWidgetProperties } from "../widgets/HeldWidgetProperties";

const uid = (groupId: number, component: number) => (groupId << 16) | component;
const held = new HeldWidgetProperties();

// A journal scroll's lines arrive before it opens: held per interface, in arrival order.
held.hold({ action: "set_text", uid: uid(741, 2), text: "Achievement Diary - Ardougne" } as any);
held.hold({ action: "set_text", uid: uid(741, 4), text: "Ardougne Area Tasks" } as any);
held.hold({ action: "set_hidden", uid: uid(90, 43), hidden: true } as any);
assert.equal(held.size, 2);

// A later value for the same component and property replaces the earlier one, at the end.
held.hold({ action: "set_text", uid: uid(741, 2), text: "Achievement Diary - Desert" } as any);
assert.deepEqual(
    held.take(741).map((payload: any) => payload.text),
    ["Ardougne Area Tasks", "Achievement Diary - Desert"],
);
assert.deepEqual(held.take(741), [], "taken once");

// Stray legacy ids (interface 0) stay bounded: one entry per component and property.
for (let i = 0; i < 100; i++) held.hold({ action: "set_text", uid: 52029, text: `Kills: ${i}` } as any);
assert.equal((held.take(0) as any[]).length, 1);

held.clear();
assert.equal(held.size, 0);

console.log("held widget properties: ok");
