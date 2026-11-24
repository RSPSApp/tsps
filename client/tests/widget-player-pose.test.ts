import assert from "node:assert/strict";
import { test } from "node:test";

import { usesLocalPlayerPose } from "../widgets/gl/widgetsGl/playerPose";

// OSRS poses a player-composition model widget (the equipment and makeover previews) with the
// local player's idle animation at its live frame, so it is never a frozen figure.
test("a player-composition preview always takes the local player's pose", () => {
    assert.equal(usesLocalPlayerPose({ modelType: 7 }, undefined), true);
    assert.equal(usesLocalPlayerPose({ modelType: 7 }, 808), true, "its own sequence is ignored");
    assert.equal(usesLocalPlayerPose({ isPlayerModel: true }, undefined), true);
});

test("the local-player model keeps a sequence a script gave it; other models are untouched", () => {
    assert.equal(usesLocalPlayerPose({ contentType: 328 }, undefined), true);
    assert.equal(usesLocalPlayerPose({ contentType: 328 }, 808), false);
    assert.equal(usesLocalPlayerPose({ modelType: 1 }, undefined), false);
});
