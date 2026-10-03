import assert from "node:assert/strict";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// A packed db field's low 4 bits pick one tuple element (1-based); 0 is the whole tuple.
// Script 9076 reads the sailing customisation's model angles this way, from table 188.
const INT = 0;
const angles = {
    id: 8391,
    getColumn: (column: number) =>
        column === 0
            ? {
                  types: [INT, INT, INT, INT, INT, INT, INT],
                  values: [0, -10, 0, 150, 1950, 0, 3000, 1, -10, 0, 130, 1950, 0, 5000],
              }
            : undefined,
};
const ctx: any = {
    intStack: new Int32Array(32),
    intStackSize: 0,
    stringStack: [],
    stringStackSize: 0,
    pushInt(value: number) { this.intStack[this.intStackSize++] = value; },
    popInt() { return this.intStack[--this.intStackSize]; },
    pushString(value: string) { this.stringStack[this.stringStackSize++] = value; },
    setDbRowQuery(rows: number[]) { this.dbRowQuery = rows; },
    setDbRowIndex(index: number) { this.dbRowIndex = index; },
    setDbTableId(id: number) { this.dbTableId = id; },
    dbRepository: { getRows: () => [angles], getTables: () => new Map() },
};
const handlers = createHandlerMap();
const run = (opcode: Opcodes) => handlers.get(opcode)!(ctx, 0, null);
const field = (column: number, element: number) => (188 << 12) | (column << 4) | element;

function getField(packed: number, tuple: number): number[] {
    ctx.intStackSize = 0;
    ctx.pushInt(angles.id);
    ctx.pushInt(packed);
    ctx.pushInt(tuple);
    run(Opcodes.DB_GETFIELD);
    return Array.from(ctx.intStack.slice(0, ctx.intStackSize));
}

assert.deepEqual(getField(field(0, 0), 1), [1, -10, 0, 130, 1950, 0, 5000], "element 0: the whole tuple");
assert.deepEqual(getField(field(0, 1), 1), [1], "element 1: the tuple's first value alone");
assert.deepEqual(getField(field(0, 7), 1), [5000], "element 7: the skiff's zoom");
assert.deepEqual(getField(field(0, 7), 0), [3000]);

// db_find with an element compares only that element of each tuple.
ctx.intStackSize = 0;
ctx.pushInt(field(0, 7));
ctx.pushInt(1950);
ctx.pushInt(0);
run(Opcodes.DB_FIND_WITH_COUNT);
assert.equal(ctx.popInt(), 0, "1950 is a yan, not a zoom");
ctx.pushInt(field(0, 5));
ctx.pushInt(1950);
ctx.pushInt(0);
run(Opcodes.DB_FIND_WITH_COUNT);
assert.equal(ctx.popInt(), 1);

console.log("cs2-db-tuple-element: ok");
