import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { widgetEntriesToSimple } from "../ui/menu/MenuBridge";
import { MenuState } from "../ui/menu/MenuState";
import { chooseDefaultMenuEntry } from "../ui/menu/MenuEngine";
import { deriveMenuEntriesForWidget } from "../widgets/menu/utils";

ClientState.clearItemSelection();
ClientState.isSpellSelected = false;

let stateAtDispatch: { selected: number; itemId: number } | undefined;
let dispatched: any;
const menuState = new MenuState();
const [use] = widgetEntriesToSimple(
    [{ option: "Use", target: "Test item", widgetAction: { slot: 7, itemId: 4151 } }],
    {
        ui: {
            onWidgetAction: (event: any) => {
                stateAtDispatch = {
                    selected: ClientState.isItemSelected,
                    itemId: ClientState.selectedItemId,
                };
                dispatched = event;
            },
        },
        chosenWidget: { uid: 149 << 16, parentUid: 149 << 16, childIndex: 7, itemId: 4151 },
        scheduleRender: () => undefined,
        menuState,
    },
);

if (typeof use.menuStateIndex === "number") {
    menuState.invoke(use.menuStateIndex, 0, 0, { source: "menu" });
} else {
    use.onClick?.(0, 0, { source: "menu" });
}

assert.deepEqual(stateAtDispatch, { selected: 0, itemId: -1 });
assert.equal(dispatched?.option, "Use");
assert.equal(dispatched?.slot, 7);
assert.equal(dispatched?.itemId, 4151);
assert.equal(use.menuStateIndex, undefined, "widget actions must not run through generic menuAction");

// Cached inventory ops land in widget action slots via enum 4303
// (inv op1..5 -> slots 2,3,4,6,7, i.e. action indices 1,2,3,5,6).
// Pot of flour's only ops are Empty (op4 -> index 5) and Drop, so "Use" is the
// default action. A weapon keeps its op2 Wield (index 2) as primary.
const allOpsVisible = () => -1;
const noWidgetLookup = () => undefined;
const entriesFor = (itemId: number, actions: (string | null)[]) =>
    deriveMenuEntriesForWidget(
        { itemId, actions, targetVerb: "Use" },
        false,
        allOpsVisible,
        noWidgetLookup,
    );
const flour = entriesFor(1933, [null, null, null, null, null, "Empty", "Drop"]);
assert.deepEqual(
    flour.map((entry) => entry.option),
    ["Use", "Empty", "Drop", "Cancel"],
);
assert.equal(chooseDefaultMenuEntry(flour, {})?.option, "Use");
const staff = entriesFor(1381, [null, null, "Wield", null, null, null, "Drop"]);
assert.deepEqual(
    staff.map((entry) => entry.option),
    ["Wield", "Use", "Drop", "Cancel"],
);
assert.equal(chooseDefaultMenuEntry(staff, {})?.option, "Wield");
const shark = entriesFor(385, [null, "Eat", null, null, null, null, "Drop"]);
assert.deepEqual(
    shark.map((entry) => entry.option),
    ["Eat", "Use", "Drop", "Cancel"],
);

// With an item or spell selected, an inventory item offers only the selection's entry.
const selectFor = (actionName: string, name: string, targetMask: number) => {
    ClientState.isSpellSelected = true;
    ClientState.selectedSpellActionName = actionName;
    ClientState.selectedSpellName = name;
    ClientState.selectedSpellTargetMask = targetMask;
};
const logs = { itemId: 1511, name: "Logs", actions: [null, null, null, null, null, null, "Drop"], targetVerb: "Use" };
selectFor("Use", "<col=ff9040>Knife", 0x3f);
assert.deepEqual(deriveMenuEntriesForWidget(logs, false, allOpsVisible, noWidgetLookup), [
    { option: "Use", target: "<col=ff9040>Knife -> <col=ff9040>Logs", opIndex: 0 },
    { option: "Cancel" },
]);
selectFor("Cast", "<col=00ff00>High Level Alchemy</col>", 0x20);
assert.equal(
    deriveMenuEntriesForWidget(logs, false, allOpsVisible, noWidgetLookup)[0]?.target,
    "<col=00ff00>High Level Alchemy</col> -> <col=ff9040>Logs",
);
// A spell that cannot land on items leaves the item's own menu alone.
selectFor("Cast", "<col=00ff00>Wind Strike</col>", 0x06);
assert.deepEqual(
    deriveMenuEntriesForWidget(logs, false, allOpsVisible, noWidgetLookup).map((entry) => entry.option),
    ["Use", "Drop", "Cancel"],
);
ClientState.clearSpellSelection();

console.log("widget menu Use dispatch test passed");
