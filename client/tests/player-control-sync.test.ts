import assert from "node:assert/strict";
import { handleInboundSync } from "../network/serverConnection/handlers/inboundSync";
import { state } from "../network/serverConnection/state";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";

// Reusing a player index must not retain the previous viewer's active-player list.
for (const id of [1, 26, 26, 1]) {
    const old = new PlayerSyncContext();
    old.setLocalIndex(id);
    old.activate(6, { x: 3080, y: 3524, level: 0 });
    old.flags[6] = 1;
    state.playerSyncContext = old;
    state.lastHandshake = { id };
    handleInboundSync({ type: "handshake", payload: { id, name: "controlled" } } as any);
    assert.notEqual(state.playerSyncContext, old);
    assert.equal(state.playerSyncContext!.isActive(6), false);
    assert.equal(state.playerSyncContext!.flags[6], 0);
}
console.log("player control bootstraps reset the viewer's sync state");
