import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveMenuEntriesForWidget, setMenuObjTypeLookup } from "../widgets/menu/utils";

// OSRS skips an empty sub-op in the menu but keeps the numbering: the row after a gap still
// sends its own sub-op index.
test("sub-ops keep their positions across a gap", () => {
    const widget = { name: "Ring", actions: ["Rub"], submenuActions: [["Edgeville", "", "Karamja"]] };
    const [rub] = deriveMenuEntriesForWidget(widget, false, () => ~1, () => undefined) as any[];
    assert.deepEqual(rub.subOptions, ["Edgeville", "", "Karamja"]);
});

// An item's sub-ops live in the cache, not in a CS2 script: the slayer ring's Rub rows are its
// actions and its Teleport rows are the destinations (#6870). A script's own submenuActions
// still wins where it sets them.
test("an item widget lists its own cache sub-ops when no script sets them", () => {
    const RING = 11866;
    setMenuObjTypeLookup((itemId: number) =>
        itemId === RING
            ? { subops: [null, ["Contact Master", "Partner", "Open Log"], ["Stronghold", "Slayer Tower"], null, null] }
            : undefined,
    );
    try {
        const item = { name: "Slayer ring (8)", itemId: RING, actions: ["Wear", "Rub", "Teleport", "Check", "Drop"] };
        const entries = deriveMenuEntriesForWidget(item, false, () => ~1, () => undefined) as any[];
        const option = (name: string) => entries.find((entry) => entry.option === name);

        assert.deepEqual(option("Rub")?.subOptions, ["Contact Master", "Partner", "Open Log"]);
        assert.deepEqual(option("Teleport")?.subOptions, ["Stronghold", "Slayer Tower"]);
        assert.equal(option("Wear")?.subOptions, undefined, "no rows: no submenu");
        assert.equal(option("Check")?.subOptions, undefined);

        // A script's rows are the widget's when it has them.
        const scripted = { ...item, submenuActions: [null, ["Midnight", "Dawn"]] };
        const scriptedEntries = deriveMenuEntriesForWidget(scripted, false, () => ~1, () => undefined) as any[];
        assert.deepEqual(scriptedEntries.find((entry) => entry.option === "Rub")?.subOptions, ["Midnight", "Dawn"]);
    } finally {
        setMenuObjTypeLookup(undefined);
    }
});
