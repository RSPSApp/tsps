import assert from "node:assert/strict";

import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeWidgetSetColour } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";

// IF_SETCOLOUR reaches the client as 15-bit RGB and is widened as the game's client does:
// red, green and blue (5 bits each) shifted to bits 19, 11 and 3. The values are the boss HUD's
// health bar colours from a capture (normal: 25600, 576, 800; the Doom's shield: 132).
const uid = (303 << 16) | 13;
const decode = (colour: number) => decodeServerPacket(new Uint8Array(encodeWidgetSetColour(uid, colour))) as any;

assert.deepEqual(decode(25600), { type: "widget", payload: { action: "set_colour", uid, colour: 25 << 19 } });
assert.equal(decode(576).payload.colour, 18 << 11);
assert.equal(decode(800).payload.colour, 25 << 11);
assert.equal(decode(132).payload.colour, (4 << 11) | (4 << 3));
assert.equal(decode(0x7fff).payload.colour, (31 << 19) | (31 << 11) | (31 << 3), "white");

console.log("widget set colour packet: ok");
