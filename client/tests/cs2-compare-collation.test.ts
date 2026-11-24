import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { compareStringsOsrs } from "../rs/cs2/StringCollation";
import { createHandlerMap } from "../rs/cs2/handlers";

// OSRS `compare`: alphabetical whatever the case or accents, then accents, then length, then
// the exact characters (lower case first). Scripts sort names and branch on its sign.

const sign = (a: string, b: string) => Math.sign(compareStringsOsrs(a, b));

test("letters order alphabetically whatever their case", () => {
    assert.equal(sign("apple", "Banana"), -1);
    assert.equal(sign("a", "B"), -1);
    assert.equal(sign("Zulrah", "abyssal"), 1);
    assert.equal(sign("same", "same"), 0);
});

test("a prefix sorts first, and case only breaks a tie", () => {
    assert.equal(sign("Rune", "Rune axe"), -1);
    assert.equal(sign("rune", "Rune"), -1, "lower case before its capital");
    assert.equal(sign("Rune", "rune"), 1);
});

test("accents are ignored until everything else is equal", () => {
    assert.equal(sign("éclair", "edge"), -1, "é sorts as e: ec < ed");
    assert.equal(sign("cafe", "café"), -1);
    assert.equal(sign("æon", "aeon"), 1, "the ligature counts as ae, then loses the accent tie-break");
});

test("the compare instruction pushes the sign", () => {
    const out: number[] = [];
    const ctx: any = { stringStack: ["apple", "Banana"], stringStackSize: 2, pushInt: (v: number) => out.push(v) };
    createHandlerMap().get(Opcodes.COMPARE)!(ctx, 0, null as any);
    assert.deepEqual(out, [-1]);
});
