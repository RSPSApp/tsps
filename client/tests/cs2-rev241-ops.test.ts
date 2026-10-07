import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { spacedLong } from "../rs/cs2/handlers/LongOps";
import { loadItemPrices } from "../network/ServerConnection";
import { state } from "../network/serverConnection/state";

/** Every instruction rev 241's scripts use that the VM didn't handle before (zwyz/osrs-cache names). */
const REV_241 = [51, 52, 64, 65, 217, 222, 2215, 3114, 3228, 3229, 4037, 4038, 4039, 4040, 4041, 4042, 4043, 4044, 4055, 4060, 4061, 4062, 4125, 4126, 4127, 4219, 4223, 4224, 6531, 8014, 8015, 8021];

test("every instruction new in rev 241 has a handler", () => {
    const handlers = createHandlerMap();
    assert.deepEqual(REV_241.filter((opcode) => !handlers.has(opcode)), []);
});

/** A minimal stack context for the pure stack handlers. */
function stacks() {
    const ints: number[] = [];
    const longs: bigint[] = [];
    const strings: any[] = [];
    const ctx: any = {
        pushInt: (v: number) => ints.push(v | 0),
        popInt: () => ints.pop()!,
        pushLong: (v: bigint) => longs.push(BigInt.asIntN(64, v)),
        popLong: () => longs.pop()!,
        pushString: (v: any) => strings.push(v),
        popString: () => strings.pop(),
        get intStack() { return ints; },
        get stringStack() { return strings; },
        get intStackSize() { return ints.length; },
        set intStackSize(n: number) { ints.length = n; },
        get stringStackSize() { return strings.length; },
        set stringStackSize(n: number) { strings.length = n; },
    };
    return { ctx, ints, longs, strings };
}

test("long maths, packing and formatting behave as their names say", () => {
    const handlers = createHandlerMap();
    const run = (opcode: number, s: ReturnType<typeof stacks>) => handlers.get(opcode)!(s.ctx, 0);
    const s = stacks();
    s.longs.push(3_000_000_000n, 2n);
    run(Opcodes.LONG_MULTIPLY, s);
    assert.deepEqual(s.longs, [6_000_000_000n]);
    s.longs.push(4n, 3n);
    run(Opcodes.LONG_SCALE, s); // 3 * 6e9 / 4
    assert.deepEqual(s.longs, [4_500_000_000n]);
    s.ints.push(1, -1);
    run(Opcodes.LONG_PACK, s);
    run(Opcodes.LONG_UNPACK, s);
    assert.deepEqual(s.ints, [1, -1], "pack then unpack round-trips (high, low)");
    s.ints.length = 0;
    s.strings.push(",");
    run(Opcodes.TOSTRING_SPACER_LONG, s);
    assert.equal(s.strings.pop(), "4,500,000,000");
    assert.equal(spacedLong(-1234567n, " "), "-1 234 567");
    s.strings.push("2147483648");
    run(Opcodes.SAFEPARSEINT, s);
    assert.deepEqual(s.ints, [0, 0], "out of int range: not parsed");
});

test("stockmarket_value: loading until the world's guide prices arrive, then the price", async () => {
    // The browser-world content channel stands in for the server's /api/item-prices.
    (state as any).webRtcConfig = {};
    (state as any).socket = { fetchContent: async (path: string) => (path === "/api/item-prices" ? { 4151: 806000 } : {}) };
    const handlers = createHandlerMap();
    const items: Record<number, any> = {
        4151: { price: 120001, note: -1, noteTemplate: -1 },
        4152: { price: 1, note: 4151, noteTemplate: 799 },
        1351: { price: 16, note: -1, noteTemplate: -1 },
    };
    const value = (itemId: number) => {
        const s = stacks();
        s.ctx.objTypeLoader = { load: (id: number) => items[id] };
        s.ints.push(itemId);
        handlers.get(Opcodes.STOCKMARKET_VALUE)!(s.ctx, 0);
        return [s.ints[0], s.longs[0]];
    };
    const loaded = loadItemPrices();
    assert.deepEqual(value(4151), [1, 0n], "status 1 while loading: the GE scripts retry");
    await loaded;
    assert.deepEqual(value(4151), [2, 806000n], "the quoted price");
    assert.deepEqual(value(4152), [2, 806000n], "a noted item uses its unnoted price");
    assert.deepEqual(value(1351), [2, 16n], "unquoted items show their store value, as the GE charges");
});
