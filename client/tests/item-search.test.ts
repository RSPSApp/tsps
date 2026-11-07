import assert from "node:assert/strict";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerConfigOps } from "../rs/cs2/handlers/ConfigOps";
import { isNpcSearchResult, NPC_SEARCH_TITLE, setSpawnSearch } from "../rs/cs2/spawnSearch";

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

function search(query: string, tradableOnly: boolean, expectedCount?: number): number[] {
    ctx.stringStack[ctx.stringStackSize++] = query;
    ctx.pushInt(tradableOnly ? 1 : 0);
    handlers.get(Opcodes.OC_FIND)(ctx, 0, null);
    assert.equal(ctx.popInt(), expectedCount ?? ctx.itemSearchResults.length);
    return ctx.itemSearchResults;
}

assert.deepEqual(search("yami", false), [30888]);
assert.deepEqual(search("abyssal whip", true), [4151]);
assert.deepEqual(search("abyssal whip", false), [4151, 4178, 20405, 26482]);

// The Grand Exchange search runs oc_find on every keystroke. Scanning the loader each time
// re-decodes every item definition (its LRU holds 4,096 of the ~32,000 named items), about
// 100ms a keystroke, so the names are indexed once and later searches only filter the index.
let loads = 0;
ctx.objTypeLoader = { load: (id: number) => { loads++; return items[id]; } };
assert.deepEqual(search("whip", true), [4151]);
const firstScan = loads;
assert.ok(firstScan > 0, "the first search reads the definitions");
assert.deepEqual(search("whip", false), [4151, 4178, 20405, 26482]);
assert.deepEqual(search("yami", false), [30888]);
assert.equal(loads, firstScan, "later searches reuse the name index instead of reloading every item");

// Native oc_find allows 250 matches, then returns -1 so script 752 shows its refine prompt.
for (let id = 1000; id < 1250; id++) items[id] = item("Match boundary " + id, true);
items[1250] = item("Match overflow", true);
items[1251] = item("Match boundary noted", true, { noteTemplate: 799 });
items[1252] = item("Match boundary placeholder", true, { placeholderTemplate: 14401 });
items[1253] = item("Match boundary untradeable", false);
ctx.objTypeLoader = { load: (id: number) => items[id] };
assert.deepEqual(search("no matching item", true, 0), []);
assert.equal(search("boundary", true, 250).length, 250);
assert.deepEqual(search("match", true, -1), [], "overflow clears the previous results");
handlers.get(Opcodes.OC_FINDNEXT)(ctx, 0, null);
assert.equal(ctx.popInt(), -1, "overflow has no iterable results");
assert.deepEqual(search("yami", false, 1), [30888], "a new search recovers after overflow");

const boundary = search("boundary", true, 250);
handlers.get(Opcodes.OC_FINDNEXT)(ctx, 0, null);
const first = ctx.popInt();
assert.equal(first, boundary[0]);
handlers.get(Opcodes.OC_FINDRESET)(ctx, 0, null);
assert.equal(ctx.itemSearchCount, 250, "reset preserves the result count");
assert.equal(ctx.itemSearchResults, boundary, "reset preserves the result array");
handlers.get(Opcodes.OC_FINDNEXT)(ctx, 0, null);
assert.equal(ctx.popInt(), first, "reset rewinds to the first existing match");

// NPC and plugin searches also feed the same cache row-building script.
setSpawnSearch(NPC_SEARCH_TITLE);
ctx.npcTypeLoader = {
    getCount: () => 251,
    load: (id: number) => ({ name: id < 250 ? "Match boundary" : "Match overflow" }),
};
assert.equal(search("boundary", false, 250).length, 250);
handlers.get(Opcodes.OC_FINDNEXT)(ctx, 0, null);
assert.equal(ctx.popInt(), 0);
handlers.get(Opcodes.OC_FINDRESET)(ctx, 0, null);
assert.ok(isNpcSearchResult(0), "reset preserves NPC result labels and portraits");
handlers.get(Opcodes.OC_FINDNEXT)(ctx, 0, null);
assert.equal(ctx.popInt(), 0);
assert.deepEqual(search("match", false, -1), []);
assert.ok(!isNpcSearchResult(0), "overflow clears NPC result labels and portraits");

setSpawnSearch("Grand Exchange Item Search");
let suppliedCount = 4000;
ctx.beforeItemSearch = () => {
    ctx.itemSearchResults = Array.from({ length: suppliedCount }, (_, id) => id);
    ctx.itemSearchCount = suppliedCount;
    ctx.itemSearchIndex = 0;
    return true;
};
assert.deepEqual(search("anything", true, -1), [], "plugin overrides obey the same overflow protocol");
suppliedCount = 250;
assert.equal(search("anything", true, 250).length, 250, "250 supplied matches are retained");
delete ctx.beforeItemSearch;

console.log("item search tests passed");
