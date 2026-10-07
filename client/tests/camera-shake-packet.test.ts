import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import {
    encodeCameraReset,
    encodeCameraShake,
} from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// The server's camera shake and reset reach the client's CAMERA_CONTROL decoder intact.
const shake = decodeServerPacket(new Uint8Array(encodeCameraShake(1, 7, 0, 0))) as any;
assert.deepEqual(shake, {
    type: "camera",
    payload: { mode: "shake", slot: 1, randomAmplitude: 7, sineAmplitude: 0, sineFrequency: 0 },
});

const reset = decodeServerPacket(new Uint8Array(encodeCameraReset())) as any;
assert.deepEqual(reset, { type: "camera", payload: { mode: "reset" } });

console.log("camera shake packet: ok");
