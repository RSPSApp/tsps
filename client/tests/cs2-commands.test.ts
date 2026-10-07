import assert from "node:assert/strict";
import { test } from "node:test";

import { Cs2ArrayObject } from "../rs/cs2/Cs2ArrayObject";
import { javaRandom } from "../rs/cs2/JavaRandom";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

/** Commands the script sweep found misnumbered or misbehaving, checked by what they return. */
function context(extra: Record<string, unknown> = {}) {
    // Fixed arrays plus sizes, as the VM keeps them: handlers index with --ctx.intStackSize.
    const ctx: any = {
        intStack: new Array(64).fill(0),
        stringStack: new Array(64).fill(null),
        intStackSize: 0,
        stringStackSize: 0,
        longs: [] as bigint[],
        pushInt(v: number) { this.intStack[this.intStackSize++] = v | 0; },
        popInt() { return this.intStack[--this.intStackSize]; },
        pushString(v: any) { this.stringStack[this.stringStackSize++] = v; },
        popString() { return this.stringStack[--this.stringStackSize]; },
        pushLong(v: bigint) { this.longs.push(v); },
        popLong() { return this.longs.pop(); },
        ...extra,
    };
    return {
        ctx,
        ints: { push: (...v: number[]) => v.forEach((x) => ctx.pushInt(x)), get: () => ctx.intStack.slice(0, ctx.intStackSize) },
        strings: { push: (v: any) => ctx.pushString(v), pop: () => ctx.popString(), get: () => ctx.stringStack.slice(0, ctx.stringStackSize) },
        longs: ctx.longs as bigint[],
    };
}

const handlers = createHandlerMap();
const run = (opcode: number, ctx: any) => handlers.get(opcode)!(ctx, 0, "");

test("enum: the requested output type picks the stack, even for a missing enum", () => {
    const strings = { 7: { outputType: "s", keys: [1], stringValues: ["one"], defaultString: "none" } };
    const s = context({ enumTypeLoader: { load: (id: number) => (strings as any)[id] } });
    // enum(inputtype 'i', outputtype 's', enum, key), read top first: key, enum, output, input
    s.ints.push(105, 115, 7, 1);
    run(Opcodes.ENUM, s.ctx);
    assert.deepEqual([s.ints.get(), s.strings.get()], [[], ["one"]]);
    s.ints.push(105, 115, 999, 1);
    run(Opcodes.ENUM, s.ctx);
    assert.deepEqual([s.ints.get(), s.strings.pop()], [[], "null"], "missing enum: still a string");
    s.ints.push(105, 105, 999, 1);
    run(Opcodes.ENUM, s.ctx);
    assert.deepEqual(s.ints.get(), [-1], "an int when an int is asked for");
});

test("enum_getinputs returns the enum's keys", () => {
    const s = context({ enumTypeLoader: { load: () => ({ keys: [3, 5, 9], intValues: [30, 50, 90] }) } });
    s.ints.push(105, 1);
    run(Opcodes.ENUM_GETINPUTS, s.ctx);
    const array = s.strings.pop() as Cs2ArrayObject;
    assert.deepEqual([0, 1, 2].map((i) => array.getInt(i)), [3, 5, 9]);
});

test("array_randomise: Collections.shuffle with a seeded java.util.Random", () => {
    const next = javaRandom(42n);
    assert.deepEqual([next(10), next(10), next(10)], [0, 3, 8], "new Random(42).nextInt(10)");
    const shuffled = (seed1: number, seed2: number) => {
        const array = new Cs2ArrayObject("int", 0, 6, 6);
        for (let i = 0; i < 6; i++) array.setAt(i, i);
        const s = context();
        s.strings.push(array);
        s.ints.push(seed1, seed2);
        run(Opcodes.ARRAY_RANDOMISE, s.ctx);
        return [0, 1, 2, 3, 4, 5].map((i) => array.getInt(i));
    };
    assert.deepEqual(shuffled(1, 2), shuffled(1, 2), "same seeds, same order");
    assert.deepEqual([...shuffled(1, 2)].sort(), [0, 1, 2, 3, 4, 5]);
});

test("GE offer price and gold are longs from rev 241", () => {
    const s = context({ varManager: { getVarp: (id: number) => (id === 7900 ? 806000 : id === 7903 ? 1612000 : 0) } });
    s.ints.push(0);
    run(Opcodes.STOCKMARKET_GETOFFERPRICE, s.ctx);
    s.ints.push(0);
    run(Opcodes.STOCKMARKET_GETOFFERCOMPLETEDGOLD, s.ctx);
    assert.deepEqual([s.ints.get(), s.longs], [[], [806000n, 1612000n]]);
});

test("world list: no worlds, in the six-value world shape", () => {
    const s = context();
    run(Opcodes.WORLDLIST_START, s.ctx);
    assert.deepEqual([s.ints.get(), s.strings.get()], [[-1, 0, 0, 0], ["", ""]]);
});

test("oc_find pops its boolean and returns the match count", () => {
    const s = context({ objTypeLoader: { load: (id: number) => (id === 4151 ? { name: "Abyssal whip" } : null) } });
    s.strings.push("whip");
    s.ints.push(1);
    run(Opcodes.OC_FIND, s.ctx);
    assert.deepEqual(s.ints.get(), [1]);
});

test("varcs: an unset int reads -1, an array varc starts as an empty array of its type", async () => {
    const { VarManager } = await import("../rs/config/vartype/VarManager");
    const { VarcIntType } = await import("../rs/config/vartype/VarcIntType");
    const types = [0, 1].map((id) => Object.assign(Object.create(VarcIntType.prototype), { persist: false, arrayType: id === 1 ? 33 : -1 }));
    const vars = new VarManager({ load: () => undefined } as any, { getCount: () => 2, load: (id: number) => types[id] } as any);
    // Bank tags (script 9555) treat a tag whose varc is -1 as free.
    assert.equal(vars.getVarcInt(0), -1);
    assert.equal(vars.getVarcString(0), "");
    const array = vars.getVarcString(1) as Cs2ArrayObject;
    assert.ok(array instanceof Cs2ArrayObject && array.length === 0 && array.valueType === "int");
});
