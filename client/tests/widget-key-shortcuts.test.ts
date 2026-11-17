import assert from "node:assert/strict";
import { test } from "node:test";
import { InputManager } from "../game/InputManager";
import { WidgetActionRouter } from "../game/widgets/WidgetActionRouter";
import { processWidgetKeyboardInput } from "../game/widgets/input/widgetKeyboardInput";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";
import { getPacketWriter, ClientPacket } from "../network/packet";
import { createCacheVm } from "../scripts/cache/cs2-sweep";
import { decodeClientPacket } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { getTransmitCycles } from "../game/TransmitCycles";
import { ClientState } from "../game/ClientState";
import { SpellSelectionController } from "../game/widgets/SpellSelectionController";

const { vm } = createCacheVm();
const wm = vm.context.widgetManager;
wm.rootInterface = 595;
wm.getGroup(595);
const root = wm.getWidgetByUid(595 << 16)!;
vm.runScriptEvent({ args: root.onLoad!, widget: root });
assert.equal(vm.lastError, null, "active cache worldmap_init runs");
let escape = wm.getWidgetByUid((595 << 16) | 4)!;
const input = new InputManager();
let cycle = 100;
const packets: any[] = [];
const writer = getPacketWriter();
const originalAddNode = writer.addNode;
writer.addNode = (node: any) => { packets.push(node); };
const deps: any = {
    getInputManager: () => input,
    getWidgetManager: () => wm,
    getCs2Vm: () => vm,
    getVarManager: () => vm.context.varManager,
    getTransmitCycles: () => ({ cycleCntr: cycle }),
    getPendingInputDialogAction: () => null,
    getPendingTradeQuantityAction: () => null,
    getCustomInterfaces: () => ({ handleSearchKeyEvents: () => false, handleWidgetClick: () => false,
        rowIdAt: () => undefined, handleWidgetOp() {} }),
    getWidgetInteraction: () => ({ clickedWidgetHandled: false, isWidgetDraggable: () => false }),
    getPlayerDesign: () => ({ handleWidgetAction: () => false }),
    executeScriptListener: (widget: any, args: any[], event: any) => vm.runScriptEvent({ args, widget, ...event }),
};
const router = new WidgetActionRouter(deps);
deps.handleWidgetAction = (event: any) => router.handleWidgetAction(event);
const selection = new SpellSelectionController({ ...deps, getObjTypeLoader: () => vm.context.objTypeLoader });
deps.clearSelectedSpell = () => selection.clearSelectedSpell();
deps.setSelectedSpell = (spell: any, widget: any) => selection.setSelectedSpell(spell, widget);
deps.getWidgetTargetMask = (widget: any) => selection.getWidgetTargetMask(widget);
deps.resolveSpellSelectionFromWidget = (...args: any[]) => (selection.resolveSpellSelectionFromWidget as any)(...args);
const frame = () => ({ input, mx: 0, my: 0, allRoots: wm.getAllGroupRoots(wm.rootInterface),
    visibleMap: new Map(), getStaticChildren: (uid: number) => wm.getStaticChildrenByParentUid(uid) });
