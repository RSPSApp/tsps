import assert from "node:assert/strict";

import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * An NPC can show several spotanims at once, each in its own slot (the Colosseum Manticore's
 * three charged orbs); an id of -1 clears a slot. Round trip: server encoder, client decoder.
 */
function decodeNpcs(packet: Buffer, decoder: NpcUpdateDecoder) {
    const body = packet.subarray(3);
    const length = body.readUInt16BE(9);
    return decoder.decode(body.subarray(11, 11 + length), {
        large: body[4] === 1,
        loopCycle: 0,
        clientCycle: 0,
        localTileX: 3200,
        localTileY: 3200,
        level: 0,
    });
}

function spotAnimSlotsRoundTrip(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const view = (graphics?: unknown[]) => ({
        index: 7, typeId: 12818, x: 3203, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, graphics,
    });

    decodeNpcs(encodeNpcSync(1, local, [view() as any], state), decoder);
    const decoded = decodeNpcs(encodeNpcSync(2, local, [view([
        { slot: 1, id: 2683, height: 0, delay: 0 },
        { slot: 2, id: 2681, height: 0, delay: 30 },
        { slot: 3, id: -1, height: 0, delay: 0 },
    ]) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(7)?.spotAnims, [
        { slot: 1, id: 2683, height: 0, delayCycles: 0 },
        { slot: 2, id: 2681, height: 0, delayCycles: 30 },
        { slot: 3, id: -1, height: 0, delayCycles: 0 },
    ]);
}

spotAnimSlotsRoundTrip();
console.log("NPC spotanim slot tests passed");
