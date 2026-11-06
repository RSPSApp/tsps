import assert from "node:assert/strict";

import { encodeLocMerge } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { decodeBatchedServerPackets, decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { handleInboundWorld } from "../network/serverConnection/handlers/inboundWorld";

// Revision 241 consumes this packet without consulting a player or changing the scene.
// Keep the signed/reversed offsets recorded for the underwater obstacle unchanged on the
// TSPS wire. Reintroducing an old-client model attachment here would diverge from 241.
const captured = {
    locId: 30962, tile: { x: 3760, y: 10277 }, level: 1, shape: 10, rotation: 3,
    playerIndex: 1966, start: 0, end: 60, minX: 1, maxX: -1, minZ: 0, maxZ: 0,
};
const frame = encodeLocMerge(captured);
assert.equal(frame.length, 19);
assert.equal(frame[0], 138);
const extremes = { ...captured, playerIndex: 2047, start: 1, end: 65535, minX: -128, maxZ: 127 };
const batch = decodeBatchedServerPackets(Buffer.concat([frame, encodeLocMerge(extremes)]));
assert.equal(batch.stalled, false);
assert.deepEqual(batch.messages.map((message: any) => message.payload), [captured, extremes]);
for (const patch of [{ start: -1 }, { end: 0 }, { end: 65536 }, { minX: -129 }, { rotation: 4 }, { playerIndex: 2048 }]) {
    assert.throws(() => encodeLocMerge({ ...captured, ...patch }), RangeError);
}
const previous = Object.getOwnPropertyDescriptor(globalThis, "__osrsClient");
let sceneLookups = 0;
Object.defineProperty(globalThis, "__osrsClient", {
    configurable: true,
    get() { sceneLookups++; throw new Error("LOC_MERGE must not resolve or mutate a revision-241 scene"); },
});
try {
    for (const playerIndex of [0, captured.playerIndex, 2047]) {
        const payload = { ...captured, playerIndex };
        const decoded = decodeServerPacket(new Uint8Array(encodeLocMerge(payload)));
        assert.deepEqual(decoded, { type: "loc_merge", payload });
        assert.equal(handleInboundWorld(decoded), true);
        assert.equal(handleInboundWorld(decoded), true, "repeated packets remain harmless");
    }
    assert.equal(sceneLookups, 0, "decoding/consuming needs neither a loaded map nor a player");
} finally {
    if (previous) Object.defineProperty(globalThis, "__osrsClient", previous);
    else delete (globalThis as any).__osrsClient;
}

console.log("loc merge wire and revision-241 consume-only behavior passed");