const process = () => { getTransmitCycles().cycleCntr = cycle; processWidgetKeyboardInput(deps, frame() as any, wm); };
function key(keyCode: number, key: string, repeat = false) {
    input.onKeyDown({ keyCode, key, code: key === "Escape" ? "Escape" : `Key${key.toUpperCase()}`,
        repeat, preventDefault() {} } as any);
}
function execute(ops: [number, number][], widget = escape) {
    const script = Object.assign(new Script(), { instructions: Int32Array.from(ops.map(([op]) => op)),
        intOperands: Int32Array.from(ops.map(([, operand]) => operand)),
        stringOperands: ops.map(() => null) });
    vm.setActiveWidget(widget);
    vm.run(script);
    vm.setActiveWidget(null);
    assert.equal(vm.lastError, null);
}
const ints = (...values: number[]): [number, number][] => values.map(value => [Opcodes.ICONST, value]);
const scripts = new Map<number, Script>();
const cacheLoadScript = vm.context.loadScript;
vm.context.loadScript = (id: number) => scripts.get(id) ?? cacheLoadScript(id);
function listener(widget: any, event: string, ops: [number, number][], args: number[] = []) {
    const id = 900000 + scripts.size;
    scripts.set(id, Object.assign(new Script(), { id, intArgCount: args.length, localIntCount: args.length,
        instructions: Int32Array.from(ops.map(([op]) => op)), intOperands: Int32Array.from(ops.map(([, n]) => n)),
        stringOperands: ops.map(() => null) }));
    widget.eventHandlers ??= {};
    widget.eventHandlers[event] = { scriptId: id, intArgs: args, objectArgs: [] };
}
const bind = (op: number, keyCode: number, mask = 0) => execute([
    ...ints(op, keyCode, mask, escape.uid), [Opcodes.IF_SETOPKEY, 0], [Opcodes.RETURN, 0],
]);
const release = () => { (input as any).onFocusOut(); input.onFrameEnd(); cycle++; process(); input.onFrameEnd(); };
const next = (at: number) => { input.onFrameEnd(); cycle = at; process(); };
const setMode = (opcode: number, target?: number) => execute([
    ...(target === undefined ? [] : ints(target)), [opcode, 0], [Opcodes.RETURN, 0],
]);
const mountedAt = 161 << 16;
test.beforeEach(() => {
    if (wm.interfaceParents.has(mountedAt)) wm.closeSubInterface(mountedAt, false);
    wm.rootInterface = 595;
    wm.getGroup(595);
    escape = wm.getWidgetByUid((595 << 16) | 4)!;
    escape.opKeys = [];
    escape.opKeyRates = undefined;
    escape.keyTimers = undefined;
    escape.hidden = false;
    escape.flags = 2;
    escape.actions = ["Close"];
    escape.onOp = undefined;
    escape.onClick = undefined;
    escape.eventHandlers = undefined;
    (input as any).onFocusOut();
    input.onFrameEnd();
    cycle += 100;
    vm.widgetKeyInputMode = 0;
    vm.inputDialogType = 0;
    vm.context.varManager.setVarbit(4681, 0);
    ClientState.clearSpellSelection();
    bind(1, 13);
    packets.length = 0;
});

test("active worldmap_init binding dispatches native Escape as IF_BUTTON1 on its zero-size component", () => {
    vm.runScriptEvent({ args: root.onLoad!, widget: root });
    assert.equal(vm.lastError, null);
    packets.length = 0;
    key(27, "Escape");
    process();
    assert.equal(packets.length, 1, "one operation packet, even though the key target has no click area");
    assert.equal(packets[0].packetType, ClientPacket.IF_BUTTON1);
    assert.deepEqual(decodeClientPacket(Buffer.from(packets[0].packetBuffer.data.subarray(0,
        packets[0].packetBuffer.offset))), { type: "widget_action", widgetId: escape.uid,
        groupId: 595, childId: 4, slot: undefined, itemId: undefined, buttonNum: 1 });
});

test("target shortcut has its own eleventh slot and repeat delay retains both integer values", () => {
    execute([...ints(10, 48, 0, escape.uid), [Opcodes.IF_SETOPKEY, 0],
        ...ints(49, 4, escape.uid), [Opcodes.IF_SETOPTKEY, 0],
        ...ints(10, 5, 15, escape.uid), [Opcodes.IF_SETOPKEYRATE, 0], [Opcodes.RETURN, 0]]);
    assert.ok(escape.opKeys?.[10], "target slot does not overwrite operation 10");
    assert.equal((escape.opKeyRates?.[9] as any)?.delay, 15);
});

