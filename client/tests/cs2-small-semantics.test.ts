import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// Small instruction semantics taken from the OSRS client.
const handlers = createHandlerMap();
function run(opcode: number, ints: number[] = [], strings: string[] = []): any[] {
    const out: any[] = [];
    const ctx: any = { intStack: [...ints], intStackSize: ints.length, stringStack: [...strings], stringStackSize: strings.length,
        popInt() { return this.intStack[--this.intStackSize]; }, popString() { return this.stringStack[--this.stringStackSize]; },
        pushInt: (v: number) => out.push(v), pushString: (v: string) => out.push(v) };
    handlers.get(opcode)!(ctx, 0, null as any);
    return out;
}

test("pow stops at the end of the int range, and a base of 0 gives 0", () => {
    assert.deepEqual(run(Opcodes.POW, [2, 31]), [2147483647]);
    assert.deepEqual(run(Opcodes.POW, [10, 10]), [2147483647]);
    assert.deepEqual(run(Opcodes.POW, [-2, 31]), [-2147483648]);
    assert.deepEqual(run(Opcodes.POW, [0, 0]), [0]);
    assert.deepEqual(run(Opcodes.POW, [3, 4]), [81]);
    assert.deepEqual(run(Opcodes.POW, [2, -1]), [0]);
});

test("parseint accepts only a whole int", () => {
    assert.deepEqual(run(Opcodes.STRING_TO_INT, [], ["42"]), [42]);
    assert.deepEqual(run(Opcodes.STRING_TO_INT, [], ["-7"]), [-7]);
    assert.deepEqual(run(Opcodes.STRING_TO_INT, [], ["12abc"]), [-1]);
    assert.deepEqual(run(Opcodes.STRING_TO_INT, [], [" 12"]), [-1]);
    assert.deepEqual(run(Opcodes.STRING_TO_INT, [], ["99999999999"]), [-1]);
    assert.deepEqual(run(Opcodes.STRING_TO_INT, [], [""]), [-1]);
});

test("removetags drops tags, stray brackets and @ spans", () => {
    const strip = (text: string) => run(Opcodes.REMOVETAGS, [], [text])[0];
    assert.equal(strip("<col=ff0000>Red</col> text"), "Red text");
    assert.equal(strip("a<>b"), "ab");
    assert.equal(strip("a > b"), "a  b");
    assert.equal(strip("a < b"), "a ");
    assert.equal(strip("@red@hi"), "hi");
    assert.equal(strip("mail@x.com @red@hi"), "mailredhi", "@ signs pair up from the left");
    assert.equal(strip("<str_name=Bob>Hi <str_name>"), "Hi Bob", "a template's value survives");
});
