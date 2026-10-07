import assert from "node:assert/strict";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerMarketOps } from "../rs/cs2/handlers/MarketOps";

const values = new Int32Array(8000);
values[7906] = -1;
const ctx: any = {
    intStack: new Int32Array(8),
    intStackSize: 0,
    pushInt(value: number) { this.intStack[this.intStackSize++] = value; },
    popInt() { return this.intStack[--this.intStackSize]; },
    longs: [] as bigint[],
    pushLong(value: bigint) { this.longs.push(value); },
    varManager: { getVarp: (id: number) => values[id] },
};
const handlers = new Map<any, any>();
registerMarketOps(handlers);
const run = (opcode: Opcodes, slot = 0) => {
    ctx.pushInt(slot);
    handlers.get(opcode)(ctx, 0, null);
    return ctx.popInt();
};
// Rev 241: offer price and gold are longs.
const runLong = (opcode: Opcodes, slot = 0) => {
    ctx.pushInt(slot);
    handlers.get(opcode)(ctx, 0, null);
    return ctx.longs.pop();
};

assert.equal(run(Opcodes.STOCKMARKET_ISOFFEREMPTY), 1);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERITEM), -1);

values[7906] = 4151;
values[7900] = 1200000;
values[7901] = 2;
values[7902] = 2;
values[7903] = 2400000;
values[7904] = 1;
values[7905] = 5;
assert.equal(run(Opcodes.STOCKMARKET_ISOFFEREMPTY), 0);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERITEM), 4151);
assert.equal(runLong(Opcodes.STOCKMARKET_GETOFFERPRICE), 1200000n);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERCOUNT), 2);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERCOMPLETEDCOUNT), 2);
assert.equal(runLong(Opcodes.STOCKMARKET_GETOFFERCOMPLETEDGOLD), 2400000n);
assert.equal(run(Opcodes.STOCKMARKET_GETOFFERTYPE), 1);
assert.equal(run(Opcodes.STOCKMARKET_ISOFFERFINISHED), 1);

console.log("market opcode tests passed");

// Native search result script 754 resumes an object dialog with the chosen ID.
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
registerClientOps(handlers);
let selected: unknown;
ctx.cs2Vm = { onInputDialogComplete: (type: string, value: number) => { selected = [type, value]; } };
ctx.pushInt(4151);
handlers.get(Opcodes.RESUME_OBJDIALOG)(ctx, 0, null);
assert.deepEqual(selected, ["obj", 4151]);
assert.equal(ctx.intStackSize, 0);

// ::items / ::npcs reuse the same chatbox search: opened with a spawn title, OC_FIND reads
// npc names, OC_NAME labels those rows with them, no item icon is drawn for an npc id, and
// each row carries the spawn amounts instead of a plain "Select".
import { registerConfigOps } from "../rs/cs2/handlers/ConfigOps";
import {
    ITEM_SEARCH_TITLE,
    NPC_SEARCH_TITLE,
    SPAWN_OPS,
    applyNpcRowIcon,
    applySpawnSearchOps,
    isNpcSearchResult,
    setSpawnSearch,
    spawnSearchPick,
} from "../rs/cs2/spawnSearch";

registerConfigOps(handlers);
const npcs = ["Goblin", "Goblin Guard", "Hill Giant"];
const items = ["Goblin mail", "Bronze sword"];
ctx.stringStack = [];
ctx.stringStackSize = 0;
ctx.pushString = (value: string) => { ctx.stringStack[ctx.stringStackSize++] = value; };
ctx.popString = () => ctx.stringStack[--ctx.stringStackSize];
ctx.npcTypeLoader = { getCount: () => npcs.length, load: (id: number) => ({ name: npcs[id] }) };
ctx.objTypeLoader = { load: (id: number) => (items[id] ? { name: items[id] } : null) };

