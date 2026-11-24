import assert from "node:assert/strict";
import { test } from "node:test";

import { Cs2Vm } from "../rs/cs2/Cs2Vm";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";

// Two ways a client script stops early in OSRS:
// - if_callonresize / cc_callonresize on a component without an onResize listener ends the whole
//   script (callers too) without an error;
// - an error aborts it.
// Either way the ops it had triggered and a close it had asked for are still carried out.

const uid = (component: number) => (875 << 16) | component;
const plain = { uid: uid(1), actions: ["One"], children: null };
const other = { uid: uid(2), actions: ["Two"], children: null };
const third = { uid: uid(3), actions: ["Three"], children: null };
const resizable = { uid: uid(4), actions: [], children: null, onResize: [900] };
const widgets = new Map<number, any>([plain, other, third, resizable].map((widget) => [widget.uid, widget]));

function script(id: number, ops: Array<[number, number?]>): Script {
    return Object.assign(new Script(), {
        id,
        instructions: Int32Array.from(ops.map(([opcode]) => opcode)),
        intOperands: Int32Array.from(ops.map(([, operand]) => operand ?? 0)),
        stringOperands: ops.map(() => null),
    });
}
const triggerOp = (widget: { uid: number }): Array<[number, number?]> =>
    [[Opcodes.ICONST, widget.uid], [Opcodes.ICONST, -1], [Opcodes.ICONST, 1], [Opcodes.IF_TRIGGEROP]];
const callOnResize = (widget: { uid: number }): Array<[number, number?]> => [[Opcodes.ICONST, widget.uid], [Opcodes.IF_CALLONRESIZE]];

function makeVm(scripts: Script[]) {
    const sent: number[] = [];
    const ran: number[] = [];
    let closes = 0;
    const byId = new Map(scripts.map((entry) => [entry.id, entry]));
    const vm = new Cs2Vm({
        loadScript: (id: number) => byId.get(id) ?? null,
        varManager: {},
        widgetManager: {
            getWidgetByUid: (id: number) => widgets.get(id) ?? null,
            interfaceParents: new Map(),
            beginBatch() {}, endBatch() {}, flushBatch() {},
        },
        sendWidgetOp: (widget: any) => sent.push(widget.uid),
        sendIfClose: () => closes++,
        onScriptFinished: (id: number) => ran.push(id),
    } as any);
    return { vm, sent, ran, closes: () => closes };
}

function quietly<T>(run: () => T): T {
    const error = console.error;
    console.error = () => {};
    try {
        return run();
    } finally {
        console.error = error;
    }
}

test("if_callonresize without a listener ends the script and its callers, without an error", () => {
    // 10 triggers an op, calls 11, and would trigger another; 11 hits the listener-less component.
    const inner = script(11, [...callOnResize(plain), ...triggerOp(third), [Opcodes.RETURN]]);
    const outer = script(10, [...triggerOp(plain), [Opcodes.INVOKE, 11], ...triggerOp(other), [Opcodes.RETURN]]);
    const { vm, sent, ran } = makeVm([outer, inner]);
    vm.execute(outer);
    assert.deepEqual(sent, [plain.uid], "nothing after the call ran, in either script; the op triggered before it is still clicked");
    assert.equal(vm.lastError, null, "it is not an error");
    assert.deepEqual(ran, [11, 10], "both scripts count as finished");

    // The VM is fine afterwards.
    vm.execute(script(12, [...triggerOp(other), [Opcodes.RETURN]]));
    assert.deepEqual(sent, [plain.uid, other.uid]);
});

test("if_callonresize with a listener queues it and the script goes on", () => {
    const listener = script(900, [...triggerOp(third), [Opcodes.RETURN]]);
    const main = script(20, [...callOnResize(resizable), ...triggerOp(other), [Opcodes.RETURN]]);
    const { vm, sent } = makeVm([main, listener]);
    vm.execute(main);
    assert.deepEqual([...sent].sort(), [other.uid, third.uid], "the script's own op and the listener's");
    assert.equal(vm.lastError, null);
});

test("a script error still clicks the triggered ops and closes the interface", () => {
    const failing = script(30, [...triggerOp(plain), [Opcodes.IF_CLOSE], [Opcodes.ICONST, 1], [Opcodes.ICONST, 0], [Opcodes.DIV], ...triggerOp(other), [Opcodes.RETURN]]);
    const { vm, sent, closes } = makeVm([failing]);
    quietly(() => vm.execute(failing));
    assert.ok(vm.lastError, "the division by zero is an error");
    assert.deepEqual(sent, [plain.uid], "the op triggered before the error is clicked, the one after it is not");
    assert.equal(closes(), 1, "the close asked for before the error happens");

    // An error in a called script does the same for what its caller had deferred.
    const callee = script(32, [[Opcodes.ICONST, 1], [Opcodes.ICONST, 0], [Opcodes.DIV], [Opcodes.RETURN]]);
    const caller = script(31, [...triggerOp(other), [Opcodes.INVOKE, 32], ...triggerOp(third), [Opcodes.RETURN]]);
    const nested = makeVm([caller, callee]);
    quietly(() => nested.vm.execute(caller));
    assert.deepEqual(nested.sent, [other.uid]);
    assert.equal(nested.closes(), 0);
});
