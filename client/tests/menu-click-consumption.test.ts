import assert from "node:assert/strict";
import { MenuTargetType } from "../rs/MenuEntry";
import { worldEntriesToSimple } from "../ui/menu/MenuBridge";
import { chooseDefaultMenuEntry } from "../ui/menu/MenuEngine";
import { MenuOpcode, MenuState } from "../ui/menu/MenuState";
import { ClickMode } from "../game/InputManager";
import { shouldSkipWidgetClickInput } from "../game/widgets/input/widgetClickGuard";
import { drawChooseOptionMenu } from "../widgets/gl/choose-option";
import { UIInputBridge } from "../widgets/gl/ui-input";
import { InputManager } from "../game/InputManager";
import { WidgetInteractionController } from "../game/widgets/WidgetInteractionController";
import { processWidgetClickInput } from "../game/widgets/input/widgetClickInput";
import { processWidgetReleaseInput } from "../game/widgets/input/widgetReleaseInput";
import { createPrimaryWidgetActionResolver } from "../game/widgets/input/widgetPrimaryAction";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";
import { WidgetManager } from "../widgets/WidgetManager";
import { GIANT_BONES } from "../runelite/api/gameval/ItemID";

// Inspect on the ToA obelisk must send object option 1, not an examine packet.
const obeliskMenu = new MenuState();
const obeliskEntries = worldEntriesToSimple([
    { option: "Examine", targetType: MenuTargetType.LOC, targetId: 46068,
      targetName: "Grouping Obelisk", targetLevel: -1, mapX: 30, mapY: 31 },
    { option: "Inspect", targetType: MenuTargetType.LOC, targetId: 46068,
      targetName: "Grouping Obelisk", targetLevel: -1, mapX: 30, mapY: 31, actionIndex: 0 },
], { menuState: obeliskMenu });
const inspectObelisk = obeliskEntries.find((entry) => entry.option === "Inspect")!;
const examineObelisk = obeliskEntries.find((entry) => entry.option === "Examine")!;
assert.equal(obeliskMenu.opcodes[inspectObelisk.menuStateIndex!], MenuOpcode.GameObjectFirstOption);
assert.equal(obeliskMenu.opcodes[examineObelisk.menuStateIndex!], MenuOpcode.ExamineObject);
assert.equal(chooseDefaultMenuEntry(obeliskEntries, {}), inspectObelisk);

const groundItemMenu = new MenuState();
const groundItemEntries = worldEntriesToSimple([
    { option: "Bury", targetType: MenuTargetType.OBJ, targetId: GIANT_BONES,
      targetName: "Giant bones", targetLevel: -1, mapX: 30, mapY: 31, actionIndex: 2 },
], { menuState: groundItemMenu });
const buryGiantBones = groundItemEntries[0];
assert.equal(groundItemMenu.opcodes[buryGiantBones.menuStateIndex!], MenuOpcode.GroundItemThirdOption);

let clickThroughs = 0;
const inputBridge = new UIInputBridge();
const clicks = inputBridge.getClicks();
clicks.register({
    id: "inventory-slot",
    rect: { x: 0, y: 0, w: 32, h: 32 },
    onClick: () => clickThroughs++,
});

const input = {
    mouseX: 16,
    mouseY: 16,
    saveClickX: 16,
    saveClickY: 16,
    clickMode2: ClickMode.LEFT,
    clickMode3: ClickMode.LEFT,
    middleClickX: -1,
    middleClickY: -1,
    middleClickSequence: 0,
} as any;
inputBridge.processInput(input);
inputBridge.consumeClick();
input.clickMode2 = ClickMode.NONE;
input.clickMode3 = ClickMode.NONE;
inputBridge.processInput(input);

assert.equal(clickThroughs, 0, "a consumed menu click must not hit the inventory underneath");

let menuJustClosed = true;
const deps = {
    getRenderer: () => undefined,
    getMenuOpen: () => false,
    getMenuJustClosed: () => menuJustClosed,
    setMenuJustClosed: (value: boolean) => (menuJustClosed = value),
} as any;
assert.equal(
    shouldSkipWidgetClickInput(deps, {} as never),
    true,
    "legacy widget input must skip the menu-closing click",
);
assert.equal(menuJustClosed, false, "the one-frame guard must be consumed");