const find = (query: string) => {
    ctx.pushString(query);
    ctx.pushInt(0);
    handlers.get(Opcodes.OC_FIND)(ctx, 0, null);
    return ctx.popInt();
};
const name = (id: number) => {
    ctx.pushInt(id);
    handlers.get(Opcodes.OC_NAME)(ctx, 0, null);
    return ctx.popString();
};

setSpawnSearch("Grand Exchange Item Search");
assert.equal(find("goblin"), 1, "the Grand Exchange search only sees items");
assert.equal(name(0), "Goblin mail");

setSpawnSearch(NPC_SEARCH_TITLE);
assert.equal(find("goblin"), 2, "an npc search sees every npc whose name matches");
assert.deepEqual(ctx.itemSearchResults, [0, 1]);
assert.equal(name(0), "Goblin", "result rows are labelled with the npc name");
assert.ok(isNpcSearchResult(1), "rows of the open npc search draw no item icon");
assert.ok(!isNpcSearchResult(2), "ids outside the results stay item lookups");

setSpawnSearch(ITEM_SEARCH_TITLE);
assert.equal(find("goblin"), 1, "an item spawn search still searches items");
assert.equal(name(0), "Goblin mail", "item rows keep their item names");

// Rows are the widgets the search's select script (754) is bound to.
const row: any = { onOp: [754, 4151, 84], actions: ["Select"] };
const chatLine: any = { onOp: [123, 1], actions: ["Continue"] };
applySpawnSearchOps(row);
applySpawnSearchOps(chatLine);
assert.deepEqual(row.actions, SPAWN_OPS, "a result row offers the spawn amounts");
assert.deepEqual(chatLine.actions, ["Continue"], "other chatbox widgets are left alone");
assert.equal(spawnSearchPick(row, 2), "4151 2", "the pick carries the id and the op");
assert.equal(spawnSearchPick(row, 5), null, "ops outside the spawn amounts are not ours");
assert.equal(spawnSearchPick(chatLine, 1), null, "clicks outside the results are not ours");

// npc rows show the npc itself; the renderer picks chathead or body model from the flags.
setSpawnSearch(NPC_SEARCH_TITLE);
find("goblin");
const npcIcon: any = { type: 5, itemId: 7 };
assert.ok(applyNpcRowIcon(npcIcon, 1), "an npc result row becomes a portrait");
assert.deepEqual(
    { type: npcIcon.type, modelType: npcIcon.modelType, npcTypeId: npcIcon.npcTypeId, itemId: npcIcon.itemId },
    { type: 6, modelType: 2, npcTypeId: 1, itemId: -1 },
    "the row is handed to the renderer as an npc model",
);
assert.ok(npcIcon.isNpcChathead && npcIcon.npcPortraitFit, "flagged for the chathead-then-body path");
const offResult: any = { type: 5, itemId: 9 };
assert.equal(applyNpcRowIcon(offResult, 9), false, "ids outside the results are left as items");
assert.deepEqual(offResult, { type: 5, itemId: 9 }, "a non-result widget is untouched");

setSpawnSearch(ITEM_SEARCH_TITLE);
const itemIcon: any = { type: 5, itemId: 4151 };
assert.equal(applyNpcRowIcon(itemIcon, 4151), false, "item rows keep their item icons");
assert.deepEqual(itemIcon, { type: 5, itemId: 4151 }, "an item row is untouched");

setSpawnSearch(null);
const closedIcon: any = { type: 5, itemId: 1 };
assert.equal(applyNpcRowIcon(closedIcon, 1), false, "no portrait work with no search open");
assert.equal(name(0), "Goblin mail", "closing the search restores item names");
assert.equal(spawnSearchPick(row, 1), null, "a closed search claims no clicks");
const geRow: any = { onOp: [754, 4151, 84], actions: ["Select"] };
applySpawnSearchOps(geRow);
assert.deepEqual(geRow.actions, ["Select"], "the Grand Exchange search keeps Select");

console.log("spawn search opcode tests passed");
