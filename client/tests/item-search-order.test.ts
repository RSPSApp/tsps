import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { registerConfigOps } from "../rs/cs2/handlers/ConfigOps";

// OSRS sorts an item search's matches by item name before the Grand Exchange script lists them.
const names: Record<number, string> = { 10: "Rune sword", 20: "Adamant sword", 30: "Bronze sword", 40: "adamant sword (old)", 50: "Rune sword" };
const ctx: any = {
    intStack: new Int32Array(8), intStackSize: 0, stringStack: [] as string[], stringStackSize: 0,
    pushInt(value: number) { this.intStack[this.intStackSize++] = value; },
    popInt() { return this.intStack[--this.intStackSize]; },
    objTypeLoader: { getCount: () => 60, load: (id: number) => names[id] ? { name: names[id], placeholderTemplate: -1, noteTemplate: -1, isTradable: true } : undefined },
};
const handlers = new Map<any, any>();
registerConfigOps(handlers);

test("matches come back in name order, not id order", () => {
    ctx.stringStack[ctx.stringStackSize++] = "sword";
    ctx.pushInt(0);
    handlers.get(Opcodes.OC_FIND)(ctx, 0, null);
    assert.equal(ctx.popInt(), 5);
    assert.deepEqual(ctx.itemSearchResults, [20, 30, 10, 50, 40], "capitals sort before lower case; equal names keep id order");
});
