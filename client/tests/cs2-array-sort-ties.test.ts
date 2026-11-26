import assert from "node:assert/strict";
import { test } from "node:test";

import { Cs2ArrayObject } from "../rs/cs2/Cs2ArrayObject";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// array_sort (8000) carries a second array along with the keys. Where keys are equal, the order
// of that second array is whatever the OSRS client's own sort leaves, so ours runs the same
// procedure. The expected orders below were produced by running that procedure.

function ints(values: number[]): Cs2ArrayObject {
    const array = new Cs2ArrayObject("int", 0, values.length, values.length);
    values.forEach((value, i) => array.setAt(i, value));
    return array;
}
function strings(values: Array<string | null>): Cs2ArrayObject {
    const array = new Cs2ArrayObject("object", "", values.length, values.length);
    values.forEach((value, i) => array.setAt(i, value));
    return array;
}
const read = (array: Cs2ArrayObject) => Array.from({ length: array.length }, (_, i) => array.getRaw(i));
const indices = (length: number) => ints(Array.from({ length }, (_, i) => i));

function sortWithIndices(keys: Cs2ArrayObject): { keys: any[]; order: number[] } {
    const order = indices(keys.length);
    keys.sortAllWith(order);
    return { keys: read(keys), order: read(order) };
}

test("int keys: ties land in the client's order, not in their original order", () => {
    const MAX = 2147483647;
    assert.deepEqual(sortWithIndices(ints([3, 1, 3, 1, 3, 1, 3, 1])), { keys: [1, 1, 1, 1, 3, 3, 3, 3], order: [5, 7, 1, 3, 0, 2, 6, 4] });
    assert.deepEqual(sortWithIndices(ints([5, 5, 5, 5, 5, 5, 5])).order, [5, 6, 1, 3, 0, 2, 4]);
    assert.deepEqual(sortWithIndices(ints([2, 2, 1, 1, 2, 2, 1, 1, 0, 0])).order, [8, 9, 6, 2, 3, 7, 1, 5, 4, 0]);
    assert.deepEqual(sortWithIndices(ints([MAX, MAX, 1, MAX, 0, MAX])), { keys: [0, 1, MAX, MAX, MAX, MAX], order: [4, 2, 3, 0, 5, 1] });
    assert.deepEqual(sortWithIndices(ints([4, 3, 2, 1, 0, 4, 3, 2, 1, 0, 4, 3, 2, 1, 0])).order, [4, 14, 9, 3, 8, 13, 7, 12, 2, 6, 1, 11, 5, 10, 0]);
});

test("string keys order by code unit, with the client's order for ties", () => {
    assert.deepEqual(sortWithIndices(strings(["b", "a", "b", "a", "b", "a"])), { keys: ["a", "a", "a", "b", "b", "b"], order: [3, 5, 1, 2, 4, 0] });
    assert.deepEqual(sortWithIndices(strings(["x", "x", "x", "x", "x"])).order, [1, 3, 2, 4, 0]);
    // Capitals sort before every lower-case letter, and an accented letter after "z".
    assert.deepEqual(sortWithIndices(strings(["B", "a", "b", "A", "a", "B", "b", "A"])), { keys: ["A", "A", "B", "B", "a", "a", "b", "b"], order: [7, 3, 0, 5, 4, 1, 2, 6] });
    assert.deepEqual(sortWithIndices(strings(["é", "z", "e", "Z", "é", "e"])), { keys: ["Z", "e", "e", "z", "é", "é"], order: [3, 2, 5, 1, 0, 4] });
    assert.deepEqual(sortWithIndices(strings(["a", null, "a", null, "b"])), { keys: ["a", "a", "b", null, null], order: [2, 0, 4, 1, 3] });
});

test("a companion of strings moves with int keys; keys alone just sort", () => {
    const keys = ints([3, 1, 3, 1, 3, 1, 3, 1]);
    const names = strings(["a", "b", "c", "d", "e", "f", "g", "h"]);
    keys.sortAllWith(names);
    assert.deepEqual(read(names), ["f", "h", "b", "d", "a", "c", "g", "e"]);

    const alone = strings(["b", "B", "a", "é", "Z"]);
    alone.sortAllWith(null);
    assert.deepEqual(read(alone), ["B", "Z", "a", "b", "é"]);
    const numbers = ints([5, -1, 3, 3, 0]);
    numbers.sortAllWith(null);
    assert.deepEqual(read(numbers), [-1, 0, 3, 3, 5]);
    assert.throws(() => ints([2, 1]).sortAllWith(ints([0])), /RuntimeException/, "a companion shorter than the keys");
});

