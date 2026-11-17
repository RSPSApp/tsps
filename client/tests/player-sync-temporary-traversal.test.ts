import assert from "node:assert/strict";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import { createPlayerSyncState, encodePlayerSync } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

const base = { x: 2944, y: 2944 }, start = { x: 3000, y: 3000, level: 0 };
const state = createPlayerSyncState(1, start), context = new PlayerSyncContext();
context.setBase(base.x, base.y); context.setLocalIndex(1); context.activate(1, start);
for (const index of context.emptyIndices) context.flags[index] = 1;
const view: any = { index: 1, ...start, appearance: Buffer.alloc(0), movementType: 2 };
function decode(tick: number) {
    const payload = encodePlayerSync(1, base.x, base.y, tick, [view], state).subarray(3);
    const length = payload.readUInt16BE(10);
    return new PlayerUpdateDecoder().decode(payload.subarray(12, 12 + length), context, { packetSize: length, loopCycle: tick });
}
decode(1);
view.y -= 2; view.temporaryMovementType = 1;
const crossing = decode(2), walk = crossing.movements.find(event => event.index === 1);
assert.equal(walk?.mode, "walk");
assert.deepEqual(walk?.tile, { x: 3000, y: 2998, level: 0 });
// The compact two-tile opcode creates one pending destination, not two explicit path nodes.
assert.deepEqual(walk?.traversals, [1]);
assert.equal(walk?.snap, undefined);
assert.equal(crossing.updateBlocks.get(1)?.movementFlag, 1);
assert.equal(context.states[1].movementType, 2, "the client keeps its persistent run type");

delete view.temporaryMovementType; view.x += 2;
const ordinary = decode(3).movements.find(event => event.index === 1);
assert.equal(ordinary?.mode, "run");
assert.deepEqual(ordinary?.traversals, [2], "the next movement uses the cached type");

view.x += 2; view.resetPath = true; view.temporaryMovementType = 1;
const placement = decode(4), teleport = placement.movements.find(event => event.index === 1);
assert.equal(placement.updateBlocks.get(1)?.movementFlag, 127);
assert.equal(teleport?.mode, "teleport"); assert.equal(teleport?.snap, true);
console.log("player-sync-temporary-traversal: ok");
