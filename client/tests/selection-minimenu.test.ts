import assert from "node:assert/strict";
import { ClientState } from "../game/ClientState";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";
import { MenuTargetType } from "../rs/MenuEntry";
import { CANCEL_SELECTION_HANDLER } from "../widgets/gl/widgetsGl/constants";

// While an item is selected, the op-less widget over the game view carries a target that only
// cancels the selection. The mouseover text must still be the world entry under it.
const handlers: HandlerMap = new Map();
registerClientOps(handlers);
const cancelTarget = { id: "widget:10551330", onClick: CANCEL_SELECTION_HANDLER };
let pickable: any[] = [cancelTarget];
const clicks = {
    pick: (_x: number, _y: number, accept?: (t: any) => boolean) =>
        pickable.find((t) => !accept || accept(t)),
    getHoverTarget: () => pickable[0],
};
const osrsClient = {
    renderer: { canvas: { __input: { getClicks: () => clicks }, __ui: { mouseX: 300, mouseY: 200 } } },
    menuActiveSimpleEntries: [
        { option: "Use", target: "<col=ff9040>Knife -> <col=ffff00>Goblin", targetType: MenuTargetType.NPC },
        { option: "Walk here" },
        { option: "Cancel" },
    ],
};
const minimenu = (): { strings: string[]; type: number } => {
    const strings: string[] = [];
    const ints: number[] = [];
    const ctx = {
        widgetManager: { osrsClient },
        pushString: (s: string) => strings.push(s),
        pushInt: (i: number) => ints.push(i),
    };
    handlers.get(Opcodes.MINIMENU_ENTRY)!(ctx as any, 0 as any);
    handlers.get(Opcodes.MINIMENU_TYPE)!(ctx as any, 0 as any);
    return { strings, type: ints[0] };
};

ClientState.isItemSelected = 1;
ClientState.isSpellSelected = true;
assert.deepEqual(minimenu(), {
    strings: ["Use", "<col=ff9040>Knife -> <col=ffff00>Goblin"],
    type: 2,
});

// A real widget target with menu text still wins over the world.
pickable = [
    { id: "widget:9764864", primaryOption: { option: "Use", target: "<col=ff9040>Knife -> <col=ff9040>Logs" }, menuOptionsCount: 2 },
    cancelTarget,
];
assert.deepEqual(minimenu(), { strings: ["Use", "<col=ff9040>Knife -> <col=ff9040>Logs"], type: 7 });

ClientState.clearSpellSelection();
ClientState.clearItemSelection();
console.log("selection minimenu ok");
