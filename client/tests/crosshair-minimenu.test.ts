import assert from "node:assert/strict";
import { InputManager } from "../game/InputManager";
import { Opcodes } from "../rs/cs2/Opcodes";
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";
import { MenuTargetType } from "../rs/MenuEntry";
import { minMenuSnapshot } from "../rs/cs2/minimenu";

const handlers: HandlerMap = new Map();
registerClientOps(handlers);
const input = new InputManager();
// The UI still believes the widget under the pre-lock mouse is hovered: it has no menu text.
const staleUi = { id: "widget:12345", primaryOption: { option: "" }, menuOptionsCount: 0 };
const osrsClient = {
    inputManager: input,
    renderer: { canvas: { __input: { getClicks: () => ({ getHoverTarget: () => staleUi }) } } },
    hoveredWidgetsByUid: new Map([[12345, {}]]),
    menuActiveSimpleEntries: [
        { option: "Attack", target: "<col=ffff00>Goblin", targetType: MenuTargetType.NPC },
        { option: "Walk here" },
        { option: "Cancel" },
    ],
};
const minimenuEntry = (): string[] => {
    const strings: string[] = [];
    const ctx = { widgetManager: { osrsClient }, pushString: (s: string) => strings.push(s), pushInt: () => {} };
    handlers.get(Opcodes.MINIMENU_ENTRY)!(ctx as any, 0 as any);
    return strings;
};

assert.deepEqual(minimenuEntry(), ["", ""], "with a real mouse, UI hover wins as before");
input.setInteractionPointerOverride(320, 200);
assert.deepEqual(minimenuEntry(), ["Attack", "<col=ffff00>Goblin"],
    "the crosshair's mouseover text is the world option, whatever the UI last hovered");
input.setInteractionPointerOverride(320, 200, true);
assert.deepEqual(minimenuEntry(), ["", ""], "a pointer aimed at widgets (inventory focus) still uses UI hover");

const panelRoot = { uid: 700 << 16, parentUid: -1, suppressHoverText: true };
const panelButton = { uid: (700 << 16) | 2, parentUid: panelRoot.uid };
const panelTarget = { id: `widget:${panelButton.uid}`, widgetUid: panelButton.uid,
    primaryOption: { option: 'Find', target: 'Find' }, menuOptionsCount: 3 };
const panelClient = { renderer: { canvas: { __clicks: { getHoverTarget: () => panelTarget } } },
    widgetManager: { getWidgetByUid: (uid: number) => uid === panelRoot.uid ? panelRoot : panelButton } };
assert.deepEqual(minMenuSnapshot(panelClient), { option: '', target: '', numOps: 0, type: 0,
    hasComponentHover: true, widgetUid: panelButton.uid }, 'explicitly labelled panels suppress redundant native hover text');
assert.equal(panelTarget.primaryOption.option, 'Find', 'context menu metadata is retained');
panelRoot.suppressHoverText = false;
assert.equal(minMenuSnapshot(panelClient).option, 'Find', 'ordinary native hover text remains available');
console.log("crosshair minimenu ok");
