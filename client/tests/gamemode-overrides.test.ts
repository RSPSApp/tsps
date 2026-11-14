import assert from "node:assert/strict";
import { test } from "node:test";

import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { getDbRowOverride, getEnumOverride, getStructOverride, loadFromPayload } from "../common/gamemode/GamemodeContentStore";

/** Server-sent structs and enums (a league's relic catalog) stand in for the cache's in the cs2 config ops. */
function context(extra: Record<string, unknown> = {}) {
    const ctx: any = {
        intStack: new Array(64).fill(0),
        stringStack: new Array(64).fill(null),
        intStackSize: 0,
        stringStackSize: 0,
        pushInt(v: number) { this.intStack[this.intStackSize++] = v | 0; },
        pushString(v: any) { this.stringStack[this.stringStackSize++] = v; },
        popInt() { return this.intStack[--this.intStackSize]; },
        popString() { return this.stringStack[--this.stringStackSize]; },
        ...extra,
    };
    return ctx;
}

const handlers = createHandlerMap();
const run = (opcode: number, ctx: any) => handlers.get(opcode)!(ctx, 0, "");

const cacheEnums: Record<number, any> = {
    5702: { keys: [0, 1], intValues: [1136, 1137], defaultInt: -1, outputCount: 2 },
};
const params: Record<number, any> = {
    877: { isString: () => false, defaultInt: 0 },
    879: { isString: () => true, defaultString: "" },
    880: { isString: () => true, defaultString: "" },
};
const cacheStructs: Record<number, any> = {
    1136: { params: new Map([[877, 600]]) },
};

test("enum overrides replace a cache enum or define a new id, for ints and strings", () => {
    loadFromPayload({
        gamemodeId: "test",
        datasets: [{
            key: "enumOverrides",
            rows: [
                { enumId: 5702, valueType: "J", defaultValue: -1, entries: [[0, 200001], [1, 200002], [2, 200003]] },
                { enumId: 200100, valueType: "J", defaultValue: -1, entries: [[1, 300001], [2, 300002], [3, 300003]] },
                { enumId: 200200, valueType: "s", defaultValue: "none", entries: [[1, "Superior Sorcerer"]] },
            ],
        }],
    });
    assert.equal(getEnumOverride(5702)?.outputCount, 3);
    const ctx = context({ enumTypeLoader: { load: (id: number) => cacheEnums[id] } });
    // enum(inputtype, outputtype, enum, key)
    ctx.pushInt(105); ctx.pushInt(105); ctx.pushInt(5702); ctx.pushInt(2);
    run(Opcodes.ENUM, ctx);
    assert.equal(ctx.popInt(), 200003, "a third tier the cache enum never had");
    ctx.pushInt(105); ctx.pushInt(105); ctx.pushInt(200100); ctx.pushInt(3);
    run(Opcodes.ENUM, ctx);
    assert.equal(ctx.popInt(), 300003, "a virtual enum keyed 1..3, as the relic enums are");
    ctx.pushInt(105); ctx.pushInt(105); ctx.pushInt(200100); ctx.pushInt(9);
    run(Opcodes.ENUM, ctx);
    assert.equal(ctx.popInt(), -1, "its default for a missing key");
    ctx.pushInt(200100);
    run(Opcodes.ENUM_GETOUTPUTCOUNT, ctx);
    assert.equal(ctx.popInt(), 3);
    ctx.pushInt(105); ctx.pushInt(200100);
    run(Opcodes.ENUM_GETINPUTS, ctx);
    const inputs = ctx.popString();
    assert.deepEqual([0, 1, 2].map((i) => inputs.getInt(i)), [1, 2, 3], "enum_getinputs sees the override's keys");
    ctx.pushInt(200200); ctx.pushInt(1);
    run(Opcodes.ENUM_STRING, ctx);
    assert.equal(ctx.popString(), "Superior Sorcerer");
    ctx.pushInt(200200); ctx.pushInt(2);
    run(Opcodes.ENUM_STRING, ctx);
    assert.equal(ctx.popString(), "none");
});

test("struct overrides replace a cache struct's params or define a new struct", () => {
    loadFromPayload({
        gamemodeId: "test",
        datasets: [{
            key: "structOverrides",
            rows: [
                { structId: 1136, params: { 877: 500 } },
                { structId: 300001, params: { 879: "Superior Sorcerer", 880: "Magic weapons attack at speed 2." } },
            ],
        }],
    });
    assert.equal(getStructOverride(1136, 877), 500);
    assert.equal(getStructOverride(1136, 879), undefined, "other params fall through to the cache");
    const ctx = context({
        paramTypeLoader: { load: (id: number) => params[id] },
        structTypeLoader: { load: (id: number) => cacheStructs[id] },
    });
    ctx.pushInt(1136); ctx.pushInt(877);
    run(Opcodes.STRUCT_PARAM, ctx);
    assert.equal(ctx.popInt(), 500, "Trailblazer Reloaded's tier 2 cost over the cache's 600");
    ctx.pushInt(300001); ctx.pushInt(879);
    run(Opcodes.STRUCT_PARAM, ctx);
    assert.equal(ctx.popString(), "Superior Sorcerer");
    ctx.pushInt(300001); ctx.pushInt(880);
    run(Opcodes.STRUCT_PARAM, ctx);
    assert.equal(ctx.popString(), "Magic weapons attack at speed 2.");
});

