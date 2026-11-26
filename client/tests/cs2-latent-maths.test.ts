import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { osrsCos, osrsSin } from "../rs/cs2/handlers/MathOps";

// Corner cases of maths, long, string and db instructions, as the OSRS client computes them.
const handlers = createHandlerMap();
const MIN = -(1n << 63n);
const MAX = (1n << 63n) - 1n;

function run(opcode: number, ints: number[] = [], strings: any[] = [], longs: bigint[] = [], extra: any = {}): any[] {
    const out: any[] = [];
    const ctx: any = {
        intStack: [...ints], intStackSize: ints.length, stringStack: [...strings], stringStackSize: strings.length, longStack: [...longs],
        popInt() { return this.intStack[--this.intStackSize]; }, popString() { return this.stringStack[--this.stringStackSize]; },
        popLong() { return this.longStack.pop(); },
        pushInt: (v: number) => out.push(v), pushString: (v: string) => out.push(v), pushLong: (v: bigint) => out.push(v),
        ...extra,
    };
    // sin / cos rewrite the top of the int stack in place.
    handlers.get(opcode)!(ctx, extra.intOp ?? 0, null as any);
    return out.length > 0 ? out : ctx.intStack.slice(0, ctx.intStackSize);
}

test("setbit / clearbit / testbit ignore a bit index outside 0-31", () => {
    assert.deepEqual(run(Opcodes.SETBIT, [0, 31]), [-2147483648]);
    assert.deepEqual(run(Opcodes.SETBIT, [5, 32]), [5]);
    assert.deepEqual(run(Opcodes.SETBIT, [5, -1]), [5]);
    assert.deepEqual(run(Opcodes.CLEARBIT, [7, 1]), [5]);
    assert.deepEqual(run(Opcodes.CLEARBIT, [7, 33]), [7]);
    assert.deepEqual(run(Opcodes.CLEARBIT, [7, -31]), [7]);
    assert.deepEqual(run(Opcodes.TESTBIT, [1, 0]), [1]);
    assert.deepEqual(run(Opcodes.TESTBIT, [1, 32]), [0]);
    assert.deepEqual(run(Opcodes.TESTBIT, [-1, -1]), [0]);
});

test("bit ranges work over all 32 bits and leave the value alone for a bound outside 0-31", () => {
    assert.deepEqual(run(Opcodes.GETBIT_RANGE, [-1, 0, 31]), [-1]);
    assert.deepEqual(run(Opcodes.GETBIT_RANGE, [0x12345678, 0, 31]), [0x12345678]);
    assert.deepEqual(run(Opcodes.GETBIT_RANGE, [-1, 28, 31]), [15]);
    assert.deepEqual(run(Opcodes.GETBIT_RANGE, [0xabcd, 4, 11]), [0xbc]);
    assert.deepEqual(run(Opcodes.GETBIT_RANGE, [0xabcd, 4, 32]), [0xabcd]);
    assert.deepEqual(run(Opcodes.SETBIT_RANGE, [0, 0, 31]), [-1]);
    assert.deepEqual(run(Opcodes.SETBIT_RANGE, [0, 4, 7]), [0xf0]);
    assert.deepEqual(run(Opcodes.SETBIT_RANGE, [3, -1, 7]), [3]);
    assert.deepEqual(run(Opcodes.CLEARBIT_RANGE, [-1, 0, 31]), [0]);
    assert.deepEqual(run(Opcodes.CLEARBIT_RANGE, [0xff, 4, 7]), [0x0f]);
    assert.deepEqual(run(Opcodes.CLEARBIT_RANGE, [0xff, 4, 40]), [0xff]);
    assert.deepEqual(run(Opcodes.SETBIT_RANGE, [8, 5, 4]), [8], "an empty range changes nothing");
    assert.throws(() => run(Opcodes.SETBIT_RANGE, [8, 6, 4]), /RuntimeException/, "a range that ends two bits before it starts");

    // setbit_range_toint(value, new, low, high)
    assert.deepEqual(run(Opcodes.SETBIT_RANGE_VALUE, [0xffff, 0xa, 4, 7]), [0xffaf]);
    assert.deepEqual(run(Opcodes.SETBIT_RANGE_VALUE, [0, 0x1ff, 4, 7]), [0xf0], "a value too big for the range is capped");
    assert.deepEqual(run(Opcodes.SETBIT_RANGE_VALUE, [0, 0x12345678, 0, 30]), [0x12345678]);
    assert.deepEqual(run(Opcodes.SETBIT_RANGE_VALUE, [5, -2, 0, 31]), [-2]);
    assert.deepEqual(run(Opcodes.SETBIT_RANGE_VALUE, [5, 3, 0, 31]), [-1], "over all 32 bits the cap is -1");
    assert.deepEqual(run(Opcodes.SETBIT_RANGE_VALUE, [5, 3, 0, 32]), [5]);
});

