import assert from "node:assert/strict";

import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * NPCs whose overhead prayer the server sets (the Hunllef: its forms have no cache head icons)
 * carry it in their update block. Round trip: server encoder, client decoder.
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

function headIconsRoundTrip(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const view = (headIcon: number) => ({
        index: 7, typeId: 9021, x: 3203, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, headIcon,
    });

    // Added with Protect from Melee showing.
    let decoded = decodeNpcs(encodeNpcSync(1, local, [view(0) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(7)?.headIcons, [{ archiveId: 440, spriteId: 0 }]);

    // Unchanged: nothing sent.
    decoded = decodeNpcs(encodeNpcSync(2, local, [view(0) as any], state), decoder);
    assert.equal(decoded.updateBlocks.get(7)?.headIcons, undefined);

    // Switched to Protect from Missiles, then cleared.
    decoded = decodeNpcs(encodeNpcSync(3, local, [view(1) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(7)?.headIcons, [{ archiveId: 440, spriteId: 1 }]);
    decoded = decodeNpcs(encodeNpcSync(4, local, [view(-1) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(7)?.headIcons, []);
}

headIconsRoundTrip();
console.log("NPC head icon tests passed");
