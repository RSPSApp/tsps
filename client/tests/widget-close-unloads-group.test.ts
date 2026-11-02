import assert from "node:assert/strict";

import { setCustomInterface } from "../common/gamemode/GamemodeContentStore";
import { SMITHING_BAR_MODAL_GROUP_ID } from "../common/ui/widgets";
import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { loadCustomWidgetGroup } from "../widgets/custom/CustomWidgetGroups";
import { WidgetLoader } from "../widgets/WidgetLoader";
import { WidgetManager } from "../widgets/WidgetManager";

// The real client unloads a closed interface (closeInterface -> unloadInterface), so the next
// open decodes it from the cache again and every if_sethide / if_settext / cc_create from the
// last open is gone.

const ROOT = 161;
const SHOP = 658;
const OTHER = 659;

function widget(groupId: number, fileId: number, parentUid = -1, hidden = false): any {
    return {
        uid: (groupId << 16) | fileId, groupId, fileId, parentUid, type: 0,
        rawX: 0, rawY: 0, rawWidth: 0, rawHeight: 0, hidden, isHidden: hidden, text: "",
    };
}

// The cache: every decode returns new nodes; the loader keeps them until the group unloads,
// as WidgetLoader does.
const decodes = new Map<number, number>();
const decoded = new Map<number, any>();
function decode(groupId: number): any {
    decodes.set(groupId, (decodes.get(groupId) ?? 0) + 1);
    const nodes = groupId === ROOT
        ? [widget(ROOT, 0), widget(ROOT, 1, ROOT << 16), widget(ROOT, 2, ROOT << 16), widget(ROOT, 3, ROOT << 16)]
        : [widget(groupId, 0), widget(groupId, 24, groupId << 16, true), widget(groupId, 5, groupId << 16)];
    return { root: nodes[0], widgets: new Map(nodes.map((node) => [node.uid, node])) };
}
const manager = new WidgetManager({} as never, {
    loadWidgetGroup(groupId: number) {
        if (!decoded.has(groupId)) decoded.set(groupId, decode(groupId));
        return decoded.get(groupId);
    },
    unloadGroup(groupId: number) {
        decoded.delete(groupId);
    },
    getAvailableGroups: () => [ROOT, SHOP, OTHER],
    clearCache() {
        decoded.clear();
    },
} as never);
const closes: [number, boolean][] = [];
manager.interfaceClosedListeners.add((groupId, _modal, unload) => closes.push([groupId, unload]));

const MAIN_MODAL = (ROOT << 16) | 1;
const SECOND_MOUNT = (ROOT << 16) | 2;
const loadingLayer = (SHOP << 16) | 24;

manager.setRootInterface(ROOT);
manager.openSubInterface(MAIN_MODAL, SHOP);
assert.equal(manager.getWidgetByUid(loadingLayer)?.hidden, true, "the loading layer starts hidden");

// While open, the server or a script shows the layer and changes the rest.
let layer = manager.getWidgetByUid(loadingLayer)!;
layer.hidden = layer.isHidden = false;
manager.getWidgetByUid((SHOP << 16) | 5)!.text = "Confirmed";
const created = { ...widget(SHOP, 0), uid: manager.allocateDynamicUid(SHOP), parentUid: SHOP << 16 };
manager.registerWidget(created);
manager.setServerOwnedWidget((SHOP << 16) | 5, true);

manager.closeSubInterface(MAIN_MODAL);
assert.deepEqual(closes, [[SHOP, true]], "closing reports the unload once");
assert.equal(manager.isGroupLoaded(SHOP), false, "a closed interface is unloaded");
assert.equal(manager.getWidgetByUid(loadingLayer), undefined);
assert.equal(manager.getWidgetByUid(created.uid), undefined, "its cc_create children go with it");
assert.equal(manager.isServerOwnedWidget((SHOP << 16) | 5), false);

manager.openSubInterface(MAIN_MODAL, SHOP);
assert.equal(decodes.get(SHOP), 2, "reopening decodes the group from the cache again");
layer = manager.getWidgetByUid(loadingLayer)!;
assert.equal(layer.hidden, true, "the loading layer shown before the close is hidden again");
assert.equal(manager.getWidgetByUid((SHOP << 16) | 5)!.text, "", "text set before the close is gone");

// IF_OPENSUB over the same group at the same component closes it without unloading.
layer.hidden = layer.isHidden = false;
closes.length = 0;
manager.openSubInterface(MAIN_MODAL, SHOP);
assert.deepEqual(closes, [[SHOP, false]]);
assert.equal(manager.getWidgetByUid(loadingLayer)!.hidden, false, "reopening in place keeps the group loaded");
assert.equal(decodes.get(SHOP), 2);

// A different group over it unloads the old one.
manager.openSubInterface(MAIN_MODAL, OTHER);
assert.equal(manager.isGroupLoaded(SHOP), false);
manager.openSubInterface(MAIN_MODAL, SHOP);
assert.equal(manager.getWidgetByUid(loadingLayer)!.hidden, true);

