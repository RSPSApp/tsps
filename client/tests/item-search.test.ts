import assert from "node:assert/strict";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerConfigOps } from "../rs/cs2/handlers/ConfigOps";

// The item search (oc_find) leaves out bank placeholders: they share their item's name (Yami
// 30888 and its placeholder 30889) but are blank, and one dropped is an invisible ground item
// with no pet. Noted copies are left out too. The Grand Exchange search (script 750) asks for
// tradable items only, so the untradeable items that share a real item's name are left out
// there, while the ::items spawner (tradable flag off) still finds them.
type Obj = { name: string; placeholderTemplate: number; noteTemplate: number; isTradable: boolean };
const item = (name: string, isTradable: boolean, extra: Partial<Obj> = {}): Obj =>
    ({ name, placeholderTemplate: -1, noteTemplate: -1, isTradable, ...extra });
const items: Record<number, Obj> = {
    30888: item("Yami", false),
    30889: item("Yami", false, { placeholderTemplate: 14401 }),
    4151: item("Abyssal whip", true),
    4152: item("Abyssal whip", true, { noteTemplate: 799 }),
    4178: item("Abyssal whip", false),
    20405: item("Abyssal whip", false),
    26482: item("Abyssal whip (or)", false),
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

function search(query: string, tradableOnly: boolean): number[] {
    ctx.stringStack[ctx.stringStackSize++] = query;
    ctx.pushInt(tradableOnly ? 1 : 0);
    handlers.get(Opcodes.OC_FIND)(ctx, 0, null);
    assert.equal(ctx.popInt(), ctx.itemSearchResults.length);
    return ctx.itemSearchResults;
}

assert.deepEqual(search("yami", false), [30888]);
assert.deepEqual(search("abyssal whip", true), [4151]);
assert.deepEqual(search("abyssal whip", false), [4151, 4178, 20405, 26482]);

console.log("item search tests passed");
