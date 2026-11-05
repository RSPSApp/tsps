import assert from "node:assert/strict";
import { test } from "node:test";

import { SceneFrameHold } from "../render/SceneFrameHold";

test("a teleport holds the last scene until the player's square can be drawn (issue #2017)", () => {
    const hold = new SceneFrameHold();
    assert.equal(hold.update(true, true, 0), false, "a ready square draws the live scene");
    assert.equal(hold.update(true, false, 100), true, "the destination is still building");
    assert.equal(hold.update(true, false, 1900), true);
    assert.equal(hold.update(true, true, 2000), false, "built: back to the live scene");
});

test("with no scene drawn yet (a login) there is nothing to hold", () => {
    const hold = new SceneFrameHold();
    assert.equal(hold.update(false, false, 0), false);
});

test("a square that never builds stops holding after the limit", () => {
    const hold = new SceneFrameHold();
    assert.equal(hold.update(true, false, 0), true);
    assert.equal(hold.update(true, false, SceneFrameHold.MAX_HOLD_MS - 1), true);
    assert.equal(hold.update(true, false, SceneFrameHold.MAX_HOLD_MS), false);
    assert.equal(hold.update(true, false, SceneFrameHold.MAX_HOLD_MS + 5000), false,
        "it doesn't start again until a square is ready");
    assert.equal(hold.update(true, true, SceneFrameHold.MAX_HOLD_MS + 6000), false);
    assert.equal(hold.update(true, false, SceneFrameHold.MAX_HOLD_MS + 7000), true, "the next teleport holds");
});
