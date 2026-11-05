import assert from "node:assert/strict";
import { deriveRawMenuEntriesForWidget } from "../widgets/menu/utils";

// High and Low Level Alchemy carry ops 9-10 (Animation, Warnings) since the October 2026 cache.
// The client lists a component's target verb between op5 and op6, so "Cast" stays the top
// entry (the left-click) above them, as on live.
{
    const { createCacheVm } = require("../scripts/cache/cs2-sweep");
    const { vm: cacheVm } = createCacheVm();
    const wm = cacheVm.context.widgetManager;
    wm.rootInterface = 161;
    wm.onLoadListener = (_id: number, widget: any) => cacheVm.runScriptEvent({ args: widget.onLoad, widget });
    wm.getGroup(218);
    const spellbook = wm.getWidgetByUid(218 << 16);
    cacheVm.context.varManager.setVarbit(4070, 0);
    cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });
    for (const [name, child] of [["Low Level Alchemy", 24], ["High Level Alchemy", 47]] as const) {
        const spell = wm.getWidgetByUid((218 << 16) | child);
        const entries = deriveRawMenuEntriesForWidget(spell, false, (w: any) => wm.getWidgetFlags(w))
            .filter((entry) => entry.option !== "Cancel");
        assert.deepEqual(entries.map((entry) => [entry.option, entry.opIndex]),
            [["Cast", 0], ["Animation", 9], ["Warnings", 10]], `${name} menu`);
    }
    // A target spell without ops still offers only its verb.
    const windStrike = wm.getWidgetByUid((218 << 16) | 30);
    assert.deepEqual(deriveRawMenuEntriesForWidget(windStrike, false, (w: any) => wm.getWidgetFlags(w))
        .filter((entry) => entry.option !== "Cancel").map((entry) => entry.option), ["Cast"]);
}
