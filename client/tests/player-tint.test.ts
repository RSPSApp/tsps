import assert from "node:assert/strict";
import { PlayerSyncContext } from "../game/sync/PlayerSyncContext";
import { PlayerUpdateDecoder } from "../game/sync/PlayerUpdateDecoder";
import {
    createPlayerSyncState,
    encodePlayerSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// OSRS tinting (player mask 0x200): the Doom of Mokhaiotl's earthen shield tints a player inside
// it (lightness 106, weight 112 over 30 cycles) and clears it outside (hue/saturation/lightness -1).
const BASE = { x: 3392, y: 6400 };
const tile = { x: 3422, y: 6432, level: 0 };
const state = createPlayerSyncState(1, tile);
const ctx = new PlayerSyncContext();
ctx.setBase(BASE.x, BASE.y);
ctx.setLocalIndex(1);
ctx.activate(1, tile);
for (const empty of ctx.emptyIndices) ctx.flags[empty] = 1;

const view: any = { index: 1, ...tile, appearance: Buffer.alloc(0) };
const decode = (tick: number) => {
    const data = encodePlayerSync(1, BASE.x, BASE.y, tick, [view], state).subarray(3);
    const length = data.readUInt16BE(10);
    return new PlayerUpdateDecoder().decode(data.subarray(12, 12 + length), ctx, {
        packetSize: length,
        loopCycle: tick,
    });
};
decode(1);

// With a spot graphic in the same update, which is written just before it.
Object.assign(view, {
    tint: { startCycle: 0, endCycle: 30, hue: 0, saturation: 0, lightness: 106, weight: 112 },
    graphics: [{ id: 1116, height: 96, delay: 0, slot: 1 }],
});
let block = decode(2).updateBlocks.get(1);
const tint = block?.colorOverride;
assert.ok(tint, "the tint arrives");
assert.equal(tint.endCycle - tint.startCycle, 30);
assert.deepEqual([tint.hue, tint.sat, tint.lum, tint.amount], [0, 0, 106, 112]);
assert.equal(block?.spotAnimations?.[0]?.id, 1116, "and the spot graphic before it");

Object.assign(view, {
    tint: { startCycle: 0, endCycle: 0, hue: -1, saturation: -1, lightness: -1, weight: 0 },
    graphics: undefined,
});
block = decode(3).updateBlocks.get(1);
assert.deepEqual(
    [block?.colorOverride?.hue, block?.colorOverride?.sat, block?.colorOverride?.lum, block?.colorOverride?.amount],
    [-1, -1, -1, 0],
    "cleared",
);

console.log("player-tint: ok");
