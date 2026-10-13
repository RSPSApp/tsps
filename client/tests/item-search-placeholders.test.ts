import assert from "node:assert/strict";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerConfigOps } from "../rs/cs2/handlers/ConfigOps";

// The item search (oc_find, used by the ::items spawner) leaves out bank placeholders: they share
// their item's name (Yami 30888 and its placeholder 30889) but are blank, and one dropped is an
// invisible ground item with no pet.
const items: Record<number, { name: string; placeholderTemplate: number }> = {
    30888: { name: "Yami", placeholderTemplate: -1 },
    30889: { name: "Yami", placeholderTemplate: 14401 },
    4151: { name: "Abyssal whip", placeholderTemplate: -1 },
};
const ctx: any = {
    intStack: new Int32Array(8),
    intStackSize: 0,
    stringStack: [] as string[],
    stringStackSize: 0,
    pushInt(value: number) { this.intStack[this.intStackSize++] = value; },
    popInt() { return this.intStack[--this.intStackSize]; },
    objTypeLoader: { load: (id: number) => items[id] },
};
const handlers = new Map<any, any>();
registerConfigOps(handlers);

ctx.stringStack[ctx.stringStackSize++] = "yami";
ctx.pushInt(0);
handlers.get(Opcodes.OC_FIND)(ctx, 0, null);
assert.equal(ctx.popInt(), 1);
assert.deepEqual(ctx.itemSearchResults, [30888]);

console.log("item search placeholder tests passed");