// A group still mounted at another component stays loaded.
manager.openSubInterface(SECOND_MOUNT, SHOP);
layer = manager.getWidgetByUid(loadingLayer)!;
layer.hidden = layer.isHidden = false;
manager.closeSubInterface(SECOND_MOUNT);
assert.equal(manager.isGroupLoaded(SHOP), true, "a group mounted elsewhere is not unloaded");
assert.equal(manager.getWidgetByUid(loadingLayer)!.hidden, false);
manager.closeSubInterface(MAIN_MODAL);
assert.equal(manager.isGroupLoaded(SHOP), false);

// Nested interfaces close and unload with their parent; the root interface stays loaded.
manager.openSubInterface(MAIN_MODAL, SHOP);
manager.openSubInterface((SHOP << 16) | 5, OTHER);
manager.closeSubInterface(MAIN_MODAL);
assert.equal(manager.isGroupLoaded(OTHER), false, "a nested interface is unloaded with its parent");
assert.equal(manager.isGroupLoaded(ROOT), true, "the root interface stays loaded");
assert.equal(decodes.get(ROOT), 1);

// CS2 ops after a reopen reach the new widgets, not the ones the close dropped.
const vm = new Cs2Vm({ widgetManager: manager, loadScript: () => undefined } as any);
const handlers = createHandlerMap();
const context = (vm as any).createHandlerContext();
function setHide(uid: number, hidden: boolean): void {
    vm.intStackSize = 0;
    vm.pushInt(hidden ? 1 : 0);
    vm.pushInt(uid);
    handlers.get(Opcodes.IF_SETHIDE)!(context, 0, null);
}
manager.openSubInterface(MAIN_MODAL, SHOP);
setHide(loadingLayer, false);
assert.equal(manager.getWidgetByUid(loadingLayer)!.hidden, false);
manager.closeSubInterface(MAIN_MODAL);
setHide(loadingLayer, false);
manager.openSubInterface(MAIN_MODAL, SHOP);
assert.equal(manager.getWidgetByUid(loadingLayer)!.hidden, true, "if_sethide on a closed interface does not reach its next open");
setHide(loadingLayer, false);
assert.equal(manager.getWidgetByUid(loadingLayer)!.hidden, false, "if_sethide after a reopen changes the reopened widget");

const textUid = (SHOP << 16) | 5;
const textWidget = manager.getWidgetByUid(textUid)!;
textWidget.text = 'Server text';
manager.setServerOwnedWidget(textUid, true);
for (const opcode of [Opcodes.CC_SETTEXT, Opcodes.IF_SETTEXT]) {
    vm.activeWidget = textWidget;
    vm.stringStackSize = vm.intStackSize = 0;
    vm.pushString('Cache text');
    if (opcode === Opcodes.IF_SETTEXT) vm.pushInt(textUid);
    handlers.get(opcode)!(context, 0, null);
    assert.equal(textWidget.text, 'Server text', 'both CS2 text setters respect server ownership');
    assert.equal(vm.intStackSize + vm.stringStackSize, 0, 'skipped setters still consume their operands');
}
manager.setServerOwnedWidget(textUid, false);
vm.pushString('Cache text');
handlers.get(Opcodes.CC_SETTEXT)!(context, 0, null);
assert.equal(textWidget.text, 'Cache text', 'explicit release restores cache text updates');
manager.closeSubInterface(MAIN_MODAL);

manager.openSubInterface(MAIN_MODAL, SHOP);
manager.setServerOwnedWidget(textUid, true);
manager.clear();
assert.equal(manager.isServerOwnedWidget(textUid), false, 'a client reset clears text ownership');

// The real loader hands out its decoded group until the group unloads.
const loader = new WidgetLoader({ getIndex: () => { throw new Error("no cache"); } } as never);
const smithing = loader.loadWidgetGroup(SMITHING_BAR_MODAL_GROUP_ID);
assert.equal(loader.loadWidgetGroup(SMITHING_BAR_MODAL_GROUP_ID), smithing);
loader.unloadGroup(SMITHING_BAR_MODAL_GROUP_ID);
assert.notEqual(loader.loadWidgetGroup(SMITHING_BAR_MODAL_GROUP_ID), smithing, "an unloaded group decodes again");

// A server-defined interface reopens from its definition, not from the last open's widgets.
setCustomInterface({ groupId: 30_000, widgets: [{ ...widget(30_000, 0), parentUid: -1 }, widget(30_000, 1, 30_000 << 16, true)] });
const first = loadCustomWidgetGroup(30_000)!;
first.widgets.get((30_000 << 16) | 1)!.hidden = false;
const second = loadCustomWidgetGroup(30_000)!;
assert.equal(second.widgets.get((30_000 << 16) | 1)!.hidden, true);
assert.equal(second.root, second.widgets.get(30_000 << 16), "the copy keeps its root in its widget map");

console.log("widget close unloads group tests passed");