test("native activecomponent focus changes shortcut scope without pushing a value or opening an amount dialog", () => {
    execute([[3140, 0], [Opcodes.RETURN, 0]]);
    assert.equal(vm.intStackSize, 0, "3140 is a setter, not a getter");
    assert.equal((vm as any).widgetKeyInputMode, 3);
    assert.equal((vm as any).widgetKeyInputTarget, escape.uid);
    assert.equal(vm.inputDialogType, 0);
});

test("all four modifier bits and alternative keys use internal codes", () => {
    for (const [mask, ctrl, alt, shift, expected] of [
        [0, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 1, 0, 1, 1],
        [2, 0, 1, 0, 1], [2, 1, 0, 0, 0], [4, 0, 0, 1, 1],
        [7, 1, 1, 1, 1], [7, 1, 0, 1, 0], [8, 0, 0, 0, 1],
        [8, 1, 0, 0, 0], [8, 0, 1, 0, 0], [8, 0, 0, 1, 0],
    ]) {
        release(); packets.length = 0;
        bind(1, 48, mask);
        if (ctrl) key(17, "Control");
        if (alt) key(18, "Alt");
        if (shift) key(16, "Shift");
        // Preserve modifier state in the native event, as a browser does.
        input.onKeyDown({ keyCode: 65, key: "a", code: "KeyA", ctrlKey: !!ctrl,
            altKey: !!alt, shiftKey: !!shift, preventDefault() {} } as any);
        process();
        assert.equal(packets.length, expected, `mask=${mask} Ctrl=${ctrl} Alt=${alt} Shift=${shift}`);
    }
    release(); packets.length = 0;
    execute([...ints(1, 48, 0, 68, 0, -1, 0, -1, 0, -1, 0), [Opcodes.CC_SETOPKEY, 0], [Opcodes.RETURN, 0]]);
    key(66, "b"); process();
    assert.equal(packets.length, 1, "second CC alternative dispatches the same operation");
});

test("repeat uses initial delay plus rate, then rate, independent of DOM repeats and render passes", () => {
    bind(1, 48);
    execute([...ints(1, 5, 15, escape.uid), [Opcodes.IF_SETOPKEYRATE, 0], [Opcodes.RETURN, 0]]);
    const start = cycle;
    key(65, "a"); process(); process();
    assert.equal(packets.length, 1);
    next(start + 19); assert.equal(packets.length, 1);
    next(start + 20); assert.equal(packets.length, 2);
    next(start + 24); assert.equal(packets.length, 2);
    next(start + 25); assert.equal(packets.length, 3);
    key(65, "a", true); process(); assert.equal(packets.length, 3);
    release(); key(65, "a"); process(); assert.equal(packets.length, 4);
});

test("synchronous onOp scope changes apply to later widgets in the same scan", () => {
    const later = wm.getWidgetByUid((595 << 16) | 27)!;
    const savedOnOp = later.onOp;
    later.onOp = undefined;
    later.flags = 2;
    later.hidden = false;
    bind(1, 48);
    execute([...ints(1, 48, 0, later.uid), [Opcodes.IF_SETOPKEY, 0], [Opcodes.RETURN, 0]], later);
    try {
        for (const [opcode, target, expected] of [
            [3139, undefined, 1], [3136, escape.uid, 1], [3136, later.uid, 2],
            [3137, 594, 1], [3137, 595, 2],
        ]) {
            (input as any).onFocusOut(); input.onFrameEnd(); cycle++;
            vm.widgetKeyInputMode = 0;
            escape.keyTimers = undefined; later.keyTimers = undefined; packets.length = 0;
            listener(escape, "onOp", [...(target === undefined ? [] : ints(target)),
                [opcode!, 0], [Opcodes.RETURN, 0]]);
            key(65, "a"); process();
            assert.equal(packets.length, expected, `later widget observes onOp scope ${opcode}/${target}`);
        }
    } finally {
        later.hasKeyBindings = false; later.opKeys = []; later.keyTimers = undefined;
        later.onOp = savedOnOp;
    }
});