(globalThis as any).document = {
    createElement: () => ({
        getContext: () => ({ font: "", measureText: () => ({ width: 40 }) }),
    }),
};
let menuInvocations = 0;
let consumedMenuClicks = 0;
let renders = 0;
const menuUi: any = {};
const menuInput = {
    clickMode1: ClickMode.LEFT,
    clickMode2: ClickMode.LEFT,
    clickMode3: ClickMode.LEFT,
    mouseX: 100,
    mouseY: 120,
    saveClickX: 100,
    saveClickY: 120,
};
const client: any = {
    menuOpen: false,
    menuJustClosed: false,
    inputManager: menuInput,
    clickedWidget: {},
    clickedWidgetParent: {},
    deferredWidgetAction: {},
    menuState: { reset: () => undefined },
};
const canvas: any = {
    __ui: menuUi,
    __osrsClient: client,
    __clicks: {
        cancelActiveClick: () => undefined,
        unregister: () => undefined,
    },
    __inputBridge: { consumeClick: () => consumedMenuClicks++ },
    clientWidth: 800,
    offsetWidth: 800,
    clientHeight: 600,
    offsetHeight: 600,
};
menuUi.menu = {
    open: true,
    x: 100,
    y: 100,
    entries: [
        {
            option: "Use",
            onClick: () => {
                menuInvocations++;
                menuUi.menu = undefined;
            },
        },
    ],
};
drawChooseOptionMenu(
    { canvas, width: 800, height: 600 } as any,
    {
        fontLoader: () => ({ measure: () => 40 }) as any,
        requestRender: () => renders++,
    },
);

assert.equal(menuInvocations, 1);
assert.equal(consumedMenuClicks, 1);
assert.equal(client.menuJustClosed, true);
assert.equal(client.clickedWidget, null);
assert.equal(client.deferredWidgetAction, null);
assert.equal(menuInput.clickMode2, ClickMode.NONE);
assert.equal(renders, 1);

// Keyboard selection uses the shared menu invocation and click-consumption
// path, even at a scaled viewport edge and while navigating a scrolling list.
let keyboardPicked = -1;
const keyboardEntries = Array.from({ length: 60 }, (_, index) => ({
    option: `Option ${index}`,
    menuStateIndex: index,
}));
canvas.__uiRenderScale = 2;
canvas.__uiInputScaleX = 2;
canvas.__uiInputScaleY = 2;
const drawKeyboardMenu = () => drawChooseOptionMenu(
    { canvas, width: 800, height: 600, drawRect() {} } as any,
    { fontLoader: () => undefined, requestRender: () => renders++ },
);
client.menuKeyboardIndex = 0;
client.menuKeyboardSelect = false;
menuInput.mouseX = -100;
menuInput.mouseY = -100;
menuUi.menu = {
    open: true, source: "map", follow: false, x: 395, y: 295,
    entries: keyboardEntries,
    menuState: { invoke: (index: number) => { keyboardPicked = index; } },
};
drawKeyboardMenu();
assert.equal(menuUi.menu.open, true, "keyboard selection keeps the menu open despite the physical mouse position");
assert.ok(menuInput.mouseY >= 0 && menuInput.mouseY < 300, "first selection uses scaled, clamped menu coordinates");
client.menuKeyboardIndex = 59;
drawKeyboardMenu();
assert.ok(menuUi.__menuRt.menuScroll > 0, "arrow selection reveals a row below the viewport");
assert.ok(menuInput.mouseY >= 0 && menuInput.mouseY < 300, "the highlighted scrolling row remains on screen");
client.menuKeyboardSelect = true;
drawKeyboardMenu();
assert.equal(keyboardPicked, 59, "Space invokes exactly the highlighted menu state entry");
assert.equal(consumedMenuClicks, 2, "keyboard confirmation is consumed like a mouse selection");
assert.equal(menuUi.menu, undefined, "keyboard confirmation closes the menu");
assert.equal(client.menuKeyboardSelect, false, "confirmation cannot repeat on another frame");

client.menuKeyboardIndex = 1;
client.menuKeyboardSelect = true;
menuUi.menu = {
    open: true, source: "widgets", follow: false, x: 700, y: 500,
    entries: keyboardEntries.slice(0, 3),
    menuState: { invoke: (index: number) => { keyboardPicked = index; } },
};
drawKeyboardMenu();
assert.equal(keyboardPicked, 1, "Space also invokes the selected inventory context menu action");
assert.equal(menuUi.menu, undefined, "widget menu selection closes the native menu");
assert.equal(consumedMenuClicks, 3, "an inventory keyboard menu selection cannot click through");

