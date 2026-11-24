import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";

// OSRS builds a component's menu as: ops up to its target priority (default: the fifth op), the
// target verb ("Use", "Cast") once, the later low-priority ops, and, on a pause button,
// "Continue" above them all.

const options = (w: any, flags = ~1) =>
    deriveMenuEntriesForWidget(w, false, () => flags, () => undefined).map((e) => e.option);
const item = (actions: (string | null)[], extra: object = {}) => ({ itemId: 4151, name: "Thing", actions, targetVerb: "Use", ...extra });

test("Use comes after every op up to the target priority", () => {
    assert.deepEqual(options(item([null, "Wear", "Check", null, null, null, "Drop"])), ["Wear", "Check", "Use", "Drop", "Cancel"]);
    assert.deepEqual(options(item([null, null, null, "Rub", null, null, "Drop"])), ["Rub", "Use", "Drop", "Cancel"]);
    assert.deepEqual(options(item([null, null, null, null, null, "Empty", "Drop"])), ["Use", "Empty", "Drop", "Cancel"]);
});

test("a script-set target priority moves it", () => {
    assert.deepEqual(options(item([null, "Wear", "Check"], { targetPriority: 1 })), ["Wear", "Use", "Check", "Cancel"]);
});

test("a target verb is listed once, however many blank op slots transmit", () => {
    const spell = { name: "Spell", actions: ["", "", null, null, null, "Warnings"], targetVerb: "Cast" };
    assert.deepEqual(options(spell, (1 << 11) | 0x7e), ["Cast", "Warnings", "Cancel"]);
});

test("a pause button lists Continue first even with ops of its own", () => {
    assert.deepEqual(options({ name: "Row", actions: ["Select"], fileId: 3 }, 0x3), ["Continue", "Select", "Cancel"]);
});
