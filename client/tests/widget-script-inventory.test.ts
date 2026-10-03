import { strict as assert } from "node:assert";

import { ServerPacketId } from "../common/packets/ServerPacketId";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { Cs2Vm, ScriptArgMagic } from "../rs/cs2/Cs2Vm";
import { Script } from "../rs/cs2/Script";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Inventory } from "../rs/inventory/Inventory";
import { WidgetInteractionController } from "../game/widgets/WidgetInteractionController";
import { processWidgetReleaseInput } from "../game/widgets/input/widgetReleaseInput";

const body = Uint8Array.from([
    0, 0, 3, 204, // clientscript 972
    0, // no script arguments
    0, 0, // no varps
    0, 0, // no varbits
    1, // one inventory
    2, 72, // inventory 584
    0, 50, // capacity 50
    0, 2, // two populated slots
    0, 0, 16, 56, 1, // slot 0: abyssal whip x1
    0, 1, 3, 228, 255, 0, 0, 1, 44, // slot 1: coins x300
]);
const packet = Uint8Array.from([
    ServerPacketId.WIDGET_RUN_SCRIPT,
    body.length >> 8,
    body.length & 0xff,
    ...body,
]);

const decoded = decodeServerPacket(packet);
assert.equal(decoded?.type, "widget");
assert.equal(decoded?.payload.action, "run_script");
assert.equal(decoded?.payload.scriptId, 972);
assert.deepEqual(decoded?.payload.inventories, {
    584: {
        capacity: 50,
        slots: [
            { slot: 0, itemId: 4151, quantity: 1 },
            { slot: 1, itemId: 995, quantity: 300 },
        ],
    },
});

console.log("widget script inventory test passed");

// Inventory scripts identify dynamic slots by their common container plus slot
// index. Renderer UIDs must never be passed as the drag target's component id.
const parentUid = 149 << 16;
const source: any = { uid: parentUid + 32768, parentUid, fileId: -1, childIndex: 0,
    groupId: 149, itemId: 960, width: 36, height: 32, dragZoneSize: 5, isDraggable: true };
const target: any = { ...source, uid: source.uid + 1, childIndex: 1, itemId: 2347 };
const capture = new Script();
capture.id = 1;
capture.intArgCount = capture.localIntCount = 4;
capture.instructions = Int32Array.from([Opcodes.ILOAD, Opcodes.ILOAD, Opcodes.ILOAD, Opcodes.ILOAD, Opcodes.RETURN]);
capture.intOperands = Int32Array.from([0, 1, 2, 3, 0]);
source.onDragComplete = [capture.id, ScriptArgMagic.WIDGET_ID, ScriptArgMagic.DRAG_TARGET_ID,
    ScriptArgMagic.WIDGET_CHILD_INDEX, ScriptArgMagic.DRAG_TARGET_CHILD_INDEX];
const manager: any = { beginBatch() {}, endBatch() {}, flushBatch() {}, invalidateWidgetRender() {},
    getWidgetByUid: (uid: number) => uid === source.uid ? source : uid === target.uid ? target : undefined,
    isEffectivelyHidden: () => false };
const vm = new Cs2Vm({ widgetManager: manager, loadScript: () => capture } as any);
vm.invokeEventHandler(source, "onDragComplete", { dragTarget: target });
assert.deepEqual(Array.from(vm.intStack.slice(0, vm.intStackSize)), [parentUid, parentUid, 0, 1]);
vm.invokeEventHandler(source, "onDragComplete", { dragTarget: null });
assert.equal(vm.intStack[1], -1);
vm.invokeEventHandler(source, "onDragComplete", { dragTarget: { ...target, fileId: 7 } });
assert.equal(vm.intStack[1], target.uid, "static targets keep their own component id");

const inventory = new Inventory();
inventory.setSlot(0, 960, 1);
inventory.setSlot(1, 2347, 1);
const interaction = new WidgetInteractionController({ getWidgetManager: () => manager,
    getInputManager: () => undefined, getRendererCanvas: () => undefined,
    getTradeRequestTargetsByName: () => new Map() });
const events: string[] = [];
const deps: any = {
    getInventory: () => inventory,
    getCs2Vm: () => ({ invokeEventHandler(widget: any, type: any, context: any) {
        events.push(type);
        assert.equal(inventory.getSlot(0)?.itemId, 960, "script must see the original slot contents");
        return vm.invokeEventHandler(widget, type, context);
    } }),
    handleInventorySlotMove(from: number, to: number) {
        assert.deepEqual(events, ["onDragComplete"], "finish the script before publishing the move");
        events.push("move");
        inventory.swapSlots(from, to);
    },
    handleWidgetAction() { events.push("Drop"); },
};
Object.assign(interaction, { clickedWidget: source, dragSourceWidget: source, isDraggingWidget: true,
    draggedOnWidget: target, deferredWidgetAction: { widget: source, option: "Drop" } });
Object.assign(source, { _isDragActive: true, _dragVisualX: 42, _dragVisualY: 0 });
processWidgetReleaseInput(deps, { mx: 50, my: 10 } as any, manager, interaction,
    () => ({ option: "Drop", target: "Plank" }), false);
assert.deepEqual(events, ["onDragComplete", "move"]);
assert.equal(inventory.getSlot(1)?.itemId, 960);
assert.equal(interaction.clickedWidget, null);
assert.equal(interaction.deferredWidgetAction, null);
assert.equal(source._isDragActive, undefined);
assert.equal(source._dragVisualX, undefined);

// Releasing a short drag before its dead-time expires must not become Drop.
events.length = 0;
Object.assign(interaction, { clickedWidget: source, dragClickX: 5, dragClickY: 5,
    deferredWidgetAction: { widget: source, option: "Drop" } });
processWidgetReleaseInput(deps, { mx: 50, my: 10 } as any, manager, interaction,
    () => ({ option: "Drop", target: "Plank" }), false);
assert.deepEqual(events, []);
assert.equal(interaction.clickedWidget, null);

// A deliberate click still fires once, even if an earlier handler deferred it.
Object.assign(interaction, { clickedWidget: source, dragClickX: 5, dragClickY: 5,
    deferredWidgetAction: { widget: source, option: "Drop" } });
processWidgetReleaseInput(deps, { mx: 5, my: 5 } as any, manager, interaction,
    () => ({ option: "Drop", target: "Plank" }), false);
assert.deepEqual(events, ["Drop"]);
console.log("inventory drag identity, ordering and release tests passed");
