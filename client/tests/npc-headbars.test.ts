import assert from "node:assert/strict";

import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * Headbars besides the hitpoints one, as the Doom of Mokhaiotl's captures show them: its melee
 * charge (headbar 81, 0 to 100 over 390 cycles), its shield's points (headbar 11) alongside a
 * hit, and a bar taken away. Round trip: server encoder, client decoder.
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
    const view = (extra: object = {}) => ({
        index: 9, typeId: 14707, x: 3203, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, ...extra,
    });

    decodeNpcs(encodeNpcSync(1, local, [view() as any], state), decoder, 0);

    // The melee charge: filling over 390 cycles, with no hit that tick.
    let decoded = decodeNpcs(encodeNpcSync(2, local, [view({
        bars: [{ id: 81, fill: 0, endFill: 100, duration: 390, delay: 0 }],
    }) as any], state), decoder, 500);
    assert.deepEqual(decoded.updateBlocks.get(9)?.healthBars, [
        { id: 81, cycle: 500, health: 0, health2: 100, cycleOffset: 390 },
    ]);
    assert.equal(decoded.updateBlocks.get(9)?.hitsplats, undefined, "a bar alone sends no hitsplat");

    // A hit during the shield: the hitpoints bar shows the shield (bar 11), with the charge restarted.
    decoded = decodeNpcs(encodeNpcSync(3, local, [view({
        hits: [{ type: 16, damage: 43 }],
        health: { current: 51, max: 500, bar: { id: 11, width: 120 } },
        bars: [{ id: 81, fill: 0, endFill: 100, duration: 510 }],
    }) as any], state), decoder, 530);
    assert.equal(decoded.updateBlocks.get(9)?.hitsplats?.[0]?.damage, 43);
    assert.deepEqual(decoded.updateBlocks.get(9)?.healthBars, [
        { id: 11, cycle: 530, health: 12, health2: 12, cycleOffset: 0 },
        { id: 81, cycle: 530, health: 0, health2: 100, cycleOffset: 510 },
    ]);

    // A cancelled charge: the bar is taken away.
    decoded = decodeNpcs(encodeNpcSync(4, local, [view({ bars: [{ id: 81, remove: true }] }) as any], state), decoder, 560);
    assert.deepEqual(decoded.updateBlocks.get(9)?.healthBars, [
        { id: 81, cycle: 560, health: 0, health2: 0, cycleOffset: 0, removed: true },
    ]);

    // A fixed fill (no duration) sends no end fill.
    decoded = decodeNpcs(encodeNpcSync(5, local, [view({ bars: [{ id: 81, fill: 40 }] }) as any], state), decoder, 590);
    assert.deepEqual(decoded.updateBlocks.get(9)?.healthBars, [
        { id: 81, cycle: 590, health: 40, health2: 40, cycleOffset: 0 },
    ]);
}

roundTrip();
console.log("NPC headbar tests passed");
