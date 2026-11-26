import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";

// OSRS: a db row that lacks a column reads the table's default values (they count for
// db_getfieldcount), and with no defaults reads null (-1) for every type but int and boolean.

const { createCacheVm } = require("../scripts/cache/cs2-sweep");
const { vm } = createCacheVm();
const repo = vm.context.dbRepository;
const handlers = createHandlerMap();

function run(opcode: number, ints: number[]): number[] {
    const out: number[] = [];
    const ctx: any = { intStack: [...ints], intStackSize: ints.length, dbRepository: repo,
        pushInt: (v: number) => out.push(v), pushString: (v: string) => out.push(v as any) };
    handlers.get(opcode)!(ctx, 0, null as any);
    return out;
}
const column = (table: number, col: number, tuple = 0) => (table << 12) | (col << 4) | tuple;
const rowWithout = (table: number, col: number) => repo.getRows(table).find((row: any) => !row.getColumn(col))!.id;
const rowWith = (table: number, col: number) => repo.getRows(table).find((row: any) => row.getColumn(col))!.id;

test("db_getfieldcount counts the table's defaults for a row without the column", () => {
    assert.deepEqual(run(Opcodes.DB_GETFIELDCOUNT, [rowWithout(189, 5), column(189, 5)]), [1]);
    assert.deepEqual(run(Opcodes.DB_GETFIELDCOUNT, [rowWithout(111, 6), column(111, 6)]), [1]);
    assert.ok(run(Opcodes.DB_GETFIELDCOUNT, [rowWith(189, 5), column(189, 5)])[0] >= 1);
});

test("db_getfield: an absent stat or coord is null, an absent int is 0", () => {
    assert.deepEqual(run(Opcodes.DB_GETFIELD, [rowWithout(0, 23), column(0, 23), 0]), [-1, 0]);
    assert.deepEqual(run(Opcodes.DB_GETFIELD, [rowWithout(82, 13), column(82, 13), 0]), [-1]);
});
