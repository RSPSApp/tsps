import assert from "node:assert/strict";
import { test } from "node:test";

import { createCacheVm, sweepScripts } from "../scripts/cache/cs2-sweep";
import { NPC_SEARCH_TITLE, setSpawnSearch } from "../rs/cs2/spawnSearch";

/**
 * Every client script in the cache runs once (scripts/cache/cs2-sweep.ts). An instruction whose
 * handler pops or pushes other than its signature (rs/cs2/CommandSignatures.ts) leaves the
 * stack wrong for the rest of the script, far from the cause; a JavaScript error in a handler is
 * a VM bug whatever the script did. Script errors themselves are not asserted: the scripts run
 * with default arguments here. Run the script directly for the full report.
 */
const KNOWN_SHAPES: Record<number, string> = {
    33: "push_int_local reads a running script's locals; the sweep checks it in scripts",
    34: "pop_int_local, likewise",
    5003: "chat history: the cache scripts read 8 values (timestamps), more than the signature lists",
    5004: "chat history, likewise",
    6618: "worldmap_getsourcecoord: no 241 script uses it; its second output is unknown",
};

test("every script's instructions keep the stacks as their signatures say", () => {
    const report = sweepScripts();
    assert.ok(report.scripts > 5000, `${report.scripts} scripts in ${report.cache}`);
    assert.deepEqual(report.mismatches.map((m) => `${m.opcode} ${m.name}: expected ${m.expected}, got ${m.actual} (${m.example})`), []);
    assert.deepEqual(
        report.shapeMismatches
            .filter((m) => !(m.opcode in KNOWN_SHAPES))
            .map((m) => `${m.opcode} ${m.name}: expected ${m.expected}, got ${m.actual}`),
        [],
    );
    assert.deepEqual([...report.crashes.keys()], [], "JavaScript errors inside handlers");
});


test("item search bounds every producer before building cache rows", () => {
    const { vm, scripts } = createCacheVm();
    const widgets = vm.context.widgetManager;
    widgets.getGroup(162);
    const parent = widgets.getWidgetByUid(10616885);
    parent.width = 512;
    parent.height = 100;
    const errors: string[] = [];
    vm.logError = (error: Error) => errors.push(error.message);
    const supply = () => {
        vm.itemSearchResults = Array.from({ length: 4000 }, (_, id) => id);
        vm.itemSearchCount = 4000;
        vm.itemSearchIndex = 0;
        return true;
    };
    try {
        for (const mode of ["item", "npc", "override"]) {
            setSpawnSearch(mode === "npc" ? NPC_SEARCH_TITLE : "Grand Exchange Item Search");
            if (mode === "override") vm.itemSearchListeners.add(supply);
            vm.context.varManager.setVarcString(359, "a");
            vm.context.varManager.setVarcInt(66, 1);
            vm.execute(scripts.load(751), [0, -1, 0], [], 500000);
            assert.deepEqual(errors, [], mode);
            assert.equal(vm.itemSearchCount, -1, mode);
            assert.ok(vm.opcount < 500000, mode);
            assert.ok(widgets.getDynamicChildrenByParent(parent).some((widget: any) =>
                widget.text === "Too many matches found. Please refine your search."), mode);
        }
    } finally {
        vm.itemSearchListeners.delete(supply);
        setSpawnSearch("");
    }
});