test("array_max / array_min: the first of equal values, strings by code unit", () => {
    assert.equal(ints([1, 7, 3, 7]).getArgMax(), 1);
    assert.equal(ints([4, 1, 3, 1]).getArgMin(), 1);
    assert.equal(ints([]).getArgMax(), -1);
    // localeCompare would pick "b" as the max and "a" as the min.
    assert.equal(strings(["a", "B", "b", "é", "Z"]).getArgMax(), 3);
    assert.equal(strings(["a", "B", "b", "Z"]).getArgMin(), 1);
    assert.equal(strings(["b", null, "a"]).getArgMax(), 0, "a null is never the max");
    assert.throws(() => strings([null, "a"]).getArgMax(), /RuntimeException/);

    const handlers = createHandlerMap();
    const out: any[] = [];
    const ctx: any = { stringStack: [strings(["apple", "Zebra", "zebra", "Apple"])], stringStackSize: 1, pushInt: (v: number) => out.push(v), pushString: (v: string) => out.push(v) };
    handlers.get(Opcodes.ARRAY_MAX_VALUE)!(ctx, 0, null as any);
    assert.deepEqual(out, ["zebra"]);
});

test("array_fill and array_generaterange take a start and a count", () => {
    const handlers = createHandlerMap();
    const run = (opcode: number, array: Cs2ArrayObject, intArgs: number[]) =>
        handlers.get(opcode)!({ intStack: [...intArgs], intStackSize: intArgs.length, stringStack: [array], stringStackSize: 1 } as any, 0, null as any);

    const filled = ints([0, 0, 0, 0, 0, 0]);
    run(Opcodes.ARRAY_FILL, filled, [9, 2, 3, 105]); // value 9, start 2, count 3, type int
    assert.deepEqual(read(filled), [0, 0, 9, 9, 9, 0]);
    run(Opcodes.ARRAY_FILL, filled, [7, 0, -1, 105]);
    assert.deepEqual(read(filled), [7, 7, 7, 7, 7, 7], "a count of -1 is the rest of the array");
    run(Opcodes.ARRAY_FILL, filled, [1, 4, 50, 105]);
    assert.deepEqual(read(filled), [7, 7, 7, 7, 1, 1], "a count past the end stops at the end");
    run(Opcodes.ARRAY_FILL, filled, [2, -3, 2, 105]);
    assert.deepEqual(read(filled), [2, 2, 7, 7, 1, 1], "a negative start is 0");
    assert.throws(() => run(Opcodes.ARRAY_FILL, filled, [2, 9, 1, 105]), /RuntimeException/, "a start past the end");

    const range = ints([-1, -1, -1, -1, -1, -1]);
    run(Opcodes.ARRAY_FILL_SEQUENCE, range, [10, 1, 3]); // first 10, start 1, count 3
    assert.deepEqual(read(range), [-1, 10, 11, 12, -1, -1]);
    run(Opcodes.ARRAY_FILL_SEQUENCE, range, [0, 0, -1]);
    assert.deepEqual(read(range), [0, 1, 2, 3, 4, 5]);
    run(Opcodes.ARRAY_FILL_SEQUENCE, range, [50, 9, 2]);
    assert.deepEqual(read(range), [0, 1, 2, 3, 4, 5], "a start past the end fills nothing");
});

test("array_randomise: the low seed is sign-extended into the 64-bit seed", () => {
    const handlers = createHandlerMap();
    const shuffle = (seedHigh: number, seedLow: number) => {
        const array = indices(10);
        handlers.get(Opcodes.ARRAY_RANDOMISE)!({ intStack: [seedHigh, seedLow], intStackSize: 2, stringStack: [array], stringStackSize: 1 } as any, 0, null as any);
        return read(array);
    };
    assert.deepEqual(shuffle(1, 2), [6, 0, 9, 5, 2, 3, 8, 1, 7, 4]);
    assert.deepEqual(shuffle(0, -1), [8, 4, 7, 1, 9, 2, 6, 0, 5, 3]);
    assert.deepEqual(shuffle(5, -123456), [6, 2, 8, 9, 0, 7, 1, 4, 3, 5]);
    assert.deepEqual(shuffle(-7, 99), [1, 8, 2, 4, 6, 0, 7, 9, 5, 3]);
});