test("onOp repeat changes take effect before committing the current activation deadline", () => {
    bind(1, 48);
    listener(escape, "onOp", [...ints(1, 5, 15, escape.uid),
        [Opcodes.IF_SETOPKEYRATE, 0], [Opcodes.RETURN, 0]]);
    const start = cycle;
    key(65, "a"); process();
    assert.equal(escape.keyTimers![0], start + 20, "callback enables first repeat with its delay");
    next(start + 19); assert.equal(packets.length, 1);
    next(start + 20); assert.equal(packets.length, 2);
    assert.equal(escape.keyTimers![0], start + 25);
    listener(escape, "onOp", [...ints(1, 0, 0, escape.uid),
        [Opcodes.IF_SETOPKEYRATE, 0], [Opcodes.RETURN, 0]]);
    next(start + 25); assert.equal(packets.length, 3);
    next(start + 100); assert.equal(packets.length, 3, "callback also disables further held repeats");
});

test("callback ignore-held timer mutation is read before post-operation repeat scheduling", () => {
    bind(1, 48);
    listener(escape, "onOp", [...ints(1, 5, 15, escape.uid), [Opcodes.IF_SETOPKEYRATE, 0],
        ...ints(1, escape.uid), [Opcodes.IF_SETOPKEYIGNOREHELD, 0], [Opcodes.RETURN, 0]]);
    const start = cycle;
    key(65, "a"); process();
    assert.equal(escape.keyTimers![0], start + 5, "nonzero callback timer skips initial delay");
    next(start + 4); assert.equal(packets.length, 1);
    next(start + 5); assert.equal(packets.length, 2);
});

test("an eligible widget finishes its slots and retains its schedule after callback hide", () => {
    const parent = wm.getWidgetByUid(escape.parentUid!)!;
    for (const hiddenTarget of [escape, parent]) {
        release(); packets.length = 0;
        escape.keyTimers = undefined; // Each hide variant starts with fresh fixture deadlines.
        bind(1, 48); bind(2, 48);
        escape.flags = 6;
        execute([...ints(1, 5, 15, escape.uid), [Opcodes.IF_SETOPKEYRATE, 0], [Opcodes.RETURN, 0]]);
        listener(escape, "onOp", [...ints(1, hiddenTarget.uid), [Opcodes.IF_SETHIDE, 0], [Opcodes.RETURN, 0]]);
        const start = cycle;
        try {
            key(65, "a"); process();
            assert.equal(hiddenTarget.hidden, true);
            assert.deepEqual(packets.map(packet => packet.packetType),
                [ClientPacket.IF_BUTTON1, ClientPacket.IF_BUTTON2], "both eligible slots finish after hiding");
            assert.equal(escape.keyTimers?.[0], start + 20, "completed activation retains its deadline");
            next(start + 10);
            assert.equal(packets.length, 2, "a later scan cannot enter the still-hidden widget");
            escape.eventHandlers = undefined;
            execute([...ints(2, -1, 0, escape.uid), [Opcodes.IF_SETOPKEY, 0],
                ...ints(0, hiddenTarget.uid), [Opcodes.IF_SETHIDE, 0], [Opcodes.RETURN, 0]]);
            assert.equal(wm.getWidgetByUid(escape.uid), escape);
            next(start + 19); assert.equal(packets.length, 2);
            next(start + 20); assert.equal(packets.length, 3, "revealed same instance resumes while still held");
        } finally {
            escape.eventHandlers = undefined;
            execute([...ints(2, -1, 0, escape.uid), [Opcodes.IF_SETOPKEY, 0],
                ...ints(0, hiddenTarget.uid), [Opcodes.IF_SETHIDE, 0], [Opcodes.RETURN, 0]]);
        }
    }
});

test("ignore-held suppresses the current hold and permits a new press after release", () => {
    bind(1, 48); key(65, "a");
    execute([...ints(1, escape.uid), [Opcodes.IF_SETOPKEYIGNOREHELD, 0], [Opcodes.RETURN, 0]]);
    process(); next(cycle + 50); assert.equal(packets.length, 0);
    release(); key(65, "a"); process(); assert.equal(packets.length, 1);
    next(cycle + 50); assert.equal(packets.length, 1, "rate0 remains one shot per hold");
});

