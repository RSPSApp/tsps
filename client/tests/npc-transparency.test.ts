import assert from "node:assert/strict";

import { NpcEcs } from "../game/ecs/NpcEcs";
import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * NPC transparency (OSRS npc transparency): fades of an NPC's model. A live capture of Ocellus
 * teleporting to the middle: opaque to invisible between cycles 30 and 45 of the tick; spawns
 * fade in from invisible over the tick's first 30 cycles.
 */
function decodeNpcs(packet: Buffer, decoder: NpcUpdateDecoder, clientCycle: number) {
    const body = packet.subarray(3);
    const length = body.readUInt16BE(9);
    return decoder.decode(body.subarray(11, 11 + length), {
        large: body[4] === 1,
        loopCycle: 0,
        clientCycle,
        localTileX: 3200,
        localTileY: 3200,
        level: 0,
    });
}

function roundTrip(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const view = (transparency?: object) => ({
        index: 9, typeId: 16674, x: 3204, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, transparency,
        forcedChat: "after",
    });
    let decoded = decodeNpcs(encodeNpcSync(1, local, [view() as any], state), decoder, 100);
    assert.equal(decoded.updateBlocks.get(9)?.transparency, undefined, "no fade without one");

    decoded = decodeNpcs(encodeNpcSync(2, local, [view({ startCycles: 30, endCycles: 45, from: 0, to: 255 }) as any], state), decoder, 130);
    assert.deepEqual(decoded.updateBlocks.get(9)?.transparency, { startCycle: 160, endCycle: 175, from: 0, to: 255 });
    assert.equal(decoded.updateBlocks.get(9)?.say, "after", "the blocks before it stay aligned");

    decoded = decodeNpcs(encodeNpcSync(3, local, [view({ startCycles: 0, endCycles: 30, from: -1, to: 0 }) as any], state), decoder, 160);
    assert.deepEqual(decoded.updateBlocks.get(9)?.transparency, { startCycle: 160, endCycle: 190, from: -1, to: 0 }, "from its current look");
}

function fades(): void {
    const ecs = new NpcEcs(8);
    const id = ecs.createNpc(50, 50, 16674, 3, 0, 0, 0, 0, 0, 0);
    assert.equal(ecs.getTransparency(id, 0), 0, "opaque by default");

    ecs.setTransparency(id, 130, 160, 0, 255, 100);
    assert.equal(ecs.getTransparency(id, 120), 0, "before the fade");
    assert.equal(ecs.getTransparency(id, 145), 128, "halfway");
    assert.equal(ecs.getTransparency(id, 300), 255, "held at the end");

    // A fade in from where it is now (invisible), back to opaque.
    ecs.setTransparency(id, 400, 430, -1, 0, 400);
    assert.equal(ecs.getTransparency(id, 400), 255);
    assert.equal(ecs.getTransparency(id, 430), 0);

    ecs.destroyNpc(id);
    const again = ecs.createNpc(50, 50, 16674, 3, 0, 0, 0, 0, 0, 0);
    assert.equal(ecs.getTransparency(again, 500), 0, "a reused slot starts opaque");
}

roundTrip();
fades();
console.log("NPC transparency tests passed");
