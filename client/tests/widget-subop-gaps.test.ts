import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";

// OSRS skips an empty sub-op in the menu but keeps the numbering: the row after a gap still
// sends its own sub-op index.
test("sub-ops keep their positions across a gap", () => {
    const widget = { name: "Ring", actions: ["Rub"], submenuActions: [["Edgeville", "", "Karamja"]] };
    const [rub] = deriveMenuEntriesForWidget(widget, false, () => ~1, () => undefined) as any[];
    assert.deepEqual(rub.subOptions, ["Edgeville", "", "Karamja"]);
});
