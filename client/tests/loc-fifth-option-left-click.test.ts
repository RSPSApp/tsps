import assert from "node:assert/strict";
import { test } from "node:test";

import { MenuTargetType } from "../rs/MenuEntry";
import { type SimpleMenuEntry, chooseDefaultMenuEntry } from "../ui/menu/MenuEngine";

// OSRS gives a loc's fifth option opcode 1001 and sorts opcodes of 1000 and above under
// "Walk here": the option is in the right-click menu, and a left click walks.

function locMenu(actionIndexes: number[]): SimpleMenuEntry[] {
    const entries: SimpleMenuEntry[] = [{ option: "Walk here" }];
    for (const actionIndex of actionIndexes) {
        entries.push({ option: `Op${actionIndex + 1}`, targetType: MenuTargetType.LOC, targetId: 1, actionIndex });
    }
    entries.push({ option: "Examine", targetType: MenuTargetType.LOC, targetId: 1 });
    return entries;
}

test("a loc whose only option is its fifth is walked to on a left click", () => {
    assert.equal(chooseDefaultMenuEntry(locMenu([4]), {})?.option, "Walk here");
});

test("a loc's earlier option is still the left click, with or without a fifth", () => {
    assert.equal(chooseDefaultMenuEntry(locMenu([4, 1]), {})?.option, "Op2");
    assert.equal(chooseDefaultMenuEntry(locMenu([0]), {})?.option, "Op1");
});
