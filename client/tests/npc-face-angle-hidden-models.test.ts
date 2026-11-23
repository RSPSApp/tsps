import assert from "node:assert/strict";

import { NpcUpdateDecoder } from "../game/sync/NpcUpdateDecoder";
import { npcTypeHasModel } from "../rs/config/npctype/NpcType";
import {
    createNpcSyncState,
    encodeNpcSync,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

/**
 * The Hueycoatl's tail (rsprox.net 4052, 4054): it never turns, so live holds it with npc
 * face_angle (instant) at 512 out of the east cave and 1536 out of the west one, and while it is
 * sunk its body customisation replaces every model with -1, so it is drawn as nothing.
 */
function decodeNpcs(packet: Buffer, decoder: NpcUpdateDecoder) {
    const body = packet.subarray(3);
    const length = body.readUInt16BE(9);
    return decoder.decode(body.subarray(11, 11 + length), {
        large: body[4] === 1,
        loopCycle: 0,
        clientCycle: 100,
        localTileX: 3200,
        localTileY: 3200,
        level: 0,
    });
}

function roundTrip(): void {
    const state = createNpcSyncState();
    const decoder = new NpcUpdateDecoder();
    const local = { x: 3200, y: 3200, level: 0 };
    const view = (extra: object) => ({
        index: 9, typeId: 14014, x: 3204, y: 3204, level: 0,
        rotation: 0, walkDirection: -1, runDirection: -1, forcedChat: "before", ...extra,
    });
    let decoded = decodeNpcs(encodeNpcSync(1, local, [view({}) as any], state), decoder);
    assert.equal(decoded.updateBlocks.get(9)?.faceAngle, undefined, "none unless sent");

    decoded = decodeNpcs(encodeNpcSync(2, local, [view({
        faceAngle: { angle: 512, instant: true },
        typeCustomisation: { models: [-1] },
    }) as any], state), decoder);
    const block = decoded.updateBlocks.get(9);
    assert.deepEqual(block?.faceAngle, { angle: 512, instant: true });
    assert.deepEqual(block?.typeCustomisation, { models: [-1] }, "-1 survives the wire");
    assert.equal(block?.say, "before", "the blocks before it stay aligned");

    decoded = decodeNpcs(encodeNpcSync(3, local, [view({ faceAngle: { angle: 1536, instant: false } }) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(9)?.faceAngle, { angle: 1536, instant: false });

    decoded = decodeNpcs(encodeNpcSync(4, local, [view({ typeCustomisation: { models: [-1, -1, -1] } }) as any], state), decoder);
    assert.deepEqual(decoded.updateBlocks.get(9)?.typeCustomisation, { models: [-1, -1, -1] }, "the broken tail's three models");
}

function hiddenModelsDrawNothing(): void {
    assert.equal(npcTypeHasModel({ modelIds: [50311] }), true);
    assert.equal(npcTypeHasModel({ modelIds: [-1] }), false, "a -1 model is drawn as nothing");
    assert.equal(npcTypeHasModel({ modelIds: [50311, -1, 50312] }), false, "one -1 hides the whole NPC");
    assert.equal(npcTypeHasModel({ modelIds: [] }), false);
    assert.equal(npcTypeHasModel(undefined), false);
}

roundTrip();
hiddenModelsDrawNothing();
console.log("NPC face angle and hidden model tests passed");
