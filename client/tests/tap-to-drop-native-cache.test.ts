import assert from "node:assert/strict";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { Inventory } from "../rs/inventory/Inventory";
import { createScriptEvent } from "../rs/cs2/Cs2Vm";
import { registerClientOps } from "../rs/cs2/handlers/ClientOps";
import type { HandlerMap } from "../rs/cs2/handlers/HandlerTypes";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createPrimaryWidgetActionResolver } from "../game/widgets/input/widgetPrimaryAction";
import { buildWidgetActionPayload } from "../game/widgets/widgetActionPayload";
import { ClientState } from "../game/ClientState";

const { vm } = createCacheVm();
const manager = vm.context.widgetManager;
const vars = vm.context.varManager;
const client = { settings: { tapToDrop: false } };
(manager as any).osrsClient = client;
manager.rootInterface = 601;
manager.getGroup(149);
const inventory = new Inventory(28);
inventory.setSlot(0, 385, 1); // default shift action: Drop
inventory.setSlot(1, 5509, 1); // explicit shift action: Check
inventory.setSlot(2, 12791, 1); // Destroy is deliberately not a shift action
vm.context.inventories = new Map([[93, inventory]]);
const handlers: HandlerMap = new Map();
registerClientOps(handlers);
const primary = createPrimaryWidgetActionResolver({ getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }) } as any, {} as any, manager as any, {} as any);
try {
    assert.equal(ClientState.isShiftPressed(), false);
    for (const enabled of [0, 1, 0, 1]) {
        vars.setVarbit(16111, enabled);
        vm.runScriptEvent(createScriptEvent({ args: [7431] }), 200000);
        assert.equal(vm.lastError, null);
        assert.equal(client.settings.tapToDrop, enabled === 1, "native mobile settings refresh publishes tap state");
        const output: number[] = [];
        handlers.get(Opcodes.GETTAPTODROP)!({ widgetManager: manager, pushInt: (n: number) => output.push(n) } as any, 0 as any);
        assert.deepEqual(output, [enabled], "GET reads the canonical state written by SET");
        vm.run(vm.context.loadScript(6007), [149 << 16, 1], []);
        for (const widget of manager.getWidgetByUid(149 << 16).children.slice(0, 3)) {
            vm.activeWidget = widget;
            vm.run(vm.context.loadScript(6012), [widget.itemId, 0], []);
        }
        assert.equal(vm.lastError, null);
        const items = manager.getWidgetByUid(149 << 16).children;
        assert.equal(items[0].actions[enabled ? 0 : 1], enabled ? "Drop" : "Eat", "normal touch needs no physical Shift");
        assert.equal(items[1].actions[enabled ? 0 : 1], enabled ? "Check" : "Fill", "custom shift action is respected");
        assert.equal(items[2].actions[1], "Open", "Destroy-only item keeps its ordinary action");
        assert.ok(items[0].actions.includes("Eat"), "normal menu keeps Eat available");
        assert.ok(items[0].actions.includes("Drop"));
        const action = primary(items[0]);
        assert.equal(action.option, enabled ? "Drop" : "Eat");
        assert.equal(action.opIndex, enabled ? 1 : 2);
        const payload = buildWidgetActionPayload(manager, { widget: items[0], ...action, source: "primary" });
        assert.equal(payload.itemId, 385);
        assert.equal(payload.slot, 0);
        assert.equal(payload.option, enabled ? "Drop" : "Eat");
    }
    manager.rootInterface = 161;
    vm.runScriptEvent(createScriptEvent({ args: [7431] }), 200000);
    assert.equal(client.settings.tapToDrop, false, "desktop refresh does not retain mobile tap mode");
    assert.equal(ClientState.isShiftPressed(), false);
} finally {
    ClientState.shiftClickDrop = false;
}
console.log("native tap-to-drop setting, item exceptions, and action dispatch passed");
