import assert from "node:assert/strict";
import { ClickMode, InputManager } from "../game/InputManager";

// #5680: a right-click pick is a ONE-FRAME pulse (InputManager.onFrameStart: clickMode3 = clickMode1; clickMode1 is cleared),
// so a pick the interaction pass returns early on is gone the next frame: it is dropped, not kept for later.
const input = new InputManager();
const raw = input as any;
raw.clickMode1 = ClickMode.RIGHT; // what a right mouse-down (and a touch long press) sets
raw.clickX = 321;
raw.clickY = 123;
assert.equal(input.pickX, -1, "before the frame starts the pick is not visible");
input.onFrameStart();
assert.equal(input.pickX, 321, "the frame after the click sees the pick");
assert.equal(input.pickY, 123);
input.onFrameStart();
assert.equal(input.pickX, -1, "the next frame it is gone: the pick lasts one frame");
assert.equal(input.pickY, -1);

console.log("input-pick-pulse ok");
