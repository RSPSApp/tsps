import assert from "node:assert/strict";
import { test } from "node:test";

import { getNpcMenuActions } from "../game/menu/WorldMenuBuilder";
import { EntityOps } from "../rs/config/EntityOps";

// OSRS: an option's name can depend on a varp or varbit. The first condition whose range holds
// the value replaces the base name; an empty replacement removes the option from the menu.

const vars = (varps: Record<number, number>, varbits: Record<number, number>) => ({
    getVarp: (id: number) => varps[id] ?? 0,
    getVarbit: (id: number) => varbits[id] ?? 0,
});

test("the first matching condition renames the option, else the base name stands", () => {
    const ops = new EntityOps();
    ops.addConditionalOp(2, { varpId: 65535, varbitId: 20252, min: 1, max: 1, name: "Tree Gnome Village" });
    ops.addConditionalOp(2, { varpId: 65535, varbitId: 20252, min: 2, max: 2, name: "Gnome Stronghold" });
    assert.equal(ops.opName(2, "Last-destination", vars({}, { 20252: 2 })), "Gnome Stronghold");
    assert.equal(ops.opName(2, "Last-destination", vars({}, { 20252: 0 })), "Last-destination");
    assert.equal(ops.opName(1, "Travel", vars({}, { 20252: 2 })), "Travel");
    assert.equal(ops.opName(2, null, vars({}, { 20252: 2 })), null, "a condition does not add an option");
});

test("a varp condition reads the varp, and an empty name hides the option", () => {
    const ops = new EntityOps();
    ops.addConditionalOp(2, { varpId: 387, varbitId: 65535, min: 0, max: 15, name: "" });
    const npc: any = { id: 5046, actions: ["Talk-to", null, "Board", null, null], entityOps: ops };
    assert.deepEqual(getNpcMenuActions(npc, vars({ 387: 10 }, {})).filter(Boolean), ["Talk-to"]);
    assert.deepEqual(getNpcMenuActions(npc, vars({ 387: 20 }, {})).filter(Boolean), ["Talk-to", "Board"]);
});

test("the cache's Spirit tree carries its conditional destinations", () => {
    const { createCacheVm } = require("../scripts/cache/cs2-sweep");
    const loc = createCacheVm().vm.context.locTypeLoader.load(26260);
    assert.equal(loc.entityOps.opName(2, loc.actions[2], vars({}, { 20252: 1 })), "Tree Gnome Village");
});