// A Close press/release can both arrive before the render frame. Its onOp
// unloads the modal before the world input pass. Keep this CI test cache-free:
// minimal static widgets and script 29's IF_CLOSE/RETURN, with the real VM,
// manager and input lifecycle. Cache decoding/rendered hit testing is separate.
const closeScript = Object.assign(new Script(), {
    id: 29,
    instructions: Int32Array.from([Opcodes.IF_CLOSE, Opcodes.RETURN]),
    intOperands: Int32Array.from([0, 0]),
    stringOperands: [null, null],
});
const unloadedGroups: number[] = [];
const closeManager = new WidgetManager({} as never, {
    loadWidgetGroup(groupId: number) {
        const node = (fileId: number, parentUid = -1): any => ({
            uid: (groupId << 16) | fileId, groupId, fileId, parentUid,
            type: 0, rawX: 0, rawY: 0, rawWidth: 200, rawHeight: 200,
            hidden: false, isHidden: false,
        });
        const root = node(0);
        const child = node(groupId === 161 ? 16 : 1, root.uid);
        if (groupId === 807) Object.assign(child, {
            actions: ["Close"], onOp: [closeScript.id],
        });
        return { root, widgets: new Map([[root.uid, root], [child.uid, child]]) };
    },
    unloadGroup(groupId: number) { unloadedGroups.push(groupId); },
} as never);
const closeVm = new Cs2Vm({
    widgetManager: closeManager,
    loadScript: (id: number) => id === closeScript.id ? closeScript : null,
} as any);
closeManager.setRootInterface(161);
const modalParent = (161 << 16) | 16;
closeManager.openSubInterface(modalParent, 807, 0);
const nativeClose = closeManager.getWidgetByUid((807 << 16) | 1)!;
let nativeCloses = 0;
closeVm.context.sendIfClose = () => nativeCloses++;
const nativeInput = new InputManager();
nativeInput.clickMode1 = ClickMode.LEFT;
nativeInput.clickMode2 = ClickMode.NONE;
nativeInput.clickX = nativeInput.mouseX = 100;
nativeInput.clickY = nativeInput.mouseY = 120;
nativeInput.onFrameStart();
const nativeInteraction = new WidgetInteractionController({
    getWidgetManager: () => closeManager,
    getInputManager: () => nativeInput,
    getRendererCanvas: () => undefined,
    getTradeRequestTargetsByName: () => new Map(),
});
const nativeDeps = {
    getCs2Vm: () => closeVm,
    getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
    getTransmitCycles: () => ({ cycleCntr: 1 }),
    getSettings: () => ({}),
    handleTradeWidgetAction: () => false,
    buildWidgetActionPayload: () => null,
    executeScriptListener: (widget: any, args: any[], event: any) => closeVm.runScriptEvent({ widget, args, ...event }),
} as any;
const nativeFrame = { input: nativeInput, mx: 100, my: 120,
    collectFromAllRoots: () => [nativeClose], getWidgetFlags: (widget: any) => closeManager.getWidgetFlags(widget) } as any;
const nativePrimary = createPrimaryWidgetActionResolver(nativeDeps, nativeInput, closeManager, nativeInteraction);
processWidgetClickInput(nativeDeps, { cachedHoverHits: null } as any, nativeFrame, closeManager, nativeInteraction, nativePrimary, true);
assert.equal(nativeCloses, 1, "Close's actual VM opcode sends IF_CLOSE once");
assert.equal(closeManager.interfaceParents.has(modalParent), false, "actual CS2 closes the real modal");
assert.deepEqual(unloadedGroups, [807], "Close unloads the modal through the real manager");
assert.equal(closeManager.isGroupLoaded(807), false);
assert.equal(closeVm.lastError, null);
processWidgetReleaseInput(nativeDeps, nativeFrame, closeManager, nativeInteraction, nativePrimary, false);
assert.equal(nativeInteraction.clickedWidget, null, "release clears transient widget custody");
assert.equal(nativeInput.leftClickX, -1, "Close must not expose the same frame click to the later world input pass");
assert.equal(nativeInput.clickMode2, ClickMode.NONE, "claiming a widget does not invent a held button");
nativeInput.onFrameEnd();
nativeInput.clickMode1 = ClickMode.LEFT;
nativeInput.clickX = 220;
nativeInput.clickY = 240;
nativeInput.onFrameStart();
assert.equal(nativeInput.leftClickX, 220, "a new independent world click remains usable");

console.log("menu click consumption test passed");
