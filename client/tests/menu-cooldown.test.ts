import assert from "node:assert/strict";
import { menuCooldownBlocksPass } from "../render/render/interact/menuCooldown";

// #5680: the world menu's cooldown counts frames, so a right-click pick that arrives while it runs used to wait
// 10 frames: ~333 ms at 30 FPS, ~83 ms at 120 FPS. A pick builds the menu itself and is never held back.
const base = { mouseX: 100, mouseY: 120, menuOpenedFrame: 1000, cooldownFrames: 10, leftClicked: false, picked: false };

for (const fps of [30, 60, 120, 240]) {
    // The frame a pick arrives 2 frames after a menu opened, whatever the frame rate.
    const frameCount = 1002;
    const msHeld = (10 - 2) * (1000 / fps);
    assert.equal(menuCooldownBlocksPass({ ...base, frameCount, picked: true }), false, `a pick is not held back at ${fps} FPS (it used to wait ~${Math.round(msHeld)} ms)`);
}

// The hover pass is still held back for the cooldown, and runs once it has passed.
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1002 }), true, "hover within the cooldown waits");
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1009 }), true, "hover on the last frame of the cooldown waits");
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1010 }), false, "hover after the cooldown runs");

// A left click always runs the pass; no pointer holds it back (even for a pick).
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1002, leftClicked: true }), false);
assert.equal(menuCooldownBlocksPass({ ...base, mouseX: -1, frameCount: 5000 }), true);
assert.equal(menuCooldownBlocksPass({ ...base, mouseY: -1, frameCount: 5000, picked: true }), true);

// Touch devices keep their longer cooldown for hover.
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1040, cooldownFrames: 50 }), true);
assert.equal(menuCooldownBlocksPass({ ...base, frameCount: 1050, cooldownFrames: 50 }), false);

console.log("menu-cooldown ok");
