import assert from "node:assert/strict";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import {
    createPlayerSyncState,
    encodePlayerSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// Varrock rooftop's rough wall: the player is placed on the roof (a teleport to level 3) and,
// in the same update, starts a forced move along it. The teleport must still land, or the
// player is drawn on the ground until they next move.
const BASE = { x: 3168, y: 3360 };
const ground = { x: 3220, y: 3414, level: 0 };
const state = createPlayerSyncState(1, ground);
const ctx = new PlayerSyncContext();
ctx.setBase(BASE.x, BASE.y);
ctx.setLocalIndex(1);
ctx.activate(1, ground);
for (const empty of ctx.emptyIndices) ctx.flags[empty] = 1;

const view: any = { index: 1, ...ground, appearance: Buffer.alloc(0) };
const decode = (tick: number) => {
    const data = encodePlayerSync(1, BASE.x, BASE.y, tick, [view], state).subarray(3);
    const length = data.readUInt16BE(10);
    return new PlayerUpdateDecoder().decode(data.subarray(12, 12 + length), ctx, {
        packetSize: length,
        loopCycle: tick,
    });
};
decode(1);

Object.assign(view, {
    level: 3,
    forcedMovement: {
        startDeltaX: 0,
        startDeltaY: 0,
        endDeltaX: -1,
        endDeltaY: 0,
        startCycleOffset: 0,
        endCycleOffset: 45,
        direction: 1536,
    },
});
const frame = decode(2);
const teleport = frame.movements.find((event) => event.index === 1 && event.mode === "teleport");
assert.ok(teleport, "the teleport onto the roof is applied");
assert.deepEqual(teleport.tile, { x: 3220, y: 3414, level: 3 });
assert.equal(teleport.applyAfterBlocks, undefined, "before the forced move starts");
const block = frame.updateBlocks.get(1);
assert.ok(block?.forcedMovement, "the forced move along the roof still plays");
assert.deepEqual([block.forcedMovement.endTileX, block.forcedMovement.endTileY], [3219, 3414]);

console.log("player-sync-teleport-force-move: ok");