test("db row overrides stand in for a table's rows in the db ops, typed by the table's columns", () => {
    loadFromPayload({
        gamemodeId: "test",
        datasets: [{
            key: "dbRowOverrides",
            rows: [
                { rowId: 340000, tableId: 118, columns: { 0: ["Defeat a Goblin"], 1: ["Defeat a Goblin."], 32: [1], 34: [1], 35: [2], 36: [0] } },
                { rowId: 340001, tableId: 118, columns: { 0: ["Reach Total Level 100"], 32: [1] } },
            ],
        }],
    });
    assert.equal(getDbRowOverride(340000)?.tableId, 118);
    const tableDef = { getColumn: (id: number) => ({ 0: { types: [36] }, 1: { types: [36] }, 32: { types: [0] }, 34: { types: [0] }, 35: { types: [0] }, 36: { types: [0] } } as Record<number, any>)[id] };
    const ctx = context({ dbRepository: { getTables: () => new Map([[118, tableDef]]), getRows: () => [], getRowById: () => undefined } });
    const field = (column: number) => (118 << 12) | (column << 4);
    ctx.pushInt(340000); ctx.pushInt(field(0)); ctx.pushInt(0);
    run(Opcodes.DB_GETFIELD, ctx);
    assert.equal(ctx.popString(), "Defeat a Goblin", "action_name");
    ctx.pushInt(340000); ctx.pushInt(field(32)); ctx.pushInt(0);
    run(Opcodes.DB_GETFIELD, ctx);
    assert.equal(ctx.popInt(), 1, "action_difficulty");
    ctx.pushInt(340001); ctx.pushInt(field(35)); ctx.pushInt(0);
    run(Opcodes.DB_GETFIELD, ctx);
    assert.equal(ctx.popInt(), 0, "a column the row lacks reads the type's default, not a cache row");
    ctx.pushInt(340000); ctx.pushInt(field(0));
    run(Opcodes.DB_GETFIELDCOUNT, ctx);
    assert.equal(ctx.popInt(), 1);
    ctx.pushInt(340000);
    run(Opcodes.DB_GETROWTABLE, ctx);
    assert.equal(ctx.popInt(), 118);
    // Without a table definition (no cache), the values type themselves.
    const bare = context({});
    bare.pushInt(340000); bare.pushInt(field(1)); bare.pushInt(0);
    run(Opcodes.DB_GETFIELD, bare);
    assert.equal(bare.popString(), "Defeat a Goblin.");
});

test("each override dataset sent replaces the whole set: the server sends one complete payload", () => {
    // The server's single sender (LeagueMode's content payload) carries every unit's rows at once.
    loadFromPayload({
        gamemodeId: "test",
        datasets: [
            { key: "structOverrides", rows: [{ structId: 300001, params: { 879: "Berserker" } }] },
            { key: "enumOverrides", rows: [{ enumId: 5950, valueType: "J", defaultValue: -1, entries: [[0, 340000], [1, 340001]] }] },
            { key: "dbRowOverrides", rows: [{ rowId: 340001, tableId: 118, columns: { 0: ["Reach Total Level 200"] } }] },
        ],
    });
    assert.equal(getEnumOverride(5950)?.outputCount, 2);
    assert.equal(getEnumOverride(200100), undefined, "an enum the new payload lacks is gone");
    assert.equal(getStructOverride(300001, 879), "Berserker");
    assert.equal(getStructOverride(300001, 880), undefined, "whole row, not merged params");
    assert.equal(getStructOverride(1136, 877), undefined, "a struct the new payload lacks is gone");
    assert.deepEqual(getDbRowOverride(340001)?.columns[0], ["Reach Total Level 200"]);
    assert.equal(getDbRowOverride(340000), undefined, "a row the new payload lacks is gone");
});

test("a payload without the datasets keeps them; an empty dataset clears them", () => {
    loadFromPayload({ gamemodeId: "test", datasets: [{ key: "worldMapPlayers", rows: [] }] });
    assert.equal(getStructOverride(300001, 879), "Berserker");
    assert.equal(getEnumOverride(5950)?.outputCount, 2);
    assert.equal(getDbRowOverride(340001)?.tableId, 118);
    loadFromPayload({ gamemodeId: "test", datasets: [{ key: "structOverrides", rows: [] }, { key: "enumOverrides", rows: [] }, { key: "dbRowOverrides", rows: [] }] });
    assert.equal(getStructOverride(300001, 879), undefined);
    assert.equal(getEnumOverride(5950), undefined);
    assert.equal(getDbRowOverride(340001), undefined);
});

test("enum overrides are kept per sender: one sender's payload never clears another's", () => {
    // A league's enums and Grouping's enum 850 (no suggested world for any activity) side by side.
    loadFromPayload({ gamemodeId: "server", datasets: [{ key: "enumOverrides", rows: [{ enumId: 5950, valueType: "J", defaultValue: -1, entries: [[0, 340000]] }] }] });
    loadFromPayload({ gamemodeId: "grouping", datasets: [{ key: "enumOverrides", rows: [{ enumId: 850, valueType: "I", defaultValue: -1, entries: [[1, -1], [5, -1]] }] }] });
    assert.equal(getEnumOverride(5950)?.intValues?.[0], 340000);
    assert.deepEqual(getEnumOverride(850)?.intValues, [-1, -1]);
    loadFromPayload({ gamemodeId: "server", datasets: [{ key: "enumOverrides", rows: [] }] });
    assert.equal(getEnumOverride(5950), undefined, "a sender's new payload replaces its own set");
    assert.deepEqual(getEnumOverride(850)?.intValues, [-1, -1], "and only its own");
    loadFromPayload({ gamemodeId: "grouping", datasets: [{ key: "enumOverrides", rows: [] }] });
    assert.equal(getEnumOverride(850), undefined);
});
