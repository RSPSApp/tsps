import assert from "node:assert/strict";

import { TouchGestureRecognizer } from "../game/input/TouchGestureRecognizer";

const types = (intents: Array<{ type: string }>) => intents.map((intent) => intent.type);

// An ordinary stationary touch taps.
const plain = new TouchGestureRecognizer();
plain.fingerDown(100, 100, 0);
assert.ok(types(plain.fingerUp(100, 100, 50)).includes("tap"));

// The finger left on the screen after a pinch: lifting it ends the pinch, it is no tap...
const afterPinch = new TouchGestureRecognizer();
afterPinch.fingerDown(100, 100, 0, true);
assert.deepEqual(types(afterPinch.checkLongPress(10_000)), [], "nor a long-press");
const lifted = types(afterPinch.fingerUp(100, 100, 50));
assert.ok(!lifted.includes("tap"), `no tap: ${lifted}`);

// ...and the next ordinary touch taps again.
afterPinch.fingerDown(100, 100, 100);
assert.ok(types(afterPinch.fingerUp(100, 100, 150)).includes("tap"));

console.log("Touch gesture after pinch test passed");
