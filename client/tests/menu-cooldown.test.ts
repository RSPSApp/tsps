import assert from "node:assert/strict";
import { menuCooldownBlocksPass } from "../render/render/interact/menuCooldown";

// #5680: the world menu's cooldown counts frames. A right-click pick is a one-frame pulse, so a pick that arrived inside
// the cooldown was dropped (no menu opened) and the player had to click again after 10 frames: ~333 ms at 30 FPS,
// ~83 ms at 120 FPS. A desktop pick builds the menu itself and is never held back.
const base = { mouseX: 100, mouseY: 120, menuOpenedFrame: 1000, cooldownFrames: 10, leftClicked: false, picked: false, touch: false };

for (const fps of [30, 60, 120, 240]) {
    // A pick 2 frames after a menu opened, whatever the frame rate.
    const msUntilCooldownEnds = (10 - 2) * (1000 / fps);
    assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1002, picked: true }), false, `a pick is not dropped at ${fps} FPS (it used to be discarded until the cooldown ended, ~${Math.round(msUntilCooldownEnds)} ms later)`);
}

// The hover pass is still held back for the cooldown, and runs once it has passed.
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1002 }), true, "hover within the cooldown waits");
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1009 }), true, "hover on the last frame of the cooldown waits");
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1010 }), false, "hover after the cooldown runs");

// A left click always runs the pass; no pointer holds it back (even for a pick).
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1002, leftClicked: true }), false);
assert.equal(menuCooldownBlocksPass({ ...base, mouseX: -1, frameCount: 5000 }), true);
assert.equal(menuCooldownBlocksPass({ ...base, mouseY: -1, frameCount: 5000, picked: true }), true);

// Touch (50 frames) is unchanged: a long-press pick inside the cooldown is still held back, as before this change.
const touch = { ...base, cooldownFrames: 50, touch: true };
assert.equal(menuCooldownBlocksPass({ ...touch, frameCount: 1040 }), true, "touch hover waits");
assert.equal(menuCooldownBlocksPass({ ...touch, frameCount: 1050 }), false, "touch hover after 50 frames runs");
assert.equal(menuCooldownBlocksPass({ ...touch, frameCount: 1040, picked: true }), true, "a touch pick keeps the cooldown (unchanged)");

console.log("menu-cooldown ok");