test("sin / cos read the client's table: a negative value rounds away from zero", () => {
    // [angle, sin, cos]
    const expected = [[0, 0, 16384], [1, 6, 16383], [100, 628, 16371], [4096, 16384, 0], [5000, 15409, -5567], [8192, 0, -16384],
        [8193, -7, -16384], [9000, -4996, -15604], [12288, -16384, 0], [12289, -16384, 6], [13000, -15777, 4418], [16383, -7, 16383],
        [-1, -7, 16383], [20000, 16107, 2998], [7777, 2596, -16177], [10001, -10476, -12597]];
    for (const [angle, sin, cos] of expected) {
        assert.deepEqual(run(Opcodes.SIN, [angle]), [sin], `sin ${angle}`);
        assert.deepEqual(run(Opcodes.COS, [angle]), [cos], `cos ${angle}`);
    }
    // Every entry of both tables, as a running hash.
    let sinHash = 0n;
    let cosHash = 0n;
    for (let angle = 0; angle < 16384; angle++) {
        sinHash = BigInt.asIntN(64, sinHash * 31n + BigInt(osrsSin(angle)));
        cosHash = BigInt.asIntN(64, cosHash * 31n + BigInt(osrsCos(angle)));
    }
    assert.equal(sinHash, -7199164513602183400n);
    assert.equal(cosHash, 7560760912813809432n);
});

test("addpercent cuts the percentage towards zero before adding it", () => {
    assert.deepEqual(run(Opcodes.ADDPERCENT, [10, 15]), [11]);
    assert.deepEqual(run(Opcodes.ADDPERCENT, [10, -15]), [9]);
    assert.deepEqual(run(Opcodes.ADDPERCENT, [-10, 15]), [-11]);
    assert.deepEqual(run(Opcodes.ADDPERCENT, [200, -50]), [100]);
    assert.deepEqual(run(Opcodes.ADDPERCENT, [7, -1]), [7]);
    assert.deepEqual(run(Opcodes.ADDPERCENT, [100000000, 50]), [100000000 + (((100000000 * 50) | 0) / 100 | 0)], "the product wraps as an int");
});

test("long maths errors on overflow instead of wrapping", () => {
    const long = (opcode: number, ...values: bigint[]) => run(opcode, [], [], values);
    assert.deepEqual(long(Opcodes.LONG_ADD, MAX - 1n, 1n), [MAX]);
    assert.deepEqual(long(Opcodes.LONG_ADD, MIN, MAX), [-1n]);
    assert.throws(() => long(Opcodes.LONG_ADD, MAX, 1n), /RuntimeException/);
    assert.throws(() => long(Opcodes.LONG_ADD, MIN, -1n), /RuntimeException/);
    assert.deepEqual(long(Opcodes.LONG_SUB, MIN + 1n, 1n), [MIN]);
    assert.deepEqual(long(Opcodes.LONG_SUB, -1n, MIN), [MAX]);
    assert.throws(() => long(Opcodes.LONG_SUB, MIN, 1n), /RuntimeException/);
    assert.throws(() => long(Opcodes.LONG_SUB, 0n, MIN), /RuntimeException/);
    assert.deepEqual(long(Opcodes.LONG_MULTIPLY, 1n << 31n, 1n << 31n), [1n << 62n]);
    assert.deepEqual(long(Opcodes.LONG_MULTIPLY, MAX, 0n), [0n]);
    assert.throws(() => long(Opcodes.LONG_MULTIPLY, 1n << 32n, 1n << 31n), /RuntimeException/);
    assert.throws(() => long(Opcodes.LONG_MULTIPLY, -1n, MIN), /RuntimeException/);
    assert.deepEqual(long(Opcodes.LONG_MULTIPLY, MIN, -1n), [MIN], "the one overflow the client's check misses");
    // long_scale(x1, x2, x3) = x3 * x1 / x2: the product may pass the long range, the result may not.
    assert.deepEqual(long(Opcodes.LONG_SCALE, MAX, 4n, 2n), [MAX / 2n]);
    assert.deepEqual(long(Opcodes.LONG_SCALE, -7n, 2n, 1n), [-3n]);
    assert.throws(() => long(Opcodes.LONG_SCALE, MAX, 2n, 4n), /RuntimeException/);
    assert.throws(() => long(Opcodes.LONG_SCALE, 1n, 0n, 1n), /RuntimeException/);
});