test("scoped modes select component/interface/all/none without mutating amount dialog state", () => {
    for (const [opcode, target, count] of [[3139, undefined, 0], [3137, 594, 0], [3137, 595, 1],
        [3136, escape.uid + 1, 0], [3136, escape.uid, 1], [3138, undefined, 1]]) {
        release(); packets.length = 0; setMode(opcode!, target);
        key(27, "Escape"); process(); assert.equal(packets.length, count, `opcode ${opcode} target ${target}`);
    }
    vm.inputDialogType = 2; vm.inputDialogString = "123";
    setMode(3138);
    assert.equal(vm.inputDialogType, 2); assert.equal(vm.inputDialogString, "123");
});

test("real search onKey exits scoped search without closing the map on the same Escape", () => {
    const search = root.onLoad![12] as number;
    vm.run(vm.context.loadScript(1736), [search, 0, 1]);
    assert.equal(vm.lastError, null);
    assert.equal(vm.widgetKeyInputMode, 3);
    key(27, "Escape"); process();
    assert.equal(vm.lastError, null);
    assert.equal(vm.widgetKeyInputMode, 0, "the real onKey1737 executes search_off1735");
    assert.equal(packets.length, 0, "mode changed to all only after this press's shortcut scan");
    release(); key(27, "Escape"); process();
    assert.equal(packets.filter(p => p.packetType === ClientPacket.IF_BUTTON1).length, 1);
});

test("a held cache Escape binding does not fall through to the generic modal closer", () => {
    wm.rootInterface = 161; wm.getGroup(161); wm.openSubInterface(mountedAt, 595, 0);
    vm.context.varManager.setVarbit(4681, 1);
    key(27, "Escape"); process();
    assert.equal(packets.length, 1);
    input.onFrameEnd(); cycle++; key(27, "Escape", true); process();
    assert.deepEqual(packets.map(p => p.packetType), [ClientPacket.IF_BUTTON1]);
});

test("shortcuts invoke onOp with its operation index, never onClick or selected-spell targeting", () => {
    listener(escape, "onClick", [...ints(999), [Opcodes.SET_VARC_INT, 10000], [Opcodes.RETURN, 0]]);
    listener(escape, "onOp", [[Opcodes.ILOAD, 0], [Opcodes.SET_VARC_INT, 10000], [Opcodes.RETURN, 0]], [-2147483644]);
    bind(2, 48); escape.flags = 0; escape.actions = [];
    ClientState.isSpellSelected = true;
    key(65, "a"); process();
    assert.equal(vm.context.varManager.getVarcInt(10000), 2, "listener-only operation still executes with no label/flag");
    assert.equal(packets.length, 0, "unset transmit flags suppress the packet only");
    assert.equal(ClientState.isSpellSelected, true, "ordinary shortcut does not cast or deselect a spell");
    release(); escape.flags = 4; key(65, "a"); process();
    assert.equal(packets[0].packetType, ClientPacket.IF_BUTTON2);
});

test("operation10 and target-slot selection coexist, including target leave/enter on reselection", () => {
    bind(10, 48);
    execute([...ints(68, 0, escape.uid), [Opcodes.IF_SETOPTKEY, 0], [Opcodes.RETURN, 0]]);
    listener(escape, "onTargetEnter", [...ints(1), [Opcodes.SET_VARC_INT, 10001], [Opcodes.RETURN, 0]]);
    listener(escape, "onTargetLeave", [...ints(2), [Opcodes.SET_VARC_INT, 10002], [Opcodes.RETURN, 0]]);
    escape.flags = (1 << 10) | (1 << 11);
    key(65, "a"); process();
    assert.equal(packets[0].packetType, ClientPacket.IF_BUTTON10);
    release(); packets.length = 0; key(66, "b"); process();
    assert.equal(packets.length, 0, "target selection does not send IF_BUTTON10/11");
    assert.equal(ClientState.selectedSpellWidget, escape.uid);
    assert.equal(ClientState.selectedSpellTargetMask, 1);
    assert.equal(vm.context.varManager.getVarcInt(10001), 1);
    release(); key(66, "b"); process();
    assert.equal(ClientState.isSpellSelected, true, "target shortcut reselects instead of mouse toggle-off");
    assert.equal(vm.context.varManager.getVarcInt(10002), 2);
});

