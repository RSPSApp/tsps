import assert from "node:assert/strict";

import { KeyboardButtonProbe } from "../game/chat/keyboardButtonProbe";
import { Opcodes } from "../rs/cs2/Opcodes";
import { Script } from "../rs/cs2/Script";

function script(id: number, ops: Array<[number, number?]>): Script {
    const s = new Script();
    s.id = id;
    s.instructions = Int32Array.from(ops.map(([op]) => op));
    s.intOperands = Int32Array.from(ops.map(([, operand]) => operand ?? 0));
    return s;
}

const scripts = new Map<number, Script>([
    // Keyboard button: shows the keyboard through a proc two gosubs down.
    [100, script(100, [[Opcodes.INVOKE, 101], [Opcodes.RETURN]])],
    [101, script(101, [[Opcodes.INVOKE, 102], [Opcodes.RETURN]])],
    [102, script(102, [[Opcodes.SCONST], [Opcodes.MOBILE_KEYBOARDSHOW], [Opcodes.RETURN]])],
    // Ordinary button, and a script that calls itself.
    [200, script(200, [[Opcodes.POP_INT], [Opcodes.RETURN]])],
    [300, script(300, [[Opcodes.INVOKE, 300], [Opcodes.RETURN]])],
    // Variant opcode, used directly from onClick.
    [400, script(400, [[Opcodes.MOBILE_KEYBOARDSHOW2]])],
]);
let loads = 0;
const probe = new KeyboardButtonProbe((id) => {
    loads++;
    return scripts.get(id) ?? null;
});

assert.equal(probe.widgetShowsKeyboard({ onOp: [100, 1, "x"] }), true);
assert.equal(probe.widgetShowsKeyboard({ onClick: [400] }), true);
assert.equal(probe.widgetShowsKeyboard({ onOp: [200] }), false);
assert.equal(probe.widgetShowsKeyboard({ onOp: [300] }), false);
assert.equal(probe.widgetShowsKeyboard({ onOp: [999] }), false);
assert.equal(probe.widgetShowsKeyboard({}), false);

// Results are cached per listener script.
const before = loads;
assert.equal(probe.widgetShowsKeyboard({ onOp: [100] }), true);
assert.equal(loads, before);

console.log("Keyboard button probe test passed");
