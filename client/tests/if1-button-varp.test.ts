import assert from "node:assert/strict";
import { test } from "node:test";

import { applyIf1ButtonVarp } from "../game/widgets/input/if1ButtonVarp";

// OSRS: a legacy toggle button flips its varp in the client, and a select button sets it to
// its comparison value, so the button redraws without waiting for the server.
const varps = (initial: Record<number, number>) => {
    const values = { ...initial };
    return { values, getVarp: (id: number) => values[id] ?? 0, setVarp: (id: number, value: number) => { values[id] = value; } };
};
const button = (buttonType: number, value = 0): any => ({ isIf3: false, buttonType, cs1Instructions: [[5, 170, 0]], cs1ComparisonValues: [value] });

test("a toggle flips its varp", () => {
    const v = varps({ 170: 0 });
    assert.equal(applyIf1ButtonVarp(button(4), v), true);
    assert.equal(v.values[170], 1);
    applyIf1ButtonVarp(button(4), v);
    assert.equal(v.values[170], 0);
});

test("a select sets its comparison value once", () => {
    const v = varps({ 170: 0 });
    assert.equal(applyIf1ButtonVarp(button(5, 3), v), true);
    assert.equal(v.values[170], 3);
    assert.equal(applyIf1ButtonVarp(button(5, 3), v), false);
});

test("other buttons, IF3 widgets and other cs1 scripts are left alone", () => {
    const v = varps({ 170: 0 });
    assert.equal(applyIf1ButtonVarp(button(1), v), false);
    assert.equal(applyIf1ButtonVarp({ ...button(4), isIf3: true }, v), false);
    assert.equal(applyIf1ButtonVarp({ ...button(4), cs1Instructions: [[4, 170, 0]] }, v), false);
    assert.deepEqual(v.values, { 170: 0 });
});