test("push_varc_long: an unset variable is -1, one set as an int reads as that int", () => {
    const varManager = { varcLongs: new Map([[3, 99n]]), varcInts: new Map([[4, -5]]) };
    const push = (id: number) => run(Opcodes.PUSH_VARC_LONG, [], [], [], { varManager, intOp: id });
    assert.deepEqual(push(3), [99n]);
    assert.deepEqual(push(4), [-5n]);
    assert.deepEqual(push(5), [-1n]);
});

test("substring errors outside the text; join_string and append write a null as \"null\"", () => {
    const substring = (text: any, start: number, end: number) => run(Opcodes.SUBSTRING, [start, end], [text]);
    assert.deepEqual(substring("hello", 1, 3), ["el"]);
    assert.deepEqual(substring("hello", 5, 5), [""]);
    assert.throws(() => substring("hello", -1, 3), /RuntimeException/);
    assert.throws(() => substring("hello", 2, 6), /RuntimeException/);
    assert.throws(() => substring("hello", 3, 2), /RuntimeException/);
    assert.throws(() => substring(null, 0, 0), /RuntimeException/);

    assert.deepEqual(run(Opcodes.APPEND, [], ["a", null]), ["anull"]);
    assert.deepEqual(run(Opcodes.APPEND, [], [null, "b"]), ["nullb"]);
    assert.deepEqual(run(Opcodes.APPEND, [], ["a", "b"]), ["ab"]);
    const join = (strings: any[]) => run(Opcodes.JOIN_STRING, [], strings, [], { intOp: strings.length });
    assert.deepEqual(join(["a", null, "c"]), ["anullc"]);
    assert.deepEqual(join([null]), ["null"]);
    assert.deepEqual(join(["a", "", "c"]), ["ac"]);
});

test("db_getfield: the null row, a tuple index past the count, an element past the tuple", () => {
    const INT = 0;
    const STAT = 25;
    const STRING = 36;
    // Table 7: column 0 is (int, stat) tuples with defaults, column 1 a string with none, column 2 (stat, string).
    const columns: Record<number, any> = {
        0: { types: [INT, STAT], defaultValues: [50, 3] },
        1: { types: [STRING] },
        2: { types: [STAT, STRING] },
    };
    const row = { id: 40, getColumn: (column: number) => (column === 0 ? { types: [INT, STAT], values: [1, 2, 10, 20] } : undefined) };
    const bare = { id: 41, getColumn: () => undefined };
    const dbRepository = { getRows: () => [row, bare], getTables: () => new Map([[7, { getColumn: (column: number) => columns[column] }]]) };
    const field = (column: number, element = 0) => (7 << 12) | (column << 4) | element;
    const get = (rowId: number, packed: number, tuple: number) => run(Opcodes.DB_GETFIELD, [rowId, packed, tuple], [], [], { dbRepository });

    assert.deepEqual(get(40, field(0), 1), [10, 20]);
    assert.deepEqual(get(40, field(0, 2), 0), [2]);
    assert.deepEqual(get(41, field(0), 0), [50, 3], "a row without the column reads the table's defaults");
    assert.deepEqual(get(41, field(1), 0), [""]);
    assert.deepEqual(get(41, field(2, 1), 0), [-1]);

    // The null row: each type's null value for the whole tuple, not the table's defaults.
    assert.deepEqual(get(-1, field(0), 0), [0, -1]);
    assert.deepEqual(get(-1, field(0, 1), 0), [0, -1], "even when the field names one element");
    assert.deepEqual(get(-1, field(2), 5), [-1, ""]);

    assert.throws(() => get(40, field(0), 2), /RuntimeException/, "the row has two tuples");
    assert.throws(() => get(40, field(0), -1), /RuntimeException/);
    assert.throws(() => get(41, field(0), 1), /RuntimeException/, "the defaults are one tuple");
    assert.throws(() => get(40, field(0, 3), 0), /RuntimeException/, "the tuple has two elements");
    assert.throws(() => get(41, field(1, 2), 0), /RuntimeException/, "also when the row has no values");
});