test("hidden ancestry and native focusout suppress shortcuts and permit subsequent presses", () => {
    const parent = wm.getWidgetByUid(escape.parentUid!)!;
    parent.hidden = true; key(27, "Escape"); process();
    assert.equal(packets.length, 0);
    release(); parent.hidden = false;
    key(27, "Escape"); (input as any).onFocusOut(); process();
    assert.equal(packets.length, 0, "focus loss clears even a newly queued physical press");
    input.onFrameEnd(); key(27, "Escape"); process();
    assert.equal(packets.length, 1);
});

test("CC_CREATE bindings preserve dynamic identity and deletion invalidates later collected siblings", () => {
    const parent = escape;
    for (let index = 0; index < 2; index++) {
        execute([...ints(parent.uid, 4, index, 0), [Opcodes.CC_CREATE, 0],
            ...ints(1, 48, 0, -1, 0, -1, 0, -1, 0, -1, 0), [Opcodes.CC_SETOPKEY, 0], [Opcodes.RETURN, 0]]);
        parent.children![index]!.flags = 2;
    }
    const first = parent.children![0]!, second = parent.children![1]!;
    listener(first, "onOp", [...ints(parent.uid), [Opcodes.CC_DELETEALL, 0], [Opcodes.RETURN, 0]]);
    key(65, "a"); process();
    assert.equal(packets.length, 1, "deleted sibling cannot dispatch from the traversal snapshot");
    const packet = decodeClientPacket(Buffer.from(packets[0].packetBuffer.data.subarray(0, packets[0].packetBuffer.offset))) as any;
    assert.equal(packet.widgetId, parent.uid); assert.equal(packet.slot, 0);
    assert.equal(wm.getWidgetByUid(second.uid), undefined);
    release(); packets.length = 0;
    execute([...ints(parent.uid, 4, 0, 0), [Opcodes.CC_CREATE, 0],
        ...ints(1, 48, 0, -1, 0, -1, 0, -1, 0, -1, 0), [Opcodes.CC_SETOPKEY, 0], [Opcodes.RETURN, 0]]);
    const replacement = parent.children![0]!; replacement.flags = 2;
    assert.notEqual(replacement, first);
    key(65, "a"); process(); assert.equal(packets.length, 1);
});

test("closing and reopening the real mounted cache group drops its prior repeat state", () => {
    wm.rootInterface = 161; wm.getGroup(161); wm.openSubInterface(mountedAt, 595, 0);
    key(27, "Escape"); process(); assert.equal(packets.length, 1);
    const previous = escape;
    wm.closeSubInterface(mountedAt);
    input.onFrameEnd(); cycle++; process(); assert.equal(packets.length, 1);
    wm.openSubInterface(mountedAt, 595, 0);
    const reopenedRoot = wm.getWidgetByUid(595 << 16)!;
    vm.runScriptEvent({ args: reopenedRoot.onLoad!, widget: reopenedRoot });
    escape = wm.getWidgetByUid((595 << 16) | 4)!;
    assert.notEqual(escape, previous);
    assert.equal(escape.keyTimers, undefined);
    next(cycle + 1); assert.equal(packets.length, 1, "a held key cannot activate a newly loaded widget without a press");
    release(); key(27, "Escape"); process(); assert.equal(packets.length, 2);
});

test.after(() => { writer.addNode = originalAddNode; });
